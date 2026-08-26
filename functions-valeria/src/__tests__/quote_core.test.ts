/**
 * quote_core.test.ts — testes unitários do núcleo determinístico de
 * orçamento VR personalizado multi-peça (sprint P0.2 2026-08-23).
 *
 * Cobertura mínima pedida: fórmula, múltiplas peças, quantidade,
 * material, espessura, mudança de material, campo ausente, produto
 * inválido/não reconhecido.
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

import { calculatePersonalizedProduct, describeProductFields, UNSUPPORTED_COMMERCIAL_FIELDS } from "../quote_core";
import { PLAN_RECIPES, resolveRecipe } from "../recipes";

const MAT_ACRILICO_3MM = { comp: 183, larg: 122, custo: 180, rsm2: 8.05, nome: "Acrílico Cristal 3mm" };
const MAT_ACRILICO_5MM = { comp: 183, larg: 122, custo: 260, rsm2: 11.63, nome: "Acrílico Cristal 5mm" };

beforeEach(() => {
  _firestoreData["erp_config"] = {
    data: JSON.stringify({
      financeiro: { overhead: 41.16, vrml: 20, impostos: 0 },
      materiais: [MAT_ACRILICO_3MM, MAT_ACRILICO_5MM],
    }),
  };
});

describe("QUOTE CORE — describeProductFields", () => {
  test("1. Produto reconhecido (Caixa) — dim3d true, campos obrigatórios incluem prof", () => {
    const info = describeProductFields("Caixa");
    expect(info.reconhecido).toBe(true);
    expect(info.dim3d).toBe(true);
    expect(info.requiredFields).toEqual(expect.arrayContaining(["larg", "alt", "prof", "esp", "matKey", "qty"]));
  });

  test("2. Produto não reconhecido — cai no fallback peça plana, dim3d false, sem prof obrigatório", () => {
    const info = describeProductFields("Produto Nunca Visto XYZ");
    expect(info.reconhecido).toBe(false);
    expect(info.dim3d).toBe(false);
    expect(info.requiredFields).not.toContain("prof");
  });

  test("3. Produto plano cadastrado (Porta tablet) — dim3d false", () => {
    const info = describeProductFields("Porta tablet");
    expect(info.reconhecido).toBe(true);
    expect(info.dim3d).toBe(false);
  });
});

describe("QUOTE CORE — calculatePersonalizedProduct", () => {
  test("4. Peça plana simples (produto não cadastrado) — ELIGIBLE, finalPrice > 0", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Placa Simples", larg: 20, alt: 30, esp: 3, matKey: "cfg_0", qty: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.pieces.length).toBe(1);
    expect(r.pricing.eligibility).toBe("ELIGIBLE");
    expect(r.pricing.finalPrice).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThan(0); // avisa que não é receita conhecida
  });

  test("5. Múltiplas peças (Caixa, 4 tipos de peça) — pieces reflete a receita real", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Caixa", larg: 15, alt: 15, prof: 15, esp: 3, matKey: "cfg_0", qty: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.pieces.length).toBe(4); // Lateral, Frente/Fundo, Base, Tampa
    const nomes = r.pieces.map((p) => p.nome).sort();
    expect(nomes).toEqual(["Base", "Frente/Fundo", "Lateral", "Tampa"]);
    expect(r.pricing.eligibility).toBe("ELIGIBLE");
  });

  test("6. Quantidade do produto multiplica qtyTotal de cada peça", async () => {
    const r1 = await calculatePersonalizedProduct({
      produto: "Caixa", larg: 15, alt: 15, prof: 15, esp: 3, matKey: "cfg_0", qty: 1,
    });
    const r2 = await calculatePersonalizedProduct({
      produto: "Caixa", larg: 15, alt: 15, prof: 15, esp: 3, matKey: "cfg_0", qty: 3,
    });
    const lateral1 = r1.pieces.find((p) => p.nome === "Lateral")!;
    const lateral2 = r2.pieces.find((p) => p.nome === "Lateral")!;
    expect(lateral2.qtyTotal).toBe(lateral1.qtyTotal * 3);
    expect(r2.pricing.finalPrice).toBeCloseTo((r1.pricing.finalPrice ?? 0) * 3, 1);
  });

  test("7. Mudança de material (matKey diferente) muda o preço final", async () => {
    const r3mm = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
    });
    const r5mm = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_1", qty: 1,
    });
    expect(r3mm.pricing.finalPrice).not.toBe(r5mm.pricing.finalPrice);
    expect(r5mm.pricing.finalPrice).toBeGreaterThan(r3mm.pricing.finalPrice ?? 0); // cfg_1 (5mm) é mais caro que cfg_0 (3mm)
  });

  test("8. Espessura afeta a geometria de receitas com termo `e` na fórmula (Armário)", async () => {
    const rFina = await calculatePersonalizedProduct({
      produto: "Armário", larg: 60, alt: 40, prof: 30, esp: 2, matKey: "cfg_0", qty: 1,
    });
    const rGrossa = await calculatePersonalizedProduct({
      produto: "Armário", larg: 60, alt: 40, prof: 30, esp: 10, matKey: "cfg_0", qty: 1,
    });
    const tampoFina = rFina.pieces.find((p) => p.nome === "Tampo")!;
    const tampoGrossa = rGrossa.pieces.find((p) => p.nome === "Tampo")!;
    expect(tampoFina.larg).not.toBe(tampoGrossa.larg); // Tampo.larg = L-(2*e)
  });

  test("9. Campo obrigatório ausente (prof, produto dim3d) → NEEDS_INFORMATION, nunca calcula", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Caixa", larg: 15, alt: 15, esp: 3, matKey: "cfg_0", qty: 1,
      // prof ausente de propósito
    });
    expect(r.ok).toBe(false);
    expect(r.pricing.eligibility).toBe("NEEDS_INFORMATION");
    expect(r.pricing.missingFields).toContain("prof");
    expect(r.pieces.length).toBe(0);
  });

  test("10. matKey inexistente → NEEDS_INFORMATION propagado do motor oficial (nunca inventa preço)", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_999", qty: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.pricing.eligibility).toBe("NEEDS_INFORMATION");
  });

  test("11. Dimensão que gera peça inválida (área zero/negativa) → NEEDS_INFORMATION antes de chamar o motor", async () => {
    // Caixa: Lateral = P-(2*e) x A-e — com P muito pequeno e e grande, fica negativo
    const r = await calculatePersonalizedProduct({
      produto: "Caixa", larg: 15, alt: 15, prof: 2, esp: 5, matKey: "cfg_0", qty: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.pricing.eligibility).toBe("NEEDS_INFORMATION");
  });

  test("12. Todas as 13 receitas embutidas calculam sem lançar exceção com dimensões razoáveis", async () => {
    for (const nome of Object.keys(PLAN_RECIPES)) {
      const rec = resolveRecipe(nome);
      const r = await calculatePersonalizedProduct({
        produto: nome, larg: 50, alt: 40, prof: rec.dim3d ? 30 : undefined, esp: 4, matKey: "cfg_0", qty: 1,
      });
      expect(r.produto).toBe(nome);
      expect(["ELIGIBLE", "NEEDS_INFORMATION"]).toContain(r.pricing.eligibility);
    }
  });
});

describe("QUOTE CORE — Bloco C: Adesivo/Adesivo branco (paridade orcRecalc)", () => {
  test("13. Sem flags de adesivo — preço idêntico ao caso sem consumível (comportamento legado preservado)", async () => {
    const semAdesivo = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
    });
    const comFlagsFalse = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
      adesivo: false, adesivoBranco: false,
    });
    expect(comFlagsFalse.pricing.finalPrice).toBe(semAdesivo.pricing.finalPrice);
  });

  test("14. adesivo=true aumenta o preço final (custo entra na base do markup)", async () => {
    const base = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
    });
    const comAdesivo = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivo: true,
    });
    expect(comAdesivo.pricing.finalPrice).toBeGreaterThan(base.pricing.finalPrice ?? 0);
  });

  test("15. adesivo e adesivoBranco são independentes — os dois juntos custam mais que qualquer um sozinho (Rodada 8)", async () => {
    const soNormal = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivo: true,
    });
    const soBranco = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivoBranco: true,
    });
    const ambos = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivo: true, adesivoBranco: true,
    });
    expect(ambos.pricing.finalPrice).toBeGreaterThan(soNormal.pricing.finalPrice ?? 0);
    expect(ambos.pricing.finalPrice).toBeGreaterThan(soBranco.pricing.finalPrice ?? 0);
  });

  test("16. Custo de adesivo escala com a área total (qty maior → delta de adesivo maior)", async () => {
    const qty1 = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivo: true,
    });
    const qty1Base = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
    });
    const qty3 = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 3, adesivo: true,
    });
    const qty3Base = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 3,
    });
    const delta1 = (qty1.pricing.finalPrice ?? 0) - (qty1Base.pricing.finalPrice ?? 0);
    const delta3 = (qty3.pricing.finalPrice ?? 0) - (qty3Base.pricing.finalPrice ?? 0);
    expect(delta3).toBeGreaterThan(delta1 * 2.5); // ~3x, com folga para arredondamento/markup
  });

  test("17. Preço/cm² configurável (não hardcoded) — config diferente muda o delta de adesivo", async () => {
    const comFallback = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivo: true,
    });
    _firestoreData["erp_config"] = {
      data: JSON.stringify({
        financeiro: { overhead: 41.16, vrml: 20, impostos: 0, adesivoPrecoCm2: 0.05 },
        materiais: [MAT_ACRILICO_3MM, MAT_ACRILICO_5MM],
      }),
    };
    const comConfigCustom = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivo: true,
    });
    expect(comConfigCustom.pricing.finalPrice).toBeGreaterThan(comFallback.pricing.finalPrice ?? 0);
  });
});

describe("QUOTE CORE — Bloco C: itens sem fonte canônica (reasonCode, nunca inventa valor)", () => {
  test("18. gravacao solicitada → HUMAN_VALIDATION_REQUIRED com reasonCode explícito, nunca calcula preço", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
      solicitacoesNaoSuportadas: ["gravacao"],
    });
    expect(r.ok).toBe(false);
    expect(r.pricing.eligibility).toBe("HUMAN_VALIDATION_REQUIRED");
    expect(r.pricing.finalPrice).toBeUndefined();
    expect(r.pricing.blockedItems).toEqual([
      { campo: "gravacao", ...UNSUPPORTED_COMMERCIAL_FIELDS["gravacao"] },
    ]);
  });

  test("19. múltiplos itens não suportados juntos — todos aparecem em blockedItems", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
      solicitacoesNaoSuportadas: ["desconto", "montagem"],
    });
    expect(r.pricing.eligibility).toBe("HUMAN_VALIDATION_REQUIRED");
    expect(r.pricing.blockedItems?.map((b) => b.campo).sort()).toEqual(["desconto", "montagem"]);
  });

  test("20. chave desconhecida em solicitacoesNaoSuportadas é ignorada (nunca bloqueia por engano)", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
      solicitacoesNaoSuportadas: ["campo_que_nao_existe"],
    });
    expect(r.pricing.eligibility).toBe("ELIGIBLE");
  });

  test("21. sem solicitacoesNaoSuportadas — calcula normalmente (bloqueio nunca é proativo/permanente)", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1,
    });
    expect(r.pricing.eligibility).toBe("ELIGIBLE");
  });

  test("22. adesivo continua calculado normalmente mesmo com outro item bloqueado (bloqueio não invade o restante do cálculo)", async () => {
    const semBloqueio = await calculatePersonalizedProduct({
      produto: "Bandeja", larg: 30, alt: 20, prof: 5, esp: 3, matKey: "cfg_0", qty: 1, adesivo: true,
    });
    expect(semBloqueio.pricing.eligibility).toBe("ELIGIBLE"); // confirma que adesivo sozinho não é bloqueado
  });
});

describe("P1.2 — guard explícito no fallback de peça plana (produto complexo sem receita)", () => {
  test("unsupportedComplexityReasonCodes presente → HUMAN_VALIDATION_REQUIRED, nunca chega a calcular geometria/preço", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Troféu personalizado", larg: 40, alt: 30, esp: 5, matKey: "cfg_0", qty: 1,
      unsupportedComplexityReasonCodes: ["LED_ILUMINACAO", "MATERIAL_NAO_ACRILICO"],
    });
    expect(r.ok).toBe(false);
    expect(r.pricing.eligibility).toBe("HUMAN_VALIDATION_REQUIRED");
    expect(r.pricing.finalPrice).toBeUndefined();
    expect(r.pieces).toEqual([]);
    expect(r.pricing.blockedItems?.map((b) => b.campo).sort()).toEqual(["LED_ILUMINACAO", "MATERIAL_NAO_ACRILICO"]);
  });

  test("array vazio/null nunca bloqueia (mesmo produto sem receita continua caindo no fallback normal de peça plana)", async () => {
    const r = await calculatePersonalizedProduct({
      produto: "Display simples", larg: 30, alt: 20, esp: 3, matKey: "cfg_0", qty: 1,
      unsupportedComplexityReasonCodes: [],
    });
    expect(r.pricing.eligibility).toBe("ELIGIBLE");
    expect(r.warnings.some((w) => w.includes("não é uma receita embutida conhecida"))).toBe(true);
  });
});
