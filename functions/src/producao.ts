/**
 * producao.ts — fronteira server-side para início/edição de produção
 * (baixa de estoque de uma OS), incluindo a exceção de estoque insuficiente.
 *
 * Achado que motivou este arquivo (auditoria Fase F, 2026-08-05): a decisão
 * "só Master pode autorizar início de produção com estoque insuficiente"
 * vivia inteiramente no cliente (variável _souMaster + confirm() do
 * navegador) — a transação do Firestore só verificava um booleano
 * `prodAutorizado` recebido do próprio cliente, nunca reconferido. Uma conta
 * autenticada como Produção (custom claim real) conseguiu gravar estoque
 * profundamente negativo reproduzindo esse payload diretamente via SDK do
 * Firestore, sem qualquer bloqueio do servidor, sem justificativa, sem
 * auditoria. Reproduzido e documentado em
 * incidente_bypass_autorizacao_estoque_negativo_2026-08-05.json.
 *
 * Este arquivo move a decisão inteira para o servidor: a identidade vem
 * exclusivamente de context.auth (nunca de campos do payload), a role é
 * conferida contra o custom claim E contra erp_vr_usuarios/{uid} (coerência
 * + conta ativa), e a autorização de exceção exige role==='master' E uma
 * justificativa textual mínima — tudo dentro de uma única transação que relê
 * kb_os/stock/retalhos/erp_stock_log do zero.
 *
 * Mantém o modelo de dados existente (documentos agregados erp_vr/kb_os,
 * erp_vr/stock, erp_vr/retalhos, erp_vr/erp_stock_log) — não é uma
 * reescrita para documento-por-registro (isso é o modelo do Compras v2,
 * fora do escopo desta correção pontual de fronteira de autorização).
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { CallerVerificado, getCallerVerificado, requireRole, acquireIdem as acquireIdemShared, writeAudit as writeAuditShared, parseDoc } from "./auth_helper";

const COL = "erp_vr";
const COL_IDEM = "producao_idem_keys";
const COL_AUDIT = "erp_vr_audit_log_producao"; // auditoria dedicada, fora do array legado erp_vr/erp_audit_log (Rules dessa coleção legada exigem leitura Master-only e escrita por qualquer staff — aqui queremos append-only só via Function)

const JUSTIFICATIVA_MIN_LEN = 10;

function acquireIdem(key: string): Promise<boolean> {
  return acquireIdemShared(COL_IDEM, key);
}

function writeAudit(action: string, callerUid: string, callerRole: string, detail: Record<string, unknown>): Promise<void> {
  return writeAuditShared(COL_AUDIT, action, callerUid, callerRole, detail);
}

interface StockItem { label: string; qty: number; cor?: string; esp?: number; min?: number; max?: number; }
interface Retalho { mat: string; dims: string; label: string; codigo?: string; qty: number; }
interface MatProd {
  matKey: string | null; label: string; qty?: number; chapasRetiradas?: number;
  isRetalho: boolean; obs: string; sobra?: number;
  retalhoMat?: string; retalhoDims?: string; retalhoCodigo?: string;
}
interface OS {
  num?: string | number; status?: string; producaoStartId?: string; producaoIniciadaEm?: number;
  inicioProducaoTs?: number; matProd?: MatProd; matProdOrigens?: MatProd[]; orcRef?: string | null;
  [key: string]: unknown;
}
interface Orcamento {
  id?: string; status?: string;
  [key: string]: unknown;
}
interface LogEntry {
  tipo: string; matKey: string; matLabel: string; qty: number; os: unknown; obs: string; dt: string;
  osId: string; orcamentoId: string | null; materialId: string | null; quantidade: number;
  finalidade: string; idempotencyKey: string; ts: number; usuario: string;
  autorizadoPorUid?: string; autorizadoPorRole?: string; justificativa?: string;
}

// RODADA DE CORREÇÃO DEFINITIVA (2026-09-01), Bloco 6 — MVP de multi-
// origem: uma OS pode usar mais de uma origem de material (chapa+chapa,
// chapa+retalho, retalho+retalho, múltiplos materiais/espessuras), cada
// uma com baixa independente. `origens` é o formato novo (array, 1+
// entradas); quando o client não o envia, `tipo/matKey/qty/retalhoCodigo`
// legados são empacotados como uma única origem — MESMO código de
// validação/baixa para os dois casos, nunca uma segunda fórmula.
// `justificativa` continua nível-de-chamada (não por origem): exceção de
// estoque insuficiente em QUALQUER origem exige a mesma justificativa
// única do Master, mesmo padrão já usado antes desta rodada.
interface OrigemInput {
  tipo: "chapa" | "retalho";
  matKey?: string;
  qty?: number;
  retalhoCodigo?: string;
  obs?: string;
}
interface ProducaoInput {
  osId: string;
  editMode: boolean;
  origens: OrigemInput[];
  justificativa?: string;
  requestId: string;
}

function validarOrigem(o: Record<string, unknown>, idx: number): OrigemInput {
  const tipo = o.tipo === "retalho" ? "retalho" : "chapa";
  const obs = typeof o.obs === "string" ? o.obs.slice(0, 500) : "";
  if (tipo === "chapa") {
    const matKey = String(o.matKey || "");
    if (!matKey) throw new functions.https.HttpsError("invalid-argument", `origens[${idx}].matKey obrigatório para tipo chapa.`);
    const qty = Number(o.qty);
    if (!qty || qty <= 0) throw new functions.https.HttpsError("invalid-argument", `origens[${idx}].qty deve ser um número positivo.`);
    return { tipo, matKey, qty, obs };
  }
  const retalhoCodigo = String(o.retalhoCodigo || "");
  if (!retalhoCodigo) throw new functions.https.HttpsError("invalid-argument", `origens[${idx}].retalhoCodigo obrigatório para tipo retalho.`);
  return { tipo, retalhoCodigo, obs };
}

function validarInput(data: unknown): ProducaoInput {
  const d = (data || {}) as Record<string, unknown>;
  const osId = String(d.osId || "");
  if (!osId) throw new functions.https.HttpsError("invalid-argument", "osId obrigatório.");
  const requestId = String(d.requestId || "");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório (idempotência).");
  const editMode = d.editMode === true;
  const justificativa = typeof d.justificativa === "string" ? d.justificativa.trim().slice(0, 1000) : "";

  let origens: OrigemInput[];
  if (Array.isArray(d.origens) && d.origens.length > 0) {
    if (d.origens.length > 20) throw new functions.https.HttpsError("invalid-argument", "Máximo de 20 origens por produção.");
    origens = d.origens.map((o, i) => validarOrigem((o || {}) as Record<string, unknown>, i));
  } else {
    // Formato legado (single-origin) — empacotado como array de 1.
    origens = [validarOrigem(d, 0)];
  }
  return { osId, editMode, origens, justificativa, requestId };
}

function buildLogEntry(
  tipo: string, matKey: string, matLabel: string, qty: number, os: OS, osId: string,
  obsTexto: string, finalidade: string, idemKeyEntry: string, caller: CallerVerificado, justificativa?: string
): LogEntry {
  const now = new Date();
  const dtStr = now.toLocaleDateString("pt-BR") + " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const entry: LogEntry = {
    tipo, matKey: matKey || "", matLabel: matLabel || matKey || "", qty, os: os.num ?? osId, obs: obsTexto || "", dt: dtStr,
    osId, orcamentoId: (os.orcRef as string) || null, materialId: matKey || null, quantidade: qty,
    finalidade, idempotencyKey: idemKeyEntry, ts: Date.now(), usuario: caller.uid,
    autorizadoPorUid: caller.uid, autorizadoPorRole: caller.role,
  };
  if (justificativa) entry.justificativa = justificativa;
  return entry;
}

// ══════════════════════════════════════════════════════════════════════════
// producaoIniciarOuEditar — início OU edição de produção (baixa de estoque
// de uma OS). Master e Produção podem iniciar/editar com estoque
// SUFICIENTE. Estoque INSUFICIENTE só pode ser autorizado por Master, com
// justificativa textual mínima — decisão inteira validada aqui, nunca
// confiando em nada que o cliente afirme sobre si mesmo.
// ══════════════════════════════════════════════════════════════════════════
export const producaoIniciarOuEditar = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["producao"], "iniciar ou editar produção");

  const input = validarInput(data);
  const idemKey = `${input.editMode ? "edicao" : "inicio"}:${input.requestId}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) {
    // Requisição já processada (retry com o mesmo requestId) — não repete a baixa.
    return { ok: true, jaProcessado: true };
  }

  const db = admin.firestore();
  const kbOsRef = db.collection(COL).doc("kb_os");
  const stockRef = db.collection(COL).doc("stock");
  const retRef = db.collection(COL).doc("retalhos");
  const logRef = db.collection(COL).doc("erp_stock_log");
  const orcRef = db.collection(COL).doc("orcamentos");
  const osProducaoIdemKey = "producao_inicio:" + input.osId; // mesma chave de negócio usada pelo legado (producaoStartId da OS)

  try {
    const resultado = await db.runTransaction(async (tx) => {
      const [snapOs, snapStock, snapRet, snapLog, snapOrc] = await Promise.all([
        tx.get(kbOsRef), tx.get(stockRef), tx.get(retRef), tx.get(logRef), tx.get(orcRef),
      ]);
      const objOS = parseDoc<Record<string, OS>>(snapOs, {});
      const sd = parseDoc<Record<string, StockItem>>(snapStock, {});
      const retList = parseDoc<Retalho[]>(snapRet, []);
      let log = parseDoc<LogEntry[]>(snapLog, []);
      const orcList = parseDoc<Orcamento[]>(snapOrc, []);

      const osFresh = objOS[input.osId];
      if (!osFresh) throw new functions.https.HttpsError("not-found", "OS_NAO_ENCONTRADA");

      if (!input.editMode) {
        if (["pronta", "entregue", "cancelado"].indexOf(osFresh.status || "") >= 0) {
          throw new functions.https.HttpsError("failed-precondition", "OS_STATUS_INVALIDO:" + osFresh.status);
        }
        if (osFresh.producaoStartId || osFresh.matProd) {
          throw new functions.https.HttpsError("already-exists", "PRODUCAO_JA_INICIADA");
        }
      } else {
        if (["pronta", "entregue", "cancelado"].indexOf(osFresh.status || "") >= 0) {
          throw new functions.https.HttpsError("failed-precondition", "OS_STATUS_INVALIDO:" + osFresh.status);
        }
        if (!osFresh.matProd) throw new functions.https.HttpsError("failed-precondition", "EDICAO_SEM_PRODUCAO_INICIADA");
      }

      const logEntries: LogEntry[] = [];
      let retListMutada = false;

      // Edição: restaura a(s) baixa(s) anterior(es) antes de aplicar a(s)
      // nova(s). RODADA DE CORREÇÃO DEFINITIVA (2026-09-01), Bloco 6 —
      // matProdOrigens (novo, array completo) é a fonte preferida; matProd
      // sozinho (formato legado, produção iniciada antes desta rodada)
      // cobre só a origem única — nunca reverte as duas ao mesmo tempo.
      if (input.editMode) {
        const anteriores: MatProd[] = (osFresh.matProdOrigens && osFresh.matProdOrigens.length)
          ? osFresh.matProdOrigens
          : (osFresh.matProd ? [osFresh.matProd] : []);
        anteriores.forEach((mp, ai) => {
          if (mp.isRetalho) {
            if (!mp.retalhoMat && !mp.retalhoCodigo) {
              throw new functions.https.HttpsError("failed-precondition", "EDICAO_RETALHO_LEGADO_SEM_MARCA");
            }
            const oldIdx = retList.findIndex((r) =>
              mp.retalhoCodigo ? r.codigo === mp.retalhoCodigo : (r.mat === mp.retalhoMat && r.dims === mp.retalhoDims)
            );
            if (oldIdx >= 0) { retList[oldIdx].qty = (retList[oldIdx].qty || 0) + 1; retListMutada = true; }
          } else if (mp.matKey && sd[mp.matKey]) {
            const prevChapas = mp.chapasRetiradas || mp.qty || 1;
            sd[mp.matKey].qty = (sd[mp.matKey].qty || 0) + prevChapas;
            logEntries.push(buildLogEntry(
              "entrada", mp.matKey, sd[mp.matKey].label, prevChapas, osFresh, input.osId,
              "Correção — material trocado na OS", "edicao_producao_estorno",
              `producao_edicao_estorno:${input.osId}:${Date.now()}:${ai}`, caller
            ));
          }
        });
      }

      // RODADA DE CORREÇÃO DEFINITIVA (2026-09-01), Bloco 6 — multi-origem:
      // processa CADA origem em sequência, na MESMA transação (mutações em
      // `sd`/`retList` acumulam entre origens — duas origens da mesma
      // chapa descontam corretamente as duas). Cada origem gera sua PRÓPRIA
      // entrada em erp_stock_log, com idempotencyKey própria (sufixo :oi) —
      // nunca uma baixa "combinada" ilegível. `justificativa` continua
      // nível-de-chamada: qualquer origem com estoque insuficiente exige a
      // MESMA justificativa única do Master (nunca uma por origem).
      const matProdEntries: MatProd[] = [];
      const excecoesOrigem: Array<{ matKey: string; saldoAntes: number; chapasRetirar: number }> = [];
      let justificativaUsadaGlobal: string | undefined;

      for (let oi = 0; oi < input.origens.length; oi++) {
        const origem = input.origens[oi];
        // Formato da chave preservado EXATAMENTE igual ao de antes desta
        // rodada para o caso comum (1 única origem) — sufixo ":oi" só
        // aparece quando há multi-origem de verdade, nunca muda a chave de
        // negócio já usada por auditoria/relatórios existentes.
        const movIdemKey = input.origens.length > 1
          ? (input.editMode ? `producao_edicao:${input.osId}:${Date.now()}:${oi}` : `${osProducaoIdemKey}:${oi}`)
          : (input.editMode ? `producao_edicao:${input.osId}:${Date.now()}` : osProducaoIdemKey);

        if (origem.tipo === "retalho") {
          const idx = retList.findIndex((r) => r.codigo === origem.retalhoCodigo);
          if (idx < 0 || !retList[idx] || (retList[idx].qty || 0) <= 0) {
            throw new functions.https.HttpsError("failed-precondition", `RETALHO_INDISPONIVEL:${origem.retalhoCodigo}`);
          }
          retList[idx].qty -= 1;
          retListMutada = true;
          const r = retList[idx];
          matProdEntries.push({ matKey: null, label: r.label + " " + r.dims, isRetalho: true, retalhoMat: r.mat, retalhoDims: r.dims, retalhoCodigo: r.codigo || "", obs: origem.obs || "" });
          logEntries.push(buildLogEntry(
            "retalho-saida", r.mat, r.label + " " + r.dims + " cm", 1, osFresh, input.osId,
            r.codigo ? "Cód: " + r.codigo : "", input.editMode ? "edicao_producao" : "inicio_producao",
            movIdemKey, caller
          ));
        } else {
          const mk = origem.matKey as string;
          const qty = origem.qty as number;
          if (!sd[mk]) throw new functions.https.HttpsError("failed-precondition", `Material não encontrado no estoque: ${mk}`);
          const chapasRetirar = Math.ceil(qty);
          const saldoAtual = sd[mk].qty || 0;
          const estoqueSuficiente = saldoAtual >= chapasRetirar;

          let justificativaUsada: string | undefined;
          if (!estoqueSuficiente) {
            // ── A FRONTEIRA: nenhum campo do cliente decide isto. Só a role
            // verificada no servidor + uma justificativa textual real. ──
            if (caller.role !== "master") {
              throw new functions.https.HttpsError(
                "permission-denied",
                `ESTOQUE_INSUFICIENTE: faltam ${(chapasRetirar - saldoAtual).toFixed(2)} chapa(s) de ${sd[mk].label}. Somente Master pode autorizar produção com estoque insuficiente.`
              );
            }
            if (!input.justificativa || input.justificativa.length < JUSTIFICATIVA_MIN_LEN) {
              throw new functions.https.HttpsError(
                "invalid-argument",
                `JUSTIFICATIVA_OBRIGATORIA: autorizar estoque insuficiente exige justificativa com pelo menos ${JUSTIFICATIVA_MIN_LEN} caracteres.`
              );
            }
            justificativaUsada = input.justificativa;
            justificativaUsadaGlobal = input.justificativa;
            excecoesOrigem.push({ matKey: mk, saldoAntes: saldoAtual, chapasRetirar });
          }

          sd[mk].qty = saldoAtual - chapasRetirar;
          const sobra = +(chapasRetirar - qty).toFixed(4);
          matProdEntries.push({
            matKey: mk, label: sd[mk].label + (sd[mk].cor ? " " + sd[mk].cor : "") + (sd[mk].esp ? " — " + sd[mk].esp + "mm" : ""),
            qty, chapasRetiradas: chapasRetirar, isRetalho: false, obs: origem.obs || "",
            sobra: sobra > 0.01 ? sobra : 0,
          });
          const obsLog = "Produção OS #" + (osFresh.num ?? input.osId) + (origem.obs ? " · " + origem.obs : "") +
            (sobra > 0.01 ? " (sobra " + sobra.toFixed(2) + " chapa)" : "") +
            (justificativaUsada ? " · EXCEÇÃO autorizada por Master: " + justificativaUsada : "");
          logEntries.push(buildLogEntry(
            "saida", mk, sd[mk].label, chapasRetirar, osFresh, input.osId, obsLog,
            input.editMode ? "edicao_producao" : "inicio_producao",
            movIdemKey, caller, justificativaUsada
          ));
        }
      }

      if (justificativaUsadaGlobal) {
        await writeAudit("producao_autorizada_estoque_insuficiente", caller.uid, caller.role, {
          osId: input.osId, osNum: osFresh.num, justificativa: justificativaUsadaGlobal, editMode: input.editMode,
          origensCount: input.origens.length, excecoes: excecoesOrigem,
        });
      }

      // matProd (legado, objeto único) preserva a 1ª origem para
      // compatibilidade com telas/relatórios ainda não atualizados para
      // multi-origem; matProdOrigens (novo, array completo) é a fonte de
      // verdade para qualquer tela que precise de TODAS as origens.
      osFresh.matProd = matProdEntries[0];
      osFresh.matProdOrigens = matProdEntries;
      let orcListMutada = false;
      if (!input.editMode) {
        osFresh.status = "producao";
        osFresh.producaoStartId = osProducaoIdemKey;
        osFresh.producaoIniciadaEm = Date.now();
        if (!osFresh.inicioProducaoTs) osFresh.inicioProducaoTs = osFresh.producaoIniciadaEm;

        // GO-LIVE FINAL 2026-08-12 (gate 1) — bug real: esta Function iniciava
        // a produção (baixa de estoque + status da OS) mas nunca sincronizava
        // o orçamento vinculado — só o caminho de RETOMADA no frontend
        // (kbIniciarProd, quando producaoStartId já existe) chamava
        // orcEnvSetStatus. No 1º "Iniciar Produção" real (que sempre passa
        // por aqui, nunca pelo caminho de retomada), o orçamento ficava
        // parado em "Enviado para Produção" mesmo com a OS já em produção.
        // Corrigido: mesma transação, mesmo requestId/idempotência de cima —
        // se a OS tem orcRef e o orçamento existe, avança para 'em_producao'
        // (mesmo valor de enum já usado pelo caminho de retomada — fonte
        // única ORC_STATUS_LABEL no frontend). Nunca grava nada financeiro
        // aqui — só o campo `status`, nunca toca valorFinal/entrada/saldo/
        // fin_cr/fin_tx. Se o orçamento não existir mais (dado órfão), segue
        // sem erro — sincronizar o rótulo nunca pode bloquear a produção.
        if (osFresh.orcRef) {
          const orcIdx = orcList.findIndex((o) => o.id === osFresh.orcRef);
          if (orcIdx >= 0 && orcList[orcIdx].status !== "em_producao") {
            orcList[orcIdx].status = "em_producao";
            orcListMutada = true;
          }
        }
      } else if (!osFresh.producaoStartId) {
        osFresh.producaoStartId = osProducaoIdemKey;
      }
      objOS[input.osId] = osFresh;

      log = logEntries.concat(log);
      if (log.length > 200) log.length = 200;

      tx.set(kbOsRef, { data: JSON.stringify(objOS), ts: Date.now() });
      tx.set(stockRef, { data: JSON.stringify(sd), ts: Date.now() });
      tx.set(logRef, { data: JSON.stringify(log), ts: Date.now() });
      if (retListMutada) tx.set(retRef, { data: JSON.stringify(retList), ts: Date.now() });
      if (orcListMutada) tx.set(orcRef, { data: JSON.stringify(orcList), ts: Date.now() });

      return { osFresh, matProd: matProdEntries[0], matProdOrigens: matProdEntries };
    });

    await writeAudit(input.editMode ? "producao_editada" : "producao_iniciada", caller.uid, caller.role, {
      osId: input.osId, osNum: resultado.osFresh.num, matProd: resultado.matProd, origensCount: resultado.matProdOrigens.length,
    });

    return { ok: true, jaProcessado: false, matProd: resultado.matProd, matProdOrigens: resultado.matProdOrigens, osStatus: resultado.osFresh.status };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    functions.logger.error("[producao] erro inesperado:", e);
    throw new functions.https.HttpsError("internal", "Erro ao processar produção.");
  }
});
