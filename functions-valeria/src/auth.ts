/**
 * auth.ts — Autenticação, rotação de chave e validação de agente/organização
 *
 * Usa Firebase Secret Manager via defineSecret().
 * Suporta VALERIA_BEARER_SECRET (atual) e VALERIA_BEARER_SECRET_PREV (anterior)
 * para rotação sem downtime.
 *
 * Comparação usa crypto.timingSafeEqual() para evitar timing attacks.
 */

import * as crypto from "crypto";
import type { Request } from "express";
import type { Response } from "express";
import type { AuthorizedAgent, ConversationContext } from "./types";
import { err } from "./response";

// Nomes dos secrets no Secret Manager (Gen 1: injetados como process.env)
export const BEARER_SECRET      = "VALERIA_BEARER_SECRET";
export const BEARER_SECRET_PREV = "VALERIA_BEARER_SECRET_PREV";

/**
 * AUTHORIZED_AGENTS é lida do Firestore em tempo de execução.
 * Documento: erp_vr/valeria_authorized_agents  →  { agents: [...] }
 *
 * Fail-closed: se o documento não existir ou estiver vazio, TODA chamada
 * é rejeitada com 403. Isso previne operação acidental sem configuração.
 *
 * Para adicionar um agente autorizado, crie/atualize o documento no console
 * do Firebase sem necessidade de re-deploy.
 */
let _agentsCache: AuthorizedAgent[] | null = null;
let _agentsCacheAt = 0;
const AGENTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/** Somente para testes — o cache de 5 min impede que um teste que semeia o
 *  documento de agentes veja o resultado de outro teste que rodou com a
 *  lista vazia (fail-closed). Nunca chamado em produção. */
export function _resetAgentsCacheForTests(): void {
  _agentsCache = null;
  _agentsCacheAt = 0;
}

async function loadAuthorizedAgents(): Promise<AuthorizedAgent[]> {
  const now = Date.now();
  if (_agentsCache !== null && now - _agentsCacheAt < AGENTS_CACHE_TTL) {
    return _agentsCache;
  }
  try {
    const admin = await import("firebase-admin");
    const db    = admin.default.firestore();
    const doc   = await db.collection("erp_vr").doc("valeria_authorized_agents").get();
    if (!doc.exists) {
      console.warn("[auth] valeria_authorized_agents não encontrado — acesso bloqueado (fail-closed)");
      _agentsCache   = [];
      _agentsCacheAt = now;
      return [];
    }
    const agents = (doc.data()?.agents ?? []) as AuthorizedAgent[];
    _agentsCache   = agents;
    _agentsCacheAt = now;
    return agents;
  } catch (e) {
    console.error("[auth] Erro ao carregar authorized agents:", (e as Error).message);
    // Fail-closed em caso de erro de leitura
    return [];
  }
}

// ── Comparação timing-safe ────────────────────────────────────────────────────

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Ainda executa a comparação para evitar timing leak no comprimento
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Validação do Bearer token ──────────────────────────────────────────────────

export type AuthResult =
  | { ok: true; keySlot: "current" | "previous" }
  | { ok: false; status: number; body: ReturnType<typeof err> };

export function validateBearer(req: Request): AuthResult {
  const authHeader = (req.headers["authorization"] as string | undefined) ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      body: err("UNAUTHORIZED", "Authorization header ausente ou malformado."),
    };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return {
      ok: false,
      status: 401,
      body: err("UNAUTHORIZED", "Bearer token vazio."),
    };
  }

  const current  = process.env[BEARER_SECRET]      ?? "";
  const previous = process.env[BEARER_SECRET_PREV] ?? "";

  if (current && timingSafeCompare(token, current)) {
    return { ok: true, keySlot: "current" };
  }
  if (previous && timingSafeCompare(token, previous)) {
    return { ok: true, keySlot: "previous" };
  }

  return {
    ok: false,
    status: 401,
    body: err("UNAUTHORIZED", "Token inválido."),
  };
}

// ── Validação de agente e organização ─────────────────────────────────────────

export type AgentAuthResult =
  | { ok: true }
  | { ok: false; status: number; body: ReturnType<typeof err> };

/**
 * Valida que o agentId e organizationId recebidos no payload são autorizados.
 *
 * FAIL-CLOSED: se a lista de agentes autorizados estiver vazia (Firestore não
 * configurado), TODA chamada é rejeitada. Não existe modo homologação permissivo.
 *
 * Para autorizar um agente, crie o documento erp_vr/valeria_authorized_agents
 * no Firestore com o campo: agents: [{ agentId, organizationId, allowedFunctions? }]
 */
export async function validateAgent(
  agentId: string | undefined,
  organizationId: string | undefined,
  functionName: string
): Promise<AgentAuthResult> {
  if (!agentId) {
    return {
      ok: false,
      status: 400,
      body: err("VALIDATION_ERROR", "agentId é obrigatório.", { missingFields: ["agentId"] }),
    };
  }
  if (!organizationId) {
    return {
      ok: false,
      status: 400,
      body: err("VALIDATION_ERROR", "organizationId é obrigatório.", {
        missingFields: ["organizationId"],
      }),
    };
  }

  const agents = await loadAuthorizedAgents();

  // Fail-closed: lista vazia = não configurado = bloquear
  if (agents.length === 0) {
    console.error(`[auth] BLOQUEADO — lista de agentes não configurada. agentId=${agentId}`);
    return {
      ok: false,
      status: 403,
      body: err("FORBIDDEN",
        "Integração não autorizada. Configure erp_vr/valeria_authorized_agents no Firestore."
      ),
    };
  }

  const agent = agents.find(
    (a) => a.agentId === agentId && a.organizationId === organizationId
  );

  if (!agent) {
    return {
      ok: false,
      status: 403,
      body: err("FORBIDDEN", "agentId ou organizationId não autorizado."),
    };
  }

  if (agent.allowedFunctions && !agent.allowedFunctions.includes(functionName)) {
    return {
      ok: false,
      status: 403,
      body: err("FORBIDDEN", `Agente não autorizado para a função ${functionName}.`),
    };
  }

  return { ok: true };
}

// ── Extração e validação do contexto de conversa ──────────────────────────────

export type CtxResult =
  | { ok: true; ctx: ConversationContext }
  | { ok: false; status: number; body: ReturnType<typeof err> };

export function extractContext(body: Record<string, unknown>): CtxResult {
  const conversationId = body["conversationId"] as string | undefined;
  const agentId        = body["agentId"]        as string | undefined;
  const organizationId = body["organizationId"] as string | undefined;

  if (!conversationId) {
    return {
      ok: false,
      status: 400,
      body: err("VALIDATION_ERROR", "conversationId é obrigatório.", {
        missingFields: ["conversationId"],
      }),
    };
  }
  if (!agentId || !organizationId) {
    return {
      ok: false,
      status: 400,
      body: err("VALIDATION_ERROR", "agentId e organizationId são obrigatórios.", {
        missingFields: [
          ...(!agentId ? ["agentId"] : []),
          ...(!organizationId ? ["organizationId"] : []),
        ],
      }),
    };
  }

  return {
    ok: true,
    ctx: {
      conversationId,
      messageId:      body["messageId"]      as string | undefined,
      agentId,
      organizationId,
      channelPhone:   body["channelPhone"]   as string | undefined,
    },
  };
}

// ── Helper para responder com erro de auth ─────────────────────────────────────

export function sendAuthError(res: Response, result: { status: number; body: ReturnType<typeof err> }): void {
  res.status(result.status).json(result.body);
}
