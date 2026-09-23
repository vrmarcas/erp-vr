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

// ============================================================
// Fase E.2.48C (2026-09-23) — upload manual de arquivo no composer
// ============================================================
// Reusa a MESMA infraestrutura de atdEnviarOrcamentoOficial (upload+signed
// URL, envio com attachment, idempotência, auditoria genérica) — nunca
// duplica. Diferença: não depende de nenhum orçamento vinculado, aceita
// qualquer arquivo dentro dos tipos permitidos (item 1 do pedido), texto
// da mensagem é sempre opcional (o arquivo sozinho já é um envio válido —
// item 13).
const STORAGE_PREFIX_ANEXO = "atendimentos_anexos";
const MAX_ANEXO_BYTES = 8 * 1024 * 1024; // mesmo limite já usado para o orçamento oficial/Vitre.

// MIME permitido → extensões válidas correspondentes (item 1/8 do pedido).
// Nunca aceita um MIME fora desta lista; nunca aceita extensão que não
// bate com o MIME declarado (ex.: .exe disfarçado de application/pdf nunca
// passa, porque ".exe" não está em nenhuma lista de extensões válidas).
const ANEXO_MIME_EXTENSOES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

/**
 * Sanitiza fileName (item 8 do pedido): remove qualquer componente de
 * diretório (nunca confia em barra/contrabarra vinda do client — só o
 * nome do arquivo em si é usado), bloqueia path traversal (`..`), nomes
 * vazios, e exige que a extensão bata com o MIME declarado. Caracteres
 * fora de um allowlist seguro (letras/números/espaço/._-) são substituídos
 * por `_`. Retorna `null` quando o arquivo deve ser rejeitado.
 */
function sanitizeAnexoFileName(fileNameCru: string, mimeType: string): string | null {
  const extensoesValidas = ANEXO_MIME_EXTENSOES[mimeType];
  if (!extensoesValidas) return null;
  const cru = String(fileNameCru || "");
  // Item 8 do pedido — bloqueia path traversal EXPLICITAMENTE no valor
  // original recebido (rejeita, nunca só normaliza/reescreve em silêncio),
  // antes mesmo de extrair o último componente de path.
  if (cru.includes("..")) return null;
  // Só o último componente de path — nunca aceita diretórios vindos do client.
  const base = cru.split(/[/\\]/).pop() || "";
  const trimmed = base.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\.([a-zA-Z0-9]+)$/);
  const ext = m ? m[1].toLowerCase() : "";
  if (!ext || !extensoesValidas.includes(ext)) return null;
  const namePart = trimmed.slice(0, trimmed.length - ext.length - 1);
  const safeNamePart = namePart.replace(/[^a-zA-Z0-9_\-. ]/g, "_").trim().slice(0, 120);
  if (!safeNamePart) return null;
  return `${safeNamePart}.${ext}`;
}

interface SendAnexoManualInput {
  atendimentoId: string;
  fileBase64: string;
  fileName: string;
  mimeType: string;
  message: string;
  requestId: string;
}

interface SendAnexoManualResult {
  sent: boolean;
  providerMessageId: string | null;
  attachmentSent: boolean;
  errorCode: string | null;
  jaProcessado?: boolean;
}

function failAnexo(errorCode: string): SendAnexoManualResult {
  return { sent: false, providerMessageId: null, attachmentSent: false, errorCode };
}

/**
 * atdEnviarAnexoManual — envio real de um arquivo enviado manualmente pelo
 * vendedor (PDF/JPG/JPEG/PNG) pela conversa de Atendimentos. Mesma ordem
 * segura já homologada: idempotência → validar atendimento → validar
 * MIME/filename → decodificar/validar tamanho → upload+signed URL →
 * ChatVolt → só com sucesso real persiste mensagem+attachment+auditoria.
 */
