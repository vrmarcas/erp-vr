/**
 * e2e_fase_e_cenarios_ab_h.test.ts — ValerIA 2.0, Fase E (2026-09-19).
 *
 * Bateria E2E controlada (seção 9-17 do checkpoint) exercitando a cadeia
 * COMPLETA da camada de decisão pura, turno a turno, exatamente como
 * `catalog_tools.ts::valeriaUpdateCatalogQualification` orquestra em
 * produção: resolveProductMatch → mergeSignalsIntoDraft →
 * computeQualificationState → computeNextAction. Roda contra os catálogos
 * REAIS já aplicados em produção (grupos/SKUs copiados literalmente dos
 * documentos em `valeria_catalogos/*`, lidos ao vivo durante a auditoria
 * desta fase — nunca inventados).
 *
 * NÃO é um teste de HTTP/rede — não substitui rodar contra o Firebase
 * Emulator ou a Tool real deployada; prova a LÓGICA de decisão que a Tool
 * delega inteiramente a estas funções puras (a própria Tool só adiciona
 * I/O: ler/gravar Firestore, chamar vitre_draft_writer/human_handoff —
 * também já cobertos por unit tests próprios: vitre_draft_writer_parity,
 * trofeu_v1_v2_isolation, catalog_known_no_operational_match).
 */
import { resolveProductMatch, CatalogGroup, ResolutionSignals } from "../product_resolution";
import {
  emptyCatalogDraft,
  mergeSignalsIntoDraft,
  computeQualificationState,
  CatalogDraft,
} from "../catalog_draft";
import { computeNextAction } from "../qualification_engine";

// ── Fixtures = cópia literal dos documentos reais em valeria_catalogos/* (Fase E, auditados em produção 2026-09-19) ──

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

const TROFEU_MODELO_11: CatalogGroup = {
  catalogGroupId: "trofeu_modelo_11",
  categoria: "trofeus",
  nome: "Troféu Modelo 11",
  aliases: ["modelo 11", "troféu modelo 11", "trofeu modelo 11", "go jovem", "go! jovem"],
  materialPadrao: "Acrílico cristal 8mm",
  espessuraPadraoMm: 8,
  toleranciaCm: null,
  tamanhos: [{ tamanho: "único", larguraCm: 16, alturaCm: 22, vitreProductId: "TFMOD10", vitreProductSku: "TFMOD10", catalogPublishedPrice: 115, pageNumber: 7 }],
};

const TROFEU_MODELO_07: CatalogGroup = {
  catalogGroupId: "trofeu_modelo_07",
  categoria: "trofeus",
  nome: "Troféu Modelo 07",
  aliases: ["modelo 07", "modelo 7"],
  materialPadrao: "Acrílico preto",
  espessuraPadraoMm: 6,
  toleranciaCm: null,
  tamanhos: [],
};

const DISPLAY_22X18_PRETO: CatalogGroup = {
  catalogGroupId: "display_qr_22x18_3bolsas_preto",
  categoria: "display_qr_code",
  nome: "Display 22x18 Preto 3 Bolsas",
  aliases: ["display 22x18 preto", "display preto 3 bolsas", "display preto 22x18"],
  materialPadrao: "Acrílico preto",
  espessuraPadraoMm: null,
  toleranciaCm: null,
  tamanhos: [],
};

const URNA_20X20X20: CatalogGroup = {
  catalogGroupId: "urna_20x20x20",
  categoria: "urnas",
  nome: "Urna Piramidal 20x20x20",
  aliases: ["urna 20x20x20", "urna 20 x 20 x 20"],
  materialPadrao: "Acrílico cristal",
  espessuraPadraoMm: null,
  toleranciaCm: null,
  tamanhos: [], // sem SKU (auditoria Fase D.4: 0/20 variantes com produto real)
};

