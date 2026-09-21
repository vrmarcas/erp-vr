/**
 * interaction_classifier.test.ts — ValerIA 2.0, Fase E.2.7 (2026-09-20).
 *
 * Matriz de casos do item 9 do pedido (+ exemplos da Fase E.2.4), cobrindo
 * EXPLORATORY, COMMERCIAL_INTENT e AMBIGUOUS.
 */
import { classifyIntent } from "../interaction_classifier";

describe("classifyIntent — EXPLORATORY", () => {
  const casos = [
    "Oi, bom dia!",
    "Vocês fazem peças sob medida?",
    "Que tipos de acrílico vocês trabalham?",
    "Qual o prazo médio?",
    "Vocês entregam em outras cidades?",
    "Vocês trabalham com acrílico preto?",
    "Vocês fazem troféus?",
    "Vocês entregam fora de Goiânia?",
    "Vocês fazem caixas?",
    "Como funciona?",
  ];
  test.each(casos)('"%s" → EXPLORATORY', (texto) => {
    expect(classifyIntent(texto).classification).toBe("EXPLORATORY");
  });
});

describe("classifyIntent — COMMERCIAL_INTENT", () => {
  const casos = [
    "Quero fazer uma caixa.",
    "Preciso de 10 troféus.",
    "Quero uma placa 30x20.",
    "Quanto fica 20 unidades de plaquinha?",
    "Quero essa caixa, mas em 35x25x10.",
    "Preciso disso para dia 10.",
    "Quero 10 caixas entregues em Brasília.",
    "Preciso pronto até sexta.",
    "Quero uma caixa.",
  ];
  test.each(casos)('"%s" → COMMERCIAL_INTENT', (texto) => {
    expect(classifyIntent(texto).classification).toBe("COMMERCIAL_INTENT");
  });
});

describe("classifyIntent — AMBIGUOUS (nunca forçar para comercial)", () => {
  const casos = [
    "Preciso de uma peça.",
    "Estou vendo uma caixa.",
    "Queria saber de troféu.",
    "Tenho interesse em uma placa.",
  ];
  test.each(casos)('"%s" → AMBIGUOUS', (texto) => {
    const r = classifyIntent(texto);
    expect(r.classification).toBe("AMBIGUOUS");
    expect(r.classification).not.toBe("COMMERCIAL_INTENT");
  });
});

describe("classifyIntent — mesma palavra, intenção oposta (prova de não-keyword)", () => {
  test('"Vocês fazem caixas?" → EXPLORATORY', () => {
    expect(classifyIntent("Vocês fazem caixas?").classification).toBe("EXPLORATORY");
  });
  test('"Quero uma caixa." → COMMERCIAL_INTENT', () => {
    expect(classifyIntent("Quero uma caixa.").classification).toBe("COMMERCIAL_INTENT");
  });
});

describe("classifyIntent — determinismo/idempotência", () => {
  test("mesma entrada produz sempre a mesma saída", () => {
    const texto = "Quero uma placa 30x20.";
    const a = classifyIntent(texto);
    const b = classifyIntent(texto);
    expect(a).toEqual(b);
  });
});

describe("classifyIntent — casos extremos", () => {
  test("string vazia → AMBIGUOUS, nunca comercial", () => {
    expect(classifyIntent("").classification).toBe("AMBIGUOUS");
  });
  test("burst concatenado (Fase M — mensagens agrupadas) classifica pelo conteúdo combinado", () => {
    const texto = "Oi\n\nPreciso de uma peça\n\n35x25";
    // contém dimensão explícita → comercial, mesmo com saudação embutida
    expect(classifyIntent(texto).classification).toBe("COMMERCIAL_INTENT");
  });
});
