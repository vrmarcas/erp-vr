/**
 * confirmation_detector.test.ts — sprint P0.7 (item 11: C1-C6).
 */
import { detectCommercialIntent } from "../confirmation_detector";

describe("C1/C2 — confirmação explícita com orçamento aguardando → confirmQuote=true", () => {
  const CONFIRM_PHRASES = [
    "sim",
    "sim, confirmo",
    "confirmo",
    "pode fazer",
    "pode gerar",
    "pode fechar",
    "fechado",
    "vamos fechar",
    "pode seguir",
    "está aprovado",
    "esta aprovado",
    "aprovado",
    "ok, pode fazer",
    "beleza, pode gerar",
    "quero fechar",
    "pode emitir o orçamento",
  ];
  for (const texto of CONFIRM_PHRASES) {
    test(`"${texto}" → confirma`, () => {
      const r = detectCommercialIntent({ texto, awaitingConfirmation: true });
      expect(r.confirmQuote).toBe(true);
      expect(r.rejectQuote).toBe(false);
    });
  }
});

describe("C3 — sem orçamento aguardando confirmação → nunca confirma, mesmo com 'sim'", () => {
  const TEXTOS = ["sim", "confirmo", "pode fechar", "ok", "aprovado"];
  for (const texto of TEXTOS) {
    test(`"${texto}" sem awaitingConfirmation → não confirma`, () => {
      const r = detectCommercialIntent({ texto, awaitingConfirmation: false });
      expect(r.confirmQuote).toBe(false);
      expect(r.confidenceReason).toBe("NO_QUOTE_AWAITING_CONFIRMATION");
    });
  }
});

describe("C3b — 'sim' respondendo outra pergunta (não confirma preço) mesmo com orçamento aguardando", () => {
  const NAO_CONFIRMA = [
    "sim, quero saber o prazo",
    "sim, e acrilico",
    "sim, sao 10 unidades",
    "sim, meu nome e Ana",
  ];
  for (const texto of NAO_CONFIRMA) {
    test(`"${texto}" → não confirma (ambíguo, conteúdo não relacionado)`, () => {
      const r = detectCommercialIntent({ texto, awaitingConfirmation: true });
      expect(r.confirmQuote).toBe(false);
    });
  }

  test("'ok' sozinho COM orçamento aguardando confirma (resposta direta ao preço já mostrado)", () => {
    const r = detectCommercialIntent({ texto: "ok", awaitingConfirmation: true });
    expect(r.confirmQuote).toBe(true);
  });
});

describe("C4 — alteração de dados na mesma mensagem invalida a confirmação (nunca cria com simulação antiga)", () => {
  const ALTERACOES = [
    "sim, mas faz 20 unidades",
    "troca para 20 unidades",
    "preciso mudar a quantidade",
    "muda para 20 unidades",
  ];
  for (const texto of ALTERACOES) {
    test(`"${texto}" → não confirma (alteração/hesitação detectada, precisa recalcular — nunca usa a simulação antiga)`, () => {
      const r = detectCommercialIntent({ texto, awaitingConfirmation: true });
      expect(r.confirmQuote).toBe(false);
    });
  }

  test("'sim, mas faz 20 unidades' é classificado especificamente como alteração de dado, não rejeição genérica", () => {
    const r = detectCommercialIntent({ texto: "sim, mas faz 20 unidades", awaitingConfirmation: true });
    expect(r.confidenceReason).toMatch(/DATA_CHANGE_DETECTED/);
  });
});

describe("C5 — hesitação/negociação → nunca cria orçamento", () => {
  const HESITACAO = [
    "vou pensar",
    "me manda depois",
    "achei caro",
    "tem desconto?",
  ];
  for (const texto of HESITACAO) {
    test(`"${texto}" → não confirma`, () => {
      const r = detectCommercialIntent({ texto, awaitingConfirmation: true });
      expect(r.confirmQuote).toBe(false);
      expect(r.rejectQuote).toBe(true);
    });
  }
});

describe("Robustez — maiúsculas, acentos, pontuação não quebram a detecção", () => {
  test("'SIM, CONFIRMO!' (maiúsculas) confirma", () => {
    expect(detectCommercialIntent({ texto: "SIM, CONFIRMO!", awaitingConfirmation: true }).confirmQuote).toBe(true);
  });
  test("'Está Aprovado.' (acento + maiúscula + pontuação) confirma", () => {
    expect(detectCommercialIntent({ texto: "Está Aprovado.", awaitingConfirmation: true }).confirmQuote).toBe(true);
  });
  test("mensagem vazia nunca confirma", () => {
    expect(detectCommercialIntent({ texto: "", awaitingConfirmation: true }).confirmQuote).toBe(false);
  });
});
