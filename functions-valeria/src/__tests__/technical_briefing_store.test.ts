import { mergeTechnicalBriefing } from "../technical_briefing_store";
import { emptyTechnicalBriefing } from "../technical_briefing";

// ── Mock Firestore (só para os testes de saveLastEligibleSimulation/etc,
// que dependem de admin.firestore() — mergeTechnicalBriefing acima é
// puro e não precisa disso, mas o import precisa vir antes do jest.mock). ──
jest.mock("firebase-admin", () => {
  const _data: Record<string, Record<string, unknown>> = {};
  const FieldValueDelete = Symbol("FieldValue.delete");
  return {
    apps: [true],
    initializeApp: jest.fn(),
    firestore: Object.assign(
      jest.fn(() => ({
        collection: (col: string) => ({
          doc: (id: string) => ({
            get: jest.fn(async () => {
              const key = `${col}/${id}`;
              const data = _data[key];
              return { exists: data !== undefined, data: () => data };
            }),
            set: jest.fn(async (value: Record<string, unknown>, opts?: { merge?: boolean }) => {
              const key = `${col}/${id}`;
              const prev = opts?.merge ? (_data[key] ?? {}) : {};
              const merged = { ...prev, ...value };
              for (const k of Object.keys(merged)) {
                if (merged[k] === FieldValueDelete) delete merged[k];
              }
              _data[key] = merged;
            }),
          }),
        }),
      })),
      { FieldValue: { delete: () => FieldValueDelete } }
    ),
  };
});

import {
  saveLastEligibleSimulation,
  loadLastEligibleSimulation,
  clearLastEligibleSimulation,
} from "../technical_briefing_store";

describe("mergeTechnicalBriefing — merge progressivo", () => {
  test("patch parcial não apaga campos já confirmados que não vieram no patch", () => {
    const atual = { ...emptyTechnicalBriefing(), productId: "Caixa", quantity: 1 };
    const out = mergeTechnicalBriefing(atual, { materialId: "cfg_0" });
    expect(out.productId).toBe("Caixa");
    expect(out.quantity).toBe(1);
    expect(out.materialId).toBe("cfg_0");
  });

  test("dimensions faz merge campo a campo, não substitui o objeto inteiro", () => {
    const atual = { ...emptyTechnicalBriefing(), dimensions: { larguraMm: 150, alturaMm: null, profundidadeMm: null } };
    const out = mergeTechnicalBriefing(atual, { dimensions: { larguraMm: undefined as any, alturaMm: 200, profundidadeMm: undefined as any } });
    expect(out.dimensions.larguraMm).toBe(150); // preservado
    expect(out.dimensions.alturaMm).toBe(200);  // atualizado
  });

  test("missingRequiredFields e confirmedFields são recalculados após o merge", () => {
    const atual = emptyTechnicalBriefing();
    const out = mergeTechnicalBriefing(atual, {
      productId: "Porta tablet", dimensions: { larguraMm: 200, alturaMm: 150, profundidadeMm: undefined as any },
      thicknessMm: 3, materialId: "cfg_0", quantity: 1,
    });
    expect(out.missingRequiredFields).toEqual([]);
    expect(out.confirmedFields).toEqual(expect.arrayContaining(["productId", "larguraMm", "alturaMm", "thicknessMm", "materialId", "quantity"]));
  });
});

describe("P0.4/P0.5 — lastEligibleSimulation (simulationId NUNCA depende do LLM)", () => {
  const recA = { simulationId: "sim_A", createdAt: 1, productId: "Caixa", finalPrice: 47.57, fingerprint: "fp_caixa_v1" };
  const recB = { simulationId: "sim_B", createdAt: 2, productId: "Bandeja", finalPrice: 30, fingerprint: "fp_bandeja_v1" };

  test("S1 — save + load: o simulationId gravado no cálculo é exatamente o que volta na leitura", async () => {
    await saveLastEligibleSimulation("conv_1", recA);
    const lido = await loadLastEligibleSimulation("conv_1");
    expect(lido?.simulationId).toBe("sim_A");
    expect(lido?.fingerprint).toBe("fp_caixa_v1");
  });

  test("S3 — isolamento: conversa A e conversa B nunca leem a simulação uma da outra", async () => {
    await saveLastEligibleSimulation("conv_A", recA);
    await saveLastEligibleSimulation("conv_B", recB);
    const lidoA = await loadLastEligibleSimulation("conv_A");
    const lidoB = await loadLastEligibleSimulation("conv_B");
    expect(lidoA?.simulationId).toBe("sim_A");
    expect(lidoB?.simulationId).toBe("sim_B");
    expect(lidoA?.simulationId).not.toBe(lidoB?.simulationId);
  });

  test("S5 (base) — depois de consumida (clearLastEligibleSimulation), a conversa não tem mais simulação canônica disponível", async () => {
    await saveLastEligibleSimulation("conv_2", recA);
    expect(await loadLastEligibleSimulation("conv_2")).not.toBeNull();
    await clearLastEligibleSimulation("conv_2");
    expect(await loadLastEligibleSimulation("conv_2")).toBeNull();
  });

  test("conversa sem nenhum cálculo ainda → retorna null, nunca inventa uma simulação", async () => {
    expect(await loadLastEligibleSimulation("conv_nunca_calculou")).toBeNull();
  });

  test("um novo cálculo elegível SUBSTITUI a simulação canônica anterior (não acumula)", async () => {
    await saveLastEligibleSimulation("conv_3", recA);
    await saveLastEligibleSimulation("conv_3", { ...recA, simulationId: "sim_A2", fingerprint: "fp_caixa_v2" });
    const lido = await loadLastEligibleSimulation("conv_3");
    expect(lido?.simulationId).toBe("sim_A2");
  });
});
