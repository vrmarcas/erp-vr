/**
 * action_executor.test.ts — sprint P0.6 (P0.6, item 17: A1-A7).
 *
 * Achado real de E2E (sprint P0.5): o backend retornou corretamente
 * nextAction="calculate_quote" + toolToCall="calcular_produto_personalizado"
 * e o LLM (GPT-4.1 Mini) ignorou a decisão, foi para o fluxo Vitre — zero
 * Tool de cálculo chamada. Estes testes provam que a execução das ações
 * comerciais determinísticas (calculate_quote/create_quote/
 * check_production_deadline/check_urgent_fit) não depende de NENHUM Tool
 * call — só do nextAction já decidido e do estado já persistido.
 */

jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn(() => ({ value: () => "" })),
}));
jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((_opts: unknown, handler: unknown) => handler),
}));

// ── Mock Firestore genérico (multi-coleção + transação) ─────────────────────
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
      const merged: Record<string, unknown> = { ...prev, ...value };
      for (const k of Object.keys(merged)) {
        if (typeof merged[k] === "symbol") delete merged[k];
      }
      _store[key] = merged;
    }),
    update: jest.fn(async (value: Record<string, unknown>) => {
      _store[key] = { ...(_store[key] ?? {}), ...value };
    }),
  };
}

const FieldValueDelete = Symbol("FieldValue.delete");

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
  { FieldValue: { delete: () => FieldValueDelete } }
);

jest.mock("firebase-admin", () => ({
  apps: [true],
  initializeApp: jest.fn(),
  firestore: firestoreFn,
}));

import {
  executeCommercialAction,
  executeCalculateQuote,
  executeCreateQuote,
  executeCheckProductionDeadline,
  executeCheckUrgentFit,
  EXECUTABLE_ACTIONS,
} from "../action_executor";
import { emptyTechnicalBriefing, technicalBriefingFingerprint } from "../technical_briefing";
import { loadLastEligibleSimulation, loadTechnicalBriefing } from "../technical_briefing_store";
import type { TechnicalBriefing } from "../technical_briefing";
import type { Cliente } from "../types";

function setErpConfig() {
  _store["erp_vr/erp_config"] = {
    data: JSON.stringify({
      financeiro: { overhead: 41.16, vrml: 20, impostos: 0 },
      materiais: [{ comp: 183, larg: 122, custo: 180, rsm2: 8.05, nome: "Acrílico Cristal 3mm" }],
    }),
  };
}

const tbCaixaCompleto: TechnicalBriefing = {
  ...emptyTechnicalBriefing(),
  productId: "Caixa",
  dimensions: { larguraMm: 400, alturaMm: 300, profundidadeMm: 250 },
  thicknessMm: 3, materialId: "cfg_0", quantity: 2,
};

const clienteConfirmado: Cliente = { id: "c1", nome: "João Silva", tel: "+5511999990000" } as Cliente;

beforeEach(() => {
  for (const k of Object.keys(_store)) delete _store[k];
  setErpConfig();
});

describe("A1 — executeCalculateQuote (VR_CUSTOM + calculate_quote → executor chama somente o cálculo VR)", () => {
  test("technicalBriefing pronto → ELIGIBLE, finalPrice > 0, simulação salva canonicamente (sem nenhum Tool call)", async () => {
    const r = await executeCalculateQuote("conv_a1", tbCaixaCompleto);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.finalPrice).toBeGreaterThan(0);
      expect(r.simulationId).toBeTruthy();
    }
    const canonico = await loadLastEligibleSimulation("conv_a1");
    expect(canonico?.simulationId).toBe(r.success ? r.simulationId : undefined);
    expect(canonico?.fingerprint).toBe(technicalBriefingFingerprint(tbCaixaCompleto));
  });

  test("technicalBriefing incompleto → TECHNICAL_BRIEFING_NOT_READY, nunca inventa preço", async () => {
    const r = await executeCalculateQuote("conv_a1b", emptyTechnicalBriefing());
    expect(r.success).toBe(false);
    if (!r.success) expect(r.eligibility).toBeNull();
  });
});

describe("A2 — commercialRoute trava VR_CUSTOM (guard de rota — nunca migra para Vitre no mesmo turno)", () => {
  test("executeCommercialAction para nextAction fora do conjunto executável retorna null (não tenta executar Vitre por engano)", async () => {
    const r = await executeCommercialAction({
      conversationId: "conv_a2", agentId: "a", organizationId: "o",
      cliente: null, lead: null, channelPhone: null,
      nextAction: "lookup_catalog",
      technicalBriefing: tbCaixaCompleto,
      lastEligibleSimulation: null,
    });
    expect(r).toBeNull();
  });

  test("EXECUTABLE_ACTIONS nunca inclui lookup_catalog/configure_custom (só ações determinísticas e seguras)", () => {
    expect(EXECUTABLE_ACTIONS.has("lookup_catalog")).toBe(false);
    expect(EXECUTABLE_ACTIONS.has("configure_custom")).toBe(false);
    expect(EXECUTABLE_ACTIONS.has("confirm_quote")).toBe(false); // estado de espera, nada a executar
  });
});

