import { extractShadowSignals } from "../shadow_signal_extractor";
import type { CatalogGroup } from "../product_resolution";
import { emptyCatalogDraft, type CatalogDraft } from "../catalog_draft";

const CATALOG: CatalogGroup[] = [
  {
    catalogGroupId: "caixa_tampa_de_correr",
    categoria: "caixas",
    nome: "Caixa com tampa de correr",
    aliases: ["tampa de correr", "caixa"],
    tamanhos: [],
    toleranciaCm: null,
  },
];

describe("extractShadowSignals", () => {
  test("reconhece alias de grupo por substring", () => {
    const { signals } = extractShadowSignals("Quero uma caixa tampa de correr", CATALOG);
    expect(signals.categoria).toBe("caixas");
    expect(signals.groupNameOrAlias).toBe("tampa de correr");
  });

  test("extrai dimensões explícitas", () => {
    const { signals } = extractShadowSignals("Quero uma placa 30x20", CATALOG);
    expect(signals.exactDimensionsCm).toEqual({ largura: 30, altura: 20, profundidade: null });
  });

  test("extrai quantidade de 'preciso de N'", () => {
    const { fieldUpdate } = extractShadowSignals("Preciso de 10 troféus", CATALOG);
    expect(fieldUpdate.quantity).toBe(10);
  });

  test("sem sinal nenhum, devolve nulls, nunca lança", () => {
    const { signals, fieldUpdate } = extractShadowSignals("Oi, bom dia", CATALOG);
    expect(signals.groupNameOrAlias).toBeNull();
    expect(fieldUpdate.quantity).toBeUndefined();
  });

  test("determinismo", () => {
    const a = extractShadowSignals("Quero uma caixa 30x20", CATALOG);
    const b = extractShadowSignals("Quero uma caixa 30x20", CATALOG);
    expect(a).toEqual(b);
  });
});

// ── Fase E.2.22 — extração de tamanho P/M/G (continuidade multi-turno) ──────
describe("extractShadowSignals — tamanho P/M/G (Fase E.2.22)", () => {
  function draftComGrupoSemTamanho(): CatalogDraft {
    const d = emptyCatalogDraft("conv1", null, true);
    return { ...d, catalogGroupId: "caixa_tampa_de_correr", matchedProductId: null };
  }

  test("CASO E — 'tamanho médio' → M, sem precisar de contexto", () => {
    const { signals } = extractShadowSignals("Quero tamanho médio", CATALOG);
    expect(signals.catalogSizeLabel).toBe("M");
  });

  test("'tamanho M' (letra) → M", () => {
    const { signals } = extractShadowSignals("Tampa de correr tamanho M.", CATALOG);
    expect(signals.catalogSizeLabel).toBe("M");
  });

  test("'modelo G' → G", () => {
    const { signals } = extractShadowSignals("Modelo G, por favor", CATALOG);
    expect(signals.catalogSizeLabel).toBe("G");
  });

  test("CASO F — 'quero o pequeno' em contexto de tamanho pendente → P", () => {
    const { signals } = extractShadowSignals("Quero o pequeno", CATALOG, draftComGrupoSemTamanho());
    expect(signals.catalogSizeLabel).toBe("P");
  });

  test("'o grande' → G, mesmo sem contexto (palavra específica o bastante)", () => {
    const { signals } = extractShadowSignals("Pode ser o grande", CATALOG);
    expect(signals.catalogSizeLabel).toBe("G");
  });

  test("CASO D — 'me manda uma caixa' → NÃO extrai tamanho (sem falso positivo em 'me')", () => {
    const { signals } = extractShadowSignals("me manda uma caixa", CATALOG);
    expect(signals.catalogSizeLabel).toBeUndefined();
  });

  test("'modelo' sozinho (sem letra) → não extrai tamanho", () => {
    const { signals } = extractShadowSignals("Qual o modelo disponível?", CATALOG);
    expect(signals.catalogSizeLabel).toBeUndefined();
  });

  test("'material' → não extrai tamanho por acidente", () => {
    const { signals } = extractShadowSignals("Qual material vocês usam?", CATALOG);
    expect(signals.catalogSizeLabel).toBeUndefined();
  });

  test("CASO G — 'G' isolado SEM contexto de tamanho pendente → não assume tamanho", () => {
    const { signals } = extractShadowSignals("G", CATALOG);
    expect(signals.catalogSizeLabel).toBeUndefined();
  });

  test("CASO G (positivo) — 'G' isolado COM contexto de tamanho pendente → assume G", () => {
    const { signals } = extractShadowSignals("G", CATALOG, draftComGrupoSemTamanho());
    expect(signals.catalogSizeLabel).toBe("G");
  });

  test("letra isolada dentro de uma palavra maior nunca conta como tamanho, mesmo com contexto pendente", () => {
    const { signals } = extractShadowSignals("gostei", CATALOG, draftComGrupoSemTamanho());
    expect(signals.catalogSizeLabel).toBeUndefined();
  });

  test("sinais de contexto (contextCatalogGroupId/contextMatchedProductId) vêm do priorDraft, nunca do texto", () => {
    const prior: CatalogDraft = { ...emptyCatalogDraft("conv1", null, true), catalogGroupId: "caixa_tampa_de_correr", matchedProductId: "C4TC3M", matchedProductSku: "C4TC3M" };
    const { signals } = extractShadowSignals("Na verdade, tamanho G.", CATALOG, prior);
    expect(signals.contextCatalogGroupId).toBe("caixa_tampa_de_correr");
    expect(signals.contextMatchedProductId).toBe("C4TC3M");
    expect(signals.contextMatchedProductSku).toBe("C4TC3M");
  });

  test("sem priorDraft, sinais de contexto ficam undefined (compatibilidade retroativa)", () => {
    const { signals } = extractShadowSignals("Oi", CATALOG);
    expect(signals.contextCatalogGroupId).toBeUndefined();
    expect(signals.contextMatchedProductId).toBeUndefined();
    expect(signals.contextMatchedProductSku).toBeUndefined();
  });
});
