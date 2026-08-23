/**
 * deadline.ts — motor determinístico de prazo de produção (sprint P0.2,
 * P0.18-P0.22, 2026-08-23; Bloco E da sprint P0.3, 2026-08-23).
 *
 * AUDITORIA REALIZADA (três vezes, independentemente): não existe em
 * nenhum lugar do ERP (index.html, functions/, functions-valeria/,
 * firestore.rules) configuração de capacidade produtiva. O único campo
 * relacionado a "prazo" é `kb_os.*.prazo`/`prazoPrometidoTexto` — valor
 * MANUAL digitado pelo operador por OS, não uma previsão calculada.
 *
 * Bloco E acrescenta a fonte real que faltava: `erp_vr/erp_config.data.
 * producao` — um bloco de configuração NOVO, só editável pelo Master
 * (nunca lido com fallback fictício: ausência de qualquer um dos 3
 * campos, ou valor <= 0, mantém canEstimate:false — nunca um número
 * inventado plausível). Combinado com a fila REAL de produção (contagem
 * de OS com status ativo em `erp_vr/kb_os`, mesma allowlist de status
 * que o Kanban de produção já usa: iniciada/producao/aguardando_saldo —
 * ver `_OS_ATIVOS_STATUS` em index.html), o algoritmo V1 é:
 *
 *   diasFila = ceil(filaAtual / capacidadeOsPorDia)
 *   totalDiasUteis = leadTimeBaseDias + diasFila + bufferDias
 *   estimatedDate = hoje + totalDiasUteis dias ÚTEIS (pula sáb/dom —
 *     NÃO existe calendário de feriados configurado no ERP, então
 *     feriados não são descontados; documentado explicitamente, nunca
 *     escondido)
 *
 * Deliberadamente NÃO modela m²/dia (throughput por área): não existe
 * nenhuma medição real de quanto a produção processa por m² no ERP —
 * inventar esse número seria fabricar dado, exatamente o que a auditoria
 * original proibiu. O modelo por CONTAGEM DE OS é o único que usa dados
 * 100% reais (fila atual) + configuração explícita do Master (nunca
 * hardcoded no código).
 */

import * as admin from "firebase-admin";
import { loadErpConfig } from "./pricing";
import type { KbOs } from "./types";

export interface DeadlineEstimate {
  canEstimate: boolean;
  productionDays: number | null;
  estimatedDate: string | null; // ISO yyyy-mm-dd
  confidence: "none" | "low" | "medium" | "high";
  source: string;
  requiresHuman: boolean;
  reason: string;
}

export interface UrgentFitResult {
  feasible: boolean;
  requestedDate: string;
  earliestDate: string | null;
  requiresHuman: boolean;
  reasonCode: string;
}

/** Mesma allowlist de status "ativo" que o Kanban de produção usa (index.html, _OS_ATIVOS_STATUS). */
const OS_STATUS_ATIVOS = new Set(["iniciada", "producao", "master", "em_andamento", "aguard_master", "aguardando_saldo"]);

interface CapacidadeConfigurada {
  leadTimeBaseDias: number;
  capacidadeOsPorDia: number;
  bufferDias: number;
}

/**
 * Fonte de capacidade — só retorna um valor quando o Master configurou
 * EXPLICITAMENTE os 3 campos com valores > 0. Isolado em função própria
 * para que o resto do motor nunca precise saber de onde a config vem.
 */
async function lerCapacidadeConfigurada(): Promise<CapacidadeConfigurada | null> {
  const cfg = await loadErpConfig();
  const p = cfg?.producao;
  if (!p) return null;
  const leadTimeBaseDias = p.leadTimeBaseDias ?? 0;
  const capacidadeOsPorDia = p.capacidadeOsPorDia ?? 0;
  const bufferDias = p.bufferDias ?? 0;
  if (!(leadTimeBaseDias > 0) || !(capacidadeOsPorDia > 0)) return null; // bufferDias pode ser 0 legitimamente
  return { leadTimeBaseDias, capacidadeOsPorDia, bufferDias };
}

