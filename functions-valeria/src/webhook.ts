/**
 * webhook.ts — valeriaWebhookChatvolt (B1)
 *
 * Endpoint que recebe eventos push do Chatvolt.
 * Responde em < 5 s: valida → persiste evento bruto → grava log leve → 200.
 * Processamento pesado (correlação CRM, enriquecimento) fica para fora do
 * caminho crítico de resposta — o evento bruto fica em valeria_webhook_events
 * para reprocessamento assíncrono ou consulta posterior.
 *
 * NUNCA baixa conteúdo de anexos — registra apenas metadados (URL, MIME, size).
 *
 * Eventos suportados:
 *   USER_MESSAGE_RECEIVED  — mensagem recebida do usuário
 *   AGENT_USER_MESSAGE     — mensagem enviada pela agente ao usuário
 *   AGENT_MESSAGE_SENDED   — confirmação de envio
 *   AGENT_MESSAGE_FOLLOW_UP — follow-up automático da agente
 *   AGENT_MESSAGE_BLOCKED  — mensagem bloqueada (regra do Chatvolt)
 *   AGENT_MESSAGE_NOTED    — nota interna adicionada pela agente
 */

import * as functions from "firebase-functions";
import * as admin      from "firebase-admin";
import * as crypto     from "crypto";

import { pipeline }                         from "./pipeline";
import { withIdempotency }                  from "./idempotency";
import { ok, err }                          from "./response";
import {
  SUPPORTED_WEBHOOK_EVENTS,
  type WebhookEventType,
  type AnexoMeta,
  type BloqueioInfo,
} from "./types";

const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];

const RUN_OPTS = functions.runWith({
  secrets:        SECRET_NAMES,
  timeoutSeconds: 30,
  memory:         "256MB",
});

// ── Helpers internos ───────────────────────────────────────────────────────────

/**
 * Gera chave determinística para eventos sem messageId.
 * Usa campos confiáveis do servidor (não do payload do cliente).
 */
