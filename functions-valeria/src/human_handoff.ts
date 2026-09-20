/**
 * human_handoff.ts — ValerIA 2.0, Fase C.1 (endurecimento operacional, 2026-09-19).
 *
 * QUOTE_REVIEW precisa acionar `requiresHuman`/`valeria_handoffs` no
 * atendimento — mecanismo que vive em `functions/src/atendimentos.ts`
 * (`solicitarHumanoCore`), codebase separado de `functions-valeria`.
 * Ao contrário de `vitre_draft_writer.ts` (onde replicar a escrita foi a
 * opção mais segura), aqui a decisão foi a OPOSTA: `solicitarHumanoCore`
 * tem efeitos colaterais que não é seguro adivinhar/reimplementar (ex.:
 * notificações, auditoria, possíveis side-effects futuros) — replicar a
 * escrita arriscaria divergir silenciosamente do comportamento real do
 * handoff humano em produção. Por isso esta é a opção 3 do plano
 * aprovado: chamar o endpoint HTTP JÁ EXISTENTE e JÁ AUTENTICADO
 * `atdSolicitarHumanoValeria` (`functions/src/atendimentos.ts:1317`) —
 * criado especificamente para a ValerIA pedir handoff, já idempotente
 * (`requestId`), já com o mesmo padrão de auth Bearer compartilhado
 * (`erp_vr/valeria_config.secret`, lido aqui do MESMO Firestore, nunca
 * hardcoded). Server-to-server: o LLM não decide nem participa desta
 * chamada — ela acontece dentro da MESMA invocação de
 * valeriaUpdateCatalogQualification.
 *
 * NÃO testável end-to-end nesta sessão (exigiria ambiente real com as 2
 * Functions deployadas) — a lógica de composição (quando chamar, com qual
 * payload) é testada isoladamente; a chamada HTTP em si segue o mesmo
 * contrato já auditado de `atdSolicitarHumanoValeria`, mas precisa de
 * verificação em homologação real (Fase D) antes de qualquer ativação.
 */
import * as admin from "firebase-admin";

const PROJECT_ID = "erp-vrmarcas";
const REGION = "us-central1";
const ENDPOINT_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/atdSolicitarHumanoValeria`;

async function loadSharedSecret(): Promise<string | null> {
  const doc = await admin.firestore().collection("erp_vr").doc("valeria_config").get();
  if (!doc.exists) return null;
  const raw = doc.data()?.data;
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { secret?: string }).secret || null;
  } catch {
    return null;
  }
}

export interface RequestQuoteReviewInput {
  conversationId: string;
  organizationId: string;
  motivo: string;
  requestId: string; // determinístico — idempotência do lado de atdSolicitarHumanoValeria
}

export interface RequestQuoteReviewResult {
  ok: boolean;
  jaSolicitado: boolean;
  error?: string;
}

export async function requestQuoteReview(input: RequestQuoteReviewInput): Promise<RequestQuoteReviewResult> {
  const secret = await loadSharedSecret();
  if (!secret) {
    console.error("[human_handoff] erp_vr/valeria_config sem secret — não foi possível solicitar QUOTE_REVIEW.");
    return { ok: false, jaSolicitado: false, error: "SHARED_SECRET_NOT_CONFIGURED" };
  }

  try {
    const res = await fetch(ENDPOINT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        motivo: input.motivo,
        requestId: input.requestId,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; jaSolicitado?: boolean; error?: string };
    return { ok: !!data.ok, jaSolicitado: !!data.jaSolicitado, error: data.error };
  } catch (e) {
    console.error("[human_handoff] falha ao chamar atdSolicitarHumanoValeria:", (e as Error).message);
    return { ok: false, jaSolicitado: false, error: "REQUEST_FAILED" };
  }
}
