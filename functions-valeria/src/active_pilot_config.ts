/**
 * active_pilot_config.ts — ValerIA 2.0, Fase E.2.13 (2026-09-21), SEM
 * cache desde a Fase E.2.30 (2026-09-22).
 *
 * Gate DELIBERADAMENTE SEPARADO de `valeriaV2Enabled` (feature_flags.ts) e
 * de `shadowEnabled` (shadow_config.ts) — nunca reutiliza nenhum dos dois.
 * O piloto ativo é o ÚNICO caminho desta reconstrução autorizado a enviar
 * mensagem de verdade (via chatvolt_send_adapter.ts); por isso tem o gate
 * mais restrito de todos os três: flag mestre E telefone allowlisted E
 * conversationId EXPLICITAMENTE permitido para o piloto (não basta o
 * telefone — reduz o blast radius a uma conversa por vez) E isTest=true E
 * nenhum humano já atendendo (`modoAtendimento !== "humano"`, mesmo campo
 * já usado em produção por webhook.ts para o mesmo propósito).
 *
 * Qualquer uma das cinco condições falhando é suficiente para recusar —
 * nunca "quase elegível".
 *
 * Fase E.2.30 — achado real (Piloto 4, E.2.29): `activePilotEnabled` não é
 * só observacional (diferente de `shadowEnabled`) — autoriza envio real ao
 * cliente. Um cache de 15s (mesmo padrão de shadow_config.ts/
 * feature_flags.ts) fez uma instância warm processar um inbound real com
 * `activePilotEnabled=false` em memória mesmo já com `true` gravado no
 * Firestore momentos antes — provado por log
 * (`reason:"ACTIVE_PILOT_DISABLED"` na 1ª mensagem, `ELIGIBLE`/enviado na
 * 2ª, ~54s depois). Pelo mesmo motivo, DESATIVAR o piloto também ficaria
 * sujeito a até 15s de atraso numa instância warm — inaceitável para o
 * único gate que autoriza efeito real. Por isso, e SÓ neste arquivo
 * (shadow_config.ts/feature_flags.ts continuam com cache — são gates só-
 * observacionais ou já aceitos com essa latência), toda leitura vai direto
 * ao Firestore, sem cache em memória. Custo aceito: 1 leitura Firestore
 * extra por inbound elegível para o piloto — segurança operacional pesa
 * mais que essa economia neste estágio.
 */
import * as admin from "firebase-admin";
import { estaExplicitamenteNaAllowlist } from "./test_phone_allowlist";

const COL = "erp_vr";
const DOC_ID = "valeria_active_pilot_config";

interface ActivePilotDocConfig {
  activePilotEnabled: boolean;
  allowedConversationIds: string[];
}

/**
 * Sempre lê o Firestore, sem cache — frescor máximo garantido para o gate
 * de envio real. Falha de leitura = fail-closed (piloto tratado como
 * desligado), NUNCA um valor antigo em memória.
 */
async function loadActivePilotDocConfig(): Promise<ActivePilotDocConfig> {
  try {
    const snap = await admin.firestore().collection(COL).doc(DOC_ID).get();
    const data = snap.exists ? snap.data() : null;
    return {
      activePilotEnabled: !!data?.activePilotEnabled,
      allowedConversationIds: Array.isArray(data?.allowedConversationIds) ? (data!.allowedConversationIds as string[]) : [],
    };
  } catch (e) {
    console.error("[active_pilot_config] falha ao ler config (fail-closed: tratando como desligado):", (e as Error).message);
    return { activePilotEnabled: false, allowedConversationIds: [] };
  }
}

export type ActivePilotEligibilityReason =
  | "ACTIVE_PILOT_DISABLED"
  | "PHONE_NOT_ALLOWLISTED"
  | "CONVERSATION_NOT_ALLOWLISTED"
  | "NOT_TEST"
  | "HUMAN_ACTIVE"
  | "ELIGIBLE";

/** Decisão pura — testável sem Firestore. Ordem das checagens é a ordem de prioridade do motivo reportado. */
export function computeActivePilotEligibilityReason(
  pilotFlagOn: boolean,
  isPhoneAllowlisted: boolean,
  isConversationAllowlisted: boolean,
  isTest: boolean,
  modoAtendimento: string | null
): ActivePilotEligibilityReason {
  if (!pilotFlagOn) return "ACTIVE_PILOT_DISABLED";
  if (!isPhoneAllowlisted) return "PHONE_NOT_ALLOWLISTED";
  if (!isConversationAllowlisted) return "CONVERSATION_NOT_ALLOWLISTED";
  if (!isTest) return "NOT_TEST";
  if (modoAtendimento === "humano") return "HUMAN_ACTIVE";
  return "ELIGIBLE";
}

export interface ActivePilotEligibilityResult {
  reason: ActivePilotEligibilityReason;
  activePilotEnabled: boolean;
  phoneAllowlisted: boolean;
  conversationAllowlisted: boolean;
}

export async function activePilotEligibilityForRequest(
  channelPhone: string | null,
  conversationId: string,
  isTest: boolean,
  modoAtendimento: string | null
): Promise<ActivePilotEligibilityResult> {
  const cfg = await loadActivePilotDocConfig();
  // Curto-circuito: só consulta allowlist de telefone/conversa se a flag mestra já está ligada.
  const phoneAllowlisted = cfg.activePilotEnabled ? await estaExplicitamenteNaAllowlist(channelPhone) : false;
  const conversationAllowlisted = cfg.activePilotEnabled && cfg.allowedConversationIds.includes(conversationId);
  return {
    reason: computeActivePilotEligibilityReason(cfg.activePilotEnabled, phoneAllowlisted, conversationAllowlisted, isTest, modoAtendimento),
    activePilotEnabled: cfg.activePilotEnabled,
    phoneAllowlisted,
    conversationAllowlisted,
  };
}
