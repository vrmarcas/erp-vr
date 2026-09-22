/**
 * commercial_side_effects_config.test.ts — ValerIA 2.0, Fase E.2.35 (2026-09-22).
 *
 * Prova que `commercial_side_effects_config.ts` é um gate INDEPENDENTE do
 * piloto ativo (active_pilot_config.ts): default false, sem cache (leitura
 * sempre fresca, mesma disciplina de active_pilot_config_io.test.ts),
 * allowlist própria (não herda allowedConversationIds do piloto), e
 * fail-closed em qualquer erro de leitura.
 */
let _docData: Record<string, unknown> | null = null;
const getMock = jest.fn(async () => ({ exists: _docData !== null, data: () => _docData }));

jest.mock("firebase-admin", () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({ get: getMock }),
    }),
  }),
}));

import {
  commercialSideEffectsEligibilityForConversation,
  computeCommercialSideEffectsEligibilityReason,
} from "../commercial_side_effects_config";

const CONV = "conv_piloto";

beforeEach(() => {
  _docData = null;
  getMock.mockClear();
});

describe("commercial_side_effects_config — função pura de decisão", () => {
  test("gate desligado → COMMERCIAL_SIDE_EFFECTS_DISABLED, independente de allowlist", () => {
    expect(computeCommercialSideEffectsEligibilityReason(false, true)).toBe("COMMERCIAL_SIDE_EFFECTS_DISABLED");
    expect(computeCommercialSideEffectsEligibilityReason(false, false)).toBe("COMMERCIAL_SIDE_EFFECTS_DISABLED");
  });

  test("gate ligado mas conversa fora da allowlist → CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS", () => {
    expect(computeCommercialSideEffectsEligibilityReason(true, false)).toBe("CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS");
  });

  test("gate ligado e conversa na allowlist → ELIGIBLE", () => {
    expect(computeCommercialSideEffectsEligibilityReason(true, true)).toBe("ELIGIBLE");
  });
});

describe("commercial_side_effects_config — I/O, sem cache, fail-closed (mesma disciplina de active_pilot_config_io.test.ts)", () => {
  test("doc inexistente → tratado como desligado (fail-closed), nunca lança", async () => {
    _docData = null;
    const r = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(r.reason).toBe("COMMERCIAL_SIDE_EFFECTS_DISABLED");
    expect(r.commercialSideEffectsEnabled).toBe(false);
  });

  test("commercialSideEffectsEnabled=false → não elegível mesmo com conversa na allowlist", async () => {
    _docData = { commercialSideEffectsEnabled: false, allowedConversationIds: [CONV] };
    const r = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(r.reason).toBe("COMMERCIAL_SIDE_EFFECTS_DISABLED");
  });

  test("commercialSideEffectsEnabled=true mas conversationId fora da allowlist própria → CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS", async () => {
    _docData = { commercialSideEffectsEnabled: true, allowedConversationIds: ["outra_conversa"] };
    const r = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(r.reason).toBe("CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS");
  });

  test("commercialSideEffectsEnabled=true e conversationId na allowlist própria → ELIGIBLE", async () => {
    _docData = { commercialSideEffectsEnabled: true, allowedConversationIds: [CONV] };
    const r = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(r.reason).toBe("ELIGIBLE");
  });

  test("sem cache — mudança entre duas chamadas consecutivas é observada imediatamente", async () => {
    _docData = { commercialSideEffectsEnabled: true, allowedConversationIds: [CONV] };
    const first = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(first.reason).toBe("ELIGIBLE");

    _docData = { commercialSideEffectsEnabled: false, allowedConversationIds: [CONV] };
    const second = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(second.reason).toBe("COMMERCIAL_SIDE_EFFECTS_DISABLED");
  });

  test("erro de leitura do Firestore → fail-closed, nunca cai para um valor anterior em memória", async () => {
    _docData = { commercialSideEffectsEnabled: true, allowedConversationIds: [CONV] };
    const ok = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(ok.reason).toBe("ELIGIBLE");

    getMock.mockImplementationOnce(async () => { throw new Error("Firestore indisponível (simulado)"); });
    const failed = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(failed.reason).toBe("COMMERCIAL_SIDE_EFFECTS_DISABLED");
    expect(failed.commercialSideEffectsEnabled).toBe(false);
  });

  test("cada chamada faz sua própria leitura do Firestore — nenhuma reaproveitada", async () => {
    _docData = { commercialSideEffectsEnabled: true, allowedConversationIds: [CONV] };
    await commercialSideEffectsEligibilityForConversation(CONV);
    await commercialSideEffectsEligibilityForConversation(CONV);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  test("allowlist deste gate é independente da allowlist do piloto ativo — não lê allowedConversationIds de outro documento/coleção", async () => {
    // allowedConversationIds aqui pertence só a erp_vr/valeria_commercial_side_effects_config;
    // uma conversa autorizada no active_pilot_config mas ausente daqui continua não elegível.
    _docData = { commercialSideEffectsEnabled: true, allowedConversationIds: ["outra_conversa_do_piloto"] };
    const r = await commercialSideEffectsEligibilityForConversation(CONV);
    expect(r.reason).toBe("CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS");
  });
});
