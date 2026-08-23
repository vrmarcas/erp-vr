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
  technicalBriefingFingerprint,
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

describe("A3 — resolveMaterialId com desambiguação por espessura (Bloco H, achado real de E2E)", () => {
  const familiaAmbigua = [
    { matKey: "cfg_0", nome: "Acrílico Cristal 2mm" },
    { matKey: "cfg_1", nome: "Acrílico Cristal 3mm" },
    { matKey: "cfg_2", nome: "Acrílico Cristal 5mm" },
    { matKey: "cfg_3", nome: "Acrílico Cristal 10mm" },
  ];

  test("nome ambíguo sozinho (sem espessura) continua null — mesma disciplina de nunca aproximar", () => {
    expect(resolveMaterialId("Acrílico Cristal", familiaAmbigua)).toBeNull();
  });

  test("nome ambíguo + espessura já informada (dado real) resolve para o matKey exato", () => {
    expect(resolveMaterialId("Acrílico Cristal", familiaAmbigua, 3)).toBe("cfg_1");
    expect(resolveMaterialId("Acrílico Cristal", familiaAmbigua, 10)).toBe("cfg_3");
  });

  test("espessura informada que não existe na família ainda retorna null (nunca aproxima pra vizinho)", () => {
    expect(resolveMaterialId("Acrílico Cristal", familiaAmbigua, 7)).toBeNull();
  });

  test("match já inequívoco por nome não é afetado por espessura contraditória (nome vence, espessura só desempata)", () => {
    const comUmPreto = [...familiaAmbigua, { matKey: "cfg_9", nome: "Acrílico Preto 3mm" }];
    expect(resolveMaterialId("Preto", comUmPreto, 999)).toBe("cfg_9");
  });
});

describe("A3 — resolveMaterialId ignora acento (achado real de E2E via Chatvolt, Bloco H)", () => {
  const materiaisComAcento = [
    { matKey: "cfg_0", nome: "Acrílico Cristal 2mm" },
    { matKey: "cfg_1", nome: "Acrílico Cristal 3mm" },
  ];

  test("LLM manda o texto sem acento ('acrilico cristal') + espessura — ainda resolve certo", () => {
    expect(resolveMaterialId("acrilico cristal", materiaisComAcento, 3)).toBe("cfg_1");
  });

  test("texto sem acento com espessura embutida ('acrilico cristal 3mm') resolve por match exato", () => {
    expect(resolveMaterialId("acrilico cristal 3mm", materiaisComAcento)).toBe("cfg_1");
  });

  test("nome cadastrado sem acento comparado com texto do cliente COM acento também resolve", () => {
    const materiaisSemAcento = [{ matKey: "cfg_5", nome: "Acrilico Preto 5mm" }];
    expect(resolveMaterialId("Acrílico Preto 5mm", materiaisSemAcento)).toBe("cfg_5");
  });

  test("LLM manda underscore no lugar de espaço ('acrilico_cristal') — achado real, ainda resolve com espessura", () => {
    expect(resolveMaterialId("acrilico_cristal", materiaisComAcento, 3)).toBe("cfg_1");
  });

  test("ordem das palavras trocada ('cristal acrilico') ainda resolve — token set, não substring posicional", () => {
    expect(resolveMaterialId("cristal acrilico 3mm", materiaisComAcento)).toBe("cfg_1");
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

describe("P0.4 — technicalBriefingFingerprint (base do S4: invalidação automática)", () => {
  const base = {
    ...emptyTechnicalBriefing(),
    productId: "Caixa",
    dimensions: { larguraMm: 150, alturaMm: 150, profundidadeMm: 150 },
    thicknessMm: 3, materialId: "cfg_0", quantity: 1,
  };

  test("mesmos dados (mesma referência ou cópia) geram o MESMO fingerprint — determinístico", () => {
    const copia = { ...base, dimensions: { ...base.dimensions } };
    expect(technicalBriefingFingerprint(base)).toBe(technicalBriefingFingerprint(copia));
  });

  test("mudar quantidade muda o fingerprint", () => {
    expect(technicalBriefingFingerprint(base)).not.toBe(technicalBriefingFingerprint({ ...base, quantity: 2 }));
  });

  test("mudar material muda o fingerprint", () => {
    expect(technicalBriefingFingerprint(base)).not.toBe(technicalBriefingFingerprint({ ...base, materialId: "cfg_1" }));
  });

  test("mudar espessura muda o fingerprint", () => {
    expect(technicalBriefingFingerprint(base)).not.toBe(technicalBriefingFingerprint({ ...base, thicknessMm: 5 }));
  });

  test("mudar largura/altura/profundidade muda o fingerprint", () => {
    const fp0 = technicalBriefingFingerprint(base);
    expect(fp0).not.toBe(technicalBriefingFingerprint({ ...base, dimensions: { ...base.dimensions, larguraMm: 200 } }));
    expect(fp0).not.toBe(technicalBriefingFingerprint({ ...base, dimensions: { ...base.dimensions, alturaMm: 200 } }));
    expect(fp0).not.toBe(technicalBriefingFingerprint({ ...base, dimensions: { ...base.dimensions, profundidadeMm: 200 } }));
  });

  test("mudar adesivo/adesivoBranco muda o fingerprint (Bloco C também é campo de preço)", () => {
    const fp0 = technicalBriefingFingerprint(base);
    expect(fp0).not.toBe(technicalBriefingFingerprint({ ...base, adesivo: true }));
    expect(fp0).not.toBe(technicalBriefingFingerprint({ ...base, adesivoBranco: true }));
    expect(technicalBriefingFingerprint({ ...base, adesivo: true })).not.toBe(technicalBriefingFingerprint({ ...base, adesivoBranco: true }));
  });

  test("adesivo ausente (undefined) e adesivo:false geram o MESMO fingerprint (equivalentes para preço)", () => {
    expect(technicalBriefingFingerprint(base)).toBe(technicalBriefingFingerprint({ ...base, adesivo: false }));
  });

  test("mudar produto muda o fingerprint", () => {
    expect(technicalBriefingFingerprint(base)).not.toBe(technicalBriefingFingerprint({ ...base, productId: "Bandeja" }));
  });

  test("mudar confirmedFields/missingRequiredFields (campos DERIVADOS, não de preço) NÃO muda o fingerprint", () => {
    expect(technicalBriefingFingerprint(base)).toBe(
      technicalBriefingFingerprint({ ...base, confirmedFields: ["x"], missingRequiredFields: ["y"] })
    );
  });
});