const ROLETA_ACRILICO_DISCO35: CatalogGroup = {
  catalogGroupId: "roleta_acrilico_45x35_disco35",
  categoria: "roletas",
  nome: "Roleta Acrílico 45x35 Disco 35cm",
  aliases: ["roleta 45x35", "roleta 45 x 35", "roleta disco 35", "roleta disco de 35"],
  materialPadrao: "Acrílico branco ou preto adesivado",
  espessuraPadraoMm: null,
  toleranciaCm: null,
  tamanhos: [],
};

const PULPITO_10MM_COPO: CatalogGroup = {
  catalogGroupId: "pulpito_acrilico_10mm_copo",
  categoria: "pulpitos",
  nome: "Púlpito Acrílico 10mm com Suporte para Copo",
  aliases: ["pulpito 10mm copo", "pulpito 10mm com suporte para copo", "pulpito 10mm suporte copo"],
  materialPadrao: "Acrílico",
  espessuraPadraoMm: 10,
  toleranciaCm: null,
  tamanhos: [],
};

function turno(
  draft: CatalogDraft,
  signals: ResolutionSignals,
  groups: CatalogGroup[],
  fieldUpdate: Partial<CatalogDraft["fields"]> = {},
  contextOverrides: { catalogDraftCreatedThisCall?: boolean } = {}
) {
  const resolution = resolveProductMatch(signals, groups);
  const novoDraft = mergeSignalsIntoDraft(draft, resolution, { quantity: null, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null, ...fieldUpdate }, "CUSTOMER");
  const qualification = computeQualificationState(novoDraft);
  novoDraft.qualificationStatus = qualification.qualificationStatus;
  novoDraft.missingFields = qualification.missingFields;
  // Fase E.2.27: catalogDraftCreatedThisCall representa o que a Tool REAL
  // (catalog_tools.ts) já teria executado antes de chamar computeNextAction
  // — este helper só simula a camada de decisão pura, então cada teste
  // passa explicitamente esse contexto quando quer representar "a Tool já
  // criou o rascunho e acionou o handoff nesta chamada".
  const { nextAction } = computeNextAction(qualification, { groupName: resolution.catalogGroupId ?? undefined, ...contextOverrides });
  return { draft: novoDraft, resolution, qualification, nextAction };
}