export const atdEnviarAnexoManual = functions
  .runWith({ secrets: ["CHATVOLT_API_KEY"], timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (data: Partial<SendAnexoManualInput>, context): Promise<SendAnexoManualResult> => {
    const caller = await getCallerVerificado(context);
    requireRole(caller, ["comercial"], "enviar anexo manual pelo WhatsApp em Atendimentos");

    const atendimentoId = String(data?.atendimentoId || "").trim();
    const mimeType = String(data?.mimeType || "").trim();
    const fileNameCru = String(data?.fileName || "").trim();
    // Item 13 — mensagem é sempre OPCIONAL aqui: esta function só existe
    // para envio de arquivo, então "somente arquivo, sem texto" é o caso
    // normal, nunca bloqueado. "nem texto nem arquivo" é impossível de
    // acontecer por este caminho, porque fileBase64 é obrigatório abaixo.
    const message = String(data?.message || "").trim();
    const fileBase64 = String(data?.fileBase64 || "");
    const requestId = String(data?.requestId || "").trim();

    if (!atendimentoId) throw new functions.https.HttpsError("invalid-argument", "atendimentoId obrigatório.");
    if (!mimeType) throw new functions.https.HttpsError("invalid-argument", "mimeType obrigatório.");
    if (!fileNameCru) throw new functions.https.HttpsError("invalid-argument", "fileName obrigatório.");
    if (!fileBase64) throw new functions.https.HttpsError("invalid-argument", "fileBase64 obrigatório.");
    if (!requestId) throw new functions.https.HttpsError("invalid-argument", "requestId obrigatório.");

    if (!ANEXO_MIME_EXTENSOES[mimeType]) return failAnexo("MIME_NAO_PERMITIDO");
    const fileName = sanitizeAnexoFileName(fileNameCru, mimeType);
    if (!fileName) return failAnexo("FILENAME_INVALIDO");

    // 1. Idempotência (item 14 do pedido) — chave distinta das outras duas
    // functions de envio (nunca vitre_quote_send/atd_orcamento_send colidem).
    const idemKey = `atd_anexo_manual:${atendimentoId}:${requestId}`;
    const acquired = await acquireIdem(COL_IDEM, idemKey);
    if (!acquired) return { sent: true, providerMessageId: null, attachmentSent: true, errorCode: null, jaProcessado: true };

    const db = admin.firestore();

    // 2. validar atendimento (item 5 do pedido — inclui "validar conversationId",
    // que aqui é sempre derivado do atendimento, nunca aceito do client).
    const atdRef = db.collection(COL_ATD).doc(atendimentoId);
    const atdSnap = await atdRef.get();
    if (!atdSnap.exists) return failAnexo("ATENDIMENTO_NAO_ENCONTRADO");
    const atd = atdSnap.data()!;

    // 3. decodificar/validar tamanho.
    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(fileBase64, "base64");
    } catch {
      return failAnexo("ARQUIVO_BASE64_INVALIDO");
    }
    if (fileBuffer.length === 0) return failAnexo("ARQUIVO_VAZIO");
    if (fileBuffer.length > MAX_ANEXO_BYTES) return failAnexo("ARQUIVO_MUITO_GRANDE");

    // 4/5. upload + signed URL — path específico por tentativa (item 7 do
    // pedido): nunca sobrescreve um anexo manual anterior, cada envio tem
    // seu próprio diretório (timestamp+requestId), diferente do path
    // determinístico do orçamento oficial (que sobrescreve de propósito).
    const storagePath = `${STORAGE_PREFIX_ANEXO}/${atendimentoId}/${Date.now()}_${requestId}/${fileName}`;
    let fileUrl: string;
    try {
      fileUrl = await uploadFileAndSign(storagePath, fileBuffer, mimeType, fileName);
    } catch (e) {
      console.error("[atd_orcamento_send] falha no upload/assinatura do anexo manual:", (e as Error).message);
      return failAnexo("UPLOAD_FAILED");
    }

    // 6. enviar ChatVolt — só segue com sucesso REAL confirmado.
    const conversationId = (atd.providerConversationId as string | undefined) || atendimentoId;
    const sendResult = await sendChatvoltMessageWithAttachment(conversationId, message, {
      url: fileUrl,
      name: fileName,
      mimeType,
      size: fileBuffer.length,
    });
    if (!sendResult.ok || !sendResult.providerMessageId) {
      console.error("[atd_orcamento_send] falha no envio ChatVolt (anexo manual):", sendResult.error);
      // Item 10 do pedido — upload já aconteceu (fica no Storage para
      // diagnóstico), mas NADA é persistido como enviado.
      return failAnexo("CHATVOLT_SEND_FAILED");
    }

    // 7. só agora, com tudo confirmado, persiste mensagem + attachment.
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
          mimeType,
          size: fileBuffer.length,
          storagePath,
          providerMessageId: sendResult.providerMessageId,
        },
      ],
      deliveryStatus: "sent",
      provider: "chatvolt",
      createdAt: now,
    });
    await atdRef.set({ ultimaMensagem: message || ("📎 " + fileName), ultimaInteracaoEm: now, updatedAt: now }, { merge: true });

    // 8. auditoria genérica (item 12 do pedido) — nunca vitre_audit_log.
    await writeAudit(COL_AUDIT, "enviar_anexo_whatsapp", caller.uid, caller.role, {
      atendimentoId,
      conversationId,
      providerMessageId: sendResult.providerMessageId,
      fileName,
      mimeType,
      size: fileBuffer.length,
      attachmentSent: true,
      enviadoPor: nome,
      sentAt: now,
    });

    return { sent: true, providerMessageId: sendResult.providerMessageId, attachmentSent: true, errorCode: null };
  });
