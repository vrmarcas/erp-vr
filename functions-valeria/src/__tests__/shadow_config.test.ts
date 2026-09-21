import { computeShadowEligible, computeShadowEligibilityReason } from "../shadow_config";

describe("computeShadowEligible — decisão pura", () => {
  test("flag off, mesmo com telefone na allowlist → não elegível", () => {
    expect(computeShadowEligible(false, true)).toBe(false);
  });
  test("flag on, telefone fora da allowlist → não elegível", () => {
    expect(computeShadowEligible(true, false)).toBe(false);
  });
  test("flag on E telefone na allowlist → elegível", () => {
    expect(computeShadowEligible(true, true)).toBe(true);
  });
  test("flag off e fora da allowlist → não elegível", () => {
    expect(computeShadowEligible(false, false)).toBe(false);
  });
});

describe("computeShadowEligibilityReason — mesma decisão, com motivo explícito (Fase E.2.8, ajuste de observabilidade)", () => {
  test("flag off → SHADOW_DISABLED, mesmo com telefone na allowlist", () => {
    expect(computeShadowEligibilityReason(false, true)).toBe("SHADOW_DISABLED");
  });
  test("flag on, telefone fora da allowlist → PHONE_NOT_ALLOWLISTED", () => {
    expect(computeShadowEligibilityReason(true, false)).toBe("PHONE_NOT_ALLOWLISTED");
  });
  test("flag on E telefone na allowlist → ELIGIBLE", () => {
    expect(computeShadowEligibilityReason(true, true)).toBe("ELIGIBLE");
  });
  test("consistência: reason ELIGIBLE se e somente se computeShadowEligible=true", () => {
    for (const flag of [true, false]) {
      for (const allow of [true, false]) {
        const bool = computeShadowEligible(flag, allow);
        const reason = computeShadowEligibilityReason(flag, allow);
        expect(reason === "ELIGIBLE").toBe(bool);
      }
    }
  });
});
