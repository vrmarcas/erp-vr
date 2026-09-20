/**
 * catalog_tools.ts — ValerIA 2.0, Fase C.1 (endurecimento operacional, 2026-09-19).
 *
 * As 2 Tools HTTP autorizadas (seção 9/10 do plano): `valeriaGetCatalog` e
 * `valeriaUpdateCatalogQualification`. A segunda agora EXECUTA
 * deterministicamente as transições que antes exigiam o LLM chamar uma
 * segunda Tool (endurecimento operacional 2026-09-19 — ver
 * qualification_engine.ts para o porquê): catálogo completo → cria o
 * rascunho Vitre + aciona QUOTE_REVIEW nesta MESMA chamada;
 * personalizado → semeia o TechnicalBriefing existente nesta MESMA
 * chamada (mesmo codebase, reuso direto de technical_briefing_store.ts).
 *
 * Exportadas em index.ts a partir da Fase E (2026-09-19) — ainda NÃO
 * cadastradas como Tool no agente Chatvolt (isso é um checkpoint separado,
 * pendente de revisão explícita do prompt/Tools antes de qualquer troca
 * na configuração real do agente).
 */
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

import { pipeline } from "./pipeline";
import { ok, err } from "./response";
import { getActiveCatalogConfig, getAllActiveCatalogConfigs, catalogGroupsFromConfig } from "./catalog";
import {
  loadCatalogDraft,
  saveCatalogDraft,
  markCatalogDraftPromoted,
  emptyCatalogDraft,
  mergeSignalsIntoDraft,
  computeQualificationState,
  FieldUpdate,
} from "./catalog_draft";
import { resolveProductMatch, ResolutionSignals, CatalogGroup, ResolutionResult } from "./product_resolution";
import { validateMatchedProduct, computeNextAction, buildQualificationOutput, QualificationPersistence } from "./qualification_engine";
import { evaluateValeriaV2ProductEligibility, V2EligibilityProductInput } from "./valeria_v2_eligibility";
import { createVitreDraftIfNotExists } from "./vitre_draft_writer";
import { requestQuoteReview } from "./human_handoff";
import { loadTechnicalBriefing, saveTechnicalBriefing, mergeTechnicalBriefing } from "./technical_briefing_store";
import { buildCustomTechnicalBriefingPatch } from "./custom_briefing_patch";
import { fsRead } from "./kv_store";
import { encontrarPorTelefone } from "./telefone";
import type { Cliente } from "./types";
import { valeriaV2EnabledForPhone } from "./feature_flags";

if (!admin.apps.length) admin.initializeApp();

const VITRE_COL = "vitre_produtos";
const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
const RUN_OPTS = functions.runWith({ secrets: SECRET_NAMES, timeoutSeconds: 30, memory: "256MB" });

/**
 * Categoria → nome de receita (PLAN_RECIPES) para o TechnicalBriefing.
 * Escopo deliberadamente mínimo (só "caixas" existe hoje, Fase D trará
 * mais categorias reais) — nunca inventar mapeamento para categoria não
 * homologada.
 *
 * ISOLAMENTO V1×V2 (Fase D.2.1, 2026-09-19 — decisão: Modelo 11/Go!Jovem
 * migra para catálogo-first, hardcode legado NÃO é deletado, mas V2 nunca
 * o aciona): "trofeus" É DE PROPÓSITO omitido daqui. `mergeTechnicalBriefing`
 * (technical_briefing_store.ts:85) detecta `isTrofeuGoJovemAlias(patch.productId)`
 * e, se bater, sobrescreve productId/material/espessura/dimensões para o
 * envelope hardcoded do Troféu GoJovem — MAS só quando `patch.productId`
 * é uma string que bate no alias. Como esta categoria não está mapeada
 * aqui, `buildCustomTechnicalBriefingPatch` nunca inclui `productId` no
 * patch para personalização estrutural de troféu — logo o hardcode legado
 * nunca é acionado pelo fluxo V2 (só o Tool legado
 * `atualizar_briefing_tecnico`, chamado apenas pelo prompt V1, pode
 * disparar isso). O caminho PADRÃO (EXACT_CATALOG_MATCH, sem
 * personalização estrutural) nem chega perto do TechnicalBriefing — vai
 * direto para vitre_draft_writer.ts. Ver
 * __tests__/trofeu_v1_v2_isolation.test.ts para a prova.
 */
