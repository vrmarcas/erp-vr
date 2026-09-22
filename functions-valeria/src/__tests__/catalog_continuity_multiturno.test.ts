/**
 * catalog_continuity_multiturno.test.ts — ValerIA 2.0, Fase E.2.22 (2026-09-21).
 *
 * Prova de ponta a ponta (puro — extractor + resolver + pipeline, sem
 * Firestore) de que um segundo turno usa o `mergedDraft` devolvido pelo
 * primeiro como `priorDraft`, exatamente como active_pilot_runner.ts e
 * shadow_runner.ts fazem de verdade (a diferença é só quem persiste).
 * Catálogo espelha os dados reais de produção (valeria_catalogos/caixas,
 * grupo "Caixa com tampa de correr") — P→C4TC3P, M→C4TC3M, G→C4TC3G.
 */
import { extractShadowSignals } from "../shadow_signal_extractor";
import { runShadowPipeline, type ShadowInput } from "../shadow_pipeline";
import type { CatalogGroup } from "../product_resolution";
import type { CatalogDraft } from "../catalog_draft";

const TAMPA_DE_CORRER: CatalogGroup = {
  catalogGroupId: "caixa_tampa_de_correr",
  categoria: "caixas",
  nome: "Caixa com tampa de correr",
  aliases: ["tampa de correr", "caixa tampa de correr"],
  tamanhos: [
    { tamanho: "P", larguraCm: 20, alturaCm: 20, profundidadeCm: 4, vitreProductId: "C4TC3P", vitreProductSku: "C4TC3P" },
    { tamanho: "M", larguraCm: 30, alturaCm: 30, profundidadeCm: 4, vitreProductId: "C4TC3M", vitreProductSku: "C4TC3M" },
    { tamanho: "G", larguraCm: 40, alturaCm: 40, profundidadeCm: 4, vitreProductId: "C4TC3G", vitreProductSku: "C4TC3G" },
  ],
  toleranciaCm: null,
};
const CATALOG_GROUPS = [TAMPA_DE_CORRER];

function runTurn(text: string, priorDraft: CatalogDraft | null) {
  const { signals, fieldUpdate } = extractShadowSignals(text, CATALOG_GROUPS, priorDraft);
  const input: ShadowInput = {
    conversationId: "conv_piloto3",
    messageText: text,
    modoAtendimento: "valeria",
    isEchoOfOwnMessage: false,
    isTeste: true,
    priorDraft,
    catalogGroups: CATALOG_GROUPS,
    resolutionSignals: signals,
    fieldUpdate,
  };
  return runShadowPipeline(input);
}

describe("Continuidade multi-turno — CASO A/B/C (Fase E.2.22)", () => {
  test("CASO A — priorDraft vazio, 'Quero fazer uma caixa.' → COMMERCIAL_INTENT / ASK_MODEL", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    expect(resultA.mode).toBe("COMMERCIAL_INTENT");
    expect(resultA.nextAction).toBe("ASK_MODEL");
    expect(resultA.mergedDraft).not.toBeNull();
    expect(resultA.mergedDraft!.catalogGroupId).toBeNull(); // "caixa" sozinho não identifica grupo específico
  });

  test("CASO B — priorDraft do caso A, 'Tampa de correr tamanho M.' → reconhece grupo+tamanho, resolve C4TC3M", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);

    expect(resultB.mode).toBe("COMMERCIAL_INTENT");
    expect(resultB.resolution?.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(resultB.resolution?.catalogGroupId).toBe("caixa_tampa_de_correr");
    expect(resultB.resolution?.matchedProductId).toBe("C4TC3M");
    expect(resultB.resolution?.matchedProductSku).toBe("C4TC3M");
    // não caiu em custom nem ambiguous
    expect(resultB.resolution?.customizationRequired).toBe(false);
    // próxima pergunta é só quantidade — não repete modelo nem tamanho
    expect(resultB.nextAction).toBe("ASK_QUANTITY");
    expect(resultB.redactionInput?.questionAllowed).toBe(true);
    expect(resultB.rawHypotheticalText).toMatch(/quantas|quantidade/i);
    expect(resultB.rawHypotheticalText).not.toMatch(/modelo|categoria/i);
    expect(resultB.rawHypotheticalText).not.toMatch(/tamanho/i);
    // só uma pergunta no texto final
    expect((resultB.rawHypotheticalText!.match(/\?/g) ?? []).length).toBe(1);
    expect(resultB.outputValidation?.valid).toBe(true);
    expect(resultB.mergedDraft!.matchedProductId).toBe("C4TC3M");
    expect(resultB.mergedDraft!.catalogGroupId).toBe("caixa_tampa_de_correr");
  });

  test("CASO C — priorDraft com M já resolvido, 'Na verdade, tamanho G.' → substitui M por G", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    const resultC = runTurn("Na verdade, tamanho G.", resultB.mergedDraft);

    expect(resultC.resolution?.resolutionType).toBe("EXACT_CATALOG_MATCH");
    expect(resultC.resolution?.matchedProductId).toBe("C4TC3G");
    expect(resultC.resolution?.matchedProductSku).toBe("C4TC3G");
    expect(resultC.mergedDraft!.matchedProductId).toBe("C4TC3G"); // substituiu, não acumulou M+G
    expect(resultC.mergedDraft!.catalogGroupId).toBe("caixa_tampa_de_correr"); // grupo preservado do contexto
  });

  test("retry da MESMA mensagem (mesmo priorDraft) produz o MESMO mergedDraft — idempotência sem mecanismo paralelo", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const firstAttempt = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    const retryAttempt = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft); // mesmo priorDraft, mesma msg
    expect(retryAttempt.mergedDraft!.catalogGroupId).toBe(firstAttempt.mergedDraft!.catalogGroupId);
    expect(retryAttempt.mergedDraft!.matchedProductId).toBe(firstAttempt.mergedDraft!.matchedProductId);
    expect(retryAttempt.resolution).toEqual(firstAttempt.resolution);
  });

  test("EXPLORATORY entre dois turnos comerciais não apaga o draft (mergedDraft null, mas isso não é usado para sobrescrever)", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    const exploratory = runTurn("Vocês entregam em outras cidades?", resultB.mergedDraft);
    expect(exploratory.mode).toBe("EXPLORATORY");
    expect(exploratory.mergedDraft).toBeNull(); // pipeline não toca o draft neste ramo — chamador simplesmente não persiste nada novo, draft anterior seguiria intacto no Firestore
  });
});

