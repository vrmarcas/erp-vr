/**
 * product_resolution.test.ts — ValerIA 2.0, Fase B (2026-09-19).
 */
import { resolveProductMatch, CatalogGroup } from "../product_resolution";

const TAMPA_CORRER: CatalogGroup = {
  catalogGroupId: "caixa_tampa_correr",
  categoria: "caixas",
  nome: "Caixa com tampa de correr",
  aliases: ["tampa de correr", "caixa tampa de correr"],
  tamanhos: [
    { tamanho: "P", larguraCm: 20, alturaCm: 20, profundidadeCm: 4, vitreProductId: "C4TC3P", vitreProductSku: "C4TC3P" },
    { tamanho: "M", larguraCm: 30, alturaCm: 30, profundidadeCm: 4, vitreProductId: "C4TC3M", vitreProductSku: "C4TC3M" },
    { tamanho: "G", larguraCm: 40, alturaCm: 40, profundidadeCm: 4, vitreProductId: "C4TC3G", vitreProductSku: "C4TC3G" },
  ],
  materialPadrao: "Acrílico cristal",
  espessuraPadraoMm: 4,
  toleranciaCm: null,
};

const TAMPA_CORRER_COM_TOLERANCIA: CatalogGroup = { ...TAMPA_CORRER, toleranciaCm: 3 };

const MOLDURA: CatalogGroup = {
  catalogGroupId: "caixa_moldura",
  categoria: "caixas",
  nome: "Caixa tipo moldura",
  aliases: ["caixa moldura", "tipo moldura"],
  tamanhos: [
    { tamanho: "P", larguraCm: 15, alturaCm: 15, profundidadeCm: 3, vitreProductId: "C3TMP", vitreProductSku: "C3TMP" },
    { tamanho: "M", larguraCm: 20, alturaCm: 20, profundidadeCm: 3, vitreProductId: "C3TMM", vitreProductSku: "C3TMM" },
    { tamanho: "G", larguraCm: 30, alturaCm: 30, profundidadeCm: 3, vitreProductId: "C3TMG", vitreProductSku: "C3TMG" },
  ],
  toleranciaCm: null,
};

const GROUPS = [TAMPA_CORRER, MOLDURA];

describe("EXACT_CATALOG_MATCH", () => {
  test("SKU explícito tem prioridade máxima", () => {
    const r = resolveProductMatch({ explicitSkuOrProductId: "C4TC3M" }, GROUPS);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C4TC3M");
    expect(r.matchConfidence).toBe(1);
    expect(r.clientConfirmed).toBe(true);
  });

  test("Tamanho por letra (M) dentro de grupo inequívoco", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "tampa de correr", catalogSizeLabel: "M" }, GROUPS);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C4TC3M");
    expect(r.catalogGroupId).toBe("caixa_tampa_correr");
  });

  test("Tamanho por rótulo natural ('média')", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "tampa de correr", catalogSizeLabel: "média" }, GROUPS);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C4TC3M");
  });

  test("Dimensões exatas batendo com um tamanho do catálogo", () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "tampa de correr", exactDimensionsCm: { largura: 30, altura: 30, profundidade: 4 } },
      GROUPS
    );
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C4TC3M");
    expect(r.reasonCode).toBe("EXACT_DIMENSIONS");
  });

  test("Alias inequívoco resolve o mesmo grupo que o nome completo", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "tipo moldura", catalogSizeLabel: "G" }, GROUPS);
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C3TMG");
  });
});

describe("AMBIGUOUS", () => {
  test('"quero uma caixa" — nenhum grupo citado', () => {
    const r = resolveProductMatch({ categoria: "caixas" }, GROUPS);
    expect(r.resolutionType).toBe("AMBIGUOUS");
    expect(r.reasonCode).toBe("AMBIGUOUS_GROUP_NOT_IDENTIFIED");
  });

  test('"quero a de 30" sem grupo — múltiplas possibilidades, não resolve sozinho', () => {
    const r = resolveProductMatch({ vagueSizeHintCm: 30 }, GROUPS);
    expect(r.resolutionType).toBe("AMBIGUOUS");
    expect(r.matchedProductId).toBeNull();
  });

  test("Grupo inequívoco, mas nenhum tamanho informado ainda", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "tampa de correr" }, GROUPS);
    expect(r.resolutionType).toBe("AMBIGUOUS");
    expect(r.reasonCode).toBe("AMBIGUOUS_SIZE_NOT_INFORMED");
    expect(r.catalogGroupId).toBe("caixa_tampa_correr");
  });
});

describe("CATALOG_OPTION_AVAILABLE — sem tolerância automática por padrão", () => {
  test("Medida vaga NÃO vira opção sugerida quando toleranciaCm é null (regra aprovada)", () => {
    const r = resolveProductMatch({ groupNameOrAlias: "tampa de correr", vagueSizeHintCm: 30 }, GROUPS);
    expect(r.resolutionType).not.toBe("CATALOG_OPTION_AVAILABLE");
    expect(r.resolutionType).toBe("AMBIGUOUS");
  });

  test("Medida vaga vira opção sugerida SÓ quando toleranciaCm está explicitamente configurada", () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "tampa de correr", vagueSizeHintCm: 30 },
      [TAMPA_CORRER_COM_TOLERANCIA, MOLDURA]
    );
    expect(r.resolutionType).toBe("CATALOG_OPTION_AVAILABLE");
    expect(r.clientConfirmed).toBe(false);
    expect(r.matchedProductId).toBeNull(); // nunca promove sozinho
    expect(r.suggestedOption?.vitreProductId).toBe("C4TC3M");
  });

  test("Só promove para EXACT depois de clientConfirmedSuggestedOption=true", () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "tampa de correr", vagueSizeHintCm: 30, clientConfirmedSuggestedOption: true },
      [TAMPA_CORRER_COM_TOLERANCIA, MOLDURA]
    );
    expect(r.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(r.matchedProductId).toBe("C4TC3M");
    expect(r.clientConfirmed).toBe(true);
  });
});

