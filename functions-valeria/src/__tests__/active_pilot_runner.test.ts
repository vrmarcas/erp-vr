/**
 * active_pilot_runner.test.ts — ValerIA 2.0, Fase E.2.13 (2026-09-21).
 *
 * Mocka toda fronteira de I/O (config/gate, ledger de envio, catálogo,
 * adapter de envio) e deixa `shadow_pipeline`/`shadow_signal_extractor`
 * REAIS (puros, já testados em A-E desta sessão) — testa a orquestração
 * em si: elegibilidade, idempotência, validator-gate e chamada ao adapter.
 */
import { runActivePilotObservation } from "../active_pilot_runner";
import { activePilotEligibilityForRequest } from "../active_pilot_config";
import { getSendState, canAttemptSend, reservePending, markSent, markFailed } from "../active_pilot_send_ledger";
import { getAllActiveCatalogConfigs, catalogGroupsFromConfig } from "../catalog";
import { sendChatvoltMessage } from "../chatvolt_send_adapter";
import { runShadowPipeline } from "../shadow_pipeline";

jest.mock("../active_pilot_config");
jest.mock("../active_pilot_send_ledger");
jest.mock("../catalog");
jest.mock("../chatvolt_send_adapter");
// shadow_pipeline.ts é puro e já testado — mantém a implementação REAL por
// padrão (garante que EXPLORATORY/COMMERCIAL_INTENT usam a mesma decisão
// já validada na bateria A-E), só troca para um resultado forjado no teste
// específico do validator-gate.
jest.mock("../shadow_pipeline", () => {
  const actual = jest.requireActual("../shadow_pipeline");
  return { ...actual, runShadowPipeline: jest.fn(actual.runShadowPipeline) };
});

const mockEligibility = activePilotEligibilityForRequest as jest.Mock;
const mockGetSendState = getSendState as jest.Mock;
const mockCanAttemptSend = canAttemptSend as unknown as jest.Mock;
const mockReservePending = reservePending as jest.Mock;
const mockMarkSent = markSent as jest.Mock;
const mockMarkFailed = markFailed as jest.Mock;
const mockGetCatalogConfigs = getAllActiveCatalogConfigs as jest.Mock;
const mockCatalogGroupsFromConfig = catalogGroupsFromConfig as jest.Mock;
const mockSend = sendChatvoltMessage as jest.Mock;
const mockRunShadowPipeline = runShadowPipeline as jest.Mock;
const REAL_RUN_SHADOW_PIPELINE = jest.requireActual("../shadow_pipeline").runShadowPipeline;

const BASE_INPUT = {
  conversationId: "conv1",
  channelPhone: "+5562999999999",
  modoAtendimento: "valeria",
  isTeste: true,
  idempotencyKey: "key1",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSendState.mockResolvedValue(null);
  mockCanAttemptSend.mockImplementation((existing: unknown) => !existing);
  mockGetCatalogConfigs.mockResolvedValue([]);
  mockCatalogGroupsFromConfig.mockReturnValue([]);
  mockEligibility.mockResolvedValue({ reason: "ELIGIBLE", activePilotEnabled: true, phoneAllowlisted: true, conversationAllowlisted: true });
  mockSend.mockResolvedValue({ id: "sent_msg_1", raw: {} });
  mockRunShadowPipeline.mockImplementation(REAL_RUN_SHADOW_PIPELINE);
});

