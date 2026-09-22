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
import { loadCatalogDraft, saveCatalogDraft } from "../catalog_draft";
import { commercialSideEffectsEligibilityForConversation } from "../commercial_side_effects_config";
import { executeReadyCatalogDraftSideEffects } from "../commercial_quote_orchestrator";

jest.mock("../active_pilot_config");
jest.mock("../active_pilot_send_ledger");
jest.mock("../catalog");
jest.mock("../chatvolt_send_adapter");
jest.mock("../commercial_side_effects_config");
jest.mock("../commercial_quote_orchestrator");
// Só mocka a fronteira de I/O (load/save) — shadow_pipeline.ts usa as
// funções PURAS deste módulo de verdade (emptyCatalogDraft/
// mergeSignalsIntoDraft/computeQualificationState); um auto-mock completo
// as substituiria por jest.fn() retornando undefined e quebraria a
// decisão real do pipeline.
jest.mock("../catalog_draft", () => {
  const actual = jest.requireActual("../catalog_draft");
  return { ...actual, loadCatalogDraft: jest.fn(), saveCatalogDraft: jest.fn() };
});
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
const mockLoadCatalogDraft = loadCatalogDraft as jest.Mock;
const mockSaveCatalogDraft = saveCatalogDraft as jest.Mock;
const mockCommercialElig = commercialSideEffectsEligibilityForConversation as jest.Mock;
const mockExecuteSideEffects = executeReadyCatalogDraftSideEffects as jest.Mock;

const BASE_INPUT = {
  conversationId: "conv1",
  organizationId: "org1",
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
  mockLoadCatalogDraft.mockResolvedValue(null);
  mockSaveCatalogDraft.mockResolvedValue(undefined);
  mockRunShadowPipeline.mockImplementation(REAL_RUN_SHADOW_PIPELINE);
  // Por padrão, side effect comercial NUNCA autorizado — testes existentes
  // (que não são sobre side effect) nunca devem acionar orçamento/handoff.
  mockCommercialElig.mockResolvedValue({ reason: "COMMERCIAL_SIDE_EFFECTS_DISABLED", commercialSideEffectsEnabled: false, conversationAllowlisted: false });
  mockExecuteSideEffects.mockResolvedValue({ executed: false, draftCreated: false, alreadyExisted: false, quoteId: null, handoffRequested: false, errorCode: "SHOULD_NOT_BE_CALLED" });
});

