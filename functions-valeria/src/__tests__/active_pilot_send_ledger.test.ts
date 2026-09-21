import { canAttemptSend, type SendLedgerEntry } from "../active_pilot_send_ledger";

function entry(status: SendLedgerEntry["status"], overrides: Partial<SendLedgerEntry> = {}): SendLedgerEntry {
  return {
    idempotencyKey: "k1",
    conversationId: "c1",
    status,
    sentMessageId: null,
    reason: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("canAttemptSend — decisão pura de idempotência do envio (Fase E.2.13)", () => {
  test("sem registro anterior → pode tentar enviar", () => {
    expect(canAttemptSend(null)).toBe(true);
  });

  test("registro SENT → nunca reenviar", () => {
    expect(canAttemptSend(entry("SENT", { sentMessageId: "m1" }))).toBe(false);
  });

  test("registro PENDING (outra execução em curso) → não tentar de novo nesta chamada", () => {
    expect(canAttemptSend(entry("PENDING"))).toBe(false);
  });

  test("registro FAILED → pode tentar novamente", () => {
    expect(canAttemptSend(entry("FAILED", { reason: "SEND_ERROR" }))).toBe(true);
  });
});