describe("CUSTOM_REQUESTED/CUSTOM_REQUIRED — baseCatalogGroupId x baseProductId nunca misturados", () => {
  test('"gostei da tampa de correr, mas quero 35x25x10" — dimensão exata sem match → baseCatalogGroupId preenchido, baseProductId null (nenhum SKU foi selecionado)', () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "tampa de correr", exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 } },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUIRED");
    expect(r.catalogGroupId).toBe("caixa_tampa_correr");
    expect(r.baseCatalogGroupId).toBe("caixa_tampa_correr");
    expect(r.baseProductId).toBeNull(); // A. groupId nunca é salvo como baseProductId
    expect(r.customizationRequired).toBe(true);
  });

  test('"Gostei da tampa de correr M, mas quero 35x25x10" — resolução anterior deu SKU M no contexto → preserva os DOIS', () => {
    const r = resolveProductMatch(
      {
        customerExplicitlyRequestsCustom: true,
        contextCatalogGroupId: "caixa_tampa_correr",
        contextMatchedProductId: "C4TC3M",
      },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.baseCatalogGroupId).toBe("caixa_tampa_correr");
    expect(r.baseProductId).toBe("C4TC3M"); // C. custom a partir de SKU concreto preserva ambos
  });

  test('"Quero uma caixa de tampa de correr personalizada de 35x25x10" sem SKU selecionado antes → baseCatalogGroupId sem baseProductId', () => {
    const r = resolveProductMatch(
      { customerExplicitlyRequestsCustom: true, contextCatalogGroupId: "caixa_tampa_correr" },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.baseCatalogGroupId).toBe("caixa_tampa_correr"); // B. baseCatalogGroupId funciona sem baseProductId
    expect(r.baseProductId).toBeNull();
  });

  test('"preciso de uma caixa sob medida 47x31x18" direto, sem catálogo em contexto → nenhum dos dois preenchido', () => {
    const r = resolveProductMatch({ customerExplicitlyRequestsCustom: true }, GROUPS);
    expect(r.resolutionType).toBe("CUSTOM_REQUIRED");
    expect(r.baseCatalogGroupId).toBeNull();
    expect(r.baseProductId).toBeNull();
    expect(r.reasonCode).toBe("CUSTOM_REQUESTED_NO_BASE");
  });
});

describe("UNSUPPORTED", () => {
  test("Categoria fora do catálogo ativo", () => {
    const r = resolveProductMatch({ categoria: "galheteiros" }, GROUPS);
    expect(r.resolutionType).toBe("UNSUPPORTED");
    expect(r.reasonCode).toBe("CATEGORY_NOT_SUPPORTED");
  });
});

describe("Seção 15 (fechamento Fase B) — 'Quero a caixa tampa de correr M, mas em 35x25x10'", () => {
  test("resolve baseCatalogGroupId E baseProductId (SKU canônico real C4TC3M) no MESMO turno", () => {
    const r = resolveProductMatch(
      {
        groupNameOrAlias: "tampa de correr",
        catalogSizeLabel: "M",
        customerExplicitlyRequestsCustom: true,
      },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.baseCatalogGroupId).toBe("caixa_tampa_correr");
    expect(r.baseProductId).toBe("C4TC3M"); // ID real (auditoria), não o catalogGroupId
    expect(r.baseProductSku).toBe("C4TC3M"); // SKU — campo semanticamente distinto de baseProductId (contrato Fase C)
  });

  test("sem tamanho específico nunca citado (só grupo) → baseCatalogGroupId presente, baseProductId null", () => {
    const r = resolveProductMatch(
      { groupNameOrAlias: "tampa de correr", customerExplicitlyRequestsCustom: true },
      GROUPS
    );
    expect(r.resolutionType).toBe("CUSTOM_REQUESTED");
    expect(r.baseCatalogGroupId).toBe("caixa_tampa_correr");
    expect(r.baseProductId).toBeNull();
  });
});

describe("Segurança — LLM nunca decide o SKU sozinho", () => {
  test("Sinal de grupo com nome ambíguo (match por 'contains' em 2+ grupos) não resolve", () => {
    const AMBIG_A: CatalogGroup = { ...MOLDURA, catalogGroupId: "a", nome: "Caixa Especial X" };
    const AMBIG_B: CatalogGroup = { ...MOLDURA, catalogGroupId: "b", nome: "Caixa Especial Y" };
    const r = resolveProductMatch({ groupNameOrAlias: "Caixa Especial" }, [AMBIG_A, AMBIG_B]);
    expect(r.resolutionType).toBe("AMBIGUOUS");
    expect(r.matchedProductId).toBeNull();
  });

  test("matchConfidence só é 1 em EXACT_CATALOG_MATCH", () => {
    const ambiguous = resolveProductMatch({ groupNameOrAlias: "tampa de correr" }, GROUPS);
    expect(ambiguous.matchConfidence).toBeLessThan(1);
    const exact = resolveProductMatch({ explicitSkuOrProductId: "X" }, GROUPS);
    expect(exact.matchConfidence).toBe(1);
  });
});
