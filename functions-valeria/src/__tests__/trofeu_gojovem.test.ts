/**
 * trofeu_gojovem.test.ts — sprint P0.9 (T1-T7: Troféu GoJovem).
 *
 * Achado real de negócio (2026-08-25): SKU TFMOD10 (vitre_produtos),
 * receita real de 5 peças em 2 materiais (erp_plan_produtos/pp_1787580661988,
 * "Troféu Modelo 10"), preço comercial fixo R$115,00/un — decisão de
 * Gabriel de usar o preço fixo cadastrado (cobre gravação/montagem que o
 * motor de área não sabe precificar), não o cálculo por m².
 */

jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn(() => ({ value: () => "" })),
}));
jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((_opts: unknown, handler: unknown) => handler),
}));

const _store: Record<string, Record<string, unknown>> = {};

function makeRef(col: string, id: string) {
  const key = `${col}/${id}`;
  return {
    get: jest.fn(async () => {
      const data = _store[key];
      return { exists: data !== undefined, data: () => data };
    }),
    set: jest.fn(async (value: Record<string, unknown>, opts?: { merge?: boolean }) => {
      const prev = opts?.merge ? (_store[key] ?? {}) : {};
      _store[key] = { ...prev, ...value };
    }),
    update: jest.fn(async (value: Record<string, unknown>) => {
      _store[key] = { ...(_store[key] ?? {}), ...value };
    }),
  };
}

const firestoreFn = Object.assign(
  jest.fn(() => ({
    collection: (col: string) => ({
      doc: (id: string) => makeRef(col, id),
      add: jest.fn(async (value: Record<string, unknown>) => {
        const id = "auto_" + Math.random().toString(36).slice(2);
        _store[`${col}/${id}`] = value;
        return { id };
      }),
    }),
    runTransaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        get: jest.fn(async (ref: ReturnType<typeof makeRef>) => ref.get()),
        set: jest.fn((ref: ReturnType<typeof makeRef>, value: Record<string, unknown>, opts?: { merge?: boolean }) => ref.set(value, opts)),
        update: jest.fn((ref: ReturnType<typeof makeRef>, value: Record<string, unknown>) => ref.update(value)),
      };
      return fn(tx);
    }),
  })),
  { FieldValue: { delete: () => Symbol("FieldValue.delete") } }
);

jest.mock("firebase-admin", () => ({
  apps: [true],
  initializeApp: jest.fn(),
  firestore: firestoreFn,
}));

import { isTrofeuGoJovemAlias, TROFEU_GOJOVEM_PRODUCT_ID, calculateTrofeuGoJovem } from "../trofeu_gojovem";
import { mergeTechnicalBriefing } from "../technical_briefing_store";
import { emptyTechnicalBriefing, technicalBriefingFingerprint } from "../technical_briefing";
import { computeCommercialRoute } from "../orchestrator";
import { executeCalculateQuote, executeCreateQuote, executeCommercialAction } from "../action_executor";
import { loadLastEligibleSimulation } from "../technical_briefing_store";
import type { Cliente } from "../types";

function setErpConfig() {
  _store["erp_vr/erp_config"] = {
    data: JSON.stringify({
      financeiro: { overhead: 41.16, vrml: 20, impostos: 0 },
      materiais: [{ comp: 183, larg: 122, custo: 180, rsm2: 8.05, nome: "Acrílico Cristal 3mm" }],
    }),
  };
}

function setTfmod10(precoVenda: number) {
  _store["vitre_produtos/TFMOD10"] = { sku: "TFMOD10", precoVenda };
}

const clienteConfirmado: Cliente = { id: "c1", nome: "Gabriel", tel: "+5511999990000" } as Cliente;

beforeEach(() => {
  for (const k of Object.keys(_store)) delete _store[k];
  setErpConfig();
  setTfmod10(115);
});

describe("T1 — reconhecimento de alias 'Troféu GoJovem'", () => {
  test.each([
    "Troféu GoJovem",
    "troféu do GoJovem",
    "troféu da premiação GoJovem",
    "trofeu gojovem",
    "TROFÉU GOJOVEM",
    "Preciso de um trofeu para o Go Jovem",
  ])('"%s" é reconhecido como alias', (texto) => {
    expect(isTrofeuGoJovemAlias(texto)).toBe(true);
  });

  test.each(["Troféu", "GoJovem", "Caixa personalizada", "Medalha do evento"])(
    '"%s" NÃO é reconhecido (falta um dos dois termos)',
    (texto) => {
      expect(isTrofeuGoJovemAlias(texto)).toBe(false);
    }
  );

  test.each([
    "Gostei do Modelo 11 que está no catálogo do WhatsApp.",
    "Quero o modelo 11",
    "Modelo 10",
    "MODELO 11",
  ])('P1.3 — "%s" é reconhecido pelo nome comercial do modelo (mesmo sem "troféu"/"go jovem" na frase)', (texto) => {
    expect(isTrofeuGoJovemAlias(texto)).toBe(true);
  });

  test.each(["Modelo 12", "Modelo 1", "modelo"])(
    'P1.3 — "%s" NÃO é reconhecido (número de modelo diferente ou ausente)',
    (texto) => {
      expect(isTrofeuGoJovemAlias(texto)).toBe(false);
    }
  );
});

