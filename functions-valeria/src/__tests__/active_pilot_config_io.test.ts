/**
 * active_pilot_config_io.test.ts — ValerIA 2.0, Fase E.2.30 (2026-09-22).
 *
 * Prova que `active_pilot_config.ts` NÃO tem cache em memória — cada
 * chamada lê o Firestore direto, mudanças são observadas imediatamente
 * entre chamadas consecutivas, e falha de leitura é fail-closed (nunca um
 * valor antigo em memória). Mocka firebase-admin (o doc de config) e
 * ./test_phone_allowlist (independente, já teria seu próprio cache — não
 * é o alvo desta fase; aqui é sempre "permitido" para isolar o gate sob
 * teste).
 */
jest.mock("../test_phone_allowlist", () => ({
  estaExplicitamenteNaAllowlist: jest.fn(async () => true),
}));

let _docData: Record<string, unknown> | null = null;
const getMock = jest.fn(async () => ({ exists: _docData !== null, data: () => _docData }));

jest.mock("firebase-admin", () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({ get: getMock }),
    }),
  }),
}));

import { activePilotEligibilityForRequest } from "../active_pilot_config";

const CONV = "conv_piloto";
const PHONE = "+5562999999999";

beforeEach(() => {
  _docData = null;
  getMock.mockClear();
});

describe("active_pilot_config — sem cache, fail-closed (Fase E.2.30)", () => {
  test("CASO A — config activePilotEnabled=false → mensagem não passa (ACTIVE_PILOT_DISABLED)", async () => {
    _docData = { activePilotEnabled: false, allowedConversationIds: [CONV] };
    const r = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(r.reason).toBe("ACTIVE_PILOT_DISABLED");
  });

  test("CASO B — config activePilotEnabled=true e conversa permitida → ELIGIBLE", async () => {
    _docData = { activePilotEnabled: true, allowedConversationIds: [CONV] };
    const r = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(r.reason).toBe("ELIGIBLE");
  });

  test("CASO C — true → false entre duas chamadas consecutivas → 2ª chamada enxerga false IMEDIATAMENTE (sem esperar 15s)", async () => {
    _docData = { activePilotEnabled: true, allowedConversationIds: [CONV] };
    const first = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(first.reason).toBe("ELIGIBLE");

    _docData = { activePilotEnabled: false, allowedConversationIds: [CONV] }; // muda no Firestore "agora mesmo"
    const second = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(second.reason).toBe("ACTIVE_PILOT_DISABLED"); // nunca um "true" cacheado da chamada anterior
  });

  test("CASO D — false → true entre duas chamadas consecutivas → 2ª chamada enxerga true IMEDIATAMENTE", async () => {
    _docData = { activePilotEnabled: false, allowedConversationIds: [CONV] };
    const first = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(first.reason).toBe("ACTIVE_PILOT_DISABLED");

    _docData = { activePilotEnabled: true, allowedConversationIds: [CONV] };
    const second = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(second.reason).toBe("ELIGIBLE"); // nunca um "false" cacheado da chamada anterior
  });

  test("CASO E — erro de leitura do Firestore → fail-closed (piloto tratado como desligado, nunca cai para valor anterior)", async () => {
    _docData = { activePilotEnabled: true, allowedConversationIds: [CONV] };
    const ok = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(ok.reason).toBe("ELIGIBLE");

    getMock.mockImplementationOnce(async () => { throw new Error("Firestore indisponível (simulado)"); });
    const failed = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(failed.reason).toBe("ACTIVE_PILOT_DISABLED");
    expect(failed.activePilotEnabled).toBe(false);
  });

  test("CASO F — allowedConversationIds alterado entre chamadas → mudança observada imediatamente", async () => {
    _docData = { activePilotEnabled: true, allowedConversationIds: ["outra_conversa"] };
    const first = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(first.reason).toBe("CONVERSATION_NOT_ALLOWLISTED");

    _docData = { activePilotEnabled: true, allowedConversationIds: [CONV] };
    const second = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(second.reason).toBe("ELIGIBLE");
  });

  test("cada chamada faz sua PRÓPRIA leitura do Firestore — nenhuma reaproveitada de uma chamada anterior", async () => {
    _docData = { activePilotEnabled: true, allowedConversationIds: [CONV] };
    await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(getMock).toHaveBeenCalledTimes(3); // sem cache = 1 leitura por chamada, sempre
  });

  test("doc inexistente no Firestore → tratado como desligado (fail-closed), nunca lança", async () => {
    _docData = null; // snap.exists === false
    const r = await activePilotEligibilityForRequest(PHONE, CONV, true, "valeria");
    expect(r.reason).toBe("ACTIVE_PILOT_DISABLED");
  });
});
