/**
 * qualificacao_comercial_integracao_turnos.test.ts — rodada "qualificação
 * comercial da Valéria" (2026-10-21).
 *
 * Mesmo estilo/garantia de e2e_fase_e_cenarios_ab_h.test.ts: exercita a
 * cadeia COMPLETA da camada de decisão pura, turno a turno, exatamente
 * como `catalog_tools.ts::valeriaUpdateCatalogQualification` orquestra em
 * produção — incluindo agora o seed/merge do TechnicalBriefing e
 * computeQualificationGaps, que antes desta rodada nunca influenciavam o
 * nextAction devolvido (sempre CONTINUE_CUSTOM_TECHNICAL_BRIEFING, igual
 * para qualquer produto). NÃO é teste de HTTP/rede.
 *
 * Cenários do Gabriel (testes obrigatórios da rodada): caixa 15x20x10 sem
 * encerrar cedo; troféu com/sem referência; placa sem medida/com medida;
 * nunca repete pergunta já respondida.
 */
import { resolveProductMatch, CatalogGroup, ResolutionSignals } from "../product_resolution";
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState, FieldUpdate } from "../catalog_draft";
import { computeNextAction, NextActionContext } from "../qualification_engine";
import { buildCustomTechnicalBriefingPatch, CategoryQualificationSignals } from "../custom_briefing_patch";
import { mergeTechnicalBriefing } from "../technical_briefing_store";
import { emptyTechnicalBriefing, computeQualificationGaps, TechnicalBriefing } from "../technical_briefing";

const CONV = "conv_qual_comercial_teste";

function noSignals(overrides: Partial<ResolutionSignals> = {}): ResolutionSignals {
  return {
    categoria: null,
    explicitSkuOrProductId: null,
    groupNameOrAlias: null,
    catalogSizeLabel: null,
    exactDimensionsCm: null,
    vagueSizeHintCm: null,
    customerExplicitlyRequestsCustom: false,
    contextCatalogGroupId: null,
    contextMatchedProductId: null,
    contextMatchedProductSku: null,
    clientConfirmedSuggestedOption: false,
    personalization: undefined,
    ...overrides,
  };
}

/** Simula UM turno de valeriaUpdateCatalogQualification (versão pura, sem Firestore/HTTP). */
function turno(params: {
  draft: ReturnType<typeof emptyCatalogDraft>;
  technicalBriefing: TechnicalBriefing;
  groups: CatalogGroup[];
  signals: ResolutionSignals;
  fieldUpdate?: Partial<FieldUpdate>;
  categoriaComercial?: "caixa" | "trofeu" | "placa" | undefined;
  categorySignals?: CategoryQualificationSignals | null;
}) {
  const resolution = resolveProductMatch(params.signals, params.groups);
  const fieldUpdate: FieldUpdate = {
    category: params.signals.categoria,
    quantity: null,
    customDimensions: null,
    personalization: undefined,
    desiredDeadline: null,
    deliveryData: null,
    ...params.fieldUpdate,
  };
  const draftAtualizado = mergeSignalsIntoDraft(params.draft, resolution, fieldUpdate, "CUSTOMER");
  const qualification = computeQualificationState(draftAtualizado);
  draftAtualizado.qualificationStatus = qualification.qualificationStatus;
  draftAtualizado.missingFields = qualification.missingFields;

  let technicalBriefing = params.technicalBriefing;
  let technicalNextField: string | null = null;
  let technicalCategory: "caixa" | "trofeu" | "placa" | undefined;

  if (qualification.qualificationStatus === "ROUTED_TO_CUSTOM") {
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: draftAtualizado.baseCatalogGroupId,
      baseProductId: draftAtualizado.baseProductId,
      baseProductSku: draftAtualizado.baseProductSku,
      receitaProductId: null,
      quantity: draftAtualizado.fields.quantity,
      customDimensions: draftAtualizado.fields.customDimensions,
      espessuraPadraoMmDoGrupo: null,
      thicknessMmAtual: technicalBriefing.thicknessMm,
      categoriaComercial: technicalBriefing.categoriaComercial == null ? params.categoriaComercial : undefined,
      categorySignals: params.categorySignals,
    });
    technicalBriefing = mergeTechnicalBriefing(technicalBriefing, patch);
    const gaps = computeQualificationGaps(technicalBriefing);
    technicalNextField = gaps.nextField;
    technicalCategory = gaps.category;
  }

  const context: NextActionContext = { technicalNextField, technicalCategory };
  const next = computeNextAction(qualification, context);

  return { draftAtualizado, technicalBriefing, qualification, next };
}

