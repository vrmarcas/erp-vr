/**
 * orcamentos_v2_helper.ts — RODADA MIGRAÇÃO ORÇAMENTOS v2 (2026-11-03).
 *
 * erp_vr/orcamentos (array legado, um único documento com TODOS os
 * orçamentos) está permanentemente perto/acima do limite de 1MiB do
 * Firestore (medido em produção, achado real do orçamento #000266/#000268
 * — ver index.html, orcV2SalvarComConflito/orcV2MergeComLegado, mesma
 * migração já feita client-side). Cloud Functions (Admin SDK) ainda liam/
 * escreviam SÓ o array legado, sem nenhum conhecimento de
 * erp_vr_orcamentos/{id} (documento por orçamento, fonte de verdade a
 * partir de agora) — para qualquer orçamento que só existe em v2 (todo
 * orçamento salvo depois da migração client-side), essas funções
 * lançavam "não encontrado" ou simplesmente nunca atualizavam o status.
 *
 * Este módulo é o equivalente server-side do que já existe em index.html:
 *   - lerOrcamentoV2ComFallback() ≈ orcV2MergeComLegado(): tenta
 *     erp_vr_orcamentos/{id} primeiro; só cai para o array legado se o
 *     doc novo não existir (nunca deveria acontecer para nada salvo
 *     depois desta migração, mas nunca presume isso).
 *   - gravarOrcamentoV2() ≈ orcV2SalvarComConflito(): escreve SEMPRE em
 *     erp_vr_orcamentos/{id}, dentro da MESMA transação crítica que
 *     decide o resultado (nunca mais o array legado inteiro dentro dessa
 *     transação — um array grande demais não pode mais abortar fin_cr/
 *     fin_tx/kb_os/estoque junto).
 *   - espelharOrcamentoNoLegado() é o espelho best-effort, SEMPRE fora da
 *     transação crítica, chamado só DEPOIS dela confirmar — sua falha
 *     nunca é propagada ao chamador (mesmo princípio client-side, ver
 *     _orcamentosSalvarComMergeContinuar/orcEnvGerarOS em index.html).
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { parseDoc } from "./auth_helper";

const COL = "erp_vr";
export const COL_ORCAMENTOS_V2 = "erp_vr_orcamentos";

export async function lerOrcamentoV2ComFallback(
  db: admin.firestore.Firestore,
  txn: admin.firestore.Transaction,
  orcId: string
): Promise<Record<string, any> | null> {
  const snapV2 = await txn.get(db.collection(COL_ORCAMENTOS_V2).doc(orcId));
  if (snapV2.exists) return snapV2.data() as Record<string, any>;
  const snapLegado = await txn.get(db.collection(COL).doc("orcamentos"));
  const arrLegado = parseDoc<any[]>(snapLegado, []);
  return arrLegado.find((o) => o && o.id === orcId) || null;
}

export function gravarOrcamentoV2(db: admin.firestore.Firestore, txn: admin.firestore.Transaction, orc: Record<string, any>): void {
  // JSON.parse(JSON.stringify(...)) — mesma sanitização do client
  // (orcV2SalvarComConflito): Firestore nativo rejeita `undefined`, que o
  // array legado tolera porque vai para uma STRING via JSON.stringify.
  txn.set(db.collection(COL_ORCAMENTOS_V2).doc(orc.id), JSON.parse(JSON.stringify(orc)));
}

export async function espelharOrcamentoNoLegado(db: admin.firestore.Firestore, orc: Record<string, any>): Promise<void> {
  try {
    const refOrc = db.collection(COL).doc("orcamentos");
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(refOrc);
      const arr = parseDoc<any[]>(snap, []);
      const idx = arr.findIndex((o) => o && o.id === orc.id);
      if (idx >= 0) arr[idx] = orc; else arr.unshift(orc);
      txn.set(refOrc, { data: JSON.stringify(arr), ts: Date.now() });
    });
  } catch (e) {
    functions.logger.warn("[orcamentos v2] espelho legado não confirmou (não bloqueia — fonte de verdade é erp_vr_orcamentos/{id}):", e);
  }
}
