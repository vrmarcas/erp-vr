/**
 * valeria_pre_orcamento_revisao.ts — Etapa 9I (2026-10-27).
 *
 * MÓDULO ISOLADO, NÃO REGISTRADO em `index.ts` (ver nota de topo de
 * valeria_pre_orcamento_identidade.ts — mesma decisão desta etapa).
 *
 * Camada de REVISÃO/LOCK por atendimento, em coleção nova e isolada
 * (`valeria_pre_orcamentos_revisao`) — nunca escreve em
 * `vitre_orcamentos`/`erp_vr/orcamentos` (os dois motores reais
 * permanecem intocados, seção 3/6 do pedido). Serve só para responder,
 * de forma server-side e transacional: "um vendedor já assumiu este
 * atendimento? a Valéria ainda pode atualizar?".
 *
 * Papel exigido para assumir/concluir: "comercial" (mesmo padrão de
 * `atdVincularCliente`, atendimentos.ts:1148) via `auth_helper.ts`
 * (`getCallerVerificado`/`requireRole`) — nunca presume role do payload.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { getCallerVerificado, requireRole } from "./auth_helper";

const REVISAO_COL = "valeria_pre_orcamentos_revisao";

export type StatusRevisaoPreOrcamento = "AGUARDANDO_REVISAO" | "EM_REVISAO" | "REVISADO";

export interface RevisaoPreOrcamentoDoc {
  atendimentoId: string;
  status: StatusRevisaoPreOrcamento;
  assumidoPorUid: string | null;
  assumidoEm: number | null;
  revisadoEm: number | null;
  pendenciaPosRevisao: boolean;
  versao: number;
  updatedAt: number;
}

export class RevisaoConcluidaError extends Error {
  constructor(atendimentoId: string) {
    super(`PENDING_HUMAN_REVIEW: atendimento ${atendimentoId} já foi revisado por um humano — a Valéria não pode mais escrever aqui.`);
    this.name = "RevisaoConcluidaError";
  }
}

export class RevisaoJaAssumidaError extends Error {
  constructor(atendimentoId: string, porUid: string) {
    super(`ALREADY_CLAIMED: atendimento ${atendimentoId} já foi assumido por ${porUid}.`);
    this.name = "RevisaoJaAssumidaError";
  }
}

function docRef(atendimentoId: string) {
  return admin.firestore().collection(REVISAO_COL).doc(atendimentoId);
}

async function ensureRevisaoDoc(atendimentoId: string): Promise<RevisaoPreOrcamentoDoc> {
  const ref = docRef(atendimentoId);
  const snap = await ref.get();
  if (snap.exists) return snap.data() as RevisaoPreOrcamentoDoc;
  const novo: RevisaoPreOrcamentoDoc = {
    atendimentoId, status: "AGUARDANDO_REVISAO", assumidoPorUid: null, assumidoEm: null,
    revisadoEm: null, pendenciaPosRevisao: false, versao: 0, updatedAt: Date.now(),
  };
  await ref.set(novo);
  return novo;
}

/**
 * Chamado pelo lado da Valéria ANTES de qualquer atualização de rascunho
 * (seção 6 do pedido: "depois que um vendedor assume a revisão, a Valéria
 * não pode sobrescrever"). Lança `RevisaoConcluidaError` se já concluído;
 * senão incrementa a versão (nunca falha por já estar EM_REVISAO — a
 * Valéria ainda pode atualizar enquanto o vendedor só "assumiu" mas não
 * "concluiu").
 */
export async function assertValeriaPodeEscrever(atendimentoId: string): Promise<number> {
  const ref = docRef(atendimentoId);
  // Lançar DENTRO de um runTransaction aborta a transação inteira — a
  // gravação de pendenciaPosRevisao:true nunca seria persistida (achado
  // real desta etapa, ver script de verificação). Por isso a transação só
  // RETORNA um sinal; o throw acontece DEPOIS que ela já confirmou.
  const resultado = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual: RevisaoPreOrcamentoDoc = snap.exists
      ? (snap.data() as RevisaoPreOrcamentoDoc)
      : { atendimentoId, status: "AGUARDANDO_REVISAO", assumidoPorUid: null, assumidoEm: null, revisadoEm: null, pendenciaPosRevisao: false, versao: 0, updatedAt: Date.now() };
    if (atual.status === "REVISADO") {
      // Mudança do cliente depois da revisão: nunca atualização silenciosa —
      // sinaliza pendência para o vendedor, mas não permite a escrita.
      tx.set(ref, { ...atual, pendenciaPosRevisao: true, updatedAt: Date.now() });
      return { bloqueado: true as const };
    }
    const proxima = { ...atual, versao: atual.versao + 1, updatedAt: Date.now() };
    tx.set(ref, proxima);
    return { bloqueado: false as const, versao: proxima.versao };
  });
  if (resultado.bloqueado) throw new RevisaoConcluidaError(atendimentoId);
  return resultado.versao;
}

