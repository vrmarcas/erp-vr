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
import type { TechnicalBriefing } from "./technical_briefing";
import { computeTechnicalReadiness, technicalBriefingFingerprint } from "./technical_briefing";

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
  | "confirm_quote"
  | "create_quote"
  | "present_quote"
  | "check_production_deadline"
  | "check_urgent_fit"
  | "handoff";

/**
 * Sprint P0.6 — rota comercial canônica da conversa. Uma vez que o
 * technicalBriefing tem productId (fluxo VR personalizado), a conversa
 * está travada em VR_CUSTOM — nunca deve migrar espontaneamente para
 * Vitre no mesmo turno sem uma nova decisão do orchestrator (achado real
 * de E2E: o LLM confundiu Tools e foi parar no catálogo Vitre mesmo com
 * toolToCall="calcular_produto_personalizado" explícito). Exportado para
 * os endpoints de Vitre (outro codebase) lerem antes de executar.
 */
export type CommercialRoute = "VR_CUSTOM" | null;

export function computeCommercialRoute(technicalBriefing?: TechnicalBriefing | null): CommercialRoute {
  return technicalBriefing?.productId ? "VR_CUSTOM" : null;
}

/**
 * Sprint P0.6 — as mesmas resoluções de nome/telefone usadas internamente
 * por computeQuoteReadiness, exportadas para action_executor.ts derivar a
 * identidade do cliente sem duplicar a lógica nem depender do LLM
 * fornecer nomeCliente/telCliente por Tool call.
 */
export function nomeConfirmado(cliente: Cliente | null, lead: CrmLead | null): string | null {
  return cliente?.nome || lead?.nome || null;
}
export function telefoneConfirmado(cliente: Cliente | null, lead: CrmLead | null, channelPhone: string | null): string | null {
  return channelPhone || cliente?.tel || lead?.tel || null;
}

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
  /**
   * Bloco F (sprint P0.3) — payload estruturado por ação, não só o nome.
   * O LLM lê isto para saber exatamente o que fazer a seguir (quais campos
   * pedir, com que reasonCode encaminhar) — nunca infere a partir do nome
   * da ação sozinho.
   */
  actionPayload: Record<string, unknown>;
}

// Campos mínimos para QUALQUER produto ter preço calculável — subconjunto
// de CAMPOS_ESSENCIAIS (briefing.ts) que efetivamente bloqueia cálculo
// (acabamento/referencia/observacoes/prazo são reais mas não impedem
// calcular_orcamento_vr/calcular_produto_personalizado).
const CAMPOS_BLOQUEANTES: (keyof BriefingData)[] = ["produto", "larguraMm", "alturaMm", "quantidade", "material"];
const CAMPOS_OPCIONAIS: (keyof BriefingData)[] = ["acabamento", "referencia", "observacoes"];

/**
 * quoteReadiness() — avaliador canônico (P0.8). Determina objetivamente
 * se já dá para calcular/gerar orçamento, sem depender de julgamento do
 * LLM.
 *
 * Bloco F (sprint P0.3) — quando existe um `technicalBriefing` com
 * `productId` já definido (fluxo de produto VR personalizado, MESMO
 * schema que quote_core.ts exige), a readiness técnica
 * (computeTechnicalReadiness, technical_briefing.ts) é a fonte de
 * verdade — nunca a checagem genérica de BriefingData, que usa nomes/
 * unidades diferentes (larguraMm solto vs dimensions.larguraMm,
 * material texto livre vs materialId resolvido). Sem technicalBriefing
 * ainda (ex.: antes do cliente escolher um produto), cai no fallback
 * genérico — preserva 100% o comportamento de catálogo/Vitre/
 * classificação, que nunca passam por technical_briefing.
 */
