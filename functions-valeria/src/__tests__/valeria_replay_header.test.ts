/**
 * valeria_replay_header.test.ts — Fase 2.2B
 *
 * Verifica individualmente que o header X-Idempotent-Replay: true é enviado
 * nos três handlers que foram corrigidos na Fase 2.2B:
 *   - valeriaUpsertCliente   (antes não passava `res` a withIdempotency)
 *   - valeriaCalcularOrcamento (idem)
 *   - valeriaProximaAcao       (idem)
 *
 * Estratégia: chama cada handler duas vezes com a mesma chave e o mesmo payload.
 * A primeira chamada executa a lógica e armazena o resultado.
 * A segunda chamada deve retornar o resultado cacheado E o header.
 *
 * Dados: 100% fictícios. Nenhuma rede, Firestore real ou secret real.
 */

const FAKE_SECRET  = "test_replay_header_secret_ABCDEF123456";
const FAKE_CONV_ID = "conv_REPLAY_HEADER_TEST_2_2B";
const FAKE_AGENT_ID = "agent_REPLAY_HEADER_TEST";
const FAKE_ORG_ID  = "org_REPLAY_HEADER_TEST";

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
// In-memory Firestore (mesmo padrão dos demais testes)
// ─────────────────────────────────────────────────────────────────────────────
type StoredDoc = Record<string, unknown>;
const store = new Map<string, Map<string, StoredDoc>>();

function colMap(col: string): Map<string, StoredDoc> {
  if (!store.has(col)) store.set(col, new Map());
  return store.get(col)!;
}

let _addSeq = 0;

function makeDocRef(col: string, id: string) {
  return {
    __col: col,
    __id:  id,
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
        throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      }
      colMap(col).set(id, { ...data });
    }),
    delete: jest.fn(async () => {
      colMap(col).delete(id);
    }),
  };
}

