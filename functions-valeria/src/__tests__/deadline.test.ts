/**
 * deadline.test.ts — testes do motor de prazo (sprint P0.2, P0.35).
 *
 * Cobertura real hoje: P1 (sem dados → não inventa) e P6 (motor sem
 * confiança → humano) — os únicos estados alcançáveis com a auditoria
 * atual (nenhuma fonte de capacidade configurada no ERP). P2-P5 (prazo
 * padrão disponível / encaixe possível-impossível) ficam pendentes até
 * o ERP ganhar uma fonte real — documentado explicitamente, não fingido.
 */
import { estimateProductionDeadline, checkUrgentFit } from "../deadline";

describe("DEADLINE — estimateProductionDeadline", () => {
  test("P1. Sem fonte de capacidade configurada → canEstimate:false, nunca inventa número", () => {
    const r = estimateProductionDeadline({ produto: "Caixa", areaTotalM2: 1.2, quantidade: 1 });
    expect(r.canEstimate).toBe(false);
    expect(r.productionDays).toBeNull();
    expect(r.estimatedDate).toBeNull();
    expect(r.requiresHuman).toBe(true);
  });

  test("P6. confidence sempre 'none' quando o motor não tem fonte real (nunca 'high' fabricado)", () => {
    const r = estimateProductionDeadline({ produto: "Troféu" });
    expect(r.confidence).toBe("none");
  });

  test("Nunca retorna productionDays numérico sem canEstimate:true (invariante de segurança)", () => {
    const r = estimateProductionDeadline({ produto: "Qualquer" });
    if (!r.canEstimate) expect(r.productionDays).toBeNull();
  });
});

describe("DEADLINE — checkUrgentFit", () => {
  test("P4/P5. Sem fonte de capacidade → feasible sempre false, requiresHuman true (nunca confirma antecipação sem base real)", () => {
    const r = checkUrgentFit({ produto: "Caixa", requestedDateISO: "2026-08-27" });
    expect(r.feasible).toBe(false);
    expect(r.requiresHuman).toBe(true);
    expect(r.reasonCode).toBe("PRODUCTION_EXCEPTION");
  });

  test("earliestDate nunca é fabricado quando feasible=false e não há fonte real", () => {
    const r = checkUrgentFit({ produto: "Caixa", requestedDateISO: "2026-08-27" });
    expect(r.earliestDate).toBeNull();
  });
});
