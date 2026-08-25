/**
 * types.ts — Interfaces e tipos compartilhados da integração Valéria
 */

// ── Contexto de conversa (obrigatório em todas as operações) ──────────────────

export interface ConversationContext {
  conversationId: string;   // ID único da conversa no Chatvolt
  messageId?: string;       // ID da mensagem que originou a chamada
  agentId: string;          // ID do agente Chatvolt autorizado
  organizationId: string;   // ID da organização Chatvolt autorizada
  channelPhone?: string;    // Telefone do canal (do Chatvolt, não do cliente)
}

// ── Cabeçalho de idempotência ─────────────────────────────────────────────────

export interface IdempotencyRecord {
  key: string;
  result: ApiResponse;
  createdAt: number;
  expiresAt: number;
}

// ── Contrato padronizado de resposta ──────────────────────────────────────────

export interface ApiMeta {
  requestId: string;
  source: "valeria-api";
  apiVersion: "2.0.0";
  timestamp: string;       // ISO-8601
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta: ApiMeta;
  verified: boolean;
  communicableToCustomer: boolean;
  humanValidationRequired: boolean;
  missingFields?: string[];
  warnings?: string[];
}

export interface ApiError {
  code: string;
  message: string;
  details?: string;
  /**
   * Itens que a Valéria pediu para incluir no orçamento mas que o ERP não
   * tem fonte canônica de preço/regra para calcular automaticamente
   * (sprint P0.3, Bloco C) — nunca um valor inventado, sempre um handoff
   * explícito e rastreável. Ausência de tabela HOJE, não vedação
   * permanente: quando uma fonte canônica existir, o campo sai desta lista.
   */
  blockedItems?: Array<{ campo: string; reasonCode: string; motivo: string }>;
}

// ── Enums de resultado de elegibilidade ──────────────────────────────────────

export type QuoteEligibilityResult =
  | "ELIGIBLE"
  | "NEEDS_INFORMATION"
  | "HUMAN_VALIDATION_REQUIRED"
  | "UNSUPPORTED"
  | "TEMPORARILY_UNAVAILABLE";

// ── Entidades de domínio ──────────────────────────────────────────────────────

export interface Cliente {
  id: string;
  nome: string;
  tipo?: string;
  cidade?: string;
  marca?: string;
  tel?: string;
  email?: string;
  doc?: string;
  contato?: string;
  ultimoPedido?: string;
  os?: string[];
  conversationIds?: string[]; // vínculos de conversa (append-only)
  [key: string]: unknown;
}

export interface OrcamentoEnviado {
  id: string;
  n: number;
  nomeCliente: string;
  telCliente: string;
  emailCliente?: string;
  descricao: string;
  itens?: QuoteItem[];
  total: number;
  totalCost: number;
  pricingVersion: string;
  quoteEngine: "erp_official" | "human_authorized";
  simulationId: string;
  humanAuthId?: string;
  communicableToCustomer: boolean;
  status: string;
  data: string;           // ISO-8601
  marca?: string;
  origem: "valeria";
  conversationId: string;
  agentId: string;
  organizationId: string;
  /**
   * Sprint P0.7 — propagado do atendimento (atendimentos/{conversationId}.isTeste)
   * no momento da criação, nunca inferido depois. Nome do campo (isTest,
   * sem o "e") é DELIBERADO — casa exatamente com a convenção já existente
   * no frontend (_isTestRecord() em index.html, usada por KB_OS/CRM_LEADS/
   * FIN_TX) para que orcGetEnviados() já exclua isso de todo KPI comercial
   * sem precisar tocar em index.html.
   */
  isTest: boolean;
  [key: string]: unknown;
}

export interface QuoteItem {
  larg: number;
  alt: number;
  qty: number;
  matKey?: string;
  rsm2?: number;
  planArea?: number;
  descricao?: string;
}

/**
 * CrmLead — formato unificado ERP + Valéria.
 *
 * Os campos de primeiro nível são compatíveis com o Kanban do index.html.
 * Dados exclusivos da Valéria ficam em `valeria: {}` para não quebrar
 * cards existentes.
 *
 * Armazenado em erp_vr/crm_leads como objeto-dicionário: { [id]: CrmLead }
 */
export interface CrmLead {
  // ── Campos ERP (primeiro nível — usados pelo Kanban / index.html) ──
  id: string;
  nome: string;
  tel: string;
  email?: string;
  /** Coluna do Kanban: ia_novo | qualificando | orc_emitido | negociacao | fechado */
  etapa: string;
  marca: string;          // 'vr' | 'vitre'
  sub?: string;           // subtitle exibida no card
  temp?: string;          // 'quente' | 'morno' | 'frio'
  score?: number;         // 0–100
  cor?: string;           // hex
  origem?: string;        // 'valeria' | 'site' | 'indicacao' etc.
  contato?: string;
  cidade?: string;
  segmento?: string;
  dores?: string[];
  intencao?: { produto: string; material: string; medidas: string; quantidade: string };
  resumo_ia?: string;
  valor?: string;

