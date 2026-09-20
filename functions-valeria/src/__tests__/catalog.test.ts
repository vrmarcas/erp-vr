/**
 * catalog.test.ts — ValerIA 2.0, Fase B (2026-09-19).
 * Testa só as funções puras (validateCatalogConfig/catalogGroupsFromConfig);
 * getActiveCatalogConfig/getAllActiveCatalogConfigs precisam de Firestore
 * real e são cobertas por homologação manual (mesma disciplina do resto do
 * módulo — ver __tests__ de technical_briefing_store.ts).
 */
import { validateCatalogConfig, catalogGroupsFromConfig, CatalogConfig } from "../catalog";

const CAIXAS_VALIDO: CatalogConfig = {
  categoria: "caixas",
  titulo: "Catálogo de Caixas",
  urlCatalogo: null,
  ativo: true,
  version: 1,
  validUntil: null,
  grupos: [
    {
      catalogGroupId: "caixa_moldura",
      nome: "Caixa tipo moldura",
      aliases: ["caixa moldura"],
      materialPadrao: "Acrílico cristal 3mm",
      espessuraPadraoMm: 3,
      toleranciaCm: null,
      tamanhos: [
        { tamanho: "P", larguraCm: 15, alturaCm: 15, profundidadeCm: 3, vitreProductId: "C3TMP", vitreProductSku: "C3TMP" },
        { tamanho: "M", larguraCm: 20, alturaCm: 20, profundidadeCm: 3, vitreProductId: "C3TMM", vitreProductSku: "C3TMM" },
        { tamanho: "G", larguraCm: 30, alturaCm: 30, profundidadeCm: 3, vitreProductId: "C3TMG", vitreProductSku: "C3TMG" },
      ],
    },
  ],
};

describe("validateCatalogConfig", () => {
  test("config válida não gera issues", () => {
    expect(validateCatalogConfig(CAIXAS_VALIDO)).toEqual([]);
  });

  test("urlCatalogo null é permitido (link pendente, nunca inventado)", () => {
    expect(validateCatalogConfig({ ...CAIXAS_VALIDO, urlCatalogo: null })).toEqual([]);
  });

  test("categoria/titulo ausentes geram issues", () => {
    const issues = validateCatalogConfig({ ...CAIXAS_VALIDO, categoria: "", titulo: "" });
    expect(issues).toEqual(
      expect.arrayContaining([
        { campo: "categoria", motivo: "obrigatório" },
        { campo: "titulo", motivo: "obrigatório" },
      ])
    );
  });

  test("Fase D.2.2 — grupo com tamanhos:[] é VÁLIDO de propósito (catálogo comercial conhecido sem produto operacional ainda)", () => {
    const issues = validateCatalogConfig({
      ...CAIXAS_VALIDO,
      grupos: [{ ...CAIXAS_VALIDO.grupos[0], tamanhos: [] }],
    });
    expect(issues).toEqual([]);
  });

  test("grupo com tamanhos que não é um array gera issue", () => {
    const issues = validateCatalogConfig({
      ...CAIXAS_VALIDO,
      grupos: [{ ...CAIXAS_VALIDO.grupos[0], tamanhos: undefined as never }],
    });
    expect(issues.some((i) => i.motivo.includes("precisa ser um array"))).toBe(true);
  });

  test("tamanho sem vitreProductId gera issue", () => {
    const issues = validateCatalogConfig({
      ...CAIXAS_VALIDO,
      grupos: [
        {
          ...CAIXAS_VALIDO.grupos[0],
          tamanhos: [{ tamanho: "P", larguraCm: 15, alturaCm: 15, profundidadeCm: 3, vitreProductId: "", vitreProductSku: "" }],
        },
      ],
    });
    expect(issues.some((i) => i.motivo.includes("sem vitreProductId"))).toBe(true);
  });

  test("catalogGroupId duplicado gera issue", () => {
    const issues = validateCatalogConfig({
      ...CAIXAS_VALIDO,
      grupos: [CAIXAS_VALIDO.grupos[0], CAIXAS_VALIDO.grupos[0]],
    });
    expect(issues.some((i) => i.motivo.includes("id duplicado"))).toBe(true);
  });

  test("tamanho duplicado dentro do mesmo grupo gera issue", () => {
    const issues = validateCatalogConfig({
      ...CAIXAS_VALIDO,
      grupos: [
        {
          ...CAIXAS_VALIDO.grupos[0],
          tamanhos: [...CAIXAS_VALIDO.grupos[0].tamanhos, CAIXAS_VALIDO.grupos[0].tamanhos[0]],
        },
      ],
    });
    expect(issues.some((i) => i.motivo.includes("tamanho duplicado"))).toBe(true);
  });
});

describe("catalogGroupsFromConfig", () => {
  test("converte para o shape consumido por product_resolution.ts", () => {
    const groups = catalogGroupsFromConfig(CAIXAS_VALIDO);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      catalogGroupId: "caixa_moldura",
      categoria: "caixas",
      nome: "Caixa tipo moldura",
      toleranciaCm: null,
    });
    expect(groups[0].tamanhos).toHaveLength(3);
  });
});
