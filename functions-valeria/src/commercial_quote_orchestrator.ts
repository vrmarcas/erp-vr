/**
 * commercial_quote_orchestrator.ts — ValerIA 2.0, Fase E.2.35 (2026-09-22).
 *
 * Extrai, como função reutilizável, a MESMA transição já em produção em
 * `catalog_tools.ts` (linhas ~341-375 na Fase E.2.34, dentro de
 * `valeriaUpdateCatalogQualification`): READY_CATALOG_DRAFT → recarregar
 * produto → revalidar → criar rascunho Vitre → acionar handoff → marcar
 * promovido. Decisão deliberada (item 4 do pedido, "se causar refactor
 * maior que o necessário, reusar diretamente os helpers já existentes,
 * mas não copiar implementação"): NÃO refatora catalog_tools.ts (o
 * endpoint HTTP real V1/V2 em produção, fora do escopo/risco desta fase)
 * — importa e chama os MESMOS helpers (`loadVitreProduct`,
 * `findGroupOf`, `resolveClienteNome`, agora exportados;
 * `createVitreDraftIfNotExists`, `requestQuoteReview`,
 * `markCatalogDraftPromoted`, já exportados) para o active pilot, sem
 * duplicar nenhuma linha de lógica de negócio.
 *
 * DIVERGÊNCIA deliberada do fluxo real (documentada, não acidental):
 * catalog_tools.ts marca `promovido=true` incondicionalmente após tentar
 * o handoff, mesmo que `requestQuoteReview` falhe. Aqui, `promovido` só é
 * marcado quando o handoff REALMENTE teve sucesso (`ok||jaSolicitado`) —
 * mais seguro para o piloto: uma falha de handoff nunca impede uma
 * tentativa futura de acionar o handoff de novo (o rascunho em si
 * continua idempotente de qualquer forma, via doc id determinístico).
 */
import type { CatalogDraft } from "./catalog_draft";
import { markCatalogDraftPromoted, formatPersonalizationForObservacoes } from "./catalog_draft";
import type { CatalogGroup } from "./product_resolution";
import { validateMatchedProduct } from "./qualification_engine";
import { createVitreDraftIfNotExists, type CreateVitreDraftResult } from "./vitre_draft_writer";
import { requestQuoteReview } from "./human_handoff";
import { loadVitreProduct, findGroupOf, resolveClienteNome } from "./catalog_tools";

export interface CommercialSideEffectInput {
  conversationId: string;
  organizationId: string;
  channelPhone: string | null;
  catalogGroups: CatalogGroup[];
  draft: CatalogDraft;
}

export interface CommercialSideEffectResult {
  executed: boolean;
  draftCreated: boolean;
  alreadyExisted: boolean;
  quoteId: string | null;
  handoffRequested: boolean;
  errorCode: string | null;
}

function fail(errorCode: string, overrides: Partial<CommercialSideEffectResult> = {}): CommercialSideEffectResult {
  return { executed: false, draftCreated: false, alreadyExisted: false, quoteId: null, handoffRequested: false, errorCode, ...overrides };
}

/**
 * executeReadyCatalogDraftSideEffects — ÚNICO ponto que cria orçamento
 * real / aciona handoff real a partir do piloto ativo. O chamador
 * (active_pilot_runner.ts) é responsável por checar TODOS os gates
 * (activePilotEnabled, commercialSideEffectsEnabled, allowlists, isTest,
 * humano, qualificationStatus===READY_CATALOG_DRAFT,
 * !draft.promovido) ANTES de chamar esta função — ela mesma revalida o
 * produto/preço (mesma disciplina do fluxo real: "nunca forçar draft
 * como pronto sem essa checagem, mesmo que já tenha passado por aqui
 * antes"), mas não decide elegibilidade de gate.
 */
export async function executeReadyCatalogDraftSideEffects(input: CommercialSideEffectInput): Promise<CommercialSideEffectResult> {
  if (!input.draft.matchedProductId) return fail("PRODUCT_NOT_FOUND");
  if (input.draft.fields.quantity == null || input.draft.fields.quantity <= 0) return fail("INVALID_QUANTITY");

  const produtoFinal = await loadVitreProduct(input.draft.matchedProductId);
  const groupFinal = findGroupOf(input.catalogGroups, input.draft.catalogGroupId);
  const validacaoFinal = validateMatchedProduct(input.draft.matchedProductId, groupFinal, produtoFinal);
  if (!validacaoFinal.valid) return fail(`INVALID_PRODUCT:${validacaoFinal.reasonCode}`);
  if (!produtoFinal?.precoVenda) return fail("PRICE_UNAVAILABLE");

  const clienteNome = await resolveClienteNome(input.channelPhone);

  let draftResult: CreateVitreDraftResult;
  try {
    draftResult = await createVitreDraftIfNotExists({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      clienteNome,
      produto: {
        id: produtoFinal.id!,
        sku: produtoFinal.sku || input.draft.matchedProductSku!,
        nome: produtoFinal.nome || "",
        precoVenda: produtoFinal.precoVenda,
      },
      quantity: input.draft.fields.quantity,
      // Fase E.2.42 — mesmo tratamento do fluxo real (catalog_tools.ts):
      // personalização cosmética vai para observacoes, nunca altera preço/SKU.
      observacoes: formatPersonalizationForObservacoes(input.draft.fields.personalization),
    });
  } catch (e) {
    console.error("[commercial_quote_orchestrator] falha ao criar rascunho Vitre:", (e as Error).message);
    return fail("DRAFT_WRITE_FAILED");
  }

  // Mesmo requestId determinístico usado pelo fluxo real (catalog_tools.ts)
  // — garante que, se algum dia os dois caminhos tocarem a mesma conversa,
  // a idempotência do lado de atdSolicitarHumanoValeria dedupe corretamente,
  // em vez de criar dois registros de handoff paralelos.
  const quoteReviewResult = await requestQuoteReview({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    motivo: "QUOTE_REVIEW",
    requestId: `valeria2_quote_review_${input.conversationId}`,
  });
  const handoffOk = quoteReviewResult.ok || quoteReviewResult.jaSolicitado;

  if (!handoffOk) {
    // Draft já existe e é idempotente — mas NUNCA afirmar ao cliente que
    // foi encaminhado quando o handoff não teve sucesso (ver contrato no
    // active_pilot_runner.ts: executed=false aqui bloqueia o texto
    // REQUEST_QUOTE_REVIEW). Não marca promovido — ver divergência
    // deliberada no cabeçalho do arquivo.
    return fail("HANDOFF_FAILED", { draftCreated: !draftResult.jaProcessado, alreadyExisted: draftResult.jaProcessado, quoteId: draftResult.id });
  }

  await markCatalogDraftPromoted(input.conversationId, "vitre_rascunho", draftResult.id);

  return {
    executed: true,
    draftCreated: !draftResult.jaProcessado,
    alreadyExisted: draftResult.jaProcessado,
    quoteId: draftResult.id,
    handoffRequested: true,
    errorCode: null,
  };
}
