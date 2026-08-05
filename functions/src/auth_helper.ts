/**
 * auth_helper.ts — fronteira de autorização compartilhada por todas as
 * Cloud Functions de estoque/produção (extraído de producao.ts nesta
 * rodada, para não reimplementar a mesma verificação por função).
 *
 * Regra de identidade, igual em toda a superfície: a role nunca vem do
 * payload — só de context.auth (custom claim), reconferida contra
 * erp_vr_usuarios/{uid} (papel oficial cadastrado + conta ativa). Qualquer
 * divergência nega o acesso (fail-closed), nunca tenta adivinhar a role.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

export const VALID_ROLES = ["master", "comercial", "producao", "financeiro"] as const;
export type Role = typeof VALID_ROLES[number];

export interface CallerVerificado {
  uid: string;
  role: Role;
}

export function normalizeRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const r = value.trim().toLowerCase();
  if (r === "admin") return "master";
  if ((VALID_ROLES as readonly string[]).includes(r)) return r as Role;
  return null;
}

export async function getCallerVerificado(context: functions.https.CallableContext): Promise<CallerVerificado> {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  }
  const uid = context.auth.uid;
  const claimRole = normalizeRole(context.auth.token?.role);
  if (!claimRole) {
    throw new functions.https.HttpsError("permission-denied", "Perfil sem permissão (claim ausente ou inválida).");
  }

  const userDoc = await admin.firestore().collection("erp_vr_usuarios").doc(uid).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError("permission-denied", "Conta sem cadastro em erp_vr_usuarios — acesso negado.");
  }
  const u = userDoc.data() || {};
  if (!(u.ativo === 1 || u.ativo === true)) {
    throw new functions.https.HttpsError("permission-denied", "Conta desativada — acesso negado.");
  }
  const docRole = normalizeRole(u.funcao);
  if (!docRole || docRole !== claimRole) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Divergência entre a permissão da sessão e o cadastro — acesso negado. Faça login novamente."
    );
  }
  return { uid, role: claimRole };
}

/** master sempre passa; demais roles precisam estar em `allowed`. */
export function requireRole(caller: CallerVerificado, allowed: Role[], acao: string) {
  if (caller.role === "master") return;
  if (!allowed.includes(caller.role)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      `Perfil "${caller.role}" não pode ${acao}. Permitido: master, ${allowed.join(", ")}.`
    );
  }
}

/**
 * Idempotência de curto prazo (double-click / retry) por requestId.
 * `col` isola a chave por domínio (evita colisão entre módulos diferentes
 * usando o mesmo requestId por coincidência).
 */
export async function acquireIdem(col: string, key: string, ttlMs = 5 * 60_000): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(col).doc(key);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const age = now - ((snap.data()?.ts as number) ?? 0);
      if (age < ttlMs) return false;
    }
    tx.set(ref, { ts: now });
    return true;
  });
}

export async function writeAudit(
  col: string, action: string, callerUid: string, callerRole: string, detail: Record<string, unknown>
): Promise<void> {
  try {
    await admin.firestore().collection(col).add({
      action, callerUid, callerRole, detail, timestamp: Date.now(),
    });
  } catch (e) {
    functions.logger.error(`[audit:${col}] falha ao gravar auditoria:`, e);
  }
}

export function parseDoc<T>(snap: FirebaseFirestore.DocumentSnapshot, dflt: T): T {
  try {
    const raw = snap.exists ? snap.data()?.data : undefined;
    if (typeof raw !== "string") return dflt;
    return JSON.parse(raw) as T;
  } catch {
    return dflt;
  }
}
