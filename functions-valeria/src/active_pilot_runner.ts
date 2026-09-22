/**
 * active_pilot_runner.ts — ValerIA 2.0, Fase E.2.13 (2026-09-21), com
 * continuidade multi-turno na Fase E.2.22 (2026-09-21).
 *
 * Orquestra o caminho REAL (a única diferença do shadow é que, quando
 * elegível e o validador aprova, ENVIA de verdade): reaproveita
 * `runShadowPipeline` (já puro, já testado em A-E desta sessão) para
 * classificar/resolver/decidir/redigir/validar — a MESMA decisão que o
 * shadow já prova estar correta — e só adiciona o que o shadow
 * estruturalmente não pode ter: idempotência de envio + guarda anti-loop
 * + chamada ao adapter + persistência do draft de catálogo.
 *
 * Gate de elegibilidade (active_pilot_config.ts) é checado ANTES de
 * qualquer I/O de catálogo — mesma disciplina de curto-circuito do
 * shadow_runner.ts. Se o validador rejeitar o texto, o envio é
 * SUPRIMIDO (nunca envia o texto saneado do shadow — aqui o padrão é mais
 * estrito: ou o texto é válido como veio do redator, ou não envia nada).
 *
 * ORDEM persistência-vs-envio (Fase E.2.22, análise de failure modes):
 * o draft é salvo ANTES do validador/envio, nunca depois. Motivo: (a)
 * `mergeSignalsIntoDraft`/`resolveProductMatch` são puros e IDEMPOTENTES
 * — reprocessar a MESMA mensagem (retry) produz o MESMO draft resultante,
 * então salvar cedo nunca duplica nem corrompe estado; (b) se salvássemos
 * só DEPOIS de enviar com sucesso, uma falha no `saveCatalogDraft` (só
 * essa escrita, não a de envio) faria a próxima leitura do ledger achar
 * `status=SENT` (idempotência de envio já é outro mecanismo) e NUNCA MAIS
 * reprocessar aquele turno — perderíamos a evolução do draft de forma
 * IRRECUPERÁVEL. Salvar antes é estritamente mais seguro: o entendimento
 * do backend sobre o que o cliente disse é uma decisão do backend,
 * independente de o envio da resposta ao cliente ter sucesso ou não.
 */
import { getAllActiveCatalogConfigs, catalogGroupsFromConfig } from "./catalog";
import { activePilotEligibilityForRequest, type ActivePilotEligibilityReason } from "./active_pilot_config";
import { extractShadowSignals } from "./shadow_signal_extractor";
import { runShadowPipeline, type ShadowInput } from "./shadow_pipeline";
import { sendChatvoltMessage } from "./chatvolt_send_adapter";
import { getSendState, canAttemptSend, reservePending, markSent, markFailed } from "./active_pilot_send_ledger";
import { loadCatalogDraft, saveCatalogDraft } from "./catalog_draft";
import { chaveCanonicaBR } from "./telefone";
// Fase E.2.35 — side effect comercial real (orçamento + handoff), gate
// SEPARADO de activePilotEnabled (commercial_side_effects_config.ts) e
// orquestração que reusa os mesmos helpers já em produção em
// catalog_tools.ts (commercial_quote_orchestrator.ts) — nunca duplica
// implementação. computeNextAction/defaultTemplateRedactor/validateOutput
// são chamados diretamente aqui (não via runShadowPipeline) para o texto
// final pós-side-effect: shadow_pipeline.ts é PURO por design e nunca
// pode afirmar sideEffectsExecuted=true (guarantee do módulo) — só quem
// sabe se o side effect REAL aconteceu é este arquivo.
import { commercialSideEffectsEligibilityForConversation } from "./commercial_side_effects_config";
import { executeReadyCatalogDraftSideEffects } from "./commercial_quote_orchestrator";
import { computeNextAction } from "./qualification_engine";
import { defaultTemplateRedactor, type RedactionInput } from "./shadow_redactor";
import { validateOutput } from "./shadow_output_validator";

function maskPhoneForLog(channelPhone: string | null): string | null {
  const chave = chaveCanonicaBR(channelPhone);
  if (!chave) return null;
  return chave.slice(0, 2) + "***" + chave.slice(-4);
}

export interface ActivePilotInput {
  conversationId: string;
  organizationId: string;
  channelPhone: string | null;
  messageText: string;
  modoAtendimento: string | null;
  isTeste: boolean;
  idempotencyKey: string;
}

export type ActivePilotOutcomeReason =
  | ActivePilotEligibilityReason
  | "ALREADY_SENT"
  | "SEND_IN_PROGRESS"
  | "VALIDATOR_REJECTED"
  | "NO_TEXT"
  | "SEND_ERROR"
  | "SENT";

export interface ActivePilotOutcome {
  ran: boolean;
  reason: ActivePilotOutcomeReason;
  sendSuppressed: boolean;
  sentMessageId: string | null;
  /** Fase E.2.35 — true só quando o orçamento real foi criado E o handoff real teve sucesso nesta chamada. */
  sideEffectsExecuted: boolean;
}

