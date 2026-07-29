/**
 * valeria_criar_orcamento_db_regression.test.ts
 *
 * Teste de regressão dedicado ao bug "ReferenceError: db is not defined"
 * em valeriaCriarOrcamento (src/valeria.ts, bloco de transação anti-double-spend).
 *
 * Diferente de valeria_b1_b4.test.ts (que testa funções puras exportadas),
 * este teste invoca o handler HTTP real exportado por valeria.ts, com
 * firebase-functions e firebase-admin totalmente mockados, e alcança de fato
 * a chamada db.runTransaction(...) dentro de valeriaCriarOrcamento.
 *
 * Dados: 100% fictícios. Nenhuma rede, Firestore real, secret real ou
 * chamada externa é usada ou possível neste teste.
 */

const FAKE_SECRET = "test_secret_regression_db_ABC123456789";
const FAKE_CONV_ID = "conv_DB_REGRESSION_TEST";
const FAKE_AGENT_ID = "agent_DB_REGRESSION_TEST";
const FAKE_ORG_ID = "org_DB_REGRESSION_TEST";
const FAKE_SIM_ID = "sim_DB_REGRESSION_TEST";

process.env.VALERIA_BEARER_SECRET = FAKE_SECRET;
delete process.env.VALERIA_BEARER_SECRET_PREV;

// ──────────────────────────────────────────────────────────────────────────
// Mock de firebase-functions — API real usada pelo código (v1, functions.runWith().https.onRequest())
// ──────────────────────────────────────────────────────────────────────────
jest.mock("firebase-functions", () => ({
  runWith: jest.fn(() => ({
    https: {
      // onRequest devolve o próprio handler, permitindo chamá-lo diretamente no teste
      onRequest: (handler: unknown) => handler,
    },
  })),
}));

// ──────────────────────────────────────────────────────────────────────────
// Firestore mockado em memória — genérico, cobre .collection().doc().get/set/update/create
// e runTransaction(), incluindo o transaction spy que a assertion usa.
// ──────────────────────────────────────────────────────────────────────────
type StoredDoc = Record<string, unknown> | undefined;
const store = new Map<string, Map<string, StoredDoc>>();

function collectionMap(col: string): Map<string, StoredDoc> {
  if (!store.has(col)) store.set(col, new Map());
  return store.get(col)!;
}

function docRef(col: string, id: string) {
  return {
    __col: col,
    __id: id,
    get: jest.fn(async () => {
      const data = collectionMap(col).get(id);
      return { exists: data !== undefined, data: () => data };
    }),
    set: jest.fn(async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
      const existing = collectionMap(col).get(id) ?? {};
      collectionMap(col).set(id, opts?.merge ? { ...existing, ...data } : { ...data });
    }),
    update: jest.fn(async (data: Record<string, unknown>) => {
      const existing = collectionMap(col).get(id) ?? {};
      collectionMap(col).set(id, { ...existing, ...data });
    }),
    create: jest.fn(async (data: Record<string, unknown>) => {
      if (collectionMap(col).has(id)) {
        const e: Error & { code?: number } = new Error("ALREADY_EXISTS");
        e.code = 6;
        throw e;
      }
      collectionMap(col).set(id, { ...data });
    }),
  };
}

// spy dedicado — a assertion do item 4 do relatório usa exatamente este mock
export const runTransactionSpy = jest.fn(async (fn: (tx: unknown) => unknown) => {
  const tx = {
    get: jest.fn(async (ref: { __col: string; __id: string }) => {
      const data = collectionMap(ref.__col).get(ref.__id);
      return { exists: data !== undefined, data: () => data };
    }),
    set: jest.fn((ref: { __col: string; __id: string }, data: Record<string, unknown>) => {
      collectionMap(ref.__col).set(ref.__id, { ...data });
    }),
    update: jest.fn((ref: { __col: string; __id: string }, data: Record<string, unknown>) => {
      const existing = collectionMap(ref.__col).get(ref.__id) ?? {};
      collectionMap(ref.__col).set(ref.__id, { ...existing, ...data });
    }),
  };
  return fn(tx);
});

const firestoreFn = jest.fn(() => ({
  collection: (col: string) => ({
    doc: (id: string) => docRef(col, id),
  }),
  runTransaction: runTransactionSpy,
}));
(firestoreFn as unknown as Record<string, unknown>).FieldValue = {
  increment: (n: number) => ({ __increment: n }),
};

jest.mock("firebase-admin", () => ({
  apps: [],
  initializeApp: jest.fn(),
  firestore: firestoreFn,
}));

