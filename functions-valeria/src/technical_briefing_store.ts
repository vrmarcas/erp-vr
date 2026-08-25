/**
 * technical_briefing_store.ts — persistência do TechnicalBriefing
 * (sprint P0.3, Bloco A4). Separado de technical_briefing.ts (puro, sem
 * Firestore) para manter esse último 100% testável sem mocks de I/O.
 *
 * Coleção dedicada `valeria_technical_briefings/{conversationId}` —
 * paralela a `valeria_briefings` (briefing CONVERSACIONAL genérico, usado
 * por catálogo/Vitre/classificação). Não migra o schema existente: cada
 * um serve um propósito diferente, coexistem.
 */
import * as admin from "firebase-admin";
import type { TechnicalBriefing } from "./technical_briefing";
import { emptyTechnicalBriefing, computeTechnicalReadiness } from "./technical_briefing";
import { isTrofeuGoJovemAlias, TROFEU_GOJOVEM_PRODUCT_ID, TROFEU_GOJOVEM_ENVELOPE } from "./trofeu_gojovem";

const COL = "valeria_technical_briefings";

/**
 * Sprint P0.4 — a ÚNICA fonte de verdade de qual simulação é a "última
 * elegível" desta conversa. O LLM NUNCA decide/gera este valor — ele só
 * é escrito por valeriaCalcularProdutoPersonalizado logo após uma
 * simulação ELIGIBLE, e lido por valeriaCriarOrcamento, que ignora
 * qualquer simulationId que o modelo tente enviar. `fingerprint` é o
 * technicalBriefingFingerprint() calculado NO MOMENTO do cálculo — se o
 * briefing atual da conversa gerar um fingerprint diferente na hora de
 * criar o orçamento, a simulação é tratada como desatualizada (P0.4).
 */
export interface LastEligibleSimulation {
  simulationId: string;
  createdAt: number;
  productId: string;
  finalPrice: number;
  fingerprint: string;
}

export async function saveLastEligibleSimulation(conversationId: string, rec: LastEligibleSimulation): Promise<void> {
  await admin.firestore().collection(COL).doc(conversationId).set(
    { lastEligibleSimulation: rec, updatedAt: Date.now() },
    { merge: true }
  );
}

export async function loadLastEligibleSimulation(conversationId: string): Promise<LastEligibleSimulation | null> {
  const doc = await admin.firestore().collection(COL).doc(conversationId).get();
  if (!doc.exists) return null;
  const data = doc.data() as { lastEligibleSimulation?: LastEligibleSimulation } | undefined;
  return data?.lastEligibleSimulation ?? null;
}

/** Consumida (orçamento criado) — nunca reutilizável de novo, mesmo que o fingerprint ainda bata. */
export async function clearLastEligibleSimulation(conversationId: string): Promise<void> {
  await admin.firestore().collection(COL).doc(conversationId).set(
    { lastEligibleSimulation: admin.firestore.FieldValue.delete(), updatedAt: Date.now() },
    { merge: true }
  );
}

export async function loadTechnicalBriefing(conversationId: string): Promise<TechnicalBriefing> {
  const doc = await admin.firestore().collection(COL).doc(conversationId).get();
  if (!doc.exists) return emptyTechnicalBriefing();
  const data = doc.data() as Partial<TechnicalBriefing> | undefined;
  return { ...emptyTechnicalBriefing(), ...(data || {}) };
}

export async function saveTechnicalBriefing(conversationId: string, b: TechnicalBriefing): Promise<void> {
  const readiness = computeTechnicalReadiness(b);
  await admin.firestore().collection(COL).doc(conversationId).set(
    { ...b, missingRequiredFields: readiness.missingRequiredFields, updatedAt: Date.now() },
    { merge: true }
  );
}

/**
 * Merge progressivo — só sobrescreve campos EXPLICITAMENTE presentes no
 * patch (mesma disciplina de briefing.ts: nunca apaga dado confirmado
 * com ausência/null de um campo que simplesmente não veio nesta chamada).
 */
