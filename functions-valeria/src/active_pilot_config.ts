/**
 * active_pilot_config.ts — ValerIA 2.0, Fase E.2.13 (2026-09-21).
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
 */
import * as admin from "firebase-admin";
import { estaExplicitamenteNaAllowlist } from "./test_phone_allowlist";

const COL = "erp_vr";
const DOC_ID = "valeria_active_pilot_config";
const CACHE_TTL_MS = 15_000;

interface ActivePilotDocConfig {
  activePilotEnabled: boolean;
  allowedConversationIds: string[];
}

let _cache: { cfg: ActivePilotDocConfig; at: number } | null = null;

async function loadActivePilotDocConfig(): Promise<ActivePilotDocConfig> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.cfg;
  try {
    const snap = await admin.firestore().collection(COL).doc(DOC_ID).get();
    const data = snap.exists ? snap.data() : null;
    const cfg: ActivePilotDocConfig = {
      activePilotEnabled: !!data?.activePilotEnabled,
      allowedConversationIds: Array.isArray(data?.allowedConversationIds) ? (data!.allowedConversationIds as string[]) : [],
    };
    _cache = { cfg, at: now };
  } catch (e) {
    console.error("[active_pilot_config] falha ao ler config (tratando como desligado):", (e as Error).message);
    _cache = { cfg: { activePilotEnabled: false, allowedConversationIds: [] }, at: now };
  }
  return _cache.cfg;
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

/** Só para testes — nunca chamado em produção. */
export function _resetActivePilotCacheParaTeste(): void {
  _cache = null;
}
