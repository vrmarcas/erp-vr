/**
 * deadline.test.ts — testes do motor de prazo (sprint P0.2, P0.35;
 * Bloco E da sprint P0.3, 2026-08-23).
 *
 * Bloco E torna alcançável o caminho "capacidade configurada" (antes só
 * P1/P6 eram alcançáveis, por auditoria confirmar que não existia fonte
 * real nenhuma) — cobre agora: sem config → canEstimate:false (mantido);
 * com config real → estimativa V1 determinística a partir da fila REAL
 * de OS (nunca hardcoded); dias úteis pulam fim de semana.
 */

jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn(() => ({ value: () => "" })),
}));
jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((_opts: unknown, handler: unknown) => handler),
}));

const _firestoreData: Record<string, unknown> = {};
const firestoreFn = jest.fn(() => ({
  collection: (col: string) => ({
    doc: (id: string) => ({
      get: jest.fn(async () => {
        const data = col === "erp_vr" ? _firestoreData[id] : undefined;
        return { exists: data !== undefined, data: () => data };
      }),
    }),
  }),
}));
jest.mock("firebase-admin", () => ({
  apps: [true],
  initializeApp: jest.fn(),
  firestore: firestoreFn,
}));

import { estimateProductionDeadline, checkUrgentFit } from "../deadline";

function setConfig(producao?: { leadTimeBaseDias?: number; capacidadeOsPorDia?: number; bufferDias?: number }) {
  _firestoreData["erp_config"] = {
    data: JSON.stringify({
      financeiro: { overhead: 41.16, vrml: 20, impostos: 0 },
      ...(producao ? { producao } : {}),
    }),
  };
}

function setFila(statusList: string[]) {
  const kbOs: Record<string, unknown> = {};
  statusList.forEach((status, i) => { kbOs[`os_${i}`] = { id: `os_${i}`, status }; });
  _firestoreData["kb_os"] = { data: JSON.stringify(kbOs) };
}

beforeEach(() => {
  delete _firestoreData["erp_config"];
  delete _firestoreData["kb_os"];
});

describe("DEADLINE — estimateProductionDeadline (sem capacidade configurada)", () => {
  test("P1. Sem fonte de capacidade configurada → canEstimate:false, nunca inventa número", async () => {
    setConfig(undefined);
    const r = await estimateProductionDeadline({ produto: "Caixa", areaTotalM2: 1.2, quantidade: 1 });
    expect(r.canEstimate).toBe(false);
    expect(r.productionDays).toBeNull();
    expect(r.estimatedDate).toBeNull();
    expect(r.requiresHuman).toBe(true);
  });

  test("P6. confidence sempre 'none' quando o motor não tem fonte real (nunca 'high' fabricado)", async () => {
    setConfig(undefined);
    const r = await estimateProductionDeadline({ produto: "Troféu" });
    expect(r.confidence).toBe("none");
  });

  test("Config com campo zerado (leadTimeBaseDias=0) ainda é tratada como não configurada — nunca calcula com base 0", async () => {
    setConfig({ leadTimeBaseDias: 0, capacidadeOsPorDia: 5, bufferDias: 1 });
    const r = await estimateProductionDeadline({ produto: "Caixa" });
    expect(r.canEstimate).toBe(false);
  });

  test("capacidadeOsPorDia ausente → não configurada (nunca divide por zero/undefined)", async () => {
    setConfig({ leadTimeBaseDias: 3, bufferDias: 1 });
    const r = await estimateProductionDeadline({ produto: "Caixa" });
    expect(r.canEstimate).toBe(false);
  });
});

