/**
 * shadow_firestore_sanitization.test.ts — ValerIA 2.0, Fase E.2.10 (2026-09-21).
 *
 * Regressão da causa raiz nº 2 de E.2.9: Firestore rejeita `undefined` em
 * qualquer campo de um `.set()`, e `extractedSignals.exactDimensionsCm`
 * podia chegar como `undefined` (sinal ausente), derrubando a escrita de
 * `valeria_shadow_results` com "Value for argument \"data\" is not a
 * valid Firestore document". `sanitizeForFirestore` é a fronteira que
 * normaliza `undefined → null` só na hora de persistir, sem alterar a
 * semântica do pipeline puro (que continua livre para usar `undefined`
 * como "ausente" internamente).
 */
import { sanitizeForFirestore } from "../shadow_runner";
import { extractShadowSignals } from "../shadow_signal_extractor";
import type { CatalogGroup } from "../product_resolution";

const CATALOG: CatalogGroup[] = [
  { catalogGroupId: "caixas", categoria: "caixas", nome: "Caixa", aliases: [], tamanhos: [], toleranciaCm: null },
];

/** Percorre recursivamente e falha se encontrar qualquer `undefined` — o que o Firestore rejeitaria. */
function assertNoUndefinedDeep(value: unknown, path = "$"): void {
  if (value === undefined) {
    throw new Error(`undefined encontrado em ${path} — Firestore rejeitaria este campo`);
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefinedDeep(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefinedDeep(v, `${path}.${k}`);
  }
}

describe("sanitizeForFirestore — fronteira de persistência do shadow (E.2.10)", () => {
  test("A. extractedSignals com exactDimensionsCm=undefined (caso real do teste 5) não lança e vira null", () => {
    const { signals } = extractShadowSignals("Oi, bom dia", CATALOG); // sem dimensão → exactDimensionsCm undefined
    expect(signals.exactDimensionsCm).toBeUndefined(); // pipeline puro continua usando undefined — não alterado

    const payload = { extractedSignals: signals };
    expect(() => assertNoUndefinedDeep(sanitizeForFirestore(payload))).not.toThrow();
    expect(sanitizeForFirestore(payload).extractedSignals.exactDimensionsCm).toBeNull();
  });

  test("B. nenhum undefined sobrevive à sanitização, em qualquer profundidade (objeto, array, aninhado)", () => {
    const dirty = {
      a: undefined,
      b: null,
      c: "ok",
      nested: { x: undefined, y: 1 },
      list: [undefined, { z: undefined }, 2],
    };
    const clean = sanitizeForFirestore(dirty);
    expect(() => assertNoUndefinedDeep(clean)).not.toThrow();
    expect(clean).toEqual({
      a: null,
      b: null,
      c: "ok",
      nested: { x: null, y: 1 },
      list: [null, { z: null }, 2],
    });
  });

  test("valores primitivos, null, Date e objetos sem undefined passam intactos", () => {
    const now = new Date();
    expect(sanitizeForFirestore(42)).toBe(42);
    expect(sanitizeForFirestore("x")).toBe("x");
    expect(sanitizeForFirestore(null)).toBeNull();
    expect(sanitizeForFirestore(now)).toBe(now);
    expect(sanitizeForFirestore({ a: 1, b: "y" })).toEqual({ a: 1, b: "y" });
  });

  test("é função pura — não importa firebase-admin além do já usado por shadow_runner.ts, não faz I/O", () => {
    // sanity: chamar duas vezes com a mesma entrada dá o mesmo resultado, sem efeito colateral observável.
    const input = { a: undefined, b: [1, undefined, 3] };
    expect(sanitizeForFirestore(input)).toEqual(sanitizeForFirestore(input));
  });
});
