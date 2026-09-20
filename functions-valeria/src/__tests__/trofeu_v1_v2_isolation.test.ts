/**
 * trofeu_v1_v2_isolation.test.ts — ValerIA 2.0, Fase D.2.1 (2026-09-19).
 *
 * Decisão: Modelo 11/Go!Jovem (TFMOD10) migra para o fluxo catálogo-first
 * da V2. O hardcode legado (trofeu_gojovem.ts) NÃO é deletado — continua
 * existindo como patrimônio/rollback do V1 — mas a V2 nunca pode acioná-lo.
 * Cobre os itens A-G da seção 10 do plano aprovado.
 */
import { resolveProductMatch, CatalogGroup } from "../product_resolution";
import { buildCustomTechnicalBriefingPatch } from "../custom_briefing_patch";
import { buildVitreDraftPayload } from "../vitre_draft_writer";
import { mergeTechnicalBriefing } from "../technical_briefing_store";
import { emptyTechnicalBriefing } from "../technical_briefing";
import { isTrofeuGoJovemAlias, TROFEU_GOJOVEM_SKU, TROFEU_GOJOVEM_PRODUCT_ID } from "../trofeu_gojovem";

// Grupo canônico proposto (dry-run) para valeria_catalogos/trofeus — mesmo
// SKU real usado pelo legado (TROFEU_GOJOVEM_SKU === "TFMOD10"), decisão
// explícita: V2 passa a tratar TFMOD10 como fonte operacional canônica.
const TROFEU_MODELO_11: CatalogGroup = {
  catalogGroupId: "trofeu_modelo_11",
  categoria: "trofeus",
  nome: "Troféu Modelo 11",
  aliases: ["modelo 11", "troféu modelo 11", "trofeu modelo 11", "go jovem", "go! jovem"],
  tamanhos: [
    { tamanho: "único", larguraCm: 16, alturaCm: 22, vitreProductId: TROFEU_GOJOVEM_SKU, vitreProductSku: TROFEU_GOJOVEM_SKU, catalogPublishedPrice: 115, pageNumber: 7 },
  ],
  materialPadrao: "Acrílico cristal 8mm",
  espessuraPadraoMm: 8,
  toleranciaCm: null,
};

describe("A/B — V2 resolve Modelo 11 e Go!Jovem para o MESMO produto real (TFMOD10)", () => {
  test("A. 'Modelo 11' resolve para TFMOD10 via catálogo V2", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 11", catalogSizeLabel: "único" }, [TROFEU_MODELO_11]);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("TFMOD10");
    expect(r.matchedProductSku).toBe("TFMOD10");
  });

  test("B. 'Go! Jovem' resolve para o MESMO produto real via alias do catálogo V2 (não via hardcode)", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "go! jovem", catalogSizeLabel: "único" }, [TROFEU_MODELO_11]);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("TFMOD10");
    expect(r.catalogGroupId).toBe("trofeu_modelo_11");
  });

  test('B2. "go jovem" (sem exclamação/acento) também resolve — mesmo alias, grafia alternativa', () => {
    const r = resolveProductMatch({ groupNameOrAlias: "go jovem", catalogSizeLabel: "único" }, [TROFEU_MODELO_11]);
    expect(r.matchedProductId).toBe("TFMOD10");
  });
});

