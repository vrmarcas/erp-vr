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

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import type { ApiResponse } from "./types";

const IDEM_COL  = "valeria_idem_keys";
const TTL_MS    = 24 * 60 * 60 * 1000; // 24 horas

// ── Geração da chave de idempotência composta ─────────────────────────────────

export function buildIdempKey(
  idempotencyKey: string,
  conversationId: string,
  functionName: string
): string {
  const raw = `${functionName}:${conversationId}:${idempotencyKey}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Wrapper de idempotência ───────────────────────────────────────────────────

/**
 * Executa fn() com garantia de idempotência.
 * Se a chave já foi processada e não expirou, retorna o resultado anterior.
 * Se fn() lançar exceção, NÃO registra resultado (permitindo retry).
 */
export async function withIdempotency<T>(
  opts: {
    idempotencyKey: string | undefined;
    conversationId: string;
    functionName: string;
  },
  fn: () => Promise<ApiResponse<T>>
): Promise<ApiResponse<T>> {
  const { idempotencyKey, conversationId, functionName } = opts;

  // Sem chave de idempotência — executa sem garantia
  if (!idempotencyKey) return fn();

  const db      = admin.firestore();
  const docKey  = buildIdempKey(idempotencyKey, conversationId, functionName);
  const ref     = db.collection(IDEM_COL).doc(docKey);
  const now     = Date.now();

  // 1. Tentar reservar atomicamente via create() — falha se o doc já existir.
  //    Isso elimina a race condition: apenas uma requisição consegue criar o
  //    placeholder; as demais lêem o resultado já armazenado.
  const placeholder = {
    status: "processing" as const,
    createdAt: now,
    expiresAt: now + TTL_MS,
    functionName,
    conversationId,
    result: null as unknown as ApiResponse<T>,
  };

  try {
    await ref.create(placeholder);
    // Somos os primeiros — executar a função
  } catch (createErr: unknown) {
    // Documento já existe (ALREADY_EXISTS) ou expirou
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() as typeof placeholder;
      // Se expirado, apagar e re-executar
      if (data.expiresAt <= now) {
        await ref.delete();
        // Recursão simples para recomeçar com doc limpo
        return withIdempotency({ idempotencyKey, conversationId, functionName }, fn);
      }
      // Em processamento por outra requisição (status: "processing")
      if (data.status === "processing") {
        return {
          success: false,
          warnings: ["IDEMPOTENT_PROCESSING: operação em andamento, tente novamente em instantes."],
        } as unknown as ApiResponse<T>;
      }
      // Resultado já disponível — retornar com warning
      const previous = data.result;
      return {
        ...previous,
        warnings: [
          ...(previous.warnings ?? []),
          "IDEMPOTENT_REPLAY: resultado retornado de execução anterior.",
        ],
      };
    }
    // Doc sumiu entre create e get (raro) — executar sem garantia
  }

  // 2. Executar a função (somos os detentores da reserva)
  let result: ApiResponse<T>;
  try {
    result = await fn();
  } catch (fnErr) {
    // Em caso de erro, remover o placeholder para permitir retry
    await ref.delete().catch(() => undefined);
    throw fnErr;
  }

  // 3. Atualizar o placeholder com o resultado real
  // BUG corrigido (Fase 0/1, achado pelo cenário 6 do E2E): ApiResponse
  // frequentemente carrega chaves com valor `undefined` (warnings,
  // missingFields, data.X opcionais) e o Firestore REJEITA o documento
  // inteiro — a operação de negócio já tinha rodado, mas o registro
  // idempotente falhava e o retry via "IDEMPOTENT_PROCESSING" travava a
  // chave. O round-trip JSON remove todos os undefined antes de persistir.
  const resultLimpo = JSON.parse(JSON.stringify(result)) as ApiResponse<T>;
  await ref.set({
    status: "done",
    result: resultLimpo,
    createdAt: now,
    expiresAt: now + TTL_MS,
    functionName,
    conversationId,
  });

  return result;
}

// ── Extração do Idempotency-Key do header ─────────────────────────────────────

export function extractIdempotencyKey(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const header = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
  if (!header) return undefined;
  return Array.isArray(header) ? header[0] : header;
}
