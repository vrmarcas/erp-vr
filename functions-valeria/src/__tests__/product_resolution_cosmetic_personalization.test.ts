/**
 * product_resolution_cosmetic_personalization.test.ts — ValerIA 2.0,
 * Fase E.2.42 (2026-09-22).
 *
 * Fecha o gap identificado na Fase E.2.41: `personalization` era escrito no
 * draft mas nunca influenciava resolveProductMatch — qualquer pedido de
 * personalização (cosmética ou estrutural) caía indistintamente em
 * CUSTOM_REQUESTED/CUSTOM_REQUIRED. Regra 4b agora consulta
 * classifyPersonalizationText: COSMETIC + SKU concreto já resolvido (turno
 * atual ou contexto) → preserva EXACT_CATALOG_MATCH; STRUCTURAL/UNKNOWN →
 * comportamento custom inalterado (nunca facilita orçamento automático por
 * ambiguidade).
 *
 * Mesmo fixture/padrão de product_resolution_custom_from_selected_sku.test.ts
 * (grupo real "caixa tampa de correr", sinais de contexto derivados do
 * draft persistido — nunca objetos isolados inventados pelo teste).
 */
import { resolveProductMatch, CatalogGroup } from "../product_resolution";
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState, CatalogDraft } from "../catalog_draft";

const CAIXA_TAMPA_CORRER: CatalogGroup = {
  catalogGroupId: "caixa_tampa_de_correr",
  categoria: "caixas",
  nome: "Caixa com tampa de correr",
  aliases: ["tampa de correr", "caixa tampa de correr"],
  materialPadrao: "Acrílico cristal 4mm (corpo) / 3mm (tampa)",
  espessuraPadraoMm: 4,
  toleranciaCm: null,
  tamanhos: [
    { tamanho: "P", larguraCm: 20, alturaCm: 20, profundidadeCm: 4, vitreProductId: "C4TC3P", vitreProductSku: "C4TC3P", catalogPublishedPrice: 85 },
    { tamanho: "M", larguraCm: 30, alturaCm: 30, profundidadeCm: 4, vitreProductId: "C4TC3M", vitreProductSku: "C4TC3M", catalogPublishedPrice: 165 },
    { tamanho: "G", larguraCm: 40, alturaCm: 40, profundidadeCm: 4, vitreProductId: "C4TC3G", vitreProductSku: "C4TC3G", catalogPublishedPrice: 270 },
  ],
};
const GROUPS = [CAIXA_TAMPA_CORRER];

function contextFromDraft(draft: CatalogDraft) {
  return {
    contextCatalogGroupId: draft.baseCatalogGroupId || draft.catalogGroupId || null,
    contextMatchedProductId: draft.matchedProductId || draft.baseProductId || null,
    contextMatchedProductSku: draft.matchedProductSku || draft.baseProductSku || null,
  };
}

describe('"Quero essa caixa M com meu logo" — cosmético MESMO TURNO (tamanho + personalização juntos) → EXACT_CATALOG_MATCH', () => {
  test("catalogSizeLabel=M + customerExplicitlyRequestsCustom=true + personalization COSMETIC → mantém C4TC3M, nunca custom", () => {
    const r = resolveProductMatch(
      {
        groupNameOrAlias: "tampa de correr",
        catalogSizeLabel: "M",
        customerExplicitlyRequestsCustom: true,
        personalization: ["Aplicar logo do cliente"],
      },
      GROUPS
    );
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C4TC3M");
    expect(r.matchedProductSku).toBe("C4TC3M");
    expect(r.customizationRequired).toBe(false);
    expect(r.reasonCode).toBe("COSMETIC_PERSONALIZATION_KEEPS_SKU");
  });
});

describe('"Quero essa caixa M com o nome Fazenda Santa Luzia" — mesmo caso, texto de personalização diferente', () => {
  test("personalization COSMETIC (nome gravado) → EXACT_CATALOG_MATCH", () => {
    const r = resolveProductMatch(
      {
        groupNameOrAlias: "tampa de correr",
        catalogSizeLabel: "M",
        customerExplicitlyRequestsCustom: true,
        personalization: ["Nome Fazenda Santa Luzia gravado na tampa"],
      },
      GROUPS
    );
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C4TC3M");
  });
});

