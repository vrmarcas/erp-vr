/**
 * shadow_redactor.ts — ValerIA 2.0, Fase E.2.7 (PoC shadow, 2026-09-20).
 *
 * "Redator" — traduz uma decisão JÁ TOMADA pelo backend (RedactionInput)
 * em texto. NUNCA decide (não escolhe pergunta, não decide nextAction,
 * não inventa fato) — só redige, exatamente como pedido: "o LLM produz
 * apenas o texto".
 *
 * ESCOLHA DELIBERADA DESTA FASE (PoC shadow): implementação padrão é um
 * template determinístico, não uma chamada real a um LLM. Motivos:
 *   1. zero credencial/secret nova nesta fase (nada além do já aprovado);
 *   2. 100% testável offline, sem custo, sem rede;
 *   3. o próprio ponto da fase é provar a ORQUESTRAÇÃO e o VALIDATOR —
 *      um LLM real pode ser conectado depois atrás da MESMA interface
 *      `Redactor`, sem tocar em nenhum outro módulo.
 * Isso está registrado explicitamente no relatório de entrega da fase —
 * não é uma simplificação escondida.
 */
import type { NextAction, QuestionContext } from "./qualification_engine";

export type RedactionMode = "EXPLORATORY" | "COMMERCIAL_INTENT" | "AMBIGUOUS";

export interface RedactionInput {
  mode: RedactionMode;
  questionAllowed: boolean;
  factsAllowed: string[];
  nextAction?: NextAction | null;
  questionContext?: QuestionContext | null;
}

export type Redactor = (input: RedactionInput) => string;

const QUESTION_BY_NEXT_ACTION: Partial<Record<NextAction, (ctx: QuestionContext) => string>> = {
  ASK_MODEL: () => "Você pode me dizer qual modelo ou categoria você tem em mente?",
  ASK_SIZE: (ctx) => `Qual tamanho você prefere${ctx.groupName ? ` para ${ctx.groupName}` : ""}?`,
  ASK_QUANTITY: () => "Quantas unidades você precisa?",
  CONFIRM_CATALOG_OPTION: (ctx) => `Temos a opção ${ctx.suggestedSizeLabel ?? ""}${ctx.groupName ? ` de ${ctx.groupName}` : ""} — posso seguir com essa?`,
};

const STATEMENT_BY_NEXT_ACTION: Partial<Record<NextAction, (ctx: QuestionContext) => string>> = {
  CONTINUE_CUSTOM_TECHNICAL_BRIEFING: () => "Anotei seu pedido personalizado, já vamos seguir com os próximos detalhes.",
  REQUEST_QUOTE_REVIEW: (ctx) => `Deixei tudo pronto${ctx.productName ? ` para ${ctx.productName}` : ""} — nossa equipe vai revisar e confirmar o orçamento.`,
  // Fase E.2.27 — dados completos, mas NENHUMA ação real de backend
  // ocorreu ainda (ver computeNextAction/READY_CATALOG_DRAFT). Nunca
  // afirmar "pronto"/"enviei"/"equipe vai revisar" aqui — só reconhecer
  // que os dados foram completados.
  READY_FOR_QUOTE_REVIEW: () => "Perfeito, já tenho as informações necessárias.",
  REQUEST_PRODUCT_MAPPING_REVIEW: () => "Já registrei seu pedido — nossa equipe vai confirmar os detalhes desse modelo.",
  ESCALATE_UNSUPPORTED: () => "Vou verificar essa possibilidade com a equipe e já te retorno.",
};

/**
 * defaultTemplateRedactor — implementação padrão desta fase (ver
 * cabeçalho). Nunca produz pergunta quando `questionAllowed=false`.
 */
export const defaultTemplateRedactor: Redactor = (input) => {
  if (!input.questionAllowed) {
    if (input.factsAllowed.length > 0) return input.factsAllowed.join(" ");
    return "Posso ajudar com isso.";
  }

  const ctx = input.questionContext ?? {};
  if (input.nextAction && QUESTION_BY_NEXT_ACTION[input.nextAction]) {
    return QUESTION_BY_NEXT_ACTION[input.nextAction]!(ctx);
  }
  if (input.nextAction && STATEMENT_BY_NEXT_ACTION[input.nextAction]) {
    return STATEMENT_BY_NEXT_ACTION[input.nextAction]!(ctx);
  }
  return "Pode me dar mais um detalhe para eu continuar?";
};
