/**
 * valeria_pre_orcamento_personalizado.ts — Ponte Central↔ERP (2026-10-28).
 *
 * MÓDULO ISOLADO. Registrado em index.ts nesta rodada (preparação de
 * lançamento) — nunca antes exposto como API HTTP. Até aqui, a criação
 * de um pré-orçamento personalizado só acontecia DENTRO do pacote real
 * `functions-valeria` (action_executor.ts/quote_core.ts, NUNCA tocado
 * aqui), acionado pelo webhook do Chatvolt — nunca existiu um caminho
 * HTTP genérico para OUTRO serviço (a Central isolada, projeto Firebase
 * diferente) persistir um pré-orçamento já calculado no ERP real.
 *
 * NUNCA calcula preço, material, prazo ou qualquer regra comercial —
 * só recebe um payload JÁ VALIDADO pelo chamador (a Central roda sua
 * própria cópia testada do motor de preço, Etapa 9H/9H-H) e persiste no
 * MESMO documento real que o motor de produção usa (`erp_vr/orcamentos`,
 * mesmos nomes de campo — n/nomeCliente/telCliente/total/itens[] —
 * confirmados por auditoria de `index.html::orcEnvNormalizar`/
 * `orcEnvAbrir`, nunca um terceiro motor/formato).
 *
 * Mesma trava de revisão humana do resto deste conjunto de módulos
 * (Etapas 9I-9N): toda escrita passa por `assertValeriaPodeEscrever`
 * (valeria_pre_orcamento_revisao.ts) — nunca sobrescreve um registro já
 * marcado REVISADO pelo vendedor.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { acquireIdem } from "./auth_helper";
import { assertValeriaPodeEscrever } from "./valeria_pre_orcamento_revisao";

const COL = "erp_vr";
const ORC_DOC = "orcamentos";
const COL_IDEM = "valeria_pre_orcamento_personalizado_idem_keys";

interface ItemPersonalizadoInput {
  categoriaComercial: "caixa" | "placa" | "trofeu";
  descricaoProduto?: string;
  materialValidado?: string | null;
  espessuraMm?: number | null;
  larguraMm?: number | null;
  alturaMm?: number | null;
  profundidadeMm?: number | null;
  quantidade: number;
  precoUnitario: number;
  totalItem: number;
  solicitacoesEspeciais?: string[];
}

interface CriarRascunhoPersonalizadoInput {
  conversationId: string;
  organizationId: string;
  clienteNome: string;
  clienteTel: string;
  clienteEmail?: string | null;
  clienteProvisorioId?: string | null;
  clienteOficialId?: string | null;
  itens: ItemPersonalizadoInput[];
  total: number;
  pendencias?: string[];
  naoValidados?: string[];
  requestId: string;
}

interface OrcamentoPersonalizadoRegistro {
  id: string; n: number; requestId: string; tipo: "personalizado_valeria"; marca: "vr";
  status: "pre_orc_valeria"; nomeCliente: string; telCliente: string; emailCliente: string | null;
  clienteProvisorioId: string | null; clienteOficialId: string | null;
  itens: Array<{ prod: string; qty: number; larg: number | null; alt: number | null; planProf: number | null; mat: string | null; total: number }>;
  total: number; pendencias: string[]; naoValidados: string[]; origem: "valeria";
  conversationId: string; organizationId: string; criadoEm: number;
}

async function fsReadOrcamentos(): Promise<any[]> {
  const d = await admin.firestore().collection(COL).doc(ORC_DOC).get();
  if (!d.exists) return [];
  try { return JSON.parse(d.data()!.data); } catch { return []; }
}
async function fsWriteOrcamentos(arr: unknown[]): Promise<void> {
  await admin.firestore().collection(COL).doc(ORC_DOC).set({ data: JSON.stringify(arr), ts: Date.now() });
}

/**
 * Único ponto de criação de um pré-orçamento personalizado vindo da
 * Central. Idempotente por requestId (mesmo padrão de
 * valeriaVitreCriarRascunho). Nunca escreve se o lock de revisão já
 * estiver REVISADO para este atendimento.
 */
export async function criarRascunhoPersonalizadoCore(input: CriarRascunhoPersonalizadoInput): Promise<{ ok: true; jaProcessado: boolean; id: string }> {
  if (!input.conversationId || !input.organizationId) throw new functions.https.HttpsError("invalid-argument", "conversationId e organizationId são obrigatórios (isolamento de conversa).");
  if (!input.requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório (idempotência).");
  if (!input.itens?.length) throw new functions.https.HttpsError("invalid-argument", "ao menos um item é obrigatório.");

  const idemKey = `valeria_pre_orc_pers:${input.conversationId}:${input.requestId}`;
  const acquired = await acquireIdem(COL_IDEM, idemKey);
  if (!acquired) {
    const existentes = await fsReadOrcamentos();
    const jaExiste = existentes.find((o) => o.requestId === input.requestId);
    if (jaExiste) return { ok: true, jaProcessado: true, id: jaExiste.id };
  }

  // Nunca escreve se a revisão humana já foi concluída para este
  // atendimento — mesma trava usada pelos rascunhos Vitre e pela
  // aprovação (Etapas 9I/9L/9M).
  await assertValeriaPodeEscrever(input.conversationId);

  const atual = await fsReadOrcamentos();
  const n = Date.now();
  const id = `pers_${n}`;
  const registro: OrcamentoPersonalizadoRegistro = {
    id, n, requestId: input.requestId, tipo: "personalizado_valeria", marca: "vr", status: "pre_orc_valeria",
    nomeCliente: input.clienteNome, telCliente: input.clienteTel, emailCliente: input.clienteEmail ?? null,
    clienteProvisorioId: input.clienteProvisorioId ?? null, clienteOficialId: input.clienteOficialId ?? null,
    itens: input.itens.map((it) => ({
      prod: it.descricaoProduto || it.categoriaComercial, qty: it.quantidade,
      larg: it.larguraMm != null ? it.larguraMm / 10 : null, alt: it.alturaMm != null ? it.alturaMm / 10 : null,
      planProf: it.profundidadeMm != null ? it.profundidadeMm / 10 : null,
      mat: it.materialValidado ?? null, total: it.totalItem,
    })),
    total: input.total, pendencias: input.pendencias ?? [], naoValidados: input.naoValidados ?? [],
    origem: "valeria", conversationId: input.conversationId, organizationId: input.organizationId, criadoEm: Date.now(),
  };
  atual.push(registro);
  await fsWriteOrcamentos(atual);
  return { ok: true, jaProcessado: false, id };
}

function cors(res: functions.Response) { res.set("Access-Control-Allow-Origin", "*"); }

// ── Wrapper HTTP (Bearer, mesmo padrão de valeria_vitre.ts) — registrado
// em index.ts nesta rodada.
export const valeriaCriarRascunhoPersonalizado = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  const { checkAuth } = await import("./valeria");
  if (!await checkAuth(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }
  try {
    const resultado = await criarRascunhoPersonalizadoCore(req.body as CriarRascunhoPersonalizadoInput);
    res.json(resultado);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    const status = e instanceof functions.https.HttpsError ? 400 : (/PENDING_HUMAN_REVIEW/.test(msg) ? 409 : 500);
    res.status(status).json({ ok: false, error: msg });
  }
});
