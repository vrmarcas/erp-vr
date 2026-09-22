/**
 * commercial_side_effects_config.ts — ValerIA 2.0, Fase E.2.35 (2026-09-22).
 *
 * Gate DELIBERADAMENTE SEPARADO de `activePilotEnabled`
 * (active_pilot_config.ts) e de `valeriaV2Enabled` (feature_flags.ts) —
 * nunca reutiliza nenhum dos dois, e nenhum dos dois autoriza side effect
 * comercial sozinho. `activePilotEnabled=true` autoriza o piloto a
 * DECIDIR e RESPONDER de verdade; `commercialSideEffectsEnabled=true`
 * autoriza, adicionalmente, CRIAR ORÇAMENTO REAL + ACIONAR HANDOFF REAL
 * quando o draft chega a READY_CATALOG_DRAFT. As duas flags são
 * independentes e ambas precisam ser verdadeiras — ver contrato completo
 * em commercial_quote_orchestrator.ts.
 *
 * Mesmo padrão de active_pilot_config.ts (Fase E.2.30): SEM cache em
 * memória — toda leitura vai direto ao Firestore, fail-closed em caso de
 * erro. Um gate que autoriza gasto de dinheiro/side effect real do
 * negócio merece a MESMA disciplina de frescor já aplicada ao gate de
 * envio.
 */
import * as admin from "firebase-admin";

const COL = "erp_vr";
const DOC_ID = "valeria_commercial_side_effects_config";

interface CommercialSideEffectsDocConfig {
  commercialSideEffectsEnabled: boolean;
  allowedConversationIds: string[];
}

/** Sempre lê o Firestore, sem cache — mesmo motivo de active_pilot_config.ts. Falha de leitura = fail-closed. */
async function loadCommercialSideEffectsDocConfig(): Promise<CommercialSideEffectsDocConfig> {
  try {
    const snap = await admin.firestore().collection(COL).doc(DOC_ID).get();
    const data = snap.exists ? snap.data() : null;
    return {
      commercialSideEffectsEnabled: !!data?.commercialSideEffectsEnabled,
      allowedConversationIds: Array.isArray(data?.allowedConversationIds) ? (data!.allowedConversationIds as string[]) : [],
    };
  } catch (e) {
    console.error("[commercial_side_effects_config] falha ao ler config (fail-closed: tratando como desligado):", (e as Error).message);
    return { commercialSideEffectsEnabled: false, allowedConversationIds: [] };
  }
}

export type CommercialSideEffectsEligibilityReason =
  | "COMMERCIAL_SIDE_EFFECTS_DISABLED"
  | "CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS"
  | "ELIGIBLE";

/** Decisão pura — testável sem Firestore. */
export function computeCommercialSideEffectsEligibilityReason(
  enabled: boolean,
  isConversationAllowlisted: boolean
): CommercialSideEffectsEligibilityReason {
  if (!enabled) return "COMMERCIAL_SIDE_EFFECTS_DISABLED";
  if (!isConversationAllowlisted) return "CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS";
  return "ELIGIBLE";
}

export interface CommercialSideEffectsEligibilityResult {
  reason: CommercialSideEffectsEligibilityReason;
  commercialSideEffectsEnabled: boolean;
  conversationAllowlisted: boolean;
}

export async function commercialSideEffectsEligibilityForConversation(
  conversationId: string
): Promise<CommercialSideEffectsEligibilityResult> {
  const cfg = await loadCommercialSideEffectsDocConfig();
  const conversationAllowlisted = cfg.commercialSideEffectsEnabled && cfg.allowedConversationIds.includes(conversationId);
  return {
    reason: computeCommercialSideEffectsEligibilityReason(cfg.commercialSideEffectsEnabled, conversationAllowlisted),
    commercialSideEffectsEnabled: cfg.commercialSideEffectsEnabled,
    conversationAllowlisted,
  };
}
