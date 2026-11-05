/**
 * erp_orcamento_exclusao_segura.ts — Etapa 9N (2026-10-28), atualizado na
 * RODADA MIGRAÇÃO ORÇAMENTOS v2 (2026-11-04).
 *
 * ACHADO REAL (smoke de produção pós-migração, 2026-11-04): esta Function
 * foi registrada em `index.ts` (commit c2b3bc9) mas DELIBERADAMENTE nunca
 * deployada ("sem deploy", mesmo commit) — e `orcEnvExcluir` (index.html)
 * já chamava `vendedorExcluirOrcamento` incondicionalmente. Resultado real:
 * "Falha ao excluir: internal" — não é um bug de lógica desta função, é a
 * própria Function não existir no projeto (o Functions SDK do client
 * devolve `internal` genérico quando o endpoint não existe). Corrigido
 * fazendo parte do deploy desta rodada (ver DEVELOPMENT.md/relatório).
 *
 * ACHADO SEPARADO, mais sério para a migração: mesmo quando deployada, a
 * lógica original só conhecia `erp_vr/orcamentos` (array legado) — zero
 * conhecimento de `erp_vr_orcamentos/{id}` (fonte de verdade desde a
 * migração client-side). Para qualquer orçamento v2-only (todo orçamento
 * criado depois da migração), `idx<0` devolvia `jaProcessado:true` (um
 * "sucesso" fictício que não excluía NADA de onde importa) — pior que o
 * erro "internal": reportaria sucesso ao vendedor e o orçamento
 * reapareceria na tela no próximo snapshot do listener v2.
 *
 * Agora usa o mesmo padrão já estabelecido em finCr.ts/producao.ts
 * (orcamentos_v2_helper.ts): erp_vr_orcamentos/{id} é a autoridade,
 * excluída DENTRO da transação crítica que decide o resultado; o array
 * legado nunca entra nessa transação (poderia abortar a exclusão real só
 * por estar grande demais) — removido à parte, best-effort, depois que a
 * exclusão v2 confirmar.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { getCallerVerificado, requireRole, parseDoc } from "./auth_helper";
import { COL_ORCAMENTOS_V2, deletarOrcamentoV2, removerOrcamentoDoLegadoEspelho } from "./orcamentos_v2_helper";

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
 * Único ponto de escrita server-side para excluir um orçamento. Bloqueia
 * exclusão quando já existe OS gerada (osRef) ou Conta a Receber associada
 * (crId) — mesmo invariante que `orcEnvReverterParaAguardando` já aplica
 * para reversão de status ("🔒 OS já gerada", index.html). Idempotente:
 * excluir um id que já não existe em nenhuma das duas fontes é sucesso
 * (jaProcessado:true), nunca erro — mesmo princípio de duplo-clique/retry
 * já usado em todo este conjunto de módulos (Etapas 9I-9M).
 */
export async function excluirOrcamentoCore(orcId: string, caller: { uid: string }): Promise<{ ok: true; jaProcessado: boolean }> {
  const db = admin.firestore();
  const refOrcV2 = db.collection(COL_ORCAMENTOS_V2).doc(orcId);
  const refOrcLegado = db.collection(COL).doc(ORC_DOC);

  const resultado = await db.runTransaction(async (tx) => {
    const [snapV2, snapLegado] = await Promise.all([tx.get(refOrcV2), tx.get(refOrcLegado)]);
    const orcV2 = snapV2.exists ? (snapV2.data() as OrcamentoEnviadoLike) : null;
    const arrLegado = parseDoc<OrcamentoEnviadoLike[]>(snapLegado, []);
    const orcLegado = arrLegado.find((o) => o && o.id === orcId) || null;
    const orc = orcV2 || orcLegado;
    if (!orc) return { ok: true as const, jaProcessado: true };

    if (orc.osRef) {
      throw new ExclusaoOrcamentoError("OS_JA_GERADA", `orçamento ${orcId} já tem OS gerada (${orc.osRef}) — exclusão bloqueada, reverteria produção/entrega já iniciada sem deixar rastro.`);
    }
    if (orc.crId) {
      throw new ExclusaoOrcamentoError("PAGAMENTO_JA_REGISTRADO", `orçamento ${orcId} já tem Conta a Receber associada (${orc.crId}) — exclusão bloqueada, apagaria o vínculo com um registro financeiro ativo.`);
    }

    // erp_vr_orcamentos/{id} é a autoridade — excluída AQUI, na mesma
    // transação que decide o resultado. O array legado NUNCA entra nesta
    // transação (ver cabeçalho do arquivo): removido à parte, best-effort.
    if (orcV2) deletarOrcamentoV2(db, tx, orcId);
    return { ok: true as const, jaProcessado: false, existiaNoLegado: !!orcLegado };
  });

  if (!resultado.jaProcessado) {
    if (resultado.existiaNoLegado) await removerOrcamentoDoLegadoEspelho(db, orcId);
    try {
      await db.collection(AUDIT_COL).add({ action: "orcamento_excluido", callerUid: caller.uid, detail: { orcId }, timestamp: Date.now() });
    } catch (e) {
      functions.logger.error("[erp_orcamento_exclusao_segura] falha ao gravar auditoria:", e);
    }
  }
  return { ok: true, jaProcessado: resultado.jaProcessado };
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
