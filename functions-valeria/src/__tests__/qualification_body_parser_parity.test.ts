/**
 * qualification_body_parser_parity.test.ts — ValerIA 2.0, Fase E.2 (2026-09-20).
 *
 * Seção 11 do checkpoint: prova que um request com tipos NATIVOS e um
 * request com os MESMOS dados totalmente serializados como STRING (o
 * único formato comprovado no schema JSON do ChatVolt hoje, ver
 * http_field_parsers.ts) produzem a mesma saída relevante depois de passar
 * por parseUpdateQualificationBody + toda a cadeia de decisão pura que
 * `catalog_tools.ts::valeriaUpdateCatalogQualification` orquestra
 * (resolveProductMatch → mergeSignalsIntoDraft → computeQualificationState
 * → computeNextAction) — mesmo padrão de e2e_fase_e_cenarios_ab_h.test.ts.
 *
 * 3 cenários (seção 11): catálogo M + quantity, custom por dimensões
 * exatas, e personalização comercial (array).
 */
import { parseUpdateQualificationBody } from "../qualification_body_parser";
import { resolveProductMatch, CatalogGroup, ResolutionSignals } from "../product_resolution";
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState, CatalogDraft, FieldUpdate } from "../catalog_draft";
import { computeNextAction } from "../qualification_engine";

const CAIXA_TAMPA_CORRER: CatalogGroup = {
  catalogGroupId: "caixa_tampa_de_correr",
  categoria: "caixas",
  nome: "Caixa com tampa de correr",
  aliases: ["tampa de correr", "caixa tampa de correr"],
  materialPadrao: "Acrílico cristal 4mm (corpo) / 3mm (tampa)",
  espessuraPadraoMm: 4,
  toleranciaCm: null,
  tamanhos: [
    { tamanho: "P", larguraCm: 20, alturaCm: 20, profundidadeCm: 4, vitreProductId: "C4TC3P", vitreProductSku: "C4TC3P", catalogPublishedPrice: 85, pageNumber: 3 },
    { tamanho: "M", larguraCm: 30, alturaCm: 30, profundidadeCm: 4, vitreProductId: "C4TC3M", vitreProductSku: "C4TC3M", catalogPublishedPrice: 165, pageNumber: 3 },
    { tamanho: "G", larguraCm: 40, alturaCm: 40, profundidadeCm: 4, vitreProductId: "C4TC3G", vitreProductSku: "C4TC3G", catalogPublishedPrice: 270, pageNumber: 3 },
  ],
};

const GROUPS = [CAIXA_TAMPA_CORRER];

/** Mesma orquestração pura que a Tool real faz depois do parsing do body (catalog_tools.ts). */
function runTurn(draft: CatalogDraft, body: Record<string, unknown>) {
  const parsed = parseUpdateQualificationBody(body);
  const categoria = parsed.categoria || draft.category || null;

  const signals: ResolutionSignals = {
    categoria,
    explicitSkuOrProductId: parsed.explicitSkuOrProductId,
    groupNameOrAlias: parsed.groupNameOrAlias,
    catalogSizeLabel: parsed.catalogSizeLabel,
    exactDimensionsCm: parsed.exactDimensionsCm,
    vagueSizeHintCm: parsed.vagueSizeHintCm,
    customerExplicitlyRequestsCustom: parsed.customerExplicitlyRequestsCustom,
    contextCatalogGroupId: draft.baseCatalogGroupId || draft.catalogGroupId || null,
    contextMatchedProductId: draft.matchedProductId || draft.baseProductId || null,
    contextMatchedProductSku: draft.matchedProductSku || draft.baseProductSku || null,
    clientConfirmedSuggestedOption: parsed.clientConfirmedSuggestedOption,
  };

  const resolution = resolveProductMatch(signals, GROUPS);

  const fieldUpdate: FieldUpdate = {
    category: categoria,
    quantity: parsed.quantity,
    customDimensions: parsed.customDimensions,
    personalization: parsed.personalization,
    desiredDeadline: parsed.desiredDeadline,
    deliveryData: parsed.deliveryData,
  };

  const novoDraft = mergeSignalsIntoDraft(draft, resolution, fieldUpdate, "CUSTOMER");
  const qualification = computeQualificationState(novoDraft);
  novoDraft.qualificationStatus = qualification.qualificationStatus;
  novoDraft.missingFields = qualification.missingFields;
  const { nextAction } = computeNextAction(qualification, {
    matchedProductName: null,
    suggestedOptionLabel: resolution.suggestedOption ? `${resolution.suggestedOption.tamanho}` : null,
    groupName: resolution.catalogGroupId ?? null,
    catalogDraftCreatedThisCall: false,
  });

  return { resolution, draft: novoDraft, qualification, nextAction };
}