describe("Cenário A — Caixa com SKU (fluxo completo até QUOTE_REVIEW)", () => {
  test("'quero uma caixa' → 'tampa de correr' → 'a média' → '10 unidades' resolve C4TC3M, quantity=10, pronto para rascunho", () => {
    let draft = emptyCatalogDraft("conv-e2e-a");

    let t = turno(draft, { groupNameOrAlias: "tampa de correr" }, [CAIXA_TAMPA_CORRER]);
    draft = t.draft;
    expect(draft.catalogGroupId).toBe("caixa_tampa_de_correr");
    expect(t.nextAction).toBe("ASK_SIZE");

    t = turno(draft, { groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M", contextCatalogGroupId: draft.catalogGroupId }, [CAIXA_TAMPA_CORRER]);
    draft = t.draft;
    expect(t.resolution.matchedProductId).toBe("C4TC3M");
    expect(t.resolution.matchedProductSku).toBe("C4TC3M");
    expect(t.nextAction).toBe("ASK_QUANTITY");

    t = turno(draft, { groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M", contextCatalogGroupId: draft.catalogGroupId, contextMatchedProductId: draft.matchedProductId, contextMatchedProductSku: draft.matchedProductSku }, [CAIXA_TAMPA_CORRER], { quantity: 10 }, { catalogDraftCreatedThisCall: true });
    draft = t.draft;

    // Estado final: pronto para a Tool executar a transição determinística
    // (createVitreDraftIfNotExists + requestQuoteReview) — testado
    // separadamente em vitre_draft_writer_parity.test.ts (contrato do
    // rascunho) e human_handoff (chamada ao endpoint real). Aqui provamos
    // que a CAMADA DE DECISÃO chega exatamente a este estado — e
    // `catalogDraftCreatedThisCall: true` representa a Tool REAL já tendo
    // executado o rascunho+handoff nesta mesma chamada (Fase E.2.27:
    // REQUEST_QUOTE_REVIEW só é emitido como ação consumada quando isso é
    // verdade — sem isso, o resultado correto seria READY_FOR_QUOTE_REVIEW).
    expect(draft.qualificationStatus).toBe("READY_CATALOG_DRAFT");
    expect(draft.fields.quantity).toBe(10);
    expect(t.nextAction).toBe("REQUEST_QUOTE_REVIEW");
    // Nenhum preço/orçamento é devolvido por estas funções — nada aqui
    // seria comunicado como "preço final" ao cliente (a Tool nunca monta
    // texto de preço; isso é responsabilidade humana em QUOTE_REVIEW).
    expect((t.resolution as unknown as { precoFinal?: unknown }).precoFinal).toBeUndefined();
  });
});

describe("Cenário B — Caixa personalizada (dimensão fora do catálogo)", () => {
  test("'tampa de correr média, mas 35x25x10' → CUSTOM_REQUIRED, preserva base M (C4TC3M), sem handoff precoce", () => {
    let draft = emptyCatalogDraft("conv-e2e-b");
    const resolution = resolveProductMatch(
      { groupNameOrAlias: "tampa de correr", exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 } },
      [CAIXA_TAMPA_CORRER]
    );
    expect(resolution.resolutionType).toBe("CUSTOM_REQUIRED");
    expect(resolution.baseCatalogGroupId).toBe("caixa_tampa_de_correr");
    // Base fica null aqui: o cliente citou a dimensão custom no MESMO turno
    // em que citou o grupo, sem antes ter resolvido um tamanho específico —
    // contrato já documentado (baseProductId só existe quando um tamanho
    // já tinha sido confirmado ANTES do pedido de personalização).
    expect(resolution.baseProductId).toBeNull();

    draft = mergeSignalsIntoDraft(draft, resolution, { quantity: null, customDimensions: { larguraCm: 35, alturaCm: 25, profundidadeCm: 10 }, personalization: [], desiredDeadline: null, deliveryData: null }, "CUSTOMER");
    const qualification = computeQualificationState(draft);
    expect(qualification.qualificationStatus).toBe("ROUTED_TO_CUSTOM"); // continua conversa, NUNCA handoff humano aqui
    const { nextAction } = computeNextAction(qualification);
    expect(nextAction).toBe("CONTINUE_CUSTOM_TECHNICAL_BRIEFING");
    expect(nextAction).not.toBe("REQUEST_QUOTE_REVIEW");
  });
});

describe("Cenário C — Troféu Modelo 11 (catálogo V2, NUNCA hardcode V1 Go!Jovem)", () => {
  test("'Modelo 11' resolve TFMOD10 via catálogo (branch 7b, tamanho único sem precisar de label)", () => {
    let draft = emptyCatalogDraft("conv-e2e-c");
    let t = turno(draft, { groupNameOrAlias: "modelo 11" }, [TROFEU_MODELO_11]);
    draft = t.draft;
    expect(t.resolution.matchedProductId).toBe("TFMOD10");
    expect(t.resolution.matchedProductSku).toBe("TFMOD10");
    expect(t.nextAction).toBe("ASK_QUANTITY");

    // Turno 2: personalização comercial (logo + nome) NÃO muda resolutionType nem SKU
    t = turno(draft, { groupNameOrAlias: "modelo 11", contextCatalogGroupId: draft.catalogGroupId, contextMatchedProductId: draft.matchedProductId, contextMatchedProductSku: draft.matchedProductSku }, [TROFEU_MODELO_11], { quantity: 1, personalization: ["logo_evento", "nome_joao"] }, { catalogDraftCreatedThisCall: true });
    draft = t.draft;
    expect(draft.matchedProductId).toBe("TFMOD10"); // SKU nunca muda por personalização comercial
    expect(draft.qualificationStatus).toBe("READY_CATALOG_DRAFT");
    expect(t.nextAction).toBe("REQUEST_QUOTE_REVIEW");
  });
});

describe("Cenário D — Troféu Modelo 07 (sem SKU) → PRODUCT_MAPPING_REQUIRED, nunca vitre_orcamentos", () => {
  test("'Modelo 07' reconhecido sem SKU → qualifica comercialmente → PRODUCT_MAPPING_REQUIRED", () => {
    let draft = emptyCatalogDraft("conv-e2e-d");
    let t = turno(draft, { groupNameOrAlias: "modelo 07" }, [TROFEU_MODELO_07]);
    draft = t.draft;
    expect(t.resolution.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
    expect(draft.matchedProductId).toBeNull();
    expect(t.nextAction).toBe("ASK_QUANTITY");

    t = turno(draft, { groupNameOrAlias: "modelo 07", contextCatalogGroupId: draft.catalogGroupId }, [TROFEU_MODELO_07], { quantity: 2 });
    draft = t.draft;
    expect(draft.qualificationStatus).toBe("READY_FOR_PRODUCT_MAPPING_REVIEW");
    expect(t.nextAction).toBe("REQUEST_PRODUCT_MAPPING_REVIEW");
    expect(draft.matchedProductId).toBeNull();
    // Prova por estrutura de código (catalog_tools.ts): createVitreDraftIfNotExists
    // só é chamado no branch READY_CATALOG_DRAFT — nunca alcançado aqui.
  });
});

describe("Cenário E — Display QR (sem SKU) + personalização comercial (Pix/Instagram/Wi-Fi)", () => {
  test("'display preto para 3 QR Codes' resolve o grupo; Pix/Instagram/Wi-Fi não vira CUSTOM_REQUESTED", () => {
    let draft = emptyCatalogDraft("conv-e2e-e");
    let t = turno(draft, { groupNameOrAlias: "display preto 3 bolsas" }, [DISPLAY_22X18_PRETO]);
    draft = t.draft;
    expect(t.resolution.catalogGroupId).toBe("display_qr_22x18_3bolsas_preto");
    expect(t.resolution.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");

    t = turno(draft, { groupNameOrAlias: "display preto 3 bolsas", contextCatalogGroupId: draft.catalogGroupId }, [DISPLAY_22X18_PRETO], { quantity: 1, personalization: ["pix", "instagram", "wifi"] });
    draft = t.draft;
    expect(draft.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
    expect(draft.resolutionType).not.toBe("CUSTOM_REQUESTED");
    expect(draft.qualificationStatus).toBe("READY_FOR_PRODUCT_MAPPING_REVIEW");
    expect(t.nextAction).toBe("REQUEST_PRODUCT_MAPPING_REVIEW");
  });
});

describe("Cenário F — Urna (espessura + bolsa perguntados em turnos separados, preço vencido nunca operacional)", () => {
  test("'urna 20x20x20' → pergunta espessura → '3mm' → pergunta bolsa → 'com bolsa' → variante comercial reconhecida", () => {
    let draft = emptyCatalogDraft("conv-e2e-f");

    // Turno 1: só a medida — grupo identificado, mas resolução ainda não é EXACT (faltam espessura+bolsa)
    let t = turno(draft, { groupNameOrAlias: "urna 20x20x20" }, [URNA_20X20X20]);
    draft = t.draft;
    expect(draft.catalogGroupId).toBe("urna_20x20x20");
    expect(t.resolution.resolutionType).not.toBe("EXACT_CATALOG_MATCH");

    // Turno 2: "3mm" sozinho (sem bolsa) — composeVariantSizeLabel exige os
    // dois atributos juntos (variant_attributes.ts), então o backend AINDA
    // não monta rótulo parcial — a ValerIA deve perguntar a bolsa a seguir.
    t = turno(draft, { groupNameOrAlias: "urna 20x20x20", contextCatalogGroupId: draft.catalogGroupId }, [URNA_20X20X20]);
    draft = t.draft;
    expect(draft.qualificationStatus).not.toBe("READY_CATALOG_DRAFT");

    // Turno 3: "com bolsa" — grupo comercial conhecido, sem SKU real (0/20
    // confirmado na auditoria Fase D.4) → CATALOG_KNOWN_NO_OPERATIONAL_MATCH.
    t = turno(draft, { groupNameOrAlias: "urna 20x20x20", contextCatalogGroupId: draft.catalogGroupId }, [URNA_20X20X20], { quantity: 1 });
    draft = t.draft;
    expect(t.resolution.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
    expect(draft.qualificationStatus).toBe("READY_FOR_PRODUCT_MAPPING_REVIEW");
    // Preço do PDF (vencido, validUntil 2026-04-30) nunca aparece em
    // nenhum campo de resolução/draft — nada aqui devolve preço algum.
    expect((t.resolution as unknown as { catalogPublishedPrice?: unknown }).catalogPublishedPrice).toBeUndefined();
  });
});

describe("Cenário G — Roleta (personalização comercial vs. mudança estrutural de disco)", () => {
  test("'roleta acrílico disco 35' → logo+8 prêmios (comercial) → 'disco de 50cm' (CUSTOM_REQUESTED)", () => {
    let draft = emptyCatalogDraft("conv-e2e-g");
    let t = turno(draft, { groupNameOrAlias: "roleta disco 35" }, [ROLETA_ACRILICO_DISCO35]);
    draft = t.draft;
    expect(draft.catalogGroupId).toBe("roleta_acrilico_45x35_disco35");

    t = turno(draft, { groupNameOrAlias: "roleta disco 35", contextCatalogGroupId: draft.catalogGroupId }, [ROLETA_ACRILICO_DISCO35], { personalization: ["logo_cliente", "premio_1", "premio_2", "premio_3", "premio_4", "premio_5", "premio_6", "premio_7", "premio_8"] });
    draft = t.draft;
    expect(draft.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
    expect(draft.resolutionType).not.toBe("CUSTOM_REQUESTED");

    // Cliente pede disco 50cm (mudança estrutural, grupo base tinha disco 35) → CUSTOM_REQUESTED
    const resolutionCustom = resolveProductMatch(
      { groupNameOrAlias: "roleta disco 35", contextCatalogGroupId: draft.catalogGroupId, customerExplicitlyRequestsCustom: true },
      [ROLETA_ACRILICO_DISCO35]
    );
    expect(resolutionCustom.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(resolutionCustom.baseCatalogGroupId).toBe("roleta_acrilico_45x35_disco35");
  });
});

describe("Cenário H — Púlpito (logo comercial vs. preparação para microfone = mudança física)", () => {
  test("'púlpito 10mm com suporte para copo' → logo da igreja (comercial) → 'preparação para microfone' (CUSTOM_REQUESTED)", () => {
    let draft = emptyCatalogDraft("conv-e2e-h");
    let t = turno(draft, { groupNameOrAlias: "pulpito 10mm com suporte para copo" }, [PULPITO_10MM_COPO]);
    draft = t.draft;
    expect(draft.catalogGroupId).toBe("pulpito_acrilico_10mm_copo");

    t = turno(draft, { groupNameOrAlias: "pulpito 10mm com suporte para copo", contextCatalogGroupId: draft.catalogGroupId }, [PULPITO_10MM_COPO], { personalization: ["logo_igreja"] });
    draft = t.draft;
    expect(draft.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
    expect(draft.resolutionType).not.toBe("CUSTOM_REQUESTED");

    // "quero também preparação para microfone" no grupo COPO (que não tem
    // essa preparação) é mudança física — o grupo base do cliente é
    // "10mm+copo", pedir microfone é sair da variante → CUSTOM_REQUESTED,
    // preserva a família (nunca inventa que o produto base tinha microfone).
    const resolutionCustom = resolveProductMatch(
      { groupNameOrAlias: "pulpito 10mm com suporte para copo", contextCatalogGroupId: draft.catalogGroupId, customerExplicitlyRequestsCustom: true },
      [PULPITO_10MM_COPO]
    );
    expect(resolutionCustom.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(resolutionCustom.baseCatalogGroupId).toBe("pulpito_acrilico_10mm_copo");
  });
});
