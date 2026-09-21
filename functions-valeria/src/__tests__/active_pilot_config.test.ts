import { computeActivePilotEligibilityReason } from "../active_pilot_config";

describe("computeActivePilotEligibilityReason — decisão pura (Fase E.2.13)", () => {
  test("flag off → ACTIVE_PILOT_DISABLED, mesmo com tudo mais certo", () => {
    expect(computeActivePilotEligibilityReason(false, true, true, true, "valeria")).toBe("ACTIVE_PILOT_DISABLED");
  });

  test("flag on, telefone fora da allowlist → PHONE_NOT_ALLOWLISTED", () => {
    expect(computeActivePilotEligibilityReason(true, false, true, true, "valeria")).toBe("PHONE_NOT_ALLOWLISTED");
  });

  test("flag on, telefone ok, conversationId fora da allowlist do piloto → CONVERSATION_NOT_ALLOWLISTED", () => {
    expect(computeActivePilotEligibilityReason(true, true, false, true, "valeria")).toBe("CONVERSATION_NOT_ALLOWLISTED");
  });

  test("flag on, telefone e conversa ok, isTest=false → NOT_TEST", () => {
    expect(computeActivePilotEligibilityReason(true, true, true, false, "valeria")).toBe("NOT_TEST");
  });

  test("tudo certo, mas modoAtendimento=humano → HUMAN_ACTIVE", () => {
    expect(computeActivePilotEligibilityReason(true, true, true, true, "humano")).toBe("HUMAN_ACTIVE");
  });

  test("todas as 5 condições verdadeiras → ELIGIBLE", () => {
    expect(computeActivePilotEligibilityReason(true, true, true, true, "valeria")).toBe("ELIGIBLE");
  });

  test("todas as 5 condições verdadeiras, modoAtendimento null (nunca atribuído) → ELIGIBLE", () => {
    expect(computeActivePilotEligibilityReason(true, true, true, true, null)).toBe("ELIGIBLE");
  });

  test("prioridade do motivo reportado: flag off vence sobre qualquer outra falha", () => {
    expect(computeActivePilotEligibilityReason(false, false, false, false, "humano")).toBe("ACTIVE_PILOT_DISABLED");
  });
});
