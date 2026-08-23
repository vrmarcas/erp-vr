import { mergeTechnicalBriefing } from "../technical_briefing_store";
import { emptyTechnicalBriefing } from "../technical_briefing";

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
