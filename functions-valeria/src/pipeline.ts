/**
 * pipeline.ts — Middleware compartilhado para todas as Cloud Functions Valéria.
 *
 * Executa em ordem:
 *  1. CORS — restrito a https://app.chatvolt.ai
 *  2. Bearer auth — timing-safe, rotação CURRENT+PREV
 *  3. Extração de contexto — conversationId, agentId, organizationId, channelPhone, messageId
 *  4. Validação de agente/organização
 *  5. Rate limiting — global (300/min) + por conversa (30/min) + payload (256 KB)
 *
 * Retorna { ctx, tokenKey } em caso de sucesso, ou null (já respondeu com erro).
 */

import type { Request as FnRequest } from "express";
import type { Response as FnResponse } from "express";
import {
  validateBearer,
  validateAgent,
  extractContext,
  sendAuthError,
} from "./auth";
import { checkRateLimit } from "./ratelimit";
import type { ConversationContext } from "./types";

const CORS_ORIGIN = "https://app.chatvolt.ai";

export async function pipeline(
  req: FnRequest,
  res: FnResponse,
  functionName: string
): Promise<{ ctx: ConversationContext; tokenKey: string } | null> {
  // CORS
  res.set("Access-Control-Allow-Origin",  CORS_ORIGIN);
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Idempotency-Key");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).send(""); return null; }

  // 1. Bearer auth
  const bearerResult = validateBearer(req);
  if (!bearerResult.ok) { sendAuthError(res, bearerResult); return null; }

  const rawToken = ((req.headers["authorization"] as string) ?? "").slice(7);
  const tokenKey = rawToken.slice(0, 8) + "…";

  // 2. Contexto de conversa
  const body      = req.body as Record<string, unknown>;
  const ctxResult = extractContext(body);
  if (!ctxResult.ok) { sendAuthError(res, ctxResult); return null; }
  const ctx = ctxResult.ctx;

  // 3. Agente/organização autorizados (fail-closed — async lê do Firestore)
  const agentResult = await validateAgent(ctx.agentId, ctx.organizationId, functionName);
  if (!agentResult.ok) { sendAuthError(res, agentResult); return null; }

  // 4. Rate limiting + payload
  const allowed = await checkRateLimit(req, res, {
    tokenKey,
    conversationId: ctx.conversationId,
  });
  if (!allowed) return null;

  return { ctx, tokenKey };
}
