/**
 * catalog_draft.ts — ValerIA 2.0, Fase B (2026-09-19, revisado na
 * continuação da mesma data).
 *
 * Estado temporário de qualificação de produto de catálogo (política
 * CATALOG-FIRST), collection `valeria_catalog_drafts` (1 doc por
 * atendimento/conversa). NÃO é um orçamento — é o "estado da conversa"
 * entre "cliente começou a descrever o que quer" e "sabemos se é produto
 * pronto ou personalizado, e temos o suficiente para virar rascunho".
 *
 * Desenho aprovado (seção 17 do plano): responsabilidades separadas em
 * funções puras testáveis —
 *   A. mergeSignalsIntoDraft   — funde sinais novos no estado existente
 *   B. resolveProductMatch     — decide pronto x personalizado (product_resolution.ts)
 *   C. computeQualificationState — decide o que falta e o status
 *   D. persistência            — loadDraft/saveDraft (Firestore, sem lógica)
 *   E. roteamento              — cabe ao chamador (a Tool HTTP), não aqui
 *
 * CORREÇÃO DE SEMÂNTICA (revisão 2026-09-19): ir para personalizado NÃO é
 * handoff humano. "ROUTED_TO_CUSTOM" é o estado terminal deste módulo
 * quando a resolução é CUSTOM_REQUESTED/CUSTOM_REQUIRED — a partir daí a
 * ValerIA CONTINUA conduzindo a conversa normalmente, só que a qualificação
 * detalhada (dimensões/material/espessura/quantidade) passa a ser
 * responsabilidade do TechnicalBriefing/orchestrator já existentes (que já
 * sabem perguntar só o que falta e herdar defaults) — catalog_draft.ts não
 * duplica esse acompanhamento. Handoff humano real só acontece depois, em
 * QUOTE_REVIEW (reuso de valeria_handoffs — ver plano, seção 18), nunca
 * neste módulo.
 *
 * Quando o estado fica pronto (READY_CATALOG_DRAFT ou ROUTED_TO_CUSTOM), os
 * dados MIGRAM para a estrutura já existente (vitre_orcamentos rascunho ou
 * TechnicalBriefing) — o draft não vira uma segunda base de orçamento
 * permanente, só é marcado `promovido:true` para auditoria.
 */
import * as admin from "firebase-admin";
import type { FieldSource, ResolutionResult } from "./product_resolution";

const COL = "valeria_catalog_drafts";

export type QualificationStatus =
  | "QUALIFYING_CATALOG" // ainda coletando sinais para saber sequer se é pronto ou personalizado
  | "AWAITING_CLIENT_CONFIRMATION" // CATALOG_OPTION_AVAILABLE, esperando "sim"/"não" do cliente
  | "READY_CATALOG_DRAFT" // produto pronto, campos completos → pode virar vitre_orcamentos rascunho
  | "ROUTED_TO_CUSTOM" // personalização — ValerIA CONTINUA conduzindo, responsabilidade de qualificação técnica passa ao TechnicalBriefing (NÃO é handoff humano)
  | "UNSUPPORTED" // categoria fora do catálogo ativo → aí sim, humano
  /**
   * Fase D.2.2 (2026-09-19) — modelo comercial reconhecido
   * (CATALOG_KNOWN_NO_OPERATIONAL_MATCH), mas ainda faltam campos
   * comerciais (normalmente só quantidade) antes de poder encaminhar.
   */
  | "QUALIFYING_CATALOG_UNMAPPED"
  /**
   * Terminal: qualificação comercial completa para um modelo SEM produto
   * operacional. NUNCA cria vitre_orcamentos — só aciona revisão humana
   * com motivo PRODUCT_MAPPING_REQUIRED (diferente de QUOTE_REVIEW).
   */
  | "READY_FOR_PRODUCT_MAPPING_REVIEW";

export interface CatalogDraftFields {
  quantity: number | null;
  customDimensions: { larguraCm: number; alturaCm: number; profundidadeCm?: number | null } | null;
  personalization: string[]; // ex.: ["adesivo_logo_tampa"]
  desiredDeadline: string | null; // ISO-8601, sempre "desejado", nunca "confirmado"
  deliveryData: { cidade?: string | null; observacoes?: string | null } | null;
}

export interface CatalogDraft {
  conversationId: string;
  atendimentoId: string | null;
  /**
   * Fase E.1.2 (2026-09-20) — derivado UMA VEZ, na criação do draft, de
   * `atendimentos/{conversationId}.isTeste` (mesma disciplina já usada em
   * action_executor.ts para orçamentos: nunca inferido de nome/padrão de
   * texto, nunca informado pelo LLM). `mergeSignalsIntoDraft` espalha
   * `...draft` a cada turno, então este valor sobrevive automaticamente a
   * toda a conversa sem precisar ser re-derivado.
   */
  isTest: boolean;
  category: string | null;
  catalogGroupId: string | null;

