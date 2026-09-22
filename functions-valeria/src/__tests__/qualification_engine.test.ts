/**
 * qualification_engine.test.ts — ValerIA 2.0, Fase B (fechamento, 2026-09-19).
 */
import { validateMatchedProduct, computeNextAction, buildQualificationOutput } from "../qualification_engine";
import { CatalogGroup } from "../product_resolution";
import { V2EligibilityProductInput } from "../valeria_v2_eligibility";
import { emptyCatalogDraft } from "../catalog_draft";

const GROUP: CatalogGroup = {
  catalogGroupId: "caixa_tampa_de_correr",
  categoria: "caixas",
  nome: "Caixa com tampa de correr",
  aliases: ["tampa de correr"],
  toleranciaCm: null,
  tamanhos: [
    { tamanho: "P", larguraCm: 20, alturaCm: 20, profundidadeCm: 4, vitreProductId: "C4TC3P", vitreProductSku: "C4TC3P" },
    { tamanho: "M", larguraCm: 30, alturaCm: 30, profundidadeCm: 4, vitreProductId: "C4TC3M", vitreProductSku: "C4TC3M" },
    { tamanho: "G", larguraCm: 40, alturaCm: 40, profundidadeCm: 4, vitreProductId: "C4TC3G", vitreProductSku: "C4TC3G" },
  ],
};

// Shape real dos 12 SKUs auditados: nível 1 no gate legado (sem fotos/
// prazoDias/embalagem/pesoKg/categoria), mas com tudo que a V2 precisa.
function eligibleProduct(overrides: Partial<V2EligibilityProductInput> = {}): V2EligibilityProductInput {
  return {
    id: "C4TC3M",
    sku: "C4TC3M",
    nome: "Caixa 4mm, tampa de correr 3mm",
    status: "ativo",
    precoVenda: 165,
    larguraCm: 30,
    alturaCm: 30,
    profundidadeCm: 4,
    ...overrides,
  };
}

describe("validateMatchedProduct — H. productId vindo do LLM nunca é confiado direto", () => {
  test("candidato null → inválido", () => {
    expect(validateMatchedProduct(null, GROUP, null).reasonCode).toBe("NO_CANDIDATE");
  });

  test("produto não encontrado no Firestore → inválido", () => {
    expect(validateMatchedProduct("C4TC3M", GROUP, null).reasonCode).toBe("PRODUCT_NOT_FOUND");
  });

  test("productId sugerido não bate com o produto realmente carregado → inválido (nunca confia no valor solto)", () => {
    const r = validateMatchedProduct("C4TC3M", GROUP, eligibleProduct({ id: "OUTRO_ID" }));
    expect(r.valid).toBe(false);
    expect(r.reasonCode).toBe("ID_MISMATCH");
  });

  test("produto existe e é elegível, mas não pertence ao grupo resolvido → inválido", () => {
    const outroGrupo: CatalogGroup = { ...GROUP, tamanhos: [{ tamanho: "P", larguraCm: 1, alturaCm: 1, vitreProductId: "OUTRO", vitreProductSku: "OUTRO" }] };
    expect(validateMatchedProduct("C4TC3M", outroGrupo, eligibleProduct({ id: "C4TC3M" })).reasonCode).toBe("NOT_IN_GROUP");
    expect(validateMatchedProduct("C4TC3M", GROUP, eligibleProduct({ id: "C4TC3M" })).valid).toBe(true); // controle: com o grupo certo, é válido
  });

  test("shape real dos 12 SKUs auditados (nível 1 no gate legado) É válido para V2 — canônico/elegível-V2/ativo-V1 são conceitos separados", () => {
    // Sem ativoValeria no input: a V2 não lê esse campo. O produto está no
    // grupo (homologadoNoGrupoV2), status ativo, preço e dimensões
    // presentes — isso já é suficiente para a V2, mesmo que o gate legado
    // (produtoElegivelValeria) continuasse recusando por falta de fotos/
    // prazoDias/embalagem/pesoKg/categoria.
    expect(validateMatchedProduct("C4TC3M", GROUP, eligibleProduct()).valid).toBe(true);
  });

  test("F. produto duplicate/renamed (status != 'ativo') não é elegível para V2", () => {
    const r = validateMatchedProduct("C4TC3M", GROUP, eligibleProduct({ status: "renomeado" }));
    expect(r.valid).toBe(false);
    expect(r.reasonCode).toBe("NOT_ELIGIBLE");
  });

  test("sem preço ou sem dimensões → não elegível para V2", () => {
    expect(validateMatchedProduct("C4TC3M", GROUP, eligibleProduct({ precoVenda: null })).valid).toBe(false);
    expect(validateMatchedProduct("C4TC3M", GROUP, eligibleProduct({ larguraCm: null })).valid).toBe(false);
  });
});

