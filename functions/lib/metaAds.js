"use strict";
/**
 * metaAds.ts
 * Cloud Functions — OAuth e métricas do Meta Ads (Facebook/Instagram)
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMetaCallback = exports.getMetaAuthUrl = exports.ENCRYPTION_KEY = exports.META_APP_SECRET = exports.META_APP_ID = void 0;
exports.fetchMetaMetrics = fetchMetaMetrics;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const axios_1 = __importDefault(require("axios"));
const encryption_1 = require("./encryption");
// ── Secrets ──────────────────────────────────────────────────────────────────
exports.META_APP_ID = (0, params_1.defineSecret)("META_APP_ID");
exports.META_APP_SECRET = (0, params_1.defineSecret)("META_APP_SECRET");
exports.ENCRYPTION_KEY = (0, params_1.defineSecret)("ENCRYPTION_KEY");
const META_GRAPH_URL = "https://graph.facebook.com/v20.0";
const SCOPES = ["ads_management", "ads_read", "read_insights", "business_management"].join(",");
// ── 1. Gerar URL de consentimento OAuth ──────────────────────────────────────
exports.getMetaAuthUrl = (0, https_1.onCall)({ secrets: [exports.META_APP_ID], cors: true }, async (req) => {
    const companyId = req.auth?.token?.companyId;
    if (!companyId)
        throw new https_1.HttpsError("unauthenticated", "Empresa não identificada");
    const redirectUri = `${process.env.FUNCTIONS_EMULATOR
        ? "http://localhost:5001/erp-vr/us-central1"
        : "https://us-central1-erp-vr.cloudfunctions.net"}/handleMetaCallback`;
    const state = Buffer.from(JSON.stringify({ companyId })).toString("base64url");
    const url = `https://www.facebook.com/v20.0/dialog/oauth?` +
        `client_id=${exports.META_APP_ID.value()}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `scope=${encodeURIComponent(SCOPES)}&` +
        `state=${state}&response_type=code`;
    return { url };
});
// ── 2. Callback OAuth — troca code por token e salva no Firestore ─────────────
exports.handleMetaCallback = (0, https_1.onRequest)({ secrets: [exports.META_APP_ID, exports.META_APP_SECRET, exports.ENCRYPTION_KEY] }, async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) {
        res.status(400).send("Parâmetros inválidos");
        return;
    }
    let companyId;
    try {
        companyId = JSON.parse(Buffer.from(state, "base64url").toString()).companyId;
    }
    catch {
        res.status(400).send("State inválido");
        return;
    }
    const redirectUri = req.protocol + "://" + req.hostname + req.path;
    // Trocar code por short-lived token
    const tokenRes = await axios_1.default.get(`${META_GRAPH_URL}/oauth/access_token`, {
        params: {
            client_id: exports.META_APP_ID.value(),
            client_secret: exports.META_APP_SECRET.value(),
            redirect_uri: redirectUri,
            code,
        },
    });
    const shortToken = tokenRes.data.access_token;
    // Converter para long-lived token (60 dias)
    const longTokenRes = await axios_1.default.get(`${META_GRAPH_URL}/oauth/access_token`, {
        params: {
            grant_type: "fb_exchange_token",
            client_id: exports.META_APP_ID.value(),
            client_secret: exports.META_APP_SECRET.value(),
            fb_exchange_token: shortToken,
        },
    });
    const longToken = longTokenRes.data.access_token;
    // Buscar contas de anúncios vinculadas
    const adAccountsRes = await axios_1.default.get(`${META_GRAPH_URL}/me/adaccounts`, {
        params: { fields: "id,name", access_token: longToken },
    });
    const accounts = adAccountsRes.data.data;
    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const encryptedToken = (0, encryption_1.encrypt)(longToken, exports.ENCRYPTION_KEY.value());
    const batch = db.batch();
    for (const account of accounts) {
        const docRef = db.collection("marketing_connections").doc(`${companyId}_META_${account.id}`);
        batch.set(docRef, {
            companyId,
            platform: "META_ADS",
            accountId: account.id,
            accountName: account.name,
            accessTokenEncrypted: encryptedToken,
            status: "ACTIVE",
            lastSyncedAt: null,
            createdAt: now,
            updatedAt: now,
        }, { merge: true });
    }
    await batch.commit();
    // Redirecionar de volta ao ERP
    res.redirect(`https://vrmarcas.github.io/erp-vr/?marketing=connected&platform=meta&accounts=${accounts.length}`);
});
// ── 3. Helper: buscar métricas de uma conta Meta ──────────────────────────────
async function fetchMetaMetrics(connectionDoc, dateStr // YYYY-MM-DD
) {
    const data = connectionDoc.data();
    const token = (0, encryption_1.decrypt)(data.accessTokenEncrypted, exports.ENCRYPTION_KEY.value());
    let campaigns;
    try {
        const res = await axios_1.default.get(`${META_GRAPH_URL}/${data.accountId}/campaigns`, {
            params: {
                fields: "id,name,insights{spend,impressions,clicks,actions}",
                time_range: JSON.stringify({ since: dateStr, until: dateStr }),
                access_token: token,
            },
        });
        campaigns = res.data.data;
    }
    catch (err) {
        const code = err?.response?.data?.error?.code;
        if (code === 190) {
            // Token expirado
            await connectionDoc.ref.update({ status: "TOKEN_EXPIRED", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        throw err;
    }
    const db = admin.firestore();
    const batch = db.batch();
    for (const campaign of campaigns) {
        const insights = campaign.insights?.data?.[0];
        if (!insights)
            continue;
        const conversions = (insights.actions || []).filter((a) => a.action_type === "purchase" || a.action_type === "lead").reduce((sum, a) => sum + parseFloat(a.value || "0"), 0);
        const metricId = `${connectionDoc.id}_${dateStr}_${campaign.id}`;
        const metricRef = db.collection("marketing_daily_metrics").doc(metricId);
        batch.set(metricRef, {
            connectionId: connectionDoc.id,
            platform: "META_ADS",
            campaignId: campaign.id,
            campaignName: campaign.name,
            spend: parseFloat(insights.spend || "0"),
            impressions: parseInt(insights.impressions || "0"),
            clicks: parseInt(insights.clicks || "0"),
            conversionsPlatform: conversions,
            date: dateStr,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    await batch.commit();
    await connectionDoc.ref.update({
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}
//# sourceMappingURL=metaAds.js.map