/** Contagem real da fila — OS com status ainda ativo em produção. */
async function contarFilaAtual(): Promise<number> {
  const db = admin.firestore();
  const doc = await db.collection("erp_vr").doc("kb_os").get();
  if (!doc.exists) return 0;
  const raw = doc.data()?.data;
  if (!raw) return 0;
  let kbOs: Record<string, KbOs>;
  try { kbOs = JSON.parse(raw); } catch { return 0; }
  return Object.values(kbOs).filter((os) => os.status && OS_STATUS_ATIVOS.has(os.status)).length;
}

/** Soma `dias` dias ÚTEIS (pula sábado/domingo — sem calendário de feriados, ver aviso no topo do arquivo). */
function addBusinessDays(start: Date, dias: number): Date {
  const d = new Date(start.getTime());
  let restantes = Math.round(dias);
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const diaSemana = d.getDay(); // 0=domingo, 6=sábado
    if (diaSemana !== 0 && diaSemana !== 6) restantes--;
  }
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function estimateProductionDeadline(_params: {
  produto: string;
  areaTotalM2?: number;
  quantidade?: number;
}): Promise<DeadlineEstimate> {
  const capacidade = await lerCapacidadeConfigurada();
  if (!capacidade) {
    return {
      canEstimate: false,
      productionDays: null,
      estimatedDate: null,
      confidence: "none",
      source: "sem_capacidade_configurada",
      requiresHuman: true,
      reason:
        "Não existe capacidade de produção configurada no ERP (Config → Produção) — prazo real precisa ser confirmado pela equipe de produção.",
    };
  }

  const filaAtual = await contarFilaAtual();
  const diasFila = Math.ceil(filaAtual / capacidade.capacidadeOsPorDia);
  const totalDiasUteis = capacidade.leadTimeBaseDias + diasFila + capacidade.bufferDias;
  const estimatedDate = addBusinessDays(new Date(), totalDiasUteis);

  return {
    canEstimate: true,
    productionDays: totalDiasUteis,
    estimatedDate: toISODate(estimatedDate),
    // V1 — modelo simples (contagem de OS, não m²/complexidade real por
    // produto): nunca reportar confiança "high"/"medium" até haver
    // validação de que a estimativa bate com a realidade da produção.
    confidence: "low",
    source: "capacidade_configurada_v1",
    requiresHuman: false,
    reason: `Estimativa V1: ${capacidade.leadTimeBaseDias}d base + ${diasFila}d de fila (${filaAtual} OS ativas ÷ ${capacidade.capacidadeOsPorDia}/dia) + ${capacidade.bufferDias}d de buffer, em dias úteis.`,
  };
}

export async function checkUrgentFit(params: {
  produto: string;
  requestedDateISO: string;
  areaTotalM2?: number;
  quantidade?: number;
}): Promise<UrgentFitResult> {
  const estimativa = await estimateProductionDeadline({
    produto: params.produto, areaTotalM2: params.areaTotalM2, quantidade: params.quantidade,
  });
  if (!estimativa.canEstimate || !estimativa.estimatedDate) {
    return {
      feasible: false,
      requestedDate: params.requestedDateISO,
      earliestDate: null,
      requiresHuman: true,
      reasonCode: "PRODUCTION_EXCEPTION",
    };
  }

  const requested = new Date(params.requestedDateISO + "T00:00:00Z");
  const earliest = new Date(estimativa.estimatedDate + "T00:00:00Z");
  const feasible = requested.getTime() >= earliest.getTime();

  return {
    feasible,
    requestedDate: params.requestedDateISO,
    earliestDate: estimativa.estimatedDate,
    // V1 é uma estimativa de baixa confiança (ver estimateProductionDeadline)
    // — mesmo quando cabe no prazo, uma confirmação humana ainda é
    // recomendada antes de prometer ao cliente; só marca infeasible como
    // bloqueio automático, feasible ainda passa por humano.
    requiresHuman: true,
    reasonCode: feasible ? "COMMERCIAL_AUTHORIZATION_REQUIRED" : "PRODUCTION_EXCEPTION",
  };
}
