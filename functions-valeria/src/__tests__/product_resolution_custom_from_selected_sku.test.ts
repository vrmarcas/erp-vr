/**
 * product_resolution_custom_from_selected_sku.test.ts — ValerIA 2.0,
 * Fase E.1.2 (2026-09-20).
 *
 * Achado real do teste HTTP da Fase E.1: turno 1 resolvia C4TC3M (caixa
 * tampa de correr M); turno 2, cliente pede 35x25x10 (medida que não bate
 * com nenhum tamanho do grupo) → resolutionType virava CUSTOM_REQUIRED
 * com baseProductId=null, perdendo a referência ao produto concreto que
 * o cliente já tinha escolhido. Causa raiz: a regra 5 de
 * product_resolution.ts (dimensão exata sem match) sempre zerava
 * baseProductId, sem checar `signals.contextMatchedProductId` — só a
 * regra 4b (customerExplicitlyRequestsCustom=true) preservava o contexto.
 *
 * Corrigido: regra 5 agora vira CUSTOM_REQUESTED (não CUSTOM_REQUIRED) e
 * preserva baseProductId/baseProductSku a partir de
 * signals.contextMatchedProductId/contextMatchedProductSku QUANDO esses
 * sinais existem — exatamente o que catalog_tools.ts já deriva
 * automaticamente do draft persistido (`draftAtual.matchedProductId`),
 * nunca dependendo do LLM reenviar o id.
 *
 * Este teste atravessa a MESMA cadeia que a Tool HTTP usa —
 * mergeSignalsIntoDraft → resolveProductMatch (turno 2) lendo o contexto
 * do draft persistido no turno 1 — não objetos isolados.
 */
import { resolveProductMatch, CatalogGroup, ResolutionSignals } from "../product_resolution";
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState, CatalogDraft } from "../catalog_draft";
import { buildCustomTechnicalBriefingPatch } from "../custom_briefing_patch";

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

/** Deriva os sinais de contexto EXATAMENTE como catalog_tools.ts faz a partir do draft persistido — nunca inventado pelo teste. */
function contextFromDraft(draft: CatalogDraft): Pick<ResolutionSignals, "contextCatalogGroupId" | "contextMatchedProductId" | "contextMatchedProductSku"> {
  return {
    contextCatalogGroupId: draft.baseCatalogGroupId || draft.catalogGroupId || null,
    contextMatchedProductId: draft.matchedProductId || draft.baseProductId || null,
    contextMatchedProductSku: draft.matchedProductSku || draft.baseProductSku || null,
  };
}

describe("TESTE MULTI-TURNO REAL — produto concreto selecionado, depois medida que não bate → CUSTOM_REQUESTED preserva base", () => {
  test("turno 1: 'tampa de correr M' resolve C4TC3M | turno 2: '35x25x10' → CUSTOM_REQUESTED com baseProductId/Sku=C4TC3M", () => {
    let draft = emptyCatalogDraft("conv-multi-turno-custom");

    // Turno 1
    const r1 = resolveProductMatch({ groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M" }, GROUPS);
    expect(r1.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r1.matchedProductId).toBe("C4TC3M");
    expect(r1.matchedProductSku).toBe("C4TC3M");
    draft = mergeSignalsIntoDraft(draft, r1, { quantity: null, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null }, "CUSTOMER");
    expect(draft.matchedProductId).toBe("C4TC3M"); // persistido de verdade — turno 2 lê disto, não de um objeto isolado

    // Turno 2 — sinais derivados do draft PERSISTIDO no turno 1 (mesma
    // derivação de catalog_tools.ts), nunca contextMatchedProductId
    // inventado pelo teste.
    const ctx = contextFromDraft(draft);
    const r2 = resolveProductMatch({ groupNameOrAlias: "tampa de correr", exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 }, ...ctx }, GROUPS);

    expect(r2.resolutionType).toBe("CUSTOM_REQUESTED"); // não mais CUSTOM_REQUIRED
    expect(r2.baseCatalogGroupId).toBe("caixa_tampa_de_correr");
    expect(r2.baseProductId).toBe("C4TC3M"); // produto REAL preservado, nunca null
    expect(r2.baseProductSku).toBe("C4TC3M");

    draft = mergeSignalsIntoDraft(draft, r2, { quantity: null, customDimensions: { larguraCm: 35, alturaCm: 25, profundidadeCm: 10 }, personalization: [], desiredDeadline: null, deliveryData: null }, "CUSTOMER");
    const qualification = computeQualificationState(draft);
    draft.qualificationStatus = qualification.qualificationStatus;
    expect(draft.baseProductId).toBe("C4TC3M");
    expect(draft.baseProductSku).toBe("C4TC3M");
    expect(draft.qualificationStatus).toBe("ROUTED_TO_CUSTOM");

    // TechnicalBriefing recebe os 3 campos — mesmo caminho que catalog_tools.ts usa.
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: draft.baseCatalogGroupId,
      baseProductId: draft.baseProductId,
      baseProductSku: draft.baseProductSku,
      receitaProductId: "Caixa",
      quantity: draft.fields.quantity,
      customDimensions: draft.fields.customDimensions,
      espessuraPadraoMmDoGrupo: CAIXA_TAMPA_CORRER.espessuraPadraoMm ?? null,
      thicknessMmAtual: null,
    });
    expect(patch.baseCatalogGroupId).toBe("caixa_tampa_de_correr");
    expect(patch.baseProductId).toBe("C4TC3M");
    expect(patch.baseProductSku).toBe("C4TC3M");
  });
});

describe("CUSTOM_REQUIRED continua correto quando NENHUM SKU concreto foi selecionado antes", () => {
  test("'caixa tampa de correr 35x25x10' direto, sem escolha prévia de P/M/G → CUSTOM_REQUIRED, baseProductId/Sku=null", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "tampa de correr", exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 } }, GROUPS);
    expect(r.resolutionType).toBe("CUSTOM_REQUIRED");
    expect(r.baseCatalogGroupId).toBe("caixa_tampa_de_correr");
    expect(r.baseProductId).toBeNull();
    expect(r.baseProductSku).toBeNull();
  });
});

describe("Diferenciação explícita CUSTOM_REQUESTED × CUSTOM_REQUIRED (mesma medida, contexto diferente)", () => {
  const GROUP_NAME = "tampa de correr";
  const DIMS = { largura: 35, altura: 25, profundidade: 10 };

  test("COM produto concreto em contexto → CUSTOM_REQUESTED", () => {
    const r = resolveProductMatch({ groupNameOrAlias: GROUP_NAME, exactDimensionsCm: DIMS, contextMatchedProductId: "C4TC3M", contextMatchedProductSku: "C4TC3M" }, GROUPS);
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.baseProductId).toBe("C4TC3M");
  });

  test("SEM produto concreto em contexto (só grupo) → CUSTOM_REQUIRED", () => {
    const r = resolveProductMatch({ groupNameOrAlias: GROUP_NAME, exactDimensionsCm: DIMS }, GROUPS);
    expect(r.resolutionType).toBe("CUSTOM_REQUIRED");
    expect(r.baseProductId).toBeNull();
  });
});
