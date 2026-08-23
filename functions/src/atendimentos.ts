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
import { getCallerVerificado, requireRole, acquireIdem, writeAudit, parseDoc } from "./auth_helper";
import { ChatVoltProvider } from "./chatvolt_provider";
import { AIProvider } from "./ai_provider";
import { checkAuth } from "./valeria";

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

// ══════════════════════════════════════════════════════════════════════════
// RODADA 9, FECHAMENTO (2026-08-23) — Bloqueador 2: os botões "Criar/Abrir
// cliente", "Criar/Abrir oportunidade" e "Revisar e criar orçamento" do
// painel de Atendimentos eram só front-end — nada persistia clienteId/
// leadId/orcamentoId no atendimento porque a Rule de `atendimentos` já
// bloqueia (corretamente) escrita direta do client, e não existia nenhuma
// Cloud Function para fazer esse write com Admin SDK. As 3 funções abaixo
// fecham esse elo, sempre gravando de volta em atendimentos/{id} — o
// vínculo passa a sobreviver a reload/outra sessão.
//
// erp_vr/clientes é um ARRAY agregado (CLIENTES_DATA no client) — dedupe
// pelo MESMO critério já usado por _crmBuscarClienteDuplicado() no
// index.html (nome normalizado OU e-mail OU telefone normalizado com
// >=8 dígitos, containment) — nunca uma fórmula nova.
// erp_vr/crm_leads é um OBJETO agregado keyed por id (CRM_LEADS no
// client, mesmo documento que valeriaCriarOportunidade usa do lado
// Chatvolt) — dedupe por telefone normalizado, mesmo critério.
// ══════════════════════════════════════════════════════════════════════════

const COL_ERP = "erp_vr";

interface ClienteRegistro {
  id: string; nome: string; tipo: string; marca: string; tel: string; email: string;
  cidade: string; ultimoPedido: string; os: string[]; obs?: string;
}
interface LeadRegistro {
  nome: string; tipo: string; marca: string; sub: string; contato: string; tel: string; email: string;
  temp: string; score: number; resumo_ia: string; valor_potencial: string; cor: string;
  origem: string; etapa: string; tempo: string; dores: string[];
  intencao: { produto: string; material: string; medidas: string; quantidade: string };
  clienteId?: string; atendimentoId?: string;
}

export function normTelAtd(tel: string): string {
  return (tel || "").replace(/\D/g, "");
}
export function normNomeAtd(nome: string): string {
  return (nome || "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function encontrarClienteDuplicado(lista: ClienteRegistro[], nome: string, tel: string, email: string): ClienteRegistro | null {
  const nNorm = normNomeAtd(nome);
  const tNorm = normTelAtd(tel);
  const eNorm = (email || "").toLowerCase().trim();
  return (
    lista.find((c) => {
      if (normNomeAtd(c.nome) === nNorm && nNorm) return true;
      if (eNorm && eNorm.length > 3 && (c.email || "").toLowerCase() === eNorm) return true;
      if (tNorm.length >= 8 && normTelAtd(c.tel).includes(tNorm)) return true;
      return false;
    }) || null
  );
}

// ── 8. Vincular/criar cliente a partir de um atendimento ───────────────────
// Mesma regra pedida: se já existe cliente vinculado (atd.clienteId), só
// devolve para abrir. Senão, procura duplicado pelos dados JÁ CONFIRMADOS
// da conversa; se não achar, cria com os dados mínimos disponíveis — nunca
// inventa nome/telefone.
export const atdVincularCliente = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "vincular cliente a partir de um atendimento");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  const atdSnap = await carregarAtendimento(atendimentoId);
  const atd = atdSnap.data()!;

  if (atd.clienteId) {
    return { ok: true, clienteId: atd.clienteId as string, criado: false, encontrado: false };
  }

  const nome = String(data?.nome || atd.nome || "").trim();
  const tel = String(data?.telefoneE164 || atd.telefoneE164 || "").trim();
  const email = String(data?.email || "").trim();
  if (!nome || !tel) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Nome e telefone são obrigatórios para criar cliente — ainda faltam na conversa."
    );
  }
  const marca = atd.marca === "vitre" ? "vitre" : "vr";

  const db_ = db();
  const resultado = await db_.runTransaction(async (tx) => {
    const ref = db_.collection(COL_ERP).doc("clientes");
    const snap = await tx.get(ref);
    const lista = parseDoc<ClienteRegistro[]>(snap, []);

    const dup = encontrarClienteDuplicado(lista, nome, tel, email);
    if (dup) return { id: dup.id, criado: false };

    const novoId = "atd_cli_" + atdSnap.ref.id.slice(0, 8) + "_" + Date.now().toString(36);
    const hoje = new Date();
    const dataHoje =
      String(hoje.getDate()).padStart(2, "0") + "/" + String(hoje.getMonth() + 1).padStart(2, "0") + "/" + hoje.getFullYear();
    const novoCliente: ClienteRegistro = {
      id: novoId, nome, tipo: marca === "vr" ? "PJ" : "PF", marca,
      tel, email: email || "—", cidade: "—", ultimoPedido: dataHoje, os: [],
      obs: "Cadastro criado a partir do Atendimento " + atendimentoId + ".",
    };
    lista.push(novoCliente);
    tx.set(ref, { data: JSON.stringify(lista), ts: Date.now() });
    return { id: novoId, criado: true };
  });

  await atdSnap.ref.set({ clienteId: resultado.id, updatedAt: Date.now() }, { merge: true });
  await writeAudit("atendimentos_audit_log", "vincular_cliente", caller.uid, caller.role, {
    atendimentoId, clienteId: resultado.id, criado: resultado.criado,
  });
  return { ok: true, clienteId: resultado.id, criado: resultado.criado, encontrado: !resultado.criado };
});

