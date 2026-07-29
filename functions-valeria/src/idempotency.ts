/**
 * idempotency.ts — Garantia de idempotência via Firestore
 * v2.1: validação de chave, hash canônico de payload, 409 por conflito de
 * payload divergente, 423 por operação em andamento, header X-Idempotent-Replay.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import type { ApiResponse } from "./types";

const IDEM_COL  = "valeria_idem_keys";
const TTL_MS    = 24 * 60 * 60 * 1000; // 24 horas
const KEY_MAX_LEN = 256;

// ── Códigos de erro de idempotência ──────────────────────────────────────────

export const IDEM_CODES = {
  CONFLICT:   "IDEMPOTENCY_CONFLICT",
  PROCESSING: "IDEMPOTENCY_PROCESSING",
} as const;

// ── Geração da chave de idempotência composta ─────────────────────────────────

export function buildIdempKey(
  idempotencyKey: string,
  conversationId: string,
  functionName: string
): string {
  const raw = `${functionName}:${conversationId}:${idempotencyKey}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Validação da chave de idempotência ───────────────────────────────────────

export function validateIdempotencyKey(
  key: string | undefined
): { ok: true; key: string } | { ok: false; error: string } {
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

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = canonicalize(obj[k]);
      return acc;
    }, {});
}

export function buildPayloadHash(payload: Record<string, unknown>): string {
  // Exclui campos de contexto/auth já representados no escopo composto da chave
  const {
    conversationId: _c,
    agentId: _a,
    organizationId: _o,
    channelPhone: _p,
    ...relevant
  } = payload;
  void _c; void _a; void _o; void _p;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(relevant)))
    .digest("hex");
}

// ── HTTP status a partir do resultado ────────────────────────────────────────

export function idempotencyHttpStatus(
  result: { success: boolean; error?: { code?: string } },
  defaultError = 500
): number {
  if (result.success) return 200;
  switch (result.error?.code) {
    case IDEM_CODES.CONFLICT:   return 409;
    case IDEM_CODES.PROCESSING: return 423;
    default: return defaultError;
  }
}

// ── Sanitização para persistência no Firestore ────────────────────────────────

function toPersistableResult<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Idempotency result is not JSON-serializable.");
  }
  return JSON.parse(serialized) as T;
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
export async function withIdempotency<T>(
  opts: {
    idempotencyKey: string | undefined;
    conversationId: string;
    functionName: string;
    payloadHash?: string;
  },
  fn: () => Promise<ApiResponse<T>>,
  res?: { set(name: string, value: string): unknown }
): Promise<ApiResponse<T>> {
  const { idempotencyKey, conversationId, functionName, payloadHash } = opts;

  // Sem chave de idempotência — executa sem garantia (legado)
  if (!idempotencyKey) return fn();

  const db     = admin.firestore();
  const docKey = buildIdempKey(idempotencyKey, conversationId, functionName);
  const ref    = db.collection(IDEM_COL).doc(docKey);
  const now    = Date.now();

  const placeholder = {
    status:        "processing" as const,
    functionName,
    conversationId,
    payloadHash:   payloadHash ?? null,
    createdAt:     now,
    updatedAt:     now,
    expiresAt:     now + TTL_MS,
    result:        null as unknown as ApiResponse<T>,
  };

  try {
    // ref.create() é atômica: falha se o doc já existir (ALREADY_EXISTS)
    await ref.create(placeholder);
  } catch (_createErr: unknown) {
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() as typeof placeholder;

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
            code:    IDEM_CODES.PROCESSING,
            message: "Operação em andamento. Tente novamente em instantes.",
          },
        } as unknown as ApiResponse<T>;
      }

      // Resultado anterior disponível — verificar payload hash (HTTP 409 se divergente)
      if (payloadHash && data.payloadHash && data.payloadHash !== payloadHash) {
        return {
          success: false,
          error: {
            code:    IDEM_CODES.CONFLICT,
            message: "Idempotency-Key já utilizada com payload diferente.",
          },
        } as unknown as ApiResponse<T>;
      }

      // Replay bem-sucedido — retornar resultado anterior com header
      if (res) res.set("X-Idempotent-Replay", "true");
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
  let result: ApiResponse<T>;
  try {
    result = await fn();
  } catch (fnErr) {
    // Limpar placeholder para permitir retry
    await ref.delete().catch(() => undefined);
    throw fnErr;
  }

  // Persistir resultado no placeholder
  const persistableResult = toPersistableResult(result);
  await ref.set({
    status:        "done",
    functionName,
    conversationId,
    payloadHash:   payloadHash ?? null,
    createdAt:     now,
    updatedAt:     Date.now(),
    expiresAt:     now + TTL_MS,
    result:        persistableResult,
  });

  return result;
}

// ── Extração do Idempotency-Key do header ─────────────────────────────────────

export function extractIdempotencyKey(
  req: { headers: Record<string, string | string[] | undefined> }
): string | undefined {
  const header =
    req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
  if (!header) return undefined;
  return Array.isArray(header) ? header[0] : header;
}