describe("computeNextAction — backend decide o que falta, sem texto pronto", () => {
  test("UNSUPPORTED → ESCALATE_UNSUPPORTED", () => {
    expect(computeNextAction({ qualificationStatus: "UNSUPPORTED", missingFields: [] }).nextAction).toBe("ESCALATE_UNSUPPORTED");
  });

  test("AWAITING_CLIENT_CONFIRMATION → CONFIRM_CATALOG_OPTION com contexto, sem frase pronta", () => {
    const r = computeNextAction(
      { qualificationStatus: "AWAITING_CLIENT_CONFIRMATION", missingFields: ["clientConfirmation"] },
      { suggestedOptionLabel: "M (30x30x4)" }
    );
    expect(r.nextAction).toBe("CONFIRM_CATALOG_OPTION");
    expect(r.questionContext.suggestedSizeLabel).toBe("M (30x30x4)");
  });

  test("D/E. ROUTED_TO_CUSTOM → CONTINUE_CUSTOM_TECHNICAL_BRIEFING, NUNCA ESCALATE (personalizado não é handoff)", () => {
    const r = computeNextAction({ qualificationStatus: "ROUTED_TO_CUSTOM", missingFields: [] });
    expect(r.nextAction).toBe("CONTINUE_CUSTOM_TECHNICAL_BRIEFING");
    expect(r.nextAction).not.toBe("ESCALATE_UNSUPPORTED");
  });

  test("READY_CATALOG_DRAFT + catalogDraftCreatedThisCall=true → REQUEST_QUOTE_REVIEW (backend já criou o rascunho, não pede pro LLM criar)", () => {
    expect(
      computeNextAction({ qualificationStatus: "READY_CATALOG_DRAFT", missingFields: [] }, { catalogDraftCreatedThisCall: true }).nextAction
    ).toBe("REQUEST_QUOTE_REVIEW");
  });

  test("Fase E.2.27 — READY_CATALOG_DRAFT SEM catalogDraftCreatedThisCall → READY_FOR_QUOTE_REVIEW, NUNCA REQUEST_QUOTE_REVIEW (dados completos ≠ ação já executada)", () => {
    const r = computeNextAction({ qualificationStatus: "READY_CATALOG_DRAFT", missingFields: [] });
    expect(r.nextAction).toBe("READY_FOR_QUOTE_REVIEW");
    expect(r.nextAction).not.toBe("REQUEST_QUOTE_REVIEW");
  });

  test("Fase E.2.27 — READY_CATALOG_DRAFT + catalogDraftCreatedThisCall=false (explícito) → também READY_FOR_QUOTE_REVIEW", () => {
    const r = computeNextAction({ qualificationStatus: "READY_CATALOG_DRAFT", missingFields: [] }, { catalogDraftCreatedThisCall: false });
    expect(r.nextAction).toBe("READY_FOR_QUOTE_REVIEW");
  });

  test("QUALIFYING_CATALOG sem grupo → ASK_MODEL; com grupo sem tamanho → ASK_SIZE; com produto sem quantidade → ASK_QUANTITY", () => {
    expect(computeNextAction({ qualificationStatus: "QUALIFYING_CATALOG", missingFields: ["catalogGroupId"] }).nextAction).toBe("ASK_MODEL");
    expect(computeNextAction({ qualificationStatus: "QUALIFYING_CATALOG", missingFields: ["tamanho"] }).nextAction).toBe("ASK_SIZE");
    expect(computeNextAction({ qualificationStatus: "QUALIFYING_CATALOG", missingFields: ["quantity"] }).nextAction).toBe("ASK_QUANTITY");
  });

  test("A/F. produto identificado mas faltando quantidade → nextAction nunca é REQUEST_QUOTE_REVIEW (catalog_tools.ts só cria o rascunho quando qualificationStatus===READY_CATALOG_DRAFT)", () => {
    const r = computeNextAction({ qualificationStatus: "QUALIFYING_CATALOG", missingFields: ["quantity"] });
    expect(r.nextAction).not.toBe("REQUEST_QUOTE_REVIEW");
    expect(r.nextAction).toBe("ASK_QUANTITY");
  });
});

describe("buildQualificationOutput — payload final (seção 14)", () => {
  test("expõe matchedProduct/baseProduct como {id,sku} separados e o bloco persistence", () => {
    const draft = {
      ...emptyCatalogDraft("conv1"),
      resolutionType: "EXACT_CATALOG_MATCH" as const,
      matchedProductId: "C4TC3M",
      matchedProductSku: "C4TC3M",
      baseCatalogGroupId: null,
      baseProductId: null,
      baseProductSku: null,
    };
    const qualification = { qualificationStatus: "READY_CATALOG_DRAFT" as const, missingFields: [] };
    const next = { nextAction: "REQUEST_QUOTE_REVIEW" as const, questionContext: {} };
    const persistence = { qualificationUpdated: true, technicalBriefingUpdated: false, catalogDraftCreated: true, quoteReviewCreated: true };

    const output = buildQualificationOutput(draft, qualification, next, persistence);
    expect(output.matchedProduct).toEqual({ id: "C4TC3M", sku: "C4TC3M" });
    expect(output.baseProduct).toEqual({ id: null, sku: null });
    expect(output.persistence).toEqual(persistence);
    expect(output.nextAction).toBe("REQUEST_QUOTE_REVIEW");
  });
});
