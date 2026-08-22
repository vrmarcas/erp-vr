/**
 * chatvolt_provider.ts — implementação `AIProvider` para o Chatvolt.
 *
 * Usa a API oficial do Chatvolt (POST /agents/{id}/query, "Agent Query"),
 * documentada em https://docs.chatvolt.ai/api-reference — NÃO confundir com
 * as 12 HTTP Tools que o Chatvolt chama DE VOLTA no ERP (essas usam um
 * bearer completamente diferente, ver VALERIA_VITRE_CONTRACTS_2026-08-10.md).
 *
 * Autenticação desta API (Chatvolt → nós é o inverso; aqui é nós → Chatvolt):
 * header `Authorization: Bearer <CHATVOLT_API_KEY>`, chave gerada em
 * https://app.chatvolt.ai/settings/api-keys. Secret Manager, nome
 * `CHATVOLT_API_KEY` — NUNCA confundir com VALERIA_BEARER_SECRET (esse
 * autentica o Chatvolt chamando as Tools do ERP, não o ERP chamando o
 * Chatvolt).
 *
 * Continuidade de conversa (sprint 2026-08-21, seção 17): a primeira
 * chamada de um atendimento novo NÃO envia `conversationId` — o Chatvolt
 * cria um e devolve na resposta; toda chamada seguinte reenvia esse mesmo
 * valor. Quem persiste e reencaminha esse valor é `atendimentos.ts`
 * (`providerConversationId` no documento do atendimento), nunca este
 * arquivo.
 */

import axios from "axios";
import { AIProvider, AIProviderContext, AIProviderResult } from "./ai_provider";

export const VALERIA_AGENT_ID = "cmmmkciwb02j8lcxudbnwv31y";
const CHATVOLT_QUERY_TIMEOUT_MS = 25_000;

export class ChatVoltProvider implements AIProvider {
  readonly nome = "chatvolt";
  private readonly agentId: string;

  constructor(agentId: string = VALERIA_AGENT_ID) {
    this.agentId = agentId;
  }

  async sendMessage(ctx: AIProviderContext): Promise<AIProviderResult> {
    const apiKey = process.env.CHATVOLT_API_KEY;
    if (!apiKey) {
      return { ok: false, erro: "CHATVOLT_API_KEY_NAO_CONFIGURADA" };
    }
    if (!ctx.texto || !ctx.texto.trim()) {
      return { ok: false, erro: "TEXTO_VAZIO" };
    }

    const body: Record<string, unknown> = {
      query: ctx.texto,
      streaming: false,
    };
    if (ctx.providerConversationId) body.conversationId = ctx.providerConversationId;
    if (ctx.contato && (ctx.contato.nome || ctx.contato.telefone || ctx.contato.email)) {
      body.contact = {
        firstName: ctx.contato.nome || undefined,
        phoneNumber: ctx.contato.telefone || undefined,
        email: ctx.contato.email || undefined,
      };
    }

    try {
      const res = await axios.post(
        `https://api.chatvolt.ai/agents/${this.agentId}/query`,
        body,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: CHATVOLT_QUERY_TIMEOUT_MS,
          validateStatus: () => true,
        }
      );

      if (res.status === 401 || res.status === 403) {
        return { ok: false, erro: "CHATVOLT_AUTH_REJEITADA" };
      }
      if (res.status >= 500) {
        return { ok: false, erro: "CHATVOLT_INDISPONIVEL" };
      }
      if (res.status >= 400) {
        return { ok: false, erro: `CHATVOLT_REQUISICAO_INVALIDA:${res.status}` };
      }

      const data = res.data || {};
      const resposta = typeof data.answer === "string" ? data.answer : "";
      if (!resposta) {
        return { ok: false, erro: "CHATVOLT_RESPOSTA_VAZIA" };
      }
      return {
        ok: true,
        resposta,
        providerConversationId: typeof data.conversationId === "string" ? data.conversationId : ctx.providerConversationId || undefined,
        providerMessageId: typeof data.messageId === "string" ? data.messageId : undefined,
      };
    } catch (e) {
      const isTimeout = axios.isAxiosError(e) && e.code === "ECONNABORTED";
      return { ok: false, erro: isTimeout ? "CHATVOLT_TIMEOUT" : "CHATVOLT_ERRO_REDE" };
    }
  }
}
