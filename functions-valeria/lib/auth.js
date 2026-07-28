"use strict";
/**
 * auth.ts — Autenticação, rotação de chave e validação de agente/organização
 *
 * Usa Firebase Secret Manager via defineSecret().
 * Suporta VALERIA_BEARER_SECRET (atual) e VALERIA_BEARER_SECRET_PREV (anterior)
 * para rotação sem downtime.
 *
 * Comparação usa crypto.timingSafeEqual() para evitar timing attacks.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BEARER_SECRET_PREV = exports.BEARER_SECRET = void 0;
exports.validateBearer = validateBearer;
exports.validateAgent = validateAgent;
exports.extractContext = extractContext;
exports.sendAuthError = sendAuthError;
const crypto = __importStar(require("crypto"));
const response_1 = require("./response");
// Nomes dos secrets no Secret Manager (Gen 1: injetados como process.env)
exports.BEARER_SECRET = "VALERIA_BEARER_SECRET";
exports.BEARER_SECRET_PREV = "VALERIA_BEARER_SECRET_PREV";
// Lista de agentes/organizações autorizados.
// Em produção, leia do Firestore (erp_vr/valeria_authorized_agents) para permitir
// mudanças sem re-deploy. Para homologação, usa lista estática.
const AUTHORIZED_AGENTS = [
// Será populada via Firestore após homologação
// { agentId: "cl...", organizationId: "org...", allowedFunctions: undefined }
];
// ── Comparação timing-safe ────────────────────────────────────────────────────
function timingSafeCompare(a, b) {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        // Ainda executa a comparação para evitar timing leak no comprimento
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}
function validateBearer(req) {
    const authHeader = req.headers["authorization"] ?? "";
    if (!authHeader.startsWith("Bearer ")) {
        return {
            ok: false,
            status: 401,
            body: (0, response_1.err)("UNAUTHORIZED", "Authorization header ausente ou malformado."),
        };
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
        return {
            ok: false,
            status: 401,
            body: (0, response_1.err)("UNAUTHORIZED", "Bearer token vazio."),
        };
    }
    const current = process.env[exports.BEARER_SECRET] ?? "";
    const previous = process.env[exports.BEARER_SECRET_PREV] ?? "";
    if (current && timingSafeCompare(token, current)) {
        return { ok: true, keySlot: "current" };
    }
    if (previous && timingSafeCompare(token, previous)) {
        return { ok: true, keySlot: "previous" };
    }
    return {
        ok: false,
        status: 401,
        body: (0, response_1.err)("UNAUTHORIZED", "Token inválido."),
    };
}
/**
 * Valida que o agentId e organizationId recebidos no payload são autorizados.
 * Se AUTHORIZED_AGENTS estiver vazio (modo homologação), aceita qualquer par
 * mas registra warning.
 */
function validateAgent(agentId, organizationId, functionName) {
    if (!agentId) {
        return {
            ok: false,
            status: 400,
            body: (0, response_1.err)("VALIDATION_ERROR", "agentId é obrigatório.", { missingFields: ["agentId"] }),
        };
    }
    if (!organizationId) {
        return {
            ok: false,
            status: 400,
            body: (0, response_1.err)("VALIDATION_ERROR", "organizationId é obrigatório.", {
                missingFields: ["organizationId"],
            }),
        };
    }
    // Lista estática vazia = modo homologação (aceita qualquer agente conhecido)
    if (AUTHORIZED_AGENTS.length === 0) {
        // Em homologação, aceitar — mas sinalizar com warning no log
        console.warn(`[auth] AUTHORIZED_AGENTS vazio — agentId=${agentId} aceito sem validação (homologação)`);
        return { ok: true };
    }
    const agent = AUTHORIZED_AGENTS.find((a) => a.agentId === agentId && a.organizationId === organizationId);
    if (!agent) {
        return {
            ok: false,
            status: 403,
            body: (0, response_1.err)("FORBIDDEN", "agentId ou organizationId não autorizado."),
        };
    }
    if (agent.allowedFunctions && !agent.allowedFunctions.includes(functionName)) {
        return {
            ok: false,
            status: 403,
            body: (0, response_1.err)("FORBIDDEN", `Agente não autorizado para a função ${functionName}.`),
        };
    }
    return { ok: true };
}
function extractContext(body) {
    const conversationId = body["conversationId"];
    const agentId = body["agentId"];
    const organizationId = body["organizationId"];
    if (!conversationId) {
        return {
            ok: false,
            status: 400,
            body: (0, response_1.err)("VALIDATION_ERROR", "conversationId é obrigatório.", {
                missingFields: ["conversationId"],
            }),
        };
    }
    if (!agentId || !organizationId) {
        return {
            ok: false,
            status: 400,
            body: (0, response_1.err)("VALIDATION_ERROR", "agentId e organizationId são obrigatórios.", {
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
            messageId: body["messageId"],
            agentId,
            organizationId,
            channelPhone: body["channelPhone"],
        },
    };
}
// ── Helper para responder com erro de auth ─────────────────────────────────────
function sendAuthError(res, result) {
    res.status(result.status).json(result.body);
}
//# sourceMappingURL=auth.js.map