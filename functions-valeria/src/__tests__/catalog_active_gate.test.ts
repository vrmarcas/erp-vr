/**
 * catalog_active_gate.test.ts — ValerIA 2.0, Fase D.1.1 (2026-09-19).
 *
 * Trava de segurança pedida antes do apply: a simples presença de um
 * productId dentro de `valeria_catalogos` NUNCA torna o produto
 * utilizável pela V2 se o catálogo estiver `ativo:false`. Mock de
 * Firestore em memória (mesmo padrão já usado em
 * technical_briefing_store.test.ts) para exercitar getActiveCatalogConfig/
 * getAllActiveCatalogConfigs de verdade, não só a lógica pura.
 */
type FakeDoc = Record<string, unknown>;

const _colecoes: Record<string, Record<string, FakeDoc>> = {};

jest.mock("firebase-admin", () => {
  return {
    apps: [true],
    initializeApp: jest.fn(),
    firestore: jest.fn(() => ({
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: jest.fn(async () => {
            const data = _colecoes[col]?.[id];
            return { exists: data !== undefined, data: () => data, id };
          }),
        }),
        where: (field: string, _op: string, value: unknown) => ({
          get: jest.fn(async () => {
            const all = Object.entries(_colecoes[col] || {});
            const filtrados = all.filter(([, doc]) => doc[field] === value);
            return { docs: filtrados.map(([id, doc]) => ({ id, data: () => doc })) };
          }),
        }),
      }),
    })),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const catalogModule = require("../catalog") as typeof import("../catalog");
const { getActiveCatalogConfig, getAllActiveCatalogConfigs } = catalogModule;

function seedCatalogo(id: string, overrides: Partial<FakeDoc> = {}) {
  _colecoes["valeria_catalogos"] = _colecoes["valeria_catalogos"] || {};
  _colecoes["valeria_catalogos"][id] = {
    categoria: id,
    titulo: "Catálogo Teste",
    urlCatalogo: null,
    ativo: false,
    version: 1,
    validUntil: null,
    grupos: [],
    ...overrides,
  };
}

describe("Trava de ativação — catálogo com ativo=false nunca é oferecido", () => {
  beforeEach(() => {
    delete _colecoes["valeria_catalogos"];
  });

  test("CATÁLOGO EXISTE + ativo=false → getActiveCatalogConfig devolve null (valeriaGetCatalog nunca oferece a categoria)", async () => {
    seedCatalogo("caixas", { ativo: false, grupos: [{ catalogGroupId: "x", tamanhos: [{ vitreProductId: "C4TC3M" }] }] });
    const result = await getActiveCatalogConfig("caixas");
    expect(result).toBeNull();
  });

  test("CATÁLOGO EXISTE + ativo=false → getAllActiveCatalogConfigs (usado quando a categoria ainda não foi identificada) também não retorna essa categoria", async () => {
    seedCatalogo("caixas", { ativo: false });
    const result = await getAllActiveCatalogConfigs();
    expect(result).toEqual([]);
  });

  test("CATÁLOGO EXISTE + ativo=true → estruturalmente carregável (sujeito aos demais gates de elegibilidade V2/feature flag)", async () => {
    seedCatalogo("caixas", { ativo: true, grupos: [{ catalogGroupId: "caixa_tipo_moldura", tamanhos: [] }] });
    const result = await getActiveCatalogConfig("caixas");
    expect(result).not.toBeNull();
    expect(result?.ativo).toBe(true);

    const todos = await getAllActiveCatalogConfigs();
    expect(todos.map((c) => c.categoria)).toContain("caixas");
  });

  test("categoria inexistente → null, sem lançar exceção", async () => {
    const result = await getActiveCatalogConfig("categoria_que_nao_existe");
    expect(result).toBeNull();
  });
});
