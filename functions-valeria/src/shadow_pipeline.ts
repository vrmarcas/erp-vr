/**
 * shadow_pipeline.ts — ValerIA 2.0, Fase E.2.7 (PoC shadow, 2026-09-20).
 *
 * Orquestração da Variante B ("backend decide, LLM só redige") — em modo
 * SHADOW: lê, classifica, resolve catálogo, decide nextAction, redige um
 * texto hipotético e valida — mas NUNCA envia nada, nunca persiste nada,
 * nunca chama Tool com efeito colateral. `runShadowPipeline` é uma função
 * PURA (nenhum import de Firestore/HTTP/admin neste arquivo): por
 * construção, é IMPOSSÍVEL que ela produza um efeito colateral — essa é a
 * garantia de segurança da fase, não uma promessa de runtime a ser
 * confiada, é uma propriedade do código (verificável por leitura/lint:
 * nenhuma função aqui recebe nem usa um client de escrita).
 *
 * Idempotência: como a função é pura e determinística (sem `Date.now()`,
 * sem `Math.random()`, sem I/O), a MESMA entrada sempre produz a MESMA
 * saída — reprocessar o mesmo evento de webhook (retry) é seguro por
 * definição, nunca duplica nada porque nunca executa nada.
 */
import type { CatalogGroup, ResolutionSignals } from "./product_resolution";
import { resolveProductMatch } from "./product_resolution";
import type { CatalogDraft, FieldUpdate } from "./catalog_draft";
import { emptyCatalogDraft, mergeSignalsIntoDraft, computeQualificationState } from "./catalog_draft";
import { computeNextAction, type NextActionContext } from "./qualification_engine";
import { classifyIntent, type ClassificationResult } from "./interaction_classifier";
import { validateOutput, type OutputValidationResult } from "./shadow_output_validator";
import { defaultTemplateRedactor, type Redactor, type RedactionInput, type RedactionMode } from "./shadow_redactor";

export type InteractionMode = "EXPLORATORY" | "COMMERCIAL_INTENT" | "AMBIGUOUS" | "HUMAN" | "SYSTEM_IGNORE";

/** Tabela de fatos conhecidos por tópico — SEM KB ChatVolt (desconectada/corrompida), só dados backend confiáveis desta fase. Extensível. */
export type FactTable = Record<string, string[]>;

export const DEFAULT_FACT_TABLE: FactTable = {
  SOB_MEDIDA: ["Sim, fazemos peças sob medida."],
  ACRILICO: ["Trabalhamos com acrílico em diversas cores e espessuras."],
  ENTREGA: ["Sim, entregamos em outras cidades."],
  PRAZO: ["O prazo varia conforme o produto e a quantidade."],
  TROFEU: ["Sim, fazemos troféus."],
  DEFAULT: ["Posso ajudar com essa dúvida."],
};

function pickFactTopic(text: string): keyof typeof DEFAULT_FACT_TABLE {
  const t = text.toLowerCase();
  if (/sob medida|personalizad/i.test(t)) return "SOB_MEDIDA";
  if (/acr[ií]lico/i.test(t)) return "ACRILICO";
  if (/entreg/i.test(t)) return "ENTREGA";
  if (/prazo/i.test(t)) return "PRAZO";
  if (/trof[eé]u/i.test(t)) return "TROFEU";
  return "DEFAULT";
}

export interface ShadowInput {
  conversationId: string;
  messageText: string;
  /** Estado do atendimento no MOMENTO do evento — só leitura, nunca gravado por este módulo. */
  modoAtendimento: "valeria" | "humano" | string | null;
  /** true quando esta mensagem é eco de algo que o PRÓPRIO backend já enviou (loop prevention — ver desenho Fase E.2.6/seção 7). */
  isEchoOfOwnMessage: boolean;
  isTeste: boolean;
  /** Draft já existente da conversa, se houver — snapshot só-leitura (o shadow NUNCA chama loadCatalogDraft/saveCatalogDraft). */
  priorDraft?: CatalogDraft | null;
  /** Catálogo já carregado pelo chamador (leitura permitida em shadow — nunca escrita). */
  catalogGroups: CatalogGroup[];
  /** Sinais já extraídos do texto para consulta ao catálogo — nesta PoC, extração simplificada/manual (ver shadow_pipeline.test.ts). Numa implementação futura viria de um extrator dedicado. */
  resolutionSignals?: ResolutionSignals;
  fieldUpdate?: FieldUpdate;
  factTable?: FactTable;
  redactor?: Redactor;
}

export interface ShadowResult {
  conversationId: string;
  mode: InteractionMode;
  classification: ClassificationResult | null;
  resolution: ReturnType<typeof resolveProductMatch> | null;
  qualification: { qualificationStatus: string; missingFields: string[] } | null;
  nextAction: string | null;
  redactionInput: RedactionInput | null;
  /** Texto exatamente como o redator produziu, ANTES do validador — nunca escondido, mesmo quando inválido. */
  rawHypotheticalText: string | null;
  /** Texto final (== rawHypotheticalText quando válido; saneado quando o redator errou). */
  hypotheticalText: string | null;
  outputValidation: OutputValidationResult | null;
  wouldRequestHuman: boolean;
  wouldRequestHumanReason: string | null;
  /** Literal `false` sempre — nenhuma escrita real ocorre neste módulo. */
  sideEffectsExecuted: false;
}

