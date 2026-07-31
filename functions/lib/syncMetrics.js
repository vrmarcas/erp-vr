"use strict";
/**
 * syncMetrics.ts
 * Scheduled Cloud Function — sincroniza métricas de todas as conexões ativas
 * Roda diariamente às 02:00 via Pub/Sub
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.forceMarketingSync = exports.syncMarketingMetricsData = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const metaAds_1 = require("./metaAds");
const googleAds_1 = require("./googleAds");
// Configuração de Exponential Backoff
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000; // 1 segundo
const JITTER_RANGE_MS = 500;
async function withExponentialBackoff(fn, retries = MAX_RETRIES) {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (err) {
            if (attempt >= retries)
                throw err;
            // Rate Limit (429) ou erros transitórios (5xx)
            const isRetryable = err?.response?.status === 429 ||
                (err?.response?.status >= 500 && err?.response?.status < 600) ||
                err?.code === "ECONNRESET";
            if (!isRetryable)
                throw err;
            const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * JITTER_RANGE_MS;
            console.warn(`[Retry ${attempt + 1}/${retries}] Aguardando ${Math.round(delay)}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
        }
    }
}
exports.syncMarketingMetricsData = (0, scheduler_1.onSchedule)({
    schedule: "every day 02:00",
    timeZone: "America/Sao_Paulo",
    memory: "512MiB",
    timeoutSeconds: 540, // 9 minutos
    maxInstances: 1,
}, async () => {
    const db = admin.firestore();
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
    const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
        const { platform, accountId, companyId } = doc.data();
        console.log(`[syncMarketing] Processando ${platform} / ${accountId} (empresa: ${companyId})`);
        if (platform === "META_ADS") {
            await withExponentialBackoff(() => (0, metaAds_1.fetchMetaMetrics)(doc, dateStr));
        }
        else if (platform === "GOOGLE_ADS") {
            await withExponentialBackoff(() => (0, googleAds_1.fetchGoogleMetrics)(doc, dateStr));
        }
        else {
            console.warn(`[syncMarketing] Plataforma desconhecida: ${platform}`);
        }
    }));
    // Log de resultados
    let ok = 0, failed = 0;
    results.forEach((r, i) => {
        if (r.status === "fulfilled") {
            ok++;
        }
        else {
            failed++;
            console.error(`[syncMarketing] Falha em ${snapshot.docs[i].id}:`, r.reason?.message || r.reason);
        }
    });
    console.log(`[syncMarketing] Concluído: ${ok} OK, ${failed} falhas`);
    // Registrar log de execução no Firestore para auditoria
    await db.collection("marketing_sync_logs").add({
        date: dateStr,
        totalProcessed: snapshot.size,
        ok,
        failed,
        ranAt: admin.firestore.FieldValue.serverTimestamp(),
    });
});
// ── Função HTTP callable para Forçar Sync Manual ─────────────────────────────
const https_1 = require("firebase-functions/v2/https");
exports.forceMarketingSync = (0, https_1.onCall)({ memory: "512MiB", timeoutSeconds: 300 }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError("unauthenticated", "Autenticação necessária");
    const companyId = req.auth.token?.companyId || req.data?.companyId;
    if (!companyId)
        throw new https_1.HttpsError("invalid-argument", "companyId obrigatório");
    const db = admin.firestore();
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0]; // hoje para sync manual
    const snapshot = await db
        .collection("marketing_connections")
        .where("companyId", "==", companyId)
        .where("status", "==", "ACTIVE")
        .get();
    if (snapshot.empty)
        return { ok: 0, failed: 0, message: "Nenhuma conexão ativa" };
    const results = await Promise.allSettled(snapshot.docs.map(async (doc) => {
        const { platform } = doc.data();
        if (platform === "META_ADS") {
            await withExponentialBackoff(() => (0, metaAds_1.fetchMetaMetrics)(doc, dateStr));
        }
        else if (platform === "GOOGLE_ADS") {
            await withExponentialBackoff(() => (0, googleAds_1.fetchGoogleMetrics)(doc, dateStr));
        }
    }));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    return { ok, failed, date: dateStr };
});
//# sourceMappingURL=syncMetrics.js.map