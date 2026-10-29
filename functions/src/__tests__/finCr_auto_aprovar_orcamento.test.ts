/**
 * finCr_auto_aprovar_orcamento.test.ts — "Operação Valéria", revisão de
 * segurança (2026-10-29).
 *
 * Achado real: `finCrAutoAprovarOrcamento` aceitava `orcId`/`valor` do
 * cliente sem nenhuma validação server-side contra o estado real de
 * `erp_vr/orcamentos` — um comercial podia criar Conta a Receber para
 * um orçamento inexistente, não aprovado, de origem Valéria sem revisão,
 * ou com valor fabricado. admin.firestore() sempre mockado (fake em
 * memória) — nunca Firestore real.
 */
type Store = Record<string, { data?: string; ts?: number } | undefined>;
const store: Store = {};

function keyFor(col: string, id: string): string {
  return `${col}/${id}`;
}

jest.mock("firebase-admin", () => ({
  firestore: () => ({
    collection: (col: string) => ({
      doc: (id: string) => ({ __col: col, __id: id }),
    }),
    runTransaction: async (fn: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        get: async (ref: { __col: string; __id: string }) => {
          const k = keyFor(ref.__col, ref.__id);
          const d = store[k];
          return { exists: !!d, data: () => d };
        },
        set: (ref: { __col: string; __id: string }, data: { data: string; ts: number }) => {
          store[keyFor(ref.__col, ref.__id)] = data;
        },
      };
      return fn(txn);
    },
  }),
}));

jest.mock("./../auth_helper", () => ({
  getCallerVerificado: jest.fn(async (context: { auth?: { uid: string; token?: { role?: string } } }) => {
    if (!context.auth) throw { code: "unauthenticated", message: "Autenticação obrigatória." };
    return { uid: context.auth.uid, role: context.auth.token?.role };
  }),
  requireRole: jest.fn(),
  parseDoc: jest.fn((snap: { exists: boolean; data: () => { data?: string } | undefined }, dflt: unknown) => {
    if (!snap.exists) return dflt;
    const raw = snap.data()?.data;
    if (typeof raw !== "string") return dflt;
    try { return JSON.parse(raw); } catch { return dflt; }
  }),
  writeAudit: jest.fn(async () => {}),
  CallerVerificado: {},
}));

jest.mock("firebase-functions", () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { https: { onCall: (fn: unknown) => ({ run: fn }), HttpsError }, logger: { error: jest.fn() } };
});

import { finCrAutoAprovarOrcamento } from "../finCr";

function seedOrcamentos(arr: unknown[]): void {
  store["erp_vr/orcamentos"] = { data: JSON.stringify(arr), ts: Date.now() };
}
function seedRevisao(atendimentoId: string, status: string): void {
  store[`valeria_pre_orcamentos_revisao/${atendimentoId}`] = { data: JSON.stringify({ status }), ts: Date.now() } as never;
  // valeria_pre_orcamentos_revisao não usa o formato {data: JSON string} — grava direto os campos.
  store[`valeria_pre_orcamentos_revisao/${atendimentoId}`] = { status } as never;
}
function readFinCr(): Array<{ id: string; orcamentoId: string; valor: number }> {
  const raw = store["erp_vr/fin_cr"];
  return raw?.data ? JSON.parse(raw.data) : [];
}
const caller = { auth: { uid: "u1", token: { role: "comercial" } } };

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe("finCrAutoAprovarOrcamento — validação server-side contra erp_vr/orcamentos", () => {
  test("orcId inexistente — rejeitado, nunca cria Conta a Receber", async () => {
    await expect((finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "nao_existe", valor: 999999 }, caller)).rejects.toMatchObject({ code: "not-found" });
    expect(readFinCr()).toEqual([]);
  });

  test("orçamento existe mas NÃO está aprovado — rejeitado, nunca confia no status implícito da chamada", async () => {
    seedOrcamentos([{ id: "o1", status: "aguardando_cliente", total: 500 }]);
    await expect((finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o1", valor: 999999 }, caller)).rejects.toMatchObject({ code: "failed-precondition" });
    expect(readFinCr()).toEqual([]);
  });

  test("valor fabricado pelo cliente é IGNORADO — usa sempre o total real do orçamento", async () => {
    seedOrcamentos([{ id: "o2", status: "aprovado", total: 150 }]);
    const r = await (finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o2", valor: 999999999, cliente: "Teste", numOrc: "2" }, caller);
    expect(r.ok).toBe(true);
    const cr = readFinCr();
    expect(cr[0].valor).toBe(150); // nunca 999999999.
  });

  test("origem Valéria SEM revisão concluída — rejeitado mesmo com status já 'aprovado' no blob", async () => {
    seedOrcamentos([{ id: "o3", status: "aprovado", total: 300, nomeCliente: "Cliente Valéria", conversationId: "atd_x" }]);
    seedRevisao("atd_x", "EM_REVISAO");
    await expect((finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o3", valor: 300 }, caller)).rejects.toMatchObject({ code: "failed-precondition" });
    expect(readFinCr()).toEqual([]);
  });

  test("origem Valéria COM revisão REVISADA — aceito normalmente", async () => {
    seedOrcamentos([{ id: "o4", status: "aprovado", total: 400, nomeCliente: "Cliente Valéria", conversationId: "atd_y" }]);
    seedRevisao("atd_y", "REVISADO");
    const r = await (finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o4", valor: 400, numOrc: "4" }, caller);
    expect(r.ok).toBe(true);
    expect(readFinCr()[0].valor).toBe(400);
  });

  test("orçamento comum (nunca origem Valéria) aprovado — nunca exige revisão, aceito direto", async () => {
    seedOrcamentos([{ id: "o5", status: "aprovado", total: 70 }]); // sem n/nomeCliente.
    const r = await (finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o5", valor: 70, numOrc: "5" }, caller);
    expect(r.ok).toBe(true);
  });

  test("idempotência — repetir a mesma chamada (mesmo crId) nunca cria uma 2ª Conta a Receber", async () => {
    seedOrcamentos([{ id: "o6", status: "aprovado", total: 90 }]);
    const r1 = await (finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o6", valor: 90, crId: "cr_fixo", numOrc: "6" }, caller);
    const r2 = await (finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o6", valor: 90, crId: "cr_fixo", numOrc: "6" }, caller);
    expect(r1.jaExistia).toBe(false);
    expect(r2.jaExistia).toBe(true);
    expect(readFinCr().length).toBe(1);
  });

  test("corrida cliente↔Function (achado real): orçamento só aparece 'aprovado' na 2ª tentativa — retry absorve, nunca rejeita uma aprovação genuína", async () => {
    seedOrcamentos([{ id: "o7", status: "aguardando_cliente", total: 60 }]); // ainda não propagou o status novo.
    setTimeout(() => seedOrcamentos([{ id: "o7", status: "aprovado", total: 60 }]), 50); // simula a escrita do client "chegando" durante o retry.
    const r = await (finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o7", valor: 60, numOrc: "7" }, caller);
    expect(r.ok).toBe(true);
    expect(readFinCr()[0].valor).toBe(60);
  }, 10000);

  test("corrida nunca vira bypass: se o orçamento NUNCA fica aprovado, todas as tentativas falham", async () => {
    seedOrcamentos([{ id: "o8", status: "aguardando_cliente", total: 60 }]); // nunca muda.
    await expect((finCrAutoAprovarOrcamento as unknown as { run: Function }).run({ orcId: "o8", valor: 60 }, caller)).rejects.toMatchObject({ code: "failed-precondition" });
    expect(readFinCr()).toEqual([]);
  }, 10000);
});
