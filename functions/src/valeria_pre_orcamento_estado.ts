/**
 * valeria_pre_orcamento_estado.ts — Etapa 9I (2026-10-27).
 *
 * MÓDULO ISOLADO, NÃO REGISTRADO em `index.ts` (mesma decisão desta etapa
 * — ver valeria_pre_orcamento_identidade.ts).
 *
 * Camada de LEITURA agregada — nunca um terceiro motor de orçamento.
 * Só lê (nunca escreve) os dois sistemas reais já existentes:
 *   - `vitre_orcamentos` (mesma coleção de valeria_vitre.ts — rascunho
 *     "pronto"; campo `origem` distingue produção: "valeria"/"valeria_v2").
 *   - `erp_vr/orcamentos` (array kv_store, mesmo doc que valeria.ts lê/
 *     escreve; achado desta etapa, confirmado em index.html:30973-30987 —
 *     orçamentos reais criados pelo motor novo da Valéria
 *     (functions-valeria/quote_core.ts, produção, NUNCA tocado aqui) já
 *     usam campos próprios `n`/`nomeCliente`/`telCliente`/`total`,
 *     diferentes do schema legado `num`/`cliente`/`valorFinal` — é essa a
 *     mesma heurística usada aqui para reconhecer um item de origem
 *     Valéria dentro do array, sem reescrever nada).
 * Combina com o lock de `valeria_pre_orcamento_revisao.ts` para dar ao
 * vendedor uma visão única por atendimento.
 */
import * as admin from "firebase-admin";
import { consultarRevisaoCore, type RevisaoPreOrcamentoDoc } from "./valeria_pre_orcamento_revisao";

const COL = "erp_vr";
const COL_VITRE_ORC = "vitre_orcamentos";

interface OrcamentoEnviadoLike {
  id?: string;
  n?: number | string;
  nomeCliente?: string;
  telCliente?: string;
  total?: number | string;
  status?: string;
  conversationId?: string;
  atendimentoId?: string;
  marca?: string;
  [key: string]: unknown;
}

export interface EstadoRevisaoAgregado {
  atendimentoId: string;
  revisao: RevisaoPreOrcamentoDoc;
  itensVitre: Array<{ id: string; status: string; total: number | null; origem: string | null }>;
  itensPersonalizados: Array<{ id: string | null; status: string | null; total: number | string | null; nomeCliente: string | null }>;
}

async function fsReadOrcamentos(): Promise<OrcamentoEnviadoLike[]> {
  const doc = await admin.firestore().collection(COL).doc("orcamentos").get();
  if (!doc.exists) return [];
  const raw = doc.data()?.data;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OrcamentoEnviadoLike[]) : [];
  } catch {
    return [];
  }
}

/** Heurística documentada acima — nunca inventa um campo que o registro não tem. */
function pareceOrigemValeria(o: OrcamentoEnviadoLike): boolean {
  return typeof o.n !== "undefined" || typeof o.nomeCliente !== "undefined";
}

function matchAtendimento(o: OrcamentoEnviadoLike, atendimentoId: string): boolean {
  return o.conversationId === atendimentoId || o.atendimentoId === atendimentoId;
}

export async function consultarEstadoRevisaoCore(atendimentoId: string): Promise<EstadoRevisaoAgregado> {
  const db = admin.firestore();
  const [revisao, vitreSnap, orcamentos] = await Promise.all([
    consultarRevisaoCore(atendimentoId),
    db.collection(COL_VITRE_ORC).where("conversationId", "==", atendimentoId).get(),
    fsReadOrcamentos(),
  ]);

  const itensVitre = vitreSnap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, status: String(data.status ?? "—"), total: typeof data.total === "number" ? data.total : null, origem: (data.origem as string) ?? null };
  });

  const itensPersonalizados = orcamentos
    .filter((o) => matchAtendimento(o, atendimentoId) && pareceOrigemValeria(o))
    .map((o) => ({ id: o.id ?? null, status: o.status ?? null, total: o.total ?? null, nomeCliente: o.nomeCliente ?? null }));

  return { atendimentoId, revisao, itensVitre, itensPersonalizados };
}

// ── Wrapper HTTP (Bearer) — NÃO exportado em index.ts nesta etapa.
import * as functions from "firebase-functions";

export const valeriaConsultarEstadoRevisao = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  const { checkAuth } = await import("./valeria");
  if (!await checkAuth(req, res)) return;
  if (req.method !== "GET") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }
  const atendimentoId = String(req.query.atendimentoId || "").trim();
  if (!atendimentoId) { res.status(400).json({ ok: false, error: "atendimentoId obrigatório" }); return; }
  const estado = await consultarEstadoRevisaoCore(atendimentoId);
  res.json({ ok: true, ...estado });
});
