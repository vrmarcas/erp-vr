/**
 * valeria_v2_eligibility.test.ts — ValerIA 2.0, Fase B (fechamento, 2026-09-19).
 */
import { evaluateValeriaV2ProductEligibility, V2EligibilityProductInput, V2EligibilityContext } from "../valeria_v2_eligibility";

function product(overrides: Partial<V2EligibilityProductInput> = {}): V2EligibilityProductInput {
  return {
    id: "C4TC3M",
    sku: "C4TC3M",
    nome: "Caixa 4mm, tampa de correr 3mm",
    status: "ativo",
    precoVenda: 165,
    larguraCm: 30,
    alturaCm: 30,
    profundidadeCm: 4,
    ...overrides,
  };
}

function ctx(overrides: Partial<V2EligibilityContext> = {}): V2EligibilityContext {
  return { homologadoNoGrupoV2: true, catalogGroupId: "caixa_tampa_de_correr", ...overrides };
}

describe("evaluateValeriaV2ProductEligibility — campos mínimos reais da V2", () => {
  test("produto real de caixa (nível 1 no gate antigo) É elegível para V2 quando homologado", () => {
    // Os 12 SKUs reais auditados têm exatamente este shape: sem fotos/prazoDias/
    // embalagem/pesoKg/categoria (nível 1 no gate legado), mas com tudo que a V2 precisa.
    const r = evaluateValeriaV2ProductEligibility(product(), ctx());
    expect(r.eligible).toBe(true);
    expect(r.missingRequiredFields).toEqual([]);
  });

  test("fotos/prazoDias/embalagem/pesoKg NUNCA aparecem como pendência (não são exigidos pela V2)", () => {
    const r = evaluateValeriaV2ProductEligibility(product(), ctx());
    expect(r.missingRequiredFields).not.toEqual(expect.arrayContaining(["fotos", "prazoDias", "embalagem", "pesoKg", "categoria"]));
  });

  test("produto nulo → inelegível", () => {
    expect(evaluateValeriaV2ProductEligibility(null, ctx()).eligible).toBe(false);
  });

  test("status diferente de 'ativo' → inelegível, com warning", () => {
    const r = evaluateValeriaV2ProductEligibility(product({ status: "renomeado" }), ctx());
    expect(r.eligible).toBe(false);
    expect(r.missingRequiredFields).toContain("status_ativo");
    expect(r.warnings).toContain("status_nao_ativo:renomeado");
  });

  test("preçoVenda ausente ou zero → inelegível", () => {
    expect(evaluateValeriaV2ProductEligibility(product({ precoVenda: null }), ctx()).eligible).toBe(false);
    expect(evaluateValeriaV2ProductEligibility(product({ precoVenda: 0 }), ctx()).eligible).toBe(false);
  });

  test("sem dimensões (largura/altura) → inelegível", () => {
    const r = evaluateValeriaV2ProductEligibility(product({ larguraCm: null }), ctx());
    expect(r.missingRequiredFields).toContain("dimensoes");
  });

  test("homologadoNoGrupoV2=false → inelegível, mesmo com produto perfeito (ativoValeria não é consultado aqui)", () => {
    const r = evaluateValeriaV2ProductEligibility(product(), ctx({ homologadoNoGrupoV2: false }));
    expect(r.eligible).toBe(false);
    expect(r.missingRequiredFields).toContain("homologadoNaConfigV2");
  });

  test("material/espessura só são exigidos quando o contexto realmente pede (requiresMaterial/requiresEspessura)", () => {
    const semExigencia = evaluateValeriaV2ProductEligibility(product(), ctx());
    expect(semExigencia.missingRequiredFields).not.toContain("material");
    expect(semExigencia.missingRequiredFields).not.toContain("espessura");

    const comExigencia = evaluateValeriaV2ProductEligibility(product(), ctx({ requiresMaterial: true, requiresEspessura: true }));
    expect(comExigencia.missingRequiredFields).toEqual(expect.arrayContaining(["material", "espessura"]));

    const comExigenciaPreenchida = evaluateValeriaV2ProductEligibility(
      product(),
      ctx({ requiresMaterial: true, requiresEspessura: true, material: "Acrílico cristal", espessuraMm: 4 })
    );
    expect(comExigenciaPreenchida.missingRequiredFields).not.toContain("material");
    expect(comExigenciaPreenchida.missingRequiredFields).not.toContain("espessura");
  });
});
