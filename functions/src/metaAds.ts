/**
 * metaAds.ts
 * Cloud Functions — OAuth e métricas do Meta Ads (Facebook/Instagram)
 */

import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import axios from "axios";
import { encrypt, decrypt } from "./encryption";

// ── Secrets ──────────────────────────────────────────────────────────────────
export const META_APP_ID      = defineSecret("META_APP_ID");
export const META_APP_SECRET  = defineSecret("META_APP_SECRET");
export const ENCRYPTION_KEY   = defineSecret("ENCRYPTION_KEY");

const META_GRAPH_URL = "https://graph.facebook.com/v20.0";
const SCOPES = ["ads_management", "ads_read", "read_insights", "business_management"].join(",");

// ── 1. Gerar URL de consentimento OAuth ──────────────────────────────────────
export const getMetaAuthUrl = onCall(
  { secrets: [META_APP_ID], cors: true },
  async (req) => {
    const companyId = req.auth?.token?.companyId;
    if (!companyId) throw new HttpsError("unauthenticated", "Empresa não identificada");

    const redirectUri = `${process.env.FUNCTIONS_EMULATOR
      ? "http://localhost:5001/erp-vr/us-central1"
      : "https://us-central1-erp-vr.cloudfunctions.net"}/handleMetaCallback`;

    const state = Buffer.from(JSON.stringify({ companyId })).toString("base64url");

    const url =
      `https://www.facebook.com/v20.0/dialog/oauth?` +
      `client_id=${META_APP_ID.value()}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(SCOPES)}&` +
      `state=${state}&response_type=code`;

    return { url };
  }
);

// ── 2. Callback OAuth — troca code por token e salva no Firestore ─────────────
export const handleMetaCallback = onRequest(
  { secrets: [META_APP_ID, META_APP_SECRET, ENCRYPTION_KEY] },
  async (req, res) => {
    const { code, state } = req.query as Record<string, string>;
    if (!code || !state) { res.status(400).send("Parâmetros inválidos"); return; }

    let companyId: string;
    try {
      companyId = JSON.parse(Buffer.from(state, "base64url").toString()).companyId;
    } catch {
      res.status(400).send("State inválido"); return;
    }

    const redirectUri = req.protocol + "://" + req.hostname + req.path;

    // Trocar code por short-lived token
    const tokenRes = await axios.get(`${META_GRAPH_URL}/oauth/access_token`, {
      params: {
        client_id:     META_APP_ID.value(),
        client_secret: META_APP_SECRET.value(),
        redirect_uri:  redirectUri,
        code,
      },
    });
    const shortToken: string = tokenRes.data.access_token;

    // Converter para long-lived token (60 dias)
    const longTokenRes = await axios.get(`${META_GRAPH_URL}/oauth/access_token`, {
      params: {
        grant_type:        "fb_exchange_token",
        client_id:         META_APP_ID.value(),
        client_secret:     META_APP_SECRET.value(),
        fb_exchange_token: shortToken,
      },
    });
    const longToken: string = longTokenRes.data.access_token;

    // Buscar contas de anúncios vinculadas
    const adAccountsRes = await axios.get(`${META_GRAPH_URL}/me/adaccounts`, {
      params: { fields: "id,name", access_token: longToken },
    });
    const accounts: { id: string; name: string }[] = adAccountsRes.data.data;

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const encryptedToken = encrypt(longToken, ENCRYPTION_KEY.value());

    const batch = db.batch();
    for (const account of accounts) {
      const docRef = db.collection("marketing_connections").doc(`${companyId}_META_${account.id}`);
      batch.set(docRef, {
        companyId,
        platform:             "META_ADS",
        accountId:            account.id,
        accountName:          account.name,
        accessTokenEncrypted: encryptedToken,
        status:               "ACTIVE",
        lastSyncedAt:         null,
        createdAt:            now,
        updatedAt:            now,
      }, { merge: true });
    }
    await batch.commit();

    // Redirecionar de volta ao ERP
    res.redirect(`https://vrmarcas.github.io/erp-vr/?marketing=connected&platform=meta&accounts=${accounts.length}`);
  }
);

// ── 3. Helper: buscar métricas de uma conta Meta ──────────────────────────────
export async function fetchMetaMetrics(
  connectionDoc: FirebaseFirestore.DocumentSnapshot,
  dateStr: string // YYYY-MM-DD
): Promise<void> {
  const data = connectionDoc.data()!;
  const token = decrypt(data.accessTokenEncrypted, ENCRYPTION_KEY.value());

  let campaigns: any[];
  try {
    const res = await axios.get(
      `${META_GRAPH_URL}/${data.accountId}/campaigns`,
      {
        params: {
          fields:       "id,name,insights{spend,impressions,clicks,actions}",
          time_range:   JSON.stringify({ since: dateStr, until: dateStr }),
          access_token: token,
        },
      }
    );
    campaigns = res.data.data;
  } catch (err: any) {
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
    if (!insights) continue;

    const conversions = (insights.actions || []).filter(
      (a: any) => a.action_type === "purchase" || a.action_type === "lead"
    ).reduce((sum: number, a: any) => sum + parseFloat(a.value || "0"), 0);

    const metricId = `${connectionDoc.id}_${dateStr}_${campaign.id}`;
    const metricRef = db.collection("marketing_daily_metrics").doc(metricId);
    batch.set(metricRef, {
      connectionId:        connectionDoc.id,
      platform:            "META_ADS",
      campaignId:          campaign.id,
      campaignName:        campaign.name,
      spend:               parseFloat(insights.spend || "0"),
      impressions:         parseInt(insights.impressions || "0"),
      clicks:              parseInt(insights.clicks || "0"),
      conversionsPlatform: conversions,
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
