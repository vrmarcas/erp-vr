/**
 * shadow_runner.ts — ValerIA 2.0, Fase E.2.8 (2026-09-20).
 *
 * ÚNICA fronteira de I/O do shadow mode. Import list é a garantia de
 * segurança desta fase (item 2 do pedido — "o módulo executado em shadow
 * não deve sequer receber dependências capazes de realizar side
 * effects"): este arquivo importa SÓ leitura (`./catalog`, read-only) e
 * módulos puros (`./shadow_pipeline`, `./shadow_signal_extractor`,
 * `./shadow_config`) — NUNCA `./vitre_draft_writer`, `./human_handoff`,
 * `./technical_briefing_store` (escrita), nem qualquer cliente HTTP para
 * `send-message`/`Agent Query`/`set-ai-enabled` do ChatVolt. A ÚNICA
 * escrita deste arquivo é `admin.firestore().collection("valeria_shadow_results")`
 * — uma collection de diagnóstico nova, nunca lida por nenhum fluxo real.
 *
 * Prova estática desta garantia: ver
 * __tests__/shadow_runner.test.ts ("zero I/O perigoso").
 */
import * as admin from "firebase-admin";
import { getAllActiveCatalogConfigs, catalogGroupsFromConfig } from "./catalog";
import { shadowEligibilityReasonForPhone } from "./shadow_config";
import { runShadowPipeline, type ShadowInput } from "./shadow_pipeline";
import { extractShadowSignals } from "./shadow_signal_extractor";
import { chaveCanonicaBR } from "./telefone";

/** Só para log — nunca o telefone completo, só a chave canônica (DDD + últimos 4). Sem side effect, sem uso em decisão. */
function maskPhoneForLog(channelPhone: string | null): string | null {
  const chave = chaveCanonicaBR(channelPhone);
  if (!chave) return null;
  return chave.slice(0, 2) + "***" + chave.slice(-4);
}

const RESULTS_COL = "valeria_shadow_results";
export const SHADOW_PIPELINE_VERSION = "e2.8-2026-09-20";

export interface ShadowObservationInput {
  conversationId: string;
  atendimentoId: string | null;
  channelPhone: string | null;
  messageText: string;
  modoAtendimento: string | null;
  /** SEMPRE vindo do atendimento/backend já carregado pelo chamador — nunca recalculado aqui, nunca do LLM. */
  isTeste: boolean;
  idempotencyKey: string;
  sourceMessageCreatedAtMs: number | null;
  webhookReceivedAtMs: number;
}

export interface ShadowObservationOutcome {
  ran: boolean;
  reason: string;
}

/**
 * runShadowObservation — só roda de fato quando `shadowEligibleForPhone`
 * confirma (flag `erp_vr/valeria_shadow_config.shadowEnabled=true` E
 * telefone explicitamente na allowlist de teste). Nunca lança para o
 * chamador — qualquer falha interna é logada e tratada como "não rodou
 * desta vez", nunca interrompe o webhook real.
 */
export async function runShadowObservation(input: ShadowObservationInput): Promise<ShadowObservationOutcome> {
  const logBase = {
    conversationId: input.conversationId,
    atendimentoId: input.atendimentoId,
    phone: maskPhoneForLog(input.channelPhone),
    isTest: input.isTeste,
  };
  try {
    const elig = await shadowEligibilityReasonForPhone(input.channelPhone);
    if (elig.reason !== "ELIGIBLE") {
      console.log(
        "[shadow_runner] decisão:",
        JSON.stringify({ ...logBase, ran: false, reason: elig.reason, shadowEnabled: elig.shadowEnabled, allowlisted: elig.allowlisted })
      );
      return { ran: false, reason: elig.reason };
    }

    const t0 = Date.now();

    const tCatalogStart = Date.now();
    const configs = await getAllActiveCatalogConfigs();
    const catalogGroups = configs.flatMap(catalogGroupsFromConfig);
    const catalogLoadMs = Date.now() - tCatalogStart;

    const tExtractStart = Date.now();
    const { signals, fieldUpdate } = extractShadowSignals(input.messageText, catalogGroups);
    const extractionMs = Date.now() - tExtractStart;

    const shadowInput: ShadowInput = {
      conversationId: input.conversationId,
      messageText: input.messageText,
      modoAtendimento: input.modoAtendimento,
      isEchoOfOwnMessage: false, // shadow nunca envia nada — estruturalmente não há o que ecoar
      isTeste: input.isTeste,
      catalogGroups,
      resolutionSignals: signals,
      fieldUpdate,
    };

    const tPipelineStart = Date.now();
    const result = runShadowPipeline(shadowInput);
    const pipelineMs = Date.now() - tPipelineStart;

    const totalShadowMs = Date.now() - t0;

    const docId = input.idempotencyKey; // doc id determinístico → retry sobrescreve o MESMO doc, nunca duplica.

    await admin
      .firestore()
      .collection(RESULTS_COL)
      .doc(docId)
      .set(
        {
          idempotencyKey: input.idempotencyKey,
          conversationId: input.conversationId,
          atendimentoId: input.atendimentoId,
          isTest: input.isTeste,
          pipelineVersion: SHADOW_PIPELINE_VERSION,
          receivedAt: input.webhookReceivedAtMs,
          sourceMessageCreatedAt: input.sourceMessageCreatedAtMs,
          normalizedInput: input.messageText,
          mode: result.mode,
          classificationReason: result.classification
            ? {
                classification: result.classification.classification,
                reasonCode: result.classification.reasonCode,
                matchedRule: result.classification.matchedRule,
              }
            : null,
          extractedSignals: signals,
          resolution: result.resolution
            ? {
                resolutionType: result.resolution.resolutionType,
                catalogGroupId: result.resolution.catalogGroupId,
                matchedProductId: result.resolution.matchedProductId,
                reasonCode: result.resolution.reasonCode,
              }
            : null,
          qualification: result.qualification,
          nextAction: result.nextAction,
          questionAllowed: result.redactionInput?.questionAllowed ?? null,
          rawHypotheticalResponse: result.rawHypotheticalText,
          finalHypotheticalResponse: result.hypotheticalText,
          outputValidation: result.outputValidation,
          wouldRequestHuman: result.wouldRequestHuman,
          wouldRequestHumanReason: result.wouldRequestHumanReason,
          sideEffectsExecuted: false,
          latency: { catalogLoadMs, extractionMs, pipelineMs, totalShadowMs },
          createdAt: Date.now(),
          diagnostico: "Dado de homologação — Fase E.2.8, nunca lido por fluxo real de atendimento.",
        },
        { merge: false }
      );

    console.log(
      "[shadow_runner] decisão:",
      JSON.stringify({ ...logBase, ran: true, reason: "OK", mode: result.mode, totalShadowMs })
    );
    return { ran: true, reason: "OK" };
  } catch (e) {
    console.error(
      "[shadow_runner] falha (não bloqueia webhook real):",
      JSON.stringify({ ...logBase, ran: false, reason: "ERROR", errorMessage: (e as Error).message })
    );
    return { ran: false, reason: "ERROR" };
  }
}
