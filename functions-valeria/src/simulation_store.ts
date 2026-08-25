/**
 * simulation_store.ts — persistência de simulações de preço
 * (`valeria_simulations/{simulationId}`). Extraído de valeria.ts (sprint
 * P0.6) para ser compartilhado por action_executor.ts sem duplicar o
 * acesso a Firestore nem criar dependência circular com valeria.ts.
 */
import * as admin from "firebase-admin";
import type { PricingSimulation } from "./types";

export const SIM_COL = "valeria_simulations";
export const SIM_TTL_MS = 60 * 60 * 1000; // 1 hora

export async function saveSimulation(sim: PricingSimulation): Promise<void> {
  await admin.firestore().collection(SIM_COL).doc(sim.simulationId).set(sim);
}

export async function getSimulation(simulationId: string): Promise<PricingSimulation | null> {
  const doc = await admin.firestore().collection(SIM_COL).doc(simulationId).get();
  if (!doc.exists) return null;
  return doc.data() as PricingSimulation;
}
