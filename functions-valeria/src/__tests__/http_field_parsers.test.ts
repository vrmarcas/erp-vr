/**
 * http_field_parsers.test.ts — ValerIA 2.0, Fase E.2 (2026-09-20).
 *
 * Cobre cada parser da borda HTTP isoladamente: tipo nativo, string
 * equivalente do ChatVolt, e rejeição explícita do que não deve ser aceito
 * (seção 10 do checkpoint — cada conversão A-K).
 */
import {
  FieldParseError,
  parseOptionalString,
  parseOptionalNumber,
  parseOptionalBoolean,
  parseOptionalExactDimensions,
  parseOptionalCustomDimensions,
  parseOptionalDeliveryData,
  parseOptionalStringArray,
} from "../http_field_parsers";

describe("parseOptionalString", () => {
  test("undefined/null → null", () => {
    expect(parseOptionalString(undefined)).toBeNull();
    expect(parseOptionalString(null)).toBeNull();
  });
  test("string vazia/whitespace → null", () => {
    expect(parseOptionalString("")).toBeNull();
    expect(parseOptionalString("   ")).toBeNull();
  });
  test("string normal → trimada", () => {
    expect(parseOptionalString("  caixas  ")).toBe("caixas");
  });
  test("tipo não-string → null (nunca converte às cegas)", () => {
    expect(parseOptionalString(10)).toBeNull();
    expect(parseOptionalString(true)).toBeNull();
  });
});

describe("parseOptionalNumber", () => {
  // A. quantity = 10 → 10
  test("A. number nativo → mesmo number", () => {
    expect(parseOptionalNumber("quantity", 10)).toBe(10);
  });
  // B. quantity = "10" → 10
  test("B. string numérica → number", () => {
    expect(parseOptionalNumber("quantity", "10")).toBe(10);
  });
  test("string decimal → number", () => {
    expect(parseOptionalNumber("quantity", "10.5")).toBe(10.5);
    expect(parseOptionalNumber("quantity", 10.5)).toBe(10.5);
  });
  test("undefined/null → null", () => {
    expect(parseOptionalNumber("quantity", undefined)).toBeNull();
    expect(parseOptionalNumber("quantity", null)).toBeNull();
  });
  test("string vazia → null (não é 0)", () => {
    expect(parseOptionalNumber("quantity", "")).toBeNull();
  });
  test("negativo com sinal → aceito (parser não valida domínio, só forma)", () => {
    expect(parseOptionalNumber("quantity", "-5")).toBe(-5);
  });
  test("rejeita texto não-numérico", () => {
    expect(() => parseOptionalNumber("quantity", "dez")).toThrow(FieldParseError);
  });
  test("rejeita número com unidade embutida", () => {
    expect(() => parseOptionalNumber("quantity", "10 unidades")).toThrow(FieldParseError);
  });
  test("rejeita NaN nativo", () => {
    expect(() => parseOptionalNumber("quantity", NaN)).toThrow(FieldParseError);
  });
  test("rejeita Infinity nativo e como string", () => {
    expect(() => parseOptionalNumber("quantity", Infinity)).toThrow(FieldParseError);
    expect(() => parseOptionalNumber("quantity", "Infinity")).toThrow(FieldParseError);
  });
  test("rejeita tipo inesperado (boolean/objeto)", () => {
    expect(() => parseOptionalNumber("quantity", true)).toThrow(FieldParseError);
    expect(() => parseOptionalNumber("quantity", {})).toThrow(FieldParseError);
  });
});

describe("parseOptionalBoolean", () => {
  // C. boolean = true → true
  test("C. boolean nativo true → true", () => {
    expect(parseOptionalBoolean("x", true)).toBe(true);
  });
  test("boolean nativo false → false", () => {
    expect(parseOptionalBoolean("x", false)).toBe(false);
  });
  // D. boolean = "true" → true
  test('D. string "true" → true', () => {
    expect(parseOptionalBoolean("x", "true")).toBe(true);
  });
  // E. boolean = "false" → false
  test('E. string "false" → false', () => {
    expect(parseOptionalBoolean("x", "false")).toBe(false);
  });
  test("aceita variação de caixa (TRUE/False)", () => {
    expect(parseOptionalBoolean("x", "TRUE")).toBe(true);
    expect(parseOptionalBoolean("x", "False")).toBe(false);
  });
  test("undefined/null → null", () => {
    expect(parseOptionalBoolean("x", undefined)).toBeNull();
    expect(parseOptionalBoolean("x", null)).toBeNull();
  });
  // K. "false" nunca vira true por coerção acidental — e nenhuma string
  // arbitrária vira true.
  test('K. "false" nunca vira true; string arbitrária é rejeitada, não vira true', () => {
    expect(parseOptionalBoolean("x", "false")).toBe(false);
    expect(() => parseOptionalBoolean("x", "sim")).toThrow(FieldParseError);
    expect(() => parseOptionalBoolean("x", "yes")).toThrow(FieldParseError);
    expect(() => parseOptionalBoolean("x", "1")).toThrow(FieldParseError);
    expect(() => parseOptionalBoolean("x", "")).toThrow(FieldParseError);
  });
  test("rejeita tipo inesperado (number/objeto)", () => {
    expect(() => parseOptionalBoolean("x", 1)).toThrow(FieldParseError);
    expect(() => parseOptionalBoolean("x", {})).toThrow(FieldParseError);
  });
});

