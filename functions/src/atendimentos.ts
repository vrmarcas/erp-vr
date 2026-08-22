/**
 * atendimentos.ts — módulo "Atendimentos" (sprint 2026-08-21).
 *
 * Fluxo: ERP → Atendimentos → backend VR (este arquivo) → AIProvider
 * (Chatvolt hoje) → agente Valéria → Tools → ERP/CRM → resposta →
 * Atendimentos. O Chatvolt é só um provider substituível (ver ai_provider.ts).
 *
 * Dados canônicos ficam no ERP: `atendimentos/{id}` +
 * `atendimentos/{id}/mensagens/{id}`. Coleções NOVAS e dedicadas — não
 * reaproveitam `valeria_conversations`/`valeria_msgs` porque essas duas já
 * têm um propósito e um esquema de doc-id (keyed por conversationId do
 * Chatvolt, escritas pelo webhook `valeriaWebhookChatvolt` do canal
 * WhatsApp) que não combina com o modelo canônico pedido aqui (atendimentoId
 * PRÓPRIO do ERP, independente do providerConversationId — exigência
 * explícita para permitir trocar de provider sem perder histórico).
 *
 * Auth: nunca confia em role vinda do payload — sempre
 * `getCallerVerificado`/`requireRole` (auth_helper.ts), a mesma fronteira
 * usada por compras/estoque/produção/vitre.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { getCallerVerificado, requireRole, acquireIdem, writeAudit } from "./auth_helper";
import { ChatVoltProvider } from "./chatvolt_provider";
import { AIProvider } from "./ai_provider";

const COL_ATD = "atendimentos";
const SUB_MSG = "mensagens";

const provider: AIProvider = new ChatVoltProvider();

// ── Enums (comentário, não impostos pelo Firestore — validados no código) ──
// channel: 'erp_web' | 'whatsapp_meta' | 'instagram' | 'site'
// modoAtendimento: 'valeria' | 'humano' | 'aguardando_humano'
// status: 'aberto' | 'aguardando_cliente' | 'aguardando_humano' | 'resolvido'
// classificacao: 'catalogo' | 'recompra' | 'projeto_sob_medida' | 'nao_classificado'
// marca: 'vitre' | 'vr' | 'misto' | 'indefinido'
// actorType (mensagens): 'customer' | 'valeria' | 'human' | 'system'

function db() {
  return admin.firestore();
}

async function carregarAtendimento(atendimentoId: string): Promise<FirebaseFirestore.DocumentSnapshot> {
  const ref = db().collection(COL_ATD).doc(atendimentoId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Atendimento não encontrado.");
  }
  return snap;
}

async function nomeStaff(uid: string): Promise<string> {
  try {
    const doc = await db().collection("erp_vr_usuarios").doc(uid).get();
    const nome = doc.exists ? (doc.data()?.nome as string | undefined) : undefined;
    return nome || uid;
  } catch {
    return uid;
  }
}

// ── 1. Criar conversa de teste (Master only — seção 20 da sprint) ──────────
export const atdCriarConversaTeste = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, [], "criar conversa de homologação em Atendimentos"); // só master (requireRole deixa master passar sempre)

  const nomeClienteSimulado = String(data?.nomeClienteSimulado || "Cliente Teste").trim().slice(0, 80);

  const ref = db().collection(COL_ATD).doc();
  const now = Date.now();
  const registro = {
    id: ref.id,
    channel: "erp_web",
    externalConversationId: null,
    providerConversationId: null,
    contactId: null,
    leadId: null,
    clienteId: null,
    telefoneE164: null,
    nome: nomeClienteSimulado,
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
    ultimaMensagem: null,
    ultimaInteracaoEm: now,
    createdAt: now,
    updatedAt: now,
    isTeste: true,
    criadoPorUid: caller.uid,
  };
  await ref.set(registro);
  await writeAudit("atendimentos_audit_log", "criar_conversa_teste", caller.uid, caller.role, { atendimentoId: ref.id });
  return { ok: true, id: ref.id };
});

// ── 2. Simular mensagem do cliente (Master only, dispara a Valéria) ────────
export const atdSimularMensagemCliente = functions
  // timeoutSeconds acima do CHATVOLT_QUERY_TIMEOUT_MS (50s, ver
  // chatvolt_provider.ts) + folga para leitura/escrita Firestore.
  .runWith({ secrets: ["CHATVOLT_API_KEY"], timeoutSeconds: 90 })
  .https.onCall(async (data, context) => {
    const caller = await getCallerVerificado(context);
    requireRole(caller, [], "simular mensagem de cliente em Atendimentos");

    const atendimentoId = String(data?.atendimentoId || "").trim();
    const texto = String(data?.texto || "").trim();
    const requestId = String(data?.requestId || "").trim();
    if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
    if (!texto) throw new functions.https.HttpsError("invalid-argument", "texto obrigatório.");
    if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

    const snap = await carregarAtendimento(atendimentoId);
    const atd = snap.data()!;
    if (!atd.isTeste) {
      throw new functions.https.HttpsError("failed-precondition", "Simular mensagem de cliente só é permitido em conversas de teste.");
    }

    const acquired = await acquireIdem("atendimentos_idem", `atd_sim:${atendimentoId}:${requestId}`);
    if (!acquired) {
      return { ok: true, jaProcessado: true };
    }

    const msgRef = snap.ref.collection(SUB_MSG).doc();
    const now = Date.now();
    await msgRef.set({
      id: msgRef.id,
      atendimentoId,
      providerMessageId: null,
      idempotencyKey: requestId,
      actorType: "customer",
      actorId: caller.uid,
      actorName: atd.nome || "Cliente (simulado)",
      text: texto,
      attachments: [],
      deliveryStatus: "sent",
      provider: "erp",
      createdAt: now,
    });
    await snap.ref.set({ ultimaMensagem: texto, ultimaInteracaoEm: now, updatedAt: now }, { merge: true });

    // Modo humano: não aciona a Valéria — humano responde pelo composer.
    if (atd.modoAtendimento === "humano") {
      return { ok: true, jaProcessado: false, resposta: null };
    }

    const result = await provider.sendMessage({
      atendimentoId,
      providerConversationId: atd.providerConversationId || null,
      texto,
      contato: { nome: atd.nome },
    });

    if (!result.ok) {
      const failRef = snap.ref.collection(SUB_MSG).doc();
      await failRef.set({
        id: failRef.id,
        atendimentoId,
        providerMessageId: null,
        idempotencyKey: `${requestId}:falha`,
        actorType: "system",
        actorId: null,
        actorName: "Sistema",
        text: "Não foi possível obter resposta da Valéria. Tente novamente.",
        attachments: [],
        deliveryStatus: "failed",
        provider: "chatvolt",
        createdAt: Date.now(),
        metadata: { erro: result.erro || "ERRO_DESCONHECIDO" },
      });
      await writeAudit("atendimentos_audit_log", "provider_falhou", caller.uid, caller.role, { atendimentoId, erro: result.erro });
      return { ok: false, erro: result.erro || "ERRO_DESCONHECIDO" };
    }

    const respRef = snap.ref.collection(SUB_MSG).doc();
    const nowResp = Date.now();
    await respRef.set({
      id: respRef.id,
      atendimentoId,
      providerMessageId: result.providerMessageId || null,
      idempotencyKey: `${requestId}:resposta`,
      actorType: "valeria",
      actorId: null,
      actorName: "Valéria",
      text: result.resposta,
      attachments: [],
      deliveryStatus: "sent",
      provider: "chatvolt",
      createdAt: nowResp,
    });
    await snap.ref.set(
      {
        providerConversationId: result.providerConversationId || atd.providerConversationId || null,
        ultimaMensagem: result.resposta,
        ultimaInteracaoEm: nowResp,
        updatedAt: nowResp,
      },
      { merge: true }
    );

    return { ok: true, jaProcessado: false, resposta: result.resposta };
  });

// ── 2b. Retentar mensagem que falhou (retry seguro — seção 5 do hotfix
//    2026-08-22). NUNCA cria outra mensagem de cliente: reaproveita o
//    texto da mensagem original a partir do messageId da falha, e
//    reprocessa somente a chamada ao provider. ─────────────────────────────
export const atdRetentarMensagem = functions
  .runWith({ secrets: ["CHATVOLT_API_KEY"], timeoutSeconds: 90 })
  .https.onCall(async (data, context) => {
    const caller = await getCallerVerificado(context);
    requireRole(caller, [], "retentar mensagem em Atendimentos");

    const atendimentoId = String(data?.atendimentoId || "").trim();
    const failedMessageId = String(data?.messageId || "").trim();
    const requestId = String(data?.requestId || "").trim();
    if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
    if (!failedMessageId) throw new functions.https.HttpsError("invalid-argument", "messageId obrigatório.");
    if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

    const snap = await carregarAtendimento(atendimentoId);
    const atd = snap.data()!;
    if (!atd.isTeste) {
      throw new functions.https.HttpsError("failed-precondition", "Retentar mensagem só é permitido em conversas de teste.");
    }

    const acquired = await acquireIdem("atendimentos_idem", `atd_retry:${atendimentoId}:${requestId}`);
    if (!acquired) return { ok: true, jaProcessado: true };

    const falhaRef = snap.ref.collection(SUB_MSG).doc(failedMessageId);
    const falhaSnap = await falhaRef.get();
    if (!falhaSnap.exists) throw new functions.https.HttpsError("not-found", "Mensagem de falha não encontrada.");
    const falha = falhaSnap.data()!;
    if (falha.deliveryStatus !== "failed") {
      throw new functions.https.HttpsError("failed-precondition", "Esta mensagem já não está mais em estado de falha.");
    }

    const idemBase = String(falha.idempotencyKey || "").replace(/:falha$/, "");
    const clienteMsgSnap = await snap.ref
      .collection(SUB_MSG)
      .where("idempotencyKey", "==", idemBase)
      .where("actorType", "==", "customer")
      .limit(1)
      .get();
    if (clienteMsgSnap.empty) {
      throw new functions.https.HttpsError("not-found", "Mensagem original do cliente não encontrada para retry.");
    }
    const texto = String(clienteMsgSnap.docs[0].data().text || "");

    const result = await provider.sendMessage({
      atendimentoId,
      providerConversationId: atd.providerConversationId || null,
      texto,
      contato: { nome: atd.nome },
    });

    await falhaRef.set({ deliveryStatus: "retried" }, { merge: true });

    if (!result.ok) {
      const failRef = snap.ref.collection(SUB_MSG).doc();
      await failRef.set({
        id: failRef.id,
        atendimentoId,
        providerMessageId: null,
        idempotencyKey: `${idemBase}:falha:${requestId}`,
        actorType: "system",
        actorId: null,
        actorName: "Sistema",
        text: "Não foi possível obter resposta da Valéria. Tente novamente.",
        attachments: [],
        deliveryStatus: "failed",
        provider: "chatvolt",
        createdAt: Date.now(),
        metadata: { erro: result.erro || "ERRO_DESCONHECIDO" },
      });
      await writeAudit("atendimentos_audit_log", "retry_falhou", caller.uid, caller.role, { atendimentoId, erro: result.erro });
      return { ok: false, erro: result.erro || "ERRO_DESCONHECIDO" };
    }

    const respRef = snap.ref.collection(SUB_MSG).doc();
    const nowResp = Date.now();
    await respRef.set({
      id: respRef.id,
      atendimentoId,
      providerMessageId: result.providerMessageId || null,
      idempotencyKey: `${idemBase}:resposta:${requestId}`,
      actorType: "valeria",
      actorId: null,
      actorName: "Valéria",
      text: result.resposta,
      attachments: [],
      deliveryStatus: "sent",
      provider: "chatvolt",
      createdAt: nowResp,
    });
    await snap.ref.set(
      {
        providerConversationId: result.providerConversationId || atd.providerConversationId || null,
        ultimaMensagem: result.resposta,
        ultimaInteracaoEm: nowResp,
        updatedAt: nowResp,
      },
      { merge: true }
    );

    return { ok: true, jaProcessado: false, resposta: result.resposta };
  });

// ── 3. Enviar mensagem humana (modo humano, nunca aciona a Valéria) ────────
export const atdEnviarMensagemHumano = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "enviar mensagem humana em Atendimentos");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  const texto = String(data?.texto || "").trim();
  const requestId = String(data?.requestId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  if (!texto) throw new functions.https.HttpsError("invalid-argument", "texto obrigatório.");
  if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

  const snap = await carregarAtendimento(atendimentoId);
  const atd = snap.data()!;
  if (atd.modoAtendimento !== "humano") {
    throw new functions.https.HttpsError("failed-precondition", "Assuma o atendimento antes de enviar mensagem como humano.");
  }

  const acquired = await acquireIdem("atendimentos_idem", `atd_hum:${atendimentoId}:${requestId}`);
  if (!acquired) return { ok: true, jaProcessado: true };

  const nome = await nomeStaff(caller.uid);
  const msgRef = snap.ref.collection(SUB_MSG).doc();
  const now = Date.now();
  await msgRef.set({
    id: msgRef.id,
    atendimentoId,
    providerMessageId: null,
    idempotencyKey: requestId,
    actorType: "human",
    actorId: caller.uid,
    actorName: nome,
    text: texto,
    attachments: [],
    deliveryStatus: "sent",
    provider: "erp",
    createdAt: now,
  });
  await snap.ref.set({ ultimaMensagem: texto, ultimaInteracaoEm: now, updatedAt: now }, { merge: true });
  return { ok: true, jaProcessado: false };
});

// ── 4. Assumir atendimento ──────────────────────────────────────────────────
export const atdAssumirAtendimento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "assumir atendimento");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  const snap = await carregarAtendimento(atendimentoId);

  const nome = await nomeStaff(caller.uid);
  const now = Date.now();
  await snap.ref.set(
    {
      modoAtendimento: "humano",
      responsavelUid: caller.uid,
      responsavelNome: nome,
      status: "aberto",
      updatedAt: now,
    },
    { merge: true }
  );
  const sysRef = snap.ref.collection(SUB_MSG).doc();
  await sysRef.set({
    id: sysRef.id, atendimentoId, providerMessageId: null, idempotencyKey: null,
    actorType: "system", actorId: caller.uid, actorName: "Sistema",
    text: `${nome} assumiu o atendimento.`, attachments: [], deliveryStatus: "sent",
    provider: "erp", createdAt: now,
  });
  await writeAudit("atendimentos_audit_log", "assumir", caller.uid, caller.role, { atendimentoId });
  return { ok: true };
});

// ── 5. Devolver para Valéria ─────────────────────────────────────────────────
export const atdDevolverParaValeria = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "devolver atendimento para a Valéria");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  const snap = await carregarAtendimento(atendimentoId);

  const now = Date.now();
  await snap.ref.set(
    { modoAtendimento: "valeria", responsavelUid: null, responsavelNome: null, updatedAt: now },
    { merge: true }
  );
  const nome = await nomeStaff(caller.uid);
  const sysRef = snap.ref.collection(SUB_MSG).doc();
  await sysRef.set({
    id: sysRef.id, atendimentoId, providerMessageId: null, idempotencyKey: null,
    actorType: "system", actorId: caller.uid, actorName: "Sistema",
    text: `${nome} devolveu o atendimento para a Valéria.`, attachments: [], deliveryStatus: "sent",
    provider: "erp", createdAt: now,
  });
  await writeAudit("atendimentos_audit_log", "devolver_valeria", caller.uid, caller.role, { atendimentoId });
  return { ok: true };
});

// ── 6. Resolver atendimento ──────────────────────────────────────────────────
export const atdResolverAtendimento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "resolver atendimento");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  const snap = await carregarAtendimento(atendimentoId);

  const now = Date.now();
  await snap.ref.set({ status: "resolvido", updatedAt: now }, { merge: true });
  await writeAudit("atendimentos_audit_log", "resolver", caller.uid, caller.role, { atendimentoId });
  return { ok: true };
});

// ── 7. Limpar conversa de teste (Master only, hard guard isTeste) ──────────
export const atdLimparConversaTeste = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, [], "limpar conversa de teste em Atendimentos");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  const snap = await carregarAtendimento(atendimentoId);
  const atd = snap.data()!;
  if (!atd.isTeste) {
    throw new functions.https.HttpsError("failed-precondition", "Só é possível limpar conversas marcadas como teste (isTeste=true).");
  }

  const msgs = await snap.ref.collection(SUB_MSG).get();
  const batch = db().batch();
  msgs.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(snap.ref);
  await batch.commit();
  await writeAudit("atendimentos_audit_log", "limpar_teste", caller.uid, caller.role, { atendimentoId });
  return { ok: true };
});
