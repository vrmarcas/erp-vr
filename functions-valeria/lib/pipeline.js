"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipeline = pipeline;
const auth_1 = require("./auth");
const ratelimit_1 = require("./ratelimit");
const CORS_ORIGIN = "https://app.chatvolt.ai";
async function pipeline(req, res, functionName) {
    // CORS
    res.set("Access-Control-Allow-Origin", CORS_ORIGIN);
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Idempotency-Key");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return null;
    }
    // 1. Bearer auth
    const bearerResult = (0, auth_1.validateBearer)(req);
    if (!bearerResult.ok) {
        (0, auth_1.sendAuthError)(res, bearerResult);
        return null;
    }
    const rawToken = (req.headers["authorization"] ?? "").slice(7);
    const tokenKey = rawToken.slice(0, 8) + "…";
    // 2. Contexto de conversa
    const body = req.body;
    const ctxResult = (0, auth_1.extractContext)(body);
    if (!ctxResult.ok) {
        (0, auth_1.sendAuthError)(res, ctxResult);
        return null;
    }
    const ctx = ctxResult.ctx;
    // 3. Agente/organização autorizados (fail-closed — async lê do Firestore)
    const agentResult = await (0, auth_1.validateAgent)(ctx.agentId, ctx.organizationId, functionName);
    if (!agentResult.ok) {
        (0, auth_1.sendAuthError)(res, agentResult);
        return null;
    }
    // 4. Rate limiting + payload
    const allowed = await (0, ratelimit_1.checkRateLimit)(req, res, {
        tokenKey,
        conversationId: ctx.conversationId,
    });
    if (!allowed)
        return null;
    return { ctx, tokenKey };
}
//# sourceMappingURL=pipeline.js.map