const CATEGORIA_PARA_RECEITA: Record<string, string> = { caixas: "Caixa" };

async function loadVitreProduct(productId: string): Promise<V2EligibilityProductInput | null> {
  const snap = await admin.firestore().collection(VITRE_COL).doc(productId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<V2EligibilityProductInput, "id">) };
}

function findGroupOf(groups: CatalogGroup[], catalogGroupId: string | null): CatalogGroup | null {
  if (!catalogGroupId) return null;
  return groups.find((g) => g.catalogGroupId === catalogGroupId) || null;
}

async function resolveClienteNome(channelPhone: string | null | undefined): Promise<string> {
  if (!channelPhone) return "Cliente WhatsApp";
  try {
    const clientes = await fsRead<Cliente[]>("clientes");
    const cliente = clientes ? encontrarPorTelefone(channelPhone, clientes, (c) => c.tel) : null;
    return cliente?.nome || "Cliente WhatsApp";
  } catch {
    return "Cliente WhatsApp";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. VALERIA_GET_CATALOG — seção 10 do plano.
// Não retorna custo/margem/dados internos; não lista tamanho cujo SKU Vitre
// não seja elegível para a V2 (evaluateValeriaV2ProductEligibility — NÃO o
// gate legado produtoElegivelValeria/ativoValeria, ver valeria_v2_eligibility.ts).
// Estar referenciado no grupo (t.vitreProductId) já é a homologação V2.
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaGetCatalog = RUN_OPTS.https.onRequest(async (req, res) => {
  const ppl = await pipeline(req, res, "valeriaGetCatalog");
  if (!ppl) return;
  const { ctx } = ppl;

  // H (endurecimento operacional) — gate de feature flag: nenhuma lógica
  // V2 roda para fora da allowlist, mesmo que a Tool já esteja deployada.
  if (!(await valeriaV2EnabledForPhone(ctx.channelPhone ?? null))) {
    res.status(403).json(err("V2_DISABLED", "ValerIA 2.0 não está habilitada para este número.", { communicableToCustomer: false }));
    return;
  }

  try {
    const body = req.body as Record<string, unknown>;
    const categoria = String(body["categoria"] || "").trim();
    if (!categoria) {
      res.status(400).json(err("MISSING_CATEGORIA", "Informe a categoria do catálogo.", { communicableToCustomer: false }));
      return;
    }

    const config = await getActiveCatalogConfig(categoria);
    if (!config) {
      res.json(
        ok(
          { categoria, disponivel: false, urlCatalogo: null, grupos: [] },
          { communicableToCustomer: false, verified: true }
        )
      );
      return;
    }

    const grupos = [];
    for (const g of config.grupos) {
      const tamanhosElegiveis: Array<{ tamanho: string; larguraCm: number; alturaCm: number; profundidadeCm: number | null; productId: string; sku: string; nome: string; precoVenda: number | null }> = [];
      for (const t of g.tamanhos) {
        const produto = await loadVitreProduct(t.vitreProductId);
        const eligibility = evaluateValeriaV2ProductEligibility(produto, { homologadoNoGrupoV2: true, catalogGroupId: g.catalogGroupId });
        if (!eligibility.eligible || !produto || !produto.id) continue; // nunca lista produto inelegível para V2 como opção
        tamanhosElegiveis.push({
          tamanho: t.tamanho,
          larguraCm: t.larguraCm,
          alturaCm: t.alturaCm,
          profundidadeCm: t.profundidadeCm ?? null,
          productId: produto.id, // ID real — necessário para o pipeline (seção 10: "pode retornar IDs")
          sku: produto.sku || t.vitreProductSku, // SKU comercial — distinto do id (contrato Fase C)
          nome: produto.nome || g.nome,
          precoVenda: produto.precoVenda ?? null, // preço de catálogo publicado — nunca custo/margem
        });
      }
      // Fase D.2.2: grupo continua sendo OFERECIDO mesmo sem nenhum tamanho
      // elegível — é um modelo comercial conhecido do catálogo (a ValerIA
      // precisa reconhecer "Modelo 07" mesmo sem SKU no ERP). `tamanhos:[]`
      // sinaliza catálogo comercial sem produto operacional; a Tool de
      // qualificação (valeriaUpdateCatalogQualification) trata isso como
      // CATALOG_KNOWN_NO_OPERATIONAL_MATCH, nunca inventa SKU/preço.
      grupos.push({
        catalogGroupId: g.catalogGroupId,
        nome: g.nome,
        aliases: g.aliases,
        materialPadrao: g.materialPadrao ?? null,
        espessuraPadraoMm: g.espessuraPadraoMm ?? null,
        catalogSubtype: g.catalogSubtype ?? null,
        operationallyMapped: tamanhosElegiveis.length > 0,
        tamanhos: tamanhosElegiveis,
      });
    }

    res.json(
      ok(
        { categoria, disponivel: grupos.length > 0, urlCatalogo: config.urlCatalogo, grupos },
        { communicableToCustomer: false, verified: true }
      )
    );
  } catch (e) {
    console.error("[valeriaGetCatalog]", (e as Error).message);
    res.status(500).json(err("INTERNAL_ERROR", "Erro ao consultar catálogo."));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. VALERIA_UPDATE_CATALOG_QUALIFICATION — seção 11/12/13 do plano.
// O LLM manda sinais extraídos (nunca uma decisão final); o backend resolve
// (resolveProductMatch), REVALIDA qualquer productId candidato contra o
// Firestore (validateMatchedProduct — nunca confia cego), funde no draft,
// calcula o que falta e devolve nextAction/questionContext estruturados
// (nunca texto pronto).
// ─────────────────────────────────────────────────────────────────────────────
export const valeriaUpdateCatalogQualification = RUN_OPTS.https.onRequest(async (req, res) => {
  const ppl = await pipeline(req, res, "valeriaUpdateCatalogQualification");
  if (!ppl) return;
  const { ctx } = ppl;

  // H (endurecimento operacional) — gate de feature flag: nenhuma
  // transição determinística (rascunho/handoff/TechnicalBriefing) roda
  // para fora da allowlist, mesmo que a Tool já esteja deployada.
  if (!(await valeriaV2EnabledForPhone(ctx.channelPhone ?? null))) {
    res.status(403).json(err("V2_DISABLED", "ValerIA 2.0 não está habilitada para este número.", { communicableToCustomer: false }));
    return;
  }

  try {
    const body = req.body as Record<string, unknown>;

    const draftAtual = (await loadCatalogDraft(ctx.conversationId)) || emptyCatalogDraft(ctx.conversationId);

    const categoria = (body["categoria"] as string) || draftAtual.category || null;
    const configs = categoria ? [await getActiveCatalogConfig(categoria)].filter(Boolean) : await getAllActiveCatalogConfigs();
    const groups: CatalogGroup[] = configs.flatMap((c) => catalogGroupsFromConfig(c!));

    const signals: ResolutionSignals = {
      categoria,
      explicitSkuOrProductId: (body["explicitSkuOrProductId"] as string) || null,
      groupNameOrAlias: (body["groupNameOrAlias"] as string) || null,
      catalogSizeLabel: (body["catalogSizeLabel"] as string) || null,
      exactDimensionsCm: (body["exactDimensionsCm"] as ResolutionSignals["exactDimensionsCm"]) || null,
      vagueSizeHintCm: typeof body["vagueSizeHintCm"] === "number" ? (body["vagueSizeHintCm"] as number) : null,
      customerExplicitlyRequestsCustom: body["customerExplicitlyRequestsCustom"] === true,
      contextCatalogGroupId: draftAtual.baseCatalogGroupId || draftAtual.catalogGroupId || null,
      contextMatchedProductId: draftAtual.matchedProductId || draftAtual.baseProductId || null,
      contextMatchedProductSku: draftAtual.matchedProductSku || draftAtual.baseProductSku || null,
      clientConfirmedSuggestedOption: body["clientConfirmedSuggestedOption"] === true,
    };

    let resolution: ResolutionResult = resolveProductMatch(signals, groups);

    // SEGURANÇA (seção 12): todo matchedProductId candidato é revalidado
    // contra o Firestore antes de ser aceito — nunca confiamos no SKU só
    // porque resolveProductMatch (que nem sabe se o produto está
    // ativo/elegível hoje — ele só sabe geometria de catálogo) devolveu um.
    let matchedProductName: string | null = null;
    if (resolution.matchedProductId) {
      const group = findGroupOf(groups, resolution.catalogGroupId);
      const produto = await loadVitreProduct(resolution.matchedProductId);
      const validation = validateMatchedProduct(resolution.matchedProductId, group, produto);
      if (!validation.valid) {
        console.warn(
          `[valeriaUpdateCatalogQualification] productId candidato rejeitado (${validation.reasonCode}): ${resolution.matchedProductId}`
        );
        resolution = {
          ...resolution,
          resolutionType: "AMBIGUOUS",
          matchedProductId: null,
          matchedProductSku: null,
          clientConfirmed: false,
          matchConfidence: 0,
          reasonCode: `REJECTED_${validation.reasonCode}`,
        };
      } else {
        matchedProductName = produto!.nome || null;
      }
    }

    const fieldUpdate: FieldUpdate = {
      category: categoria,
      quantity: typeof body["quantity"] === "number" ? (body["quantity"] as number) : null,
      customDimensions: (body["customDimensions"] as FieldUpdate["customDimensions"]) || null,
      personalization: Array.isArray(body["personalization"]) ? (body["personalization"] as string[]) : undefined,
      desiredDeadline: (body["desiredDeadline"] as string) || null,
      deliveryData: (body["deliveryData"] as FieldUpdate["deliveryData"]) || null,
    };

    const draftAtualizado = mergeSignalsIntoDraft(draftAtual, resolution, fieldUpdate, "CUSTOMER");
    const qualification = computeQualificationState(draftAtualizado);
    draftAtualizado.qualificationStatus = qualification.qualificationStatus;
    draftAtualizado.missingFields = qualification.missingFields;

    await saveCatalogDraft(draftAtualizado);

    const persistence: QualificationPersistence = {
      qualificationUpdated: true,
      technicalBriefingUpdated: false,
      catalogDraftCreated: false,
      quoteReviewCreated: false,
      productMappingReviewRequested: false,
    };

    // ── Transição determinística 1: catálogo completo → cria rascunho Vitre
    // + aciona QUOTE_REVIEW NESTA MESMA CHAMADA (seções 3/5 do endurecimento
    // — elimina LLM precisar chamar criar_rascunho_vitre depois). Idempotente
    // via doc id determinístico (vitre_draft_writer.ts) — B/C dos testes.
    if (qualification.qualificationStatus === "READY_CATALOG_DRAFT" && !draftAtualizado.promovido) {
      const produtoFinal = await loadVitreProduct(draftAtualizado.matchedProductId!);
      const groupFinal = findGroupOf(groups, draftAtualizado.catalogGroupId);
      const validacaoFinal = validateMatchedProduct(draftAtualizado.matchedProductId, groupFinal, produtoFinal);
      // Revalidação final antes de gastar dinheiro/ação real (seção 15 —
      // nunca forçar draft como pronto sem essa checagem, mesmo que já
      // tenha passado por aqui antes: dados podem ter mudado entre chamadas).
      if (validacaoFinal.valid && produtoFinal?.precoVenda) {
        const clienteNome = await resolveClienteNome(ctx.channelPhone);
        const draftResult = await createVitreDraftIfNotExists({
          conversationId: ctx.conversationId,
          organizationId: ctx.organizationId,
          clienteNome,
          produto: { id: produtoFinal.id!, sku: produtoFinal.sku || draftAtualizado.matchedProductSku!, nome: produtoFinal.nome || "", precoVenda: produtoFinal.precoVenda },
          quantity: draftAtualizado.fields.quantity!,
        });
        persistence.catalogDraftCreated = true;

        const quoteReviewResult = await requestQuoteReview({
          conversationId: ctx.conversationId,
          organizationId: ctx.organizationId,
          motivo: "QUOTE_REVIEW",
          requestId: `valeria2_quote_review_${ctx.conversationId}`,
        });
        persistence.quoteReviewCreated = quoteReviewResult.ok || quoteReviewResult.jaSolicitado;

        await markCatalogDraftPromoted(ctx.conversationId, "vitre_rascunho", draftResult.id);
        draftAtualizado.promovido = true;
        draftAtualizado.promovidoParaTipo = "vitre_rascunho";
        draftAtualizado.promovidoParaId = draftResult.id;
      }
    } else if (
      // ── Transição determinística 1b (Fase D.2.2): modelo comercial
      // CONHECIDO, mas sem productId operacional — qualificação comercial
      // completa (normalmente só quantidade) → NUNCA cria vitre_orcamentos,
      // só aciona revisão humana com motivo PRODUCT_MAPPING_REQUIRED.
      qualification.qualificationStatus === "READY_FOR_PRODUCT_MAPPING_REVIEW" &&
      !draftAtualizado.promovido
    ) {
      const mappingReviewResult = await requestQuoteReview({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        motivo: "PRODUCT_MAPPING_REQUIRED",
        requestId: `valeria2_product_mapping_${ctx.conversationId}`,
      });
      persistence.productMappingReviewRequested = mappingReviewResult.ok || mappingReviewResult.jaSolicitado;

      await markCatalogDraftPromoted(ctx.conversationId, "product_mapping_review", draftAtualizado.catalogGroupId || "sem_grupo");
      draftAtualizado.promovido = true;
      draftAtualizado.promovidoParaTipo = "product_mapping_review";
      draftAtualizado.promovidoParaId = draftAtualizado.catalogGroupId;
    } else if (draftAtualizado.promovido) {
      // C. chamada repetida depois de já promovido — não recria nada, só reporta
      // o que já tinha sido feito (diferencia por tipo, nunca mistura os dois).
      if (draftAtualizado.promovidoParaTipo === "vitre_rascunho") {
        persistence.catalogDraftCreated = true;
        persistence.quoteReviewCreated = true;
      } else if (draftAtualizado.promovidoParaTipo === "product_mapping_review") {
        persistence.productMappingReviewRequested = true;
      }
    }

    // ── Transição determinística 2: personalizado → semeia o
    // TechnicalBriefing existente NESTA MESMA CHAMADA (seção 7 — mesmo
    // codebase, reuso direto, sem cadeia LLM→atualizar_briefing_tecnico).
    if (qualification.qualificationStatus === "ROUTED_TO_CUSTOM") {
      const receita = categoria ? CATEGORIA_PARA_RECEITA[categoria] : null;
      const groupCustom = findGroupOf(groups, draftAtualizado.baseCatalogGroupId);
      const atual = await loadTechnicalBriefing(ctx.conversationId);
      const patch = buildCustomTechnicalBriefingPatch({
        baseCatalogGroupId: draftAtualizado.baseCatalogGroupId,
        baseProductId: draftAtualizado.baseProductId,
        baseProductSku: draftAtualizado.baseProductSku,
        receitaProductId: receita,
        quantity: draftAtualizado.fields.quantity,
        customDimensions: draftAtualizado.fields.customDimensions,
        espessuraPadraoMmDoGrupo: groupCustom?.espessuraPadraoMm ?? null,
        thicknessMmAtual: atual.thicknessMm,
      });
      const atualizado = mergeTechnicalBriefing(atual, patch);
      await saveTechnicalBriefing(ctx.conversationId, atualizado);
      persistence.technicalBriefingUpdated = true;
      // A criação real do orçamento personalizado (draft_valeria) continua
      // sendo responsabilidade do pipeline já existente (orchestrator/
      // action_executor), acionado automaticamente na PRÓXIMA chamada de
      // buscar_contexto_da_conversa — que o prompt já instrui a ValerIA a
      // chamar a cada turno. Não duplicamos essa lógica aqui (seção 9: menor
      // mudança possível) — ver relatório desta etapa para o detalhamento.
    }

    const groupOfDraft = findGroupOf(groups, draftAtualizado.catalogGroupId);
    const next = computeNextAction(qualification, {
      matchedProductName,
      suggestedOptionLabel: resolution.suggestedOption ? `${resolution.suggestedOption.tamanho} (${resolution.suggestedOption.larguraCm}x${resolution.suggestedOption.alturaCm}cm)` : null,
      groupName: groupOfDraft?.nome ?? null,
      catalogDraftCreatedThisCall: persistence.catalogDraftCreated,
    });

    const output = buildQualificationOutput(draftAtualizado, qualification, next, persistence);

    res.json(ok(output, { communicableToCustomer: false, verified: true }));
  } catch (e) {
    console.error("[valeriaUpdateCatalogQualification]", (e as Error).message);
    res.status(500).json(err("INTERNAL_ERROR", "Erro ao atualizar qualificação de catálogo."));
  }
});
