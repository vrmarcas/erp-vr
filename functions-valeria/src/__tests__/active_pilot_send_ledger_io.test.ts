/**
 * active_pilot_send_ledger_io.test.ts — ValerIA 2.0, Fase E.2.13.
 *
 * Testa a parte de I/O do ledger (mockando firebase-admin) — a decisão
 * pura já é coberta em active_pilot_send_ledger.test.ts.
 */
const _sends: Record<string, unknown> = {};
const _sentIds: Record<string, unknown> = {};

jest.mock("firebase-admin", () => ({
  firestore: () => ({
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: jest.fn(async () => {
          const store = col === "valeria_active_pilot_sends" ? _sends : _sentIds;
          return { exists: store[id] !== undefined, data: () => store[id] };
        }),
        set: jest.fn(async (d: unknown, opts?: { merge?: boolean }) => {
          const store = col === "valeria_active_pilot_sends" ? _sends : _sentIds;
          store[id] = opts?.merge ? { ...(store[id] as object ?? {}), ...(d as object) } : d;
        }),
      }),
    }),
  }),
}));

import { reservePending, markSent, markFailed, getSendState, wasSentByBackend } from "../active_pilot_send_ledger";

describe("active_pilot_send_ledger — I/O (Fase E.2.13)", () => {
  test("reservePending → getSendState reflete PENDING", async () => {
    await reservePending("k1", "conv1");
    const state = await getSendState("k1");
    expect(state?.status).toBe("PENDING");
    expect(state?.conversationId).toBe("conv1");
  });

  test("markSent grava sentMessageId no doc principal E no índice reverso", async () => {
    await reservePending("k2", "conv2");
    await markSent("k2", "msg_abc");
    const state = await getSendState("k2");
    expect(state?.status).toBe("SENT");
    expect(state?.sentMessageId).toBe("msg_abc");

    const isEcho = await wasSentByBackend("msg_abc");
    expect(isEcho).toBe(true);
  });

  test("wasSentByBackend(null/undefined) → false, nunca consulta Firestore desnecessariamente", async () => {
    expect(await wasSentByBackend(null)).toBe(false);
    expect(await wasSentByBackend(undefined)).toBe(false);
  });

  test("messageId nunca enviado por nós → wasSentByBackend=false", async () => {
    expect(await wasSentByBackend("msg_nunca_visto")).toBe(false);
  });

  test("markFailed grava status FAILED com motivo, sem sentMessageId", async () => {
    await reservePending("k3", "conv3");
    await markFailed("k3", "SEND_ERROR: timeout");
    const state = await getSendState("k3");
    expect(state?.status).toBe("FAILED");
    expect(state?.reason).toBe("SEND_ERROR: timeout");
    expect(state?.sentMessageId).toBeNull();
  });
});