describe("T2 — mergeTechnicalBriefing auto-preenche campos técnicos fixos do GoJovem", () => {
  test("productId canonicalizado + larguraMm/alturaMm/thicknessMm/materialId preenchidos sem o cliente informar nada disso", () => {
    const out = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "troféu do GoJovem" });
    expect(out.productId).toBe(TROFEU_GOJOVEM_PRODUCT_ID);
    expect(out.dimensions.larguraMm).toBeGreaterThan(0);
    expect(out.dimensions.alturaMm).toBeGreaterThan(0);
    expect(out.thicknessMm).toBeGreaterThan(0);
    expect(out.materialId).toBeTruthy();
    // Único campo obrigatório restante: quantidade (o cliente não precisa
    // informar material/espessura/tamanho — o modelo já define).
    expect(out.missingRequiredFields).toEqual(["quantity"]);
  });

  test("quantidade informada junto → briefing 100% pronto, sem nenhuma pergunta técnica pendente", () => {
    const out = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 10 });
    expect(out.missingRequiredFields).toEqual([]);
  });
});

describe("T3 — quantidade 10 calcula preço fixo × quantidade", () => {
  test("calculateTrofeuGoJovem(10) = 10 × precoVenda cadastrado (R$115) = R$1150", async () => {
    const r = await calculateTrofeuGoJovem(10);
    expect(r.pricing.eligibility).toBe("ELIGIBLE");
    expect(r.pricing.finalPrice).toBe(1150);
    expect(r.pieces.length).toBe(5); // 5 peças reais da receita (Corpo×3 + Sobreposta×2)
  });

  test("executeCalculateQuote com productId GoJovem usa o ramo de preço fixo (não o motor de área genérico)", async () => {
    const tb = { ...emptyTechnicalBriefing(), ...mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 10 }) };
    const r = await executeCalculateQuote("conv_t3", tb);
    expect(r.success).toBe(true);
    if (r.success) expect(r.finalPrice).toBe(1150);
  });
});

describe("T4 — alterar quantidade invalida a simulação anterior (fingerprint muda)", () => {
  test("fingerprint com quantity=10 é diferente do fingerprint com quantity=15", () => {
    const tb10 = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 10 });
    const tb15 = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 15 });
    expect(technicalBriefingFingerprint(tb10)).not.toBe(technicalBriefingFingerprint(tb15));
  });

  test("simulação calculada para 10 unidades não é reaproveitada se o briefing atual já mostra 15 (recalcula)", async () => {
    const tb10 = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 10 });
    await executeCalculateQuote("conv_t4", tb10);
    const simAntiga = await loadLastEligibleSimulation("conv_t4");
    expect(simAntiga?.fingerprint).toBe(technicalBriefingFingerprint(tb10));

    const tb15 = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 15 });
    expect(simAntiga?.fingerprint).not.toBe(technicalBriefingFingerprint(tb15));

    const r15 = await executeCalculateQuote("conv_t4", tb15);
    expect(r15.success).toBe(true);
    if (r15.success) expect(r15.finalPrice).toBe(15 * 115);
  });
});

describe("T5 — commercialRoute do Troféu GoJovem é sempre VR_CUSTOM, nunca Vitre", () => {
  test("computeCommercialRoute com productId=Troféu GoJovem retorna VR_CUSTOM", () => {
    const tb = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 1 });
    expect(computeCommercialRoute(tb)).toBe("VR_CUSTOM");
  });
});

describe("T6/T7 — confirmação cria orçamento real, preço calculado = preço persistido", () => {
  test("executeCreateQuote a partir da simulação GoJovem cria orçamento com total idêntico ao finalPrice calculado", async () => {
    const tb = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 10 });
    const calc = await executeCalculateQuote("conv_t6", tb);
    expect(calc.success).toBe(true);
    const canonico = await loadLastEligibleSimulation("conv_t6");
    expect(canonico).not.toBeNull();

    const r = await executeCreateQuote({
      conversationId: "conv_t6", agentId: "agent_x", organizationId: "org_x",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      lastEligibleSimulation: canonico!,
    });
    expect(r.success).toBe(true);
    if (r.success && calc.success) {
      expect(r.total).toBe(calc.finalPrice);
      expect(r.total).toBe(1150);
    }
  });
});

describe("T8 — atendimento de teste não altera KPIs comerciais (isTest propaga igual ao motor genérico)", () => {
  test("atendimento isTeste=true → orçamento do Troféu GoJovem nasce com isTest=true", async () => {
    _store["atendimentos/conv_t8"] = { isTeste: true };
    const tb = mergeTechnicalBriefing(emptyTechnicalBriefing(), { productId: "Troféu GoJovem", quantity: 10 });
    await executeCommercialAction({
      conversationId: "conv_t8", agentId: "a", organizationId: "o",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      nextAction: "calculate_quote", technicalBriefing: tb, lastEligibleSimulation: null,
      isTest: true,
    });
    const canonico = await loadLastEligibleSimulation("conv_t8");
    const created = await executeCommercialAction({
      conversationId: "conv_t8", agentId: "a", organizationId: "o",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      nextAction: "create_quote", technicalBriefing: tb, lastEligibleSimulation: canonico,
    });
    expect(created?.action).toBe("create_quote");
    if (created?.action === "create_quote" && created.result.success) {
      const orcamentos = JSON.parse(_store["erp_vr/orcamentos"].data as string);
      const orcReal = orcamentos.find((o: { id: string }) => o.id === created.result.orcamentoId);
      expect(orcReal?.isTest).toBe(true);
      expect(orcReal?.total).toBe(1150);
    }
  });
});
