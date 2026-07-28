"use strict";
/**
 * idempotency.ts — Garantia de idempotência via Firestore
 *
 * Todas as operações de escrita devem passar por withIdempotency().
 * Se a mesma Idempotency-Key já foi processada, retorna o resultado
 * armazenado sem re-executar.
 *
 * TTL: 24 horas por padrão (configurável).
 * Chave composta: hash(Idempotency-Key + conversationId + functionName)
 * para evitar colisões entre funções diferentes.
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
exports.buildIdempKey = buildIdempKey;
exports.withIdempotency = withIdempotency;
exports.extractIdempotencyKey = extractIdempotencyKey;
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const IDEM_COL = "valeria_idem_keys";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
// ── Geração da chave de idempotência composta ─────────────────────────────────
function buildIdempKey(idempotencyKey, conversationId, functionName) {
    const raw = `${functionName}:${conversationId}:${idempotencyKey}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
}
// ── Wrapper de idempotência ───────────────────────────────────────────────────
/**
 * Executa fn() com garantia de idempotência.
 * Se a chave já foi processada e não expirou, retorna o resultado anterior.
 * Se fn() lançar exceção, NÃO registra resultado (permitindo retry).
 */
async function withIdempotency(opts, fn) {
    const { idempotencyKey, conversationId, functionName } = opts;
    // Sem chave de idempotência — executa sem garantia
    if (!idempotencyKey)
        return fn();
    const db = admin.firestore();
    const docKey = buildIdempKey(idempotencyKey, conversationId, functionName);
    const ref = db.collection(IDEM_COL).doc(docKey);
    const now = Date.now();
    // 1. Verificar se já existe resultado
    const existing = await ref.get();
    if (existing.exists) {
        const data = existing.data();
        if (data.expiresAt > now && data.functionName === functionName) {
            // Retorna resultado anterior com warning
            const previous = data.result;
            return {
                ...previous,
                warnings: [
                    ...(previous.warnings ?? []),
                    "IDEMPOTENT_REPLAY: resultado retornado de execução anterior.",
                ],
            };
        }
        // Expirado — pode re-executar
    }
    // 2. Executar a função
    const result = await fn();
    // 3. Armazenar apenas em caso de sucesso (não persiste erros transitórios)
    if (result.success) {
        await ref.set({
            result,
            createdAt: now,
            expiresAt: now + TTL_MS,
            functionName,
            conversationId,
        });
    }
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