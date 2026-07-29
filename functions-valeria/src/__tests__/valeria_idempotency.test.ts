/**
 * valeria_idempotency.test.ts — Fase 2.1
 * 12 cenários de teste para idempotência e correções bloqueadoras.
 * Dados: 100% fictícios. Nenhuma rede, Firestore real ou secret real.
 */

const FAKE_SECRET  = "test_idem_secret_XYZ9876543210ABCDEF";
const FAKE_CONV_ID = "conv_IDEM_TEST_MAIN";
const FAKE_AGENT_ID= "agent_IDEM_TEST_MAIN";
const FAKE_ORG_ID  = "org_IDEM_TEST_MAIN";
const FAKE_SIM_ID  = "sim_IDEM_TEST_MAIN";

process.env.VALERIA_BEARER_SECRET = FAKE_SECRET;
delete process.env.VALERIA_BEARER_SECRET_PREV;

// ─────────────────────────────────────────────────────────────────────────────
// Mock firebase-functions
// ─────────────────────────────────────────────────────────────────────────────
jest.mock("firebase-functions", () => ({
  runWith: jest.fn(() => ({
    https: { onRequest: (h: unknown) => h },
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// In-memory Firestore
// ─────────────────────────────────────────────────────────────────────────────
type StoredDoc = Record<string, unknown>;
const store = new Map<string, Map<string, StoredDoc>>();

function colMap(col: string): Map<string, StoredDoc> {
  if (!store.has(col)) store.set(col, new Map());
  return store.get(col)!;
}

export const runTransactionSpy = jest.fn(async (fn: (tx: unknown) => unknown) => {
  const tx = {
    get: jest.fn(async (ref: { __col: string; __id: string }) => {
      const data = colMap(ref.__col).get(ref.__id);
      return { exists: data !== undefined, data: () => data };
    }),
    set: jest.fn((ref: { __col: string; __id: string }, data: StoredDoc, opts?: { merge?: boolean }) => {
      const existing = colMap(ref.__col).get(ref.__id) ?? {};
      colMap(ref.__col).set(ref.__id, opts?.merge ? { ...existing, ...data } : { ...data });
    }),
    update: jest.fn((ref: { __col: string; __id: string }, data: StoredDoc) => {
      const existing = colMap(ref.__col).get(ref.__id) ?? {};
      colMap(ref.__col).set(ref.__id, { ...existing, ...data });
    }),
  };
  return fn(tx);
});

let _addSeq = 0;

function makeDocRef(col: string, id: string) {
  return {
    __col: col,
    __id: id,
    get: jest.fn(async () => {
      const data = colMap(col).get(id);
      return { exists: data !== undefined, data: () => data };
    }),
    set: jest.fn(async (data: StoredDoc, opts?: { merge?: boolean }) => {
      const existing = colMap(col).get(id) ?? {};
      colMap(col).set(id, opts?.merge ? { ...existing, ...data } : { ...data });
    }),
    update: jest.fn(async (data: StoredDoc) => {
      const existing = colMap(col).get(id) ?? {};
      colMap(col).set(id, { ...existing, ...data });
    }),
    create: jest.fn(async (data: StoredDoc) => {
      if (colMap(col).has(id)) {
        const e = Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
        throw e;
      }
      colMap(col).set(id, { ...data });
    }),
    delete: jest.fn(async () => {
      colMap(col).delete(id);
    }),
  };
}

const firestoreFn = jest.fn(() => ({
  collection: (col: string) => ({
    doc: (id: string) => makeDocRef(col, id),
    add: jest.fn(async (data: StoredDoc) => {
      const id = `auto_${++_addSeq}`;
      colMap(col).set(id, { ...data });
      return { id };
    }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Imports reais (depois dos mocks — hoisted pelo jest)
// ─────────────────────────────────────────────────────────────────────────────
import {
  withIdempotency,
  validateIdempotencyKey,
  buildIdempKey,
  buildPayloadHash,
  IDEM_CODES,
} from "../idempotency";
import { valeriaRegistrarMensagem, valeriaCriarOrcamento } from "../valeria";
import type { ApiResponse } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers comuns
// ─────────────────────────────────────────────────────────────────────────────
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
    status: jest.fn(function (code: number) { res.statusCode = code; return res; }),
    json:   jest.fn(function (body: unknown) { res.jsonBody  = body; return res; }),
    set:    jest.fn(function (k: string, v: string) { res.headers[k] = v; return res; }),
  };
  return res;
}

function makeReq(overrides: {
  method?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
} = {}) {
  return {
    method: overrides.method ?? "POST",
    headers: {
      authorization: `Bearer ${FAKE_SECRET}`,
      "content-type": "application/json",
      ...overrides.headers,
    },
    body: overrides.body ?? {},
  };
}

function seedAuthorized() {
  colMap("erp_vr").set("valeria_authorized_agents", {
    agents: [{ agentId: FAKE_AGENT_ID, organizationId: FAKE_ORG_ID }],
  });
}

function seedSim(opts: { usado?: boolean; expired?: boolean } = {}) {
  colMap("valeria_simulations").set(FAKE_SIM_ID, {
    simulationId:       FAKE_SIM_ID,
    conversationId:     FAKE_CONV_ID,
    itensNormalizados:  [{ larg: 200, alt: 200, qty: 1, matKey: "cfg_0" }],
    finalPrice:         499.99,
    pricingVersion:     "v-idem-test",
    createdAt:          Date.now() - 1000,
    expiresAt:          opts.expired ? Date.now() - 1000 : Date.now() + 3_600_000,
    origem:             "valeria",
    usado:              opts.usado ?? false,
  });
  colMap("erp_vr").set("orcamentos", { data: JSON.stringify([]), ts: Date.now() });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: validateIdempotencyKey (testes 7-9)
// ─────────────────────────────────────────────────────────────────────────────
describe("validateIdempotencyKey", () => {
  it("7 — undefined retorna { ok: false }", () => {
    const r = validateIdempotencyKey(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/obrigat/i);
  });

  it("8 — chave com 257 caracteres retorna { ok: false }", () => {
    const key = "a".repeat(257);
    const r = validateIdempotencyKey(key);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/256/);
  });

  it("9 — chave com caracter de controle (\\x01) retorna { ok: false }", () => {
    const r = validateIdempotencyKey("valid-prefix\x01suffix");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/controle/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: withIdempotency (testes 1-6)
// ─────────────────────────────────────────────────────────────────────────────
describe("withIdempotency", () => {
  const FN   = "testFunctionName";
  const CONV = "conv-idem-unit-test";
  const KEY  = "unit-test-idem-key-001";
  const HASH = "abc123hash";
  const mockResult = {
    success: true  as const,
    data:    { value: 42 },
    communicableToCustomer: false,
    verified: true,
    humanValidationRequired: false,
    meta: {},
  } as ApiResponse<{ value: number }>;

  beforeEach(() => {
    store.clear();
    runTransactionSpy.mockClear();
    // Restore default implementation after potential overrides
    runTransactionSpy.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        get:    jest.fn(async (ref: { __col: string; __id: string }) => {
          const data = colMap(ref.__col).get(ref.__id);
          return { exists: data !== undefined, data: () => data };
        }),
        set:    jest.fn((ref: { __col: string; __id: string }, data: StoredDoc, opts?: { merge?: boolean }) => {
          const existing = colMap(ref.__col).get(ref.__id) ?? {};
          colMap(ref.__col).set(ref.__id, opts?.merge ? { ...existing, ...data } : { ...data });
        }),
        update: jest.fn((ref: { __col: string; __id: string }, data: StoredDoc) => {
          const existing = colMap(ref.__col).get(ref.__id) ?? {};
          colMap(ref.__col).set(ref.__id, { ...existing, ...data });
        }),
      };
      return fn(tx);
    });
  });

  it("1 — nova chave: fn() executada e resultado retornado", async () => {
    const fn = jest.fn(async () => mockResult);
    const result = await withIdempotency(
      { idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: HASH },
      fn
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true });
    // Documento gravado como "done"
    const docKey = buildIdempKey(KEY, CONV, FN);
    const stored = colMap("valeria_idem_keys").get(docKey);
    expect(stored?.status).toBe("done");
  });

  it("2 — mesma chave + mesmo hash: replay sem chamar fn(), X-Idempotent-Replay no header", async () => {
    const fn = jest.fn(async () => mockResult);
    // Primeira chamada — persiste o resultado
    await withIdempotency({ idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: HASH }, fn);
    fn.mockClear();

    const fakeRes = makeRes();
    const result = await withIdempotency(
      { idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: HASH },
      fn,
      fakeRes
    );
    expect(fn).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(fakeRes.headers["X-Idempotent-Replay"]).toBe("true");
  });

  it("3 — mesma chave + hash diferente: IDEMPOTENCY_CONFLICT (409)", async () => {
    const fn = jest.fn(async () => mockResult);
    await withIdempotency({ idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: HASH }, fn);
    fn.mockClear();

    const result = await withIdempotency(
      { idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: "different-hash" },
      fn
    );
    expect(result.success).toBe(false);
    expect((result as { success: false; error: { code: string } }).error.code).toBe(IDEM_CODES.CONFLICT);
    expect(fn).not.toHaveBeenCalled();
  });

  it("4 — chave em estado 'processing': IDEMPOTENCY_PROCESSING (423)", async () => {
    // Pré-popula o documento como "processing" (simula outra instância em execução)
    const docKey = buildIdempKey(KEY, CONV, FN);
    colMap("valeria_idem_keys").set(docKey, {
      status:        "processing",
      functionName:  FN,
      conversationId: CONV,
      payloadHash:   HASH,
      createdAt:     Date.now(),
      updatedAt:     Date.now(),
      expiresAt:     Date.now() + 60_000,
      result:        null,
    });

    const fn = jest.fn(async () => mockResult);
    const result = await withIdempotency(
      { idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: HASH },
      fn
    );
    expect(result.success).toBe(false);
    expect((result as { success: false; error: { code: string } }).error.code).toBe(IDEM_CODES.PROCESSING);
    expect(fn).not.toHaveBeenCalled();
  });

  it("5 — registro expirado (expiresAt no passado): deleta e re-executa fn()", async () => {
    const docKey = buildIdempKey(KEY, CONV, FN);
    colMap("valeria_idem_keys").set(docKey, {
      status:        "done",
      functionName:  FN,
      conversationId: CONV,
      payloadHash:   "old-hash",
      createdAt:     Date.now() - 100_000,
      updatedAt:     Date.now() - 100_000,
      expiresAt:     Date.now() - 1,  // já expirado
      result:        { success: true, data: { old: true } },
    });

    const fn = jest.fn(async () => mockResult);
    const result = await withIdempotency(
      { idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: HASH },
      fn
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, data: { value: 42 } });
  });

  it("6 — fn() lança exceção: placeholder deletado e exceção re-lançada", async () => {
    const boom = new Error("fn explodiu");
    const fn   = jest.fn(async () => { throw boom; });

    await expect(
      withIdempotency({ idempotencyKey: KEY, conversationId: CONV, functionName: FN, payloadHash: HASH }, fn)
    ).rejects.toThrow("fn explodiu");

    // Placeholder deve ter sido deletado (permite retry)
    const docKey = buildIdempKey(KEY, CONV, FN);
    expect(colMap("valeria_idem_keys").has(docKey)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: integração (testes 10-12)
// ─────────────────────────────────────────────────────────────────────────────
describe("integração: endpoints HTTP", () => {
  beforeEach(() => {
    store.clear();
    _addSeq = 0;
    runTransactionSpy.mockClear();
    runTransactionSpy.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        get:    jest.fn(async (ref: { __col: string; __id: string }) => {
          const data = colMap(ref.__col).get(ref.__id);
          return { exists: data !== undefined, data: () => data };
        }),
        set:    jest.fn((ref: { __col: string; __id: string }, data: StoredDoc, opts?: { merge?: boolean }) => {
          const existing = colMap(ref.__col).get(ref.__id) ?? {};
          colMap(ref.__col).set(ref.__id, opts?.merge ? { ...existing, ...data } : { ...data });
        }),
        update: jest.fn((ref: { __col: string; __id: string }, data: StoredDoc) => {
          const existing = colMap(ref.__col).get(ref.__id) ?? {};
          colMap(ref.__col).set(ref.__id, { ...existing, ...data });
        }),
      };
      return fn(tx);
    });
    seedAuthorized();
  });

  it("10 — valeriaCriarOrcamento: falha de negócio (sim expirada) → sim.usado permanece false", async () => {
    seedSim({ usado: false, expired: true });

    const req = makeReq({
      headers: { "idempotency-key": "test-idem-orc-expired" },
      body: {
        conversationId: FAKE_CONV_ID,
        agentId:        FAKE_AGENT_ID,
        organizationId: FAKE_ORG_ID,
        channelPhone:   "+5511988887777",
        simulationId:   FAKE_SIM_ID,
        nomeCliente:    "Cliente Teste 10",
        telCliente:     "+5511988887777",
        itens:          [{ larg: 200, alt: 200, qty: 1, matKey: "cfg_0" }],
      },
    });
    const res = makeRes();

    await (valeriaCriarOrcamento as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);

    expect(res.statusCode).not.toBe(201);
    const body = res.jsonBody as { success: boolean; error?: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("SIMULATION_EXPIRED");

    // Garantia de atomicidade: sim.usado NÃO foi alterado
    const simAfter = colMap("valeria_simulations").get(FAKE_SIM_ID) as { usado: boolean };
    expect(simAfter.usado).toBe(false);
  });

  it("11 — valeriaRegistrarMensagem: ausência de messageId → HTTP 400", async () => {
    const req = makeReq({
      headers: { "idempotency-key": "test-idem-msg-no-id" },
      body: {
        conversationId: FAKE_CONV_ID,
        agentId:        FAKE_AGENT_ID,
        organizationId: FAKE_ORG_ID,
        mensagem:       "Olá, preciso de um orçamento.",
        // messageId ausente propositalmente
      },
    });
    const res = makeRes();

    await (valeriaRegistrarMensagem as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);

    expect(res.statusCode).toBe(400);
    const body = res.jsonBody as { success: boolean; error?: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("12 — extractContext: conversationId com '/' → HTTP 400", async () => {
    // qualquer endpoint via pipeline valida o formato de conversationId
    const req = makeReq({
      headers: { "idempotency-key": "test-idem-conv-slash" },
      body: {
        conversationId: "conv/with/slash",  // inválido: contém separador de path Firestore
        agentId:        FAKE_AGENT_ID,
        organizationId: FAKE_ORG_ID,
        mensagem:       "teste",
        messageId:      "msg-slash-test",
      },
    });
    const res = makeRes();

    await (valeriaRegistrarMensagem as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res);

    expect(res.statusCode).toBe(400);
    const body = res.jsonBody as { success: boolean; error?: { code: string; message?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});
