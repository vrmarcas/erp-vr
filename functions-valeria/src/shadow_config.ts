/**
 * shadow_config.ts — ValerIA 2.0, Fase E.2.8 (2026-09-20).
 *
 * Gate DELIBERADAMENTE SEPARADO de `feature_flags.ts::valeriaV2EnabledForPhone`
 * — nunca reutiliza `erp_vr/erp_config.valeriaV2Enabled`. O shadow ligado
 * NUNCA autoriza nem implica comportamento real da V2 (envio, orçamento,
 * briefing, handoff) — só controla se `shadow_runner.ts` roda e grava um
 * diagnóstico. Mesmo com o flag ligado, `shadowEligibleForPhone` exige
 * TAMBÉM que o telefone esteja EXPLICITAMENTE na allowlist de teste
 * (`estaExplicitamenteNaAllowlist`, mesma semântica estrita usada pela V2
 * real) — dupla trava: nem o flag sozinho, nem a allowlist sozinha,
 * habilitam o shadow para um número fora de teste.
 */
import * as admin from "firebase-admin";
import { estaExplicitamenteNaAllowlist } from "./test_phone_allowlist";

const COL = "erp_vr";
const DOC_ID = "valeria_shadow_config";
const CACHE_TTL_MS = 15_000;

let _cache: { shadowEnabled: boolean; at: number } | null = null;

async function loadShadowFlag(): Promise<boolean> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.shadowEnabled;
  try {
    const snap = await admin.firestore().collection(COL).doc(DOC_ID).get();
    const shadowEnabled = snap.exists ? !!(snap.data()?.shadowEnabled) : false;
    _cache = { shadowEnabled, at: now };
  } catch (e) {
    console.error("[shadow_config] falha ao ler flag (tratando como desligado):", (e as Error).message);
    _cache = { shadowEnabled: false, at: now };
  }
  return _cache.shadowEnabled;
}

/** Decisão pura — testável sem Firestore. */
export function computeShadowEligible(shadowFlagOn: boolean, isPhoneAllowlisted: boolean): boolean {
  return shadowFlagOn && isPhoneAllowlisted;
}

export async function shadowEligibleForPhone(channelPhone: string | null): Promise<boolean> {
  const shadowFlagOn = await loadShadowFlag();
  if (!shadowFlagOn) return false; // curto-circuito — não consulta allowlist se o flag mestre já está off
  const isAllowlisted = await estaExplicitamenteNaAllowlist(channelPhone);
  return computeShadowEligible(shadowFlagOn, isAllowlisted);
}

/**
 * Fase E.2.8 — ajuste de observabilidade (2026-09-21): mesma decisão de
 * `computeShadowEligible`, mas devolvendo o motivo explícito em vez de só
 * um booleano — nenhuma mudança de comportamento/elegibilidade, só
 * diagnóstico. Pura, testável sem Firestore.
 */
export type ShadowEligibilityReason = "SHADOW_DISABLED" | "PHONE_NOT_ALLOWLISTED" | "ELIGIBLE";

export function computeShadowEligibilityReason(shadowFlagOn: boolean, isPhoneAllowlisted: boolean): ShadowEligibilityReason {
  if (!shadowFlagOn) return "SHADOW_DISABLED";
  if (!isPhoneAllowlisted) return "PHONE_NOT_ALLOWLISTED";
  return "ELIGIBLE";
}

export interface ShadowEligibilityResult {
  reason: ShadowEligibilityReason;
  shadowEnabled: boolean;
  allowlisted: boolean;
}

export async function shadowEligibilityReasonForPhone(channelPhone: string | null): Promise<ShadowEligibilityResult> {
  const shadowEnabled = await loadShadowFlag();
  // Mesmo curto-circuito de sempre (não consulta allowlist se o flag já está off) —
  // só que agora reporta `allowlisted:false` nesse caso em vez de nunca checar,
  // para o log não sugerir "desconhecido" quando na verdade nem foi relevante.
  const allowlisted = shadowEnabled ? await estaExplicitamenteNaAllowlist(channelPhone) : false;
  return { reason: computeShadowEligibilityReason(shadowEnabled, allowlisted), shadowEnabled, allowlisted };
}

/** Só para testes — nunca chamado em produção. */
export function _resetShadowCacheParaTeste(): void {
  _cache = null;
}