/** Só compara o que é contrato observável pela ValerIA — nunca campos internos irrelevantes (timestamps etc.). */
function relevantOutput(turn: ReturnType<typeof runTurn>) {
  return {
    resolutionType: turn.resolution.resolutionType,
    matchedProductId: turn.resolution.matchedProductId,
    matchedProductSku: turn.resolution.matchedProductSku,
    baseProductId: turn.resolution.baseProductId,
    baseProductSku: turn.resolution.baseProductSku,
    qualificationStatus: turn.qualification.qualificationStatus,
    missingFields: turn.qualification.missingFields,
    nextAction: turn.nextAction,
    fields: turn.draft.fields,
  };
}

describe("Paridade string × native — valeriaUpdateCatalogQualification", () => {
  // Cenário 1: caixa M + quantity 10
  test("1. caixa M + quantity: native vs. tudo-string produzem a mesma saída", () => {
    const bodyNative: Record<string, unknown> = {
      categoria: "caixas",
      groupNameOrAlias: "tampa de correr",
      catalogSizeLabel: "M",
      quantity: 10,
    };
    const bodyString: Record<string, unknown> = {
      categoria: "caixas",
      groupNameOrAlias: "tampa de correr",
      catalogSizeLabel: "M",
      quantity: "10",
    };
    const turnNative = runTurn(emptyCatalogDraft("conv-parity-1a"), bodyNative);
    const turnString = runTurn(emptyCatalogDraft("conv-parity-1b"), bodyString);
    expect(relevantOutput(turnString)).toEqual(relevantOutput(turnNative));
    expect(turnNative.qualification.qualificationStatus).toBe("READY_CATALOG_DRAFT");
  });

  // Cenário 2: custom 35x25x10
  test("2. custom por dimensões exatas: native vs. tudo-string produzem a mesma saída", () => {
    const bodyNative: Record<string, unknown> = {
      categoria: "caixas",
      groupNameOrAlias: "tampa de correr",
      exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 },
      customerExplicitlyRequestsCustom: true,
    };
    const bodyString: Record<string, unknown> = {
      categoria: "caixas",
      groupNameOrAlias: "tampa de correr",
      exactDimensionsCm: '{"largura":35,"altura":25,"profundidade":10}',
      customerExplicitlyRequestsCustom: "true",
    };
    const turnNative = runTurn(emptyCatalogDraft("conv-parity-2a"), bodyNative);
    const turnString = runTurn(emptyCatalogDraft("conv-parity-2b"), bodyString);
    expect(relevantOutput(turnString)).toEqual(relevantOutput(turnNative));
    // customerExplicitlyRequestsCustom + grupo já identificado no mesmo turno → CUSTOM_REQUESTED (regra 4b,
    // preserva base), não CUSTOM_REQUIRED (que exige ausência de grupo/produto de referência).
    expect(turnNative.resolution.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(turnNative.resolution.baseCatalogGroupId).toBe("caixa_tampa_de_correr");
  });

  // Cenário 3: personalização comercial (array) sobre draft já com produto de catálogo resolvido
  test("3. personalização comercial (array): native vs. tudo-string produzem a mesma saída", () => {
    const draftBaseA = runTurn(emptyCatalogDraft("conv-parity-3a"), {
      categoria: "caixas",
      groupNameOrAlias: "tampa de correr",
      catalogSizeLabel: "M",
    }).draft;
    const draftBaseB = runTurn(emptyCatalogDraft("conv-parity-3b"), {
      categoria: "caixas",
      groupNameOrAlias: "tampa de correr",
      catalogSizeLabel: "M",
    }).draft;

    const bodyNative: Record<string, unknown> = {
      categoria: "caixas",
      quantity: 5,
      personalization: ["logo_evento", "nome_joao"],
    };
    const bodyString: Record<string, unknown> = {
      categoria: "caixas",
      quantity: "5",
      personalization: '["logo_evento","nome_joao"]',
    };

    const turnNative = runTurn(draftBaseA, bodyNative);
    const turnString = runTurn(draftBaseB, bodyString);
    expect(relevantOutput(turnString)).toEqual(relevantOutput(turnNative));
    expect(turnNative.draft.fields.personalization).toEqual(["logo_evento", "nome_joao"]);
  });
});
