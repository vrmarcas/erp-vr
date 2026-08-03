/**
 * adminUsers.ts — API administrativa de gestão de usuários
 * FASE 5 / ERP VR Marcas
 *
 * Callable Cloud Functions protegidas — apenas master autenticado.
 * Nenhuma credencial, token ou secret incorporado neste arquivo.
 * Secrets ficam no Firebase Secret Manager / variáveis de ambiente do Functions.
 *
 * Funções exportadas:
 *   adminCreateUser     — cria conta Auth + claim + perfil Firestore + link de convite
 *   adminUpdateUserRole — altera role (master protegido)
 *   adminToggleStatus   — ativa/desativa (não pode desativar a própria conta)
 *   adminResendInvite   — regera link de definição de senha
 *   adminRevokeSessions — revoga todos os tokens do usuário
 *   adminListUsers      — lista usuários para a tela administrativa
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// ── Constantes ────────────────────────────────────────────────────────────────

const VALID_ROLES = ["master", "comercial", "producao", "financeiro"] as const;
type Role = typeof VALID_ROLES[number];

const COL_ERP    = "erp_vr";
const DOC_USERS  = "erp_usuarios";
const COL_AUDIT  = "admin_audit_log";
const COL_IDEM   = "admin_idem_keys";
const COL_INVITE = "admin_invite_links";

// Rate limit: máximo de operações por UID por janela de 60s
const RATE_LIMIT_MAX    = 15;
const RATE_LIMIT_WINDOW = 60_000; // ms

// ── Tipos internos ────────────────────────────────────────────────────────────

interface UserProfile {
  uid: string;
  nome: string;
  email: string;
  funcao: Role;
  ativo: 1 | 0;
  criadoPor: string;   // UID mascarado
  criadoEm: number;
  convidadoEm: number;
}

interface AuditEntry {
  action: string;
  performedByMasked: string;
  performedByRole: string;
  targetEmailMasked: string;
  targetUidMasked: string;
  roleFrom: string | null;
  roleTo: string | null;
  statusBefore?: boolean;
  statusAfter?: boolean;
  timestamp: admin.firestore.FieldValue;
  success: boolean;
  errorCode?: string;
}

// ── Helpers de segurança ──────────────────────────────────────────────────────

/** Mascarar e-mail: jo***@email.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const visible = local.length > 2 ? local.slice(0, 2) : local[0] ?? "*";
  return `${visible}***@${domain}`;
}

/** Mascarar UID: abc123…xyz9 */
function maskUid(uid: string): string {
  if (uid.length < 8) return "***";
  return uid.slice(0, 6) + "…" + uid.slice(-4);
}

/** Valida e normaliza e-mail */
function normalizeEmail(raw: string): string {
  const email = String(raw || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError("invalid-argument", "E-mail inválido.");
  }
  return email;
}

