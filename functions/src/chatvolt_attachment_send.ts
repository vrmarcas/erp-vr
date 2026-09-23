/**
 * chatvolt_attachment_send.ts — ValerIA 2.0 / ERP, Fase E.2.48B (2026-09-23).
 *
 * Módulo compartilhado, extraído de `vitre_quote_send.ts` (Fase E.2.43,
 * já homologado em produção — envio real de orçamento Vitre por
 * WhatsApp), para reuso pelo novo fluxo de envio do orçamento OFICIAL do
 * ERP (`atd_orcamento_send.ts`, Fase E.2.48B). Extração pura — nenhuma
 * linha de lógica mudou, só o local onde vive. `vitre_quote_send.ts`
 * passou a importar daqui em vez de definir localmente; o comportamento
 * homologado de `sendVitreQuoteToConversation` permanece idêntico (ver
 * regressão completa de `scripts/test_e243_vitre_quote_send_static_safety.js`).
 *
 * Reúne as duas peças de infraestrutura genéricas (sem nenhum
 * conhecimento de "orçamento", "Vitre" ou "Atendimentos"):
 *   - uploadFileAndSign: upload para Storage (Admin SDK, nunca client SDK,
 *     nunca bucket público) + Signed URL V4 de curta duração;
 *   - sendChatvoltMessageWithAttachment: único ponto que chama o endpoint
 *     NOVO do ChatVolt (com suporte a attachments) — nunca o endpoint
 *     antigo usado por atdEnviarMensagemHumano.
 */
import * as admin from "firebase-admin";
import axios from "axios";

export const CHATVOLT_SEND_ENDPOINT = "https://api.chatvolt.ai/conversation/message/conversationId/";
export const SIGNED_URL_TTL_MS = 24 * 60 * 60 * 1000; // 24h — cobre a janela de entrega/retry do WhatsApp, nunca "para sempre".

/**
 * Upload de um arquivo (Admin SDK — nunca client SDK, nunca bucket
 * público) + Signed URL V4 de curta duração. `storagePath` é
 * DETERMINÍSTICO por chamador (path completo, já resolvido pelo
 * chamador) — um reenvio/retry do MESMO recurso sobrescreve o mesmo
 * objeto, nunca acumula cópias, salvo decisão explícita do chamador.
 */
export async function uploadFileAndSign(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
  fileName: string
): Promise<string> {
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    contentType,
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
 * `size` — achado real do primeiro envio ao vivo (Fase E.2.45.2): a
 * documentação pública (docs.chatvolt.ai) só lista url/name/mimeType, mas
 * a validação REAL do endpoint exige também `size` (bytes), confirmado
 * pelo erro `attachments[0].size: Required` (HTTP 400) na E.2.45.1.
 * Sempre o tamanho REAL do mesmo buffer que foi salvo no Storage — nunca
 * estimado.
 */
export async function sendChatvoltMessageWithAttachment(
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