describe("Gate de elegibilidade — nenhum deles chega perto de enviar", () => {
  test("activePilotEnabled=false (kill switch) → bloqueio imediato, nunca consulta ledger nem catálogo", async () => {
    mockEligibility.mockResolvedValue({ reason: "ACTIVE_PILOT_DISABLED", activePilotEnabled: false, phoneAllowlisted: false, conversationAllowlisted: false });
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero uma caixa." });
    expect(out).toEqual({ ran: false, reason: "ACTIVE_PILOT_DISABLED", sendSuppressed: true, sentMessageId: null });
    expect(mockGetSendState).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("telefone fora da allowlist → nunca envia", async () => {
    mockEligibility.mockResolvedValue({ reason: "PHONE_NOT_ALLOWLISTED", activePilotEnabled: true, phoneAllowlisted: false, conversationAllowlisted: true });
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero uma caixa." });
    expect(out.reason).toBe("PHONE_NOT_ALLOWLISTED");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("conversationId fora da allowlist do piloto → nunca envia", async () => {
    mockEligibility.mockResolvedValue({ reason: "CONVERSATION_NOT_ALLOWLISTED", activePilotEnabled: true, phoneAllowlisted: true, conversationAllowlisted: false });
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero uma caixa." });
    expect(out.reason).toBe("CONVERSATION_NOT_ALLOWLISTED");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("isTest=false → nunca envia", async () => {
    mockEligibility.mockResolvedValue({ reason: "NOT_TEST", activePilotEnabled: true, phoneAllowlisted: true, conversationAllowlisted: true });
    const out = await runActivePilotObservation({ ...BASE_INPUT, isTeste: false, messageText: "Quero uma caixa." });
    expect(out.reason).toBe("NOT_TEST");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("humano já atendendo → nunca envia", async () => {
    mockEligibility.mockResolvedValue({ reason: "HUMAN_ACTIVE", activePilotEnabled: true, phoneAllowlisted: true, conversationAllowlisted: true });
    const out = await runActivePilotObservation({ ...BASE_INPUT, modoAtendimento: "humano", messageText: "Quero uma caixa." });
    expect(out.reason).toBe("HUMAN_ACTIVE");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("Idempotência do envio", () => {
  test("messageId já SENT → uma resposta só, nunca reenvia", async () => {
    mockGetSendState.mockResolvedValue({ idempotencyKey: "key1", conversationId: "conv1", status: "SENT", sentMessageId: "sent_msg_1", reason: null, createdAt: 0, updatedAt: 0 });
    mockCanAttemptSend.mockReturnValue(false);
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero uma caixa." });
    expect(out).toEqual({ ran: false, reason: "ALREADY_SENT", sendSuppressed: true, sentMessageId: "sent_msg_1" });
    expect(mockReservePending).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("messageId PENDING (outra execução em curso) → não dispara envio concorrente", async () => {
    mockGetSendState.mockResolvedValue({ idempotencyKey: "key1", conversationId: "conv1", status: "PENDING", sentMessageId: null, reason: null, createdAt: 0, updatedAt: 0 });
    mockCanAttemptSend.mockReturnValue(false);
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero uma caixa." });
    expect(out.reason).toBe("SEND_IN_PROGRESS");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("sem registro anterior → reserva PENDING antes de decidir/enviar", async () => {
    await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero uma caixa." });
    expect(mockReservePending).toHaveBeenCalledWith("key1", "conv1");
  });
});

describe("Validator gate — texto só sai se o validador aprovar", () => {
  test("validador rejeita → NÃO envia, registra FAILED com motivo VALIDATOR_REJECTED", async () => {
    mockRunShadowPipeline.mockReturnValueOnce({
      mode: "COMMERCIAL_INTENT",
      rawHypotheticalText: "pergunta proibida?",
      hypotheticalText: "texto saneado",
      outputValidation: { valid: false, violations: ["QUESTION_NOT_ALLOWED"], sanitizedText: "texto saneado" },
    });
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "qualquer coisa" });
    expect(out.sendSuppressed).toBe(true);
    expect(out.reason).toBe("VALIDATOR_REJECTED");
    expect(mockMarkFailed).toHaveBeenCalledWith("key1", "VALIDATOR_REJECTED");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("Fluxo feliz — envia exatamente uma vez e registra SENT", () => {
  test("EXPLORATORY: pergunta genérica sem intenção comercial → sem pergunta na resposta, envia texto do redator", async () => {
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Vocês fazem peças sob medida?" });
    expect(out.ran).toBe(true);
    expect(out.reason).toBe("SENT");
    expect(out.sendSuppressed).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [, textoEnviado] = mockSend.mock.calls[0];
    expect(textoEnviado).not.toMatch(/\?/); // EXPLORATORY nunca pergunta de volta
    expect(mockMarkSent).toHaveBeenCalledWith("key1", "sent_msg_1");
  });

  test("COMMERCIAL_INTENT: 'Quero fazer uma caixa.' → pergunta coerente para avançar qualificação, envia", async () => {
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero fazer uma caixa." });
    expect(out.ran).toBe(true);
    expect(out.reason).toBe("SENT");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [conversationId, textoEnviado] = mockSend.mock.calls[0];
    expect(conversationId).toBe("conv1");
    expect(typeof textoEnviado).toBe("string");
    expect((textoEnviado as string).length).toBeGreaterThan(0);
  });

  test("erro no send-message → não propaga, registra FAILED com motivo do erro", async () => {
    mockSend.mockRejectedValue(new Error("send-message falhou: 500 erro interno"));
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero fazer uma caixa." });
    expect(out.ran).toBe(true);
    expect(out.reason).toBe("SEND_ERROR");
    expect(out.sendSuppressed).toBe(true);
    expect(mockMarkFailed).toHaveBeenCalled();
    expect(mockMarkSent).not.toHaveBeenCalled();
  });
});
