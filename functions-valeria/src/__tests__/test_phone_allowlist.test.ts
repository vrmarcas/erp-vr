/**
 * test_phone_allowlist.test.ts — sprint P1.2, item 10.
 */
let _docData: Record<string, unknown> | undefined;

jest.mock("firebase-admin", () => ({
  firestore: jest.fn(() => ({
    collection: (_col: string) => ({
      doc: (_id: string) => ({
        get: jest.fn(async () => ({
          exists: _docData !== undefined,
          data: () => _docData,
        })),
      }),
    }),
  })),
}));

import { permitidoParaPipeline, _resetCacheParaTeste } from "../test_phone_allowlist";

beforeEach(() => {
  _docData = undefined;
  _resetCacheParaTeste();
});

describe("Allowlist vazia/ausente — sem restrição (produção normal)", () => {
  test("doc ausente → qualquer número passa", async () => {
    _docData = undefined;
    expect(await permitidoParaPipeline("+5511999998888")).toBe(true);
  });

  test("numeros: [] → qualquer número passa", async () => {
    _docData = { numeros: [] };
    expect(await permitidoParaPipeline("+5511999998888")).toBe(true);
  });
});

describe("Allowlist não-vazia — restringe ao número configurado", () => {
  beforeEach(() => {
    _docData = { numeros: ["+5511999998888"] };
  });

  test("número exatamente na allowlist → true", async () => {
    expect(await permitidoParaPipeline("+5511999998888")).toBe(true);
  });

  test("mesmo número em formato legado (sem +55, sem 9º dígito) → true (matching robusto)", async () => {
    expect(await permitidoParaPipeline("1199998888")).toBe(true);
  });

  test("número fora da allowlist → false", async () => {
    expect(await permitidoParaPipeline("+5511988887777")).toBe(false);
  });

  test("channelPhone nulo → false (nunca roda pipeline sem telefone conhecido quando há restrição)", async () => {
    expect(await permitidoParaPipeline(null)).toBe(false);
  });
});

describe("Cache — não lê o Firestore a cada chamada dentro do TTL", () => {
  test("muda o doc sem invalidar cache → resultado antigo persiste até reset", async () => {
    _docData = { numeros: ["+5511999998888"] };
    expect(await permitidoParaPipeline("+5511988887777")).toBe(false);
    _docData = { numeros: [] }; // muda "ao vivo", mas cache ainda vale
    expect(await permitidoParaPipeline("+5511988887777")).toBe(false);
    _resetCacheParaTeste();
    expect(await permitidoParaPipeline("+5511988887777")).toBe(true);
  });
});
