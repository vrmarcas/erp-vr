/**
 * active_pilot_send_ledger.ts — ValerIA 2.0, Fase E.2.13 (2026-09-21).
 *
 * Duas responsabilidades, as duas só de I/O (nenhuma decisão de negócio):
 *
 * 1. Idempotência do ENVIO — `valeria_active_pilot_sends/{idempotencyKey}`,
 *    reservado com `.create()` (mesmo padrão atômico de idempotency.ts:
 *    só uma execução concorrente consegue criar o doc; as demais leem o
 *    estado já reservado). Estados: PENDING (reservado, envio em curso) →
 *    SENT (confirmado) ou FAILED (não confirmado — permite nova tentativa
 *    futura, nunca automática dentro da mesma chamada). Uma key já SENT
 *    NUNCA é reenviada.
 *
 * 2. Guarda anti-loop — `valeria_active_pilot_sent_message_ids/{messageId}`
 *    grava o id que o PRÓPRIO ChatVolt devolveu para uma mensagem que NÓS
 *    enviamos (chatvolt_send_adapter.ts). Se um evento de webhook chegar
 *    referenciando esse mesmo id, é eco da nossa própria escrita — nunca
 *    tratar como novo inbound (desenho já documentado em
 *    VALERIA_FASE_E2_6, seção 7, agora implementado). Necessário porque a
 *    doc do endpoint de envio afirma que a mensagem enviada aparece
 *    SEMPRE como `from:"human"` no histórico — o campo `from` sozinho não
 *    distingue "nosso backend" de "cliente real".
 */
import * as admin from "firebase-admin";

const SENDS_COL = "valeria_active_pilot_sends";
const SENT_IDS_COL = "valeria_active_pilot_sent_message_ids";

export type SendState = "PENDING" | "SENT" | "FAILED";

export interface SendLedgerEntry {
  idempotencyKey: string;
  conversationId: string;
  status: SendState;
  sentMessageId: string | null;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Decisão pura: dado o estado atual (ou ausência dele), pode enviar agora? Nunca reenvia SENT nem colide com um PENDING já em curso. */
export function canAttemptSend(existing: SendLedgerEntry | null): boolean {
  if (!existing) return true;
  return existing.status === "FAILED";
}

export async function getSendState(idempotencyKey: string): Promise<SendLedgerEntry | null> {
  const snap = await admin.firestore().collection(SENDS_COL).doc(idempotencyKey).get();
  return snap.exists ? (snap.data() as SendLedgerEntry) : null;
}

/**
 * Reserva atômica via `.create()` — só o primeiro chamador concorrente
 * consegue reservar; os demais recebem `ALREADY_EXISTS` (tratado pelo
 * chamador via getSendState antes de chegar aqui, mesmo padrão de
 * idempotency.ts).
 */
export async function reservePending(idempotencyKey: string, conversationId: string): Promise<void> {
  const now = Date.now();
  await admin
    .firestore()
    .collection(SENDS_COL)
    .doc(idempotencyKey)
    .set(
      { idempotencyKey, conversationId, status: "PENDING", sentMessageId: null, reason: null, createdAt: now, updatedAt: now },
      { merge: false }
    );
}

export async function markSent(idempotencyKey: string, sentMessageId: string): Promise<void> {
  const now = Date.now();
  await admin.firestore().collection(SENDS_COL).doc(idempotencyKey).set(
    { status: "SENT", sentMessageId, reason: null, updatedAt: now },
    { merge: true }
  );
  // Índice reverso — permite ao webhook checar "esse messageId chegou como inbound é eco nosso?" em O(1).
  await admin
    .firestore()
    .collection(SENT_IDS_COL)
    .doc(sentMessageId)
    .set({ idempotencyKey, conversationId: null, at: now }, { merge: false });
}

export async function markFailed(idempotencyKey: string, reason: string): Promise<void> {
  const now = Date.now();
  await admin.firestore().collection(SENDS_COL).doc(idempotencyKey).set(
    { status: "FAILED", sentMessageId: null, reason, updatedAt: now },
    { merge: true }
  );
}

/** Guarda anti-loop — true quando este messageId é uma mensagem que O PRÓPRIO backend enviou (nunca reprocessar como inbound novo). */
export async function wasSentByBackend(messageId: string | null | undefined): Promise<boolean> {
  if (!messageId) return false;
  const snap = await admin.firestore().collection(SENT_IDS_COL).doc(messageId).get();
  return snap.exists;
}
