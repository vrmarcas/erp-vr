/**
 * vitre_quote_send.ts — ValerIA 2.0 / ERP, Fase E.2.43 (2026-09-22).
 *
 * Primeiro envio REAL de orçamento (texto + PDF) pelo próprio ERP, pela
 * MESMA conversationId do atendimento — sem abrir WhatsApp Web. Função
 * dedicada (nunca reaproveita atdEnviarMensagemHumano diretamente — aquele
 * é acoplado a atendimentoId/subcoleção `mensagens` e usa o endpoint ANTIGO
 * sem suporte a anexo, `app.chatvolt.ai/api/conversations/{id}/message`),
 * mas reusa o que já é comum: autenticação (getCallerVerificado/
 * requireRole, auth_helper.ts), idempotência (acquireIdem, mesmo padrão de
 * vitre.ts), auditoria (writeAudit).
 *
 * Endpoint ChatVolt usado AQUI é o NOVO/documentado oficialmente (Fase
 * E.2.41, pesquisa em docs.chatvolt.ai), o único que aceita attachments:
 *   POST https://api.chatvolt.ai/conversation/message/conversationId/{id}
 *   body: { message, channel, attachments: [{ url, name, mimeType, size }] }
 * `size` (Fase E.2.45.2) — NÃO está na documentação pública (só url/name/
 * mimeType lá), mas a validação REAL do endpoint exige, confirmado pelo
 * HTTP 400 real do primeiro envio ao vivo (E.2.45.1):
 * `attachments[0].size: Required`. Sempre o tamanho real do buffer salvo
 * no Storage (pdfBuffer.length) — nunca estimado.
 *
 * Storage (Fase E.2.43, item 5 do pedido — opção A escolhida: browser gera
 * o PDF/blob, o BACKEND (aqui) recebe os bytes já prontos (base64) e faz o
 * upload via Admin SDK. Nunca existe regra de Storage para client SDK
 * escrever/ler — todo o acesso ao bucket passa por este Cloud Function
 * autenticado, nunca há bucket "aberto"/gravável pelo navegador. Leitura
 * pelo ChatVolt usa uma Signed URL V4 de curta duração (nunca
 * `makePublic()`/URL pública indexável) — o arquivo em si nunca fica
 * público, só o link assinado, que expira.
 *
 * ORDEM SEGURA (item 8 do pedido) — replicada linha por linha:
 *   1. validar quote (existe, status==='rascunho', conversationId bate);
 *   2. validar conversationId (atendimento existe);
 *   3. decodificar/validar PDF recebido;
 *   4. upload Storage (path determinístico, sobrescreve — nunca acumula versão);
 *   5. Signed URL;
 *   6. enviar ChatVolt;
 *   7. só com success+message.id real, seguir;
 *   8. persistir auditoria;
 *   9. só então status → "enviado".
 * Qualquer falha em qualquer etapa: quote permanece "rascunho", erro
 * estruturado devolvido, NADA marcado como enviado.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import axios from "axios";
import { getCallerVerificado, requireRole, acquireIdem as acquireIdemShared, writeAudit as writeAuditShared } from "./auth_helper";

const COL_ORC = "vitre_orcamentos";
const COL_ATD = "atendimentos";
const COL_IDEM = "vitre_idem_keys";
const COL_AUDIT = "vitre_audit_log";
const STORAGE_PREFIX = "orcamentos_pdf";
const CHATVOLT_SEND_ENDPOINT = "https://api.chatvolt.ai/conversation/message/conversationId/";
const SIGNED_URL_TTL_MS = 24 * 60 * 60 * 1000; // 24h — cobre a janela de entrega/retry do WhatsApp, nunca "para sempre".
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8MB — folga generosa sobre um orçamento de 1-2 páginas, nunca aceita blob absurdo.

function acquireIdem(key: string) {
  return acquireIdemShared(COL_IDEM, key);
}
function writeAudit(action: string, uid: string, role: string, detail: Record<string, unknown>) {
  return writeAuditShared(COL_AUDIT, action, uid, role, detail);
}

async function nomeStaff(uid: string): Promise<string> {
  try {
    const doc = await admin.firestore().collection("erp_vr_usuarios").doc(uid).get();
    const nome = doc.exists ? (doc.data()?.nome as string | undefined) : undefined;
    return nome || uid;
  } catch {
    return uid;
  }
}

interface SendVitreQuoteInput {
  conversationId: string;
  quoteId: string;
  message: string;
  pdfBase64: string;
  fileName: string;
  requestId: string;
}

interface SendVitreQuoteResult {
  sent: boolean;
  providerMessageId: string | null;
  attachmentSent: boolean;
  errorCode: string | null;
  jaProcessado?: boolean;
}

function fail(errorCode: string): SendVitreQuoteResult {
  return { sent: false, providerMessageId: null, attachmentSent: false, errorCode };
}

/**
 * Upload do PDF (Admin SDK — nunca client SDK, nunca bucket público) +
 * Signed URL V4 de curta duração. Path DETERMINÍSTICO por quoteId — um
 * reenvio (retry humano, nova versão do mesmo orçamento) sobrescreve o
 * mesmo objeto, nunca acumula cópias.
 */
