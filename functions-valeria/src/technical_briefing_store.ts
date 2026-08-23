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
  const out: TechnicalBriefing = {
    ...atual,
    ...(patch.productId !== undefined ? { productId: patch.productId } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
    ...(patch.materialId !== undefined ? { materialId: patch.materialId } : {}),
    ...(patch.thicknessMm !== undefined ? { thicknessMm: patch.thicknessMm } : {}),
    ...(patch.adesivo !== undefined ? { adesivo: patch.adesivo } : {}),
    ...(patch.adesivoBranco !== undefined ? { adesivoBranco: patch.adesivoBranco } : {}),
    dimensions: {
      larguraMm: patch.dimensions?.larguraMm !== undefined ? patch.dimensions.larguraMm : atual.dimensions.larguraMm,
      alturaMm: patch.dimensions?.alturaMm !== undefined ? patch.dimensions.alturaMm : atual.dimensions.alturaMm,
      profundidadeMm: patch.dimensions?.profundidadeMm !== undefined ? patch.dimensions.profundidadeMm : atual.dimensions.profundidadeMm,
    },
  };
  const readiness = computeTechnicalReadiness(out);
  out.missingRequiredFields = readiness.missingRequiredFields;
  out.confirmedFields = (["productId", "larguraMm", "alturaMm", "profundidadeMm", "quantity", "materialId", "thicknessMm"] as const)
    .filter((f) => !readiness.missingRequiredFields.includes(f));
  return out;
}
