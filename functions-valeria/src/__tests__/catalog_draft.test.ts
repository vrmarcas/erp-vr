/**
 * catalog_draft.test.ts — ValerIA 2.0, Fase B (2026-09-19, revisado).
 * Cobre só as funções puras (mergeSignalsIntoDraft/computeQualificationState).
 * loadCatalogDraft/saveCatalogDraft/markCatalogDraftPromoted exigem
 * Firestore real (mesma disciplina do resto do módulo).
 */
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState, CatalogDraft, formatPersonalizationForObservacoes } from "../catalog_draft";
import { ResolutionResult } from "../product_resolution";

function resolution(overrides: Partial<ResolutionResult>): ResolutionResult {
  return {
    resolutionType: "AMBIGUOUS",
    matchedProductId: null,
    matchedProductSku: null,
    catalogGroupId: null,
    baseCatalogGroupId: null,
    baseProductId: null,
    baseProductSku: null,
    clientConfirmed: false,
    matchConfidence: 0,
    customizationRequired: false,
    customizationReason: null,
    suggestedOption: null,
    reasonCode: "TEST",
    ...overrides,
  };
}

describe("mergeSignalsIntoDraft", () => {
  test("aplica resolution e novos campos, registrando a origem (source)", () => {
    const draft = emptyCatalogDraft("conv1");
    const next = mergeSignalsIntoDraft(
      draft,
      resolution({ resolutionType: "EXACT_CATALOG_MATCH", matchedProductId: "C4TC3M", catalogGroupId: "caixa_tampa_correr" }),
      { quantity: 20 },
      "CUSTOMER"
    );
    expect(next.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(next.matchedProductId).toBe("C4TC3M");
    expect(next.fields.quantity).toBe(20);
    expect(next.fieldSources.quantity).toBe("CUSTOMER");
  });

  test("não apaga matchedProductId anterior quando o turno seguinte é AMBIGUOUS", () => {
    let draft = emptyCatalogDraft("conv1");
    draft = mergeSignalsIntoDraft(
      draft,
      resolution({ resolutionType: "EXACT_CATALOG_MATCH", matchedProductId: "C4TC3M" }),
      {},
      "CUSTOMER"
    );
    const next = mergeSignalsIntoDraft(draft, resolution({ resolutionType: "AMBIGUOUS" }), {}, "CUSTOMER");
    expect(next.matchedProductId).toBe("C4TC3M");
  });

  test("source não é aplicado a campos que não mudaram neste turno", () => {
    const draft = emptyCatalogDraft("conv1");
    const next = mergeSignalsIntoDraft(draft, null, { quantity: 5 }, "CUSTOMER");
    expect(next.fieldSources.desiredDeadline).toBeUndefined();
  });

  test("defaults herdados do produto/grupo (source=CATALOG_GROUP) são sobrescritos por CUSTOMER depois", () => {
    let draft = emptyCatalogDraft("conv1");
    draft = mergeSignalsIntoDraft(draft, null, { personalization: ["material_default_cristal"] }, "CATALOG_GROUP");
    expect(draft.fieldSources.personalization).toBe("CATALOG_GROUP");
    draft = mergeSignalsIntoDraft(draft, null, { personalization: ["espelhado"] }, "CUSTOMER");
    expect(draft.fields.personalization).toEqual(["espelhado"]);
    expect(draft.fieldSources.personalization).toBe("CUSTOMER");
  });

  test("A. baseCatalogGroupId nunca é salvo como baseProductId, mesmo fundindo repetidamente", () => {
    let draft = emptyCatalogDraft("conv1");
    draft = mergeSignalsIntoDraft(
      draft,
      resolution({ resolutionType: "CUSTOM_REQUIRED", baseCatalogGroupId: "caixa_tampa_correr", baseProductId: null }),
      {},
      "CUSTOMER"
    );
    expect(draft.baseCatalogGroupId).toBe("caixa_tampa_correr");
    expect(draft.baseProductId).toBeNull();
  });

  test("C. custom a partir de SKU concreto preserva baseCatalogGroupId E baseProductId simultaneamente", () => {
    let draft = emptyCatalogDraft("conv1");
    draft = mergeSignalsIntoDraft(
      draft,
      resolution({ resolutionType: "CUSTOM_REQUESTED", baseCatalogGroupId: "caixa_tampa_correr", baseProductId: "C4TC3M" }),
      {},
      "CUSTOMER"
    );
    expect(draft.baseCatalogGroupId).toBe("caixa_tampa_correr");
    expect(draft.baseProductId).toBe("C4TC3M");
  });
});

describe("computeQualificationState", () => {
  function draftWith(overrides: Partial<CatalogDraft>): CatalogDraft {
    return { ...emptyCatalogDraft("conv1"), ...overrides };
  }

  test("UNSUPPORTED → status UNSUPPORTED, sem pendências (vai para humano)", () => {
    const r = computeQualificationState(draftWith({ resolutionType: "UNSUPPORTED" }));
    expect(r.qualificationStatus).toBe("UNSUPPORTED");
    expect(r.missingFields).toEqual([]);
  });

  test("D/E. CUSTOM_REQUIRED/CUSTOM_REQUESTED → ROUTED_TO_CUSTOM, NÃO é handoff humano (ValerIA continua conduzindo via TechnicalBriefing)", () => {
    expect(computeQualificationState(draftWith({ resolutionType: "CUSTOM_REQUIRED" })).qualificationStatus).toBe("ROUTED_TO_CUSTOM");
    expect(computeQualificationState(draftWith({ resolutionType: "CUSTOM_REQUESTED" })).qualificationStatus).toBe("ROUTED_TO_CUSTOM");
    // nenhum desses states é "UNSUPPORTED" (o único que de fato sinaliza necessidade de humano neste módulo)
    expect(computeQualificationState(draftWith({ resolutionType: "CUSTOM_REQUIRED" })).qualificationStatus).not.toBe("UNSUPPORTED");
  });

  test("CATALOG_OPTION_AVAILABLE sem confirmação → AWAITING_CLIENT_CONFIRMATION", () => {
    const r = computeQualificationState(draftWith({ resolutionType: "CATALOG_OPTION_AVAILABLE", clientConfirmed: false }));
    expect(r.qualificationStatus).toBe("AWAITING_CLIENT_CONFIRMATION");
    expect(r.missingFields).toEqual(["clientConfirmation"]);
  });

  test("CATALOG_OPTION_AVAILABLE confirmado, sem quantity → QUALIFYING_CATALOG com missingFields=[quantity]", () => {
    const r = computeQualificationState(
      draftWith({ resolutionType: "CATALOG_OPTION_AVAILABLE", clientConfirmed: true, matchedProductId: "C4TC3M" })
    );
    expect(r.qualificationStatus).toBe("QUALIFYING_CATALOG");
    expect(r.missingFields).toEqual(["quantity"]);
  });

  test("EXACT_CATALOG_MATCH + quantity preenchida → READY_CATALOG_DRAFT", () => {
    const draft = draftWith({ resolutionType: "EXACT_CATALOG_MATCH", matchedProductId: "C4TC3M" });
    draft.fields.quantity = 10;
    const r = computeQualificationState(draft);
    expect(r.qualificationStatus).toBe("READY_CATALOG_DRAFT");
    expect(r.missingFields).toEqual([]);
  });

  test("EXACT_CATALOG_MATCH nunca promove sozinho sem quantity (não pula etapa)", () => {
    const r = computeQualificationState(draftWith({ resolutionType: "EXACT_CATALOG_MATCH", matchedProductId: "C4TC3M" }));
    expect(r.qualificationStatus).not.toBe("READY_CATALOG_DRAFT");
    expect(r.missingFields).toContain("quantity");
  });

  test("quantity=0 não conta como preenchida", () => {
    const draft = draftWith({ resolutionType: "EXACT_CATALOG_MATCH", matchedProductId: "C4TC3M" });
    draft.fields.quantity = 0;
    const r = computeQualificationState(draft);
    expect(r.missingFields).toContain("quantity");
  });

  test("AMBIGUOUS sem grupo → falta catalogGroupId; com grupo → falta tamanho", () => {
    expect(computeQualificationState(draftWith({ resolutionType: "AMBIGUOUS" })).missingFields).toEqual(["catalogGroupId"]);
    expect(
      computeQualificationState(draftWith({ resolutionType: "AMBIGUOUS", catalogGroupId: "caixa_moldura" })).missingFields
    ).toEqual(["tamanho"]);
  });
});

describe("formatPersonalizationForObservacoes — Fase E.2.42 (ponte personalization → vitre_orcamentos.observacoes)", () => {
  test("lista vazia/ausente → undefined (nunca sobrescreve observacoes manual com string vazia)", () => {
    expect(formatPersonalizationForObservacoes(undefined)).toBeUndefined();
    expect(formatPersonalizationForObservacoes(null)).toBeUndefined();
    expect(formatPersonalizationForObservacoes([])).toBeUndefined();
  });

  test("lista só com strings vazias/whitespace → undefined", () => {
    expect(formatPersonalizationForObservacoes(["", "   "])).toBeUndefined();
  });

  test("1 item → texto formatado com prefixo identificando a origem", () => {
    expect(formatPersonalizationForObservacoes(["Aplicar logo do cliente"])).toBe("Personalização (ValerIA): Aplicar logo do cliente");
  });

  test("múltiplos itens → unidos por '; ', itens vazios filtrados", () => {
    expect(formatPersonalizationForObservacoes(["Logo do cliente", "", "Nome Fazenda Santa Luzia gravado na tampa"])).toBe(
      "Personalização (ValerIA): Logo do cliente; Nome Fazenda Santa Luzia gravado na tampa"
    );
  });

  test("nunca altera preço/SKU — é só texto, sem nenhum efeito numérico", () => {
    const texto = formatPersonalizationForObservacoes(["Logo do cliente"]);
    expect(typeof texto).toBe("string");
    expect(texto).not.toMatch(/\d/); // nenhum número (preço/desconto) é injetado por esta função
  });
});
