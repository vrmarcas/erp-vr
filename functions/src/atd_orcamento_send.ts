/**
 * atd_orcamento_send.ts — ValerIA 2.0 / ERP, Fase E.2.48B (2026-09-23).
 *
 * Envio do orçamento OFICIAL do ERP (modelo comercial completo,
 * `erp_vr/orcamentos`, vinculado ao atendimento via `atendimentos.orcamentoId`
 * — mesmo mecanismo já usado por `atdVincularOrcamento`) pela conversa de
 * Atendimentos, via WhatsApp/ChatVolt. Função dedicada, nunca reaproveita
 * `atdEnviarMensagemHumano` diretamente (aquele usa o endpoint ANTIGO do
 * ChatVolt, sem suporte a anexo — mesma nota já deixada em
 * vitre_quote_send.ts), mas reusa a infraestrutura genérica já homologada
 * (Fase E.2.43-47, extraída para `chatvolt_attachment_send.ts` na Fase
 * E.2.48B): upload+signed URL, envio com attachment, auth/idempotência/
 * auditoria (auth_helper.ts).
 *
 * NUNCA usa `vitre_orcamentos`/`vitre_audit_log`/`vitre_idem_keys` — este é
 * o fluxo do orçamento comercial oficial (VR-personalizado), um domínio
 * deliberadamente separado do catálogo Vitre (ver Fase E.2.48, Decisão 1).
 *
 * ORDEM SEGURA (mesmo padrão de vitre_quote_send.ts):
 *   1. idempotência;
 *   2. validar atendimento;
 *   3. validar vínculo atendimento↔orçamento (EXPLÍCITO, nunca busca
 *      ambígua por nome/telefone — só atendimentos.orcamentoId);
 *   4. validar orçamento tem dados suficientes para o PDF oficial;
 *   5. decodificar/validar PDF recebido (MIME/tamanho já garantidos pelo
 *      caller ao gerar via generateErpQuotePdf — aqui só valida bytes);
 *   6. upload Storage (path determinístico, sobrescreve — nunca acumula versão);
 *   7. Signed URL;
 *   8. enviar ChatVolt;
 *   9. só com success+message.id real, persistir mensagem+attachment;
 *   10. auditoria — SÓ DEPOIS de tudo confirmado.
 * Qualquer falha em qualquer etapa: nada é persistido como enviado, erro
 * estruturado devolvido. Se o upload aconteceu mas o ChatVolt falhou, o
 * arquivo permanece no Storage (útil para diagnóstico), mas nenhuma
 * mensagem/attachment/auditoria de sucesso é gravada — nunca tratado como
 * envio concluído.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { getCallerVerificado, requireRole, acquireIdem, writeAudit } from "./auth_helper";
import { uploadFileAndSign, sendChatvoltMessageWithAttachment } from "./chatvolt_attachment_send";

const COL_ATD = "atendimentos";
const SUB_MSG = "mensagens";
const COL_IDEM = "atendimentos_idem";
const COL_AUDIT = "atendimentos_audit_log";
const COL_ERP = "erp_vr";
const STORAGE_PREFIX = "atendimentos_orcamentos";
const MAX_PDF_BYTES = 8 * 1024 * 1024; // mesmo limite já homologado em vitre_quote_send.ts

async function nomeStaff(uid: string): Promise<string> {
  try {
    const doc = await admin.firestore().collection("erp_vr_usuarios").doc(uid).get();
    const nome = doc.exists ? (doc.data()?.nome as string | undefined) : undefined;
    return nome || uid;
  } catch {
    return uid;
  }
}

interface OrcamentoOficial {
  id: string;
  num?: unknown;
  cliente?: unknown;
  valorFinal?: unknown;
  itens?: unknown;
}

/** Lê erp_vr/orcamentos (modelo legado, array agregado) — mesma leitura já usada por atdVincularOrcamento. */
async function carregarOrcamentoOficial(orcamentoId: string): Promise<OrcamentoOficial | null> {
  const snap = await admin.firestore().collection(COL_ERP).doc("orcamentos").get();
  if (!snap.exists) return null;
  const raw = snap.data()?.data;
  if (typeof raw !== "string") return null;
  let lista: OrcamentoOficial[] = [];
  try {
    lista = JSON.parse(raw) as OrcamentoOficial[];
  } catch {
    return null;
  }
  return lista.find((o) => o.id === orcamentoId) ?? null;
}