export function computeQuoteReadiness(
  briefing: BriefingData | null,
  cliente: Cliente | null,
  lead: CrmLead | null,
  channelPhone: string | null,
  technicalBriefing?: TechnicalBriefing | null
): QuoteReadiness {
  const nome = nomeConfirmado(cliente, lead);
  const tel = telefoneConfirmado(cliente, lead, channelPhone);
  const customerIdentityReady = !!nome && !!tel;

  let missingRequiredFields: string[];
  let optionalFields: string[];

  if (technicalBriefing && technicalBriefing.productId) {
    const tr = computeTechnicalReadiness(technicalBriefing);
    missingRequiredFields = tr.missingRequiredFields;
    optionalFields = [];
  } else {
    const b = briefing || {};
    missingRequiredFields = CAMPOS_BLOQUEANTES.filter((f) => !isPreenchido(b[f]));
    optionalFields = CAMPOS_OPCIONAIS.filter((f) => !isPreenchido(b[f]));
  }

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
  technicalBriefing?: TechnicalBriefing | null;
  lastEligibleSimulation?: { fingerprint: string; finalPrice: number; simulationId: string } | null;
}): NextActionResult {
  const resultado = nextCommercialActionCore(params);
  // P0.8 — invariante garantida centralmente, não branch a branch (nunca
  // esquecida em uma ação nova): não existe estado válido de "pedir
  // permissão para continuar" em NENHUMA ação. Se o campo já veio
  // explicitamente definido num branch específico, ele vence; senão o
  // default é sempre false.
  return { ...resultado, actionPayload: { askPermission: false, ...resultado.actionPayload } };
}

