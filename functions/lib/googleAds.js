"use strict";
/**
 * googleAds.ts
 * Cloud Functions — OAuth e métricas do Google Ads
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
exports.handleGoogleCallback = exports.getGoogleAuthUrl = exports.ENCRYPTION_KEY_G = exports.GOOGLE_DEV_TOKEN = exports.GOOGLE_CLIENT_SECRET = exports.GOOGLE_CLIENT_ID = void 0;
exports.refreshGoogleToken = refreshGoogleToken;
exports.fetchGoogleMetrics = fetchGoogleMetrics;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const axios_1 = __importDefault(require("axios"));
const encryption_1 = require("./encryption");
// ── Secrets ──────────────────────────────────────────────────────────────────
exports.GOOGLE_CLIENT_ID = (0, params_1.defineSecret)("GOOGLE_CLIENT_ID");
exports.GOOGLE_CLIENT_SECRET = (0, params_1.defineSecret)("GOOGLE_CLIENT_SECRET");
exports.GOOGLE_DEV_TOKEN = (0, params_1.defineSecret)("GOOGLE_DEVELOPER_TOKEN");
exports.ENCRYPTION_KEY_G = (0, params_1.defineSecret)("ENCRYPTION_KEY");
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_VER = "v17";
const SCOPES = "https://www.googleapis.com/auth/adwords";
// ── 1. Gerar URL de consentimento OAuth ──────────────────────────────────────
exports.getGoogleAuthUrl = (0, https_1.onCall)({ secrets: [exports.GOOGLE_CLIENT_ID], cors: true }, async (req) => {
    const companyId = req.auth?.token?.companyId;
    if (!companyId)
        throw new https_1.HttpsError("unauthenticated", "Empresa não identificada");
    const redirectUri = _redirectUri(false);
    const state = Buffer.from(JSON.stringify({ companyId })).toString("base64url");
    const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${exports.GOOGLE_CLIENT_ID.value()}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(SCOPES)}&` +
        `access_type=offline&` +
        `prompt=consent&` +
        `state=${state}`;
    return { url };
});
// ── 2. Callback OAuth ─────────────────────────────────────────────────────────
exports.handleGoogleCallback = (0, https_1.onRequest)({ secrets: [exports.GOOGLE_CLIENT_ID, exports.GOOGLE_CLIENT_SECRET, exports.GOOGLE_DEV_TOKEN, exports.ENCRYPTION_KEY_G] }, async (req, res) => {
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
    // Trocar code por access + refresh token
    const tokenRes = await axios_1.default.post(GOOGLE_TOKEN_URL, null, {
        params: {
            code,
            client_id: exports.GOOGLE_CLIENT_ID.value(),
            client_secret: exports.GOOGLE_CLIENT_SECRET.value(),
            redirect_uri: _redirectUri(true),
            grant_type: "authorization_code",
        },
    });
    const { access_token, refresh_token } = tokenRes.data;
    if (!refresh_token) {
        // Google só emite refresh_token na primeira autorização — redirecionar com erro
        res.redirect(`https://vrmarcas.github.io/erp-vr/?marketing=error&platform=google&reason=no_refresh_token`);
        return;
    }
    // Buscar contas de Ads vinculadas via Google Ads API
    const accountsRes = await axios_1.default.get(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VER}/customers:listAccessibleCustomers`, {
        headers: {
            Authorization: `Bearer ${access_token}`,
            "developer-token": exports.GOOGLE_DEV_TOKEN.value(),
        },
    });
    const resourceNames = accountsRes.data.resourceNames || [];
    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const encryptedAccess = (0, encryption_1.encrypt)(access_token, exports.ENCRYPTION_KEY_G.value());
    const encryptedRefresh = (0, encryption_1.encrypt)(refresh_token, exports.ENCRYPTION_KEY_G.value());
    const batch = db.batch();
    for (const rn of resourceNames) {
        const customerId = rn.replace("customers/", "");
        const docRef = db.collection("marketing_connections").doc(`${companyId}_GOOGLE_${customerId}`);
        batch.set(docRef, {
            companyId,
            platform: "GOOGLE_ADS",
            accountId: customerId,
            accountName: `Google Ads ${customerId}`,
            accessTokenEncrypted: encryptedAccess,
            refreshTokenEncrypted: encryptedRefresh,
            status: "ACTIVE",
            lastSyncedAt: null,
            createdAt: now,
            updatedAt: now,
        }, { merge: true });
    }
    await batch.commit();
    res.redirect(`https://vrmarcas.github.io/erp-vr/?marketing=connected&platform=google&accounts=${resourceNames.length}`);
});
// ── 3. Renovar access_token via refresh_token ─────────────────────────────────
async function refreshGoogleToken(encryptedRefresh) {
    const refreshToken = (0, encryption_1.decrypt)(encryptedRefresh, exports.ENCRYPTION_KEY_G.value());
    const res = await axios_1.default.post(GOOGLE_TOKEN_URL, null, {
        params: {
            refresh_token: refreshToken,
            client_id: exports.GOOGLE_CLIENT_ID.value(),
            client_secret: exports.GOOGLE_CLIENT_SECRET.value(),
            grant_type: "refresh_token",
        },
    });
    return res.data.access_token;
}
// ── 4. Helper: buscar métricas de uma conta Google ───────────────────────────
async function fetchGoogleMetrics(connectionDoc, dateStr // YYYY-MM-DD
) {
    const data = connectionDoc.data();
    // Renovar access_token
    let accessToken;
    try {
        accessToken = await refreshGoogleToken(data.refreshTokenEncrypted);
        // Persistir novo access_token criptografado
        await connectionDoc.ref.update({
            accessTokenEncrypted: (0, encryption_1.encrypt)(accessToken, exports.ENCRYPTION_KEY_G.value()),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (err) {
        await connectionDoc.ref.update({
            status: "TOKEN_EXPIRED",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw err;
    }
    // GAQL: buscar métricas de campanha
    const gaqlQuery = `SELECT campaign.id, campaign.name, ` +
        `metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ` +
        `FROM campaign ` +
        `WHERE segments.date = '${dateStr}' AND campaign.status != 'REMOVED'`;
    const apiRes = await axios_1.default.post(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VER}/customers/${data.accountId}/googleAds:search`, { query: gaqlQuery }, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": exports.GOOGLE_DEV_TOKEN.value(),
        },
    });
    const rows = apiRes.data.results || [];
    const db = admin.firestore();
    const batch = db.batch();
    for (const row of rows) {
        const campaignId = row.campaign.id;
        const campaignName = row.campaign.name;
        // Regra de conversão: cost_micros / 1_000_000
        const spendBrl = (parseInt(row.metrics.costMicros || "0") / 1000000);
        const metricId = `${connectionDoc.id}_${dateStr}_${campaignId}`;
        const metricRef = db.collection("marketing_daily_metrics").doc(metricId);
        batch.set(metricRef, {
            connectionId: connectionDoc.id,
            platform: "GOOGLE_ADS",
            campaignId,
            campaignName,
            spend: spendBrl,
            impressions: parseInt(row.metrics.impressions || "0"),
            clicks: parseInt(row.metrics.clicks || "0"),
            conversionsPlatform: parseFloat(row.metrics.conversions || "0"),
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
// ── Utils ─────────────────────────────────────────────────────────────────────
function _redirectUri(isRequest) {
    const base = process.env.FUNCTIONS_EMULATOR
        ? "http://localhost:5001/erp-vr/us-central1"
        : "https://us-central1-erp-vr.cloudfunctions.net";
    return `${base}/handleGoogleCallback`;
}
//# sourceMappingURL=googleAds.js.map