interface SendOrcOficialInput {
  atendimentoId: string;
  orcamentoId: string;
  pdfBase64: string;
  fileName: string;
  message: string;
  requestId: string;
}

interface SendOrcOficialResult {
  sent: boolean;
  providerMessageId: string | null;
  attachmentSent: boolean;
  errorCode: string | null;
  jaProcessado?: boolean;
}

function fail(errorCode: string): SendOrcOficialResult {
  return { sent: false, providerMessageId: null, attachmentSent: false, errorCode };
}

/**
 * atdEnviarOrcamentoOficial — envio real do orçamento comercial oficial
 * (texto + PDF) pela conversationId do atendimento.
 */
export const atdEnviarOrcamentoOficial = functions
  .runWith({ secrets: ["CHATVOLT_API_KEY"], timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (data: Partial<SendOrcOficialInput>, context): Promise<SendOrcOficialResult> => {
    const caller = await getCallerVerificado(context);
    requireRole(caller, ["comercial"], "enviar orçamento oficial pelo WhatsApp em Atendimentos");

    const atendimentoId = String(data?.atendimentoId || "").trim();
    const orcamentoId = String(data?.orcamentoId || "").trim();
    const message = String(data?.message || "").trim();
    const pdfBase64 = String(data?.pdfBase64 || "");
    const fileName = String(data?.fileName || "orcamento.pdf").trim() || "orcamento.pdf";
    const requestId = String(data?.requestId || "").trim();

    if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
    if (!orcamentoId) throw new functions.https.HttpsError("invalid-argument", "orcamentoId obrigatório.");
    if (!message) throw new functions.https.HttpsError("invalid-argument", "message obrigatório.");
    if (!pdfBase64) throw new functions.https.HttpsError("invalid-argument", "pdfBase64 obrigatório.");
    if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

    // 1. Idempotência (item 12 do pedido) — double-click/retry com o MESMO
    // requestId nunca reenvia.
    const idemKey = `atd_orc_envio:${atendimentoId}:${orcamentoId}:${requestId}`;
    const acquired = await acquireIdem(COL_IDEM, idemKey);
    if (!acquired) return { sent: true, providerMessageId: null, attachmentSent: true, errorCode: null, jaProcessado: true };

    const db = admin.firestore();

    // 2. validar atendimento.
    const atdRef = db.collection(COL_ATD).doc(atendimentoId);
    const atdSnap = await atdRef.get();
    if (!atdSnap.exists) return fail("ATENDIMENTO_NAO_ENCONTRADO");
    const atd = atdSnap.data()!;

    // 3. validar vínculo EXPLÍCITO atendimento↔orçamento — nunca busca
    // ambígua por nome/telefone (item 3 do pedido).
    if (!atd.orcamentoId || atd.orcamentoId !== orcamentoId) {
      return fail("ORCAMENTO_NAO_VINCULADO");
    }

    // 4. validar orçamento oficial existe e tem dados suficientes para o PDF.
    const orc = await carregarOrcamentoOficial(orcamentoId);
    if (!orc) return fail("ORCAMENTO_NAO_ENCONTRADO");
    const itens = Array.isArray(orc.itens) ? orc.itens : [];
    if (itens.length === 0 || !(typeof orc.valorFinal === "number" && orc.valorFinal > 0)) {
      return fail("ORCAMENTO_INCOMPLETO");
    }

    // 5. decodificar/validar PDF recebido.
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, "base64");
    } catch {
      return fail("PDF_BASE64_INVALIDO");
    }
    if (pdfBuffer.length === 0) return fail("PDF_VAZIO");
    if (pdfBuffer.length > MAX_PDF_BYTES) return fail("PDF_MUITO_GRANDE");

    // 6/7. upload + signed URL — path determinístico por atendimento+orçamento.
    const storagePath = `${STORAGE_PREFIX}/${atendimentoId}/${orcamentoId}.pdf`;
    let pdfUrl: string;
    try {
      pdfUrl = await uploadFileAndSign(storagePath, pdfBuffer, "application/pdf", fileName);
    } catch (e) {
      console.error("[atd_orcamento_send] falha no upload/assinatura do PDF:", (e as Error).message);
      return fail("PDF_UPLOAD_FAILED");
    }

    // 8. enviar ChatVolt — só segue com sucesso REAL confirmado.
    const conversationId = (atd.providerConversationId as string | undefined) || atendimentoId;
    const sendResult = await sendChatvoltMessageWithAttachment(conversationId, message, {
      url: pdfUrl,
      name: fileName,
      mimeType: "application/pdf",
      size: pdfBuffer.length,
    });
    if (!sendResult.ok || !sendResult.providerMessageId) {
      console.error("[atd_orcamento_send] falha no envio ChatVolt:", sendResult.error);
      // Item 13 do pedido — upload já aconteceu (fica no Storage para
      // diagnóstico), mas NADA é persistido como enviado: nem mensagem,
      // nem attachment, nem auditoria.
      return fail("CHATVOLT_SEND_FAILED");
    }

    // 9. só agora, com tudo confirmado, persiste mensagem + attachment.
    const nome = await nomeStaff(caller.uid);
    const now = Date.now();
    const msgRef = atdRef.collection(SUB_MSG).doc(sendResult.providerMessageId);
    await msgRef.set({
      id: msgRef.id,
      atendimentoId,
      providerMessageId: sendResult.providerMessageId,
      idempotencyKey: requestId,
      actorType: "human",
      actorId: caller.uid,
      actorName: nome,
      text: message,
      attachments: [
        {
          name: fileName,
          mimeType: "application/pdf",
          size: pdfBuffer.length,
          storagePath,
          orcamentoId,
          providerMessageId: sendResult.providerMessageId,
        },
      ],
      deliveryStatus: "sent",
      provider: "chatvolt",
      createdAt: now,
    });
    await atdRef.set({ ultimaMensagem: message, ultimaInteracaoEm: now, updatedAt: now }, { merge: true });

    // 10. auditoria genérica (item 11 do pedido) — nunca vitre_audit_log.
    await writeAudit(COL_AUDIT, "enviar_orcamento_whatsapp", caller.uid, caller.role, {
      atendimentoId,
      orcamentoId,
      conversationId,
      providerMessageId: sendResult.providerMessageId,
      attachmentSent: true,
      fileName,
      size: pdfBuffer.length,
      enviadoPor: nome,
      sentAt: now,
    });

    return { sent: true, providerMessageId: sendResult.providerMessageId, attachmentSent: true, errorCode: null };
  });

