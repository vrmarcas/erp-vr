/**
 * kv_store.ts — leitura/escrita do padrão chave-valor JSON-stringificado em
 * `erp_vr/{key}.data`, usado pelo restante do ERP (clientes, orcamentos,
 * crm_leads, erp_config, etc.). Extraído de valeria.ts (sprint P0.6) para
 * ser compartilhado por action_executor.ts sem duplicar o acesso a
 * Firestore nem criar dependência circular com valeria.ts.
 */
import * as admin from "firebase-admin";

export const KV_COL = "erp_vr";

export async function fsRead<T>(key: string): Promise<T | null> {
  const db  = admin.firestore();
  const doc = await db.collection(KV_COL).doc(key).get();
  if (!doc.exists) return null;
  const raw = doc.data()?.data;
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function fsWrite(key: string, data: unknown): Promise<void> {
  const db = admin.firestore();
  await db.collection(KV_COL).doc(key).set({
    data: JSON.stringify(data),
    ts: Date.now(),
  });
}
