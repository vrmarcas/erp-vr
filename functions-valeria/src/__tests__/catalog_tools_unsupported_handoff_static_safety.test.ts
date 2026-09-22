/**
 * catalog_tools_unsupported_handoff_static_safety.test.ts — ValerIA 2.0,
 * Fase E.2.42 (2026-09-22).
 *
 * catalog_tools.ts é o handler HTTP grande (valeriaUpdateCatalogQualification)
 * com muitas dependências de Firestore/feature flags — mesma disciplina já
 * usada em active_pilot_static_safety.test.ts para verificar a FIAÇÃO de um
 * handler grande por leitura de texto-fonte, complementando (nunca
 * substituindo) os testes de comportamento puro já existentes em
 * product_resolution_cosmetic_personalization.test.ts,
 * personalization_classifier.test.ts e catalog_draft.test.ts, que cobrem a
 * DECISÃO em si.
 */
import * as fs from "fs";
import * as path from "path";

function src(file: string): string {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

describe("catalog_tools.ts — handoff determinístico para UNSUPPORTED (Fase E.2.42)", () => {
  const CATALOG_TOOLS = src("catalog_tools.ts");

  test('existe um branch dedicado para qualificationStatus === "UNSUPPORTED"', () => {
    expect(CATALOG_TOOLS).toMatch(/qualification\.qualificationStatus === "UNSUPPORTED"/);
  });

  test("o branch UNSUPPORTED chama requestQuoteReview com motivo UNSUPPORTED_PRODUCT", () => {
    const idx = CATALOG_TOOLS.indexOf('qualification.qualificationStatus === "UNSUPPORTED"');
    expect(idx).toBeGreaterThan(0);
    const bloco = CATALOG_TOOLS.slice(idx, idx + 1200);
    expect(bloco).toMatch(/requestQuoteReview\(/);
    expect(bloco).toMatch(/motivo:\s*"UNSUPPORTED_PRODUCT"/);
  });

  test("o branch UNSUPPORTED marca o draft como promovido (unsupported_handoff) — idempotente, nunca repete o handoff a cada turno", () => {
    const idx = CATALOG_TOOLS.indexOf('qualification.qualificationStatus === "UNSUPPORTED"');
    const bloco = CATALOG_TOOLS.slice(idx, idx + 1400);
    expect(bloco).toMatch(/markCatalogDraftPromoted\(ctx\.conversationId,\s*"unsupported_handoff"/);
  });

  test("o branch UNSUPPORTED NUNCA chama createVitreDraftIfNotExists (nenhum orçamento Vitre automático para produto fora do catálogo)", () => {
    const idx = CATALOG_TOOLS.indexOf('qualification.qualificationStatus === "UNSUPPORTED"');
    const proximoElseIdx = CATALOG_TOOLS.indexOf("} else if (draftAtualizado.promovido)", idx);
    expect(proximoElseIdx).toBeGreaterThan(idx);
    const bloco = CATALOG_TOOLS.slice(idx, proximoElseIdx);
    expect(bloco).not.toMatch(/createVitreDraftIfNotExists/);
  });

  test("a chamada repetida (draft já promovido) reporta unsupportedHandoffRequested=true para promovidoParaTipo==='unsupported_handoff'", () => {
    expect(CATALOG_TOOLS).toMatch(/promovidoParaTipo === "unsupported_handoff"/);
  });

  test("o rascunho Vitre (transição READY_CATALOG_DRAFT) passa observacoes derivado de formatPersonalizationForObservacoes — personalização cosmética chega na revisão humana", () => {
    const idx = CATALOG_TOOLS.indexOf('qualification.qualificationStatus === "READY_CATALOG_DRAFT"');
    expect(idx).toBeGreaterThan(0);
    const bloco = CATALOG_TOOLS.slice(idx, idx + 2200);
    expect(bloco).toMatch(/createVitreDraftIfNotExists\(/);
    expect(bloco).toMatch(/observacoes:\s*formatPersonalizationForObservacoes\(draftAtualizado\.fields\.personalization\)/);
  });

  test("catalog_tools.ts importa formatPersonalizationForObservacoes de catalog_draft.ts (nunca reimplementa a formatação em duplicidade)", () => {
    expect(CATALOG_TOOLS).toMatch(/formatPersonalizationForObservacoes/);
    expect(CATALOG_TOOLS).not.toMatch(/["']Personaliza[çc][aã]o \(ValerIA\): ["']/); // string literal do formato nunca duplicada aqui
  });
});

describe("commercial_quote_orchestrator.ts — mesmo tratamento de observacoes no caminho do piloto V2 (Fase E.2.42)", () => {
  test("também passa observacoes derivado de formatPersonalizationForObservacoes ao criar o rascunho", () => {
    const orchestrator = src("commercial_quote_orchestrator.ts");
    expect(orchestrator).toMatch(/observacoes:\s*formatPersonalizationForObservacoes\(input\.draft\.fields\.personalization\)/);
  });
});
