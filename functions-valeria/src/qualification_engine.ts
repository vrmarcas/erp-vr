/**
 * qualification_engine.ts — ValerIA 2.0, Fase C.1 (endurecimento operacional, 2026-09-19).
 *
 * Camada de composição PURA entre product_resolution.ts (decide pronto x
 * personalizado) e catalog_draft.ts (estado de qualificação), usada pela
 * Tool HTTP `valeriaUpdateCatalogQualification`. Responsabilidades:
 *   - validateMatchedProduct  — NUNCA confia num productId vindo do LLM
 *   - computeNextAction       — traduz estado em (nextAction, questionContext)
 *     estruturados, SEM texto pronto (a Tool não escreve a frase da ValerIA)
 *   - buildQualificationOutput — payload final, incluindo o que o backend
 *     JÁ EXECUTOU nesta chamada (seção 14 — `persistence`)
 *
 * ENDURECIMENTO OPERACIONAL (2026-09-19): antes, `nextAction` dizia ao LLM
 * "agora chame a Tool X" (CREATE_CATALOG_DRAFT → LLM chamaria
 * criar_rascunho_vitre; ROUTED_TO_CUSTOM → LLM chamaria
 * atualizar_briefing_tecnico). Isso criava uma cadeia LLM→Tool A→Tool B
 * desnecessária para uma transição 100% determinística. Agora
 * `valeriaUpdateCatalogQualification` (catalog_tools.ts) EXECUTA essas
 * transições server-side dentro da MESMA chamada (vitre_draft_writer.ts
 * para o rascunho Vitre; technical_briefing_store.ts, já no mesmo
 * codebase, para o TechnicalBriefing; human_handoff.ts para o handoff) —
 * este módulo só decide O QUE fazer e relata O QUE JÁ FOI FEITO. `nextAction`
 * continua existindo, mas agora é só orientação de CONVERSA (ex.:
 * "pergunte a quantidade"), nunca mais "chame esta outra Tool".
 */
import type { CatalogGroup, ResolutionType } from "./product_resolution";
import type { CatalogDraft, QualificationStatus } from "./catalog_draft";
import { evaluateValeriaV2ProductEligibility, V2EligibilityProductInput } from "./valeria_v2_eligibility";

export type NextAction =
  | "ASK_MODEL"
  | "ASK_SIZE"
  | "CONFIRM_CATALOG_OPTION"
  | "ASK_QUANTITY"
  | "CONTINUE_CUSTOM_TECHNICAL_BRIEFING" // conversa — backend já seedou o TechnicalBriefing nesta chamada, só falta perguntar o resto
  | "REQUEST_QUOTE_REVIEW" // backend JÁ criou o rascunho e JÁ acionou o handoff — LLM só avisa o cliente
  | "ESCALATE_UNSUPPORTED"
  /**
   * Fase D.2.2 — backend JÁ acionou a revisão humana com motivo
   * PRODUCT_MAPPING_REQUIRED (modelo comercial reconhecido, sem SKU
   * operacional). Diferente de REQUEST_QUOTE_REVIEW: aqui NÃO existe
   * rascunho Vitre — o LLM só avisa o cliente que a equipe vai confirmar
   * os detalhes desse modelo específico.
   */
  | "REQUEST_PRODUCT_MAPPING_REVIEW";

export interface QuestionContext {
  groupName?: string | null;
  productName?: string | null;
  suggestedSizeLabel?: string | null;
  [key: string]: unknown;
}

export interface ValidateMatchedProductResult {
  valid: boolean;
  reasonCode:
    | "OK"
    | "NO_CANDIDATE"
    | "PRODUCT_NOT_FOUND"
    | "ID_MISMATCH"
    | "NOT_IN_GROUP"
    | "NOT_ELIGIBLE";
}

/**
 * H/12/15. Segurança de IDs — um productId "sugerido" (pelo LLM ou por uma
 * resolução anterior) só é aceito depois de bater as 3 checagens: existe
 * (o chamador já carregou do Firestore), pertence ao grupo/tamanho
 * correto, e está realmente elegível hoje. `group` pode ser null quando a
 * resolução não passou por um grupo de catálogo (ex.: SKU explícito
 * direto) — nesse caso só valida elegibilidade.
 */
export function validateMatchedProduct(
  candidateProductId: string | null,
  group: CatalogGroup | null,
  vitreProduct: V2EligibilityProductInput | null
): ValidateMatchedProductResult {
  if (!candidateProductId) return { valid: false, reasonCode: "NO_CANDIDATE" };
  if (!vitreProduct) return { valid: false, reasonCode: "PRODUCT_NOT_FOUND" };
  if (vitreProduct.id !== candidateProductId) return { valid: false, reasonCode: "ID_MISMATCH" };
  const homologadoNoGrupoV2 = !group || group.tamanhos.some((t) => t.vitreProductId === candidateProductId);
  if (group && !homologadoNoGrupoV2) return { valid: false, reasonCode: "NOT_IN_GROUP" };
  const eligibility = evaluateValeriaV2ProductEligibility(vitreProduct, {
    homologadoNoGrupoV2,
    catalogGroupId: group?.catalogGroupId ?? null,
  });
  if (!eligibility.eligible) return { valid: false, reasonCode: "NOT_ELIGIBLE" };
  return { valid: true, reasonCode: "OK" };
}

export interface NextActionContext {
  matchedProductName?: string | null;
  suggestedOptionLabel?: string | null;
  groupName?: string | null;
  /** true quando o backend JÁ criou o rascunho + acionou QUOTE_REVIEW nesta mesma chamada (catálogo). */
  catalogDraftCreatedThisCall?: boolean;
  /** true quando o backend JÁ determinou (via computeTechnicalReadiness) que o personalizado está completo e acionou o pipeline existente. */
  customPipelineReadyThisCall?: boolean;
}