describe("C. V2 nunca aciona o hardcode legado Go!Jovem", () => {
  test("personalização estrutural de troféu via V2 nunca inclui productId no patch (categoria 'trofeus' fora de CATEGORIA_PARA_RECEITA, catalog_tools.ts)", () => {
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: "trofeu_modelo_11",
      baseProductId: "TFMOD10",
      baseProductSku: "TFMOD10",
      receitaProductId: null, // "trofeus" não está mapeado em CATEGORIA_PARA_RECEITA — decisão deliberada
      quantity: 3,
      customDimensions: { larguraCm: 20, alturaCm: 28 },
      espessuraPadraoMmDoGrupo: 8,
      thicknessMmAtual: null,
    });
    expect(patch.productId).toBeUndefined();
    // Segurança dupla: mesmo que alguém tentasse, nenhum valor presente no patch bate no alias.
    expect(isTrofeuGoJovemAlias(String(patch.productId))).toBe(false);
  });

  test("mergeTechnicalBriefing com o patch da V2 (sem productId) NUNCA promove o envelope hardcoded do Go!Jovem", () => {
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: "trofeu_modelo_11",
      baseProductId: "TFMOD10",
      baseProductSku: "TFMOD10",
      receitaProductId: null,
      quantity: 3,
      customDimensions: { larguraCm: 20, alturaCm: 28 },
      espessuraPadraoMmDoGrupo: 8,
      thicknessMmAtual: null,
    });
    const resultado = mergeTechnicalBriefing(emptyTechnicalBriefing(), patch);
    expect(resultado.productId).toBeNull(); // nunca vira "Troféu GoJovem" pela mão da V2
    expect(resultado.baseProductId).toBe("TFMOD10"); // rastreabilidade preservada, sem acionar o hardcode
  });
});

describe("D. V1/legado permanece intacto (mesmo comportamento de antes, código não tocado)", () => {
  test("mergeTechnicalBriefing com productId='Modelo 11' (como o Tool legado atualizar_briefing_tecnico enviaria) ainda promove o envelope Go!Jovem normalmente", () => {
    const resultado = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Modelo 11" });
    expect(resultado.productId).toBe(TROFEU_GOJOVEM_PRODUCT_ID);
    expect(resultado.materialId).toBeTruthy();
    expect(resultado.thicknessMm).toBeTruthy();
  });

  test("isTrofeuGoJovemAlias continua reconhecendo os mesmos aliases de sempre (função não alterada)", () => {
    expect(isTrofeuGoJovemAlias("troféu gojovem")).toBe(true);
    expect(isTrofeuGoJovemAlias("modelo 11")).toBe(true);
    expect(isTrofeuGoJovemAlias("caixa qualquer")).toBe(false);
  });
});

describe("E/F — personalização comercial x estrutural (reafirmado com o grupo canônico final)", () => {
  test("E. logo/texto/nome do vencedor → personalização comercial, resolutionType continua EXACT_CATALOG_MATCH", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 11", catalogSizeLabel: "único" }, [TROFEU_MODELO_11]);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    // personalização comercial (logo/texto) é responsabilidade de CatalogDraft.fields.personalization,
    // nunca influencia resolveProductMatch — já coberto em product_resolution_trofeus.test.ts.
  });

  test("F. 'quero o Modelo 11, mas maior' → CUSTOM_REQUESTED, preserva baseCatalogGroupId/baseProductId/baseProductSku", () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "modelo 11", customerExplicitlyRequestsCustom: true, catalogSizeLabel: "único" },
      [TROFEU_MODELO_11]
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.baseCatalogGroupId).toBe("trofeu_modelo_11");
    expect(r.baseProductId).toBe("TFMOD10");
    expect(r.baseProductSku).toBe("TFMOD10");
  });
});

describe("G. Preço sempre vem do Vitre (precoVenda real), nunca do catalogPublishedPrice", () => {
  test("buildVitreDraftPayload usa produto.precoVenda mesmo quando catalogPublishedPrice do grupo é diferente (preço desatualizado no PDF)", () => {
    // Simula um cenário em que o preço do PDF (115, catalogPublishedPrice do
    // grupo) ficou desatualizado e o Vitre já tem 129 — o rascunho SEMPRE
    // usa o preço real carregado agora do produto, nunca o metadado do catálogo.
    const payload = buildVitreDraftPayload({
      conversationId: "conv-trofeu-g",
      organizationId: "org1",
      clienteNome: "Cliente Teste",
      produto: { id: "TFMOD10", sku: "TFMOD10", nome: "TROFÉU MODELO 11", precoVenda: 129 }, // preço REAL do Vitre agora
      quantity: 2,
    });
    expect(payload.itens[0].precoSnapshot).toBe(129); // nunca 115 (catalogPublishedPrice)
    expect(payload.total).toBe(258);
  });
});
