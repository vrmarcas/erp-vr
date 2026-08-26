/**
 * handoff_detector.test.ts — sprint P1.0.
 */
import { detectHumanHandoff } from "../handoff_detector";

describe("Pedido explícito de humano", () => {
  test.each([
    "Quero falar com uma pessoa.",
    "Preciso falar com alguem",
    "Posso falar com um atendente?",
    "Não quero falar com robô",
  ])('"%s" → requiresHuman=true, CUSTOMER_REQUEST', (texto) => {
    const r = detectHumanHandoff({ texto });
    expect(r.requiresHuman).toBe(true);
    expect(r.humanReason).toBe("CUSTOMER_REQUEST");
    expect(r.priority).toBe("HIGH");
  });
});

describe("Reclamação", () => {
  test('"Isso é uma reclamação, o produto veio quebrado" → COMPLAINT, HIGH', () => {
    const r = detectHumanHandoff({ texto: "Isso é uma reclamação, o produto veio quebrado" });
    expect(r.requiresHuman).toBe(true);
    expect(r.humanReason).toBe("COMPLAINT");
    expect(r.priority).toBe("HIGH");
  });
});

describe("Pagamento", () => {
  test('"Meu boleto não chegou" → PAYMENT_ISSUE', () => {
    const r = detectHumanHandoff({ texto: "Meu boleto não chegou" });
    expect(r.requiresHuman).toBe(true);
    expect(r.humanReason).toBe("PAYMENT_ISSUE");
  });
});

describe("Sinais já computados pelo backend (nunca inventados pelo detector)", () => {
  test("pricingUnsupported=true → PRICING_UNSUPPORTED, NORMAL", () => {
    const r = detectHumanHandoff({ texto: "quero gravação a laser", pricingUnsupported: true });
    expect(r.requiresHuman).toBe(true);
    expect(r.humanReason).toBe("PRICING_UNSUPPORTED");
    expect(r.priority).toBe("NORMAL");
  });

  test("produtoComplexoSemReceita=true → CUSTOM_COMPLEX", () => {
    const r = detectHumanHandoff({
      texto: "Quero um troféu totalmente diferente, com iluminação LED e base de madeira.",
      produtoComplexoSemReceita: true,
    });
    expect(r.requiresHuman).toBe(true);
    expect(r.humanReason).toBe("CUSTOM_COMPLEX");
  });

  test("erroSistemaReal=true → SYSTEM_ERROR, HIGH (sempre o motivo mais forte)", () => {
    const r = detectHumanHandoff({ texto: "oi", erroSistemaReal: true });
    expect(r.requiresHuman).toBe(true);
    expect(r.humanReason).toBe("SYSTEM_ERROR");
    expect(r.priority).toBe("HIGH");
  });
});

describe("Negociação/desconto", () => {
  test('"Tem desconto para pagamento à vista?" → DISCOUNT_REQUEST, NORMAL', () => {
    const r = detectHumanHandoff({ texto: "Tem desconto para pagamento à vista?" });
    expect(r.requiresHuman).toBe(true);
    expect(r.humanReason).toBe("DISCOUNT_REQUEST");
    expect(r.priority).toBe("NORMAL");
  });
});

describe("Mensagens normais nunca disparam handoff", () => {
  test.each([
    "Quero uma caixa em acrílico.",
    "1 unidade.",
    "Sim, confirmo.",
    "Qual o prazo de entrega?",
    "Meu nome é João.",
  ])('"%s" → requiresHuman=false', (texto) => {
    const r = detectHumanHandoff({ texto });
    expect(r.requiresHuman).toBe(false);
    expect(r.humanReason).toBeNull();
  });
});
