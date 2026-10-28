/**
 * erp_orcamento_exclusao_segura.ts — Etapa 9N (2026-10-28).
 *
 * MÓDULO ISOLADO, NÃO REGISTRADO em `index.ts` (mesma decisão de
 * segurança desde a Etapa 9I).
 *
 * ACHADO DA AUDITORIA DE ESCRITORES (Etapa 9N, seção 1): `orcEnvExcluir`
 * (index.html) remove um orçamento do array `erp_vr/orcamentos` com
 * ZERO verificação — nem de OS já gerada, nem de pagamento já recebido,
 * nem auditoria. Maior risco identificado entre os escritores diretos
 * do documento (pior que o de aprovação: aqui perde-se o registro
 * inteiro, não só o status). Primeira operação migrada para
 * server-side nesta etapa, como prova de conceito do padrão de migração
 * incremental pedido (seção 2: validar auth+role, verificar estado,
 * impedir alteração não autorizada, idempotência, auditoria).
 *
 * Preserva 100% o comportamento para o caso comum (orçamento sem OS,
 * sem pagamento) — nunca bloqueia uma exclusão legítima que já
 * funcionava.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { getCallerVerificado, requireRole, parseDoc } from "./auth_helper";

const COL = "erp_vr";
const ORC_DOC = "orcamentos";
const AUDIT_COL = "erp_vr_audit_log_orcamentos";

interface OrcamentoEnviadoLike {
  id?: string;
  osRef?: string;
  crId?: string;
  status?: string;
  [key: string]: unknown;
}

export class ExclusaoOrcamentoError extends Error {
  constructor(public readonly codigo: string, message: string) {
    super(`${codigo}: ${message}`);
    this.name = "ExclusaoOrcamentoError";
  }
}

/**
 * Único ponto de escrita server-side para excluir um orçamento de
 * `erp_vr/orcamentos`. Bloqueia exclusão quando já existe OS gerada
 * (osRef) ou Conta a Receber associada (crId) — mesmo invariante que
 * `orcEnvReverterParaAguardando` já aplica para reversão de status
 * ("🔒 OS já gerada", index.html), nunca antes aplicado à exclusão.
 * Idempotente: excluir um id que já não existe no array é sucesso
 * (jaProcessado:true), nunca erro — mesmo princípio de duplo-clique/
 * retry já usado em todo este conjunto de módulos (Etapas 9I-9M).
 */
export async function excluirOrcamentoCore(orcId: string, caller: { uid: string }): Promise<{ ok: true; jaProcessado: boolean }> {
  const db = admin.firestore();
  const refOrc = db.collection(COL).doc(ORC_DOC);

  const resultado = await db.runTransaction(async (tx) => {
    const snapOrc = await tx.get(refOrc);
    const arr = parseDoc<OrcamentoEnviadoLike[]>(snapOrc, []);
    const idx = arr.findIndex((o) => o.id === orcId);
    if (idx < 0) return { ok: true as const, jaProcessado: true };

    const orc = arr[idx];
    if (orc.osRef) {
      throw new ExclusaoOrcamentoError("OS_JA_GERADA", `orçamento ${orcId} já tem OS gerada (${orc.osRef}) — exclusão bloqueada, reverteria produção/entrega já iniciada sem deixar rastro.`);
    }
    if (orc.crId) {
      throw new ExclusaoOrcamentoError("PAGAMENTO_JA_REGISTRADO", `orçamento ${orcId} já tem Conta a Receber associada (${orc.crId}) — exclusão bloqueada, apagaria o vínculo com um registro financeiro ativo.`);
    }

    const novoArr = arr.filter((o) => o.id !== orcId);
    tx.set(refOrc, { data: JSON.stringify(novoArr), ts: Date.now() });
    return { ok: true as const, jaProcessado: false };
  });

  if (!resultado.jaProcessado) {
    try {
      await db.collection(AUDIT_COL).add({ action: "orcamento_excluido", callerUid: caller.uid, detail: { orcId }, timestamp: Date.now() });
    } catch (e) {
      functions.logger.error("[erp_orcamento_exclusao_segura] falha ao gravar auditoria:", e);
    }
  }
  return resultado;
}

function paraHttpsError(e: unknown): functions.https.HttpsError {
  if (e instanceof functions.https.HttpsError) return e;
  if (e instanceof ExclusaoOrcamentoError) {
    return new functions.https.HttpsError("failed-precondition", e.message);
  }
  return new functions.https.HttpsError("internal", e instanceof Error ? e.message : "Erro desconhecido");
}

// ── Wrapper onCall (Firebase Auth real, role "comercial") — NÃO
// exportado em index.ts nesta etapa.
export const vendedorExcluirOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "excluir orçamento");
  const orcId = String(data?.orcId || "").trim();
  if (!orcId) throw new functions.https.HttpsError("invalid-argument", "orcId obrigatório");
  try {
    return await excluirOrcamentoCore(orcId, caller);
  } catch (e) {
    throw paraHttpsError(e);
  }
});
