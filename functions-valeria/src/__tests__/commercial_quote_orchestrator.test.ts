/**
 * commercial_quote_orchestrator.test.ts — ValerIA 2.0, Fase E.2.35 (2026-09-22).
 *
 * Prova o contrato de `executeReadyCatalogDraftSideEffects`: revalida
 * produto/preço mesmo com draft já em READY_CATALOG_DRAFT, nunca aceita
 * preço fora de `loadVitreProduct`, idempotência via
 * `createVitreDraftIfNotExists` (doc id determinístico — mockado aqui,
 * testado de verdade em vitre_draft_writer.test.ts), e a divergência
 * deliberada do fluxo real: só marca `promovido` quando o handoff
 * REALMENTE teve sucesso.
 */
jest.mock("../catalog_tools", () => ({
  loadVitreProduct: jest.fn(),
  findGroupOf: jest.fn(),
  resolveClienteNome: jest.fn(async () => "Cliente WhatsApp"),
}));
jest.mock("../vitre_draft_writer", () => ({
  createVitreDraftIfNotExists: jest.fn(),
}));
jest.mock("../human_handoff", () => ({
  requestQuoteReview: jest.fn(),
}));
jest.mock("../catalog_draft", () => ({
  ...jest.requireActual("../catalog_draft"),
  markCatalogDraftPromoted: jest.fn(async () => undefined),
}));

import { loadVitreProduct, findGroupOf } from "../catalog_tools";
import { createVitreDraftIfNotExists } from "../vitre_draft_writer";
import { requestQuoteReview } from "../human_handoff";
import { markCatalogDraftPromoted } from "../catalog_draft";
import { executeReadyCatalogDraftSideEffects } from "../commercial_quote_orchestrator";
import { emptyCatalogDraft, type CatalogDraft } from "../catalog_draft";

const mockLoadVitreProduct = loadVitreProduct as jest.Mock;
const mockFindGroupOf = findGroupOf as jest.Mock;
const mockCreateVitreDraft = createVitreDraftIfNotExists as jest.Mock;
const mockRequestQuoteReview = requestQuoteReview as jest.Mock;
const mockMarkPromoted = markCatalogDraftPromoted as jest.Mock;

const CONV = "cmt95yjqa0dksuvqt63to9tbm";
const ORG = "org1";

function readyDraft(overrides: Partial<CatalogDraft> = {}): CatalogDraft {
  const d = emptyCatalogDraft(CONV, null, true);
  return {
    ...d,
    catalogGroupId: "grupo_caixa_4mm",
    matchedProductId: "C4TC3M",
    matchedProductSku: "C4TC3M",
    fields: { ...d.fields, quantity: 20 },
    qualificationStatus: "READY_CATALOG_DRAFT",
    ...overrides,
  };
}

const VALID_PRODUTO = { id: "C4TC3M", sku: "C4TC3M", nome: "Caixa 4mm, tampa de correr 3mm", precoVenda: 165, status: "ativo", larguraCm: 40, alturaCm: 40 };
const VALID_GROUP = { catalogGroupId: "grupo_caixa_4mm", tamanhos: [{ vitreProductId: "C4TC3M" }] } as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockFindGroupOf.mockReturnValue(VALID_GROUP);
  mockLoadVitreProduct.mockResolvedValue(VALID_PRODUTO);
  mockCreateVitreDraft.mockResolvedValue({ id: "valeria2_catalog_" + CONV, jaProcessado: false, total: 3300 });
  mockRequestQuoteReview.mockResolvedValue({ ok: true, jaSolicitado: false });
});

describe("executeReadyCatalogDraftSideEffects — caminho feliz", () => {
  test("produto válido + quantity válida + gates ok → executed=true, draftCreated=true, handoffRequested=true, promovido marcado", async () => {
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: "+5562999396135", catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r).toEqual({ executed: true, draftCreated: true, alreadyExisted: false, quoteId: "valeria2_catalog_" + CONV, handoffRequested: true, errorCode: null });
    expect(mockMarkPromoted).toHaveBeenCalledWith(CONV, "vitre_rascunho", "valeria2_catalog_" + CONV);
  });

  test("nunca aceita preço do draft/texto — sempre usa o precoVenda retornado por loadVitreProduct nesta chamada", async () => {
    mockLoadVitreProduct.mockResolvedValue({ ...VALID_PRODUTO, precoVenda: 999 });
    await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(mockCreateVitreDraft).toHaveBeenCalledWith(expect.objectContaining({ produto: expect.objectContaining({ precoVenda: 999 }) }));
  });
});