// ──────────────────────────────────────────────────────────────────────────
// Import real do handler — depois dos mocks acima (hoisted pelo ts-jest/babel-jest)
// ──────────────────────────────────────────────────────────────────────────
import { valeriaCriarOrcamento } from "../valeria";

type FakeReq = {
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function makeRes() {
  const res: {
    statusCode?: number;
    jsonBody?: unknown;
    headers: Record<string, string>;
    status: jest.Mock;
    json: jest.Mock;
    set: jest.Mock;
  } = {
    headers: {},
    status: jest.fn(function (this: unknown, code: number) {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn(function (this: unknown, body: unknown) {
      res.jsonBody = body;
      return res;
    }),
    set: jest.fn(function (this: unknown, k: string, v: string) {
      res.headers[k] = v;
      return res;
    }),
  };
  return res;
}

function makeReq(overrides: Partial<FakeReq> = {}): FakeReq {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${FAKE_SECRET}`,
      "content-type": "application/json",
    },
    body: {
      conversationId: FAKE_CONV_ID,
      agentId: FAKE_AGENT_ID,
      organizationId: FAKE_ORG_ID,
      channelPhone: "+5511999998888",
      simulationId: FAKE_SIM_ID,
      nomeCliente: "Cliente Teste Regressão",
      itens: [{ larg: 100, alt: 100, qty: 1, matKey: "cfg_0" }],
    },
    ...overrides,
  };
}

describe("REGRESSÃO — valeriaCriarOrcamento: db is not defined", () => {
  beforeEach(() => {
    store.clear();
    runTransactionSpy.mockClear();

    // Agente/organização autorizados (erp_vr/valeria_authorized_agents) — auth.ts fail-closed
    collectionMap("erp_vr").set("valeria_authorized_agents", {
      agents: [{ agentId: FAKE_AGENT_ID, organizationId: FAKE_ORG_ID }],
    });

    // orcamentos existentes (fsRead) — lista vazia serializada, formato usado por fsRead/fsWrite
    collectionMap("erp_vr").set("orcamentos", { data: JSON.stringify([]), ts: Date.now() });

    // Simulação de preço válida (valeria_simulations) — pré-condição para valeriaCriarOrcamento
    collectionMap("valeria_simulations").set(FAKE_SIM_ID, {
      simulationId: FAKE_SIM_ID,
      conversationId: FAKE_CONV_ID,
      itensNormalizados: [{ larg: 100, alt: 100, qty: 1, matKey: "cfg_0" }],
      finalPrice: 123.45,
      pricingVersion: "v-test-1",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
      origem: "valeria",
      usado: false,
    });
  });

  it("alcança db.runTransaction(...) e conclui com sucesso (código corrigido)", async () => {
    const req = makeReq();
    const res = makeRes();

    // Não deve lançar ReferenceError (nem nenhuma outra exceção não tratada)
    await expect(
      (valeriaCriarOrcamento as unknown as (req: FakeReq, res: unknown) => Promise<void>)(req, res)
    ).resolves.toBeUndefined();

    // Prova de que o caminho da transação foi de fato alcançado.
    // runTransaction também é chamado 2x pelo rate limit (checkRateLimit: janela
    // global + por conversa) antes de chegar em valeriaCriarOrcamento — por isso
    // aqui verificamos "pelo menos uma vez" e provamos o efeito da transação
    // específica da simulação via o estado do documento abaixo (usado: true).
    expect(runTransactionSpy).toHaveBeenCalled();

    // Resultado real produzido pelo handler
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.jsonBody as {
      success: boolean;
      data?: { orcamentoId?: string; total?: number; pricingVersion?: string };
    };
    expect(body.success).toBe(true);
    expect(body.data?.orcamentoId).toEqual(expect.stringMatching(/^orc_/));
    expect(body.data?.total).toBe(123.45);
    expect(body.data?.pricingVersion).toBe("v-test-1");

    // Simulação deve ter sido marcada como usada dentro da transação mockada
    const simAfter = collectionMap("valeria_simulations").get(FAKE_SIM_ID) as { usado: boolean };
    expect(simAfter.usado).toBe(true);
  });

  it("simulationId inexistente → SIMULATION_NOT_FOUND (ainda alcançando a transação, sem ReferenceError)", async () => {
    const req = makeReq({
      body: { ...makeReq().body, simulationId: "sim_que_nao_existe" },
    });
    const res = makeRes();

    await expect(
      (valeriaCriarOrcamento as unknown as (req: FakeReq, res: unknown) => Promise<void>)(req, res)
    ).resolves.toBeUndefined();

    expect(runTransactionSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.jsonBody as { success: boolean; error?: { code?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("SIMULATION_NOT_FOUND");
  });
});
