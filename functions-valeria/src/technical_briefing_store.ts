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