describe("cosmético via CONTEXTO (turno anterior já resolveu o SKU, turno atual só traz a personalização)", () => {
  test("turno 1 resolve C4TC3M | turno 2 'quero com meu logo' → continua C4TC3M, EXACT_CATALOG_MATCH", () => {
    let draft = emptyCatalogDraft("conv-cosmetic-context");
    const r1 = resolveProductMatch({ groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M" }, GROUPS);
    expect(r1.resolutionType).toBe("EXACT_CATALOG_MATCH");
    draft = mergeSignalsIntoDraft(draft, r1, { quantity: 20, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null }, "CUSTOMER");

    const ctx = contextFromDraft(draft);
    const r2 = resolveProductMatch(
      { customerExplicitlyRequestsCustom: true, personalization: ["Aplicar logo do cliente"], ...ctx },
      GROUPS
    );
    expect(r2.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r2.matchedProductId).toBe("C4TC3M");

    draft = mergeSignalsIntoDraft(draft, r2, { quantity: null, customDimensions: null, personalization: ["Aplicar logo do cliente"], desiredDeadline: null, deliveryData: null }, "CUSTOMER");
    const qualification = computeQualificationState(draft);
    draft.qualificationStatus = qualification.qualificationStatus;
    // continua pronto para virar rascunho Vitre — personalização nunca derruba para ROUTED_TO_CUSTOM.
    expect(draft.qualificationStatus).toBe("READY_CATALOG_DRAFT");
    expect(draft.fields.personalization).toEqual(["Aplicar logo do cliente"]);
  });
});

describe('"Quero essa caixa M em outro material" — estrutural → custom/VR, nunca cosmético', () => {
  test("personalization STRUCTURAL → CUSTOM_REQUESTED (comportamento existente preservado)", () => {
    const r = resolveProductMatch(
      {
        groupNameOrAlias: "tampa de correr",
        catalogSizeLabel: "M",
        customerExplicitlyRequestsCustom: true,
        personalization: ["Cliente pediu outro material"],
      },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.matchedProductId).toBeNull();
    expect(r.baseProductId).toBe("C4TC3M"); // referência preservada, mas SKU não é mais o final
    expect(r.customizationRequired).toBe(true);
  });
});

describe('"Quero ela com 47x32x18" — dimensão fora do padrão já derruba via regra 5 (nem chega na 4b), continua STRUCTURAL', () => {
  test("dimensão exata sem match no grupo, com produto em contexto → CUSTOM_REQUESTED, nunca EXACT_CATALOG_MATCH", () => {
    let draft = emptyCatalogDraft("conv-dim-fora-padrao");
    const r1 = resolveProductMatch({ groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M" }, GROUPS);
    draft = mergeSignalsIntoDraft(draft, r1, { quantity: null, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null }, "CUSTOMER");
    const ctx = contextFromDraft(draft);
    const r2 = resolveProductMatch({ exactDimensionsCm: { largura: 47, altura: 32, profundidade: 18 }, ...ctx }, GROUPS);
    expect(r2.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r2.matchedProductId).toBeNull();
  });
});

describe('"Quero uma divisória interna diferente" — estrutural, sem grupo/produto de referência → CUSTOM_REQUIRED (regra 4a inalterada)', () => {
  test("sem contexto algum → CUSTOM_REQUIRED, classificador nem é consultado (regra 4a não tem SKU pra preservar)", () => {
    const r = resolveProductMatch(
      { customerExplicitlyRequestsCustom: true, personalization: ["Divisória interna diferente"] },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUIRED");
    expect(r.matchedProductId).toBeNull();
  });
});

describe('"Quero personalizar" sem detalhe suficiente — UNKNOWN nunca vira cosmético, mesmo com SKU resolvido', () => {
  test("personalization UNKNOWN (texto vago) + SKU em contexto → continua CUSTOM_REQUESTED, nunca facilita orçamento automático", () => {
    let draft = emptyCatalogDraft("conv-vago");
    const r1 = resolveProductMatch({ groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M" }, GROUPS);
    draft = mergeSignalsIntoDraft(draft, r1, { quantity: null, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null }, "CUSTOMER");
    const ctx = contextFromDraft(draft);
    const r2 = resolveProductMatch({ customerExplicitlyRequestsCustom: true, personalization: ["Personalizar"], ...ctx }, GROUPS);
    expect(r2.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r2.matchedProductId).toBeNull();
    expect(r2.baseProductId).toBe("C4TC3M");
  });
});

describe("personalization ausente (undefined) com customerExplicitlyRequestsCustom=true — comportamento pré-existente 100% preservado", () => {
  test("sem personalization nenhuma → classifyPersonalizationText(undefined)=UNKNOWN → continua CUSTOM_REQUESTED (regressão)", () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M", customerExplicitlyRequestsCustom: true },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
  });
});