export function mergeTechnicalBriefing(atual: TechnicalBriefing, patch: Partial<TechnicalBriefing>): TechnicalBriefing {
  // Sprint P0.9 — Troféu GoJovem: produto conhecido, com receita/material/
  // espessura fixos já cadastrados no ERP. Reconhecendo o alias no texto
  // que o LLM extraiu, canonicaliza productId e AUTO-PREENCHE os campos
  // técnicos que o modelo já define — a Valéria nunca precisa perguntar
  // material/espessura/tamanho para este produto, e o cliente nunca vê
  // esse preenchimento (é 100% server-side, nunca decisão do LLM).
  const ehTrofeuGoJovem = patch.productId != null && isTrofeuGoJovemAlias(patch.productId);
  const patchEfetivo: Partial<TechnicalBriefing> = ehTrofeuGoJovem
    ? {
        ...patch,
        productId: TROFEU_GOJOVEM_PRODUCT_ID,
        materialId: TROFEU_GOJOVEM_ENVELOPE.materialId,
        thicknessMm: TROFEU_GOJOVEM_ENVELOPE.thicknessMm,
        dimensions: {
          larguraMm: TROFEU_GOJOVEM_ENVELOPE.larguraMm,
          alturaMm: TROFEU_GOJOVEM_ENVELOPE.alturaMm,
          profundidadeMm: patch.dimensions?.profundidadeMm ?? atual.dimensions.profundidadeMm ?? null,
        },
      }
    : patch;

  const out: TechnicalBriefing = {
    ...atual,
    ...(patchEfetivo.productId !== undefined ? { productId: patchEfetivo.productId } : {}),
    ...(patchEfetivo.quantity !== undefined ? { quantity: patchEfetivo.quantity } : {}),
    ...(patchEfetivo.materialId !== undefined ? { materialId: patchEfetivo.materialId } : {}),
    ...(patchEfetivo.thicknessMm !== undefined ? { thicknessMm: patchEfetivo.thicknessMm } : {}),
    ...(patch.adesivo !== undefined ? { adesivo: patch.adesivo } : {}),
    ...(patch.adesivoBranco !== undefined ? { adesivoBranco: patch.adesivoBranco } : {}),
    // Sprint P0.6 — sinais de controle/Bloco C, mesma disciplina de merge
    // progressivo (só sobrescreve o que veio explicitamente no patch).
    ...(patch.solicitacoesNaoSuportadas !== undefined ? { solicitacoesNaoSuportadas: patch.solicitacoesNaoSuportadas } : {}),
    ...(patch.clientConfirmedQuote !== undefined ? { clientConfirmedQuote: patch.clientConfirmedQuote } : {}),
    ...(patch.wantsDeadlineCheck !== undefined ? { wantsDeadlineCheck: patch.wantsDeadlineCheck } : {}),
    ...(patch.dataNecessidadeCliente !== undefined ? { dataNecessidadeCliente: patch.dataNecessidadeCliente } : {}),
    dimensions: {
      larguraMm: patchEfetivo.dimensions?.larguraMm !== undefined ? patchEfetivo.dimensions.larguraMm : atual.dimensions.larguraMm,
      alturaMm: patchEfetivo.dimensions?.alturaMm !== undefined ? patchEfetivo.dimensions.alturaMm : atual.dimensions.alturaMm,
      profundidadeMm: patchEfetivo.dimensions?.profundidadeMm !== undefined ? patchEfetivo.dimensions.profundidadeMm : atual.dimensions.profundidadeMm,
    },
  };
  const readiness = computeTechnicalReadiness(out);
  out.missingRequiredFields = readiness.missingRequiredFields;
  out.confirmedFields = (["productId", "larguraMm", "alturaMm", "profundidadeMm", "quantity", "materialId", "thicknessMm"] as const)
    .filter((f) => !readiness.missingRequiredFields.includes(f));
  return out;
}