// ── 9. Vincular/criar oportunidade a partir de um atendimento ──────────────
// Mesma arquitetura já usada por valeriaCriarOportunidade (dedupe por
// telefone no MESMO documento erp_vr/crm_leads que o Kanban do CRM usa) —
// aqui só o caminho de auth muda (usuário real do ERP, não o agente).
// Também garante o cliente (reaproveita a mesma lógica de
// atdVincularCliente) e grava a origem como "atendimento".
export const atdVincularOportunidade = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "vincular oportunidade a partir de um atendimento");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  const atdSnap = await carregarAtendimento(atendimentoId);
  const atd = atdSnap.data()!;

  if (atd.leadId) {
    return { ok: true, leadId: atd.leadId as string, criado: false };
  }

  const nome = String(data?.nome || atd.nome || "").trim();
  const tel = String(data?.telefoneE164 || atd.telefoneE164 || "").trim();
  const email = String(data?.email || "").trim();
  if (!nome || !tel) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Nome e telefone são obrigatórios para criar oportunidade — ainda faltam na conversa."
    );
  }
  const marca = atd.marca === "vitre" ? "vitre" : "vr";
  const produto = String(data?.produto || "").trim();

  const db_ = db();
  const resultado = await db_.runTransaction(async (tx) => {
    const refLeads = db_.collection(COL_ERP).doc("crm_leads");
    const refClientes = db_.collection(COL_ERP).doc("clientes");
    const [snapLeads, snapClientes] = await Promise.all([tx.get(refLeads), tx.get(refClientes)]);
    const leads = parseDoc<Record<string, LeadRegistro>>(snapLeads, {});
    const clientes = parseDoc<ClienteRegistro[]>(snapClientes, []);

    const tNorm = normTelAtd(tel);
    let leadIdExistente: string | null = null;
    for (const [id, l] of Object.entries(leads)) {
      if (l.atendimentoId === atendimentoId) { leadIdExistente = id; break; }
      if (tNorm.length >= 8 && normTelAtd(l.tel).includes(tNorm)) { leadIdExistente = id; break; }
    }
    if (leadIdExistente) return { id: leadIdExistente, criado: false, clienteId: leads[leadIdExistente].clienteId || null };

    // Garante o cliente (mesma regra de atdVincularCliente) antes de criar a oportunidade.
    let clienteId = (atd.clienteId as string) || null;
    let clientesMudou = false;
    if (!clienteId) {
      const dup = encontrarClienteDuplicado(clientes, nome, tel, email);
      if (dup) {
        clienteId = dup.id;
      } else {
        const novoIdCli = "atd_cli_" + atdSnap.ref.id.slice(0, 8) + "_" + Date.now().toString(36);
        const hoje = new Date();
        const dataHoje =
          String(hoje.getDate()).padStart(2, "0") + "/" + String(hoje.getMonth() + 1).padStart(2, "0") + "/" + hoje.getFullYear();
        clientes.push({
          id: novoIdCli, nome, tipo: marca === "vr" ? "PJ" : "PF", marca,
          tel, email: email || "—", cidade: "—", ultimoPedido: dataHoje, os: [],
          obs: "Cadastro criado a partir do Atendimento " + atendimentoId + ".",
        });
        clienteId = novoIdCli;
        clientesMudou = true;
      }
    }

    const novoIdLead = "atd_lead_" + atdSnap.ref.id.slice(0, 8) + "_" + Date.now().toString(36);
    const novoLead: LeadRegistro = {
      nome, tipo: marca === "vr" ? "B2B" : "B2C", marca,
      sub: produto || tel, contato: nome, tel, email: email || "—",
      temp: "quente", score: 60,
      resumo_ia: (atd.resumo as string) || "Oportunidade criada a partir do Atendimento.",
      valor_potencial: "A definir", cor: "#FCA5A5",
      origem: "atendimento", etapa: "ia_novo", tempo: "agora",
      dores: produto ? [produto] : [],
      intencao: { produto: produto || "—", material: "—", medidas: "—", quantidade: "—" },
      clienteId: clienteId || undefined, atendimentoId,
    };
    leads[novoIdLead] = novoLead;

    tx.set(refLeads, { data: JSON.stringify(leads), ts: Date.now() });
    if (clientesMudou) tx.set(refClientes, { data: JSON.stringify(clientes), ts: Date.now() });
    return { id: novoIdLead, criado: true, clienteId };
  });

  const patch: Record<string, unknown> = { leadId: resultado.id, updatedAt: Date.now() };
  if (resultado.clienteId && !atd.clienteId) patch.clienteId = resultado.clienteId;
  await atdSnap.ref.set(patch, { merge: true });
  await writeAudit("atendimentos_audit_log", "vincular_oportunidade", caller.uid, caller.role, {
    atendimentoId, leadId: resultado.id, criado: resultado.criado,
  });
  return { ok: true, leadId: resultado.id, criado: resultado.criado, clienteId: resultado.clienteId || null };
});

