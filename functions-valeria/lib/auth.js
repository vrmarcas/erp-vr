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
let _agentsCache = null;
let _agentsCacheAt = 0;
const AGENTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
async function loadAuthorizedAgents() {
    const now = Date.now();
    if (_agentsCache !== null && now - _agentsCacheAt < AGENTS_CACHE_TTL) {
        return _agentsCache;
    }
    try {
        const admin = await Promise.resolve().then(() => __importStar(require("firebase-admin")));
        const db = admin.default.firestore();
        const doc = await db.collection("erp_vr").doc("valeria_authorized_agents").get();
        if (!doc.exists) {
            console.warn("[auth] valeria_authorized_agents não encontrado — acesso bloqueado (fail-closed)");
            _agentsCache = [];
            _agentsCacheAt = now;
            return [];
        }
        const agents = (doc.data()?.agents ?? []);
        _agentsCache = agents;
        _agentsCacheAt = now;
        return agents;
    }
    catch (e) {
        console.error("[auth] Erro ao carregar authorized agents:", e.message);
        // Fail-closed em caso de erro de leitura
        return [];
    }
}
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
 *
 * FAIL-CLOSED: se a lista de agentes autorizados estiver vazia (Firestore não
 * configurado), TODA chamada é rejeitada. Não existe modo homologação permissivo.
 *
 * Para autorizar um agente, crie o documento erp_vr/valeria_authorized_agents
 * no Firestore com o campo: agents: [{ agentId, organizationId, allowedFunctions? }]
 */
async function validateAgent(agentId, organizationId, functionName) {
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
    const agents = await loadAuthorizedAgents();
    // Fail-closed: lista vazia = não configurado = bloquear
    if (agents.length === 0) {
        console.error(`[auth] BLOQUEADO — lista de agentes não configurada. agentId=${agentId}`);
        return {
            ok: false,
            status: 403,
            body: (0, response_1.err)("FORBIDDEN", "Integração não autorizada. Configure erp_vr/valeria_authorized_agents no Firestore."),
        };
    }
    const agent = agents.find((a) => a.agentId === agentId && a.organizationId === organizationId);
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