describe("parseOptionalExactDimensions", () => {
  // F. exactDimensionsCm objeto nativo → funciona
  test("F. objeto nativo → mesmo shape", () => {
    expect(parseOptionalExactDimensions("exactDimensionsCm", { largura: 35, altura: 25, profundidade: 10 })).toEqual({
      largura: 35,
      altura: 25,
      profundidade: 10,
    });
  });
  // G. exactDimensionsCm string JSON → mesmo resultado
  test("G. string JSON → mesmo resultado do objeto nativo", () => {
    const nativo = parseOptionalExactDimensions("exactDimensionsCm", { largura: 35, altura: 25, profundidade: 10 });
    const viaString = parseOptionalExactDimensions("exactDimensionsCm", '{"largura":35,"altura":25,"profundidade":10}');
    expect(viaString).toEqual(nativo);
  });
  test("profundidade omitida → null (campo opcional)", () => {
    expect(parseOptionalExactDimensions("exactDimensionsCm", { largura: 20, altura: 20 })).toEqual({
      largura: 20,
      altura: 20,
      profundidade: null,
    });
  });
  test("largura/altura como string numérica dentro do objeto → convertidas", () => {
    expect(parseOptionalExactDimensions("exactDimensionsCm", { largura: "35", altura: "25" })).toEqual({
      largura: 35,
      altura: 25,
      profundidade: null,
    });
  });
  test("undefined/null → null", () => {
    expect(parseOptionalExactDimensions("exactDimensionsCm", undefined)).toBeNull();
    expect(parseOptionalExactDimensions("exactDimensionsCm", null)).toBeNull();
  });
  // J. JSON inválido → não quebra function / erro de validação adequado
  test("J. JSON inválido → FieldParseError (não lança exceção não tratada)", () => {
    expect(() => parseOptionalExactDimensions("exactDimensionsCm", "{largura: 35")).toThrow(FieldParseError);
  });
  test("faltando largura/altura → erro explícito", () => {
    expect(() => parseOptionalExactDimensions("exactDimensionsCm", { profundidade: 10 })).toThrow(FieldParseError);
  });
  test("array em vez de objeto → erro explícito", () => {
    expect(() => parseOptionalExactDimensions("exactDimensionsCm", [35, 25])).toThrow(FieldParseError);
  });
});

describe("parseOptionalCustomDimensions", () => {
  test("objeto nativo e string JSON produzem o mesmo resultado", () => {
    const nativo = parseOptionalCustomDimensions("customDimensions", { larguraCm: 35, alturaCm: 25, profundidadeCm: 10 });
    const viaString = parseOptionalCustomDimensions("customDimensions", '{"larguraCm":35,"alturaCm":25,"profundidadeCm":10}');
    expect(viaString).toEqual(nativo);
    expect(nativo).toEqual({ larguraCm: 35, alturaCm: 25, profundidadeCm: 10 });
  });
  test("undefined/null → null", () => {
    expect(parseOptionalCustomDimensions("customDimensions", undefined)).toBeNull();
    expect(parseOptionalCustomDimensions("customDimensions", null)).toBeNull();
  });
  test("JSON inválido → FieldParseError", () => {
    expect(() => parseOptionalCustomDimensions("customDimensions", "not json")).toThrow(FieldParseError);
  });
});

describe("parseOptionalDeliveryData", () => {
  test("objeto nativo e string JSON produzem o mesmo resultado", () => {
    const nativo = parseOptionalDeliveryData("deliveryData", { cidade: "Goiânia", observacoes: "portaria 3" });
    const viaString = parseOptionalDeliveryData("deliveryData", '{"cidade":"Goiânia","observacoes":"portaria 3"}');
    expect(viaString).toEqual(nativo);
  });
  test("campos ausentes → null cada um (nenhum é obrigatório)", () => {
    expect(parseOptionalDeliveryData("deliveryData", {})).toEqual({ cidade: null, observacoes: null });
  });
  test("undefined/null → null", () => {
    expect(parseOptionalDeliveryData("deliveryData", undefined)).toBeNull();
    expect(parseOptionalDeliveryData("deliveryData", null)).toBeNull();
  });
});

describe("parseOptionalStringArray", () => {
  // H. personalization array nativo → funciona
  test("H. array nativo → mesmo array", () => {
    expect(parseOptionalStringArray("personalization", ["logo_evento", "nome_joao"])).toEqual(["logo_evento", "nome_joao"]);
  });
  // I. personalization string JSON → mesmo resultado
  test("I. string JSON → mesmo resultado do array nativo", () => {
    const nativo = parseOptionalStringArray("personalization", ["logo_evento", "nome_joao"]);
    const viaString = parseOptionalStringArray("personalization", '["logo_evento","nome_joao"]');
    expect(viaString).toEqual(nativo);
  });
  test("undefined/null → undefined (distinto de [])", () => {
    expect(parseOptionalStringArray("personalization", undefined)).toBeUndefined();
    expect(parseOptionalStringArray("personalization", null)).toBeUndefined();
  });
  test("array vazio → [] (cliente confirmou zero itens, não é 'campo ausente')", () => {
    expect(parseOptionalStringArray("personalization", [])).toEqual([]);
    expect(parseOptionalStringArray("personalization", "[]")).toEqual([]);
  });
  test("rejeita item não-string dentro do array (nunca aceita objeto no array)", () => {
    expect(() => parseOptionalStringArray("personalization", ["a", 1])).toThrow(FieldParseError);
    expect(() => parseOptionalStringArray("personalization", ["a", { x: 1 }])).toThrow(FieldParseError);
  });
  test("rejeita valor não-array (objeto solto)", () => {
    expect(() => parseOptionalStringArray("personalization", { a: 1 })).toThrow(FieldParseError);
  });
  test("JSON inválido → FieldParseError", () => {
    expect(() => parseOptionalStringArray("personalization", "[not json")).toThrow(FieldParseError);
  });
});