function shadowResultBase(conversationId: string, mode: InteractionMode, overrides: Partial<ShadowResult> = {}): ShadowResult {
  return {
    conversationId,
    mode,
    classification: null,
    resolution: null,
    qualification: null,
    nextAction: null,
    redactionInput: null,
    rawHypotheticalText: null,
    hypotheticalText: null,
    outputValidation: null,
    wouldRequestHuman: false,
    wouldRequestHumanReason: null,
    sideEffectsExecuted: false,
    ...overrides,
  };
}

/**
 * runShadowPipeline — função pura central desta fase.
 */
export function runShadowPipeline(input: ShadowInput): ShadowResult {
  const redactor = input.redactor ?? defaultTemplateRedactor;
  const factTable = input.factTable ?? DEFAULT_FACT_TABLE;

  // Gate 1 — eco da nossa própria escrita: nunca reprocessar (item 8/13).
  if (input.isEchoOfOwnMessage) {
    return shadowResultBase(input.conversationId, "SYSTEM_IGNORE");
  }

  // Gate 2 — humano já atendendo: nunca gerar resposta hipotética.
  if (input.modoAtendimento === "humano") {
    return shadowResultBase(input.conversationId, "HUMAN");
  }

  // 3. Classificação determinística.
  const classification = classifyIntent(input.messageText);

  if (classification.classification === "EXPLORATORY" || classification.classification === "AMBIGUOUS") {
    const topic = pickFactTopic(input.messageText);
    const facts = factTable[topic] ?? factTable.DEFAULT;
    const redactionInput: RedactionInput = {
      mode: classification.classification as RedactionMode,
      questionAllowed: false,
      factsAllowed: facts,
    };
    const rawHypotheticalText = redactor(redactionInput);
    const outputValidation = validateOutput(rawHypotheticalText, { questionAllowed: false, factsAllowed: facts });
    return shadowResultBase(input.conversationId, classification.classification, {
      classification,
      redactionInput,
      rawHypotheticalText,
      hypotheticalText: outputValidation.valid ? rawHypotheticalText : outputValidation.sanitizedText,
      outputValidation,
    });
  }

  // 4. COMMERCIAL_INTENT — reaproveita resolução/qualificação/nextAction já existentes (puros).
  const draft: CatalogDraft = input.priorDraft ?? emptyCatalogDraft(input.conversationId, null, input.isTeste);
  const signals: ResolutionSignals = input.resolutionSignals ?? {};
  // Só recalcula a resolução quando o turno traz algum sinal de produto
  // novo — mesma disciplina implícita em mergeSignalsIntoDraft (`resolution:
  // ResolutionResult | null`, seção A do cabeçalho de catalog_draft.ts):
  // um turno que só traz quantidade/prazo/etc, sem nenhum sinal de
  // produto, NUNCA deve recalcular do zero e sobrescrever um match já
  // resolvido em turno anterior com um AMBIGUOUS espúrio.
  const hasProductSignalThisTurn = Boolean(
    signals.explicitSkuOrProductId ||
      signals.groupNameOrAlias ||
      signals.catalogSizeLabel ||
      signals.exactDimensionsCm ||
      signals.vagueSizeHintCm != null ||
      signals.customerExplicitlyRequestsCustom ||
      signals.clientConfirmedSuggestedOption
  );
  const resolution = hasProductSignalThisTurn ? resolveProductMatch(signals, input.catalogGroups) : null;
  const fieldUpdate: FieldUpdate = input.fieldUpdate ?? {};
  const mergedDraft = mergeSignalsIntoDraft(draft, resolution, fieldUpdate, "CUSTOMER");
  const qualification = computeQualificationState(mergedDraft);

  const nextActionCtx: NextActionContext = {
    groupName: mergedDraft.catalogGroupId ?? undefined,
    suggestedOptionLabel: resolution?.suggestedOption?.tamanho ?? undefined,
  };
  const { nextAction, questionContext } = computeNextAction(qualification, nextActionCtx);

  const wouldRequestHuman = nextAction === "ESCALATE_UNSUPPORTED";

  const redactionInput: RedactionInput = {
    mode: "COMMERCIAL_INTENT",
    questionAllowed: true,
    factsAllowed: [],
    nextAction,
    questionContext,
  };
  const rawHypotheticalText = redactor(redactionInput);
  const outputValidation = validateOutput(rawHypotheticalText, { questionAllowed: true, factsAllowed: [] });

  return shadowResultBase(input.conversationId, "COMMERCIAL_INTENT", {
    classification,
    resolution,
    qualification,
    nextAction,
    redactionInput,
    rawHypotheticalText,
    hypotheticalText: outputValidation.valid ? rawHypotheticalText : outputValidation.sanitizedText,
    outputValidation,
    wouldRequestHuman,
    wouldRequestHumanReason: wouldRequestHuman ? "resolutionType=UNSUPPORTED (categoria fora do catálogo ativo)" : null,
  });
}