// ── Fase E.2.25 — invariante mergedDraft.qualificationStatus/missingFields ──
function assertQualificationInvariant(result: ReturnType<typeof runTurn>) {
  expect(result.mergedDraft).not.toBeNull();
  expect(result.qualification).not.toBeNull();
  expect(result.mergedDraft!.qualificationStatus).toBe(result.qualification!.qualificationStatus);
  expect(result.mergedDraft!.missingFields).toEqual(result.qualification!.missingFields);
}

describe("Sincronização qualificationStatus/missingFields no draft persistido (Fase E.2.25)", () => {
  test("CASO A — 'Quero fazer uma caixa.' → mergedDraft.qualificationStatus/missingFields batem com qualification calculada", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    assertQualificationInvariant(resultA);
    expect(resultA.mergedDraft!.qualificationStatus).toBe("QUALIFYING_CATALOG");
    expect(resultA.mergedDraft!.missingFields).toEqual(["catalogGroupId"]);
  });

  test("CASO B — priorDraft do A + 'Tampa de correr tamanho M.' → resolve C4TC3M, ASK_QUANTITY, missingFields=['quantity']", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    assertQualificationInvariant(resultB);
    expect(resultB.resolution?.matchedProductId).toBe("C4TC3M");
    expect(resultB.nextAction).toBe("ASK_QUANTITY");
    expect(resultB.mergedDraft!.qualificationStatus).toBe("QUALIFYING_CATALOG");
    expect(resultB.mergedDraft!.missingFields).toEqual(["quantity"]);
  });

  test("CASO C — priorDraft com C4TC3M + 'Preciso de 10 unidades.' → quantity=10, missingFields deixa de conter quantity, READY_CATALOG_DRAFT", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    const resultC = runTurn("Preciso de 10 unidades.", resultB.mergedDraft);
    assertQualificationInvariant(resultC);
    expect(resultC.mergedDraft!.fields.quantity).toBe(10);
    expect(resultC.mergedDraft!.missingFields).not.toContain("quantity");
    // regra real do sistema (computeReadyForCatalogMatch): matchedProductId + quantity>0 → READY_CATALOG_DRAFT
    expect(resultC.mergedDraft!.qualificationStatus).toBe("READY_CATALOG_DRAFT");
    expect(resultC.mergedDraft!.missingFields).toEqual([]);
  });

  test("CASO D — correção explícita de quantidade (10 → 20) mantém qualification/missingFields coerentes", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    const resultC = runTurn("Preciso de 10 unidades.", resultB.mergedDraft);
    const resultD = runTurn("Na verdade, 20 unidades.", resultC.mergedDraft);
    assertQualificationInvariant(resultD);
    expect(resultD.mergedDraft!.fields.quantity).toBe(20); // substituiu 10, não somou/acumulou
    expect(resultD.mergedDraft!.qualificationStatus).toBe("READY_CATALOG_DRAFT");
    expect(resultD.mergedDraft!.missingFields).toEqual([]);
  });

  test("CASO E — nenhuma divergência entre result.qualification e result.mergedDraft, em todos os turnos da conversa completa", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    assertQualificationInvariant(resultA);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    assertQualificationInvariant(resultB);
    const resultC = runTurn("Preciso de 10 unidades.", resultB.mergedDraft);
    assertQualificationInvariant(resultC);
    const resultD = runTurn("Na verdade, 20 unidades.", resultC.mergedDraft);
    assertQualificationInvariant(resultD);
  });

  test("campos preservados intactos pela sincronização — só qualificationStatus/missingFields são reescritos, nada mais", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const resultB = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    expect(resultB.mergedDraft!.conversationId).toBe("conv_piloto3");
    expect(resultB.mergedDraft!.isTest).toBe(true);
    expect(resultB.mergedDraft!.catalogGroupId).toBe("caixa_tampa_de_correr");
    expect(resultB.mergedDraft!.matchedProductId).toBe("C4TC3M");
    expect(resultB.mergedDraft!.clientConfirmed).toBe(true);
    expect(resultB.mergedDraft!.customizationRequired).toBe(false);
    expect(resultB.mergedDraft!.promovido).toBe(false);
  });

  test("retry da mesma mensagem produz a MESMA sincronização (determinística, sem divergência em retry)", () => {
    const resultA = runTurn("Quero fazer uma caixa.", null);
    const first = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    const retry = runTurn("Tampa de correr tamanho M.", resultA.mergedDraft);
    expect(retry.mergedDraft!.qualificationStatus).toBe(first.mergedDraft!.qualificationStatus);
    expect(retry.mergedDraft!.missingFields).toEqual(first.mergedDraft!.missingFields);
  });
});