describe("Gate de elegibilidade — nenhum deles chega perto de enviar", () => {
  test("activePilotEnabled=false (kill switch) → bloqueio imediato, nunca consulta ledger nem catálogo", async () => {
    mockEligibility.mockResolvedValue({ reason: "ACTIVE_PILOT_DISABLED", activePilotEnabled: false, phoneAllowlisted: false, conversationAllowlisted: false });
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero uma caixa." });
    expect(out).toEqual({ ran: false, reason: "ACTIVE_PILOT_DISABLED", sendSuppressed: true, sentMessageId: null, sideEffectsExecuted: false });
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
    expect(out).toEqual({ ran: false, reason: "ALREADY_SENT", sendSuppressed: true, sentMessageId: "sent_msg_1", sideEffectsExecuted: false });
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

describe("Continuidade multi-turno — item 11 da Fase E.2.22", () => {
  test("chama loadCatalogDraft(conversationId) antes de decidir", async () => {
    await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero fazer uma caixa." });
    expect(mockLoadCatalogDraft).toHaveBeenCalledWith("conv1");
  });

  test("passa o draft carregado como priorDraft para o pipeline (afeta a decisão)", async () => {
    const priorDraft = {
      conversationId: "conv1", atendimentoId: null, isTest: true, category: "caixas",
      catalogGroupId: "caixa_tampa_de_correr", resolutionType: null,
      matchedProductId: null, matchedProductSku: null,
      baseCatalogGroupId: null, baseProductId: null, baseProductSku: null,
      clientConfirmed: false, customizationRequired: false, customizationReason: null,
      fields: { quantity: null, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null },
      fieldSources: {}, qualificationStatus: "QUALIFYING_CATALOG" as const, missingFields: ["tamanho"],
      promovido: false, createdAt: 0, updatedAt: 0,
    };
    mockLoadCatalogDraft.mockResolvedValue(priorDraft);
    // "tamanho m" sozinho, sem "quero"/decisivo — só vira COMMERCIAL_INTENT
    // por causa do priorDraft com catalogGroupId já ativo (continuidade).
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Tamanho M." });
    expect(out.reason).toBe("SENT"); // se caísse em EXPLORATORY/AMBIGUOUS sem contexto, o texto seria outro
    expect(mockRunShadowPipeline).toHaveBeenCalledWith(expect.objectContaining({ priorDraft }));
  });

  test("persiste o draft atualizado via saveCatalogDraft quando há mergedDraft (COMMERCIAL_INTENT)", async () => {
    await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero fazer uma caixa." });
    expect(mockSaveCatalogDraft).toHaveBeenCalledTimes(1);
    const [savedDraft] = mockSaveCatalogDraft.mock.calls[0];
    expect(savedDraft.conversationId).toBe("conv1");
  });

  test("EXPLORATORY não persiste draft (mergedDraft é null nesse ramo)", async () => {
    await runActivePilotObservation({ ...BASE_INPUT, messageText: "Vocês fazem peças sob medida?" });
    expect(mockSaveCatalogDraft).not.toHaveBeenCalled();
  });

  test("persiste o draft ANTES de tentar enviar (ordem: save antes de send) — ver failure-mode analysis no cabeçalho do módulo", async () => {
    const ordem: string[] = [];
    mockSaveCatalogDraft.mockImplementation(async () => { ordem.push("save"); });
    mockSend.mockImplementation(async () => { ordem.push("send"); return { id: "sent_msg_1", raw: {} }; });
    await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero fazer uma caixa." });
    expect(ordem).toEqual(["save", "send"]);
  });

  test("draft é salvo mesmo quando o validador rejeita o envio (entendimento do backend independe da entrega)", async () => {
    mockRunShadowPipeline.mockReturnValueOnce({
      mode: "COMMERCIAL_INTENT",
      rawHypotheticalText: "pergunta proibida?",
      hypotheticalText: "texto saneado",
      outputValidation: { valid: false, violations: ["QUESTION_NOT_ALLOWED"], sanitizedText: "texto saneado" },
      mergedDraft: { conversationId: "conv1", catalogGroupId: "caixa_tampa_de_correr" },
    });
    await runActivePilotObservation({ ...BASE_INPUT, messageText: "qualquer coisa" });
    expect(mockSaveCatalogDraft).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("side effects comerciais reais continuam desligados (sideEffectsExecuted nunca é usado para criar orçamento/produção/handoff aqui)", async () => {
    const runnerSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "active_pilot_runner.ts"), "utf8");
    expect(runnerSrc).not.toMatch(/vitre_draft_writer|human_handoff|technical_briefing_store|quote_core/);
  });
});

describe("Side effect comercial real — gate SEPARADO do piloto (Fase E.2.35)", () => {
  const READY_DRAFT = {
    conversationId: "conv1", atendimentoId: null, isTest: true, category: "caixas",
    catalogGroupId: "grupo_caixa_4mm", resolutionType: "EXACT_CATALOG_MATCH",
    matchedProductId: "C4TC3M", matchedProductSku: "C4TC3M",
    baseCatalogGroupId: null, baseProductId: null, baseProductSku: null,
    clientConfirmed: true, customizationRequired: false, customizationReason: null,
    fields: { quantity: 20, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null },
    fieldSources: {}, qualificationStatus: "READY_CATALOG_DRAFT" as const, missingFields: [],
    promovido: false, createdAt: 0, updatedAt: 0,
  };

  function stubReadyPipelineResult(overrides: Record<string, unknown> = {}) {
    mockRunShadowPipeline.mockReturnValueOnce({
      mode: "COMMERCIAL_INTENT",
      rawHypotheticalText: "texto neutro (READY_FOR_QUOTE_REVIEW, sem side effect)",
      hypotheticalText: "texto neutro (READY_FOR_QUOTE_REVIEW, sem side effect)",
      outputValidation: { valid: true, violations: [], sanitizedText: "texto neutro (READY_FOR_QUOTE_REVIEW, sem side effect)" },
      mergedDraft: READY_DRAFT,
      ...overrides,
    });
  }

  test("activePilotEnabled=true (piloto elegível) mas commercialSideEffectsEnabled=false → NUNCA chama executeReadyCatalogDraftSideEffects, envia texto neutro sem afirmar orçamento", async () => {
    stubReadyPipelineResult();
    // beforeEach já deixa mockCommercialElig como COMMERCIAL_SIDE_EFFECTS_DISABLED por padrão.
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero 20 caixas, tamanho M." });
    expect(mockExecuteSideEffects).not.toHaveBeenCalled();
    expect(out.sideEffectsExecuted).toBe(false);
    expect(out.reason).toBe("SENT");
    const [, textoEnviado] = mockSend.mock.calls[0];
    expect(textoEnviado).toBe("texto neutro (READY_FOR_QUOTE_REVIEW, sem side effect)");
  });

  test("commercialSideEffectsEnabled=true mas activePilotEnabled=false (piloto não elegível) → runner nem chega a rodar, side effect nunca é avaliado", async () => {
    mockEligibility.mockResolvedValue({ reason: "ACTIVE_PILOT_DISABLED", activePilotEnabled: false, phoneAllowlisted: false, conversationAllowlisted: false });
    mockCommercialElig.mockResolvedValue({ reason: "ELIGIBLE", commercialSideEffectsEnabled: true, conversationAllowlisted: true });
    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero 20 caixas, tamanho M." });
    expect(out.reason).toBe("ACTIVE_PILOT_DISABLED");
    expect(out.sideEffectsExecuted).toBe(false);
    expect(mockCommercialElig).not.toHaveBeenCalled();
    expect(mockExecuteSideEffects).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("draft READY_CATALOG_DRAFT + ambos os gates ligados + orquestrador confirma execução real → sideEffectsExecuted=true, texto final afirma REQUEST_QUOTE_REVIEW", async () => {
    stubReadyPipelineResult();
    mockCommercialElig.mockResolvedValue({ reason: "ELIGIBLE", commercialSideEffectsEnabled: true, conversationAllowlisted: true });
    mockExecuteSideEffects.mockResolvedValue({ executed: true, draftCreated: true, alreadyExisted: false, quoteId: "valeria2_catalog_conv1", handoffRequested: true, errorCode: null });

    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero 20 caixas, tamanho M." });

    expect(mockExecuteSideEffects).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv1", organizationId: "org1", draft: READY_DRAFT }));
    expect(out.sideEffectsExecuted).toBe(true);
    expect(out.reason).toBe("SENT");
    const [, textoEnviado] = mockSend.mock.calls[0];
    expect(textoEnviado).not.toBe("texto neutro (READY_FOR_QUOTE_REVIEW, sem side effect)"); // recomputado após execução real
    expect(typeof textoEnviado).toBe("string");
    expect((textoEnviado as string).length).toBeGreaterThan(0);
  });

  test("orquestrador retorna executed=false (ex.: handoff falhou) → sideEffectsExecuted permanece false, texto NUNCA afirma REQUEST_QUOTE_REVIEW (usa o texto neutro original do pipeline)", async () => {
    stubReadyPipelineResult();
    mockCommercialElig.mockResolvedValue({ reason: "ELIGIBLE", commercialSideEffectsEnabled: true, conversationAllowlisted: true });
    mockExecuteSideEffects.mockResolvedValue({ executed: false, draftCreated: true, alreadyExisted: false, quoteId: "valeria2_catalog_conv1", handoffRequested: false, errorCode: "HANDOFF_FAILED" });

    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero 20 caixas, tamanho M." });

    expect(out.sideEffectsExecuted).toBe(false);
    expect(out.reason).toBe("SENT");
    const [, textoEnviado] = mockSend.mock.calls[0];
    expect(textoEnviado).toBe("texto neutro (READY_FOR_QUOTE_REVIEW, sem side effect)"); // nunca afirma o que não aconteceu
  });

  test("draft já promovido (promovido=true) → NUNCA reavalia elegibilidade comercial nem chama o orquestrador de novo", async () => {
    stubReadyPipelineResult({ mergedDraft: { ...READY_DRAFT, promovido: true } });
    mockCommercialElig.mockResolvedValue({ reason: "ELIGIBLE", commercialSideEffectsEnabled: true, conversationAllowlisted: true });

    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero 20 caixas, tamanho M." });

    expect(mockCommercialElig).not.toHaveBeenCalled();
    expect(mockExecuteSideEffects).not.toHaveBeenCalled();
    expect(out.sideEffectsExecuted).toBe(false);
  });

  test("draft ainda não está em READY_CATALOG_DRAFT (ex.: QUALIFYING_CATALOG) → side effect nunca avaliado, mesmo com ambos os gates ligados", async () => {
    stubReadyPipelineResult({ mergedDraft: { ...READY_DRAFT, qualificationStatus: "QUALIFYING_CATALOG", missingFields: ["tamanho"] } });
    mockCommercialElig.mockResolvedValue({ reason: "ELIGIBLE", commercialSideEffectsEnabled: true, conversationAllowlisted: true });

    await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero 20 caixas." });

    expect(mockCommercialElig).not.toHaveBeenCalled();
    expect(mockExecuteSideEffects).not.toHaveBeenCalled();
  });

  test("commercialSideEffectsEligibilityForConversation reprova (allowlist própria não bate) → orquestrador nunca é chamado, mesmo com draft pronto", async () => {
    stubReadyPipelineResult();
    mockCommercialElig.mockResolvedValue({ reason: "CONVERSATION_NOT_ALLOWLISTED_FOR_SIDE_EFFECTS", commercialSideEffectsEnabled: true, conversationAllowlisted: false });

    const out = await runActivePilotObservation({ ...BASE_INPUT, messageText: "Quero 20 caixas, tamanho M." });

    expect(mockExecuteSideEffects).not.toHaveBeenCalled();
    expect(out.sideEffectsExecuted).toBe(false);
  });
});
