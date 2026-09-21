import { computeShadowEligible } from "../shadow_config";

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
