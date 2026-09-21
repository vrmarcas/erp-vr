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

/** Só para testes — nunca chamado em produção. */
export function _resetShadowCacheParaTeste(): void {
  _cache = null;
}