export async function assumirRevisaoCore(atendimentoId: string, uid: string): Promise<RevisaoPreOrcamentoDoc> {
  const ref = docRef(atendimentoId);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Nunca chamar ensureRevisaoDoc (faz get+set FORA desta transação) aqui
    // dentro — escrever no mesmo doc por um caminho não-transacional
    // enquanto uma transação está aberta sobre ele invalida a transação
    // ("Transaction is invalid or closed", achado real desta etapa, ver
    // script de verificação). O default inline é só leitura em memória.
    const atual: RevisaoPreOrcamentoDoc = snap.exists
      ? (snap.data() as RevisaoPreOrcamentoDoc)
      : { atendimentoId, status: "AGUARDANDO_REVISAO", assumidoPorUid: null, assumidoEm: null, revisadoEm: null, pendenciaPosRevisao: false, versao: 0, updatedAt: Date.now() };
    if (atual.status === "EM_REVISAO" && atual.assumidoPorUid && atual.assumidoPorUid !== uid) {
      throw new RevisaoJaAssumidaError(atendimentoId, atual.assumidoPorUid);
    }
    if (atual.status === "REVISADO") throw new RevisaoConcluidaError(atendimentoId);
    const proxima: RevisaoPreOrcamentoDoc = {
      ...atual, status: "EM_REVISAO", assumidoPorUid: uid, assumidoEm: Date.now(),
      versao: atual.versao + 1, updatedAt: Date.now(),
    };
    tx.set(ref, proxima);
    return proxima;
  });
}

export async function concluirRevisaoCore(atendimentoId: string, uid: string): Promise<RevisaoPreOrcamentoDoc> {
  const ref = docRef(atendimentoId);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("NAO_ASSUMIDO: não é possível concluir uma revisão que nunca foi assumida.");
    const atual = snap.data() as RevisaoPreOrcamentoDoc;
    if (atual.status !== "EM_REVISAO" || atual.assumidoPorUid !== uid) {
      throw new Error("NAO_ASSUMIDO_POR_VOCE: só quem assumiu a revisão pode concluí-la.");
    }
    const proxima: RevisaoPreOrcamentoDoc = { ...atual, status: "REVISADO", revisadoEm: Date.now(), versao: atual.versao + 1, updatedAt: Date.now() };
    tx.set(ref, proxima);
    return proxima;
  });
}

export async function consultarRevisaoCore(atendimentoId: string): Promise<RevisaoPreOrcamentoDoc> {
  return ensureRevisaoDoc(atendimentoId);
}

// Etapa 9L — achado real (ligação com Functions Emulator de verdade pela
// primeira vez nesta etapa): RevisaoJaAssumidaError/RevisaoConcluidaError
// são Error puros (não HttpsError) — o onCall do SDK mascarava os dois
// como "INTERNAL" genérico para o cliente, escondendo o motivo real
// ("já assumido por outro vendedor" vs "já revisado"). Nunca vaza detalhe
// interno — só a mensagem já pensada para o vendedor em cada classe.
function paraHttpsError(e: unknown): functions.https.HttpsError {
  if (e instanceof functions.https.HttpsError) return e;
  if (e instanceof RevisaoJaAssumidaError) return new functions.https.HttpsError("already-exists", e.message);
  if (e instanceof RevisaoConcluidaError) return new functions.https.HttpsError("failed-precondition", e.message);
  if (e instanceof Error && e.message.startsWith("NAO_ASSUMIDO")) return new functions.https.HttpsError("failed-precondition", e.message);
  return new functions.https.HttpsError("internal", e instanceof Error ? e.message : "Erro desconhecido");
}

// ── Wrappers onCall (Firebase Auth real, role "comercial") — NÃO exportados
// em index.ts nesta etapa.
export const vendedorAssumirRevisaoPreOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "assumir revisão de pré-orçamento");
  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório");
  try {
    const doc = await assumirRevisaoCore(atendimentoId, caller.uid);
    return { ok: true, revisao: doc };
  } catch (e) {
    throw paraHttpsError(e);
  }
});

export const vendedorConcluirRevisaoPreOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "concluir revisão de pré-orçamento");
  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório");
  try {
    const doc = await concluirRevisaoCore(atendimentoId, caller.uid);
    return { ok: true, revisao: doc };
  } catch (e) {
    throw paraHttpsError(e);
  }
});