// ── 10. Vincular orçamento já salvo a um atendimento ────────────────────────
// O cálculo/salvamento do orçamento em si continua 100% o fluxo oficial já
// existente (Novo Orçamento → orcRecalc → salvar) — esta função só grava
// de volta a referência, depois que o orçamento real já existe.
export const atdVincularOrcamento = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "vincular orçamento a um atendimento");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  const orcamentoId = String(data?.orcamentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  if (!orcamentoId) throw new functions.https.HttpsError("invalid-argument", "orcamentoId obrigatório.");
  const atdSnap = await carregarAtendimento(atendimentoId);

  const orcSnap = await db().collection(COL_ERP).doc("orcamentos").get();
  const orcamentos = parseDoc<Array<{ id: string; num?: unknown; total?: unknown }>>(orcSnap, []);
  const orc = orcamentos.find((o) => o.id === orcamentoId);
  if (!orc) {
    throw new functions.https.HttpsError("not-found", "Orçamento não encontrado — não é possível vincular.");
  }

  await atdSnap.ref.set({ orcamentoId, updatedAt: Date.now() }, { merge: true });
  await writeAudit("atendimentos_audit_log", "vincular_orcamento", caller.uid, caller.role, { atendimentoId, orcamentoId });
  return { ok: true, orcamentoId, numero: orc.num ?? null, total: orc.total ?? null };
});

