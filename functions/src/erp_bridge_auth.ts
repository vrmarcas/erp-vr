/**
 * erp_bridge_auth.ts — rodada "fechamento da publicação controlada"
 * (2026-10-28), CORRIGIDO na rodada "ajustes finais" (2026-10-28):
 * trocado de Firestore (`erp_vr/erp_bridge_config`, inconsistente com o
 * pedido de usar Secret Manager) para **Secret Manager com vínculo
 * explícito** (`functions.runWith({secrets:[ERP_BRIDGE_SECRET_NAME]})`
 * nos próprios exports em `valeria_vitre.ts`/
 * `valeria_pre_orcamento_identidade.ts`/
 * `valeria_pre_orcamento_personalizado.ts` — mesmo mecanismo já usado
 * para `META_ACCESS_TOKEN` em `meta_webhook.ts`). O valor chega ao
 * processo SÓ via `process.env[ERP_BRIDGE_SECRET_NAME]`, nunca lido do
 * Firestore, nunca logado, nunca devolvido em resposta de erro (as
 * mensagens abaixo citam só o NOME da env var, nunca o valor).
 *
 * Autenticação DEDICADA para a ponte Central→ERP (meta-cloud-api-fase2,
 * worktree separado) — nunca reutiliza `erp_vr/valeria_config.secret`
 * (o Bearer administrativo único que hoje abre TODOS os endpoints
 * Valéria em produção, incluindo `valeriaCalcularOrcamento`,
 * `valeriaVitreAtualizarRascunho`, etc.).
 *
 * DUAS FUNÇÕES, ESCOPO DELIBERADAMENTE DIFERENTE (nenhuma abre operação
 * comercial — aprovação/exclusão/cobrança vivem em
 * `valeria_pre_orcamento_aprovacao.ts`/`erp_orcamento_exclusao_segura.ts`,
 * que são `onCall` com `context.auth`/role, NUNCA Bearer — este secret
 * não os alcança por construção, não por omissão):
 *  - `checkBridgeAuth`: exige SÓ o secret da ponte (Secret Manager).
 *    Usada pelos 3 endpoints CRIADOS para a ponte (nenhum chamador
 *    legado existe — nunca precisam aceitar o secret administrativo
 *    antigo).
 *  - `checkAuthBridgeOrLegacy`: aceita o secret da ponte (Secret
 *    Manager) OU o administrativo antigo (Firestore, inalterado). Usada
 *    SÓ nos 2 endpoints Vitre JÁ EXISTENTES que a ponte também chama
 *    (`valeriaVitreBuscarCatalogo`/`valeriaVitreCriarRascunho`) — para
 *    nunca quebrar quem já os chama hoje com o secret antigo (Chatvolt),
 *    enquanto a ponte passa a usar o novo. Os OUTROS 6 endpoints Vitre
 *    (`valeriaVitreConsultarProduto`/`AtualizarRascunho`/
 *    `ConsultarRascunho`/`EncaminharVR`/`SimularOrcamento`, e todo o
 *    resto de `valeria.ts`) continuam SÓ com o secret administrativo —
 *    o secret da ponte nunca os abre, mesmo vazado, porque esses
 *    exports nunca têm `ERP_BRIDGE_SECRET_NAME` vinculado via
 *    `runWith` — nem leem `process.env[ERP_BRIDGE_SECRET_NAME]`.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const COL = "erp_vr";

/** Nome do secret no Secret Manager — vinculado via `functions.runWith({secrets:[ERP_BRIDGE_SECRET_NAME]})` nos 5 exports que aceitam a ponte. Vazio/ausente (secret não criado/vinculado ainda) é SEMPRE fail-closed, nunca "sem restrição". */
export const ERP_BRIDGE_SECRET_NAME = "ERP_BRIDGE_SECRET";

function loadBridgeSecret(): string {
  return process.env[ERP_BRIDGE_SECRET_NAME] || "";
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
  const bridgeSecret = loadBridgeSecret();
  if (!bridgeSecret) {
    res.status(500).json({ ok: false, error: `${ERP_BRIDGE_SECRET_NAME} não vinculado a esta Function (Secret Manager) — nunca um valor padrão.` });
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
 * chama. Aceita o secret da ponte (Secret Manager) OU o administrativo
 * antigo (Firestore), nunca nenhum terceiro valor. Quando a ponte
 * estiver 100% migrada, o aceite do secret antigo pode ser removido
 * aqui — decisão futura, fora desta rodada.
 */
export async function checkAuthBridgeOrLegacy(req: functions.https.Request, res: functions.Response): Promise<boolean> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Authorization header ausente" });
    return false;
  }
  const bridgeSecret = loadBridgeSecret();
  const legacySecret = await loadLegacySecret();
  if (!bridgeSecret && !legacySecret) {
    res.status(500).json({ ok: false, error: `Nenhum secret configurado (nem ${ERP_BRIDGE_SECRET_NAME} via Secret Manager, nem erp_vr/valeria_config via Firestore).` });
    return false;
  }
  if (token !== bridgeSecret && token !== legacySecret) {
    res.status(401).json({ ok: false, error: "Token inválido" });
    return false;
  }
  return true;
}