  // ── Sub-objeto exclusivo da Valéria (não afeta o Kanban) ──
  valeria?: {
    status: string;        // CrmEtapa interna (NOVO_LEAD, CONTATO_FEITO, …)
    conversationId: string;
    agentId: string;
    organizationId: string;
    observacoes?: string;
    proximaAcao?: string;
    dataProximaAcao?: string;
    historico?: LeadHistoricoEntry[];
    dataEntrada: string;
    updatedAt?: string;
    briefing?: Record<string, unknown>;
    orcamentoGanhoId?: string;
    motivoPerda?: string;
    reaberturaJustificativa?: string;
    responsavel?: string;
  };

  /**
   * Sprint P0.9 — propagado do atendimento (atendimentos/{conversationId}.isTeste),
   * mesmo nome/convenção de OrcamentoEnviado.isTest e PricingSimulation.isTest
   * (ver comentário lá). O frontend JÁ filtra CRM_LEADS por isso
   * (_isTestRecord() em index.html, hotfix 2026-08-10) — só faltava o
   * backend popular o campo, nunca foi um gap de frontend.
   */
  isTest?: boolean;

  [key: string]: unknown;
}

/** Dicionário de leads — formato usado pelo ERP e pela Valéria */
export type CrmLeadDict = Record<string, CrmLead>;

export interface LeadHistoricoEntry {
  ts: string;            // ISO-8601
  acao: string;
  agentId?: string;
  detalhe?: string;
}

export interface KbOs {
  id?: string;
  cliente?: string;
  tel?: string;
  status?: string;
  valor?: number | string;
  descricao?: string;
  data?: string;
  [key: string]: unknown;
}

export interface ErpConfig {
  financeiro?: {
    overhead?: number;
    vrml?: number;
    impostos?: number;
    /** R$ por cm² de adesivo normal — fallback real do wizard (orcRecalc) é 0.0056 quando ausente/zero. */
    adesivoPrecoCm2?: number;
    /** R$ por cm² de adesivo branco — fallback real do wizard (orcRecalc) é 0.0011 quando ausente/zero. */
    adesivoBrancoPrecoCm2?: number;
  };
  materiais?: MaterialConfig[];
  maquinas?: MaquinaConfig[];
  /**
   * Bloco E (sprint P0.3) — capacidade produtiva, configurável só pelo
   * Master (Config → Produção no ERP). NUNCA lido com fallback fictício:
   * ausência de qualquer um destes 3 campos (ou valor <= 0) mantém
   * canEstimate:false no motor de prazo (deadline.ts) — nunca inventa um
   * número plausível para preencher a lacuna.
   */
  producao?: {
    /** Dias de produção "padrão" para 1 OS típica, sem fila. */
    leadTimeBaseDias?: number;
    /** Quantas OS a produção consegue processar por dia útil. */
    capacidadeOsPorDia?: number;
    /** Margem de segurança extra somada ao prazo calculado. */
    bufferDias?: number;
  };
}

export interface MaterialConfig {
  comp?: number;
  larg?: number;
  /** Custo total da chapa (não o preço/m² — usar rsm2 quando disponível, ou custo/área). */
  custo?: number;
  /** Preço por m² já calculado (R$/m²) — fonte preferencial quando presente. */
  rsm2?: number;
  nome?: string;
  [key: string]: unknown;
}

export interface MaquinaConfig {
  nome: string;
  ratePerMin: number;
  [key: string]: unknown;
}

// ── Simulação de preço persistida ────────────────────────────────────────────

/** Gravada em valeria_simulations/{simulationId}. Só criarOrcamento pode usá-la. */
export interface PricingSimulation {
  simulationId: string;
  conversationId: string;
  itensNormalizados: QuoteItem[];   // sem rsm2, sem campos livres de preço
  finalPrice: number;
  pricingVersion: string;
  createdAt: number;                // Date.now()
  expiresAt: number;                // +1h padrão
  origem: "valeria";
  usado: boolean;                   // true após criarOrcamento consumir
  autorizacaoHumana?: string;       // opcional — id de autorização manual
  /** Sprint P0.7 — propagado do atendimento, ver OrcamentoEnviado.isTest. */
  isTest: boolean;
  /**
   * Bloco D (sprint P0.3) — snapshot IMUTÁVEL do briefing técnico usado
   * para gerar ESTE preço específico, congelado no momento do cálculo.
   * criarOrcamento propaga isso para o orçamento persistido — nunca lê o
   * briefing "ao vivo" de novo (que pode já ter mudado até o cliente
   * confirmar), garantindo que o orçamento sempre reflita o que foi
   * efetivamente calculado e mostrado ao cliente.
   */
  technicalBriefingSnapshot?: Record<string, unknown>;
}

