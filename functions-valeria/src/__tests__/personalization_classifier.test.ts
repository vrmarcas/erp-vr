/**
 * personalization_classifier.test.ts — ValerIA 2.0, Fase E.2.42 (2026-09-22).
 *
 * Cobre os casos obrigatórios do pedido (item 5) + negativos explícitos
 * contra falsos positivos (item 11): função pura, sem I/O, sem LLM.
 */
import { classifyPersonalizationText } from "../personalization_classifier";

describe("classifyPersonalizationText — casos obrigatórios (Fase E.2.42, item 5)", () => {
  test('"Quero essa caixa M com meu logo" → COSMETIC', () => {
    expect(classifyPersonalizationText(["Aplicar logo do cliente"])).toBe("COSMETIC");
  });

  test('"Quero essa caixa M com o nome Fazenda Santa Luzia" → COSMETIC', () => {
    expect(classifyPersonalizationText(["Nome Fazenda Santa Luzia gravado na tampa"])).toBe("COSMETIC");
  });

  test('"Quero essa caixa M em outro material" → STRUCTURAL', () => {
    expect(classifyPersonalizationText(["Cliente pediu outro material"])).toBe("STRUCTURAL");
  });

  test('"Quero ela com 47x32x18" (dimensão fora do padrão) → STRUCTURAL', () => {
    expect(classifyPersonalizationText(["Dimensão customizada 47x32x18"])).toBe("STRUCTURAL");
  });

  test('"Quero uma divisória interna diferente" → STRUCTURAL', () => {
    expect(classifyPersonalizationText(["Divisória interna diferente"])).toBe("STRUCTURAL");
  });

  test('"Quero personalizar" sem detalhe suficiente → UNKNOWN (nunca cosmético por padrão)', () => {
    expect(classifyPersonalizationText(["Personalizar"])).toBe("UNKNOWN");
    expect(classifyPersonalizationText(["Quero personalizar"])).toBe("UNKNOWN");
  });
});

describe("classifyPersonalizationText — negativos explícitos contra falso positivo (Fase E.2.42, item 11)", () => {
  test('"material enviado" (cliente mandou um arquivo de referência) NÃO significa "quero outro material"', () => {
    expect(classifyPersonalizationText(["Material enviado pelo cliente"])).toBe("UNKNOWN");
  });

  test('"nome do modelo" NÃO vira personalização cosmética automaticamente', () => {
    expect(classifyPersonalizationText(["Cliente perguntou o nome do modelo"])).toBe("UNKNOWN");
  });

  test('"nome do produto" também não é personalização (é metadado do catálogo, não pedido do cliente)', () => {
    expect(classifyPersonalizationText(["Confirmar nome do produto"])).toBe("UNKNOWN");
  });
});

describe("classifyPersonalizationText — agregação conservadora (múltiplos itens)", () => {
  test("lista vazia/ausente → UNKNOWN, nunca assume cosmético", () => {
    expect(classifyPersonalizationText([])).toBe("UNKNOWN");
    expect(classifyPersonalizationText(undefined)).toBe("UNKNOWN");
    expect(classifyPersonalizationText(null)).toBe("UNKNOWN");
  });

  test("todos os itens cosméticos → COSMETIC", () => {
    expect(classifyPersonalizationText(["Logo do cliente", "Texto gravado na tampa"])).toBe("COSMETIC");
  });

  test("um item estrutural entre vários cosméticos → STRUCTURAL vence (nunca mistura)", () => {
    expect(classifyPersonalizationText(["Logo do cliente", "Outro material", "Texto gravado"])).toBe("STRUCTURAL");
  });

  test("sem nenhum item estrutural, mas com algum item ambíguo → UNKNOWN (nunca cosmético por maioria)", () => {
    expect(classifyPersonalizationText(["Logo do cliente", "Personalizar mais um pouco"])).toBe("UNKNOWN");
  });

  test("item com sinal cosmético E estrutural no MESMO texto → estrutural sempre vence", () => {
    expect(classifyPersonalizationText(["Quero em outro material com o nome gravado"])).toBe("STRUCTURAL");
  });
});
