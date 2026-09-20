/**
 * custom_briefing_patch.test.ts — ValerIA 2.0, Fase C.1 (2026-09-19).
 * D. personalizado com informação parcial → TechnicalBriefing recebe
 * exatamente os campos informados, nunca inventa o que falta.
 */
import { buildCustomTechnicalBriefingPatch } from "../custom_briefing_patch";

describe("buildCustomTechnicalBriefingPatch", () => {
  test("sempre preserva baseCatalogGroupId/baseProductId/baseProductSku, mesmo todos null", () => {
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: "caixa_tampa_de_correr",
      baseProductId: "C4TC3M",
      baseProductSku: "C4TC3M",
      receitaProductId: null,
      quantity: null,
      customDimensions: null,
      espessuraPadraoMmDoGrupo: null,
      thicknessMmAtual: null,
    });
    expect(patch.baseCatalogGroupId).toBe("caixa_tampa_de_correr");
    expect(patch.baseProductId).toBe("C4TC3M");
    expect(patch.baseProductSku).toBe("C4TC3M");
  });

  test("D. informação parcial (só quantidade) → só quantity no patch, dimensions/thicknessMm ausentes", () => {
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: null,
      baseProductId: null,
      baseProductSku: null,
      receitaProductId: "Caixa",
      quantity: 20,
      customDimensions: null,
      espessuraPadraoMmDoGrupo: null,
      thicknessMmAtual: null,
    });
    expect(patch.quantity).toBe(20);
    expect(patch.dimensions).toBeUndefined();
    expect(patch.thicknessMm).toBeUndefined();
    expect(patch.productId).toBe("Caixa");
  });

  test("converte customDimensions de CM para MM corretamente (35x25x10cm -> 350/250/100mm)", () => {
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: null,
      baseProductId: null,
      baseProductSku: null,
      receitaProductId: null,
      quantity: null,
      customDimensions: { larguraCm: 35, alturaCm: 25, profundidadeCm: 10 },
      espessuraPadraoMmDoGrupo: null,
      thicknessMmAtual: null,
    });
    expect(patch.dimensions).toEqual({ larguraMm: 350, alturaMm: 250, profundidadeMm: 100 });
  });

  test("espessura padrão do grupo só entra quando o briefing ainda não tem nenhuma (nunca sobrescreve o cliente)", () => {
    const semThicknessAtual = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: null,
      baseProductId: null,
      baseProductSku: null,
      receitaProductId: null,
      quantity: null,
      customDimensions: null,
      espessuraPadraoMmDoGrupo: 4,
      thicknessMmAtual: null,
    });
    expect(semThicknessAtual.thicknessMm).toBe(4);

    const comThicknessJaInformada = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: null,
      baseProductId: null,
      baseProductSku: null,
      receitaProductId: null,
      quantity: null,
      customDimensions: null,
      espessuraPadraoMmDoGrupo: 4,
      thicknessMmAtual: 6, // cliente já informou 6mm — default do grupo (4mm) NUNCA sobrescreve
    });
    expect(comThicknessJaInformada.thicknessMm).toBeUndefined();
  });

  test("sem quantity/dimensions/receita → patch mínimo, sem inventar nenhum campo técnico", () => {
    const patch = buildCustomTechnicalBriefingPatch({
      baseCatalogGroupId: "caixa_tampa_de_correr",
      baseProductId: null,
      baseProductSku: null,
      receitaProductId: null,
      quantity: null,
      customDimensions: null,
      espessuraPadraoMmDoGrupo: null,
      thicknessMmAtual: null,
    });
    expect(Object.keys(patch).sort()).toEqual(["baseCatalogGroupId", "baseProductId", "baseProductSku"]);
  });
});
