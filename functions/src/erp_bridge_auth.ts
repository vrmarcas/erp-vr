/**
 * erp_bridge_auth.ts — rodada "fechamento da publicação controlada"
 * (2026-10-28).
 *
 * Autenticação DEDICADA para a ponte Central→ERP (meta-cloud-api-fase2,
 * worktree separado) — nunca reutiliza `erp_vr/valeria_config.secret`
 * (o Bearer administrativo único que hoje abre TODOS os endpoints
 * Valéria em produção, incluindo `valeriaCalcularOrcamento`,
 * `valeriaVitreAtualizarRascunho`, etc.). Mesmo padrão kv_store de
 * `valeria.ts::checkAuth` (Firestore em vez de Secret Manager, para não
 * depender de infraestrutura nova só para ler um valor) — só a CHAVE do
 * documento muda.
 *
 * Documento: `erp_vr/erp_bridge_config { data: JSON.stringify({secret:"..."}) }`
 * — AUSENTE hoje em produção (nunca criado, nunca lido nesta rodada além
 * de checar existência — nenhum valor exposto). Preparar/criar esse
 * documento com um valor novo é passo de infraestrutura, fora desta
 * mudança de código (ver procedimento no relatório).
 *
 * DUAS FUNÇÕES, ESCOPO DELIBERADAMENTE DIFERENTE:
 *  - `checkBridgeAuth`: exige SÓ o secret da ponte. Usada pelos 3
 *    endpoints CRIADOS para a ponte (nenhum chamador legado existe —
 *    nunca precisam aceitar o secret administrativo antigo).
 *  - `checkAuthBridgeOrLegacy`: aceita o secret da ponte OU o
 *    administrativo antigo. Usada SÓ nos 2 endpoints Vitre
 *    JÁ EXISTENTES que a ponte também chama
 *    (`valeriaVitreBuscarCatalogo`/`valeriaVitreCriarRascunho`) — para
 *    nunca quebrar quem já os chama hoje com o secret antigo (Chatvolt),
 *    enquanto a ponte passa a usar o novo. Os OUTROS 6 endpoints Vitre
 *    (`valeriaVitreConsultarProduto`/`AtualizarRascunho`/
 *    `ConsultarRascunho`/`EncaminharVR`/`SimularOrcamento`, e todo o
 *    resto de `valeria.ts`) continuam SÓ com o secret administrativo —
 *    o secret da ponte nunca os abre, mesmo vazado.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const COL = "erp_vr";
const BRIDGE_CONFIG_DOC = "erp_bridge_config";

async function loadBridgeSecret(): Promise<string> {
  const db = admin.firestore();
  const doc = await db.collection(COL).doc(BRIDGE_CONFIG_DOC).get();
  const raw = doc.exists ? doc.data()?.data : null;
  if (!raw) return "";
  try {
    return (JSON.parse(raw) as { secret?: string }).secret || "";
  } catch {
    return "";
  }
}

async function loadLegacySecret(): Promise<string> {
  const db = admin.firestore();
  const doc = await db.collection(COL).doc("valeria_config").get();
  const raw = doc.exists ? doc.data()?.data : null;
  if (!raw) return "";
  try {
    return (JSON.parse(raw) as { secret?: string }).secret || "";
  } catch {
    return "";
  }
}

function extractBearer(req: functions.https.Request): string {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

/** Só os 3 endpoints criados exclusivamente para a ponte — nenhum chamador legado, nunca aceita o secret administrativo antigo. */
export async function checkBridgeAuth(req: functions.https.Request, res: functions.Response): Promise<boolean> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Authorization header ausente" });
    return false;
  }
  const bridgeSecret = await loadBridgeSecret();
  if (!bridgeSecret) {
    res.status(500).json({ ok: false, error: "ERP_BRIDGE_SECRET não configurado. Salve em Firestore: erp_vr/erp_bridge_config { data: JSON.stringify({secret:'SEU_TOKEN'}) }" });
    return false;
  }
  if (token !== bridgeSecret) {
    res.status(401).json({ ok: false, error: "Token inválido" });
    return false;
  }
  return true;
}

/**
 * Transição incremental — SÓ para os 2 endpoints Vitre que a ponte
 * chama. Aceita o secret da ponte OU o administrativo antigo, nunca
 * nenhum terceiro valor. Quando a ponte estiver 100% migrada (todos os
 * consumidores reais usando `erp_bridge_config`), o aceite do secret
 * antigo pode ser removido aqui — decisão futura, fora desta rodada.
 */
export async function checkAuthBridgeOrLegacy(req: functions.https.Request, res: functions.Response): Promise<boolean> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Authorization header ausente" });
    return false;
  }
  const [bridgeSecret, legacySecret] = await Promise.all([loadBridgeSecret(), loadLegacySecret()]);
  if (!bridgeSecret && !legacySecret) {
    res.status(500).json({ ok: false, error: "Nenhum secret configurado (nem erp_bridge_config, nem valeria_config)." });
    return false;
  }
  if (token !== bridgeSecret && token !== legacySecret) {
    res.status(401).json({ ok: false, error: "Token inválido" });
    return false;
  }
  return true;
}