// ── 11. Solicitar humano (handoff) ──────────────────────────────────────────
// Núcleo único reaproveitado pelas DUAS fronteiras de auth que precisam
// disparar o mesmo handoff: o próprio ERP (atendente marca manualmente,
// onCall/Firebase Auth) e a ValerIA (onRequest/Bearer — ver
// atdSolicitarHumanoValeria abaixo). Nunca duplicar esta lógica.
//
// Transacional (get+set atômico) — antes desta rodada era get() e set()
// separados; sob duas chamadas verdadeiramente concorrentes (Teste D da
// Rodada Handoff), ambas liam o estado antigo antes de qualquer write
// terminar e cada uma gravava sua PRÓPRIA mensagem de sistema, duplicando
// o aviso mesmo com o status final correto. A transação serializa as duas
// e garante uma única mensagem de sistema por handoff efetivo.
async function solicitarHumanoCore(
  atendimentoId: string,
  motivo: string,
  actorId: string,
  actorRole: string
): Promise<{ ok: true; jaSolicitado: boolean }> {
  const db_ = db();
  const ref = db_.collection(COL_ATD).doc(atendimentoId);
  const now = Date.now();

  const jaSolicitado = await db_.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Atendimento não encontrado.");
    }
    const atd = snap.data()!;
    if (atd.status === "aguardando_humano" || atd.modoAtendimento === "humano" || atd.status === "resolvido") {
      return true;
    }
    tx.set(ref, { status: "aguardando_humano", updatedAt: now }, { merge: true });
    const sysRef = ref.collection(SUB_MSG).doc();
    tx.set(sysRef, {
      id: sysRef.id, atendimentoId, providerMessageId: null, idempotencyKey: null,
      actorType: "system", actorId, actorName: "Sistema",
      text: motivo ? `Atendimento humano solicitado — ${motivo}` : "Atendimento humano solicitado.",
      attachments: [], deliveryStatus: "sent", provider: "erp", createdAt: now,
    });
    return false;
  });

  await writeAudit("atendimentos_audit_log", "solicitar_humano", actorId, actorRole, { atendimentoId, motivo });
  return { ok: true, jaSolicitado };
}

// Chamável pelo próprio ERP — um atendente pode marcar "precisa de humano"
// manualmente (Master/Comercial, sessão Firebase Auth real).
export const atdSolicitarHumano = functions.https.onCall(async (data, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "solicitar humano em um atendimento");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  const motivo = String(data?.motivo || "").trim().slice(0, 300);
  return solicitarHumanoCore(atendimentoId, motivo, caller.uid, caller.role);
});

// ── 12. Solicitar humano — chamado pela própria ValerIA (Tool HTTP) ────────
// Fecha o elo que ficou documentado como pendente na rodada anterior: a
// ValerIA (Chatvolt) não é um usuário do ERP com sessão Firebase — é um
// serviço externo autenticado só pelo Bearer compartilhado, mesmo padrão
// de auth já usado por todas as Tools HTTP em valeria_vitre.ts
// (checkAuth/erp_vr/valeria_config.secret — nunca write direto client-side
// no Firestore). `conversationId` aqui É o atendimentoId do próprio ERP —
// a ValerIA sempre ecoa o marcador [ID_ATENDIMENTO: x] injetado em cada
// mensagem (ver prompt, seção "IDENTIFICADOR DO ATENDIMENTO"), então o
// mesmo valor que as outras Tools (atualizar_briefing etc.) já recebem
// como conversationId serve para localizar o documento aqui.
// acquireIdem cobre retry de rede da própria ValerIA (mesma chamada
// reenviada); a transação em solicitarHumanoCore cobre concorrência real
// entre chamadas diferentes (Teste D).
export const atdSolicitarHumanoValeria = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (!(await checkAuth(req, res))) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método não permitido" }); return; }

  const body = req.body as { conversationId?: string; organizationId?: string; motivo?: string; requestId?: string };
  const atendimentoId = String(body?.conversationId || "").trim();
  const organizationId = String(body?.organizationId || "").trim();
  const requestId = String(body?.requestId || "").trim();
  if (!atendimentoId || !organizationId) {
    res.status(400).json({ ok: false, error: "conversationId e organizationId são obrigatórios" });
    return;
  }
  if (!requestId) { res.status(400).json({ ok: false, error: "requestId obrigatório" }); return; }

  const idemKey = `atd_solicitar_humano_ai:${atendimentoId}:${requestId}`;
  if (!(await acquireIdem("atendimentos_idem", idemKey))) { res.json({ ok: true, jaSolicitado: true }); return; }

  const motivo = String(body?.motivo || "").trim().slice(0, 300);
  try {
    const resultado = await solicitarHumanoCore(atendimentoId, motivo, "valeria", "valeria_agent");
    res.json(resultado);
  } catch (e) {
    const httpErr = e as { code?: string; message?: string };
    if (httpErr.code === "not-found") {
      res.status(404).json({ ok: false, error: "Atendimento não encontrado." });
      return;
    }
    res.status(500).json({ ok: false, error: httpErr.message || "Erro interno." });
  }
});
