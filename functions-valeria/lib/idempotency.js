"use strict";
/**
 * idempotency.ts — Garantia de idempotência via Firestore
 * v2.1: validação de chave, hash canônico de payload, 409 por conflito de
 * payload divergente, 423 por operação em andamento, header X-Idempotent-Replay.
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
exports.IDEM_CODES = void 0;
exports.buildIdempKey = buildIdempKey;
exports.validateIdempotencyKey = validateIdempotencyKey;
exports.buildPayloadHash = buildPayloadHash;
exports.idempotencyHttpStatus = idempotencyHttpStatus;
exports.withIdempotency = withIdempotency;
exports.extractIdempotencyKey = extractIdempotencyKey;
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const IDEM_COL = "valeria_idem_keys";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const KEY_MAX_LEN = 256;
// ── Códigos de erro de idempotência ──────────────────────────────────────────
exports.IDEM_CODES = {
    CONFLICT: "IDEMPOTENCY_CONFLICT",
    PROCESSING: "IDEMPOTENCY_PROCESSING",
};
// ── Geração da chave de idempotência composta ─────────────────────────────────
function buildIdempKey(idempotencyKey, conversationId, functionName) {
    const raw = `${functionName}:${conversationId}:${idempotencyKey}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
}
// ── Validação da chave de idempotência ───────────────────────────────────────
function validateIdempotencyKey(key) {
    if (!key || typeof key !== "string") {
        return { ok: false, error: "Idempotency-Key é obrigatória." };
    }
    const trimmed = key.trim();
    if (trimmed.length === 0) {
        return { ok: false, error: "Idempotency-Key não pode ser vazia." };
    }
    if (trimmed.length > KEY_MAX_LEN) {
        return { ok: false, error: `Idempotency-Key excede ${KEY_MAX_LEN} caracteres.` };
    }
    if (/[\x00-\x1f\x7f]/.test(trimmed)) {
        return { ok: false, error: "Idempotency-Key contém caracteres de controle inválidos." };
    }
    return { ok: true, key: trimmed };
}
// ── Hash canônico do payload ─────────────────────────────────────────────────
function canonicalize(value) {
    if (value === null || value === undefined)
        return value;
    if (typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map(canonicalize);
    const obj = value;
    return Object.keys(obj)
        .sort()
        .reduce((acc, k) => {
        acc[k] = canonicalize(obj[k]);
        return acc;
    }, {});
}
function buildPayloadHash(payload) {
    // Exclui campos de contexto/auth já representados no escopo composto da chave
    const { conversationId: _c, agentId: _a, organizationId: _o, channelPhone: _p, ...relevant } = payload;
    void _c;
    void _a;
    void _o;
    void _p;
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(canonicalize(relevant)))
        .digest("hex");
}
// ── HTTP status a partir do resultado ────────────────────────────────────────
function idempotencyHttpStatus(result, defaultError = 500) {
    if (result.success)
        return 200;
    switch (result.error?.code) {
        case exports.IDEM_CODES.CONFLICT: return 409;
        case exports.IDEM_CODES.PROCESSING: return 423;
        default: return defaultError;
    }
}
// ── Sanitização para persistência no Firestore ────────────────────────────────
function toPersistableResult(value) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error("Idempotency result is not JSON-serializable.");
    }
    return JSON.parse(serialized);
}
// ── Wrapper de idempotência ───────────────────────────────────────────────────
/**
 * Executa fn() com garantia de idempotência.
 *
 * Quando a mesma chave é recebida:
 *  - "processing": retorna erro IDEMPOTENCY_PROCESSING (HTTP 423 no caller)
 *  - "done" + mesmo payloadHash: retorna resultado cacheado + X-Idempotent-Replay
 *  - "done" + payloadHash diferente: retorna IDEMPOTENCY_CONFLICT (HTTP 409 no caller)
 *
 * Se fn() lançar exceção, o placeholder é deletado — permitindo retry.
 */
async function withIdempotency(opts, fn, res) {
    const { idempotencyKey, conversationId, functionName, payloadHash } = opts;
    // Sem chave de idempotência — executa sem garantia (legado)
    if (!idempotencyKey)
        return fn();
    const db = admin.firestore();
    const docKey = buildIdempKey(idempotencyKey, conversationId, functionName);
    const ref = db.collection(IDEM_COL).doc(docKey);
    const now = Date.now();
    const placeholder = {
        status: "processing",
        functionName,
        conversationId,
        payloadHash: payloadHash ?? null,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + TTL_MS,
        result: null,
    };
    try {
        // ref.create() é atômica: falha se o doc já existir (ALREADY_EXISTS)
        await ref.create(placeholder);
    }
    catch (_createErr) {
        const snap = await ref.get();
        if (snap.exists) {
            const data = snap.data();
            // Expirado: apagar e reiniciar
            if (data.expiresAt <= now) {
                await ref.delete();
                return withIdempotency({ idempotencyKey, conversationId, functionName, payloadHash }, fn, res);
            }
            // Em processamento por outra instância (HTTP 423)
            if (data.status === "processing") {
                return {
                    success: false,
                    error: {
                        code: exports.IDEM_CODES.PROCESSING,
                        message: "Operação em andamento. Tente novamente em instantes.",
                    },
                };
            }
            // Resultado anterior disponível — verificar payload hash (HTTP 409 se divergente)
            if (payloadHash && data.payloadHash && data.payloadHash !== payloadHash) {
                return {
                    success: false,
                    error: {
                        code: exports.IDEM_CODES.CONFLICT,
                        message: "Idempotency-Key já utilizada com payload diferente.",
                    },
                };
            }
            // Replay bem-sucedido — retornar resultado anterior com header
            if (res)
                res.set("X-Idempotent-Replay", "true");
            const previous = data.result;
            return {
                ...previous,
                warnings: [
                    ...(previous?.warnings ?? []),
                    "IDEMPOTENT_REPLAY: resultado retornado de execução anterior.",
                ],
            };
        }
        // Doc sumiu entre create e get (raro) — executa sem garantia
    }
    // Somos os detentores da reserva — executar a função
    let result;
    try {
        result = await fn();
    }
    catch (fnErr) {
        // Limpar placeholder para permitir retry
        await ref.delete().catch(() => undefined);
        throw fnErr;
    }
    // Persistir resultado no placeholder
    const persistableResult = toPersistableResult(result);
    await ref.set({
        status: "done",
        functionName,
        conversationId,
        payloadHash: payloadHash ?? null,
        createdAt: now,
        updatedAt: Date.now(),
        expiresAt: now + TTL_MS,
        result: persistableResult,
    });
    return result;
}
// ── Extração do Idempotency-Key do header ─────────────────────────────────────
function extractIdempotencyKey(req) {
    const header = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
    if (!header)
        return undefined;
    return Array.isArray(header) ? header[0] : header;
}
//# sourceMappingURL=idempotency.js.map