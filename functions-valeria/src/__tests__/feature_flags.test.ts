/**
 * feature_flags.test.ts — ValerIA 2.0, Fase B (continuação, 2026-09-19).
 * Cobre computeV2Enabled (pura). valeriaV2EnabledForPhone (I/O) segue a
 * mesma disciplina do resto do módulo — sem mock de Firestore aqui.
 */
import { computeV2Enabled } from "../feature_flags";
import type { ErpConfig } from "../types";

describe("computeV2Enabled — J. feature flag combinada com allowlist", () => {
  test("false + allowlisted → legacy", () => {
    expect(computeV2Enabled({ valeriaV2Enabled: false } as ErpConfig, true)).toBe(false);
  });

  test("true + not allowlisted → legacy", () => {
    expect(computeV2Enabled({ valeriaV2Enabled: true } as ErpConfig, false)).toBe(false);
  });

  test("true + allowlisted → v2", () => {
    expect(computeV2Enabled({ valeriaV2Enabled: true } as ErpConfig, true)).toBe(true);
  });

  test("config ausente (null) → legacy", () => {
    expect(computeV2Enabled(null, true)).toBe(false);
  });

  test("config presente mas sem o campo valeriaV2Enabled → legacy", () => {
    expect(computeV2Enabled({} as ErpConfig, true)).toBe(false);
  });

  test("telefone inválido (não allowlisted, representado por isPhoneAllowlisted=false) → legacy mesmo com flag on", () => {
    expect(computeV2Enabled({ valeriaV2Enabled: true } as ErpConfig, false)).toBe(false);
  });
});
