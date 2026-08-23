/**
 * orchestrator.ts — motor determinístico de progressão comercial
 * (sprint P0.2 2026-08-23).
 *
 * Princípio arquitetural do sprint: o LLM NÃO decide quais campos faltam,
 * se já pode orçar, ou qual é a próxima etapa — isso é responsabilidade
 * de código determinístico. O LLM só recebe a decisão já tomada
 * (nextAction) e verbaliza em linguagem natural.
 *
 * Reaproveita 100% o que já existe (briefing.ts: CAMPOS_ESSENCIAIS,
 * classificarDemanda, completude, camposFaltando) — não duplica essa
 * lógica, só a consome e adiciona a camada de "o que fazer agora".
 */

import type { BriefingData, Cliente, CrmLead } from "./types";

export type NextCommercialAction =
  | "greet"
  | "answer_question"
  | "identify_customer"
  | "classify_demand"
  | "ask_required_fields"
  | "recommend_options"
  | "lookup_catalog"
  | "lookup_repurchase"
  | "configure_custom"
  | "calculate_quote"
  | "create_quote"
  | "present_quote"
  | "check_production_deadline"
  | "check_urgent_fit"
  | "handoff";

export type HandoffReasonCode =
  | "UNSUPPORTED_PRODUCT"
  | "MISSING_TECHNICAL_RULE"
  | "PRICING_NOT_AVAILABLE"
  | "PRODUCTION_EXCEPTION"
  | "COMMERCIAL_AUTHORIZATION_REQUIRED"
  | "CUSTOMER_REQUESTED_HUMAN";

export interface QuoteReadiness {
  ready: boolean;
  missingRequiredFields: string[];
  optionalFields: string[];
  customerIdentityReady: boolean;
  blockingReason: string | null;
  canGenerateQuote: boolean;
}

export interface NextActionResult {
  nextAction: NextCommercialAction;
  missingFields: string[];
  reason: string;
}

// Campos mínimos para QUALQUER produto ter preço calculável — subconjunto
// de CAMPOS_ESSENCIAIS (briefing.ts) que efetivamente bloqueia cálculo
// (acabamento/referencia/observacoes/prazo são reais mas não impedem
// calcular_orcamento_vr/calcular_produto_personalizado).
const CAMPOS_BLOQUEANTES: (keyof BriefingData)[] = ["produto", "larguraMm", "alturaMm", "quantidade", "material"];
const CAMPOS_OPCIONAIS: (keyof BriefingData)[] = ["acabamento", "referencia", "observacoes"];

function nomeConfirmado(cliente: Cliente | null, lead: CrmLead | null): string | null {
  return cliente?.nome || lead?.nome || null;
}
function telefoneConfirmado(cliente: Cliente | null, lead: CrmLead | null, channelPhone: string | null): string | null {
  return channelPhone || cliente?.tel || lead?.tel || null;
}

/**
 * quoteReadiness() — avaliador canônico (P0.8). Determina objetivamente
 * se já dá para calcular/gerar orçamento, sem depender de julgamento do
 * LLM.
 */
export function computeQuoteReadiness(
  briefing: BriefingData | null,
  cliente: Cliente | null,
  lead: CrmLead | null,
  channelPhone: string | null
): QuoteReadiness {
  const b = briefing || {};
  const missingRequiredFields = CAMPOS_BLOQUEANTES.filter((f) => !isPreenchido(b[f]));
  const optionalFields = CAMPOS_OPCIONAIS.filter((f) => !isPreenchido(b[f]));

  const nome = nomeConfirmado(cliente, lead);
  const tel = telefoneConfirmado(cliente, lead, channelPhone);
  const customerIdentityReady = !!nome && !!tel;

  const ready = missingRequiredFields.length === 0;
  let blockingReason: string | null = null;
  if (!ready) blockingReason = `Campos obrigatórios ausentes: ${missingRequiredFields.join(", ")}`;
  else if (!customerIdentityReady) blockingReason = "Identificação do cliente (nome/telefone) ainda não confirmada";

  return {
    ready,
    missingRequiredFields,
    optionalFields,
    customerIdentityReady,
    blockingReason,
    canGenerateQuote: ready && customerIdentityReady,
  };
}

function isPreenchido(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return !isNaN(v) && v > 0;
  return true;
}

/**
 * nextCommercialAction() — motor determinístico de próxima ação (P0.9).
 * O LLM recebe o resultado — não escolhe livremente.
 *
 * `temHistoricoConversa`: false só na primeiríssima mensagem sem NENHUM
 * dado ainda (produto/nome/etc.) — usado só para decidir entre "greet"
 * puro e já pedir dados.
 * `orcamentoJaCriado`: true quando o atendimento já tem um orçamento
 * vinculado (atendimentos/{id}.orcamentoId) — nunca retroceder depois disso.
 * `handoffSolicitado`: sinal explícito (cliente pediu humano, produto não
 * suportado etc.) — quando presente, sempre vence sobre qualquer outra
 * ação.
 */
export function nextCommercialAction(params: {
  briefing: BriefingData | null;
  cliente: Cliente | null;
  lead: CrmLead | null;
  channelPhone: string | null;
  temHistoricoConversa: boolean;
  orcamentoJaCriado: boolean;
  handoffReasonCode?: HandoffReasonCode | null;
}): NextActionResult {
  if (params.handoffReasonCode) {
    return { nextAction: "handoff", missingFields: [], reason: params.handoffReasonCode };
  }

  if (params.orcamentoJaCriado) {
    return { nextAction: "present_quote", missingFields: [], reason: "Orçamento já foi criado — nunca retroceder para discovery." };
  }

  const readiness = computeQuoteReadiness(params.briefing, params.cliente, params.lead, params.channelPhone);

  if (readiness.ready && !readiness.customerIdentityReady) {
    return { nextAction: "identify_customer", missingFields: [], reason: "Dados de especificação completos — falta identificar o cliente antes de orçar." };
  }

  if (readiness.canGenerateQuote) {
    return { nextAction: "calculate_quote", missingFields: [], reason: "Todos os campos obrigatórios e identificação do cliente confirmados." };
  }

  if (!params.temHistoricoConversa && readiness.missingRequiredFields.length === CAMPOS_BLOQUEANTES.length) {
    return { nextAction: "greet", missingFields: [], reason: "Primeira mensagem, nenhum dado ainda." };
  }

  const b = params.briefing;
  if (!isPreenchido(b?.produto)) {
    return { nextAction: "classify_demand", missingFields: ["produto"], reason: "Produto ainda não identificado — classificar antes de pedir medidas." };
  }

  return {
    nextAction: "ask_required_fields",
    missingFields: readiness.missingRequiredFields,
    reason: "Produto já identificado — faltam campos obrigatórios para calcular.",
  };
}
