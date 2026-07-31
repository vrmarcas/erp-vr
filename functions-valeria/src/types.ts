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
  };
  materiais?: MaterialConfig[];
  maquinas?: MaquinaConfig[];
}

export interface MaterialConfig {
  comp?: number;
  larg?: number;
  preco?: number;
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
}

export interface PricingBreakdown {
  overhead: number;
  vrml: number;
  impostos: number;
  factor: number;
  extrasTotal: number;
  matTotal: number;
  maqTotal?: number;
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