describe("DEADLINE — estimateProductionDeadline (com capacidade configurada, Bloco E)", () => {
  test("Fila vazia → productionDays = leadTimeBaseDias + bufferDias (0 dias de fila)", async () => {
    setConfig({ leadTimeBaseDias: 3, capacidadeOsPorDia: 5, bufferDias: 1 });
    setFila([]); // nenhuma OS ativa
    const r = await estimateProductionDeadline({ produto: "Caixa" });
    expect(r.canEstimate).toBe(true);
    expect(r.productionDays).toBe(4); // 3 + 0 + 1
    expect(r.confidence).toBe("low"); // V1 nunca reporta confiança alta
    expect(r.requiresHuman).toBe(false);
  });

  test("Fila real conta só OS com status ATIVO (pronta/entregue nunca contam)", async () => {
    setConfig({ leadTimeBaseDias: 2, capacidadeOsPorDia: 2, bufferDias: 0 });
    setFila(["producao", "aguardando_saldo", "iniciada", "pronta", "entregue"]); // 3 ativas, 2 concluídas
    const r = await estimateProductionDeadline({ produto: "Caixa" });
    // 3 ativas / capacidade 2 por dia = ceil(1.5) = 2 dias de fila
    expect(r.productionDays).toBe(4); // 2 + 2 + 0
    expect(r.reason).toContain("3 OS ativas");
  });

  test("Fila maior → prazo maior (nunca decrescente com mais fila)", async () => {
    setConfig({ leadTimeBaseDias: 2, capacidadeOsPorDia: 2, bufferDias: 0 });
    setFila(["producao", "producao"]);
    const rPouca = await estimateProductionDeadline({ produto: "Caixa" });
    setFila(["producao", "producao", "producao", "producao", "producao", "producao"]);
    const rMuita = await estimateProductionDeadline({ produto: "Caixa" });
    expect(rMuita.productionDays!).toBeGreaterThan(rPouca.productionDays!);
  });

  test("estimatedDate pula fim de semana (dias úteis reais, nunca conta sáb/dom)", async () => {
    setConfig({ leadTimeBaseDias: 10, capacidadeOsPorDia: 100, bufferDias: 0 });
    setFila([]);
    const r = await estimateProductionDeadline({ produto: "Caixa" });
    const data = new Date(r.estimatedDate + "T12:00:00Z");
    expect([0, 6]).not.toContain(data.getUTCDay()); // nunca cai em domingo(0) ou sábado(6)
  });
});

describe("DEADLINE — checkUrgentFit", () => {
  test("P4/P5. Sem fonte de capacidade → feasible sempre false, requiresHuman true", async () => {
    setConfig(undefined);
    const r = await checkUrgentFit({ produto: "Caixa", requestedDateISO: "2026-08-27" });
    expect(r.feasible).toBe(false);
    expect(r.requiresHuman).toBe(true);
    expect(r.reasonCode).toBe("PRODUCTION_EXCEPTION");
  });

  test("earliestDate nunca é fabricado quando feasible=false e não há fonte real", async () => {
    setConfig(undefined);
    const r = await checkUrgentFit({ produto: "Caixa", requestedDateISO: "2026-08-27" });
    expect(r.earliestDate).toBeNull();
  });

  test("Com capacidade configurada, data pedida ANTES do prazo mínimo → feasible:false", async () => {
    setConfig({ leadTimeBaseDias: 30, capacidadeOsPorDia: 1, bufferDias: 0 });
    setFila([]);
    const ontem = new Date();
    ontem.setDate(ontem.getDate() + 1); // amanhã — bem antes de 30 dias úteis de lead time
    const r = await checkUrgentFit({ produto: "Caixa", requestedDateISO: ontem.toISOString().slice(0, 10) });
    expect(r.feasible).toBe(false);
  });

  test("mesmo feasible:true ainda exige confirmação humana (V1 é baixa confiança, nunca promete sozinha)", async () => {
    setConfig({ leadTimeBaseDias: 1, capacidadeOsPorDia: 100, bufferDias: 0 });
    setFila([]);
    const dataFolgada = new Date();
    dataFolgada.setDate(dataFolgada.getDate() + 60);
    const r = await checkUrgentFit({ produto: "Caixa", requestedDateISO: dataFolgada.toISOString().slice(0, 10) });
    expect(r.feasible).toBe(true);
    expect(r.requiresHuman).toBe(true);
  });
});
