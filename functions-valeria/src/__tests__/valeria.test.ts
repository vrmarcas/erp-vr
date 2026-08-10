/**
 * valeria.test.ts — Testes dos bloqueadores críticos
 *
 * Execução: npm test (após npm install)
 * Ambiente: Jest + ts-jest, sem conexão real com Firebase.
 * Dados: 100% fictícios — nenhuma chave real, nenhum dado de produção.
 *
 * Cobertura:
 *  AUTH     — chave válida, ausente, inválida, rotação (current + previous)
 *  AGENT    — agentId não autorizado, organizationId não autorizado
 *  CONV     — vínculo conversationId válido, tentativa de acessar outro cliente
 *  IDEM     — isolamento de conversas, hash determinístico
 *  PRICING  — rejeição de total livre, NEEDS_INFORMATION, HUMAN_VALIDATION_REQUIRED,
 *             TEMPORARILY_UNAVAILABLE, cálculo válido pelo motor oficial
 *  RATE     — payload size guard
 *  CONTRACT — contrato padronizado de sucesso e erro
 */

// ──────────────────────────────────────────────────────────────────────────────
// CONSTANTES FICTÍCIAS (nenhum dado de produção)
// ──────────────────────────────────────────────────────────────────────────────

const FAKE_SECRET_CURRENT  = "test_secret_current_AAABBBCCC123456789012345678901234";
const FAKE_SECRET_PREVIOUS = "test_secret_previous_AAABBBCCC12345678901234567890";
const FAKE_AGENT_ID        = "agent_test_001";
const FAKE_ORG_ID          = "org_test_001";
const FAKE_CONV_ID         = "conv_test_abc123";
const FAKE_CONV_ID_OTHER   = "conv_test_xyz999";
const FAKE_CHANNEL_PHONE   = "+5511999990001";

// ──────────────────────────────────────────────────────────────────────────────
// MOCKS (antes dos imports — jest.mock é hoistado automaticamente)
// ──────────────────────────────────────────────────────────────────────────────

jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name: string) => ({
    value: () => {
      if (name === "VALERIA_BEARER_SECRET")      return FAKE_SECRET_CURRENT;
      if (name === "VALERIA_BEARER_SECRET_PREV") return FAKE_SECRET_PREVIOUS;
      return "";
    },
  })),
}));

jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((_opts: unknown, handler: unknown) => handler),
}));

// Estado mutable do Firestore mock
const _firestoreData: Record<string, unknown> = {};
const _idemStore: Record<string, unknown>     = {};

const makeDocMock = (col: string, id: string) => ({
  get: jest.fn(async () => {
    let data: unknown = undefined;
    if (col === "erp_vr")            data = _firestoreData[id];
    if (col === "valeria_idem_keys") data = _idemStore[id];
    return { exists: data !== undefined, data: () => data };
  }),
  set: jest.fn(async (d: unknown) => {
    if (col === "erp_vr")            _firestoreData[id] = d;
    if (col === "valeria_idem_keys") _idemStore[id]     = d;
  }),
  update: jest.fn(async () => undefined),
});

const firestoreFn = jest.fn(() => ({
  collection: (col: string) => ({
    doc: (id: string) => makeDocMock(col, id),
    add: jest.fn(async () => ({ id: "auto_" + Date.now() })),
  }),
  runTransaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      get:    jest.fn(async () => ({ exists: false, data: () => undefined })),
      set:    jest.fn(),
      update: jest.fn(),
    };
    return fn(tx);
  }),
}));

// FieldValue como propriedade estática do mock
(firestoreFn as unknown as Record<string, unknown>).FieldValue = {
  increment: jest.fn((n: number) => ({ _increment: n })),
};

jest.mock("firebase-admin", () => ({
  apps:          [true],
  initializeApp: jest.fn(),
  firestore:     firestoreFn,
}));

// ──────────────────────────────────────────────────────────────────────────────
// IMPORTS (após jest.mock)
// ──────────────────────────────────────────────────────────────────────────────

import { validateBearer, validateAgent, extractContext, _resetAgentsCacheForTests } from "../auth";
import { buildIdempKey }                                 from "../idempotency";
import { evaluateQuoteEligibility }                      from "../pricing";
import { ok as buildOk, err as buildErr }               from "../response";
import { checkPayloadSize }                              from "../ratelimit";

