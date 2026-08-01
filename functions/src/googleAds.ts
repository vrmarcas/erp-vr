/**
 * googleAds.ts
 * Cloud Functions — OAuth e métricas do Google Ads
 */

import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import axios from "axios";
import { encrypt, decrypt } from "./encryption";

// ── Secrets ──────────────────────────────────────────────────────────────────
export const GOOGLE_CLIENT_ID      = defineSecret("GOOGLE_CLIENT_ID");
export const GOOGLE_CLIENT_SECRET  = defineSecret("GOOGLE_CLIENT_SECRET");
export const GOOGLE_DEV_TOKEN      = defineSecret("GOOGLE_DEVELOPER_TOKEN");
export const ENCRYPTION_KEY_G      = defineSecret("ENCRYPTION_KEY");

const GOOGLE_TOKEN_URL   = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_VER = "v17";
const SCOPES             = "https://www.googleapis.com/auth/adwords";

// ── 1. Gerar URL de consentimento OAuth ──────────────────────────────────────
export const getGoogleAuthUrl = onCall(
  { secrets: [GOOGLE_CLIENT_ID], cors: true },
  async (req) => {
    // ERP single-company: companyId fixo (custom claims não configuradas no projeto)
    if (!req.auth) throw new HttpsError("unauthenticated", "Usuário não autenticado");
    const companyId = (req.auth?.token?.companyId as string | undefined) || "vr_marcas";

    const redirectUri = _redirectUri(false);
    const state = Buffer.from(JSON.stringify({ companyId })).toString("base64url");

    const url =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID.value()}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(SCOPES)}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${state}`;

    return { url };
  }
);

// ── 2. Callback OAuth ─────────────────────────────────────────────────────────
export const handleGoogleCallback = onRequest(
  { secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_DEV_TOKEN, ENCRYPTION_KEY_G] },
  async (req, res) => {
    const { code, state } = req.query as Record<string, string>;
    if (!code || !state) { res.status(400).send("Parâmetros inválidos"); return; }

    let companyId: string;
    try {
      companyId = JSON.parse(Buffer.from(state, "base64url").toString()).companyId;
    } catch {
      res.status(400).send("State inválido"); return;
    }

    // Trocar code por access + refresh token
    const tokenRes = await axios.post(GOOGLE_TOKEN_URL, null, {
      params: {
        code,
        client_id:     GOOGLE_CLIENT_ID.value(),
        client_secret: GOOGLE_CLIENT_SECRET.value(),
        redirect_uri:  _redirectUri(true),
        grant_type:    "authorization_code",
      },
    });
    const { access_token, refresh_token } = tokenRes.data;
    if (!refresh_token) {
      // Google só emite refresh_token na primeira autorização — redirecionar com erro
      res.redirect(`https://vrmarcas.github.io/erp-vr/?marketing=error&platform=google&reason=no_refresh_token`);
      return;
    }

    // Buscar contas de Ads vinculadas via Google Ads API
    const accountsRes = await axios.get(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VER}/customers:listAccessibleCustomers`,
      {
        headers: {
          Authorization:             `Bearer ${access_token}`,
          "developer-token":         GOOGLE_DEV_TOKEN.value(),
        },
      }
    );
    const resourceNames: string[] = accountsRes.data.resourceNames || [];

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const encryptedAccess  = encrypt(access_token,   ENCRYPTION_KEY_G.value());
    const encryptedRefresh = encrypt(refresh_token,  ENCRYPTION_KEY_G.value());

    const batch = db.batch();
    for (const rn of resourceNames) {
      const customerId = rn.replace("customers/", "");
      const docRef = db.collection("marketing_connections").doc(`${companyId}_GOOGLE_${customerId}`);
      batch.set(docRef, {
        companyId,
        platform:              "GOOGLE_ADS",
        accountId:             customerId,
        accountName:           `Google Ads ${customerId}`,
        accessTokenEncrypted:  encryptedAccess,
        refreshTokenEncrypted: encryptedRefresh,
        status:                "ACTIVE",
        lastSyncedAt:          null,
        createdAt:             now,
        updatedAt:             now,
      }, { merge: true });
    }
    await batch.commit();

    res.redirect(`https://vrmarcas.github.io/erp-vr/?marketing=connected&platform=google&accounts=${resourceNames.length}`);
  }
);

// ── 3. Renovar access_token via refresh_token ─────────────────────────────────
export async function refreshGoogleToken(
  encryptedRefresh: string
): Promise<string> {
  const refreshToken = decrypt(encryptedRefresh, ENCRYPTION_KEY_G.value());
  const res = await axios.post(GOOGLE_TOKEN_URL, null, {
    params: {
      refresh_token: refreshToken,
      client_id:     GOOGLE_CLIENT_ID.value(),
      client_secret: GOOGLE_CLIENT_SECRET.value(),
      grant_type:    "refresh_token",
    },
  });
  return res.data.access_token as string;
}

// ── 4. Helper: buscar métricas de uma conta Google ───────────────────────────
export async function fetchGoogleMetrics(
  connectionDoc: FirebaseFirestore.DocumentSnapshot,
  dateStr: string // YYYY-MM-DD
): Promise<void> {
  const data = connectionDoc.data()!;

  // Renovar access_token
  let accessToken: string;
  try {
    accessToken = await refreshGoogleToken(data.refreshTokenEncrypted);
    // Persistir novo access_token criptografado
    await connectionDoc.ref.update({
      accessTokenEncrypted: encrypt(accessToken, ENCRYPTION_KEY_G.value()),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    await connectionDoc.ref.update({
      status:    "TOKEN_EXPIRED",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    throw err;
  }

  // GAQL: buscar métricas de campanha
  const gaqlQuery =
    `SELECT campaign.id, campaign.name, ` +
    `metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ` +
    `FROM campaign ` +
    `WHERE segments.date = '${dateStr}' AND campaign.status != 'REMOVED'`;

  const apiRes = await axios.post(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VER}/customers/${data.accountId}/googleAds:search`,
    { query: gaqlQuery },
    {
      headers: {
        Authorization:     `Bearer ${accessToken}`,
        "developer-token": GOOGLE_DEV_TOKEN.value(),
      },
    }
  );

  const rows: any[] = apiRes.data.results || [];
  const db = admin.firestore();
  const batch = db.batch();

  for (const row of rows) {
    const campaignId   = row.campaign.id;
    const campaignName = row.campaign.name;
    // Regra de conversão: cost_micros / 1_000_000
    const spendBrl = (parseInt(row.metrics.costMicros || "0") / 1_000_000);

    const metricId  = `${connectionDoc.id}_${dateStr}_${campaignId}`;
    const metricRef = db.collection("marketing_daily_metrics").doc(metricId);
    batch.set(metricRef, {
      connectionId:        connectionDoc.id,
      platform:            "GOOGLE_ADS",
      campaignId,
      campaignName,
      spend:               spendBrl,
      impressions:         parseInt(row.metrics.impressions || "0"),
      clicks:              parseInt(row.metrics.clicks || "0"),
      conversionsPlatform: parseFloat(row.metrics.conversions || "0"),
      date:                dateStr,
      updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
  await connectionDoc.ref.update({
    lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function _redirectUri(isRequest: boolean): string {
  const base = process.env.FUNCTIONS_EMULATOR
    ? "http://localhost:5001/erp-vr/us-central1"
    : "https://us-central1-erp-vr.cloudfunctions.net";
  return `${base}/handleGoogleCallback`;
}