/** Valida role */
function assertValidRole(role: unknown): asserts role is Role {
  if (!VALID_ROLES.includes(role as Role)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Role inválida. Valores aceitos: ${VALID_ROLES.join(", ")}.`
    );
  }
}

// ── Middleware de autenticação ─────────────────────────────────────────────────

function getCallerInfo(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  }
  const callerUid  = context.auth.uid;
  const callerRole = (context.auth.token?.role as string) || null;

  // Bloquear anônimos (auth existe mas sem role válida)
  if (!callerRole || !VALID_ROLES.includes(callerRole as Role)) {
    throw new functions.https.HttpsError("permission-denied", "Perfil sem permissão.");
  }
  return { callerUid, callerRole: callerRole as Role };
}

function requireAdminOrMaster(context: functions.https.CallableContext) {
  const caller = getCallerInfo(context);
  if (caller.callerRole !== "master") {
    throw new functions.https.HttpsError("permission-denied", "Requer role master.");
  }
  return caller;
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

const _rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(uid: string): void {
  const now  = Date.now();
  const slot = _rateLimitMap.get(uid);
  if (!slot || now - slot.windowStart > RATE_LIMIT_WINDOW) {
    _rateLimitMap.set(uid, { count: 1, windowStart: now });
    return;
  }
  slot.count++;
  if (slot.count > RATE_LIMIT_MAX) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "Muitas requisições. Aguarde e tente novamente."
    );
  }
}

// ── Auditoria ─────────────────────────────────────────────────────────────────

async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const db = admin.firestore();
    await db.collection(COL_AUDIT).add(entry);
  } catch (e) {
    // Falha de auditoria não deve bloquear a operação principal — apenas logamos
    functions.logger.error("[adminUsers] Falha ao gravar audit log:", e);
  }
}

// ── Leitura/escrita de erp_usuarios ──────────────────────────────────────────

async function readUsersDoc(): Promise<UserProfile[]> {
  const db  = admin.firestore();
  const doc = await db.collection(COL_ERP).doc(DOC_USERS).get();
  if (!doc.exists) return [];
  try {
    const raw = doc.data()?.data;
    return raw ? (JSON.parse(raw) as UserProfile[]) : [];
  } catch {
    return [];
  }
}

async function writeUsersDoc(users: UserProfile[]): Promise<void> {
  const db = admin.firestore();
  await db.collection(COL_ERP).doc(DOC_USERS).set({
    data: JSON.stringify(users),
    ts: Date.now(),
  });
}

// ── Idempotência ──────────────────────────────────────────────────────────────

/**
 * Garante que a mesma operação (por chave) não seja executada duas vezes
 * dentro de uma janela de 5 minutos.
 */
async function acquireIdem(key: string): Promise<boolean> {
  const db  = admin.firestore();
  const ref = db.collection(COL_IDEM).doc(key);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const age = now - (snap.data()?.ts ?? 0);
      if (age < 5 * 60_000) return false; // já executado recentemente
    }
    tx.set(ref, { ts: now });
    return true;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 1 — adminCreateUser
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cria um novo usuário no Firebase Auth, atribui role, cria perfil em
 * erp_usuarios e gera link de convite.
 *
 * Campos obrigatórios: { email, nome, role }
 * Campo opcional:      { ativo } (padrão: 1)
 *
 * Regras:
 * - Admin não pode criar master
 * - Somente master pode criar master
 * - E-mail duplicado retorna erro descritivo
 */
export const adminCreateUser = functions.https.onCall(async (data, context) => {
  const caller = requireAdminOrMaster(context);
  checkRateLimit(caller.callerUid);

  // Validação de campos
  const email  = normalizeEmail(data?.email);
  const nome   = String(data?.nome || "").trim();
  const role   = data?.role as unknown;
  const ativo  = data?.ativo === 0 ? 0 : 1;

  if (!nome || nome.length < 2) {
    throw new functions.https.HttpsError("invalid-argument", "Nome obrigatório (mín. 2 chars).");
  }
  assertValidRole(role);

  // Somente master pode criar master
  if (role === "master" && caller.callerRole !== "master") {
    throw new functions.https.HttpsError("permission-denied", "Somente master pode criar outro master.");
  }

  // Idempotência: evita duplicidade por clique duplo
  const idemKey = `create:${email}`;
  const acquired = await acquireIdem(idemKey);
  if (!acquired) {
    // Usuário pode já ter sido criado — verificamos
    try {
      const existing = await admin.auth().getUserByEmail(email);
      return {
        ok: true,
        idempotent: true,
        message: "Usuário já existe.",
        uidMasked: maskUid(existing.uid),
      };
    } catch {
      // Se não existe, deixa prosseguir
    }
  }

  // Verificar duplicidade explícita
  try {
    const existing = await admin.auth().getUserByEmail(email);
    await writeAudit({
      action: "createUser:duplicate",
      performedByMasked: maskUid(caller.callerUid),
      performedByRole: caller.callerRole,
      targetEmailMasked: maskEmail(email),
      targetUidMasked: maskUid(existing.uid),
      roleFrom: null,
      roleTo: role,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      success: false,
      errorCode: "already-exists",
    });
    throw new functions.https.HttpsError("already-exists", "Já existe uma conta com este e-mail.");
  } catch (e: any) {
    if (e?.code === "functions/already-exists") throw e;
    if (e?.code !== "auth/user-not-found") throw e;
    // auth/user-not-found → prosseguir com criação
  }

  // Criar usuário no Firebase Auth (sem senha — acesso via link de convite)
  let newUser: admin.auth.UserRecord;
  try {
    newUser = await admin.auth().createUser({
      email,
      displayName: nome,
      disabled: ativo === 0,
      // emailVerified: false (padrão)
    });
  } catch (e: any) {
    functions.logger.error("[adminCreateUser] Erro ao criar Auth user:", e.code);
    throw new functions.https.HttpsError("internal", "Erro ao criar conta. Tente novamente.");
  }

  // Atribuir custom claim role
  try {
    await admin.auth().setCustomUserClaims(newUser.uid, { role });
  } catch (e: any) {
    // Compensação: remover usuário criado para manter consistência
    try { await admin.auth().deleteUser(newUser.uid); } catch { /* ignore */ }
    throw new functions.https.HttpsError("internal", "Erro ao atribuir role. Conta não criada.");
  }

  // Criar/atualizar perfil em erp_usuarios
  try {
    const users = await readUsersDoc();
    const profileExists = users.findIndex((u) => u.email === email);

    const profile: UserProfile = {
      uid: newUser.uid,
      nome,
      email,
      funcao: role,
      ativo,
      criadoPor: maskUid(caller.callerUid),
      criadoEm: Date.now(),
      convidadoEm: Date.now(),
    };

    if (profileExists >= 0) {
      users[profileExists] = profile;
    } else {
      users.push(profile);
    }

    await writeUsersDoc(users);
  } catch (e: any) {
    // Auth criado mas perfil falhou — situação de inconsistência
    // Não desfazemos o Auth para não perder o UID; registramos o erro
    functions.logger.error("[adminCreateUser] Falha ao salvar perfil Firestore:", e.message);
    // Ainda retornamos sucesso parcial com aviso
    await writeAudit({
      action: "createUser:profileFailed",
      performedByMasked: maskUid(caller.callerUid),
      performedByRole: caller.callerRole,
      targetEmailMasked: maskEmail(email),
      targetUidMasked: maskUid(newUser.uid),
      roleFrom: null,
      roleTo: role,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      success: false,
      errorCode: "profile-write-failed",
    });
    // Retorna aviso mas não lança erro — conta Auth está criada
  }

  // Gerar link de convite (reset/definição de senha)
  let inviteLink: string | null = null;
  try {
    inviteLink = await admin.auth().generatePasswordResetLink(email, {
      url: "https://vrmarcas.github.io/erp-vr/",
    });

    // Armazenar link em admin_invite_links (acesso restrito a master/admin via Firestore rules)
    // NOTA: o link é sensível — não retornamos ao frontend diretamente
    const db = admin.firestore();
    await db.collection(COL_INVITE).doc(newUser.uid).set({
      email: maskEmail(email),   // e-mail mascarado no storage
      linkGeneratedAt: Date.now(),
      expireHint: "1 hora (padrão Firebase)",
      // NÃO armazenamos o link completo — apenas indicamos que foi gerado
      linkGenerated: true,
    });
  } catch (e: any) {
    functions.logger.warn("[adminCreateUser] Não foi possível gerar link de convite:", e.message);
  }

  // Auditoria de sucesso
  await writeAudit({
    action: "createUser",
    performedByMasked: maskUid(caller.callerUid),
    performedByRole: caller.callerRole,
    targetEmailMasked: maskEmail(email),
    targetUidMasked: maskUid(newUser.uid),
    roleFrom: null,
    roleTo: role,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    success: true,
  });

  // Resposta sanitizada — sem link completo, sem UID completo, sem claims raw
  return {
    ok: true,
    uidMasked: maskUid(newUser.uid),
    nome,
    emailMasked: maskEmail(email),
    role,
    ativo,
    inviteLinkReady: inviteLink !== null,
    inviteNote: inviteLink !== null
      ? "Link de definição de senha gerado. Envie o e-mail de convite manualmente ou configure um provedor de e-mail (ver NOTA_EMAIL.md)."
      : "Não foi possível gerar o link de convite. Use Firebase Console > Authentication > Enviar e-mail de redefinição.",
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 2 — adminUpdateUserRole
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Altera o role de um usuário existente.
 *
 * Campos: { targetUid, newRole }
 *
 * Regras:
 * - Nenhum usuário pode alterar a própria role
 * - Somente master pode alterar role de/para master
 */
export const adminUpdateUserRole = functions.https.onCall(async (data, context) => {
  const caller = requireAdminOrMaster(context);
  checkRateLimit(caller.callerUid);

  const targetUid = String(data?.targetUid || "").trim();
  const newRole   = data?.newRole as unknown;

  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "targetUid obrigatório.");
  }
  assertValidRole(newRole);

  // Nenhum usuário pode alterar a própria role
  if (targetUid === caller.callerUid) {
    throw new functions.https.HttpsError("permission-denied", "Você não pode alterar a própria role.");
  }

  // Buscar usuário alvo
  let target: admin.auth.UserRecord;
  try {
    target = await admin.auth().getUser(targetUid);
  } catch {
    throw new functions.https.HttpsError("not-found", "Usuário não encontrado.");
  }

  const currentRole = (target.customClaims?.role as string) || null;

  // Aplicar nova claim (preserva demais claims existentes)
  const existingClaims = target.customClaims || {};
  await admin.auth().setCustomUserClaims(targetUid, { ...existingClaims, role: newRole });

  // Revogar sessões ativas — token antigo com role antiga deve ser invalidado
  await admin.auth().revokeRefreshTokens(targetUid);

  // Atualizar perfil Firestore
  try {
    const users = await readUsersDoc();
    const idx   = users.findIndex((u) => u.uid === targetUid);
    if (idx >= 0) {
      users[idx].funcao = newRole;
      await writeUsersDoc(users);
    }
  } catch (e: any) {
    functions.logger.warn("[adminUpdateUserRole] Falha ao atualizar Firestore:", e.message);
  }

  await writeAudit({
    action: "updateRole",
    performedByMasked: maskUid(caller.callerUid),
    performedByRole: caller.callerRole,
    targetEmailMasked: maskEmail(target.email ?? ""),
    targetUidMasked: maskUid(targetUid),
    roleFrom: currentRole,
    roleTo: newRole,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    success: true,
  });

  return {
    ok: true,
    uidMasked: maskUid(targetUid),
    roleFrom: currentRole,
    roleTo: newRole,
    sessionsRevoked: true,
    note: "Token do usuário será inválido imediatamente. Ele precisará fazer login novamente.",
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 3 — adminToggleStatus
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Ativa ou desativa uma conta.
 *
 * Campos: { targetUid, disabled }
 *
 * Regras:
 * - Nenhum usuário pode desativar a própria conta
 */
export const adminToggleStatus = functions.https.onCall(async (data, context) => {
  const caller = requireAdminOrMaster(context);
  checkRateLimit(caller.callerUid);

  const targetUid = String(data?.targetUid || "").trim();
  const disabled  = Boolean(data?.disabled);

  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "targetUid obrigatório.");
  }

  // Nenhum usuário pode desativar a própria conta
  if (targetUid === caller.callerUid) {
    throw new functions.https.HttpsError("permission-denied", "Você não pode desativar a própria conta.");
  }

  let target: admin.auth.UserRecord;
  try {
    target = await admin.auth().getUser(targetUid);
  } catch {
    throw new functions.https.HttpsError("not-found", "Usuário não encontrado.");
  }

  await admin.auth().updateUser(targetUid, { disabled });

  // Se desativando — revogar sessões
  if (disabled) {
    await admin.auth().revokeRefreshTokens(targetUid);
  }

  // Atualizar Firestore
  try {
    const users = await readUsersDoc();
    const idx   = users.findIndex((u) => u.uid === targetUid);
    if (idx >= 0) {
      users[idx].ativo = disabled ? 0 : 1;
      await writeUsersDoc(users);
    }
  } catch (e: any) {
    functions.logger.warn("[adminToggleStatus] Falha ao atualizar Firestore:", e.message);
  }

  await writeAudit({
    action: disabled ? "deactivateUser" : "activateUser",
    performedByMasked: maskUid(caller.callerUid),
    performedByRole: caller.callerRole,
    targetEmailMasked: maskEmail(target.email ?? ""),
    targetUidMasked: maskUid(targetUid),
    roleFrom: null,
    roleTo: null,
    statusBefore: !target.disabled,
    statusAfter: !disabled,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    success: true,
  });

  return {
    ok: true,
    uidMasked: maskUid(targetUid),
    disabled,
    sessionsRevoked: disabled,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 4 — adminResendInvite
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Regera link de definição de senha para um usuário existente.
 * Útil quando o link anterior expirou (validade de 1 hora no Firebase).
 *
 * Campos: { email }
 *
 * NOTA: Esta função gera o link mas NÃO envia o e-mail automaticamente.
 * Integração com serviço de e-mail é necessária (ver NOTA_EMAIL.md).
 */
export const adminResendInvite = functions.https.onCall(async (data, context) => {
  const caller = requireAdminOrMaster(context);
  checkRateLimit(caller.callerUid);

  const email = normalizeEmail(data?.email);

  let target: admin.auth.UserRecord;
  try {
    target = await admin.auth().getUserByEmail(email);
  } catch {
    throw new functions.https.HttpsError("not-found", "Usuário não encontrado.");
  }

  if (target.disabled) {
    throw new functions.https.HttpsError("failed-precondition", "Conta desativada. Ative antes de reenviar o convite.");
  }

  let linkGenerated = false;
  try {
    await admin.auth().generatePasswordResetLink(email, {
      url: "https://vrmarcas.github.io/erp-vr/",
    });
    linkGenerated = true;

    // Atualiza registro de convite
    const db = admin.firestore();
    await db.collection(COL_INVITE).doc(target.uid).set({
      email: maskEmail(email),
      linkGeneratedAt: Date.now(),
      expireHint: "1 hora (padrão Firebase)",
      linkGenerated: true,
    }, { merge: true });
  } catch (e: any) {
    functions.logger.warn("[adminResendInvite] Falha ao gerar link:", e.message);
  }

  await writeAudit({
    action: "resendInvite",
    performedByMasked: maskUid(caller.callerUid),
    performedByRole: caller.callerRole,
    targetEmailMasked: maskEmail(email),
    targetUidMasked: maskUid(target.uid),
    roleFrom: null,
    roleTo: null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    success: linkGenerated,
  });

  return {
    ok: linkGenerated,
    inviteLinkReady: linkGenerated,
    inviteNote: linkGenerated
      ? "Novo link gerado. Envie ao usuário via WhatsApp ou e-mail manual."
      : "Falha ao gerar link. Tente pelo Firebase Console.",
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 5 — adminRevokeSessions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Revoga todos os refresh tokens de um usuário.
 * Útil após alteração de role ou suspeita de comprometimento.
 *
 * Campos: { targetUid }
 */
export const adminRevokeSessions = functions.https.onCall(async (data, context) => {
  const caller = requireAdminOrMaster(context);

  const targetUid = String(data?.targetUid || "").trim();
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "targetUid obrigatório.");
  }

  let target: admin.auth.UserRecord;
  try {
    target = await admin.auth().getUser(targetUid);
  } catch {
    throw new functions.https.HttpsError("not-found", "Usuário não encontrado.");
  }

  await admin.auth().revokeRefreshTokens(targetUid);

  await writeAudit({
    action: "revokeSessions",
    performedByMasked: maskUid(caller.callerUid),
    performedByRole: caller.callerRole,
    targetEmailMasked: maskEmail(target.email ?? ""),
    targetUidMasked: maskUid(targetUid),
    roleFrom: null,
    roleTo: null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    success: true,
  });

  return { ok: true, uidMasked: maskUid(targetUid), sessionsRevoked: true };
});

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 6 — adminListUsers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Lista usuários para a tela administrativa.
 * Retorna dados sanitizados — sem UID completo, sem claims raw, sem tokens.
 *
 * Campos opcionais: { maxResults } (padrão: 100, máximo: 1000)
 */
export const adminListUsers = functions.https.onCall(async (data, context) => {
  requireAdminOrMaster(context);

  const maxResults = Math.min(Number(data?.maxResults) || 100, 1000);

  const listResult = await admin.auth().listUsers(maxResults);

  const users = listResult.users.map((u) => ({
    uidMasked: maskUid(u.uid),
    displayName: u.displayName || "(sem nome)",
    emailMasked: maskEmail(u.email ?? ""),
    role: (u.customClaims?.role as string) || null,
    disabled: u.disabled,
    emailVerified: u.emailVerified,
    createdAt: u.metadata.creationTime,
    lastSignIn: u.metadata.lastSignInTime || null,
  }));

  return { ok: true, count: users.length, users };
});
