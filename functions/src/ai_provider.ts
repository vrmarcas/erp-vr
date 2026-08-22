/**
 * ai_provider.ts — contrato abstrato entre o módulo Atendimentos e qualquer
 * provedor conversacional (Chatvolt hoje, LLM direto no futuro).
 *
 * O módulo Atendimentos (atendimentos.ts) NUNCA fala com a API do Chatvolt
 * diretamente — só conhece esta interface. Trocar `ChatVoltProvider` por
 * `DirectLlmProvider` no futuro não deve exigir tocar em Atendimentos,
 * Inbox, CRM, mensagens, histórico, briefing, classificação, handoff ou
 * orçamento (ver sprint 2026-08-21, seção 9).
 */

export interface AIProviderContato {
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
}

export interface AIProviderContext {
  atendimentoId: string;
  /** ID de conversa do provedor (ex.: conversationId do Chatvolt). null/undefined = primeira mensagem, provedor cria uma nova. */
  providerConversationId?: string | null;
  texto: string;
  contato?: AIProviderContato;
}

export interface AIProviderResult {
  ok: boolean;
  resposta?: string;
  providerConversationId?: string;
  providerMessageId?: string;
  /** Código de erro normalizado — nunca stack trace/mensagem crua do provedor. */
  erro?: string;
}

export interface AIProvider {
  readonly nome: string;
  sendMessage(ctx: AIProviderContext): Promise<AIProviderResult>;
}
