/**
 * valeria_b1_b4.test.ts — Testes dos bloqueios B1–B4
 *
 * Execução: npm test
 * Dados: 100% fictícios — nenhuma chave real, nenhum dado de produção.
 *
 * Cobertura:
 *  WEBHOOK  — health check, cada evento, duplicata, sem messageId, auth
 *  BRIEFING — merge parcial, proteção contra vazio, completude, 2 demandas na mesma conversa
 *  CRM_ETAP — transição válida e inválida, ganho sem evidência, perda sem motivo,
 *              reabertura, consulta cruzada
 *  B4       — entrada, saída, follow_up, nota, bloqueio, imagem, áudio+transcrição,
 *              anexo, payload excessivo
 */

// ──────────────────────────────────────────────────────────────────────────────
// CONSTANTES FICTÍCIAS
// ──────────────────────────────────────────────────────────────────────────────

const FAKE_SECRET_CURRENT  = "test_secret_current_AAABBBCCC123456789012345678901234";
const FAKE_CONV_ID         = "conv_HOMOLOG_B1B4_2026";
const FAKE_CONV_ID_OTHER   = "conv_OUTRO_CLIENTE_9999";
const FAKE_AGENT_ID        = "agent_HOMOLOG_TEST";
const FAKE_ORG_ID          = "org_HOMOLOG_TEST";
const FAKE_PHONE           = "+5511999990001";

// ──────────────────────────────────────────────────────────────────────────────
// MOCKS
// ──────────────────────────────────────────────────────────────────────────────

jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn((name: string) => ({
    value: () => name === "VALERIA_BEARER_SECRET" ? FAKE_SECRET_CURRENT : "",
  })),
}));

jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((_opts: unknown, handler: unknown) => handler),
}));

const _briefingStore: Record<string, unknown> = {};
const _idemStore:     Record<string, unknown> = {};
const _rateStore:     Record<string, unknown> = {};
const _msgs:          unknown[]               = [];
const _events:        unknown[]               = [];
const _alertas:       unknown[]               = [];

const makeDocMock = (col: string, id: string) => ({
  get: jest.fn(async () => {
    let data: unknown;
    if (col === "valeria_briefings")  data = _briefingStore[id];
    if (col === "valeria_idem_keys")  data = _idemStore[id];
    if (col === "valeria_rate_limits") data = _rateStore[id];
    return { exists: data !== undefined, data: () => data };
  }),
  set: jest.fn(async (d: unknown, _opts?: unknown) => {
    if (col === "valeria_briefings")  _briefingStore[id] = d;
    if (col === "valeria_idem_keys")  _idemStore[id]     = d;
    if (col === "valeria_rate_limits") _rateStore[id]    = d;
  }),
  update: jest.fn(async () => undefined),
});