describe("executeReadyCatalogDraftSideEffects — produto/preço inválidos", () => {
  test("sem matchedProductId → PRODUCT_NOT_FOUND, nenhuma escrita", async () => {
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [], draft: readyDraft({ matchedProductId: null }) });
    expect(r.executed).toBe(false);
    expect(r.errorCode).toBe("PRODUCT_NOT_FOUND");
    expect(mockCreateVitreDraft).not.toHaveBeenCalled();
  });

  test("quantity ausente/zero/negativa → INVALID_QUANTITY, nenhuma escrita", async () => {
    for (const q of [null, 0, -5]) {
      const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [], draft: readyDraft({ fields: { ...readyDraft().fields, quantity: q } }) });
      expect(r.errorCode).toBe("INVALID_QUANTITY");
    }
    expect(mockCreateVitreDraft).not.toHaveBeenCalled();
  });

  test("produto não encontrado na revalidação (loadVitreProduct retorna null) → INVALID_PRODUCT:PRODUCT_NOT_FOUND, nenhuma escrita", async () => {
    mockLoadVitreProduct.mockResolvedValue(null);
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r.executed).toBe(false);
    expect(r.errorCode).toBe("INVALID_PRODUCT:PRODUCT_NOT_FOUND");
    expect(mockCreateVitreDraft).not.toHaveBeenCalled();
  });

  test("produto não pertence mais ao grupo homologado → INVALID_PRODUCT:NOT_IN_GROUP, nenhuma escrita", async () => {
    mockFindGroupOf.mockReturnValue({ catalogGroupId: "grupo_caixa_4mm", tamanhos: [{ vitreProductId: "OUTRO_SKU" }] });
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r.errorCode).toBe("INVALID_PRODUCT:NOT_IN_GROUP");
    expect(mockCreateVitreDraft).not.toHaveBeenCalled();
  });

  test("produto sem precoVenda → rejeitado antes de qualquer escrita (validateMatchedProduct já exige precoVenda>0 para elegibilidade; a checagem PRICE_UNAVAILABLE é uma segunda trava, nunca alcançada quando a primeira já barrou)", async () => {
    mockLoadVitreProduct.mockResolvedValue({ ...VALID_PRODUTO, precoVenda: 0 });
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r.executed).toBe(false);
    expect(["INVALID_PRODUCT:NOT_ELIGIBLE", "PRICE_UNAVAILABLE"]).toContain(r.errorCode);
    expect(mockCreateVitreDraft).not.toHaveBeenCalled();
  });
});

describe("executeReadyCatalogDraftSideEffects — idempotência do rascunho", () => {
  test("rascunho já existia (createVitreDraftIfNotExists retorna jaProcessado=true) → alreadyExisted=true, draftCreated=false, ainda executa handoff", async () => {
    mockCreateVitreDraft.mockResolvedValue({ id: "valeria2_catalog_" + CONV, jaProcessado: true, total: 3300 });
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r.executed).toBe(true);
    expect(r.draftCreated).toBe(false);
    expect(r.alreadyExisted).toBe(true);
  });

  test("chamar duas vezes com o mesmo conversationId nunca cria dois docs — createVitreDraftIfNotExists é chamado com o mesmo doc-id-source (conversationId) nas duas vezes", async () => {
    await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    mockCreateVitreDraft.mockResolvedValue({ id: "valeria2_catalog_" + CONV, jaProcessado: true, total: 3300 });
    await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(mockCreateVitreDraft).toHaveBeenNthCalledWith(1, expect.objectContaining({ conversationId: CONV }));
    expect(mockCreateVitreDraft).toHaveBeenNthCalledWith(2, expect.objectContaining({ conversationId: CONV }));
  });

  test("falha ao escrever o rascunho (createVitreDraftIfNotExists lança) → DRAFT_WRITE_FAILED, handoff nunca chamado", async () => {
    mockCreateVitreDraft.mockRejectedValue(new Error("Firestore indisponível (simulado)"));
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r.executed).toBe(false);
    expect(r.errorCode).toBe("DRAFT_WRITE_FAILED");
    expect(mockRequestQuoteReview).not.toHaveBeenCalled();
  });
});

describe("executeReadyCatalogDraftSideEffects — handoff falha depois do draft criado", () => {
  test("draft criado, handoff falha (ok=false, jaSolicitado=false) → executed=false, HANDOFF_FAILED, draftCreated=true preservado no resultado, promovido NÃO marcado", async () => {
    mockRequestQuoteReview.mockResolvedValue({ ok: false, jaSolicitado: false, error: "TIMEOUT" });
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r.executed).toBe(false);
    expect(r.errorCode).toBe("HANDOFF_FAILED");
    expect(r.draftCreated).toBe(true);
    expect(r.quoteId).toBe("valeria2_catalog_" + CONV);
    expect(mockMarkPromoted).not.toHaveBeenCalled();
  });

  test("handoff já solicitado antes (jaSolicitado=true) conta como sucesso — executed=true mesmo sem ok=true", async () => {
    mockRequestQuoteReview.mockResolvedValue({ ok: false, jaSolicitado: true });
    const r = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(r.executed).toBe(true);
    expect(r.handoffRequested).toBe(true);
    expect(mockMarkPromoted).toHaveBeenCalled();
  });

  test("retry após handoff falhar não duplica o rascunho — 2ª tentativa reconhece jaProcessado=true e só repete o handoff", async () => {
    mockRequestQuoteReview.mockResolvedValueOnce({ ok: false, jaSolicitado: false });
    const first = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(first.errorCode).toBe("HANDOFF_FAILED");

    mockCreateVitreDraft.mockResolvedValue({ id: "valeria2_catalog_" + CONV, jaProcessado: true, total: 3300 });
    mockRequestQuoteReview.mockResolvedValueOnce({ ok: true, jaSolicitado: false });
    const second = await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(second.executed).toBe(true);
    expect(second.alreadyExisted).toBe(true);
    expect(second.draftCreated).toBe(false);
    expect(mockCreateVitreDraft).toHaveBeenCalledTimes(2); // sempre chamado (idempotente no writer), nunca duplica doc
  });
});

describe("executeReadyCatalogDraftSideEffects — requestId determinístico (compatível com o fluxo real)", () => {
  test("requestId enviado ao handoff é determinístico por conversationId, no MESMO formato do fluxo real (catalog_tools.ts)", async () => {
    await executeReadyCatalogDraftSideEffects({ conversationId: CONV, organizationId: ORG, channelPhone: null, catalogGroups: [VALID_GROUP], draft: readyDraft() });
    expect(mockRequestQuoteReview).toHaveBeenCalledWith(expect.objectContaining({ requestId: `valeria2_quote_review_${CONV}`, motivo: "QUOTE_REVIEW" }));
  });
});