/**
 * 13/14. Traduz (qualificationStatus + missingFields + o que já foi
 * executado nesta chamada) numa ação de CONVERSA — nunca mais "chame outra
 * Tool". O LLM recebe nextAction + questionContext e formula a frase
 * natural; a decisão de O QUE falta e O QUE fazer continua 100% do backend.
 */
export function computeNextAction(
  qualification: { qualificationStatus: QualificationStatus; missingFields: string[] },
  context: NextActionContext = {}
): { nextAction: NextAction; questionContext: QuestionContext } {
  switch (qualification.qualificationStatus) {
    case "UNSUPPORTED":
      return { nextAction: "ESCALATE_UNSUPPORTED", questionContext: {} };

    case "AWAITING_CLIENT_CONFIRMATION":
      return {
        nextAction: "CONFIRM_CATALOG_OPTION",
        questionContext: { suggestedSizeLabel: context.suggestedOptionLabel ?? null, groupName: context.groupName ?? null },
      };

    case "ROUTED_TO_CUSTOM":
      // Backend já seedou o TechnicalBriefing nesta mesma chamada (seção 7 —
      // reuso direto de technical_briefing_store.ts, mesmo codebase). Se
      // customPipelineReadyThisCall, o pipeline existente já foi acionado e
      // o próximo estado real chega via buscar_contexto_da_conversa — aqui
      // ainda respondemos como conversa em andamento (nunca handoff).
      return {
        nextAction: "CONTINUE_CUSTOM_TECHNICAL_BRIEFING",
        questionContext: { groupName: context.groupName ?? null },
      };

    case "READY_CATALOG_DRAFT":
      // Backend já criou o rascunho + já acionou QUOTE_REVIEW (catalog_tools.ts)
      // antes de chegar aqui — nextAction é só "avise o cliente", não "crie o rascunho".
      return { nextAction: "REQUEST_QUOTE_REVIEW", questionContext: { productName: context.matchedProductName ?? null } };

    case "READY_FOR_PRODUCT_MAPPING_REVIEW":
      // Fase D.2.2 — backend já acionou a revisão humana (PRODUCT_MAPPING_REQUIRED),
      // nunca criou vitre_orcamentos (não existe productId). LLM só avisa.
      return { nextAction: "REQUEST_PRODUCT_MAPPING_REVIEW", questionContext: { groupName: context.groupName ?? null } };

    case "QUALIFYING_CATALOG_UNMAPPED":
      // Mesmo sem produto operacional, a ValerIA continua coletando dados
      // comerciais úteis (seção 9) — hoje só quantidade é obrigatória.
      return { nextAction: "ASK_QUANTITY", questionContext: { groupName: context.groupName ?? null } };

    case "QUALIFYING_CATALOG":
    default:
      if (qualification.missingFields.includes("catalogGroupId")) {
        return { nextAction: "ASK_MODEL", questionContext: {} };
      }
      if (qualification.missingFields.includes("tamanho") || qualification.missingFields.includes("matchedProductId")) {
        return { nextAction: "ASK_SIZE", questionContext: { groupName: context.groupName ?? null } };
      }
      if (qualification.missingFields.includes("quantity")) {
        return { nextAction: "ASK_QUANTITY", questionContext: { productName: context.matchedProductName ?? null } };
      }
      return { nextAction: "ASK_MODEL", questionContext: {} };
  }
}

export interface QualificationPersistence {
  /** true quando esta chamada gravou/atualizou o estado de qualificação (quase sempre true). */
  qualificationUpdated: boolean;
  /** true quando esta chamada gravou algo no TechnicalBriefing existente (fluxo personalizado). */
  technicalBriefingUpdated: boolean;
  /** true quando esta chamada criou (ou confirmou já existente) o rascunho de catálogo Vitre. */
  catalogDraftCreated: boolean;
  /** true quando esta chamada disparou o handoff/QUOTE_REVIEW (draft operacional pronto). */
  quoteReviewCreated: boolean;
  /**
   * Fase D.2.2 — true quando esta chamada disparou o handoff com motivo
   * PRODUCT_MAPPING_REQUIRED (modelo comercial sem productId). Sempre
   * junto com catalogDraftCreated=false — nunca os dois juntos.
   */
  productMappingReviewRequested: boolean;
}

export interface QualificationEngineOutput {
  resolutionType: ResolutionType | null;
  qualificationStatus: QualificationStatus;
  matchedProduct: { id: string | null; sku: string | null };
  baseProduct: { id: string | null; sku: string | null };
  baseCatalogGroupId: string | null;
  missingFields: string[];
  persistence: QualificationPersistence;
  nextAction: NextAction;
  questionContext: QuestionContext;
}

/** Monta o payload final de saída da Tool — inclui o que o backend JÁ EXECUTOU nesta chamada (seção 14/15). */
export function buildQualificationOutput(
  draft: CatalogDraft,
  qualification: { qualificationStatus: QualificationStatus; missingFields: string[] },
  next: { nextAction: NextAction; questionContext: QuestionContext },
  persistence: QualificationPersistence
): QualificationEngineOutput {
  return {
    resolutionType: draft.resolutionType,
    qualificationStatus: qualification.qualificationStatus,
    matchedProduct: { id: draft.matchedProductId, sku: draft.matchedProductSku },
    baseProduct: { id: draft.baseProductId, sku: draft.baseProductSku },
    baseCatalogGroupId: draft.baseCatalogGroupId,
    missingFields: qualification.missingFields,
    persistence,
    nextAction: next.nextAction,
    questionContext: next.questionContext,
  };
}