const runTransactionSpy = jest.fn(async (fn: (tx: unknown) => unknown) => {
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
// Imports reais — depois dos mocks (hoisted pelo jest)
// ─────────────────────────────────────────────────────────────────────────────
import {
  valeriaUpsertCliente,
  valeriaCalcularOrcamento,
  valeriaProximaAcao,
} from "../valeria";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeRes() {
  const res: {
    statusCode?: number;
    jsonBody?: unknown;
    headers: Record<string, string>;
    status: jest.Mock;
    json:   jest.Mock;
    set:    jest.Mock;
  } = {
    headers: {},
    status: jest.fn(function (code: number)    { res.statusCode = code; return res; }),
    json:   jest.fn(function (body: unknown)   { res.jsonBody  = body;  return res; }),
    set:    jest.fn(function (k: string, v: string) { res.headers[k] = v; return res; }),
  };
  return res;
}

function makeReq(extra: { headers?: Record<string, string>; body?: Record<string, unknown> } = {}) {
  return {
    method: "POST",
    headers: {
      authorization:    `Bearer ${FAKE_SECRET}`,
      "content-type":   "application/json",
      ...extra.headers,
    },
    body: extra.body ?? {},
  };
}

function seedAuthorized() {
  colMap("erp_vr").set("valeria_authorized_agents", {
    agents: [{ agentId: FAKE_AGENT_ID, organizationId: FAKE_ORG_ID }],
  });
}

function seedClientes() {
  colMap("erp_vr").set("clientes", { data: JSON.stringify([]), ts: Date.now() });
}

function seedCrmLeads() {
  colMap("erp_vr").set("crm_leads", { data: JSON.stringify({}), ts: Date.now() });
}

type Handler = (req: unknown, res: unknown) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// Suite: replay header nos 3 handlers corrigidos
// ─────────────────────────────────────────────────────────────────────────────
describe("X-Idempotent-Replay — handlers corrigidos na Fase 2.2B", () => {
  beforeEach(() => {
    store.clear();
    _addSeq = 0;
    runTransactionSpy.mockClear();
    seedAuthorized();
  });

  // ── 13: valeriaUpsertCliente ─────────────────────────────────────────────
  it("13 — valeriaUpsertCliente replay envia X-Idempotent-Replay: true", async () => {
    seedClientes();

    const idemKey = "replay-test-upsert-cliente-2.2b";
    const body = {
      conversationId: FAKE_CONV_ID,
      agentId:        FAKE_AGENT_ID,
      organizationId: FAKE_ORG_ID,
      channelPhone:   "+5511988880013",
      nome:           "Cliente Replay Header Teste",
      tel:            "+5511988880013",
    };

    const req1 = makeReq({ headers: { "idempotency-key": idemKey }, body });
    const res1 = makeRes();
    await (valeriaUpsertCliente as unknown as Handler)(req1, res1);

    // Primeira chamada deve ter sucesso (criado)
    expect(res1.statusCode).toBe(200);
    const body1 = res1.jsonBody as { success: boolean };
    expect(body1.success).toBe(true);
    // Sem header de replay na primeira chamada
    expect(res1.headers["X-Idempotent-Replay"]).toBeUndefined();

    // Segunda chamada — mesmo payload, mesma chave
    const req2 = makeReq({ headers: { "idempotency-key": idemKey }, body });
    const res2 = makeRes();
    await (valeriaUpsertCliente as unknown as Handler)(req2, res2);

    expect(res2.statusCode).toBe(200);
    const body2 = res2.jsonBody as { success: boolean; warnings?: string[] };
    expect(body2.success).toBe(true);
    // Header obrigatório na segunda chamada
    expect(res2.headers["X-Idempotent-Replay"]).toBe("true");
    // Warning de replay no corpo
    expect(body2.warnings?.some((w) => /IDEMPOTENT_REPLAY/i.test(w))).toBe(true);
  });

  // ── 14: valeriaCalcularOrcamento ────────────────────────────────────────
  it("14 — valeriaCalcularOrcamento replay envia X-Idempotent-Replay: true", async () => {
    // Sem erp_config no Firestore → evaluateQuoteEligibility retorna HUMAN_VALIDATION_REQUIRED
    // Esse resultado é armazenado pelo withIdempotency e replicado no replay.

    const idemKey = "replay-test-calcular-orcamento-2.2b";
    const body = {
      conversationId: FAKE_CONV_ID,
      agentId:        FAKE_AGENT_ID,
      organizationId: FAKE_ORG_ID,
      channelPhone:   "+5511988880014",
      itens:          [{ larg: 300, alt: 200, qty: 2, matKey: "cfg_0" }],
    };

    const req1 = makeReq({ headers: { "idempotency-key": idemKey }, body });
    const res1 = makeRes();
    await (valeriaCalcularOrcamento as unknown as Handler)(req1, res1);

    // Sem config → resposta de validação humana — mas ainda armazenada
    expect(res1.statusCode).toBeDefined();
    const body1 = res1.jsonBody as { success: boolean };
    expect(body1).toBeDefined();
    // Sem replay header na primeira chamada
    expect(res1.headers["X-Idempotent-Replay"]).toBeUndefined();

    // Segunda chamada — replay
    const req2 = makeReq({ headers: { "idempotency-key": idemKey }, body });
    const res2 = makeRes();
    await (valeriaCalcularOrcamento as unknown as Handler)(req2, res2);

    expect(res2.statusCode).toBeDefined();
    // Header obrigatório na segunda chamada
    expect(res2.headers["X-Idempotent-Replay"]).toBe("true");
    // Corpo idêntico ao da primeira chamada (mais warning)
    const body2 = res2.jsonBody as { warnings?: string[] };
    expect(body2.warnings?.some((w) => /IDEMPOTENT_REPLAY/i.test(w))).toBe(true);
  });

  // ── 15: valeriaProximaAcao ───────────────────────────────────────────────
  it("15 — valeriaProximaAcao replay envia X-Idempotent-Replay: true", async () => {
    seedCrmLeads(); // dict vazio → sem lead → retorna warning, mas ainda armazena

    const idemKey = "replay-test-proxima-acao-2.2b";
    const body = {
      conversationId: FAKE_CONV_ID,
      agentId:        FAKE_AGENT_ID,
      organizationId: FAKE_ORG_ID,
      channelPhone:   "+5511988880015",
      acao:           "enviar_proposta_HOMOLOGACAO_2_2B",
    };

    const req1 = makeReq({ headers: { "idempotency-key": idemKey }, body });
    const res1 = makeRes();
    await (valeriaProximaAcao as unknown as Handler)(req1, res1);

    // Sem lead → success: true com warning
    expect(res1.statusCode).toBe(200);
    const body1 = res1.jsonBody as { success: boolean };
    expect(body1.success).toBe(true);
    // Sem header de replay na primeira chamada
    expect(res1.headers["X-Idempotent-Replay"]).toBeUndefined();

    // Segunda chamada — replay
    const req2 = makeReq({ headers: { "idempotency-key": idemKey }, body });
    const res2 = makeRes();
    await (valeriaProximaAcao as unknown as Handler)(req2, res2);

    expect(res2.statusCode).toBe(200);
    const body2 = res2.jsonBody as { success: boolean; warnings?: string[] };
    expect(body2.success).toBe(true);
    // Header obrigatório na segunda chamada
    expect(res2.headers["X-Idempotent-Replay"]).toBe("true");
    // Warning de replay no corpo
    expect(body2.warnings?.some((w) => /IDEMPOTENT_REPLAY/i.test(w))).toBe(true);
  });
});
