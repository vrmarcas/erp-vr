/**
 * valeria_criar_oportunidade_leadid.test.ts — Fase 2.2B bug fix
 *
 * Reproduz o cenário exato que causou HTTP 500 em produção:
 *   - lead antigo localizado pela busca de conversationId
 *   - objeto salvo sem o campo interno `id` (apenas chave do dict)
 *   - criação/atualização da oportunidade deve completar sem crash
 *   - `leadId` deve ser persistido com `found.id` (chave do dict)
 *   - replay com mesma Idempotency-Key não cria duplicidade
 *   - header `X-Idempotent-Replay: true` confirmado na repetição
 *
 * Dados: 100% fictícios. Nenhuma rede, Firestore real ou secret real.
 */

const FAKE_SECRET   = "test_leadid_bug_secret_XYZ0000ABCDEF";
const FAKE_CONV_ID  = "conv_LEADID_FIX_TEST_2_2B";
const FAKE_AGENT_ID = "agent_LEADID_FIX_TEST";
const FAKE_ORG_ID   = "org_LEADID_FIX_TEST";
const OLD_LEAD_KEY  = "base_fixture_no_id_field";

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
import { valeriaCriarOportunidade } from "../valeria";

type Handler = (req: unknown, res: unknown) => Promise<void>;

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
      authorization:  `Bearer ${FAKE_SECRET}`,
      "content-type": "application/json",
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

/**
 * Seed crm_leads com um lead antigo SEM campo `id` no objeto.
 * Reproduz leads de fixture/Kanban criados antes do schema CrmLead.id existir.
 */
function seedOldLeadWithoutId() {
  const oldLead = {
    // Sem campo `id` — intencionalmente omitido para reproduzir o bug
    nome:  "Lead Antigo Sem Id",
    tel:   "+5599000000000",
    email: "",
    etapa: "ia_novo",
    marca: "vr",
    valeria: {
      status:         "NOVO_LEAD",
      conversationId: FAKE_CONV_ID,  // findLeadByConv encontrará este lead
      agentId:        FAKE_AGENT_ID,
      organizationId: FAKE_ORG_ID,
      dataEntrada:    "2026-03-11T00:00:00.000Z",
    },
  };
  colMap("erp_vr").set("crm_leads", {
    data: JSON.stringify({ [OLD_LEAD_KEY]: oldLead }),
    ts:   Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Body padrão para valeriaCriarOportunidade
// ─────────────────────────────────────────────────────────────────────────────
const BASE_BODY = {
  conversationId: FAKE_CONV_ID,
  agentId:        FAKE_AGENT_ID,
  organizationId: FAKE_ORG_ID,
  channelPhone:   "+5599111110001",
  tel:            "+5599111110001",
  nome:           "HOMOLOGACAO-LEADID-FIX-2.2B",
  observacoes:    "Teste de regressão bug leadId undefined",
  proximaAcao:    "Verificar fix",
};

const IDEM_KEY = "homologacao-leadid-fix-regression-2.2b";

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────
describe("valeriaCriarOportunidade — bug fix: leadId undefined em lead sem campo id", () => {
  beforeEach(() => {
    store.clear();
    _addSeq = 0;
    runTransactionSpy.mockClear();
    seedAuthorized();
    seedOldLeadWithoutId();
  });

  it("16 — lead antigo sem campo id: não retorna HTTP 500 e persiste leadId com chave do dict", async () => {
    const req = makeReq({ headers: { "idempotency-key": IDEM_KEY }, body: BASE_BODY });
    const res = makeRes();

    await (valeriaCriarOportunidade as unknown as Handler)(req, res);

    // Deve retornar 200, não 500
    expect(res.statusCode).toBe(200);

    const body = res.jsonBody as { success: boolean; data?: { acao: string; leadId: string } };
    expect(body.success).toBe(true);
    expect(body.data?.acao).toBe("atualizado");

    // leadId deve ser a chave canônica do dict, não undefined
    expect(body.data?.leadId).toBe(OLD_LEAD_KEY);

    // valeria_conversations deve ter sido gravado com leadId correto
    const convDoc = colMap("valeria_conversations").get(FAKE_CONV_ID) as StoredDoc | undefined;
    expect(convDoc?.leadId).toBe(OLD_LEAD_KEY);

    // crm_leads deve ter sido atualizado com id agora preenchido
    const leadsRaw = colMap("erp_vr").get("crm_leads");
    const leadsDict = JSON.parse(leadsRaw!.data as string) as Record<string, unknown>;
    const updatedLead = leadsDict[OLD_LEAD_KEY] as Record<string, unknown>;
    expect(updatedLead).toBeDefined();
    expect(updatedLead.id).toBe(OLD_LEAD_KEY);
    expect(updatedLead.nome).toBe(BASE_BODY.nome);
  });

  it("17 — replay com mesma Idempotency-Key não duplica oportunidade e envia X-Idempotent-Replay: true", async () => {
    const reqBody = { ...BASE_BODY };
    const idemHeaders = { "idempotency-key": IDEM_KEY };

    // Primeira chamada
    const req1 = makeReq({ headers: idemHeaders, body: reqBody });
    const res1 = makeRes();
    await (valeriaCriarOportunidade as unknown as Handler)(req1, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.headers["X-Idempotent-Replay"]).toBeUndefined();

    // Snapshot do dict após primeira chamada
    const snapRaw = colMap("erp_vr").get("crm_leads")!.data as string;
    const snapDict = JSON.parse(snapRaw);

    // Segunda chamada — mesma chave, mesmo payload
    const req2 = makeReq({ headers: idemHeaders, body: reqBody });
    const res2 = makeRes();
    await (valeriaCriarOportunidade as unknown as Handler)(req2, res2);

    // Deve ser replay: 200 e header obrigatório
    expect(res2.statusCode).toBe(200);
    expect(res2.headers["X-Idempotent-Replay"]).toBe("true");

    // Sem duplicação: dict não deve ter novos leads além do original
    const afterRaw = colMap("erp_vr").get("crm_leads")!.data as string;
    const afterDict = JSON.parse(afterRaw);
    expect(Object.keys(afterDict)).toEqual(Object.keys(snapDict));
  });
});