async function uploadQuotePdfAndSign(quoteId: string, pdfBuffer: Buffer, fileName: string): Promise<string> {
  const bucket = admin.storage().bucket();
  const filePath = `${STORAGE_PREFIX}/${quoteId}.pdf`;
  const file = bucket.file(filePath);
  await file.save(pdfBuffer, {
    contentType: "application/pdf",
    metadata: { contentDisposition: `inline; filename="${fileName}"` },
    resumable: false,
  });
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + SIGNED_URL_TTL_MS });
  return url;
}

/**
 * Único ponto que chama o endpoint NOVO do ChatVolt (com suporte a
 * attachments) — nunca o endpoint antigo usado por atdEnviarMensagemHumano.
 * Payload: message, channel, attachments:[{url,name,mimeType,size}].
 * `size` (Fase E.2.45.2) — achado real do primeiro envio ao vivo: a
 * documentação pública (docs.chatvolt.ai) só lista url/name/mimeType, mas a
 * validação REAL do endpoint exige também `size` (bytes), confirmado pelo
 * erro `attachments[0].size: Required` (HTTP 400) na E.2.45.1. Sempre o
 * tamanho REAL do mesmo buffer que foi salvo no Storage — nunca estimado.
 */
async function sendChatvoltMessageWithAttachment(
  conversationId: string,
  message: string,
  attachment: { url: string; name: string; mimeType: string; size: number } | null
): Promise<{ ok: boolean; providerMessageId: string | null; error?: string }> {
  const apiKey = process.env.CHATVOLT_API_KEY;
  if (!apiKey) return { ok: false, providerMessageId: null, error: "CHATVOLT_API_KEY ausente" };
  try {
    const body: Record<string, unknown> = { message, channel: "whatsapp" };
    if (attachment) body.attachments = [attachment];
    const res = await axios.post(`${CHATVOLT_SEND_ENDPOINT}${conversationId}`, body, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: 20_000,
    });
    const providerMessageId = (res.data?.message?.id as string | undefined) ?? null;
    const ok = res.status === 200 && res.data?.success === true && !!providerMessageId;
    return { ok, providerMessageId, error: ok ? undefined : `resposta inesperada: ${JSON.stringify(res.data).slice(0, 300)}` };
  } catch (e) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    return { ok: false, providerMessageId: null, error: `HTTP ${err.response?.status ?? "?"}: ${JSON.stringify(err.response?.data ?? err.message).slice(0, 300)}` };
  }
}

/**
 * sendVitreQuoteToConversation — envio real do orçamento (texto + PDF)
 * pela conversationId do próprio atendimento. Só marca `status:"enviado"`
 * DEPOIS de ChatVolt confirmar (success+message.id real) — nunca antes.
 */