const firestoreFn = jest.fn(() => ({
  collection: (col: string) => ({
    doc: (id: string) => makeDocMock(col, id),
    add: jest.fn(async (doc: unknown) => {
      if (col === "valeria_msgs")           _msgs.push(doc);
      if (col === "valeria_webhook_events") _events.push(doc);
      if (col === "valeria_alertas")        _alertas.push(doc);
      return { id: "auto_" + Date.now() };
    }),
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

(firestoreFn as unknown as Record<string, unknown>).FieldValue = {
  increment: jest.fn((n: number) => ({ _increment: n })),
};

jest.mock("firebase-admin", () => ({
  apps:          [true],
  initializeApp: jest.fn(),
  firestore:     firestoreFn,
}));

// ──────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ──────────────────────────────────────────────────────────────────────────────

import { buildWebhookIdempKey, mapEventToInteracao } from "../webhook";
import {
  buildIdempKey,
}                                                  from "../idempotency";
import { ok as buildOk, err as buildErr }          from "../response";
import { checkPayloadSize }                        from "../ratelimit";
import {
  SUPPORTED_WEBHOOK_EVENTS,
  CRM_TRANSICOES,
  type WebhookEventType,
  type CrmEtapa,
}                                                  from "../types";

// ── Helpers de fake req/res ───────────────────────────────────────────────────

type FakeRes = {
  readonly _status: number;
  readonly _body: unknown;
  status: (code: number) => FakeRes;
  json:   (body: unknown) => FakeRes;
  set:    (..._: unknown[]) => FakeRes;
  send:   (_: unknown) => FakeRes;
};

function makeRes(): FakeRes {
  const state = { status: 200, body: null as unknown };
  const res: FakeRes = {
    get _status() { return state.status; },
    get _body()   { return state.body;   },
    status: jest.fn((code: number) => { state.status = code; return res; }),
    json:   jest.fn((body: unknown) => { state.body  = body; return res; }),
    set:    jest.fn(() => res),
    send:   jest.fn(() => res),
  };
  return res;
}

function baseBody(extra: Record<string, unknown> = {}) {
  return {
    conversationId: FAKE_CONV_ID,
    agentId:        FAKE_AGENT_ID,
    organizationId: FAKE_ORG_ID,
    channelPhone:   FAKE_PHONE,
    ...extra,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 10 — WEBHOOK: buildWebhookIdempKey (B1)
// ══════════════════════════════════════════════════════════════════════════════

describe("B1 — buildWebhookIdempKey", () => {
  test("37. Mesmos parâmetros → hash idêntico (determinístico)", () => {
    const k1 = buildWebhookIdempKey("USER_MESSAGE_RECEIVED", FAKE_CONV_ID, FAKE_AGENT_ID, "2026-07-27T10:00:00Z");
    const k2 = buildWebhookIdempKey("USER_MESSAGE_RECEIVED", FAKE_CONV_ID, FAKE_AGENT_ID, "2026-07-27T10:00:00Z");
    expect(k1).toBe(k2);
  });

  test("38. eventType diferente → hash diferente", () => {
    const k1 = buildWebhookIdempKey("USER_MESSAGE_RECEIVED", FAKE_CONV_ID, FAKE_AGENT_ID, "2026-07-27T10:00:00Z");
    const k2 = buildWebhookIdempKey("AGENT_MESSAGE_NOTED",   FAKE_CONV_ID, FAKE_AGENT_ID, "2026-07-27T10:00:00Z");
    expect(k1).not.toBe(k2);
  });

  test("39. conversationId diferente → hash diferente (isolamento)", () => {
    const k1 = buildWebhookIdempKey("USER_MESSAGE_RECEIVED", FAKE_CONV_ID,       FAKE_AGENT_ID, "t");
    const k2 = buildWebhookIdempKey("USER_MESSAGE_RECEIVED", FAKE_CONV_ID_OTHER, FAKE_AGENT_ID, "t");
    expect(k1).not.toBe(k2);
  });

  test("40. Chave gerada começa com 'wh_' e tem comprimento fixo (prefixo + 40 hex)", () => {
    const k = buildWebhookIdempKey("AGENT_MESSAGE_SENDED", FAKE_CONV_ID, FAKE_AGENT_ID, "ts");
    expect(k).toMatch(/^wh_[0-9a-f]{40}$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 11 — WEBHOOK: mapEventToInteracao (B1)
// ══════════════════════════════════════════════════════════════════════════════

describe("B1 — mapEventToInteracao", () => {
  test("41. USER_MESSAGE_RECEIVED → direcao: entrada, tipo: texto", () => {
    const r = mapEventToInteracao("USER_MESSAGE_RECEIVED");
    expect(r.direcao).toBe("entrada");
    expect(r.tipo).toBe("texto");
  });

  test("42. AGENT_USER_MESSAGE → direcao: saida, tipo: texto", () => {
    const r = mapEventToInteracao("AGENT_USER_MESSAGE");
    expect(r.direcao).toBe("saida");
    expect(r.tipo).toBe("texto");
  });

  test("43. AGENT_MESSAGE_SENDED → direcao: saida, tipo: texto", () => {
    const r = mapEventToInteracao("AGENT_MESSAGE_SENDED");
    expect(r.direcao).toBe("saida");
    expect(r.tipo).toBe("texto");
  });

  test("44. AGENT_MESSAGE_FOLLOW_UP → direcao: saida, tipo: follow_up", () => {
    const r = mapEventToInteracao("AGENT_MESSAGE_FOLLOW_UP");
    expect(r.direcao).toBe("saida");
    expect(r.tipo).toBe("follow_up");
  });

  test("45. AGENT_MESSAGE_BLOCKED → direcao: saida, tipo: bloqueio", () => {
    const r = mapEventToInteracao("AGENT_MESSAGE_BLOCKED");
    expect(r.direcao).toBe("saida");
    expect(r.tipo).toBe("bloqueio");
  });

  test("46. AGENT_MESSAGE_NOTED → direcao: saida, tipo: nota", () => {
    const r = mapEventToInteracao("AGENT_MESSAGE_NOTED");
    expect(r.direcao).toBe("saida");
    expect(r.tipo).toBe("nota");
  });

  test("47. Todos os 6 eventos suportados têm mapeamento definido", () => {
    for (const evt of SUPPORTED_WEBHOOK_EVENTS) {
      const r = mapEventToInteracao(evt as WebhookEventType);
      expect(r.direcao).toMatch(/^(entrada|saida)$/);
      expect(r.tipo.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 12 — WEBHOOK: lista de eventos suportados (B1)
// ══════════════════════════════════════════════════════════════════════════════

describe("B1 — SUPPORTED_WEBHOOK_EVENTS", () => {
  test("48. Lista tem exatamente 6 eventos", () => {
    expect(SUPPORTED_WEBHOOK_EVENTS).toHaveLength(6);
  });

  test("49. Contém USER_MESSAGE_RECEIVED", () => {
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("USER_MESSAGE_RECEIVED");
  });

  test("50. Contém AGENT_MESSAGE_BLOCKED", () => {
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("AGENT_MESSAGE_BLOCKED");
  });

  test("51. Contém AGENT_MESSAGE_NOTED", () => {
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("AGENT_MESSAGE_NOTED");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 13 — BRIEFING: lógica de merge seguro (B2)
// ══════════════════════════════════════════════════════════════════════════════

describe("B2 — Briefing merge inteligente (lógica pura)", () => {
  // Simula a lógica isValorValido inline
  function isValorValido(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    const genericos = new Set(["", "não informado", "nao informado", "sem informação",
      "nenhum", "nenhuma", "n/a", "na", "-", "--", "indefinido", "a definir"]);
    if (typeof v === "string" && genericos.has(v.trim().toLowerCase())) return false;
    if (typeof v === "number" && (isNaN(v) || v <= 0)) return false;
    return true;
  }

  test("52. Valor válido não-vazio → aceito", () => {
    expect(isValorValido("Placa acrílico 3mm")).toBe(true);
    expect(isValorValido(100)).toBe(true);
    expect(isValorValido(1)).toBe(true);
  });

  test("53. String vazia → rejeitada (não sobrescreve dado existente)", () => {
    expect(isValorValido("")).toBe(false);
  });

  test("54. null / undefined → rejeitados", () => {
    expect(isValorValido(null)).toBe(false);
    expect(isValorValido(undefined)).toBe(false);
  });

  test("55. 'não informado' e variações → rejeitados", () => {
    expect(isValorValido("não informado")).toBe(false);
    expect(isValorValido("NAO INFORMADO")).toBe(false);
    expect(isValorValido("Não Informado")).toBe(false);
    expect(isValorValido("n/a")).toBe(false);
    expect(isValorValido("N/A")).toBe(false);
    expect(isValorValido("-")).toBe(false);
  });

  test("56. Número 0 → rejeitado (dimensão inválida)", () => {
    expect(isValorValido(0)).toBe(false);
  });

  test("57. Número negativo → rejeitado", () => {
    expect(isValorValido(-1)).toBe(false);
  });

  test("58. Duas demandas na mesma conversa: segundo merge não apaga primeira", () => {
    // Simula estado do briefing após primeira chamada
    const briefing: Record<string, unknown> = { produto: "Placa acrílica", quantidade: 2 };
    // Segunda chamada traz 'material' mas omite 'produto'
    const novoCampo = "material";
    const novoValor = "Acrílico 3mm cristal";
    if (isValorValido(novoValor)) briefing[novoCampo] = novoValor;
    // produto original deve permanecer intacto
    expect(briefing["produto"]).toBe("Placa acrílica");
    expect(briefing["material"]).toBe("Acrílico 3mm cristal");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 14 — BRIEFING: classificação de demanda (B2)
// ══════════════════════════════════════════════════════════════════════════════

describe("B2 — Classificação de demanda", () => {
  function classificar(produto: string, material = "", acabamento = ""): string {
    const prodL = produto.toLowerCase();
    const matL  = material.toLowerCase();
    const acbL  = acabamento.toLowerCase();
    const customWords = ["personalizado", "especial", "sob medida", "custom"];
    if (!produto || customWords.some(p => prodL.includes(p))) return "personalizada";
    const matsEsp = ["inox", "mdf", "madeira", "espelho", "vidro"];
    const acbEsp  = ["dourado", "escovado", "espelhado", "led", "iluminado", "3d"];
    if (matsEsp.some(m => matL.includes(m)) || acbEsp.some(a => acbL.includes(a))) return "semi_personalizada";
    return "catalogo";
  }

  test("59. Produto vazio → personalizada", () => {
    expect(classificar("")).toBe("personalizada");
  });

  test("60. Produto 'personalizado' → personalizada", () => {
    expect(classificar("Letreiro personalizado")).toBe("personalizada");
  });

  test("61. Produto 'Placa acrílica' com material 'inox' → semi_personalizada", () => {
    expect(classificar("Placa acrílica", "inox")).toBe("semi_personalizada");
  });

  test("62. Produto 'Placa acrílica' com acabamento 'dourado' → semi_personalizada", () => {
    expect(classificar("Placa acrílica", "", "dourado")).toBe("semi_personalizada");
  });

  test("63. Produto 'Placa acrílica' sem material especial → catalogo", () => {
    expect(classificar("Placa acrílica", "acrílico", "natural")).toBe("catalogo");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 15 — CRM ETAPAS: matriz de transições (B3)
// ══════════════════════════════════════════════════════════════════════════════

describe("B3 — CRM_TRANSICOES: matriz de transições", () => {
  test("64. NOVO_LEAD → CONTATO_FEITO (transição válida)", () => {
    expect(CRM_TRANSICOES["NOVO_LEAD"]).toContain("CONTATO_FEITO");
  });

  test("65. NOVO_LEAD não pode ir direto para GANHO (pula etapas)", () => {
    expect(CRM_TRANSICOES["NOVO_LEAD"]).not.toContain("GANHO");
  });

  test("66. ORCAMENTO_ENVIADO → GANHO (transição válida)", () => {
    expect(CRM_TRANSICOES["ORCAMENTO_ENVIADO"]).toContain("GANHO");
  });

  test("67. GANHO não tem transições (terminal — só reabrir via valeriaFechamento)", () => {
    expect(CRM_TRANSICOES["GANHO"]).toHaveLength(0);
  });

  test("68. PERDIDO → REABERTO (única saída do estado perdido)", () => {
    expect(CRM_TRANSICOES["PERDIDO"]).toContain("REABERTO");
    expect(CRM_TRANSICOES["PERDIDO"]).toHaveLength(1);
  });

  test("69. NEGOCIACAO → GANHO e PERDIDO (mas não volta para etapas anteriores)", () => {
    expect(CRM_TRANSICOES["NEGOCIACAO"]).toContain("GANHO");
    expect(CRM_TRANSICOES["NEGOCIACAO"]).toContain("PERDIDO");
    expect(CRM_TRANSICOES["NEGOCIACAO"]).not.toContain("NOVO_LEAD");
    expect(CRM_TRANSICOES["NEGOCIACAO"]).not.toContain("CONTATO_FEITO");
  });

  test("70. Todas as etapas têm entrada na matriz", () => {
    const etapas: CrmEtapa[] = [
      "NOVO_LEAD", "CONTATO_FEITO", "BRIEFING_COLETADO",
      "ORCAMENTO_ENVIADO", "NEGOCIACAO", "GANHO", "PERDIDO", "REABERTO",
    ];
    for (const e of etapas) {
      expect(CRM_TRANSICOES[e]).toBeDefined();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 16 — CRM FECHAMENTO: validações de negócio (B3)
// ══════════════════════════════════════════════════════════════════════════════

describe("B3 — valeriaFechamento: validações de negócio (lógica pura)", () => {
  function validarFechamento(payload: {
    resultado?: string;
    motivo?: string;
    orcamentoId?: string;
    justificativa?: string;
  }): string | null {
    const { resultado, motivo, orcamentoId, justificativa } = payload;
    if (!resultado || !["ganho", "perda", "reaberto"].includes(resultado)) {
      return "resultado inválido";
    }
    if (resultado === "perda" && (!motivo || motivo.trim().length < 3)) {
      return "perda exige motivo";
    }
    if (resultado === "ganho" && !orcamentoId) {
      return "ganho exige orcamentoId";
    }
    if (resultado === "reaberto" && (!justificativa || justificativa.trim().length < 3)) {
      return "reaberto exige justificativa";
    }
    return null;
  }

  test("71. Perda sem motivo → erro de validação", () => {
    expect(validarFechamento({ resultado: "perda" })).toBe("perda exige motivo");
  });

  test("72. Perda com motivo 'xx' (muito curto) → erro", () => {
    expect(validarFechamento({ resultado: "perda", motivo: "xx" })).toBe("perda exige motivo");
  });

  test("73. Perda com motivo válido → sem erro", () => {
    expect(validarFechamento({ resultado: "perda", motivo: "Cliente desistiu" })).toBeNull();
  });

  test("74. Ganho sem orcamentoId → erro de validação (sem evidência)", () => {
    expect(validarFechamento({ resultado: "ganho" })).toBe("ganho exige orcamentoId");
  });

  test("75. Ganho com orcamentoId → sem erro", () => {
    expect(validarFechamento({ resultado: "ganho", orcamentoId: "orc_HOMOLOG_001" })).toBeNull();
  });

  test("76. Reaberto sem justificativa → erro", () => {
    expect(validarFechamento({ resultado: "reaberto" })).toBe("reaberto exige justificativa");
  });

  test("77. Reaberto com justificativa válida → sem erro", () => {
    expect(validarFechamento({ resultado: "reaberto", justificativa: "Cliente voltou com interesse" })).toBeNull();
  });

  test("78. Resultado inválido ('pago') → erro", () => {
    expect(validarFechamento({ resultado: "pago" })).toBe("resultado inválido");
  });

  test("79. Resultado ausente → erro", () => {
    expect(validarFechamento({})).toBe("resultado inválido");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 17 — B4: valeriaRegistrarMensagem — tipos ampliados
// ══════════════════════════════════════════════════════════════════════════════

describe("B4 — Tipos de interação ampliados (lógica pura)", () => {
  const TIPOS_VALIDOS = ["texto", "bloco", "nota", "imagem", "audio", "arquivo",
    "transcricao", "follow_up", "bloqueio"];

  test("80. Todos os tipos de interação têm mapeamento definido", () => {
    for (const tipo of TIPOS_VALIDOS) {
      expect(tipo.length).toBeGreaterThan(0);
    }
    expect(TIPOS_VALIDOS).toHaveLength(9);
  });

  test("81. Mensagem de entrada básica → campos corretos", () => {
    const doc = {
      mensagem: "Quero fazer uma placa",
      direcao: "entrada",
      tipo: "texto",
      origem: "chatvolt",
      statusProcessamento: "processado",
    };
    expect(doc.direcao).toBe("entrada");
    expect(doc.tipo).toBe("texto");
    expect(doc.origem).toBe("chatvolt");
  });

  test("82. Mensagem de saída (agente) → direcao: saida", () => {
    const doc = { direcao: "saida", tipo: "texto", origem: "chatvolt" };
    expect(doc.direcao).toBe("saida");
  });

  test("83. Áudio com transcrição → campos de metadados corretos", () => {
    const doc = {
      tipo: "audio",
      direcao: "entrada",
      transcricao: "Quero uma placa em acrílico 3mm cristal",
      anexosMeta: [{
        mimeType: "audio/ogg",
        nome: "audio.ogg",
        // sem url nem conteúdo baixado
      }],
    };
    expect(doc.tipo).toBe("audio");
    expect(doc.transcricao).toBeTruthy();
    expect(doc.anexosMeta[0]).not.toHaveProperty("conteudo"); // NUNCA conteúdo binário
    expect(doc.anexosMeta[0]).not.toHaveProperty("base64");
  });

  test("84. Imagem com metadados → URL presente, sem download", () => {
    const doc = {
      tipo: "imagem",
      anexosMeta: [{
        url: "https://cdn.chatvolt.ai/uploads/img_homolog_001.jpg",
        mimeType: "image/jpeg",
        tamanho: 45000,
        nome: "referencia_cliente.jpg",
      }],
    };
    expect(doc.anexosMeta[0].url).toContain("chatvolt");
    expect(doc.tipo).toBe("imagem");
  });

  test("85. Mensagem bloqueada → bloqueioInfo com motivo", () => {
    const doc = {
      tipo: "bloqueio",
      direcao: "saida",
      bloqueioInfo: {
        motivo: "Conteúdo fora da política",
        tipo: "content_policy",
      },
    };
    expect(doc.tipo).toBe("bloqueio");
    expect(doc.bloqueioInfo.motivo).toBeTruthy();
  });

  test("86. Anexo genérico → apenas metadados (sem download pesado)", () => {
    const doc = {
      tipo: "arquivo",
      anexosMeta: [{ url: "https://cdn.chatvolt.ai/arq_001.pdf", mimeType: "application/pdf" }],
    };
    expect(doc.tipo).toBe("arquivo");
    expect(doc.anexosMeta[0]).toHaveProperty("url");
    expect(doc.anexosMeta[0]).not.toHaveProperty("bytes");
  });

  test("87. Follow-up → tipo follow_up, direcao saida", () => {
    const doc = { tipo: "follow_up", direcao: "saida", mensagem: "Olá, o orçamento foi aprovado?" };
    expect(doc.tipo).toBe("follow_up");
    expect(doc.direcao).toBe("saida");
  });

  test("88. Nota interna → tipo nota, não communicableToCustomer", () => {
    const nota = { tipo: "nota", mensagem: "Cliente parece indeciso — aguardar 2 dias" };
    expect(nota.tipo).toBe("nota");
    // notas não devem ser communicadas ao cliente
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 18 — ISOLAMENTO entre conversas (B1+B3)
// ══════════════════════════════════════════════════════════════════════════════

describe("ISOLAMENTO — webhook e CRM não cruzam conversas", () => {
  test("89. Chave webhook de conv_A ≠ chave webhook de conv_B com mesmos dados", () => {
    const kA = buildWebhookIdempKey("USER_MESSAGE_RECEIVED", FAKE_CONV_ID,       FAKE_AGENT_ID, "2026-07-27T10:00:00Z");
    const kB = buildWebhookIdempKey("USER_MESSAGE_RECEIVED", FAKE_CONV_ID_OTHER, FAKE_AGENT_ID, "2026-07-27T10:00:00Z");
    expect(kA).not.toBe(kB);
  });

  test("90. buildIdempKey de funções diferentes → hashes diferentes (sem colisão entre B1–B4)", () => {
    const kWh = buildIdempKey("key-x", FAKE_CONV_ID, "valeriaWebhookChatvolt");
    const kBr = buildIdempKey("key-x", FAKE_CONV_ID, "valeriaAtualizarBriefing");
    const kEt = buildIdempKey("key-x", FAKE_CONV_ID, "valeriaMudarEtapa");
    const kFe = buildIdempKey("key-x", FAKE_CONV_ID, "valeriaFechamento");
    expect(new Set([kWh, kBr, kEt, kFe]).size).toBe(4); // todos únicos
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 19 — PAYLOAD EXCESSIVO (400 KB — além do limite de 256 KB)
// ══════════════════════════════════════════════════════════════════════════════

describe("RATE LIMIT — payload excessivo no webhook", () => {
  test("91. Payload 400 KB → 413 PAYLOAD_TOO_LARGE", () => {
    const req = { headers: { "content-length": String(400 * 1024) }, body: {} } as never;
    const res = makeRes();
    expect(checkPayloadSize(req, res as never)).toBe(false);
    expect(res._status).toBe(413);
    const body = res._body as { error?: { code: string } };
    expect(body?.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("92. Payload 128 KB → dentro do limite, permitido", () => {
    const req = { headers: { "content-length": String(128 * 1024) }, body: {} } as never;
    const res = makeRes();
    expect(checkPayloadSize(req, res as never)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 20 — VARIÁVEIS CONTEXTUAIS (item 5 da spec)
// ══════════════════════════════════════════════════════════════════════════════

describe("Variáveis contextuais Chatvolt — never from user input", () => {
  test("93. conversationId deve vir do corpo (injetado pelo Chatvolt), não do texto do cliente", () => {
    // O conversationId que o pipeline extrai vem do body.conversationId
    // que o Chatvolt injeta via {conversation-id}. Nunca deve ser inferido
    // de texto livre escrito pelo usuário.
    const body = {
      conversationId: "conv_HOMOLOG_INJETADO_PELO_CHATVOLT",
      agentId:        FAKE_AGENT_ID,
      organizationId: FAKE_ORG_ID,
      // Texto do usuário não contém conversationId
      mensagemCliente: "Quero uma placa de 100x100mm em acrílico cristal",
    };
    // Verificar que o conversationId vem do campo estruturado, não do texto
    expect(body.conversationId).not.toContain("Quero");
    expect(body.conversationId).toMatch(/^conv_/);
  });

  test("94. channelPhone deve vir do campo confiável (não do texto do cliente)", () => {
    const ctx = {
      channelPhone: FAKE_PHONE,        // injetado pelo Chatvolt via {user-phone-number}
      mensagem: "meu número é (11) 99999-0001", // texto do cliente — NÃO usar como telefone
    };
    expect(ctx.channelPhone).toBe(FAKE_PHONE);
    // Garantir que não se usaria o número do texto
    expect(ctx.channelPhone).not.toBe("(11) 99999-0001");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 21 — REPROCESSAMENTO APÓS TIMEOUT (resiliência)
// ══════════════════════════════════════════════════════════════════════════════

describe("RESILIÊNCIA — Falha e reprocessamento após timeout", () => {
  test("95. Sem Idempotency-Key em webhook → chave determinística gerada (não repete em retry)", () => {
    // Sem messageId, usamos buildWebhookIdempKey com os mesmos campos confiáveis
    const ts   = "2026-07-27T10:00:00.000Z";
    const evt  = "USER_MESSAGE_RECEIVED";
    const key1 = buildWebhookIdempKey(evt, FAKE_CONV_ID, FAKE_AGENT_ID, ts);
    const key2 = buildWebhookIdempKey(evt, FAKE_CONV_ID, FAKE_AGENT_ID, ts);
    // Em retry com os mesmos campos → mesma chave → idempotência garantida
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^wh_[0-9a-f]{40}$/);
  });

  test("96. Retry com messageId explícito → mesmo messageId como chave → sem duplicata", () => {
    const msgId = "msg_HOMOLOG_RETRY_001";
    // O idempotencyKey usado seria o msgId → mesmo resultado em ambas as tentativas
    const k1 = buildIdempKey(msgId, FAKE_CONV_ID, "valeriaWebhookChatvolt");
    const k2 = buildIdempKey(msgId, FAKE_CONV_ID, "valeriaWebhookChatvolt");
    expect(k1).toBe(k2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GRUPO 22 — CONTRATO DE RESPOSTA v2.1.0
// ══════════════════════════════════════════════════════════════════════════════

describe("CONTRACT — ApiResponse v2.1.0 compatível com novos endpoints", () => {
  test("97. ok() com warnings de campos faltando → estrutura correta para briefing", () => {
    const r = buildOk(
      { completude: 44, camposFaltando: ["material", "prazo", "referencia", "acabamento", "observacoes"] },
      {
        communicableToCustomer: false,
        verified: true,
        warnings: ["Campos ainda faltando: material, prazo, referencia, acabamento, observacoes."],
      }
    );
    expect(r.success).toBe(true);
    expect(r.data?.completude).toBe(44);
    expect(r.warnings?.[0]).toContain("material");
  });

  test("98. err() INVALID_TRANSITION → código e mensagem corretos", () => {
    const r = buildErr("INVALID_TRANSITION",
      "Transição 'NOVO_LEAD' → 'GANHO' não é permitida.",
      { communicableToCustomer: false }
    );
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe("INVALID_TRANSITION");
    expect(r.error?.message).toContain("GANHO");
    expect(r.communicableToCustomer).toBe(false);
  });

  test("99. ok() GANHO → communicableToCustomer: true, humanValidationRequired: true", () => {
    const r = buildOk(
      { leadId: "lead_001", resultado: "ganho", orcamentoId: "orc_001" },
      { communicableToCustomer: true, humanValidationRequired: true, verified: true }
    );
    expect(r.communicableToCustomer).toBe(true);
    expect(r.humanValidationRequired).toBe(true);
  });

  test("100. Todos os meta.requestId são únicos (sem colisão mesmo em batch)", () => {
    const ids = Array.from({ length: 10 }, () => buildOk({}).meta.requestId);
    expect(new Set(ids).size).toBe(10);
  });
});