/**
 * atdObterUrlAnexo — URL temporária de um attachment já persistido numa
 * mensagem, gerada SOB DEMANDA (nunca uma signed URL persistida — item 10
 * do pedido). O client manda o identificador da mensagem, nunca um path
 * livre — o storagePath nunca é aceito vindo do client, só resolvido aqui
 * a partir do documento já persistido no Firestore.
 */
export const atdObterUrlAnexo = functions.https.onCall(async (data: { atendimentoId?: string; messageId?: string }, context) => {
  const caller = await getCallerVerificado(context);
  requireRole(caller, ["comercial"], "abrir anexo de uma conversa em Atendimentos");

  const atendimentoId = String(data?.atendimentoId || "").trim();
  const messageId = String(data?.messageId || "").trim();
  if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
  if (!messageId) throw new functions.https.HttpsError("invalid-argument", "messageId obrigatório.");

  const db = admin.firestore();
  const atdSnap = await db.collection(COL_ATD).doc(atendimentoId).get();
  if (!atdSnap.exists) throw new functions.https.HttpsError("not-found", "Atendimento não encontrado.");

  const msgSnap = await db.collection(COL_ATD).doc(atendimentoId).collection(SUB_MSG).doc(messageId).get();
  if (!msgSnap.exists) throw new functions.https.HttpsError("not-found", "Mensagem não encontrada.");
  const msg = msgSnap.data()!;
  const attachments = (msg.attachments as Array<{ storagePath?: string; name?: string; mimeType?: string }>) || [];
  const attachment = attachments[0];
  if (!attachment || !attachment.storagePath) {
    throw new functions.https.HttpsError("not-found", "Esta mensagem não tem anexo.");
  }

  const bucket = admin.storage().bucket();
  const file = bucket.file(attachment.storagePath);
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 10 * 60 * 1000 }); // 10min — só o necessário para o clique abrir
  return { url, name: attachment.name || "documento.pdf", mimeType: attachment.mimeType || "application/pdf" };
});
