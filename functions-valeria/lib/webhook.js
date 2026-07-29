"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.valeriaWebhookChatvolt = void 0;
exports.buildWebhookIdempKey = buildWebhookIdempKey;
exports.mapEventToInteracao = mapEventToInteracao;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const pipeline_1 = require("./pipeline");
const idempotency_1 = require("./idempotency");
const response_1 = require("./response");
const types_1 = require("./types");
const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV"];
const RUN_OPTS = functions.runWith({
    secrets: SECRET_NAMES,
    timeoutSeconds: 30,
    memory: "256MB",
});
// ── Helpers internos ───────────────────────────────────────────────────────────
/**
 * Gera chave determinística para eventos sem messageId.
 * Usa campos confiáveis do servidor (não do payload do cliente).
 */
function buildWebhookIdempKey(eventType, conversationId, agentId, dataRef) {
    const raw = `${eventType}:${conversationId}:${agentId}:${dataRef}`;
    return "wh_" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
}
/**
 * Mapeia tipo de evento para direção e tipo de interação.
 */
function mapEventToInteracao(eventType) {
    switch (eventType) {
        case "USER_MESSAGE_RECEIVED": return { direcao: "entrada", tipo: "texto" };
        case "AGENT_USER_MESSAGE": return { direcao: "saida", tipo: "texto" };
        case "AGENT_MESSAGE_SENDED": return { direcao: "saida", tipo: "texto" };
        case "AGENT_MESSAGE_FOLLOW_UP": return { direcao: "saida", tipo: "follow_up" };
        case "AGENT_MESSAGE_BLOCKED": return { direcao: "saida", tipo: "bloqueio" };
        case "AGENT_MESSAGE_NOTED": return { direcao: "saida", tipo: "nota" };
        default: return { direcao: "entrada", tipo: "texto" };
    }
}
/**
 * Extrai metadados de anexos do payload do Chatvolt.
 * NUNCA tenta baixar o conteúdo — apenas metadados.
 */