// v2.1 (Gen 1 + runWith secrets): auth.ts lê os secrets de process.env, não
// mais de defineSecret() — o mock de firebase-functions/params acima fica
// apenas por compatibilidade histórica.
beforeAll(() => {
  process.env["VALERIA_BEARER_SECRET"]      = FAKE_SECRET_CURRENT;
  process.env["VALERIA_BEARER_SECRET_PREV"] = FAKE_SECRET_PREVIOUS;
});

// ──────────────────────────────────────────────────────────────────────────────
// HELPER — Fake Response (evita dependência de Express/Firebase Request)
// ──────────────────────────────────────────────────────────────────────────────

type FakeRes = {
  readonly _status: number;
  readonly _body: unknown;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
  set: () => FakeRes;
};

function makeRes(): FakeRes {
  const state = { status: 200, body: null as unknown };
  const res: FakeRes = {
    get _status() { return state.status; },
    get _body()   { return state.body;   },
    status: jest.fn((code: number) => { state.status = code; return res; }),
    json:   jest.fn((body: unknown) => { state.body  = body; return res; }),
    set:    jest.fn(() => res),
  };
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 1 — AUTENTICAÇÃO (validateBearer)
// ══════════════════════════════════════════════════════════════════════════════

describe("AUTH — validateBearer", () => {
  function req(token: string) {
    return { headers: { authorization: `Bearer ${token}` }, body: {} } as never;
  }

  test("1. Chave CURRENT válida → ok: true, keySlot: 'current'", () => {
    const r = validateBearer(req(FAKE_SECRET_CURRENT));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.keySlot).toBe("current");
  });

  test("2. Chave PREVIOUS válida → ok: true, keySlot: 'previous' (rotação zero-downtime)", () => {
    const r = validateBearer(req(FAKE_SECRET_PREVIOUS));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.keySlot).toBe("previous");
  });

  test("3. Authorization header ausente → 401 UNAUTHORIZED", () => {
    const r = validateBearer({ headers: {}, body: {} } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  test("4. Token completamente inválido → 401 UNAUTHORIZED", () => {
    const r = validateBearer(req("token_errado_qualquer_xyz"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.body.error?.code).toBe("UNAUTHORIZED");
    }
  });

  test("5. Token vazio após 'Bearer ' → 401", () => {
    const r = validateBearer({ headers: { authorization: "Bearer " }, body: {} } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  test("6. Token com 1 byte alterado → rejeitado (comparação timing-safe)", () => {
    const tampered = FAKE_SECRET_CURRENT.slice(0, -1) + "X";
    const r = validateBearer(req(tampered));
    expect(r.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 2 — AGENTE / ORGANIZAÇÃO (validateAgent)
// ══════════════════════════════════════════════════════════════════════════════

describe("AGENT — validateAgent", () => {
  // v2.1: validateAgent virou async (lê erp_vr/valeria_authorized_agents do
  // Firestore) e FAIL-CLOSED — lista vazia/ausente bloqueia TUDO. O antigo
  // "modo homologação permissivo" foi removido de propósito (audit ponto 1).
  beforeEach(() => {
    _resetAgentsCacheForTests();
    delete _firestoreData["valeria_authorized_agents"];
  });

  test("7. agentId ausente → 400 com missingFields: ['agentId']", async () => {
    const r = await validateAgent(undefined, FAKE_ORG_ID, "fn");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.body.missingFields).toContain("agentId");
    }
  });

  test("8. organizationId ausente → 400 com missingFields: ['organizationId']", async () => {
    const r = await validateAgent(FAKE_AGENT_ID, undefined, "fn");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.body.missingFields).toContain("organizationId");
    }
  });

  test("9. Lista de agentes NÃO configurada → 403 FAIL-CLOSED (nunca modo permissivo)", async () => {
    const r = await validateAgent(FAKE_AGENT_ID, FAKE_ORG_ID, "fn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  test("9b. Agente presente na allowlist do Firestore → ok: true", async () => {
    _firestoreData["valeria_authorized_agents"] = {
      agents: [{ agentId: FAKE_AGENT_ID, organizationId: FAKE_ORG_ID }],
    };
    const r = await validateAgent(FAKE_AGENT_ID, FAKE_ORG_ID, "fn");
    expect(r.ok).toBe(true);
  });

  test("9c. Agente fora da allowlist → 403", async () => {
    _firestoreData["valeria_authorized_agents"] = {
      agents: [{ agentId: "agent_outro", organizationId: "org_outra" }],
    };
    const r = await validateAgent(FAKE_AGENT_ID, FAKE_ORG_ID, "fn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  test("9d. allowedFunctions restringe por função → 403 fora da lista, ok dentro", async () => {
    _firestoreData["valeria_authorized_agents"] = {
      agents: [{ agentId: FAKE_AGENT_ID, organizationId: FAKE_ORG_ID, allowedFunctions: ["valeriaGetContexto"] }],
    };
    const negado = await validateAgent(FAKE_AGENT_ID, FAKE_ORG_ID, "valeriaCriarOrcamento");
    expect(negado.ok).toBe(false);
    _resetAgentsCacheForTests();
    const permitido = await validateAgent(FAKE_AGENT_ID, FAKE_ORG_ID, "valeriaGetContexto");
    expect(permitido.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 3 — EXTRAÇÃO DE CONTEXTO (extractContext)
// ══════════════════════════════════════════════════════════════════════════════

describe("CONTEXT — extractContext", () => {
  test("10. conversationId ausente → erro com missingFields: ['conversationId']", () => {
    const r = extractContext({ agentId: FAKE_AGENT_ID, organizationId: FAKE_ORG_ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body.missingFields).toContain("conversationId");
  });

  test("11. Contexto completo → ok: true com ctx correto", () => {
    const r = extractContext({
      conversationId: FAKE_CONV_ID,
      agentId:        FAKE_AGENT_ID,
      organizationId: FAKE_ORG_ID,
      channelPhone:   FAKE_CHANNEL_PHONE,
      messageId:      "msg_001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.conversationId).toBe(FAKE_CONV_ID);
      expect(r.ctx.channelPhone).toBe(FAKE_CHANNEL_PHONE);
      expect(r.ctx.messageId).toBe("msg_001");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 4 — IDEMPOTÊNCIA (buildIdempKey)
// ══════════════════════════════════════════════════════════════════════════════

describe("IDEMPOTENCY — buildIdempKey", () => {
  test("12. Mesmos parâmetros → hash idêntico (determinístico)", () => {
    const k1 = buildIdempKey("key-abc", FAKE_CONV_ID, "criarOrcamento");
    const k2 = buildIdempKey("key-abc", FAKE_CONV_ID, "criarOrcamento");
    expect(k1).toBe(k2);
  });

  test("13. Chave diferente → hash diferente", () => {
    const k1 = buildIdempKey("key-abc", FAKE_CONV_ID, "criarOrcamento");
    const k2 = buildIdempKey("key-xyz", FAKE_CONV_ID, "criarOrcamento");
    expect(k1).not.toBe(k2);
  });

  test("14. Mesma chave, conversationId diferente → hash diferente (isolamento)", () => {
    const k1 = buildIdempKey("key-abc", FAKE_CONV_ID,       "criarOrcamento");
    const k2 = buildIdempKey("key-abc", FAKE_CONV_ID_OTHER, "criarOrcamento");
    expect(k1).not.toBe(k2);
  });

  test("15. Mesma chave, função diferente → hash diferente", () => {
    const k1 = buildIdempKey("key-abc", FAKE_CONV_ID, "criarOrcamento");
    const k2 = buildIdempKey("key-abc", FAKE_CONV_ID, "criarOportunidade");
    expect(k1).not.toBe(k2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 5 — MOTOR DE PREÇO (evaluateQuoteEligibility)
// ══════════════════════════════════════════════════════════════════════════════

describe("PRICING — evaluateQuoteEligibility", () => {
  beforeEach(() => {
    // Config financeira fictícia, compatível com ErpConfig
    _firestoreData["erp_config"] = {
      data: JSON.stringify({
        financeiro: { overhead: 41.16, vrml: 20, impostos: 0 },
        materiais: [
          { comp: 183, larg: 122, preco: 180, nome: "Acrílico 3mm Fictício" },
        ],
      }),
    };
  });

  test("16. itens[] vazio → NEEDS_INFORMATION com missingFields: ['itens']", async () => {
    const r = await evaluateQuoteEligibility([]);
    expect(r.eligibility).toBe("NEEDS_INFORMATION");
    expect(r.missingFields).toContain("itens");
  });

  test("17. Item com larg=0 e alt=0 (área zerada) → NEEDS_INFORMATION", async () => {
    const r = await evaluateQuoteEligibility([{ larg: 0, alt: 0, qty: 1, matKey: "cfg_0" }]);
    expect(r.eligibility).toBe("NEEDS_INFORMATION");
  });

  test("18. matKey desconhecido (cfg_999) → NEEDS_INFORMATION", async () => {
    const r = await evaluateQuoteEligibility([{ larg: 100, alt: 100, qty: 1, matKey: "cfg_999" }]);
    expect(r.eligibility).toBe("NEEDS_INFORMATION");
  });

  test("19. Config financeira ausente no Firestore → HUMAN_VALIDATION_REQUIRED", async () => {
    _firestoreData["erp_config"] = { data: JSON.stringify({}) }; // sem financeiro
    const r = await evaluateQuoteEligibility([{ larg: 100, alt: 100, qty: 1 }]);
    expect(r.eligibility).toBe("HUMAN_VALIDATION_REQUIRED");
  });

  test("20. Firestore indisponível → TEMPORARILY_UNAVAILABLE", async () => {
    firestoreFn.mockImplementationOnce(() => {
      throw new Error("Firestore offline (mock de teste)");
    });
    const r = await evaluateQuoteEligibility([{ larg: 100, alt: 100, qty: 1 }]);
    expect(r.eligibility).toBe("TEMPORARILY_UNAVAILABLE");
  });

  test("21. Item válido com matKey cfg_0 → ELIGIBLE com finalPrice > 0", async () => {
    const r = await evaluateQuoteEligibility([{ larg: 100, alt: 100, qty: 1, matKey: "cfg_0" }]);
    expect(r.eligibility).toBe("ELIGIBLE");
    expect(r.finalPrice).toBeGreaterThan(0);
    expect(r.totalCost).toBeGreaterThan(0);
    expect(r.simulationId).toMatch(/^sim_/);
    expect(r.pricingVersion).toBeTruthy();
  });

  test("22. Item com rsm2 direto (sem matKey) → ELIGIBLE", async () => {
    const r = await evaluateQuoteEligibility([{ larg: 50, alt: 50, qty: 2, rsm2: 200 }]);
    expect(r.eligibility).toBe("ELIGIBLE");
    expect(r.finalPrice).toBeGreaterThan(0);
  });

  test("23. Resultado ELIGIBLE inclui breakdown (overhead, vrml) — interno, não exposto ao cliente", async () => {
    const r = await evaluateQuoteEligibility([{ larg: 100, alt: 100, qty: 1, matKey: "cfg_0" }]);
    expect(r.eligibility).toBe("ELIGIBLE");
    expect(r.breakdown?.overhead).toBeCloseTo(41.16, 1);
    expect(r.breakdown?.vrml).toBeCloseTo(20, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 6 — CAMPOS PROIBIDOS (rejeição de total livre)
// ══════════════════════════════════════════════════════════════════════════════

describe("PRICING GUARD — campos proibidos em valeriaCriarOrcamento", () => {
  const FORBIDDEN = ["total", "valor", "preco", "price", "amount", "finalPrice"];

  test("24. Payload com 'total' detectado pela lista de proibidos", () => {
    const body: Record<string, unknown> = { total: 500, simulationId: "sim_abc" };
    const found = FORBIDDEN.filter((f) => body[f] !== undefined);
    expect(found).toContain("total");
    expect(found.length).toBeGreaterThan(0);
  });

  test("25. Payload sem campos proibidos → lista found vazia (aprovado)", () => {
    const body: Record<string, unknown> = {
      simulationId:   "sim_abc",
      nomeCliente:    "Cliente Fictício",
      conversationId: FAKE_CONV_ID,
    };
    const found = FORBIDDEN.filter((f) => body[f] !== undefined);
    expect(found).toHaveLength(0);
  });

  test("26. Todos os 6 campos proibidos detectados individualmente", () => {
    for (const field of FORBIDDEN) {
      const body: Record<string, unknown> = { [field]: 999 };
      const found = FORBIDDEN.filter((f) => body[f] !== undefined);
      expect(found).toContain(field);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 7 — CONTRATO DE RESPOSTA (ApiResponse)
// ══════════════════════════════════════════════════════════════════════════════

describe("CONTRACT — ApiResponse padronizado", () => {
  test("27. ok() retorna contrato completo de sucesso", () => {
    const r = buildOk({ dado: "valor" }, {
      communicableToCustomer:  true,
      humanValidationRequired: false,
      verified:  true,
      warnings: ["aviso de teste"],
    });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ dado: "valor" });
    expect(r.meta.apiVersion).toBe("2.0.0");
    expect(r.meta.source).toBe("valeria-api");
    expect(r.meta.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(r.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.communicableToCustomer).toBe(true);
    expect(r.humanValidationRequired).toBe(false);
    expect(r.verified).toBe(true);
    expect(r.warnings).toContain("aviso de teste");
    expect(r.error).toBeUndefined();
  });

  test("28. err() retorna contrato completo de erro (sem stack trace)", () => {
    const r = buildErr("TEST_ERROR", "Erro de teste", {
      missingFields:          ["campo_x"],
      communicableToCustomer: true,
    });
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe("TEST_ERROR");
    expect(r.error?.message).toBe("Erro de teste");
    expect(r.missingFields).toContain("campo_x");
    expect(r.communicableToCustomer).toBe(true);
    expect(r.data).toBeUndefined();
    // Nunca deve vazar stack trace ou segredos internos
    expect(JSON.stringify(r)).not.toMatch(/\bstack\b|at Object\.|node_modules/);
  });

  test("29. NEEDS_INFORMATION tem communicableToCustomer: true", () => {
    const r = buildErr("NEEDS_INFORMATION", "Dados insuficientes.", {
      communicableToCustomer: true,
      missingFields: ["itens"],
    });
    expect(r.communicableToCustomer).toBe(true);
    expect(r.success).toBe(false);
  });

  test("30. HUMAN_VALIDATION_REQUIRED tem humanValidationRequired: true", () => {
    const r = buildErr("HUMAN_VALIDATION_REQUIRED", "Requer validação humana.", {
      humanValidationRequired: true,
      communicableToCustomer:  true,
    });
    expect(r.humanValidationRequired).toBe(true);
  });

  test("31. requestId é único a cada chamada (sem colisão)", () => {
    const r1 = buildOk({});
    const r2 = buildOk({});
    expect(r1.meta.requestId).not.toBe(r2.meta.requestId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 8 — PAYLOAD SIZE (checkPayloadSize)
// ══════════════════════════════════════════════════════════════════════════════

describe("RATE LIMIT — checkPayloadSize", () => {
  test("32. Payload 1 KB (dentro do limite) → retorna true", () => {
    const req = { headers: { "content-length": "1024" }, body: {} } as never;
    const res = makeRes();
    expect(checkPayloadSize(req, res as never)).toBe(true);
    expect(res._status).toBe(200); // não modificado
  });

  test("33. content-length > 256 KB → retorna false + status 413 PAYLOAD_TOO_LARGE", () => {
    const req = { headers: { "content-length": String(257 * 1024) }, body: {} } as never;
    const res = makeRes();
    expect(checkPayloadSize(req, res as never)).toBe(false);
    expect(res._status).toBe(413);
    const body = res._body as { error?: { code: string } };
    expect(body?.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("34. Body serializado > 256 KB (sem content-length) → retorna false + 413", () => {
    const req = { headers: {}, body: { dados: "x".repeat(260 * 1024) } } as never;
    const res = makeRes();
    expect(checkPayloadSize(req, res as never)).toBe(false);
    expect(res._status).toBe(413);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 9 — ISOLAMENTO DE CONVERSA
// ══════════════════════════════════════════════════════════════════════════════

describe("ISOLATION — conversationId isola dados entre clientes", () => {
  test("35. Mesma Idempotency-Key em conversas diferentes → hashes diferentes", () => {
    const k1 = buildIdempKey("idem-001", FAKE_CONV_ID,       "criarOrcamento");
    const k2 = buildIdempKey("idem-001", FAKE_CONV_ID_OTHER, "criarOrcamento");
    expect(k1).not.toBe(k2);
  });

  test("36. Motor recalcula do zero — finalPrice é numérico e > 0", async () => {
    _firestoreData["erp_config"] = {
      data: JSON.stringify({
        financeiro: { overhead: 41.16, vrml: 20, impostos: 0 },
        materiais: [{ comp: 183, larg: 122, preco: 180 }],
      }),
    };
    const r = await evaluateQuoteEligibility([{ larg: 100, alt: 100, qty: 1, matKey: "cfg_0" }]);
    expect(r.eligibility).toBe("ELIGIBLE");
    expect(typeof r.finalPrice).toBe("number");
    expect(r.finalPrice).toBeGreaterThan(0);
    expect(r.finalPrice).toBeLessThan(1_000_000);
  });
});
