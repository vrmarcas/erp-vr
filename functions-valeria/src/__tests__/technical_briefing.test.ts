/**
 * technical_briefing.test.ts — sprint P0.3, Bloco A6 (testes de unidade
 * obrigatórios) + A3 (material canônico) + A5 (readiness técnico).
 */
import {
  parseFlexibleLength,
  resolveMaterialId,
  computeTechnicalReadiness,
  toQuoteCoreInput,
  emptyTechnicalBriefing,
} from "../technical_briefing";

describe("A6 — parseFlexibleLength (conversão de unidade)", () => {
  test("'15 cm' = 150 mm", () => expect(parseFlexibleLength("15 cm")).toBe(150));
  test("'15cm' (sem espaço) = 150 mm", () => expect(parseFlexibleLength("15cm")).toBe(150));
  test("'150 mm' = 150 mm", () => expect(parseFlexibleLength("150 mm")).toBe(150));
  test("'0,15 m' = 150 mm", () => expect(parseFlexibleLength("0,15 m")).toBe(150));
  test("'0.15m' = 150 mm", () => expect(parseFlexibleLength("0.15m")).toBe(150));
  test("number puro (sem unidade) é tratado como mm", () => expect(parseFlexibleLength(150)).toBe(150));
  test("string sem unidade é tratada como mm", () => expect(parseFlexibleLength("150")).toBe(150));
  test("repetir a mesma medida em unidades diferentes não gera conflito falso", () => {
    expect(parseFlexibleLength("15cm")).toBe(parseFlexibleLength("150mm"));
    expect(parseFlexibleLength("0.15m")).toBe(parseFlexibleLength("15cm"));
  });
  test("entrada inválida retorna null, nunca NaN/0 silencioso", () => {
    expect(parseFlexibleLength("abc")).toBeNull();
    expect(parseFlexibleLength(null)).toBeNull();
    expect(parseFlexibleLength(undefined)).toBeNull();
    expect(parseFlexibleLength("")).toBeNull();
  });
});

describe("A3 — resolveMaterialId (material canônico)", () => {
  const materiais = [
    { matKey: "cfg_0", nome: "Acrílico Cristal 3mm" },
    { matKey: "cfg_1", nome: "Acrílico Cristal 5mm" },
    { matKey: "cfg_2", nome: "Acrílico Preto 3mm" },
  ];

  test("matKey já válido é aceito diretamente", () => {
    expect(resolveMaterialId("cfg_1", materiais)).toBe("cfg_1");
  });
  test("nome exato resolve para o matKey certo", () => {
    expect(resolveMaterialId("Acrílico Cristal 3mm", materiais)).toBe("cfg_0");
  });
  test("nome exato case-insensitive", () => {
    expect(resolveMaterialId("acrílico cristal 5mm", materiais)).toBe("cfg_1");
  });
  test("match parcial inequívoco resolve", () => {
    expect(resolveMaterialId("Preto", materiais)).toBe("cfg_2");
  });
  test("match parcial ambíguo (bate em mais de um) NUNCA aproxima — retorna null", () => {
    expect(resolveMaterialId("Acrílico Cristal", materiais)).toBeNull();
  });
  test("material inexistente retorna null, nunca inventa", () => {
    expect(resolveMaterialId("Vidro Temperado", materiais)).toBeNull();
  });
});

describe("A5 — computeTechnicalReadiness", () => {
  test("briefing vazio → not ready, todos os campos faltando", () => {
    const r = computeTechnicalReadiness(emptyTechnicalBriefing());
    expect(r.ready).toBe(false);
    expect(r.missingRequiredFields).toEqual(
      expect.arrayContaining(["productId", "larguraMm", "alturaMm", "thicknessMm", "materialId", "quantity"])
    );
  });

  test("produto dim3d (Caixa) sem profundidadeMm → profundidadeMm em missingRequiredFields", () => {
    const b = {
      ...emptyTechnicalBriefing(),
      productId: "Caixa",
      dimensions: { larguraMm: 150, alturaMm: 150, profundidadeMm: null },
      thicknessMm: 3, materialId: "cfg_0", quantity: 1,
    };
    const r = computeTechnicalReadiness(b);
    expect(r.reconhecido).toBe(true);
    expect(r.missingRequiredFields).toContain("profundidadeMm");
  });

  test("produto plano (Porta tablet, dim3d=false) não exige profundidadeMm", () => {
    const b = {
      ...emptyTechnicalBriefing(),
      productId: "Porta tablet",
      dimensions: { larguraMm: 200, alturaMm: 150, profundidadeMm: null },
      thicknessMm: 3, materialId: "cfg_0", quantity: 1,
    };
    const r = computeTechnicalReadiness(b);
    expect(r.missingRequiredFields).not.toContain("profundidadeMm");
    expect(r.ready).toBe(true);
  });

  test("todos os campos presentes (produto dim3d) → ready=true", () => {
    const b = {
      ...emptyTechnicalBriefing(),
      productId: "Caixa",
      dimensions: { larguraMm: 150, alturaMm: 150, profundidadeMm: 150 },
      thicknessMm: 3, materialId: "cfg_0", quantity: 1,
    };
    expect(computeTechnicalReadiness(b).ready).toBe(true);
  });

  test("produto não reconhecido (fora de PLAN_RECIPES) — reconhecido=false, mas ainda pode calcular como peça plana", () => {
    const b = {
      ...emptyTechnicalBriefing(),
      productId: "Placa Genérica XYZ",
      dimensions: { larguraMm: 200, alturaMm: 300, profundidadeMm: null },
      thicknessMm: 3, materialId: "cfg_0", quantity: 1,
    };
    const r = computeTechnicalReadiness(b);
    expect(r.reconhecido).toBe(false);
    expect(r.ready).toBe(true); // peça plana não exige profundidade
  });
});

describe("A4 — toQuoteCoreInput (adaptador mm→cm, único ponto de conversão)", () => {
  test("converte mm para cm corretamente (150mm → 15cm)", () => {
    const b = {
      ...emptyTechnicalBriefing(),
      productId: "Caixa",
      dimensions: { larguraMm: 150, alturaMm: 150, profundidadeMm: 150 },
      thicknessMm: 3, materialId: "cfg_0", quantity: 1,
    };
    const out = toQuoteCoreInput(b);
    expect(out).toEqual({ produto: "Caixa", larg: 15, alt: 15, prof: 15, esp: 3, matKey: "cfg_0", qty: 1 });
  });

  test("retorna null se briefing não está pronto (nunca chama o core com dado incompleto)", () => {
    expect(toQuoteCoreInput(emptyTechnicalBriefing())).toBeNull();
  });

  test("produto plano: prof fica undefined (não 0), nunca falso obrigatório", () => {
    const b = {
      ...emptyTechnicalBriefing(),
      productId: "Porta tablet",
      dimensions: { larguraMm: 200, alturaMm: 150, profundidadeMm: null },
      thicknessMm: 3, materialId: "cfg_0", quantity: 1,
    };
    const out = toQuoteCoreInput(b);
    expect(out?.prof).toBeUndefined();
  });
});
