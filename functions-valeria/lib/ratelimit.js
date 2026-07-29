"use strict";
/**
 * ratelimit.ts — Rate limiting por token e por conversa
 *
 * Estratégia: janela deslizante simples via Firestore.
 * Em serverless, estado em memória não é confiável entre instâncias — Firestore
 * garante consistência mesmo com múltiplas instâncias paralelas.
 *
 * Limites padrão:
 *   - Global (por token):      300 req / 60 s
 *   - Por conversa:            30 req / 60 s
 *   - Payload máximo:          256 KB
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
exports.checkPayloadSize = checkPayloadSize;
exports.checkRateLimit = checkRateLimit;
const admin = __importStar(require("firebase-admin"));
const response_1 = require("./response");
const RATE_COL = "valeria_rate_limits";
const WINDOW_MS = 60000; // 1 minuto
const LIMIT_GLOBAL = 300; // requisições por token / janela
const LIMIT_CONV = 30; // requisições por conversationId / janela
const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB
// ── Payload size guard ───────────────────────────────────────────────────────
function checkPayloadSize(req, res) {
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
        res.status(413).json((0, response_1.err)("PAYLOAD_TOO_LARGE", `Payload excede o limite de ${MAX_PAYLOAD_BYTES / 1024} KB.`));
        return false;
    }
    // Também verificar o body já parseado (caso content-length não venha)
    const bodySize = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
    if (bodySize > MAX_PAYLOAD_BYTES) {
        res.status(413).json((0, response_1.err)("PAYLOAD_TOO_LARGE", `Payload excede o limite de ${MAX_PAYLOAD_BYTES / 1024} KB.`));
        return false;
    }
    return true;
}
// ── Sliding window counter ───────────────────────────────────────────────────
async function checkAndIncrement(key, limit) {
    const db = admin.firestore();
    const ref = db.collection(RATE_COL).doc(key);
    const now = Date.now();
    const allowed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
            tx.set(ref, { count: 1, windowStart: now, updatedAt: now });
            return true;
        }
        const data = snap.data();
        const elapsed = now - data.windowStart;
        if (elapsed > WINDOW_MS) {
            // Nova janela
            tx.update(ref, { count: 1, windowStart: now, updatedAt: now });
            return true;
        }
        if (data.count >= limit)
            return false;
        tx.update(ref, { count: admin.firestore.FieldValue.increment(1), updatedAt: now });
        return true;
    });
    return allowed;
}
// ── Verificação combinada ────────────────────────────────────────────────────
/**
 * Retorna true se a requisição pode prosseguir.
 * Responde com 429 e retorna false se bloqueado.
 */
async function checkRateLimit(req, res, opts) {
    // 1. Payload size
    if (!checkPayloadSize(req, res))
        return false;
    // 2. Limite global por token
    const globalOk = await checkAndIncrement(`token:${opts.tokenKey}`, LIMIT_GLOBAL);
    if (!globalOk) {
        res
            .status(429)
            .set("Retry-After", String(WINDOW_MS / 1000))
            .json((0, response_1.err)("RATE_LIMIT_EXCEEDED", `Limite de ${LIMIT_GLOBAL} requisições/minuto excedido.`, {
            communicableToCustomer: false,
        }));
        return false;
    }
    // 3. Limite por conversa
    if (opts.conversationId) {
        const convOk = await checkAndIncrement(`conv:${opts.conversationId}`, LIMIT_CONV);
        if (!convOk) {
            res
                .status(429)
                .set("Retry-After", String(WINDOW_MS / 1000))
                .json((0, response_1.err)("RATE_LIMIT_EXCEEDED", `Limite de ${LIMIT_CONV} requisições/minuto por conversa excedido.`, {
                communicableToCustomer: false,
            }));
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=ratelimit.js.map