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

import * as admin from "firebase-admin";
import type { Request } from "express";
import type { Response } from "express";
import { err } from "./response";

const RATE_COL         = "valeria_rate_limits";
const WINDOW_MS        = 60_000;          // 1 minuto
const LIMIT_GLOBAL     = 300;             // requisições por token / janela
const LIMIT_CONV       = 30;             // requisições por conversationId / janela
const MAX_PAYLOAD_BYTES = 256 * 1024;    // 256 KB

// ── Payload size guard ───────────────────────────────────────────────────────

export function checkPayloadSize(req: Request, res: Response): boolean {
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    res.status(413).json(
      err("PAYLOAD_TOO_LARGE", `Payload excede o limite de ${MAX_PAYLOAD_BYTES / 1024} KB.`)
    );
    return false;
  }
  // Também verificar o body já parseado (caso content-length não venha)
  const bodySize = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
  if (bodySize > MAX_PAYLOAD_BYTES) {
    res.status(413).json(
      err("PAYLOAD_TOO_LARGE", `Payload excede o limite de ${MAX_PAYLOAD_BYTES / 1024} KB.`)
    );
    return false;
  }
  return true;
}

// ── Sliding window counter ───────────────────────────────────────────────────

async function checkAndIncrement(key: string, limit: number): Promise<boolean> {
  const db  = admin.firestore();
  const ref = db.collection(RATE_COL).doc(key);
  const now = Date.now();

  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, { count: 1, windowStart: now, updatedAt: now });
      return true;
    }
    const data = snap.data() as { count: number; windowStart: number };
    const elapsed = now - data.windowStart;
    if (elapsed > WINDOW_MS) {
      // Nova janela
      tx.update(ref, { count: 1, windowStart: now, updatedAt: now });
      return true;
    }
    if (data.count >= limit) return false;
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
export async function checkRateLimit(
  req: Request,
  res: Response,
  opts: { tokenKey: string; conversationId?: string }
): Promise<boolean> {
  // 1. Payload size
  if (!checkPayloadSize(req, res)) return false;

  // 2. Limite global por token
  const globalOk = await checkAndIncrement(`token:${opts.tokenKey}`, LIMIT_GLOBAL);
  if (!globalOk) {
    res.status(429).set("Retry-After", String(WINDOW_MS / 1000)).json(
      err("RATE_LIMIT_EXCEEDED", `Limite de ${LIMIT_GLOBAL} requisições/minuto excedido.`, {
        communicableToCustomer: false,
      })
    );
    return false;
  }

  // 3. Limite por conversa
  if (opts.conversationId) {
    const convOk = await checkAndIncrement(`conv:${opts.conversationId}`, LIMIT_CONV);
    if (!convOk) {
      res.status(429).set("Retry-After", String(WINDOW_MS / 1000)).json(
        err("RATE_LIMIT_EXCEEDED", `Limite de ${LIMIT_CONV} requisições/minuto por conversa excedido.`, {
          communicableToCustomer: false,
        })
      );
      return false;
    }
  }

  return true;
}