export async function runActivePilotObservation(input: ActivePilotInput): Promise<ActivePilotOutcome> {
  const logBase = {
    conversationId: input.conversationId,
    phone: maskPhoneForLog(input.channelPhone),
    isTest: input.isTeste,
  };

  const elig = await activePilotEligibilityForRequest(input.channelPhone, input.conversationId, input.isTeste, input.modoAtendimento);
  if (elig.reason !== "ELIGIBLE") {
    return { ran: false, reason: elig.reason, sendSuppressed: true, sentMessageId: null, sideEffectsExecuted: false };
  }

  // Idempotência do envio — nunca reenviar uma key já SENT/PENDING.
  const existing = await getSendState(input.idempotencyKey);
  if (existing && !canAttemptSend(existing)) {
    const reason: ActivePilotOutcomeReason = existing.status === "SENT" ? "ALREADY_SENT" : "SEND_IN_PROGRESS";
    return { ran: false, reason, sendSuppressed: true, sentMessageId: existing.sentMessageId, sideEffectsExecuted: false };
  }
  await reservePending(input.idempotencyKey, input.conversationId);

  try {
    const configs = await getAllActiveCatalogConfigs();
    const catalogGroups = configs.flatMap(catalogGroupsFromConfig);
    // Continuidade multi-turno (Fase E.2.22) — carrega o draft já
    // persistido desta conversa (null se for o primeiro turno comercial).
    const priorDraft = await loadCatalogDraft(input.conversationId);
    const { signals, fieldUpdate } = extractShadowSignals(input.messageText, catalogGroups, priorDraft);

    const shadowInput: ShadowInput = {
      conversationId: input.conversationId,
      messageText: input.messageText,
      modoAtendimento: input.modoAtendimento,
      isEchoOfOwnMessage: false, // já filtrado pela guarda anti-loop ANTES de chegar aqui (webhook.ts)
      isTeste: input.isTeste,
      priorDraft,
      catalogGroups,
      resolutionSignals: signals,
      fieldUpdate,
    };
    const result = runShadowPipeline(shadowInput);

    // Persiste a evolução do draft ANTES do validador/envio — ver análise
    // de failure modes no cabeçalho do arquivo. Só existe em turnos
    // COMMERCIAL_INTENT (mergedDraft é null em EXPLORATORY/AMBIGUOUS/etc,
    // e nesses casos o draft anterior simplesmente permanece intocado).
    if (result.mergedDraft) {
      await saveCatalogDraft(result.mergedDraft);
    }

    // Fase E.2.35 — side effect comercial real (orçamento + handoff), só
    // quando o draft chegou a READY_CATALOG_DRAFT NESTE turno, ainda não
    // foi promovido, e o gate comercial (separado de activePilotEnabled)
    // autoriza explicitamente esta conversationId. Fora desse caso, o
    // texto/validação seguem exatamente como o pipeline puro já decidiu
    // (READY_FOR_QUOTE_REVIEW, neutro — comportamento inalterado).
    let sideEffectsExecuted = false;
    let finalRawText = result.rawHypotheticalText;
    let finalValidation = result.outputValidation;

    if (result.mergedDraft && result.mergedDraft.qualificationStatus === "READY_CATALOG_DRAFT" && !result.mergedDraft.promovido) {
      const commercialElig = await commercialSideEffectsEligibilityForConversation(input.conversationId);
      if (commercialElig.reason === "ELIGIBLE") {
        const sideEffectResult = await executeReadyCatalogDraftSideEffects({
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          channelPhone: input.channelPhone,
          catalogGroups,
          draft: result.mergedDraft,
        });
        console.log("[active_pilot_runner] side effect comercial:", JSON.stringify({ ...logBase, ...sideEffectResult }));

        if (sideEffectResult.executed) {
          // Só agora — draft real criado/reconhecido E handoff real com
          // sucesso — o texto REQUEST_QUOTE_REVIEW passa a ser factual.
          // Nunca via runShadowPipeline (que é puro e nunca pode afirmar
          // sideEffectsExecuted=true) — recomputado diretamente aqui.
          sideEffectsExecuted = true;
          const qualification = { qualificationStatus: result.mergedDraft.qualificationStatus, missingFields: result.mergedDraft.missingFields };
          const { nextAction, questionContext } = computeNextAction(qualification, {
            groupName: result.mergedDraft.catalogGroupId ?? undefined,
            catalogDraftCreatedThisCall: true,
          });
          const redactionInput: RedactionInput = { mode: "COMMERCIAL_INTENT", questionAllowed: true, factsAllowed: [], nextAction, questionContext };
          finalRawText = defaultTemplateRedactor(redactionInput);
          finalValidation = validateOutput(finalRawText, { questionAllowed: true, factsAllowed: [], sideEffectsExecuted: true });
        }
      } else {
        console.log("[active_pilot_runner] side effect comercial não autorizado:", JSON.stringify({ ...logBase, reason: commercialElig.reason }));
      }
    }

    // Mais estrito que o shadow: só envia o texto EXATAMENTE como o redator
    // produziu quando o validador aprova — nunca o texto saneado de fallback.
    if (!finalValidation?.valid || !finalRawText) {
      await markFailed(input.idempotencyKey, "VALIDATOR_REJECTED");
      console.log("[active_pilot_runner] envio suprimido:", JSON.stringify({ ...logBase, reason: "VALIDATOR_REJECTED", violations: finalValidation?.violations ?? [] }));
      return { ran: true, reason: "VALIDATOR_REJECTED", sendSuppressed: true, sentMessageId: null, sideEffectsExecuted };
    }

    const sendResult = await sendChatvoltMessage(input.conversationId, finalRawText);
    await markSent(input.idempotencyKey, sendResult.id);
    console.log("[active_pilot_runner] enviado:", JSON.stringify({ ...logBase, mode: result.mode, sentMessageId: sendResult.id, sideEffectsExecuted }));
    return { ran: true, reason: "SENT", sendSuppressed: false, sentMessageId: sendResult.id, sideEffectsExecuted };
  } catch (e) {
    await markFailed(input.idempotencyKey, (e as Error).message?.slice(0, 200) ?? "unknown");
    console.error("[active_pilot_runner] falha (não bloqueia webhook real):", JSON.stringify({ ...logBase, error: (e as Error).message }));
    return { ran: true, reason: "SEND_ERROR", sendSuppressed: true, sentMessageId: null, sideEffectsExecuted: false };
  }
}
