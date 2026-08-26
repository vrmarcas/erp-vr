/**
 * complexity_detector.test.ts — sprint P1.2.
 */
import { detectUnsupportedComplexity } from "../complexity_detector";

describe("Produto complexo sem receita — bloqueia", () => {
  test('S1. "troféu com LED, madeira e mecanismo giratório" → bloqueia, LED+MOTOR+MADEIRA', () => {
    const r = detectUnsupportedComplexity({ texto: "Preciso fazer o troféu do campeão, com LED, madeira e mecanismo giratório." });
    expect(r.unsupportedComplexity).toBe(true);
    expect(r.requiresHuman).toBe(true);
    expect(r.reasonCodes).toEqual(
      expect.arrayContaining(["LED_ILUMINACAO", "ELETRONICA_MOTOR_MECANISMO", "MATERIAL_NAO_ACRILICO"])
    );
  });

  test('S4. "caixa com iluminação LED" → bloqueia mesmo "Caixa" sendo receita conhecida', () => {
    const r = detectUnsupportedComplexity({ texto: "Quero uma caixa com iluminação LED por dentro." });
    expect(r.unsupportedComplexity).toBe(true);
    expect(r.reasonCodes).toContain("LED_ILUMINACAO");
  });

  test.each([
    ["motor e mecanismo giratório", "ELETRONICA_MOTOR_MECANISMO"],
    ["quero um totem de madeira maciça", "MATERIAL_NAO_ACRILICO"],
    ["a peça precisa de uma dobradiça articulada", "PECA_ARTICULADA"],
    ["vai precisar de bateria e uma fonte elétrica", "COMPONENTE_ELETRICO_EXTERNO"],
    ["com montagem mecânica embutida", "MONTAGEM_MECANICA"],
  ])('"%s" → bloqueia com reasonCode %s', (texto, code) => {
    const r = detectUnsupportedComplexity({ texto });
    expect(r.unsupportedComplexity).toBe(true);
    expect(r.reasonCodes).toContain(code);
  });
});

describe("Produto simples — não bloqueia", () => {
  test('S2. "display de acrílico simples 30x20" → não bloqueia', () => {
    const r = detectUnsupportedComplexity({ texto: "Quero um display de acrílico simples, 30x20cm." });
    expect(r.unsupportedComplexity).toBe(false);
    expect(r.reasonCodes).toEqual([]);
    expect(r.requiresHuman).toBe(false);
  });

  test('S5. "placa de acrílico com gravação" → não bloqueia (gravação é sinal já tratado por outro mecanismo)', () => {
    const r = detectUnsupportedComplexity({ texto: "Quero uma placa de acrílico com gravação a laser." });
    expect(r.unsupportedComplexity).toBe(false);
  });

  test.each([
    "Quero uma caixa em acrílico transparente.",
    "1 unidade.",
    "Sim, confirmo.",
    "Qual o prazo de entrega?",
  ])('"%s" → não bloqueia', (texto) => {
    const r = detectUnsupportedComplexity({ texto });
    expect(r.unsupportedComplexity).toBe(false);
  });
});

describe("S3. Troféu GoJovem — receita conhecida nunca é bloqueada", () => {
  test("productId=Troféu GoJovem → nunca bloqueia, mesmo com sinal de complexidade no texto", () => {
    const r = detectUnsupportedComplexity({
      texto: "Quero o troféu do campeão do Go! Jovem, com LED e mecanismo giratório.",
      productId: "Troféu GoJovem",
    });
    expect(r.unsupportedComplexity).toBe(false);
    expect(r.reasonCodes).toEqual([]);
    expect(r.requiresHuman).toBe(false);
  });

  test("sem productId ainda (primeira menção) → bloqueia normalmente", () => {
    const r = detectUnsupportedComplexity({ texto: "Quero o troféu, com LED e mecanismo giratório.", productId: null });
    expect(r.unsupportedComplexity).toBe(true);
  });
});

describe("Determinismo (base para idempotência do handoff, S7)", () => {
  test("mesma entrada sempre produz o mesmo resultado", () => {
    const input = { texto: "Quero um troféu com motor e madeira." };
    const r1 = detectUnsupportedComplexity(input);
    const r2 = detectUnsupportedComplexity(input);
    expect(r1).toEqual(r2);
  });
});