// ── Resultado do motor de preço ───────────────────────────────────────────────

export interface PricingResult {
  eligibility: QuoteEligibilityResult;
  finalPrice?: number;
  totalCost?: number;
  matTotal?: number;
  breakdown?: PricingBreakdown;
  missingFields?: string[];
  pricingVersion?: string;
  simulationId?: string;
  blockedItems?: Array<{ campo: string; reasonCode: string; motivo: string }>;
}

export interface PricingBreakdown {
  overhead: number;
  vrml: number;
  impostos: number;
  factor: number;
  extrasTotal: number;
  matTotal: number;
  maqTotal?: number;
  adesivoCusto?: number;
}

// ── Rate limit ────────────────────────────────────────────────────────────────

export interface RateLimitRecord {
  count: number;
  windowStart: number;
  updatedAt: number;
}

// ── Config autorizada de agentes/orgs ────────────────────────────────────────

export interface AuthorizedAgent {
  agentId: string;
  organizationId: string;
  allowedFunctions?: string[]; // undefined = todas
}

// ── B1: Webhook Chatvolt ──────────────────────────────────────────────────────

export type WebhookEventType =
  | "USER_MESSAGE_RECEIVED"
  | "AGENT_USER_MESSAGE"
  | "AGENT_MESSAGE_SENDED"
  | "AGENT_MESSAGE_FOLLOW_UP"
  | "AGENT_MESSAGE_BLOCKED"
  | "AGENT_MESSAGE_NOTED";

export const SUPPORTED_WEBHOOK_EVENTS: WebhookEventType[] = [
  "USER_MESSAGE_RECEIVED",
  "AGENT_USER_MESSAGE",
  "AGENT_MESSAGE_SENDED",
  "AGENT_MESSAGE_FOLLOW_UP",
  "AGENT_MESSAGE_BLOCKED",
  "AGENT_MESSAGE_NOTED",
];

export interface AnexoMeta {
  url?: string;
  mimeType?: string;
  tamanho?: number;
  nome?: string;
  tipo?: "imagem" | "audio" | "arquivo" | "video";
  transcricao?: string;
}

export interface BloqueioInfo {
  motivo?: string;
  tipo?: string;
  detalhes?: string;
}

// ── B2: Briefing progressivo ──────────────────────────────────────────────────

export type ClassificacaoDemanda = "catalogo" | "semi_personalizada" | "personalizada";

export interface BriefingData {
  produto?: string;
  familia?: string;
  larguraMm?: number;
  alturaMm?: number;
  quantidade?: number;
  material?: string;
  acabamento?: string;
  prazo?: string;
  referencia?: string;
  observacoes?: string;
  classificacao?: ClassificacaoDemanda;
  completude?: number;          // 0–100
  camposFaltando?: string[];
  historico?: BriefingHistoricoEntry[];
  updatedAt?: string;
  conversationId?: string;
  clienteId?: string;
  leadId?: string;
}

export interface BriefingHistoricoEntry {
  ts: string;
  camposAlterados: string[];
  agentId?: string;
}

// ── B3: CRM Etapas e Fechamento ───────────────────────────────────────────────

export type CrmEtapa =
  | "NOVO_LEAD"
  | "CONTATO_FEITO"
  | "BRIEFING_COLETADO"
  | "ORCAMENTO_ENVIADO"
  | "NEGOCIACAO"
  | "GANHO"
  | "PERDIDO"
  | "REABERTO";

export type FechamentoResultado = "ganho" | "perda" | "reaberto";

// Transições válidas entre etapas
export const CRM_TRANSICOES: Record<CrmEtapa, CrmEtapa[]> = {
  NOVO_LEAD:         ["CONTATO_FEITO", "PERDIDO"],
  CONTATO_FEITO:     ["BRIEFING_COLETADO", "PERDIDO"],
  BRIEFING_COLETADO: ["ORCAMENTO_ENVIADO", "PERDIDO"],
  ORCAMENTO_ENVIADO: ["NEGOCIACAO", "GANHO", "PERDIDO"],
  NEGOCIACAO:        ["GANHO", "PERDIDO"],
  GANHO:             [],
  PERDIDO:           ["REABERTO"],
  REABERTO:          ["CONTATO_FEITO", "BRIEFING_COLETADO", "ORCAMENTO_ENVIADO"],
};

// ── B4: Interações ampliadas ──────────────────────────────────────────────────

export type InteracaoTipo =
  | "texto"
  | "bloco"
  | "nota"
  | "imagem"
  | "audio"
  | "arquivo"
  | "transcricao"
  | "follow_up"
  | "bloqueio";

export type InteracaoDirecao = "entrada" | "saida";
export type InteracaoOrigem  = "chatvolt" | "whatsapp" | "manual";
export type InteracaoStatus  = "pendente" | "processado" | "erro";
