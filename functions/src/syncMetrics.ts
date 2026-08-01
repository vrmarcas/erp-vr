/**
 * syncMetrics.ts
 * Scheduled Cloud Function — sincroniza métricas de todas as conexões ativas
 * Roda diariamente às 02:00 via Pub/Sub
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { fetchMetaMetrics }   from "./metaAds";
import { fetchGoogleMetrics } from "./googleAds";

// Configuração de Exponential Backoff
const MAX_RETRIES      = 4;
const BASE_DELAY_MS    = 1_000; // 1 segundo
const JITTER_RANGE_MS  = 500;

async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt >= retries) throw err;
      // Rate Limit (429) ou erros transitórios (5xx)
      const isRetryable =
        err?.response?.status === 429 ||
        (err?.response?.status >= 500 && err?.response?.status < 600) ||
        err?.code === "ECONNRESET";
      if (!isRetryable) throw err;

      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * JITTER_RANGE_MS;
      console.warn(`[Retry ${attempt + 1}/${retries}] Aguardando ${Math.round(delay)}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

export const syncMarketingMetricsData = onSchedule(
  {
    schedule:  "every day 02:00",
    timeZone:  "America/Sao_Paulo",
    memory:    "512MiB",
    timeoutSeconds: 540, // 9 minutos
    maxInstances: 1,
  },
  async () => {
    const db  = admin.firestore();
    const now = new Date();

    // Data de ontem em YYYY-MM-DD (métricas do dia anterior são finais)
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    console.log(`[syncMarketing] Iniciando sync para ${dateStr}`);

    const snapshot = await db
      .collection("marketing_connections")
      .where("status", "==", "ACTIVE")
      .get();

    if (snapshot.empty) {
      console.log("[syncMarketing] Nenhuma conexão ativa encontrada.");
      return;
    }

    const results = await Promise.allSettled(
      snapshot.docs.map(async (doc) => {
        const { platform, accountId, companyId } = doc.data();
        console.log(`[syncMarketing] Processando ${platform} / ${accountId} (empresa: ${companyId})`);

        if (platform === "META_ADS") {
          await withExponentialBackoff(() => fetchMetaMetrics(doc, dateStr));
        } else if (platform === "GOOGLE_ADS") {
          await withExponentialBackoff(() => fetchGoogleMetrics(doc, dateStr));
        } else {
          console.warn(`[syncMarketing] Plataforma desconhecida: ${platform}`);
        }
      })
    );

    // Log de resultados
    let ok = 0, failed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        ok++;
      } else {
        failed++;
        console.error(`[syncMarketing] Falha em ${snapshot.docs[i].id}:`, r.reason?.message || r.reason);
      }
    });

    console.log(`[syncMarketing] Concluído: ${ok} OK, ${failed} falhas`);

    // Registrar log de execução no Firestore para auditoria
    await db.collection("marketing_sync_logs").add({
      date:           dateStr,
      totalProcessed: snapshot.size,
      ok,
      failed,
      ranAt:          admin.firestore.FieldValue.serverTimestamp(),
    });
  }
);

// ── Função HTTP callable para Forçar Sync Manual ─────────────────────────────
import { onCall, HttpsError } from "firebase-functions/v2/https";

export const forceMarketingSync = onCall(
  { memory: "512MiB", timeoutSeconds: 300 },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Autenticação necessária");

    const companyId = req.auth.token?.companyId || req.data?.companyId;
    if (!companyId) throw new HttpsError("invalid-argument", "companyId obrigatório");

    const db = admin.firestore();
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0]; // hoje para sync manual

    const snapshot = await db
      .collection("marketing_connections")
      .where("companyId", "==", companyId)
      .where("status", "==", "ACTIVE")
      .get();

    if (snapshot.empty) return { ok: 0, failed: 0, message: "Nenhuma conexão ativa" };

    const results = await Promise.allSettled(
      snapshot.docs.map(async (doc) => {
        const { platform } = doc.data();
        if (platform === "META_ADS") {
          await withExponentialBackoff(() => fetchMetaMetrics(doc, dateStr));
        } else if (platform === "GOOGLE_ADS") {
          await withExponentialBackoff(() => fetchGoogleMetrics(doc, dateStr));
        }
      })
    );

    const ok     = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return { ok, failed, date: dateStr };
  }
);