describe("Caixa 15x20x10 — nunca encerra cedo, pergunta finalidade/espessura/tampa/quantidade em ordem", () => {
  test("medida exata sem grupo de catálogo (categoria ainda não homologada) -> pede modelo (AMBIGUOUS), nunca finaliza sozinho", () => {
    let draft = emptyCatalogDraft(CONV, null, false);
    const r = turno({
      draft,
      technicalBriefing: emptyTechnicalBriefing(),
      groups: [],
      signals: noSignals({ categoria: "caixas" }),
    });
    // Sem nenhum grupo carregado, cai em AMBIGUOUS/QUALIFYING_CATALOG — nunca finaliza/handoff sozinho.
    expect(r.qualification.qualificationStatus).toBe("QUALIFYING_CATALOG");
  });

  test("cliente pede explicitamente sob medida -> ROUTED_TO_CUSTOM, próxima pergunta é finalidade de uso (nunca 'pronto, vou verificar')", () => {
    let draft = emptyCatalogDraft(CONV, null, false);
    const r = turno({
      draft,
      technicalBriefing: emptyTechnicalBriefing(),
      groups: [],
      signals: noSignals({ categoria: "caixas", customerExplicitlyRequestsCustom: true }),
      fieldUpdate: { customDimensions: { larguraCm: 15, alturaCm: 20, profundidadeCm: 10 } },
      categoriaComercial: "caixa",
    });
    expect(r.qualification.qualificationStatus).toBe("ROUTED_TO_CUSTOM");
    expect(r.next.nextAction).toBe("ASK_PURPOSE");
    draft = r.draftAtualizado;

    // Turno 2 — cliente responde a finalidade.
    const r2 = turno({
      draft,
      technicalBriefing: r.technicalBriefing,
      groups: [],
      signals: noSignals({ categoria: "caixas", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "caixa",
      categorySignals: { finalidadeUso: "guardar troféus de uma premiação" },
    });
    expect(r2.next.nextAction).toBe("ASK_THICKNESS"); // espessura ainda não informada

    // Turno 3 — espessura/material resolvidos "fora de banda" (ex.: outra Tool/fluxo) — próximo é tampa.
    const briefingComEspessura: TechnicalBriefing = { ...r2.technicalBriefing, thicknessMm: 3, materialId: "cfg_0" };
    const gaps3 = computeQualificationGaps(briefingComEspessura);
    expect(gaps3.nextField).toBe("temTampa");

    // Turno 4 — cliente quer tampa -> pergunta modelo da tampa antes de quantidade (nunca pula).
    const r4 = turno({
      draft,
      technicalBriefing: briefingComEspessura,
      groups: [],
      signals: noSignals({ categoria: "caixas", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "caixa",
      categorySignals: { temTampa: true },
    });
    expect(r4.next.nextAction).toBe("ASK_LID_MODEL");

    // Turno 5 — modelo de tampa informado -> finalmente pergunta quantidade.
    const r5 = turno({
      draft,
      technicalBriefing: r4.technicalBriefing,
      groups: [],
      signals: noSignals({ categoria: "caixas", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "caixa",
      categorySignals: { tampaModelo: "tampa de encaixe" },
    });
    expect(r5.next.nextAction).toBe("ASK_QUANTITY");
  });
});

describe("Troféu — com referência segue direto para quantidade; sem referência oferece catálogo antes de insistir", () => {
  function iniciarTrofeu() {
    const draft = emptyCatalogDraft(CONV, null, false);
    return turno({
      draft,
      technicalBriefing: emptyTechnicalBriefing(),
      groups: [], // nenhum modelo de catálogo bate (cliente não mencionou Modelo 07/11) — vira sob medida
      signals: noSignals({ categoria: "trofeus", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "trofeu",
    });
  }

  test("primeiro turno: pergunta se o cliente já tem modelo/foto/referência (nunca pula direto para medida/material)", () => {
    const r = iniciarTrofeu();
    expect(r.qualification.qualificationStatus).toBe("ROUTED_TO_CUSTOM");
    expect(r.next.nextAction).toBe("ASK_REFERENCE_MODEL");
  });

  test("cliente manda uma foto de referência -> confirma se é arquivo produtivo antes de seguir", () => {
    const r1 = iniciarTrofeu();
    const r2 = turno({
      draft: r1.draftAtualizado,
      technicalBriefing: r1.technicalBriefing,
      groups: [],
      signals: noSignals({ categoria: "trofeus", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "trofeu",
      categorySignals: { modeloReferencia: "mandou uma foto de um troféu dourado", arquivoRecebido: true },
    });
    expect(r2.next.nextAction).toBe("CONFIRM_FILE_IS_PRODUCTION_READY");
  });

  test("cliente diz que NÃO tem modelo -> oferece catálogo (nunca fica perguntando 'tem modelo?' para sempre)", () => {
    const r1 = iniciarTrofeu();
    const r2 = turno({
      draft: r1.draftAtualizado,
      technicalBriefing: r1.technicalBriefing,
      groups: [],
      signals: noSignals({ categoria: "trofeus", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "trofeu",
      categorySignals: { modeloReferencia: "sem_modelo" },
    });
    expect(r2.next.nextAction).toBe("OFFER_REFERENCE_CATALOG");

    // Depois de oferecido, segue para quantidade — nunca insiste de novo.
    const r3 = turno({
      draft: r2.draftAtualizado,
      technicalBriefing: r2.technicalBriefing,
      groups: [],
      signals: noSignals({ categoria: "trofeus", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "trofeu",
      categorySignals: { catalogoReferenciaOferecido: true },
    });
    expect(r3.next.nextAction).toBe("ASK_QUANTITY");
    expect(r3.next.nextAction).not.toBe("ASK_REFERENCE_MODEL");
  });
});

describe("Placa — nunca chuta medida antes de perguntar o espaço disponível; qualificação continua depois da medida", () => {
  function iniciarPlaca() {
    const draft = emptyCatalogDraft(CONV, null, false);
    return turno({
      draft,
      technicalBriefing: emptyTechnicalBriefing(),
      groups: [],
      signals: noSignals({ categoria: "placas", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "placa",
    });
  }

  test("cliente não sabe a medida -> pergunta o espaço disponível (ASK_WALL_SPACE), nunca sugere 30x20/40x30 de cara", () => {
    const r = iniciarPlaca();
    expect(r.next.nextAction).toBe("ASK_WALL_SPACE");
  });

  test("cliente informa 50x40 -> qualificação CONTINUA (pergunta arte), nunca finaliza/encaminha nesse ponto", () => {
    const r1 = iniciarPlaca();
    const r2 = turno({
      draft: r1.draftAtualizado,
      technicalBriefing: r1.technicalBriefing,
      groups: [],
      signals: noSignals({ categoria: "placas", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "placa",
      fieldUpdate: { customDimensions: { larguraCm: 50, alturaCm: 40 } },
    });
    expect(r2.next.nextAction).toBe("ASK_HAS_ART");

    // Sem arte -> pergunta o que colocar na peça (nunca pede arquivo que não existe).
    const r3 = turno({
      draft: r2.draftAtualizado,
      technicalBriefing: r2.technicalBriefing,
      groups: [],
      signals: noSignals({ categoria: "placas", customerExplicitlyRequestsCustom: true }),
      categoriaComercial: "placa",
      categorySignals: { temArte: false },
    });
    expect(r3.next.nextAction).toBe("ASK_ART_OR_CONTENT");
  });
});