function extractAnexosMeta(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.map((a) => {
        const url = a["url"];
        const mimeType = (a["mimeType"] ?? a["mime_type"] ?? a["type"]);
        const tamanho = (a["tamanho"] ?? a["size"]);
        const nome = (a["nome"] ?? a["name"] ?? a["filename"]);
        const transcricao = a["transcricao"];
        // Omite campos ausentes — Firestore Admin SDK rejeita valores undefined
        return {
            ...(url !== undefined && { url }),
            ...(mimeType !== undefined && { mimeType }),
            ...(tamanho !== undefined && { tamanho }),
            ...(nome !== undefined && { nome }),
            ...(transcricao !== undefined && { transcricao }),
        };
    });
}
// ── Handler principal ─────────────────────────────────────────────────────────
exports.valeriaWebhookChatvolt = RUN_OPTS.https.onRequest(async (req, res) => {
    // Preflight CORS (mesmo CORS_ORIGIN do pipeline)
    if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Origin", "https://app.chatvolt.ai");
        res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Idempotency-Key");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.status(204).send("");
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json((0, response_1.err)("METHOD_NOT_ALLOWED", "Use POST."));
        return;
    }
    // Pipeline: autenticação + contexto + agente + rate limiting
    const ppl = await (0, pipeline_1.pipeline)(req, res, "valeriaWebhookChatvolt");
    if (!ppl)
        return;
    const { ctx } = ppl;
    const body = req.body;
    const eventType = (body["eventType"] ?? body["event_type"] ?? body["type"]);
    // ── Health check / ping do Chatvolt (sem eventType) ───────────────────────
    if (!eventType) {
        res.json((0, response_1.ok)({ pong: true, supportedEvents: types_1.SUPPORTED_WEBHOOK_EVENTS, version: "2.0.0" }, { communicableToCustomer: false, verified: true }));
        return;
    }
    // ── Evento desconhecido: acknowledges mas não processa ─────────────────────
    if (!types_1.SUPPORTED_WEBHOOK_EVENTS.includes(eventType)) {
        res.json((0, response_1.ok)({ received: true, eventType, processed: false }, {
            communicableToCustomer: false,
            verified: false,
            warnings: [
                `Evento '${eventType}' não suportado. Suportados: ${types_1.SUPPORTED_WEBHOOK_EVENTS.join(", ")}.`,
            ],
        }));
        return;
    }
    // ── Chave de idempotência ──────────────────────────────────────────────────
    const explicitMsgId = ctx.messageId
        ?? (body["messageId"] ?? body["message_id"]);
    const dataRef = (body["data"] ?? body["date"] ?? body["ts"])
        ?? new Date().toISOString();
    const derivedKey = explicitMsgId
        ?? buildWebhookIdempKey(eventType, ctx.conversationId, ctx.agentId, dataRef);
    const keyVW = (0, idempotency_1.validateIdempotencyKey)(derivedKey);
    if (!keyVW.ok) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: keyVW.error } });
        return;
    }
    const payloadHashW = (0, idempotency_1.buildPayloadHash)(body);
    const result = await (0, idempotency_1.withIdempotency)({
        idempotencyKey: keyVW.key,
        conversationId: ctx.conversationId,
        functionName: "valeriaWebhookChatvolt",
        payloadHash: payloadHashW,
    }, async () => {
        const db = admin.firestore();
        const now = Date.now();
        const nowIso = new Date().toISOString();
        const { direcao, tipo } = mapEventToInteracao(eventType);
        // Campos de conteúdo (vários aliases do Chatvolt)
        const mensagemCliente = (body["mensagemCliente"] ?? body["userMessage"] ?? body["message"] ?? body["text"]);
        const respostaAgente = (body["respostaAgente"] ?? body["agentMessage"] ?? body["response"]);
        const mensagemLog = direcao === "entrada" ? mensagemCliente : respostaAgente;
        // Metadados de anexos — NUNCA conteúdo
        const anexos = extractAnexosMeta(body["anexos"] ?? body["attachments"]);
        // Info de bloqueio: omite campos ausentes para evitar undefined no Firestore
        const bmotivo = (body["bloqueioMotivo"] ?? body["blockReason"]);
        const btipo = (body["bloqueioTipo"] ?? body["blockType"]);
        const bdetalhes = body["bloqueioDetalhes"];
        const bloqueioInfo = tipo === "bloqueio"
            ? {
                ...(bmotivo !== undefined && { motivo: bmotivo }),
                ...(btipo !== undefined && { tipo: btipo }),
                ...(bdetalhes !== undefined && { detalhes: bdetalhes }),
            }
            : undefined;
        // ── 1. Persiste evento bruto (path rápido, não bloqueador) ────────────
        await db.collection("valeria_webhook_events").add({
            eventType,
            conversationId: ctx.conversationId,
            messageId: explicitMsgId ?? keyVW.key,
            agentId: ctx.agentId,
            organizationId: ctx.organizationId,
            channel: body["channel"] ?? body["canal"] ?? null,
            channelPhone: ctx.channelPhone ?? body["channelPhone"] ?? body["phone"] ?? null,
            mensagemCliente: mensagemCliente ?? null,
            respostaAgente: respostaAgente ?? null,
            status: body["status"] ?? null,
            prioridade: (body["prioridade"] ?? body["priority"]) ?? null,
            responsavel: (body["responsavel"] ?? body["assignee"]) ?? null,
            data: dataRef,
            variaveis: (body["variaveis"] ?? body["variables"]) ?? null,
            anexosMeta: anexos.length > 0 ? anexos : null,
            bloqueioInfo: bloqueioInfo ?? null,
            ts: now,
            createdAt: nowIso,
            processado: false,
        });
        // ── 2. Log leve de interação em valeria_msgs ───────────────────────────
        await db.collection("valeria_msgs").add({
            conversationId: ctx.conversationId,
            agentId: ctx.agentId,
            organizationId: ctx.organizationId,
            messageId: explicitMsgId ?? keyVW.key,
            mensagem: mensagemLog ?? `[${eventType}]`,
            direcao,
            tipo,
            origem: "chatvolt",
            statusProcessamento: "pendente",
            eventType,
            ...(anexos.length > 0 ? { anexosMeta: anexos } : {}),
            ...(bloqueioInfo !== undefined ? { bloqueioInfo } : {}),
            ts: now,
            createdAt: nowIso,
        });
        return (0, response_1.ok)({
            received: true,
            eventType,
            conversationId: ctx.conversationId,
            messageId: explicitMsgId ?? keyVW.key,
            idempotente: !explicitMsgId, // avisa se chave foi gerada deterministicamente
        }, { communicableToCustomer: false, verified: true });
    }, res);
    res.status(result.success ? 200 : (0, idempotency_1.idempotencyHttpStatus)(result, 500)).json(result);
});
//# sourceMappingURL=webhook.js.map