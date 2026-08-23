/**
 * orchestrator.test.ts — testes do motor determinístico de progressão
 * comercial (sprint P0.2 2026-08-23, P0.34).
 */
import { computeQuoteReadiness, nextCommercialAction } from "../orchestrator";
import type { BriefingData, Cliente, CrmLead } from "../types";

const briefingCompleto: BriefingData = {
  produto: "Caixa", larguraMm: 150, alturaMm: 150, quantidade: 1, material: "Acrílico Cristal",
};
const clienteConfirmado: Cliente = { id: "c1", nome: "João Silva", tel: "+5511999990000" } as Cliente;

describe("ORCHESTRATOR — computeQuoteReadiness", () => {
  test("1. Briefing vazio → not ready, todos os campos bloqueantes faltando", () => {
    const r = computeQuoteReadiness(null, null, null, null);
    expect(r.ready).toBe(false);
    expect(r.missingRequiredFields).toEqual(expect.arrayContaining(["produto", "larguraMm", "alturaMm", "quantidade", "material"]));
    expect(r.canGenerateQuote).toBe(false);
  });

  test("2. Briefing completo mas sem cliente/telefone → ready mas customerIdentityReady=false", () => {
    const r = computeQuoteReadiness(briefingCompleto, null, null, null);
    expect(r.ready).toBe(true);
    expect(r.customerIdentityReady).toBe(false);
    expect(r.canGenerateQuote).toBe(false);
    expect(r.blockingReason).toMatch(/identifica/i);
  });

  test("3. Briefing completo + cliente confirmado → canGenerateQuote=true", () => {
    const r = computeQuoteReadiness(briefingCompleto, clienteConfirmado, null, null);
    expect(r.ready).toBe(true);
    expect(r.customerIdentityReady).toBe(true);
    expect(r.canGenerateQuote).toBe(true);
    expect(r.blockingReason).toBeNull();
  });

  test("4. Telefone vindo do canal (channelPhone) conta como identidade, mesmo sem cliente cadastrado", () => {
    const r = computeQuoteReadiness(
      { ...briefingCompleto },
      null,
      { nome: "Maria" } as CrmLead,
      "+5511988887777"
    );
    expect(r.customerIdentityReady).toBe(true);
  });

  test("5. Campo com string genérica/zero não conta como preenchido", () => {
    const r = computeQuoteReadiness({ produto: "Caixa", larguraMm: 0, alturaMm: 150, quantidade: 1, material: "" }, null, null, null);
    expect(r.missingRequiredFields).toEqual(expect.arrayContaining(["larguraMm", "material"]));
  });
});

describe("ORCHESTRATOR — nextCommercialAction (P0.34)", () => {
  test("1. 'Bom dia' (sem histórico nenhum) → greet", () => {
    const r = nextCommercialAction({
      briefing: null, cliente: null, lead: null, channelPhone: null,
      temHistoricoConversa: false, orcamentoJaCriado: false,
    });
    expect(r.nextAction).toBe("greet");
  });

  test("2. 'Quero uma caixa' (produto ainda não confirmado) → classify_demand", () => {
    const r = nextCommercialAction({
      briefing: { observacoes: "quer uma caixa" }, cliente: null, lead: null, channelPhone: null,
      temHistoricoConversa: true, orcamentoJaCriado: false,
    });
    expect(r.nextAction).toBe("classify_demand");
  });

  test("3. Produto identificado, faltam medidas → ask_required_fields com missingFields exato", () => {
    const r = nextCommercialAction({
      briefing: { produto: "Caixa" }, cliente: null, lead: null, channelPhone: null,
      temHistoricoConversa: true, orcamentoJaCriado: false,
    });
    expect(r.nextAction).toBe("ask_required_fields");
    expect(r.missingFields).toEqual(expect.arrayContaining(["larguraMm", "alturaMm", "quantidade", "material"]));
    expect(r.missingFields).not.toContain("produto");
  });

  test("4. Dados completos, sem identificação → identify_customer (nunca calculate_quote direto)", () => {
    const r = nextCommercialAction({
      briefing: briefingCompleto, cliente: null, lead: null, channelPhone: null,
      temHistoricoConversa: true, orcamentoJaCriado: false,
    });
    expect(r.nextAction).toBe("identify_customer");
  });

  test("5. Preço calculado + identificação confirmada → calculate_quote (LLM não pode continuar perguntando)", () => {
    const r = nextCommercialAction({
      briefing: briefingCompleto, cliente: clienteConfirmado, lead: null, channelPhone: null,
      temHistoricoConversa: true, orcamentoJaCriado: false,
    });
    expect(r.nextAction).toBe("calculate_quote");
  });

  test("6. Orçamento já criado → present_quote, mesmo se briefing 'incompleto' de outro produto novo", () => {
    const r = nextCommercialAction({
      briefing: null, cliente: null, lead: null, channelPhone: null,
      temHistoricoConversa: true, orcamentoJaCriado: true,
    });
    expect(r.nextAction).toBe("present_quote");
  });

  test("7. Não retroceder: orçamento já criado vence mesmo com quoteReadiness pronta para recalcular", () => {
    const r = nextCommercialAction({
      briefing: briefingCompleto, cliente: clienteConfirmado, lead: null, channelPhone: null,
      temHistoricoConversa: true, orcamentoJaCriado: true,
    });
    expect(r.nextAction).toBe("present_quote");
  });

  test("8. handoffReasonCode sempre vence qualquer outro estado", () => {
    const r = nextCommercialAction({
      briefing: briefingCompleto, cliente: clienteConfirmado, lead: null, channelPhone: null,
      temHistoricoConversa: true, orcamentoJaCriado: false, handoffReasonCode: "CUSTOMER_REQUESTED_HUMAN",
    });
    expect(r.nextAction).toBe("handoff");
    expect(r.reason).toBe("CUSTOMER_REQUESTED_HUMAN");
  });
});
