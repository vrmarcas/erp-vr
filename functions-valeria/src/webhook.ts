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
import { detectCommercialIntent } from "./confirmation_detector";

/**
 * Sprint P1.0 (achado real de auditoria) — valeriaWebhookChatvolt era
 * PASSIVO: só logava eventos em valeria_webhook_events/valeria_msgs,
 * nunca criava atendimentos/{id} nem disparava confirmação/identidade/
 * execução server-side. Toda a arquitetura determinística de P0.6-P0.9
 * (confirmation detector, identity detector, action_executor) só rodava
 * via atdSimularMensagemCliente — o caminho ERP-only de homologação.
 * Mensagens REAIS do WhatsApp nunca passavam por nenhuma dessas
 * garantias. Este bloco fecha esse gap no único ponto de entrada real
 * que existe para WhatsApp (o webhook), sem esperar o LLM chamar Tool
 * nenhuma — mesma disciplina de sempre.
 */

const NOME_TOKEN = "[A-ZÀ-Ý][a-zà-ÿ]+(?:\\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}";
const NOME_PATTERNS: RegExp[] = [
  new RegExp(`\\b[Ss]ou\\s+(?:o\\s+|a\\s+)?(${NOME_TOKEN})`),
  new RegExp(`\\b[Mm]eu nome\\s*(?:e|eh|:)?\\s*(${NOME_TOKEN})`),
  new RegExp(`\\b[Aa]qui\\s*(?:e|eh)?\\s*(?:o\\s+|a\\s+)?(${NOME_TOKEN})`),
  new RegExp(`\\b[Mm]e chamo\\s+(${NOME_TOKEN})`),
];
/** Espelha functions/src/identity_detector.ts (nome apenas — telefone do WhatsApp já vem do canal, nunca do texto). */
function extrairNomeDoTexto(textoOriginal: string): string | null {
  const texto = textoOriginal.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const pattern of NOME_PATTERNS) {
    const m = texto.match(pattern);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

const VALERIA_GET_CONTEXTO_URL = "https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaGetContexto";
const VALERIA_CRIAR_OPORTUNIDADE_URL = "https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaCriarOportunidade";

interface SincroniaConversa {
  nome: string | null;
  telefoneE164: string | null;
  novasMensagens: number;
  totalMensagens: number;
  ultimaMensagem: string | null;
  ultimaMensagemEm: number | null;
}

const SINCRONIA_VAZIA: SincroniaConversa = {
  nome: null, telefoneE164: null, novasMensagens: 0, totalMensagens: 0, ultimaMensagem: null, ultimaMensagemEm: null,
};

/**
 * Sprint P1.2b (achado real de E2E) — o webhook só passou a existir no
 * MEIO de conversas reais já em andamento (Tools sempre funcionaram,
 * technicalBriefing nunca ficou incompleto — só o espelho ERP/mensagens
 * ficou para trás). Além disso, o payload de push do ChatVolt não é
 * confiável para o CONTEÚDO da resposta da Valéria (eventType
 * AGENT_MESSAGE_SENDED chega sem texto em nenhum campo) nem para nome do
 * contato (nunca vem no payload do evento).
 *
 * Fonte de verdade única: GET /api/conversations/{id} — devolve
 * participantsContacts (nome/telefone reais do canal) e messages[] com
 * id/from/text/createdAt de TODO o histórico. Cada mensagem é escrita em
 * atendimentos/{id}/mensagens usando o id REAL do ChatVolt como doc id —
 * isso torna a sincronização idempotente por natureza (nunca duplica,
 * mesmo chamada várias vezes ou concorrente): reprocessar a mesma
 * conversa só grava o que ainda não existe. Roda tanto na primeira
 * mensagem de uma conversa nova (backfill do histórico anterior) quanto
 * em toda mensagem seguinte (para capturar a resposta real da Valéria,
 * que não vem no payload do evento) — nunca inventa texto: se a API
 * falhar, retorna vazio e quem chama decide o fallback.
 */
async function sincronizarConversaCompleta(conversationId: string): Promise<SincroniaConversa> {
  const apiKey = process.env.CHATVOLT_API_KEY;
  if (!apiKey) return SINCRONIA_VAZIA;
  try {
    const resp = await fetch(`https://app.chatvolt.ai/api/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return SINCRONIA_VAZIA;
    const json = (await resp.json()) as {
      participantsContacts?: Array<{ firstName?: string; lastName?: string; phoneNumber?: string }>;
      messages?: Array<{ id: string; from?: string; text?: string | null; createdAt: string }>;
    };

    const contato = json.participantsContacts?.[0];
    const nome = contato ? ([contato.firstName, contato.lastName].filter(Boolean).join(" ").trim() || null) : null;
    const telefoneE164 = contato?.phoneNumber ? `+${String(contato.phoneNumber).replace(/\D/g, "")}` : null;

    const admin = (await import("firebase-admin")).default;
    const db = admin.firestore();
    const msgsCol = db.collection("atendimentos").doc(conversationId).collection("mensagens");

    const mensagens = (json.messages ?? []).filter((m) => !!m.text);
    const ordenadas = [...mensagens].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let ultimaMensagem: string | null = null;
    let ultimaMensagemEm: number | null = null;
    for (const m of ordenadas) {
      const createdAtMs = new Date(m.createdAt).getTime();
      ultimaMensagem = m.text ?? ultimaMensagem;
      ultimaMensagemEm = createdAtMs;
    }

    // Achado real (P1.2c) — checar cada mensagem com um .get() sequencial
    // (18 mensagens = 18 round-trips) levou a sincronia a 17s+, tempo
    // suficiente para uma reentrega/retry do ChatVolt colidir com o lock
    // de idempotência (ver withIdempotency) e virar um 500 falso. Uma
    // única leitura em lote (getAll) para checar existência + escritas em
    // paralelo reduz isso a uma fração do tempo.
    const refs = ordenadas.map((m) => msgsCol.doc(m.id));
    const existentes = refs.length > 0 ? await db.getAll(...refs) : [];
    const faltando = ordenadas.filter((_, i) => !existentes[i]?.exists);

    await Promise.all(
      faltando.map((m) => {
        const createdAtMs = new Date(m.createdAt).getTime();
        // "human" no vocabulário do ChatVolt = o CLIENTE do outro lado da
        // conversa (não confundir com humano do ERP assumindo o
        // atendimento — esse é sempre escrito por atdEnviarMensagemHumano,
        // outro codebase, actorType:"human", e nunca chega aqui porque o
        // dedup por id real já pula essas mensagens).
        //
        // P1.2d (achado real, falso-positivo investigado e corrigido) —
        // from:"agent" NÃO significa Valéria: o WhatsApp da VR está em
        // coexistência com o app oficial, e uma resposta humana enviada
        // por lá também chega como from:"agent" no ChatVolt, sem nenhum
        // campo que distinga as duas (testado contra uma mensagem
        // confirmadamente da Valéria — agentModel/usage/usageCredits/
        // userId vêm todos null nos dois casos, sources sempre []).
        // Nunca atribui à Valéria sem certeza — marca como
        // "agent_unknown" (equipe ou IA, indistinguível pelos dados
        // disponíveis) em vez de arriscar um autor errado no ERP.
        const actorType = m.from === "agent" ? "agent_unknown" : m.from === "human" ? "customer" : "system";
        const actorName = actorType === "agent_unknown" ? "Equipe/Valéria (autor não identificável)" : null;
        return msgsCol.doc(m.id).set({
          id: m.id, atendimentoId: conversationId, providerMessageId: m.id,
          idempotencyKey: null, actorType, actorId: null, actorName,
          text: m.text, attachments: [], deliveryStatus: "sent",
          provider: "whatsapp", createdAt: createdAtMs,
        });
      })
    );

    return { nome, telefoneE164, novasMensagens: faltando.length, totalMensagens: ordenadas.length, ultimaMensagem, ultimaMensagemEm };
  } catch (e) {
    console.error("[webhook.sincronizarConversaCompleta] falha (não bloqueia):", (e as Error).message);
    return SINCRONIA_VAZIA;
  }
}

/**
 * Upsert do atendimento canônico. Idempotente por design (mensagens
 * escritas por sincronizarConversaCompleta usam id real do ChatVolt como
 * doc id) — usa conversationId do Chatvolt DIRETO como atendimentoId (sem
 * indireção extra) para eliminar qualquer race condition de busca.
 *
 * `permiteCriar=false` (eventos de saída/log em conversa ainda
 * desconhecida) nunca cria um atendimento novo — só atualiza um que já
 * existe (mesma disciplina de sempre: nunca cria atendimento a partir de
 * uma mensagem de saída sozinha).
 */
async function upsertAtendimentoWhatsApp(params: {
  conversationId: string;
  channelPhone: string | null;
  texto: string;
  permiteCriar: boolean;
}): Promise<{ isNovo: boolean; atd: FirebaseFirestore.DocumentData } | null> {
  const admin = (await import("firebase-admin")).default;
  const db = admin.firestore();
  const ref = db.collection("atendimentos").doc(params.conversationId);
  const snap = await ref.get();
  const now = Date.now();

  if (!snap.exists) {
    if (!params.permiteCriar) return null;
    // P1.2b — backfill: busca TODO o histórico real da conversa (a
    // primeira vez que ela chega ao ERP pode já vir no meio de uma
    // conversa em andamento — Tools sempre funcionaram, só o espelho ERP
    // ficou para trás) + nome/telefone reais do contato do canal.
    const sync = await sincronizarConversaCompleta(params.conversationId);
    // P1.2c (achado real de E2E) — número na allowlist (config Firestore,
    // nunca hardcoded) já nasce isTeste=true. Todo o resto da cadeia
    // (lead/simulação/orçamento) já lê atendimentos/{id}.isTeste como
    // fonte de verdade (valeriaCriarOportunidade, executeCalculateQuote/
    // executeCreateQuote) — nenhuma mudança adicional foi necessária ali.
    const { isNumeroDeTeste } = await import("./test_phone_allowlist");
    const ehNumeroDeTeste = await isNumeroDeTeste(params.channelPhone ?? sync.telefoneE164);
    const registro = {
      id: params.conversationId,
      channel: "whatsapp",
      externalConversationId: null,
      providerConversationId: params.conversationId,
      contactId: null,
      leadId: null,
      clienteId: null,
      telefoneE164: params.channelPhone ?? sync.telefoneE164 ?? null,
      nome: sync.nome,
      empresa: null,
      modoAtendimento: "valeria",
      responsavelUid: null,
      responsavelNome: null,
      status: "aberto",
      classificacao: "nao_classificado",
      marca: "indefinido",
      resumo: null,
      briefingRef: null,
      oportunidadeId: null,
      orcamentoId: null,
      naoLidas: 0,
      ultimaMensagem: sync.ultimaMensagem ?? params.texto,
      ultimaInteracaoEm: sync.ultimaMensagemEm ?? now,
      createdAt: now,
      updatedAt: now,
      isTeste: ehNumeroDeTeste,
      requiresHuman: false,
      humanReason: null,
      priority: "NORMAL",
      historyBackfilledAt: now,
      historyBackfillCount: sync.novasMensagens,
    };
    await ref.set(registro);
    return { isNovo: true, atd: registro };
  }

  const atd = snap.data()!;
  const sync = await sincronizarConversaCompleta(params.conversationId);
  const patch: Record<string, unknown> = { updatedAt: now };
  if (sync.ultimaMensagem) {
    patch.ultimaMensagem = sync.ultimaMensagem;
    patch.ultimaInteracaoEm = sync.ultimaMensagemEm ?? now;
  } else {
    patch.ultimaMensagem = params.texto || atd.ultimaMensagem;
    patch.ultimaInteracaoEm = now;
  }
  // Nunca sobrescreve um telefone já conhecido com null; nunca apaga se o canal já informou antes.
  if (!atd.telefoneE164 && (params.channelPhone || sync.telefoneE164)) patch.telefoneE164 = params.channelPhone ?? sync.telefoneE164;
  // P1.2b — backfill do nome do contato só quando ainda não há nenhum
  // (nem do canal, nem dito pelo cliente) — nunca sobrescreve um nome já
  // confirmado.
  if (!atd.nome && !atd.leadId && !atd.clienteId && sync.nome) patch.nome = sync.nome;
  if (sync.novasMensagens > 0) {
    patch.historyBackfillCount = ((atd.historyBackfillCount as number) || 0) + sync.novasMensagens;
    if (!atd.historyBackfilledAt) patch.historyBackfilledAt = now;
  }
  await ref.set(patch, { merge: true });
  return { isNovo: false, atd: { ...atd, ...patch } };
}

async function detectarEPersistirConfirmacaoWhatsApp(conversationId: string, texto: string): Promise<void> {
  try {
    const admin = (await import("firebase-admin")).default;
    const db = admin.firestore();
    const tbRef = db.collection("valeria_technical_briefings").doc(conversationId);
    const tbSnap = await tbRef.get();
    if (!tbSnap.exists) return;
    const tbData = tbSnap.data() ?? {};
    const awaitingConfirmation = !!tbData.lastEligibleSimulation;
    if (!awaitingConfirmation) return;
    const intent = detectCommercialIntent({ texto, awaitingConfirmation });
    await tbRef.set({ clientConfirmedQuote: intent.confirmQuote, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.error("[webhook.detectarEPersistirConfirmacaoWhatsApp] falha (não bloqueia):", (e as Error).message);
  }
}

async function detectarEPersistirIdentidadeWhatsApp(
  conversationId: string, texto: string, atd: FirebaseFirestore.DocumentData, agentId: string, organizationId: string
): Promise<void> {
  if (atd.leadId || atd.clienteId) return;
  const nome = extrairNomeDoTexto(texto) || (atd.nome as string | null) || null;
  const telefone = atd.telefoneE164 as string | undefined;
  if (!nome || !telefone) return;
  const bearer = process.env.VALERIA_BEARER_SECRET;
  if (!bearer) return;
  try {
    const resp = await fetch(VALERIA_CRIAR_OPORTUNIDADE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, agentId, organizationId, nome, tel: telefone, origem: "valeria_whatsapp_identity_detector" }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await resp.json() as { data?: { leadId?: string } };
    const leadId = json.data?.leadId;
    if (leadId) {
      const admin = (await import("firebase-admin")).default;
      await admin.firestore().collection("atendimentos").doc(conversationId).set(
        { leadId, nome: (atd.nome as string | null) ?? nome, updatedAt: Date.now() },
        { merge: true }
      );
    }
  } catch (e) {
    console.error("[webhook.detectarEPersistirIdentidadeWhatsApp] falha (não bloqueia):", (e as Error).message);
  }
}

/**
 * Sprint P1.2 — roda o detector determinístico de complexidade sem receita
 * (complexity_detector.ts) e persiste o sinal no MESMO documento que
 * valeria.ts/orchestrator.ts leem (valeria_technical_briefings/{id}) —
 * ANTES de dispararExecucaoComercialWhatsApp, para que o gate do
 * orchestrator já veja o sinal neste mesmo turno, mesmo que productId
 * ainda não tenha sido definido. Nunca sobrescreve com array vazio (um
 * bloqueio de um turno anterior continua valendo mesmo que a mensagem
 * atual não repita a palavra) — mesma disciplina de nunca "esquecer" um
 * sinal de segurança já detectado.
 */
async function avaliarEPersistirComplexidadeWhatsApp(conversationId: string, texto: string): Promise<boolean> {
  try {
    const { detectUnsupportedComplexity } = await import("./complexity_detector");
    const admin4 = (await import("firebase-admin")).default;
    const tbRef = admin4.firestore().collection("valeria_technical_briefings").doc(conversationId);
    const tbSnap = await tbRef.get();
    const tbData = tbSnap.exists ? tbSnap.data() ?? {} : {};
    const productId = (tbData.productId as string | undefined) ?? null;
    const jaBloqueado = Array.isArray(tbData.unsupportedComplexityReasonCodes) && tbData.unsupportedComplexityReasonCodes.length > 0;

    const r = detectUnsupportedComplexity({ texto, productId });
    if (!r.unsupportedComplexity) return jaBloqueado;

    const mudou = JSON.stringify(tbData.unsupportedComplexityReasonCodes ?? []) !== JSON.stringify(r.reasonCodes);
    if (mudou) {
      await tbRef.set({ unsupportedComplexityReasonCodes: r.reasonCodes, updatedAt: Date.now() }, { merge: true });
    }
    return true;
  } catch (e) {
    console.error("[webhook.avaliarEPersistirComplexidadeWhatsApp] falha (não bloqueia):", (e as Error).message);
    return false;
  }
}

/** Dispara a execução comercial server-side e devolve sinais para o handoff detector (nunca lança). */
async function dispararExecucaoComercialWhatsApp(
  conversationId: string, agentId: string, organizationId: string, channelPhone: string | null
): Promise<{ pricingUnsupported: boolean; produtoComplexoSemReceita: boolean; erroSistemaReal: boolean }> {
  const sinais = { pricingUnsupported: false, produtoComplexoSemReceita: false, erroSistemaReal: false };
  const bearer = process.env.VALERIA_BEARER_SECRET;
  if (!bearer) return sinais;
  try {
    const resp = await fetch(VALERIA_GET_CONTEXTO_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, agentId, organizationId, channelPhone: channelPhone || undefined }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await resp.json() as {
      data?: { executedAction?: { action?: string; result?: { eligibility?: string; warnings?: string[]; errorCode?: string } } };
    };
    const ea = json.data?.executedAction;
    if (ea?.action === "calculate_quote") {
      const elig = ea.result?.eligibility;
      if (elig === "HUMAN_VALIDATION_REQUIRED") sinais.pricingUnsupported = true;
      if (elig === "TEMPORARILY_UNAVAILABLE") sinais.erroSistemaReal = true;
      if ((ea.result?.warnings ?? []).some((w) => w.includes("não é uma receita embutida conhecida"))) {
        sinais.produtoComplexoSemReceita = true;
      }
    }
  } catch (e) {
    console.error("[webhook.dispararExecucaoComercialWhatsApp] falha (não bloqueia):", (e as Error).message);
  }
  return sinais;
}

async function avaliarEPersistirHandoff(
  conversationId: string,
  texto: string,
  sinais: { pricingUnsupported: boolean; produtoComplexoSemReceita: boolean; erroSistemaReal: boolean }
): Promise<void> {
  try {
    const { detectHumanHandoff } = await import("./handoff_detector");
    const r = detectHumanHandoff({ texto, ...sinais });
    if (!r.requiresHuman) return;
    const admin3 = (await import("firebase-admin")).default;
    await admin3.firestore().collection("atendimentos").doc(conversationId).set(
      { requiresHuman: true, humanReason: r.humanReason, priority: r.priority, handoffAt: Date.now(), updatedAt: Date.now() },
      { merge: true }
    );
  } catch (e) {
    console.error("[webhook.avaliarEPersistirHandoff] falha (não bloqueia):", (e as Error).message);
  }
}

const SECRET_NAMES = ["VALERIA_BEARER_SECRET", "VALERIA_BEARER_SECRET_PREV", "CHATVOLT_API_KEY"];

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
  return (raw as Record<string, unknown>[]).map((a) => ({
    url:        a["url"]        as string | undefined,
    mimeType:   (a["mimeType"] ?? a["mime_type"] ?? a["type"]) as string | undefined,
    tamanho:    (a["tamanho"]  ?? a["size"])                   as number | undefined,
    nome:       (a["nome"]     ?? a["name"] ?? a["filename"])  as string | undefined,
    transcricao: a["transcricao"]                              as string | undefined,
  }));
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

      // Campos de conteúdo (vários aliases do Chatvolt)
      const mensagemCliente =
        (body["mensagemCliente"] ?? body["userMessage"]  ?? body["message"] ?? body["text"]) as string | undefined;
      const respostaAgente  =
        (body["respostaAgente"]  ?? body["agentMessage"] ?? body["response"])                as string | undefined;

      // Sprint P1.2b (achado real de E2E, primeira entrega genuína do
      // ChatVolt) — eventType="AGENT_USER_MESSAGE" chegou carregando o
      // TEXTO DO CLIENTE (mensagemCliente preenchido, respostaAgente
      // null), não a resposta da Valéria como a documentação levava a
      // supor (nunca confirmado contra payload real até este teste).
      // Como o mesmo eventType aparentemente cobre as duas direções, o
      // discriminador confiável é o CONTEÚDO — nunca só o nome do evento.
      const { tipo } = mapEventToInteracao(eventType as WebhookEventType);
      const direcao: "entrada" | "saida" =
        mensagemCliente && !respostaAgente ? "entrada" : (respostaAgente ? "saida" : mapEventToInteracao(eventType as WebhookEventType).direcao);
      const mensagemLog = direcao === "entrada" ? mensagemCliente : respostaAgente;

      // ── P1.0/P1.2b — espelho operacional no ERP + pipeline determinístico ──
      // Só para eventos reais de WhatsApp COM telefone de canal conhecido
      // (nunca para o chat de teste interno do Chatvolt, sem channelPhone).
      // upsertAtendimentoWhatsApp roda para QUALQUER direção (entrada ou
      // saída) — internamente chama sincronizarConversaCompleta, que busca
      // o histórico REAL da conversa (API do ChatVolt), então tanto a
      // mensagem do cliente quanto a resposta real da Valéria acabam
      // espelhadas, mesmo que o payload do evento em si não carregue o
      // texto da resposta (achado real: AGENT_MESSAGE_SENDED não carrega
      // texto em nenhum campo). Só CRIA um atendimento novo a partir de
      // mensagem de entrada — evento de saída sozinho em conversa
      // desconhecida nunca cria nada (permiteCriar).
      if (ctx.channelPhone) {
        try {
          const resultado = await upsertAtendimentoWhatsApp({
            conversationId: ctx.conversationId,
            channelPhone: ctx.channelPhone,
            texto: mensagemCliente ?? "",
            permiteCriar: direcao === "entrada" && !!mensagemCliente,
          });
          if (resultado && direcao === "entrada" && mensagemCliente) {
            const { atd } = resultado;
            // Sprint P1.2, item 10 — allowlist de números de teste
            // (test_phone_allowlist.ts, config Firestore, nunca
            // hardcoded). Allowlist vazia = sem restrição (produção
            // normal). Allowlist não-vazia = só os números listados
            // disparam o pipeline de AÇÃO comercial (identidade/
            // confirmação/complexidade/handoff/execução) — qualquer
            // outro número só tem a mensagem preservada acima, nunca cria
            // orçamento nem altera estado comercial. NUNCA impede o
            // próprio Chatvolt de responder automaticamente (isso não
            // passa pelo nosso backend) — ver aviso completo no
            // cabeçalho de test_phone_allowlist.ts.
            const { permitidoParaPipeline } = await import("./test_phone_allowlist");
            const podeExecutarPipeline = await permitidoParaPipeline(ctx.channelPhone);
            if (podeExecutarPipeline && atd.modoAtendimento !== "humano") {
              await detectarEPersistirIdentidadeWhatsApp(ctx.conversationId, mensagemCliente, atd, ctx.agentId, ctx.organizationId);
              await detectarEPersistirConfirmacaoWhatsApp(ctx.conversationId, mensagemCliente);
              const complexidadeDetectada = await avaliarEPersistirComplexidadeWhatsApp(ctx.conversationId, mensagemCliente);
              const sinais = await dispararExecucaoComercialWhatsApp(ctx.conversationId, ctx.agentId, ctx.organizationId, ctx.channelPhone);
              if (complexidadeDetectada) sinais.produtoComplexoSemReceita = true;
              await avaliarEPersistirHandoff(ctx.conversationId, mensagemCliente, sinais);
            }
          }
        } catch (e) {
          console.error("[webhook] falha no espelho operacional WhatsApp (não bloqueia log do evento):", (e as Error).message);
        }
      }

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
      // BUG corrigido (Fase 0/1, achado pelo cenário 6): anexosMeta/
      // bloqueioInfo como `undefined` faziam o Firestore rejeitar o
      // documento INTEIRO — toda mensagem de texto puro (sem anexo)
      // falhava. Campos opcionais agora são OMITIDOS, nunca undefined.
      const msgDoc: Record<string, unknown> = {
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
        ts:                  now,
        createdAt:           nowIso,
      };
      if (anexos.length > 0) msgDoc["anexosMeta"] = anexos;
      if (bloqueioInfo)      msgDoc["bloqueioInfo"] = bloqueioInfo;
      await db.collection("valeria_msgs").add(msgDoc);

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

  // Achado real (P1.2c) — "IDEMPOTENT_PROCESSING" (outra requisição com a
  // MESMA chave ainda em andamento, ver idempotency.ts) não é uma falha —
  // é esperado sempre que o ChatVolt reentrega/duplica um evento enquanto
  // o primeiro ainda está processando (mais provável agora que a
  // sincronia de histórico pode levar alguns segundos). Responder 500
  // para isso fazia o ChatVolt (e o log) registrar erro onde não havia
  // nenhum — 200 sempre, exceto falha real.
  const emProcessamento = (result.warnings ?? []).some((w) => w.startsWith("IDEMPOTENT_PROCESSING"));
  res.status(result.success || emProcessamento ? 200 : 500).json(result);
});
