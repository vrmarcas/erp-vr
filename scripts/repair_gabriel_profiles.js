/**
 * repair_gabriel_profiles.js
 * Reparo direcionado e auditável de EXATAMENTE duas contas autorizadas:
 *
 *   gabrieelborges8@gmail.com
 *   gabrieelborges8@hotmail.com
 *
 * (grafia "gabrieel" com dois "e" consecutivos está CORRETA)
 *
 * Estado final desejado para cada conta:
 *   Firebase Auth : conta existente, habilitada, custom claim role == "master"
 *   Firestore     : perfil em erp_vr/erp_usuarios com funcao == "master",
 *                   ativo == 1, uid registrado para associação inequívoca.
 *
 * Uso:
 *   node scripts/repair_gabriel_profiles.js
 *     → dry-run: auditoria completa + plano de mudanças, ZERO escritas.
 *
 *   node scripts/repair_gabriel_profiles.js --apply \
 *     --confirm-project=erp-vrmarcas \
 *     --confirm-emails=gabrieelborges8@gmail.com,gabrieelborges8@hotmail.com
 *     → escrita real (aguarda 5s para cancelamento).
 *
 * Garantias:
 *   - Lista fechada de e-mails; qualquer outro e-mail é recusado.
 *   - Projeto validado contra .firebaserc E project_id da credencial.
 *   - Claims preservadas via spread; verificação pós-escrita.
 *   - Atualização Firestore via transação (releitura no momento da escrita).
 *   - Conta Auth desabilitada NÃO é reabilitada silenciosamente (aborta e reporta).
 *   - Perfis duplicados para o mesmo e-mail → aborta por ambiguidade.
 *   - Backup dos valores anteriores gravado FORA do repositório antes de escrever.
 *   - Nunca imprime: senhas, tokens, UIDs completos, valores de claims alheias,
 *     conteúdo da credencial (exceto project_id), e-mails completos de terceiros.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ── Constantes ────────────────────────────────────────────────────────────────

const EXPECTED_PROJECT  = 'erp-vrmarcas';
const FIREBASERC_PATH   = path.join(__dirname, '../.firebaserc');
const COL_ERP           = 'erp_vr';
const DOC_USERS         = 'erp_usuarios';
const BACKUP_DIR        = path.join(os.homedir(), 'firebase-keys');

// Lista FECHADA — somente estes dois e-mails podem ser reparados.
const AUTHORIZED_EMAILS = [
  'gabrieelborges8@gmail.com',
  'gabrieelborges8@hotmail.com',
];

// ── Helpers puros (exportados para testes) ────────────────────────────────────

function normalizeEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function isAuthorizedEmail(v) {
  const e = normalizeEmail(v);
  return e !== null && AUTHORIZED_EMAILS.indexOf(e) >= 0;
}

function validateProjectLogic(rcProject, credProject) {
  return rcProject === EXPECTED_PROJECT && credProject === EXPECTED_PROJECT;
}

// Gate de escrita: exige --apply + --confirm-project + lista de e-mails idêntica.
function applyGate(applyFlag, confirmProjectFlag, confirmEmailsRaw) {
  if (!applyFlag) return { ok: true, mode: 'dry-run' };
  if (!confirmProjectFlag) {
    return { ok: false, reason: '--apply requer --confirm-project=' + EXPECTED_PROJECT };
  }
  const given = String(confirmEmailsRaw || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean)
    .sort();
  const expected = AUTHORIZED_EMAILS.slice().sort();
  const same = given.length === expected.length &&
    given.every((e, i) => e === expected[i]);
  if (!same) {
    return {
      ok: false,
      reason: '--apply requer --confirm-emails com EXATAMENTE os dois e-mails autorizados.',
    };
  }
  return { ok: true, mode: 'apply' };
}

// Decide a mudança de claim; nunca promove quem já é master, nunca toca em role
// desconhecida sem reportar.
function decideClaimUpdate(currentClaims) {
  const claims = currentClaims || {};
  const role   = claims.role;
  if (role === 'master') return { action: 'none', reason: 'role já é master' };
  if (role === undefined || role === null || role === '') {
    return { action: 'set', reason: 'claim role ausente' };
  }
  if (typeof role === 'string' && role.trim().toLowerCase() === 'admin') {
    return { action: 'set', reason: 'role legada "admin" → "master"' };
  }
  return { action: 'set', reason: 'role atual "' + role + '" → "master" (conta autorizada)' };
}

// Novo objeto de claims: spread preserva todas as chaves; somente role muda.
function buildNewClaims(currentClaims) {
  return Object.assign({}, currentClaims || {}, { role: 'master' });
}

// Atualização de perfil Firestore: preserva todos os campos, ajusta somente
// funcao/ativo/uid. Retorna cópia — não muta o original.
function buildProfileUpdate(existingProfile, uid, email) {
  const p = Object.assign({}, existingProfile || {});
  if (!existingProfile) {
    p.nome      = 'Gabriel Borges';
    p.email     = email;
    p.criadoEm  = Date.now();
    p.criadoPor = 'repair_gabriel_profiles.js';
  }
  p.funcao = 'master';
  p.ativo  = 1;
  if (uid && !p.uid) p.uid = uid;
  return p;
}

function maskEmail(email) {
  if (!email) return '***';
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***@***';
  const visible = local.length > 2 ? local.slice(0, 2) : local[0] || '*';
  return visible + '***@' + domain;
}

// E-mails autorizados podem aparecer completos; terceiros sempre mascarados.
function displayEmail(email) {
  return isAuthorizedEmail(email) ? normalizeEmail(email) : maskEmail(email);
}

function maskUid(uid) {
  if (!uid || String(uid).length < 8) return '***';
  return String(uid).slice(0, 6) + '…' + String(uid).slice(-4);
}

// Detecta espaços invisíveis / diferenças de caixa entre o valor armazenado e o
// normalizado.
function emailStorageIssues(stored, expectedNormalized) {
  const issues = [];
  if (typeof stored !== 'string') { issues.push('email ausente ou não-string'); return issues; }
  if (stored !== stored.trim())   issues.push('espaços laterais no valor armazenado');
  if (stored.trim() !== stored.trim().toLowerCase()) issues.push('maiúsculas no valor armazenado');
  if (/[ ​‌‍﻿]/.test(stored)) issues.push('caracteres invisíveis (nbsp/zero-width)');
  if (stored.trim().toLowerCase() !== expectedNormalized) issues.push('valor normalizado difere do esperado');
  return issues;
}

module.exports = {
  AUTHORIZED_EMAILS,
  EXPECTED_PROJECT,
  normalizeEmail,
  isAuthorizedEmail,
  validateProjectLogic,
  applyGate,
  decideClaimUpdate,
  buildNewClaims,
  buildProfileUpdate,
  maskEmail,
  displayEmail,
  maskUid,
  emailStorageIssues,
};

// ── Execução real somente quando invocado diretamente ────────────────────────

if (require.main !== module) return;

const APPLY           = process.argv.includes('--apply');
const CONFIRM_PROJECT = process.argv.includes('--confirm-project=' + EXPECTED_PROJECT);
const confirmEmailsArg = (process.argv.find(a => a.indexOf('--confirm-emails=') === 0) || '')
  .replace('--confirm-emails=', '');

const gate = applyGate(APPLY, CONFIRM_PROJECT, confirmEmailsArg);
if (!gate.ok) {
  console.error('ERRO ' + gate.reason);
  console.error('Nenhuma escrita foi realizada.');
  process.exit(1);
}

// ── Validação de projeto (antes do Firebase init) ────────────────────────────

function validateProjectOrExit() {
  let rcProject, credProject;
  try {
    const obj = JSON.parse(fs.readFileSync(FIREBASERC_PATH, 'utf8'));
    rcProject = obj && obj.projects && obj.projects.default;
    if (!rcProject) throw new Error('projects.default ausente em .firebaserc');
  } catch (e) {
    console.error('ERRO Falha ao ler .firebaserc: ' + e.message);
    process.exit(1);
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('ERRO GOOGLE_APPLICATION_CREDENTIALS nao definida.');
    process.exit(1);
  }
  try {
    // Somente project_id é lido; nenhum outro campo é exibido.
    const obj   = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    credProject = obj && obj.project_id;
    if (!credProject) throw new Error('campo project_id ausente no service account JSON');
  } catch (e) {
    console.error('ERRO Falha ao ler credential JSON: ' + e.message);
    process.exit(1);
  }
  console.log('   .firebaserc projects.default : "' + rcProject + '"');
  console.log('   Credential project_id        : "' + credProject + '"');
  if (!validateProjectLogic(rcProject, credProject)) {
    console.error('ERRO Projeto divergente do esperado "' + EXPECTED_PROJECT + '". Abortando.');
    process.exit(1);
  }
  console.log('OK Projeto Firebase confirmado: ' + EXPECTED_PROJECT);
}

console.log('='.repeat(64));
console.log(' repair_gabriel_profiles.js');
console.log(' Modo: ' + (APPLY ? 'APPLY (escrita real)' : 'DRY-RUN (somente leitura)'));
console.log('='.repeat(64));
console.log('\n--- Validando projeto Firebase ' + '-'.repeat(33));
validateProjectOrExit();

// ── Firebase Admin SDK ────────────────────────────────────────────────────────

let admin;
try {
  admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
} catch (e1) {
  try { admin = require('firebase-admin'); }
  catch (e2) {
    console.error('ERRO firebase-admin nao encontrado. Instale: cd functions && npm install');
    process.exit(1);
  }
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId:  EXPECTED_PROJECT,
  });
  console.log('OK Admin SDK inicializado (projectId: ' + EXPECTED_PROJECT + ')');
}

const db   = admin.firestore();
const auth = admin.auth();

// ── Auditoria de uma conta ────────────────────────────────────────────────────

async function auditAccount(email, fsUsers) {
  const report = { email, auth: null, profiles: [], issues: [], plan: [] };

  // 1. Firebase Auth
  try {
    const u = await auth.getUserByEmail(email);
    report.auth = {
      exists:     true,
      uid:        u.uid,
      disabled:   u.disabled === true,
      storedEmail: u.email,
      displayName: u.displayName || null,
      claims:     u.customClaims || {},
    };
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') {
      report.auth = { exists: false };
      report.issues.push('Conta NAO existe no Firebase Auth');
    } else {
      throw e;
    }
  }

  if (report.auth.exists) {
    const emailIssues = emailStorageIssues(report.auth.storedEmail, email);
    // Firebase Auth normaliza e-mails; qualquer divergência aqui é anomalia real
    emailIssues.forEach(i => report.issues.push('Auth email: ' + i));
    if (report.auth.disabled) {
      report.issues.push('Conta Auth esta DESABILITADA — reabilitacao exige acao humana explicita');
    }
  }

  // 2. Firestore — todos os registros cujo e-mail normalizado bate
  fsUsers.forEach((u, idx) => {
    const norm = typeof u.email === 'string' ? u.email.trim().toLowerCase() : null;
    if (norm === email) report.profiles.push({ idx, rec: u });
  });

  if (report.profiles.length === 0) {
    report.issues.push('Nenhum perfil em erp_usuarios para este e-mail');
  }
  if (report.profiles.length > 1) {
    report.issues.push('DUPLICIDADE: ' + report.profiles.length +
      ' perfis com o mesmo e-mail — ambiguidade, reparo abortara');
  }

  // 3. Associação UID × perfil
  if (report.auth.exists && report.profiles.length === 1) {
    const rec = report.profiles[0].rec;
    if (rec.uid && rec.uid !== report.auth.uid) {
      report.issues.push('UID do perfil difere do UID Auth — associacao incorreta');
    }
    if (!rec.uid) {
      report.issues.push('Perfil sem campo uid — associacao apenas por e-mail (fragil)');
    }
    const profIssues = emailStorageIssues(rec.email, email);
    profIssues.forEach(i => report.issues.push('Perfil email: ' + i));
  }

  // 4. Plano de mudanças
  if (!report.auth.exists) {
    report.plan.push({ target: 'auth', action: 'CRIAR conta Auth (email=' + email +
      ', displayName="Gabriel Borges", claim role=master); senha definida por reset posterior' });
  } else if (report.auth.disabled) {
    report.plan.push({ target: 'auth', action: 'ABORTAR — conta desabilitada nao sera reabilitada silenciosamente' });
  } else {
    const claimDecision = decideClaimUpdate(report.auth.claims);
    if (claimDecision.action === 'set') {
      report.plan.push({
        target: 'auth',
        action: 'setCustomUserClaims({...claims atuais, role:"master"}) — ' + claimDecision.reason +
          ' — chaves preservadas: [' + Object.keys(report.auth.claims).filter(k => k !== 'role').join(', ') + ']',
      });
    } else {
      report.plan.push({ target: 'auth', action: 'nenhuma (role ja e master)' });
    }
  }

  if (report.profiles.length > 1) {
    report.plan.push({ target: 'firestore', action: 'ABORTAR — perfis duplicados exigem decisao humana' });
  } else {
    const existing = report.profiles.length === 1 ? report.profiles[0].rec : null;
    const uid = report.auth.exists ? report.auth.uid : null;
    const updated = buildProfileUpdate(existing, uid, email);
    const changes = [];
    if (!existing) changes.push('CRIAR perfil');
    else {
      if (existing.funcao !== 'master') changes.push('funcao "' + existing.funcao + '" → "master"');
      if (!(existing.ativo === 1 || existing.ativo === '1' || existing.ativo === undefined)) changes.push('ativo → 1');
      if (existing.ativo === undefined) changes.push('ativo → 1 (campo ausente)');
      if (!existing.uid && uid) changes.push('registrar uid ' + maskUid(uid));
    }
    if (changes.length === 0) changes.push('nenhuma (perfil ja coerente)');
    report.plan.push({ target: 'firestore', action: changes.join('; '), updated });
  }

  return report;
}

function printReport(r) {
  console.log('\n  Conta: ' + r.email);
  console.log('  ' + '-'.repeat(60));
  if (!r.auth.exists) {
    console.log('  Auth       : NAO EXISTE');
  } else {
    console.log('  Auth       : existe | uid=' + maskUid(r.auth.uid) +
      ' | disabled=' + r.auth.disabled +
      ' | displayName=' + (r.auth.displayName || '(vazio)'));
    console.log('  Auth email : "' + r.auth.storedEmail + '" (armazenado)');
    const keys = Object.keys(r.auth.claims);
    console.log('  Claims     : ' + (keys.length ? 'chaves=[' + keys.join(', ') + '] role="' +
      (r.auth.claims.role === undefined ? '(ausente)' : r.auth.claims.role) + '"' : '(nenhuma claim)'));
  }
  if (r.profiles.length === 0) {
    console.log('  Firestore  : NENHUM perfil em erp_usuarios');
  } else {
    r.profiles.forEach(p => {
      const u = p.rec;
      console.log('  Firestore  : [idx ' + p.idx + '] nome="' + (u.nome || '(vazio)') +
        '" email="' + (typeof u.email === 'string' ? u.email : '(invalido)') +
        '" funcao="' + (u.funcao || '(vazio)') +
        '" ativo=' + (u.ativo === undefined ? '(ausente)' : u.ativo) +
        ' uid=' + (u.uid ? maskUid(u.uid) : '(ausente)'));
    });
  }
  if (r.issues.length) {
    console.log('  Divergencias:');
    r.issues.forEach(i => console.log('    ! ' + i));
  } else {
    console.log('  Divergencias: nenhuma');
  }
  console.log('  Plano:');
  r.plan.forEach(p => console.log('    > [' + p.target + '] ' + p.action));
}

// ── Aplicação (somente com gate completo) ─────────────────────────────────────

async function applyRepairs(reports, docRef) {
  // Bloqueios que impedem escrita
  for (const r of reports) {
    if (r.auth.exists && r.auth.disabled) {
      console.error('\nERRO Conta ' + r.email + ' esta desabilitada. Reparo abortado sem escritas.');
      process.exit(1);
    }
    if (r.profiles.length > 1) {
      console.error('\nERRO Perfis duplicados para ' + r.email + '. Reparo abortado sem escritas.');
      process.exit(1);
    }
  }

  // Backup fora do repositório
  const backupPath = path.join(BACKUP_DIR, 'repair_backup_gabriel_' + Date.now() + '.json');
  const backup = reports.map(r => ({
    email: r.email,
    authExists: r.auth.exists,
    uid: r.auth.exists ? r.auth.uid : null,
    previousClaims: r.auth.exists ? r.auth.claims : null,
    previousProfiles: r.profiles.map(p => p.rec),
  }));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  console.log('\nOK Backup gravado (fora do repositorio): ' + backupPath);

  // 1. Auth: criar conta ausente / atualizar claims
  for (const r of reports) {
    if (!r.auth.exists) {
      const created = await auth.createUser({ email: r.email, displayName: 'Gabriel Borges' });
      r.auth = { exists: true, uid: created.uid, disabled: false, storedEmail: created.email, claims: {} };
      console.log('OK Auth criada para ' + r.email + ' uid=' + maskUid(created.uid));
    }
    const decision = decideClaimUpdate(r.auth.claims);
    if (decision.action === 'set') {
      const before = r.auth.claims || {};
      await auth.setCustomUserClaims(r.auth.uid, buildNewClaims(before));
      const refreshed = await auth.getUser(r.auth.uid);
      const after = refreshed.customClaims || {};
      const lost = Object.keys(before).filter(k => k !== 'role' && !(k in after));
      if (after.role !== 'master' || lost.length > 0) {
        console.error('ERRO Verificacao pos-escrita falhou para ' + r.email +
          (lost.length ? ' — claims perdidas: ' + lost.join(', ') : ' — role="' + after.role + '"'));
        console.error('     Interrompendo antes de tocar o Firestore.');
        process.exit(1);
      }
      await auth.revokeRefreshTokens(r.auth.uid);
      console.log('OK Claim de ' + r.email + ' → role="master" (chaves preservadas: [' +
        Object.keys(after).filter(k => k !== 'role').join(', ') + ']; sessoes revogadas)');
      r.auth.claims = after;
    } else {
      console.log('OK Claim de ' + r.email + ' ja e master — sem alteracao.');
    }
  }

  // 2. Firestore: transação — relê o documento no momento da escrita
  await db.runTransaction(async tx => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new Error('erp_usuarios desapareceu — abortando transacao');
    const raw   = snap.data() && snap.data().data;
    const users = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(users)) throw new Error('data nao e um array — abortando');

    for (const r of reports) {
      const matches = [];
      users.forEach((u, i) => {
        const norm = typeof u.email === 'string' ? u.email.trim().toLowerCase() : null;
        if (norm === r.email) matches.push(i);
      });
      if (matches.length > 1) throw new Error('duplicidade surgiu para ' + r.email + ' — abortando');
      if (matches.length === 1) {
        users[matches[0]] = buildProfileUpdate(users[matches[0]], r.auth.uid, r.email);
      } else {
        users.push(buildProfileUpdate(null, r.auth.uid, r.email));
      }
    }

    tx.set(docRef, { data: JSON.stringify(users), ts: Date.now() });
  });
  console.log('OK Firestore erp_usuarios atualizado em transacao.');

  // 3. Verificação pós-escrita completa
  console.log('\n--- Verificacao pos-escrita ' + '-'.repeat(36));
  const snap  = await docRef.get();
  const users = JSON.parse(snap.data().data);
  for (const r of reports) {
    const u    = await auth.getUser(r.auth.uid);
    const prof = users.find(x => typeof x.email === 'string' && x.email.trim().toLowerCase() === r.email);
    const okAuth = u.disabled === false && (u.customClaims || {}).role === 'master';
    const okFs   = prof && prof.funcao === 'master' && (prof.ativo === 1 || prof.ativo === '1') && prof.uid === r.auth.uid;
    console.log('  ' + r.email + ' : Auth ' + (okAuth ? 'OK' : 'FALHOU') + ' | Firestore ' + (okFs ? 'OK' : 'FALHOU'));
    if (!okAuth || !okFs) process.exitCode = 1;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (APPLY) {
    console.log('\nMODO APPLY — escritas reais em 5s. Ctrl+C para cancelar.\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  const docRef = db.collection(COL_ERP).doc(DOC_USERS);
  const snap   = await docRef.get();
  let fsUsers  = [];
  if (snap.exists && snap.data() && snap.data().data) {
    try { fsUsers = JSON.parse(snap.data().data); } catch (e) {
      console.error('ERRO parse de erp_usuarios: ' + e.message);
      process.exit(1);
    }
  }
  if (!Array.isArray(fsUsers)) {
    console.error('ERRO erp_usuarios.data nao e um array.');
    process.exit(1);
  }
  console.log('\nOK erp_usuarios carregado: ' + fsUsers.length + ' registros.');

  console.log('\n--- AUDITORIA DAS CONTAS AUTORIZADAS ' + '-'.repeat(27));
  const reports = [];
  for (const email of AUTHORIZED_EMAILS) {
    const r = await auditAccount(email, fsUsers);
    printReport(r);
    reports.push(r);
  }

  // Registros admin remanescentes de TERCEIROS não são tocados — apenas contagem
  const otherAdmins = fsUsers.filter(u =>
    typeof u.funcao === 'string' && u.funcao.trim().toLowerCase() === 'admin' &&
    !(typeof u.email === 'string' && AUTHORIZED_EMAILS.indexOf(u.email.trim().toLowerCase()) >= 0)
  );
  console.log('\n  Perfis admin de terceiros (NAO serao tocados): ' + otherAdmins.length +
    (otherAdmins.length ? ' — ' + otherAdmins.map(u => maskEmail(u.email)).join(', ') : ''));

  if (!APPLY) {
    console.log('\n' + '='.repeat(64));
    console.log(' DRY-RUN concluido — NENHUMA escrita foi realizada.');
    console.log(' Para aplicar: --apply --confirm-project=' + EXPECTED_PROJECT);
    console.log('   --confirm-emails=' + AUTHORIZED_EMAILS.join(','));
    console.log('='.repeat(64) + '\n');
    process.exit(0);
  }

  await applyRepairs(reports, docRef);
  console.log('\n' + '='.repeat(64));
  console.log(' REPARO CONCLUIDO');
  console.log('='.repeat(64) + '\n');
  process.exit(process.exitCode || 0);
}

main().catch(err => {
  console.error('\nERRO: ' + err.message);
  if (err.code) console.error('     code: ' + err.code);
  console.error('Nenhuma escrita parcial adicional foi realizada.');
  process.exit(1);
});
