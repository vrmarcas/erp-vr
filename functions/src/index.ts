/**
 * index.ts — Entry point das Cloud Functions
 * Exporta todas as functions para o Firebase deploy
 */

import * as admin from "firebase-admin";

// Inicializar Admin SDK (executado uma única vez por instância cold-start)
if (!admin.apps.length) {
  admin.initializeApp();
}

// ── Meta Ads ──────────────────────────────────────────────────────────────────
export { getMetaAuthUrl, handleMetaCallback } from "./metaAds";

// ── Google Ads ────────────────────────────────────────────────────────────────
export { getGoogleAuthUrl, handleGoogleCallback } from "./googleAds";

// ── Sync automático + Manual ──────────────────────────────────────────────────
export { syncMarketingMetricsData, forceMarketingSync } from "./syncMetrics";

// ── Valéria (Chatvolt chatbot) ────────────────────────────────────────────────
export {
  valeriaGetCliente,
  valeriaUpsertCliente,
  valeriaCatalogo,
  valeriaCriarOrcamento,
  valeriaCriarOportunidade,
  valeriaRegistrarMensagem,
  valeriaTransferirHumano,
  valeriaProximaAcao,
  valeriaConsultarOS,
  valeriaStatus,
} from "./valeria";