  resolutionType: ResolutionResult["resolutionType"] | null;
  matchedProductId: string | null; // ID REAL de vitre_produtos — só EXACT_CATALOG_MATCH/CATALOG_OPTION confirmado
  matchedProductSku: string | null; // SKU correspondente — contrato id≠sku, ver product_resolution.ts
  /**
   * Correção de semântica (2026-09-19): campos separados, nunca um
   * substituindo o outro — ver product_resolution.ts::ResolutionResult.
   */
  baseCatalogGroupId: string | null;
  baseProductId: string | null;
  baseProductSku: string | null;
  clientConfirmed: boolean;
  customizationRequired: boolean;
  customizationReason: string | null;

  fields: CatalogDraftFields;
  fieldSources: Record<string, FieldSource>;

  qualificationStatus: QualificationStatus;
  missingFields: string[];

  promovido: boolean;
  promovidoParaTipo?: "vitre_rascunho" | "technical_briefing" | "product_mapping_review" | "unsupported_handoff" | null;
  promovidoParaId?: string | null;

  createdAt: number;
  updatedAt: number;
}

export function emptyCatalogDraft(conversationId: string, atendimentoId: string | null = null, isTest: boolean = false): CatalogDraft {
  const now = Date.now();
  return {
    conversationId,
    atendimentoId,
    isTest,
    category: null,
    catalogGroupId: null,
    resolutionType: null,
    matchedProductId: null,
    matchedProductSku: null,
    baseCatalogGroupId: null,
    baseProductId: null,
    baseProductSku: null,
    clientConfirmed: false,
    customizationRequired: false,
    customizationReason: null,
    fields: { quantity: null, customDimensions: null, personalization: [], desiredDeadline: null, deliveryData: null },
    fieldSources: {},
    qualificationStatus: "QUALIFYING_CATALOG",
    missingFields: [],
    promovido: false,
    promovidoParaTipo: null,
    promovidoParaId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface FieldUpdate {
  category?: string | null;
  quantity?: number | null;
  customDimensions?: CatalogDraftFields["customDimensions"];
  personalization?: string[];
  desiredDeadline?: string | null;
  deliveryData?: CatalogDraftFields["deliveryData"];
}

/**
 * Fase E.2.42 — único ponto que transforma `personalization: string[]` em
 * texto para o campo `observacoes` já existente em vitre_orcamentos (lido
 * de volta pelo wizard Vitre em vitreOrcAbrirRascunho, ver index.html —
 * zero mudança de UI necessária). Nunca afeta preço/SKU — é só anotação
 * para revisão humana (Fase E.2.42, item 7 do pedido: personalização
 * cosmética preserva o SKU, mas não é automaticamente gratuita). `undefined`
 * quando não há nada a anotar, para nunca sobrescrever um `observacoes`
 * manual do humano com uma string vazia.
 */
export function formatPersonalizationForObservacoes(personalization: string[] | null | undefined): string | undefined {
  if (!personalization || personalization.length === 0) return undefined;
  const itens = personalization.map((p) => p.trim()).filter((p) => p.length > 0);
  if (itens.length === 0) return undefined;
  return "Personalização (ValerIA): " + itens.join("; ");
}

/**
 * A. Funde a decisão de resolução + campos novos extraídos neste turno no
 * draft existente. Pura — não decide nada sozinha, só aplica o que já foi
 * decidido por resolveProductMatch e o que o LLM extraiu como sinal deste
 * turno. `source` é aplicado a cada campo realmente alterado por esta
 * chamada (nunca retroativo aos campos já existentes).
 */
export function mergeSignalsIntoDraft(
  draft: CatalogDraft,
  resolution: ResolutionResult | null,
  fieldUpdate: FieldUpdate,
  source: FieldSource
): CatalogDraft {
  const next: CatalogDraft = {
    ...draft,
    fields: { ...draft.fields },
    fieldSources: { ...draft.fieldSources },
    updatedAt: Date.now(),
  };

  if (resolution) {
    next.resolutionType = resolution.resolutionType;
    next.catalogGroupId = resolution.catalogGroupId ?? draft.catalogGroupId;
    // matchedProductId/matchedProductSku/baseCatalogGroupId/baseProductId/baseProductSku só são
    // sobrescritos quando a resolução deste turno realmente aponta algo — nunca apaga um valor
    // anterior por causa de um turno AMBIGUOUS subsequente.
    if (resolution.matchedProductId) next.matchedProductId = resolution.matchedProductId;
    if (resolution.matchedProductSku) next.matchedProductSku = resolution.matchedProductSku;
    if (resolution.baseCatalogGroupId) next.baseCatalogGroupId = resolution.baseCatalogGroupId;
    if (resolution.baseProductId) next.baseProductId = resolution.baseProductId;
    if (resolution.baseProductSku) next.baseProductSku = resolution.baseProductSku;
    next.clientConfirmed = resolution.clientConfirmed || draft.clientConfirmed;
    next.customizationRequired = resolution.customizationRequired;
    next.customizationReason = resolution.customizationReason ?? draft.customizationReason;
  }

  if (fieldUpdate.category !== undefined && fieldUpdate.category !== null) {
    next.category = fieldUpdate.category;
    next.fieldSources.category = source;
  }
  if (fieldUpdate.quantity !== undefined && fieldUpdate.quantity !== null) {
    next.fields.quantity = fieldUpdate.quantity;
    next.fieldSources.quantity = source;
  }
  if (fieldUpdate.customDimensions !== undefined && fieldUpdate.customDimensions !== null) {
    next.fields.customDimensions = fieldUpdate.customDimensions;
    next.fieldSources.customDimensions = source;
  }
  if (fieldUpdate.personalization !== undefined && fieldUpdate.personalization.length > 0) {
    next.fields.personalization = fieldUpdate.personalization;
    next.fieldSources.personalization = source;
  }
  if (fieldUpdate.desiredDeadline !== undefined && fieldUpdate.desiredDeadline !== null) {
    next.fields.desiredDeadline = fieldUpdate.desiredDeadline;
    next.fieldSources.desiredDeadline = source;
  }
  if (fieldUpdate.deliveryData !== undefined && fieldUpdate.deliveryData !== null) {
    next.fields.deliveryData = fieldUpdate.deliveryData;
    next.fieldSources.deliveryData = source;
  }

  return next;
}

/**
 * C. Decide o que falta e o status de qualificação — só olha para o estado
 * já mesclado (draft), nunca para Firestore/tempo real. Espelha a seção 13
 * do plano aprovado: produto pronto não pede material/espessura/dimensão
 * (isso já veio do SKU); personalizado passa a responsabilidade técnica ao
 * TechnicalBriefing existente (não duplica coleta de geometria aqui) —
 * MAS isso não é handoff humano, é só onde a qualificação técnica
 * continua (ver cabeçalho do arquivo).
 */
export function computeQualificationState(draft: CatalogDraft): { qualificationStatus: QualificationStatus; missingFields: string[] } {
  switch (draft.resolutionType) {
    case "UNSUPPORTED":
      return { qualificationStatus: "UNSUPPORTED", missingFields: [] };

    case "CUSTOM_REQUIRED":
    case "CUSTOM_REQUESTED":
      // A ValerIA continua a conversa — só que a partir daqui quem sabe o
      // que falta é o TechnicalBriefing/orchestrator (não duplicamos essa
      // lógica aqui). Ver ROUTED_TO_CUSTOM no cabeçalho: NÃO é handoff humano.
      return { qualificationStatus: "ROUTED_TO_CUSTOM", missingFields: [] };

    case "CATALOG_OPTION_AVAILABLE":
      if (!draft.clientConfirmed) {
        return { qualificationStatus: "AWAITING_CLIENT_CONFIRMATION", missingFields: ["clientConfirmation"] };
      }
      return computeReadyForCatalogMatch(draft);

    case "EXACT_CATALOG_MATCH":
      return computeReadyForCatalogMatch(draft);

    case "CATALOG_KNOWN_NO_OPERATIONAL_MATCH":
      // Modelo comercial reconhecido, sem productId — só quantidade é
      // exigida (nunca matchedProductId, que não existe aqui de propósito).
      // NUNCA vira READY_CATALOG_DRAFT (nunca cria vitre_orcamentos).
      if (draft.fields.quantity == null || draft.fields.quantity <= 0) {
        return { qualificationStatus: "QUALIFYING_CATALOG_UNMAPPED", missingFields: ["quantity"] };
      }
      return { qualificationStatus: "READY_FOR_PRODUCT_MAPPING_REVIEW", missingFields: [] };

    case "AMBIGUOUS":
    case null:
    default:
      // sem produto identificado ainda: nunca "pronto", nunca roteado.
      return { qualificationStatus: "QUALIFYING_CATALOG", missingFields: draft.catalogGroupId ? ["tamanho"] : ["catalogGroupId"] };
  }
}

function computeReadyForCatalogMatch(draft: CatalogDraft): { qualificationStatus: QualificationStatus; missingFields: string[] } {
  const missing: string[] = [];
  if (!draft.matchedProductId) missing.push("matchedProductId");
  if (draft.fields.quantity == null || draft.fields.quantity <= 0) missing.push("quantity");
  if (missing.length > 0) return { qualificationStatus: "QUALIFYING_CATALOG", missingFields: missing };
  return { qualificationStatus: "READY_CATALOG_DRAFT", missingFields: [] };
}

// ── D. Persistência (sem lógica de decisão — só I/O) ───────────────────────

export async function loadCatalogDraft(conversationId: string): Promise<CatalogDraft | null> {
  const snap = await admin.firestore().collection(COL).doc(conversationId).get();
  if (!snap.exists) return null;
  return snap.data() as CatalogDraft;
}

export async function saveCatalogDraft(draft: CatalogDraft): Promise<void> {
  await admin
    .firestore()
    .collection(COL)
    .doc(draft.conversationId)
    .set({ ...draft, updatedAt: Date.now() }, { merge: false });
}

export async function markCatalogDraftPromoted(
  conversationId: string,
  tipo: "vitre_rascunho" | "technical_briefing" | "product_mapping_review" | "unsupported_handoff",
  id: string
): Promise<void> {
  await admin
    .firestore()
    .collection(COL)
    .doc(conversationId)
    .set({ promovido: true, promovidoParaTipo: tipo, promovidoParaId: id, updatedAt: Date.now() }, { merge: true });
}