describe("A3 — executeCreateQuote usa lastEligibleSimulation canônico (nunca simulationId do LLM)", () => {
  test("cria orçamento com o simulationId/preço exatos da simulação canônica, identidade vem de cliente/lead — nunca de body de Tool", async () => {
    const calc = await executeCalculateQuote("conv_a3", tbCaixaCompleto);
    expect(calc.success).toBe(true);
    const canonico = await loadLastEligibleSimulation("conv_a3");
    expect(canonico).not.toBeNull();

    const r = await executeCreateQuote({
      conversationId: "conv_a3", agentId: "agent_x", organizationId: "org_x",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      lastEligibleSimulation: canonico!,
    });
    expect(r.success).toBe(true);
    if (r.success && calc.success) {
      expect(r.total).toBe(calc.finalPrice);
    }
    // simulação consumida — nunca reaproveitável
    expect(await loadLastEligibleSimulation("conv_a3")).toBeNull();
  });

  test("sem identidade confirmada (nome/telefone) → IDENTITY_NOT_READY, nunca cria orçamento sem cliente identificado", async () => {
    const calc = await executeCalculateQuote("conv_a3b", tbCaixaCompleto);
    const canonico = await loadLastEligibleSimulation("conv_a3b");
    const r = await executeCreateQuote({
      conversationId: "conv_a3b", agentId: "a", organizationId: "o",
      cliente: null, lead: null, channelPhone: null,
      lastEligibleSimulation: canonico!,
    });
    expect(calc.success).toBe(true);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errorCode).toBe("IDENTITY_NOT_READY");
  });

  test("retry com a mesma simulação já usada → SIMULATION_ALREADY_USED, nunca duplica orçamento", async () => {
    await executeCalculateQuote("conv_a3c", tbCaixaCompleto);
    const canonico = await loadLastEligibleSimulation("conv_a3c");
    await executeCreateQuote({
      conversationId: "conv_a3c", agentId: "a", organizationId: "o",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      lastEligibleSimulation: canonico!,
    });
    const segunda = await executeCreateQuote({
      conversationId: "conv_a3c", agentId: "a", organizationId: "o",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      lastEligibleSimulation: canonico!,
    });
    expect(segunda.success).toBe(false);
    if (!segunda.success) expect(segunda.errorCode).toBe("SIMULATION_ALREADY_USED");
  });
});

describe("A4 — executeCommercialAction dispatcher: create_quote só executa com lastEligibleSimulation presente", () => {
  test("nextAction=create_quote sem lastEligibleSimulation → null (nunca cria com dado ausente/desatualizado)", async () => {
    const r = await executeCommercialAction({
      conversationId: "conv_a4", agentId: "a", organizationId: "o",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      nextAction: "create_quote",
      technicalBriefing: tbCaixaCompleto,
      lastEligibleSimulation: null,
    });
    expect(r).toBeNull();
  });
});

describe("A5 — executeCheckProductionDeadline consulta prazo automaticamente (LLM não decide se consulta)", () => {
  test("consome (limpa) wantsDeadlineCheck depois de executar — nunca reexecuta em loop", async () => {
    const tb: TechnicalBriefing = { ...tbCaixaCompleto, wantsDeadlineCheck: true };
    const r = await executeCheckProductionDeadline("conv_a5", tb);
    expect(r.canEstimate).toBe(false); // sem capacidade configurada neste teste — comportamento correto, não bug
    const atualizado = await loadTechnicalBriefing("conv_a5");
    expect(atualizado.wantsDeadlineCheck).toBe(false);
  });
});

describe("A6 — executeCheckUrgentFit verifica encaixe automaticamente (LLM não decide se verifica)", () => {
  test("consome (limpa) dataNecessidadeCliente depois de executar — nunca reexecuta em loop", async () => {
    const tb: TechnicalBriefing = { ...tbCaixaCompleto, dataNecessidadeCliente: "2026-09-01" };
    const r = await executeCheckUrgentFit("conv_a6", tb);
    expect(r.requestedDate).toBe("2026-09-01");
    const atualizado = await loadTechnicalBriefing("conv_a6");
    expect(atualizado.dataNecessidadeCliente).toBeNull();
  });
});

describe("A7 — nenhuma ação automática depende de LLM tool-call", () => {
  test("executeCommercialAction executa calculate_quote, create_quote, check_production_deadline e check_urgent_fit só com nextAction + estado persistido — nenhum parâmetro de 'Tool chamada pelo LLM' existe na assinatura", async () => {
    // calculate_quote: dirigido só por technicalBriefing já persistido.
    const calc = await executeCommercialAction({
      conversationId: "conv_a7", agentId: "a", organizationId: "o",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      nextAction: "calculate_quote", technicalBriefing: tbCaixaCompleto, lastEligibleSimulation: null,
    });
    expect(calc?.action).toBe("calculate_quote");

    const canonico = await loadLastEligibleSimulation("conv_a7");
    // create_quote: dirigido só por lastEligibleSimulation já persistida + identidade já resolvida.
    const created = await executeCommercialAction({
      conversationId: "conv_a7", agentId: "a", organizationId: "o",
      cliente: clienteConfirmado, lead: null, channelPhone: null,
      nextAction: "create_quote", technicalBriefing: tbCaixaCompleto, lastEligibleSimulation: canonico,
    });
    expect(created?.action).toBe("create_quote");

    // check_production_deadline/check_urgent_fit: dirigidos só pelos sinais já persistidos no technicalBriefing.
    const deadline = await executeCommercialAction({
      conversationId: "conv_a7b", agentId: "a", organizationId: "o",
      cliente: null, lead: null, channelPhone: null,
      nextAction: "check_production_deadline",
      technicalBriefing: { ...tbCaixaCompleto, wantsDeadlineCheck: true },
      lastEligibleSimulation: null,
    });
    expect(deadline?.action).toBe("check_production_deadline");

    const urgent = await executeCommercialAction({
      conversationId: "conv_a7c", agentId: "a", organizationId: "o",
      cliente: null, lead: null, channelPhone: null,
      nextAction: "check_urgent_fit",
      technicalBriefing: { ...tbCaixaCompleto, dataNecessidadeCliente: "2026-09-10" },
      lastEligibleSimulation: null,
    });
    expect(urgent?.action).toBe("check_urgent_fit");
  });
});
