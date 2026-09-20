/**
 * catalog_known_no_operational_match.test.ts — ValerIA 2.0, Fase D.2.2
 * (2026-09-19).
 *
 * Distingue MODELO COMERCIAL CONHECIDO (catalogKnown, existe no PDF/catálogo)
 * de PRODUTO OPERACIONAL HOMOLOGADO (tem vitreProductId real). Fixtures
 * usam os 13 modelos reais do catálogo de troféus (ingestão real, Fase D.2):
 * Modelo 11 → TFMOD10 (operacional); Modelos 01-10/12/13 → sem SKU ainda.
 * Cobre os itens A-H da seção 18 do plano aprovado.
 */
import { resolveProductMatch, CatalogGroup } from "../product_resolution";
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState, FieldUpdate } from "../catalog_draft";
import { computeNextAction } from "../qualification_engine";

const TROFEU_MODELO_11: CatalogGroup = {
  catalogGroupId: "trofeu_modelo_11",
  categoria: "trofeus",
  nome: "Troféu Modelo 11",
  aliases: ["modelo 11", "go jovem", "go! jovem"],
  tamanhos: [{ tamanho: "único", larguraCm: 16, alturaCm: 22, vitreProductId: "TFMOD10", vitreProductSku: "TFMOD10", catalogPublishedPrice: 115, pageNumber: 7 }],
  materialPadrao: "Acrílico cristal 8mm",
  espessuraPadraoMm: 8,
  toleranciaCm: null,
};

// Modelo 07 — real do PDF, sem produto Vitre correspondente (achado real da ingestão).
const TROFEU_MODELO_07: CatalogGroup = {
  catalogGroupId: "trofeu_modelo_07",
  categoria: "trofeus",
  nome: "Troféu Modelo 07",
  aliases: ["modelo 07", "modelo 7"],
  tamanhos: [], // catálogo conhecido, ZERO productRefs — achado real
  materialPadrao: "Acrílico preto 6mm",
  espessuraPadraoMm: 6,
  toleranciaCm: null,
};

// Modelo 12 — "Caixa Veludo p/ Homenagem", subtipo comercial distinto.
const CAIXA_HOMENAGEM_12: CatalogGroup = {
  catalogGroupId: "trofeu_modelo_12",
  categoria: "trofeus",
  nome: "Caixa Veludo p/ Homenagem Modelo 12",
  aliases: ["modelo 12"],
  tamanhos: [],
  toleranciaCm: null,
  catalogSubtype: "caixa_homenagem",
};

const GROUPS = [TROFEU_MODELO_11, TROFEU_MODELO_07, CAIXA_HOMENAGEM_12];

describe("A. Modelo 11 → catalogKnown + operational EXACT_MATCH + TFMOD10", () => {
  test("resolve productId/sku reais, resolutionType EXACT_CATALOG_MATCH", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 11" }, GROUPS);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("TFMOD10");
    expect(r.matchedProductSku).toBe("TFMOD10");
  });
});

describe("B. Modelo 07 → catalogKnown=true, productRefs=[], NUNCA UNSUPPORTED", () => {
  test("grupo é identificado (catalogGroupId presente), resolutionType é o novo estado, não UNSUPPORTED/AMBIGUOUS genérico", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 07" }, GROUPS);
    expect(r.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
    expect(r.catalogGroupId).toBe("trofeu_modelo_07");
    expect(r.matchedProductId).toBeNull();
    expect(r.resolutionType).not.toBe("UNSUPPORTED");
    expect(r.resolutionType).not.toBe("CUSTOM_REQUIRED"); // ausência de SKU não é personalização
  });

  test('"gostei do 7" (alias natural) também resolve o mesmo grupo', () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 7" }, GROUPS);
    expect(r.catalogGroupId).toBe("trofeu_modelo_07");
    expect(r.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
  });
});

describe("C. Modelo 07 pergunta quantidade normalmente (qualificação comercial continua)", () => {
  test("draft sem quantidade → QUALIFYING_CATALOG_UNMAPPED, nextAction ASK_QUANTITY", () => {
    let draft = emptyCatalogDraft("conv-modelo07");
    const resolution = resolveProductMatch({ groupNameOrAlias: "modelo 07" }, GROUPS);
    draft = mergeSignalsIntoDraft(draft, resolution, {}, "CUSTOMER");
    const qualification = computeQualificationState(draft);
    expect(qualification.qualificationStatus).toBe("QUALIFYING_CATALOG_UNMAPPED");
    expect(qualification.missingFields).toEqual(["quantity"]);

    const next = computeNextAction(qualification, { groupName: "Troféu Modelo 07" });
    expect(next.nextAction).toBe("ASK_QUANTITY");
  });
});

describe("D/E. Modelo 07 comercialmente completo → NUNCA cria vitre_orcamentos, só PRODUCT_MAPPING_REQUIRED", () => {
  test("com quantidade informada → READY_FOR_PRODUCT_MAPPING_REVIEW, nextAction REQUEST_PRODUCT_MAPPING_REVIEW (não REQUEST_QUOTE_REVIEW)", () => {
    let draft = emptyCatalogDraft("conv-modelo07-completo");
    const resolution = resolveProductMatch({ groupNameOrAlias: "modelo 07" }, GROUPS);
    const fieldUpdate: FieldUpdate = { quantity: 4, personalization: ["gravacao_nome_vencedor"] };
    draft = mergeSignalsIntoDraft(draft, resolution, fieldUpdate, "CUSTOMER");
    const qualification = computeQualificationState(draft);

    expect(qualification.qualificationStatus).toBe("READY_FOR_PRODUCT_MAPPING_REVIEW");
    expect(draft.matchedProductId).toBeNull(); // D. nunca teve productId — nada para virar vitre_orcamentos

    const next = computeNextAction(qualification, { groupName: "Troféu Modelo 07" });
    expect(next.nextAction).toBe("REQUEST_PRODUCT_MAPPING_REVIEW");
    expect(next.nextAction).not.toBe("REQUEST_QUOTE_REVIEW"); // E. motivo diferente, nunca confundido com draft operacional pronto
  });
});

