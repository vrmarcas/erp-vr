/**
 * feature_flags.ts — ValerIA 2.0, Fase B (2026-09-19, testes adicionados na
 * continuação da mesma data).
 *
 * Gate único da reconstrução: V2 só roda quando AMBAS as condições são
 * verdadeiras — `erp_vr/erp_config.valeriaV2Enabled === true` E o telefone
 * do canal está explicitamente em `erp_vr/valeria_test_phone_numbers`.
 * Reusa as duas fontes de configuração já existentes (`pricing.ts::loadErpConfig`,
 * `test_phone_allowlist.ts`) — nenhum mecanismo de feature flag novo.
 *
 * Qualquer outra combinação (flag off, ou flag on mas telefone fora da
 * allowlist) mantém o fluxo legado intocado.
 *
 * `computeV2Enabled` é a decisão PURA (testável sem Firestore);
 * `valeriaV2EnabledForPhone` só faz o I/O e delega a decisão a ela.
 */
import { loadErpConfig } from "./pricing";
import { estaExplicitamenteNaAllowlist } from "./test_phone_allowlist";
import type { ErpConfig } from "./types";

/** Decisão pura: dado o config já carregado + se o telefone já foi checado na allowlist, decide legacy x v2. */
export function computeV2Enabled(cfg: ErpConfig | null, isPhoneAllowlisted: boolean): boolean {
  if (!cfg?.valeriaV2Enabled) return false; // flag off ou config ausente → legacy
  return isPhoneAllowlisted; // flag on, mas só v2 se o telefone está explicitamente cadastrado
}

export async function valeriaV2EnabledForPhone(channelPhone: string | null): Promise<boolean> {
  const cfg = await loadErpConfig();
  // curto-circuito: só consulta a allowlist se a flag mestra já estiver ligada (menos leitura no caso comum — flag off).
  if (!cfg?.valeriaV2Enabled) return false;
  const isAllowlisted = await estaExplicitamenteNaAllowlist(channelPhone);
  return computeV2Enabled(cfg, isAllowlisted);
}
