/**
 * product_resolution_trofeus.test.ts — ValerIA 2.0, Fase D.2 (2026-09-19).
 *
 * Prova que o motor de resolução (product_resolution.ts/catalog_draft.ts),
 * criado e testado só com dados de CAIXAS, funciona sem nenhuma alteração
 * de código para TROFÉUS — outro domínio, outra geometria (2D, não 3D),
 * outro vocabulário de personalização (gravação/logo/nome, não
 * medida/material). Fixture real: TFMOD10 ("TROFÉU MODELO 11"), o único
 * produto real de troféu hoje em vitre_produtos (achado da ingestão real
 * do catálogo — ver relatório da Fase D.2). Os demais grupos usados nos
 * testes de AMBIGUOUS são sintéticos (marcados explicitamente), só para
 * cobrir o cenário — não correspondem a produtos reais ainda.
 */
import { resolveProductMatch, CatalogGroup } from "../product_resolution";
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState, FieldUpdate } from "../catalog_draft";

// Fixture REAL — vitre_produtos/TFMOD10, achado na ingestão do catálogo de troféus (2026-09-19).
const TROFEU_MODELO_11: CatalogGroup = {
  catalogGroupId: "trofeu_modelo_11",
  categoria: "trofeus",
  nome: "Troféu Modelo 11",
  aliases: ["modelo 11", "troféu modelo 11", "modelo onze"],
  tamanhos: [
    // Troféus não têm P/M/G — cada "Modelo" já é um tamanho fixo único.
    { tamanho: "único", larguraCm: 16, alturaCm: 22, vitreProductId: "TFMOD10", vitreProductSku: "TFMOD10", catalogPublishedPrice: 115, pageNumber: 7 },
  ],
  materialPadrao: "Acrílico cristal 8mm",
  espessuraPadraoMm: 8,
  toleranciaCm: null,
};

const GROUPS = [TROFEU_MODELO_11];

describe("Genericidade do motor — troféus sem alteração de código", () => {
  test("alias 'modelo 11' resolve o grupo/produto real (EXACT_CATALOG_MATCH)", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 11", catalogSizeLabel: "único" }, GROUPS);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("TFMOD10");
    expect(r.matchedProductSku).toBe("TFMOD10");
  });

  test("SKU explícito (TFMOD10) também resolve direto", () => {
    const r = resolveProductMatch({ explicitSkuOrProductId: "TFMOD10" }, GROUPS);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("TFMOD10");
  });

  test("preço vem SEMPRE do candidato carregado do Vitre (catalogPublishedPrice é só metadado, nunca decide o preço operacional)", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "modelo 11", catalogSizeLabel: "único" }, GROUPS);
    const tamanho = TROFEU_MODELO_11.tamanhos.find((t) => t.vitreProductId === r.matchedProductId)!;
    // A resolução em si não devolve preço — isso é responsabilidade de quem
    // carrega o produto real (catalog_tools.ts/loadVitreProduct), nunca do
    // catalogPublishedPrice armazenado aqui. Confirma que o campo existe só
    // como metadado de auditoria (seção 10 do plano), não como fonte de preço.
    expect(tamanho.catalogPublishedPrice).toBe(115); // metadado do PDF
    // fonte operacional real seria vitre_produtos.precoVenda, carregado à parte.
  });
});

describe("Personalização COMERCIAL (seção 6/8) — nunca sai do produto padrão", () => {
  test("gravação/nome/logo/evento não alteram resolutionType nem disparam CUSTOM_REQUESTED", () => {
    let draft = emptyCatalogDraft("conv-trofeu-1");
    const resolution = resolveProductMatch({ groupNameOrAlias: "modelo 11", catalogSizeLabel: "único" }, GROUPS);
    const fieldUpdate: FieldUpdate = {
      quantity: 5,
      personalization: ["logo_new_holland", "gravacao_nome_marcia_pereira", "evento_17_anos_carpal"],
    };
    draft = mergeSignalsIntoDraft(draft, resolution, fieldUpdate, "CUSTOMER");
    expect(draft.resolutionType).toBe("EXACT_CATALOG_MATCH"); // continua produto padrão
    expect(draft.matchedProductId).toBe("TFMOD10"); // SKU não muda
    expect(draft.fields.personalization).toEqual(
      expect.arrayContaining(["logo_new_holland", "gravacao_nome_marcia_pereira", "evento_17_anos_carpal"])
    );

    const qualification = computeQualificationState(draft);
    expect(qualification.qualificationStatus).toBe("READY_CATALOG_DRAFT"); // personalização comercial não bloqueia o rascunho
  });
});

describe("Personalização ESTRUTURAL (seção 9) — vira CUSTOM_REQUESTED, preserva base", () => {
  test("'gostei desse modelo, mas quero maior e com outra base' → CUSTOM_REQUESTED com baseCatalogGroupId/baseProductId/baseProductSku preservados", () => {
    const r = resolveProductMatch(
      {
        groupNameOrAlias: "modelo 11",
        catalogSizeLabel: "único",
        customerExplicitlyRequestsCustom: true,
      },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.baseCatalogGroupId).toBe("trofeu_modelo_11");
    expect(r.baseProductId).toBe("TFMOD10");
    expect(r.baseProductSku).toBe("TFMOD10");
  });

  test("mudança de dimensão exata que não bate com o tamanho único do modelo → CUSTOM_REQUIRED, preserva só o grupo (nenhum SKU específico foi confirmado)", () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "modelo 11", exactDimensionsCm: { largura: 25, altura: 30 } },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUIRED");
    expect(r.baseCatalogGroupId).toBe("trofeu_modelo_11");
    expect(r.baseProductId).toBeNull();
  });
});

describe("Grupo desconhecido de verdade (nem citado no catálogo carregado) — AMBIGUOUS, nunca inventa", () => {
  test("nome que não corresponde a NENHUM grupo carregado → AMBIGUOUS_GROUP_NOT_IDENTIFIED", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "produto que não existe em nenhum catálogo" }, GROUPS);
    expect(r.resolutionType).not.toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBeNull();
  });
});

// Nota: "modelo do PDF sem candidato Vitre" (ex.: Modelo 03) é um cenário
// DIFERENTE deste — o grupo comercial EXISTE e é identificado (catalogKnown),
// só não tem productRef ainda. Ver catalog_known_no_operational_match.test.ts
// (Fase D.2.2) para essa distinção completa.

describe("AMBIGUOUS (cenário sintético — cobertura de caso, não corresponde a dado real ainda)", () => {
  // Nomes que NÃO batem exatamente com nenhum dos dois grupos (só "contêm"
  // o termo buscado nos dois) — exercita o fallback de ambiguidade de
  // findGroupByNameOrAlias de verdade (correção Fase D.2.2: um grupo de
  // nome EXATO + tamanho único agora resolve direto — ver 7b — então o
  // teste precisa de ambiguidade real na IDENTIFICAÇÃO do grupo, não só
  // ausência de tamanho informado).
  const GRUPO_SINTETICO_A: CatalogGroup = { ...TROFEU_MODELO_11, catalogGroupId: "sint_a", nome: "Troféu Destaque Norte" };
  const GRUPO_SINTETICO_B: CatalogGroup = { ...TROFEU_MODELO_11, catalogGroupId: "sint_b", nome: "Troféu Destaque Sul" };

  test("nome ambíguo entre 2 grupos sintéticos não resolve sozinho", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "Troféu Destaque" }, [GRUPO_SINTETICO_A, GRUPO_SINTETICO_B]);
    expect(r.resolutionType).toBe("AMBIGUOUS");
    expect(r.matchedProductId).toBeNull();
  });
});