describe("F. Modelo inexistente no catálogo carregado → nunca finge catalogKnown", () => {
  test("nome que não corresponde a nenhum grupo → não é CATALOG_KNOWN_NO_OPERATIONAL_MATCH", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "Modelo 99 Inventado" }, GROUPS);
    expect(r.resolutionType).not.toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
    expect(r.resolutionType).not.toBe("EXACT_CATALOG_MATCH");
    expect(r.catalogGroupId).toBeNull();
  });
});

describe("G. Modelo 12/13 — subtype caixa_homenagem preservado", () => {
  test("grupo carrega catalogSubtype, nunca tratado como troféu de acrílico comum", () => {
    expect(CAIXA_HOMENAGEM_12.catalogSubtype).toBe("caixa_homenagem");
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 12" }, GROUPS);
    expect(r.catalogGroupId).toBe("trofeu_modelo_12");
    expect(r.resolutionType).toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH"); // também sem SKU ainda
  });
});

describe("H. CUSTOM_REQUESTED continua um caminho SEPARADO de CATALOG_KNOWN_NO_OPERATIONAL_MATCH", () => {
  test("pedido explícito de personalização sobre Modelo 07 (mesmo sem SKU) ainda vira CUSTOM_REQUIRED/CUSTOM_REQUESTED, não CATALOG_KNOWN_NO_OPERATIONAL_MATCH", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 07", customerExplicitlyRequestsCustom: true }, GROUPS);
    expect(["CUSTOM_REQUIRED", "CUSTOM_REQUESTED"]).toContain(r.resolutionType);
    expect(r.resolutionType).not.toBe("CATALOG_KNOWN_NO_OPERATIONAL_MATCH");
  });

  test("ausência de SKU sozinha (sem pedido de personalização) NUNCA vira CUSTOM_* por conta própria", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 07" }, GROUPS);
    expect(r.resolutionType).not.toBe("CUSTOM_REQUIRED");
    expect(r.resolutionType).not.toBe("CUSTOM_REQUESTED");
  });
});

describe("Fase D.2.3, seção 1 — trava de segurança antes do apply: grupo com tamanhos:[] NUNCA é operacionalmente elegível", () => {
  test("resolução nunca devolve matchedProductId/matchedProductSku para um grupo sem productRef, mesmo com quantidade/personalização completas", () => {
    let draft = emptyCatalogDraft("conv-trava-seguranca");
    const resolution = resolveProductMatch({ groupNameOrAlias: "modelo 07" }, GROUPS);
    expect(resolution.matchedProductId).toBeNull();
    expect(resolution.matchedProductSku).toBeNull();

    draft = mergeSignalsIntoDraft(draft, resolution, { quantity: 10, personalization: ["logo", "nome_vencedor"] }, "CUSTOMER");
    // Mesmo com tudo comercialmente completo, matchedProductId continua null —
    // nunca foi setado, nunca vai ser (não há de onde vir).
    expect(draft.matchedProductId).toBeNull();

    const qualification = computeQualificationState(draft);
    // NUNCA READY_CATALOG_DRAFT (o único status que catalog_tools.ts usa
    // como gatilho para createVitreDraftIfNotExists) — só READY_FOR_PRODUCT_MAPPING_REVIEW.
    expect(qualification.qualificationStatus).not.toBe("READY_CATALOG_DRAFT");
    expect(qualification.qualificationStatus).toBe("READY_FOR_PRODUCT_MAPPING_REVIEW");
  });

  test("resolutionType nunca é EXACT_CATALOG_MATCH para um grupo sem nenhum tamanho, em nenhum cenário de sinais", () => {
    const cenarios = [
      { groupNameOrAlias: "modelo 07" },
      { groupNameOrAlias: "modelo 07", catalogSizeLabel: "único" }, // não existe rótulo de tamanho para este grupo — não deve inventar
      { groupNameOrAlias: "modelo 07", exactDimensionsCm: { largura: 14, altura: 18 } },
    ];
    for (const sinais of cenarios) {
      const r = resolveProductMatch(sinais, GROUPS);
      expect(r.resolutionType).not.toBe("EXACT_CATALOG_MATCH");
      expect(r.matchedProductId).toBeNull();
    }
  });

  test("nextAction para grupo sem productRef nunca é REQUEST_QUOTE_REVIEW (que implicaria rascunho Vitre já criado)", () => {
    let draft = emptyCatalogDraft("conv-trava-nextaction");
    const resolution = resolveProductMatch({ groupNameOrAlias: "modelo 07" }, GROUPS);
    draft = mergeSignalsIntoDraft(draft, resolution, { quantity: 2 }, "CUSTOMER");
    const qualification = computeQualificationState(draft);
    const next = computeNextAction(qualification, { groupName: "Troféu Modelo 07" });
    expect(next.nextAction).not.toBe("REQUEST_QUOTE_REVIEW");
    expect(next.nextAction).toBe("REQUEST_PRODUCT_MAPPING_REVIEW");
  });
});