export const sendVitreQuoteToConversation = functions
  .runWith({ secrets: ["CHATVOLT_API_KEY"], timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (data: Partial<SendVitreQuoteInput>, context): Promise<SendVitreQuoteResult> => {
    const caller = await getCallerVerificado(context);
    requireRole(caller, ["comercial"], "enviar orçamento Vitre pelo WhatsApp");

    const conversationId = String(data?.conversationId || "").trim();
    const quoteId = String(data?.quoteId || "").trim();
    const message = String(data?.message || "").trim();
    const pdfBase64 = String(data?.pdfBase64 || "");
    const fileName = String(data?.fileName || "orcamento.pdf").trim() || "orcamento.pdf";
    const requestId = String(data?.requestId || "").trim();

    if (!conversationId) throw new functions.https.HttpsError("invalid-argument", "conversationId obrigatório.");
    if (!quoteId) throw new functions.https.HttpsError("invalid-argument", "quoteId obrigatório.");
    if (!message) throw new functions.https.HttpsError("invalid-argument", "message obrigatório.");
    if (!pdfBase64) throw new functions.https.HttpsError("invalid-argument", "pdfBase64 obrigatório.");
    if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

    // Idempotência (item 9) — double click/retry/refresh com o MESMO
    // requestId nunca reenvia; uma segunda tentativa lógica (novo clique
    // humano após falha) usa um requestId NOVO de propósito.
    const idemKey = `vitre_quote_send:${quoteId}:${requestId}`;
    const acquired = await acquireIdem(idemKey);
    if (!acquired) return { sent: true, providerMessageId: null, attachmentSent: true, errorCode: null, jaProcessado: true };

    const db = admin.firestore();

    // 1. validar quote.
    const quoteRef = db.collection(COL_ORC).doc(quoteId);
    const quoteSnap = await quoteRef.get();
    if (!quoteSnap.exists) return fail("QUOTE_NOT_FOUND");
    const quote = quoteSnap.data()!;
    if (quote.conversationId !== conversationId) return fail("CONVERSATION_MISMATCH");
    if (quote.status === "enviado") {
      // Já enviado por uma chamada anterior (ex.: requestId diferente do
      // mesmo clique duplicado) — nunca reenvia, só reporta o que já
      // aconteceu, sem erro.
      return {
        sent: true,
        providerMessageId: (quote.enviadoProviderMessageId as string | undefined) ?? null,
        attachmentSent: true,
        errorCode: null,
        jaProcessado: true,
      };
    }
    if (quote.status !== "rascunho") return fail(`QUOTE_ESTADO_INVALIDO:${quote.status}`);

    // 2. validar conversationId (atendimento existe).
    const atdSnap = await db.collection(COL_ATD).doc(conversationId).get();
    if (!atdSnap.exists) return fail("ATENDIMENTO_NAO_ENCONTRADO");

    // 3. decodificar/validar PDF recebido.
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, "base64");
    } catch {
      return fail("PDF_BASE64_INVALIDO");
    }
    if (pdfBuffer.length === 0) return fail("PDF_VAZIO");
    if (pdfBuffer.length > MAX_PDF_BYTES) return fail("PDF_MUITO_GRANDE");

    // 4/5. upload + signed URL.
    let pdfUrl: string;
    try {
      pdfUrl = await uploadQuotePdfAndSign(quoteId, pdfBuffer, fileName);
    } catch (e) {
      console.error("[vitre_quote_send] falha no upload/assinatura do PDF:", (e as Error).message);
      return fail("PDF_UPLOAD_FAILED");
    }

    // 6/7. enviar ChatVolt, só segue com sucesso REAL confirmado.
    const sendResult = await sendChatvoltMessageWithAttachment(conversationId, message, {
      url: pdfUrl,
      name: fileName,
      mimeType: "application/pdf",
      size: pdfBuffer.length,
    });
    if (!sendResult.ok || !sendResult.providerMessageId) {
      console.error("[vitre_quote_send] falha no envio ChatVolt:", sendResult.error);
      return fail("CHATVOLT_SEND_FAILED");
    }

    // 8. auditoria — nunca os bytes do PDF, só metadados (item 10 do pedido).
    const now = Date.now();
    const nome = await nomeStaff(caller.uid);
    await writeAudit("enviar_orcamento_vitre_whatsapp", caller.uid, caller.role, {
      quoteId,
      conversationId,
      providerMessageId: sendResult.providerMessageId,
      enviadoPor: nome,
      sentAt: now,
      channel: "whatsapp",
      attachmentSent: true,
      fileName,
      texto: message,
    });

    // 9. só agora, com tudo confirmado, marca enviado.
    await quoteRef.set(
      {
        status: "enviado",
        enviadoEm: now,
        enviadoPorUid: caller.uid,
        enviadoCanal: "whatsapp",
        enviadoProviderMessageId: sendResult.providerMessageId,
      },
      { merge: true }
    );

    return { sent: true, providerMessageId: sendResult.providerMessageId, attachmentSent: true, errorCode: null };
  });