export function buildWebhookIdempKey(
  eventType: string,
  conversationId: string,
  agentId: string,
  dataRef: string
): string {
  const raw = `${eventType}:${conversationId}:${agentId}:${dataRef}`;
  return "wh_" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

/**
 * Mapeia tipo de evento para direção e tipo de interação.
 */
export function mapEventToInteracao(
  eventType: WebhookEventType
): { direcao: "entrada" | "saida"; tipo: string } {
  switch (eventType) {
    case "USER_MESSAGE_RECEIVED":   return { direcao: "entrada", tipo: "texto"     };
    case "AGENT_USER_MESSAGE":      return { direcao: "saida",   tipo: "texto"     };
    case "AGENT_MESSAGE_SENDED":    return { direcao: "saida",   tipo: "texto"     };
    case "AGENT_MESSAGE_FOLLOW_UP": return { direcao: "saida",   tipo: "follow_up" };
    case "AGENT_MESSAGE_BLOCKED":   return { direcao: "saida",   tipo: "bloqueio"  };
    case "AGENT_MESSAGE_NOTED":     return { direcao: "saida",   tipo: "nota"      };
    default:                        return { direcao: "entrada", tipo: "texto"     };
  }
}

/**
 * Extrai metadados de anexos do payload do Chatvolt.
 * NUNCA tenta baixar o conteúdo — apenas metadados.
 */
function extractAnexosMeta(raw: unknown): AnexoMeta[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((a) => {
    const transcricao = a["transcricao"] as string | undefined;
    return {
      url:        a["url"]        as string | undefined,
      mimeType:   (a["mimeType"] ?? a["mime_type"] ?? a["type"]) as string | undefined,
      tamanho:    (a["tamanho"]  ?? a["size"])                   as number | undefined,
      nome:       (a["nome"]     ?? a["name"] ?? a["filename"])  as string | undefined,
      ...(transcricao !== undefined ? { transcricao } : {}),
    } as AnexoMeta;
  });
}

// ── Handler principal ─────────────────────────────────────────────────────────

export const valeriaWebhookChatvolt = RUN_OPTS.https.onRequest(async (req, res) => {
  // Preflight CORS (mesmo CORS_ORIGIN do pipeline)
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin",  "https://app.chatvolt.ai");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Idempotency-Key");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json(err("METHOD_NOT_ALLOWED", "Use POST."));
    return;
  }

  // Pipeline: autenticação + contexto + agente + rate limiting
  const ppl = await pipeline(req, res, "valeriaWebhookChatvolt");
  if (!ppl) return;
  const { ctx } = ppl;

  const body = req.body as Record<string, unknown>;
  const eventType = (body["eventType"] ?? body["event_type"] ?? body["type"]) as string | undefined;

  // ── Health check / ping do Chatvolt (sem eventType) ───────────────────────
  if (!eventType) {
    res.json(ok(
      { pong: true, supportedEvents: SUPPORTED_WEBHOOK_EVENTS, version: "2.0.0" },
      { communicableToCustomer: false, verified: true }
    ));
    return;
  }

  // ── Evento desconhecido: acknowledges mas não processa ─────────────────────
  if (!SUPPORTED_WEBHOOK_EVENTS.includes(eventType as WebhookEventType)) {
    res.json(ok(
      { received: true, eventType, processed: false },
      {
        communicableToCustomer: false,
        verified: false,
        warnings: [
          `Evento '${eventType}' não suportado. Suportados: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}.`,
        ],
      }
    ));
    return;
  }

  // ── Chave de idempotência ──────────────────────────────────────────────────
  const explicitMsgId = ctx.messageId
    ?? (body["messageId"] ?? body["message_id"]) as string | undefined;
  const dataRef = (body["data"] ?? body["date"] ?? body["ts"]) as string | undefined
    ?? new Date().toISOString();

  const idempKey = explicitMsgId
    ?? buildWebhookIdempKey(eventType, ctx.conversationId, ctx.agentId, dataRef);

  const result = await withIdempotency(
    {
      idempotencyKey: idempKey,
      conversationId: ctx.conversationId,
      functionName:   "valeriaWebhookChatvolt",
    },
    async () => {
      const db     = admin.firestore();
      const now    = Date.now();
      const nowIso = new Date().toISOString();

      const { direcao, tipo } = mapEventToInteracao(eventType as WebhookEventType);

      // Campos de conteúdo (vários aliases do Chatvolt)
      const mensagemCliente =
        (body["mensagemCliente"] ?? body["userMessage"]  ?? body["message"] ?? body["text"]) as string | undefined;
      const respostaAgente  =
        (body["respostaAgente"]  ?? body["agentMessage"] ?? body["response"])                as string | undefined;
      const mensagemLog = direcao === "entrada" ? mensagemCliente : respostaAgente;

      // Metadados de anexos — NUNCA conteúdo
      const anexos: AnexoMeta[] = extractAnexosMeta(body["anexos"] ?? body["attachments"]);

      // Info de bloqueio
      const bloqueioInfo: BloqueioInfo | undefined = tipo === "bloqueio"
        ? {
            motivo:   (body["bloqueioMotivo"] ?? body["blockReason"]) as string | undefined,
            tipo:     (body["bloqueioTipo"]   ?? body["blockType"])   as string | undefined,
            detalhes: body["bloqueioDetalhes"]                        as string | undefined,
          }
        : undefined;

      // ── 1. Persiste evento bruto (path rápido, não bloqueador) ────────────
      await db.collection("valeria_webhook_events").add({
        eventType,
        conversationId:  ctx.conversationId,
        messageId:       explicitMsgId ?? idempKey,
        agentId:         ctx.agentId,
        organizationId:  ctx.organizationId,
        channel:         body["channel"] ?? body["canal"] ?? null,
        channelPhone:    ctx.channelPhone ?? body["channelPhone"] ?? body["phone"] ?? null,
        mensagemCliente: mensagemCliente ?? null,
        respostaAgente:  respostaAgente  ?? null,
        status:          body["status"]      ?? null,
        prioridade:      (body["prioridade"] ?? body["priority"])   ?? null,
        responsavel:     (body["responsavel"] ?? body["assignee"]) ?? null,
        data:            dataRef,
        variaveis:       (body["variaveis"] ?? body["variables"]) ?? null,
        anexosMeta:      anexos.length > 0 ? anexos : null,
        bloqueioInfo:    bloqueioInfo ?? null,
        ts:              now,
        createdAt:       nowIso,
        processado:      false,
      });

      // ── 2. Log leve de interação em valeria_msgs ───────────────────────────
      await db.collection("valeria_msgs").add({
        conversationId:      ctx.conversationId,
        agentId:             ctx.agentId,
        organizationId:      ctx.organizationId,
        messageId:           explicitMsgId ?? idempKey,
        mensagem:            mensagemLog ?? `[${eventType}]`,
        direcao,
        tipo,
        origem:              "chatvolt",
        statusProcessamento: "pendente",
        eventType,
        ...(anexos.length > 0 ? { anexosMeta: anexos } : {}),
        ...(bloqueioInfo !== undefined ? { bloqueioInfo } : {}),
        ts:                  now,
        createdAt:           nowIso,
      });

      return ok(
        {
          received:       true,
          eventType,
          conversationId: ctx.conversationId,
          messageId:      explicitMsgId ?? idempKey,
          idempotente:    !explicitMsgId, // avisa se chave foi gerada deterministicamente
        },
        { communicableToCustomer: false, verified: true }
      );
    }
  );

  // 200 sempre (incluindo replay idempotente)
  res.status(result.success ? 200 : 500).json(result);
});