function nextCommercialActionCore(params: {
  briefing: BriefingData | null;
  cliente: Cliente | null;
  lead: CrmLead | null;
  channelPhone: string | null;
  temHistoricoConversa: boolean;
  orcamentoJaCriado: boolean;
  handoffReasonCode?: HandoffReasonCode | null;
  technicalBriefing?: TechnicalBriefing | null;
  lastEligibleSimulation?: { fingerprint: string; finalPrice: number; simulationId: string } | null;
}): NextActionResult {
  if (params.handoffReasonCode) {
    return {
      nextAction: "handoff", missingFields: [], reason: params.handoffReasonCode,
      actionPayload: { reasonCode: params.handoffReasonCode },
    };
  }

  if (params.orcamentoJaCriado) {
    // Bloco F — nunca retroceder: mesmo que o cliente volte a falar de
    // medidas/produto depois disso, a ação permanece present_quote.
    return {
      nextAction: "present_quote", missingFields: [], reason: "Orçamento já foi criado — nunca retroceder para discovery.",
      actionPayload: {},
    };
  }

  // Sprint P0.6 — sinais de pergunta lateral (prazo/urgência) extraídos
  // pelo LLM (nunca decididos por ele: só relata o que o cliente disse) e
  // persistidos no technicalBriefing. Sempre que presentes, o
  // action_executor consulta automaticamente e o backend consome o sinal
  // (limpa a flag) — o LLM nunca chama consultar_prazo_producao/
  // verificar_encaixe_producao por conta própria. Verificados antes da
  // readiness de preço porque são perguntas ortogonais ao cálculo
  // (o cliente pode perguntar prazo antes de terminar de especificar).
  if (params.technicalBriefing?.productId && params.technicalBriefing?.wantsDeadlineCheck === true) {
    return {
      nextAction: "check_production_deadline", missingFields: [], reason: "Cliente perguntou sobre prazo — consultado automaticamente pelo backend.",
      actionPayload: { instrucao: "Prazo já consultado pelo backend — apresente o resultado ao cliente, nunca chame uma Tool de prazo." },
    };
  }
  if (params.technicalBriefing?.productId && params.technicalBriefing?.dataNecessidadeCliente) {
    return {
      nextAction: "check_urgent_fit", missingFields: [], reason: "Cliente informou uma data-limite — encaixe verificado automaticamente pelo backend.",
      actionPayload: { instrucao: "Encaixe já verificado pelo backend — apresente o resultado ao cliente, nunca chame uma Tool de encaixe." },
    };
  }

  const readiness = computeQuoteReadiness(
    params.briefing, params.cliente, params.lead, params.channelPhone, params.technicalBriefing
  );

  if (readiness.ready && !readiness.customerIdentityReady) {
    return {
      nextAction: "identify_customer", missingFields: [], reason: "Dados de especificação completos — falta identificar o cliente antes de orçar.",
      actionPayload: {},
    };
  }

  const simulacaoAindaValida =
    readiness.canGenerateQuote &&
    !!params.technicalBriefing?.productId &&
    !!params.lastEligibleSimulation &&
    technicalBriefingFingerprint(params.technicalBriefing!) === params.lastEligibleSimulation.fingerprint;

  if (simulacaoAindaValida && params.technicalBriefing?.clientConfirmedQuote === true) {
    // Sprint P0.4 (achado real de E2E, Bloco H2) — já existe uma
    // simulação ELIGIBLE cujo fingerprint bate com o briefing atual (não
    // mudou nada desde o cálculo) E o cliente já confirmou explicitamente
    // o preço apresentado (sprint P0.6 — nunca criar orçamento sem essa
    // confirmação, mesmo que o fingerprint já batesse). O
    // action_executor cria o orçamento diretamente — o LLM nunca escolhe
    // entre criar_orcamento_vr e criar_rascunho_vitre (achado real:
    // confundiu as duas e caiu no 401 da Tool errada).
    return {
      nextAction: "create_quote", missingFields: [], reason: "Simulação elegível confere com os dados atuais e o cliente já confirmou — criar o orçamento formal.",
      actionPayload: {
        instrucao: "Orçamento já criado pelo backend — apresente o resultado ao cliente, não chame nenhuma Tool.",
        toolToCall: "criar_orcamento_vr",
      },
    };
  }

  if (simulacaoAindaValida) {
    // Sprint P0.6 — preço já calculado e ainda válido, mas o cliente
    // ainda não confirmou explicitamente: nunca criar o orçamento sem
    // essa confirmação. O LLM só apresenta o preço já conhecido (sem
    // recalcular) e aguarda a resposta do cliente — a confirmação em si
    // é extraída pelo LLM (linguagem natural) e persistida via
    // atualizar_briefing_tecnico, nunca decidida por ele quando agir.
    return {
      nextAction: "confirm_quote", missingFields: [], reason: "Preço já calculado — aguardando confirmação explícita do cliente antes de criar o orçamento.",
      actionPayload: {
        finalPrice: params.lastEligibleSimulation!.finalPrice,
        instrucao: `Preço já calculado: R$ ${params.lastEligibleSimulation!.finalPrice.toFixed(2)}. Apresente esse valor e pergunte se o cliente confirma — não recalcule, não crie o orçamento ainda.`,
      },
    };
  }

  if (readiness.canGenerateQuote) {
    // Sprint P0.4 (P0.7) — toolToCall tira a escolha do LLM: para produto
    // VR personalizado (technicalBriefing com productId), a ÚNICA Tool
    // válida é calcular_produto_personalizado. calcular_orcamento_vr é
    // legado (auditoria real: zero uso legítimo em produção, só
    // confusão de nome) — nunca é o toolToCall aqui. Sprint P0.6 — o
    // action_executor já executa esse cálculo automaticamente
    // (calcular_produto_personalizado vira redundante/fallback).
    return {
      nextAction: "calculate_quote", missingFields: [], reason: "Todos os campos obrigatórios e identificação do cliente confirmados.",
      actionPayload: {
        instrucao: "Preço já calculado pelo backend — apresente ao cliente, não chame nenhuma Tool de cálculo.",
        toolToCall: "calcular_produto_personalizado",
      },
    };
  }

  if (!params.temHistoricoConversa && readiness.missingRequiredFields.length === CAMPOS_BLOQUEANTES.length) {
    return { nextAction: "greet", missingFields: [], reason: "Primeira mensagem, nenhum dado ainda.", actionPayload: {} };
  }

  const b = params.briefing;
  const temProdutoTecnico = !!params.technicalBriefing?.productId;
  if (!temProdutoTecnico && !isPreenchido(b?.produto)) {
    return {
      nextAction: "classify_demand", missingFields: ["produto"], reason: "Produto ainda não identificado — classificar antes de pedir medidas.",
      actionPayload: { fields: ["produto"] },
    };
  }

  return {
    nextAction: "ask_required_fields",
    missingFields: readiness.missingRequiredFields,
    reason: "Produto já identificado — faltam campos obrigatórios para calcular.",
    actionPayload: { fields: readiness.missingRequiredFields },
  };
}
