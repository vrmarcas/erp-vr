/**
 * migrate_admin_to_master.js
 * Migra todos os usuários com funcao/role == 'admin' ou 'Admin' para 'master'.
 *
 * Escopo:
 *   1. Firestore — erp_vr/erp_usuarios (campo `data`, JSON)
 *   2. Firebase Auth — custom claim `role`
 *
 * Uso:
 *   node scripts/migrate_admin_to_master.js              → dry-run (nenhuma escrita)
 *   node scripts/migrate_admin_to_master.js --apply      → executa a migração real
 *
 * Pré-requisitos:
 *   - GOOGLE_APPLICATION_CREDENTIALS apontando para service account com permissão
 *     de leitura/escrita em Firestore e Firebase Auth Admin.
 *   - firebase-admin instalado (npm i firebase-admin no diretório raiz ou usar
 *     o node_modules de functions/).
 */

'use strict';

const path  = require('path');
const APPLY = process.argv.includes('--apply');

// ── Detectar firebase-admin ────────────────────────────────────────────────────
let admin;
try {
  admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
} catch (e1) {
  try {
    admin = require('firebase-admin');
  } catch (e2) {
    console.error('❌ firebase-admin não encontrado. Instale com:');
    console.error('   npm i firebase-admin   OU   cd functions && npm install');
    process.exit(1);
  }
}

// ── Inicializar Admin SDK ──────────────────────────────────────────────────────
if (!admin.apps.length) {
  try {
    admin.initializeApp();
    console.log('✅ Admin SDK inicializado via GOOGLE_APPLICATION_CREDENTIALS');
  } catch (e) {
    console.error('❌ Falha ao inicializar Admin SDK:', e.message);
    console.error('   Defina GOOGLE_APPLICATION_CREDENTIALS com o caminho do service account JSON.');
    process.exit(1);
  }
}

const db   = admin.firestore();
const auth = admin.auth();

const COL_ERP   = 'erp_vr';
const DOC_USERS = 'erp_usuarios';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdminRole(v) {
  return typeof v === 'string' && v.toLowerCase() === 'admin';
}

function maskEmail(email) {
  if (!email) return '***';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  const visible = local.length > 2 ? local.slice(0, 2) : local[0] || '*';
  return `${visible}***@${domain}`;
}

// ── PASSO 1 — Migrar Firestore erp_vr/erp_usuarios ───────────────────────────

async function migrateFirestore() {
  console.log('\n─── PASSO 1: Firestore erp_vr/erp_usuarios ─────────────────');

  const docRef = db.collection(COL_ERP).doc(DOC_USERS);
  const snap   = await docRef.get();

  if (!snap.exists) {
    console.log('⚠️  Documento não encontrado — nada a migrar no Firestore.');
    return { found: 0, toMigrate: [] };
  }

  let users;
  try {
    const raw = snap.data()?.data;
    users = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('❌ Falha ao parsear JSON de erp_usuarios:', e.message);
    return { found: 0, toMigrate: [] };
  }

  const toMigrate = users.filter(u => isAdminRole(u.funcao));
  console.log(`   Total de usuários no documento : ${users.length}`);
  console.log(`   Usuários com funcao=="admin"   : ${toMigrate.length}`);

  if (toMigrate.length === 0) {
    console.log('   ✅ Nenhum usuário admin encontrado — Firestore já está limpo.');
    return { found: users.length, toMigrate: [] };
  }

  toMigrate.forEach(u => {
    console.log(`   • ${u.nome || '(sem nome)'} <${maskEmail(u.email)}> funcao="${u.funcao}" → "master"`);
  });

  if (!APPLY) {
    console.log('\n   [DRY-RUN] Nenhuma escrita realizada.');
    return { found: users.length, toMigrate };
  }

  // Aplicar mudança
  let updated = 0;
  users.forEach(u => {
    if (isAdminRole(u.funcao)) {
      u.funcao = 'master';
      updated++;
    }
  });

  await docRef.set({ data: JSON.stringify(users), ts: Date.now() });
  console.log(`   ✅ ${updated} usuário(s) atualizados no Firestore.`);
  return { found: users.length, toMigrate };
}

// ── PASSO 2 — Migrar custom claims no Firebase Auth ──────────────────────────

async function migrateAuthClaims() {
  console.log('\n─── PASSO 2: Firebase Auth custom claims ────────────────────');

  const toMigrate = [];
  let pageToken;

  do {
    const result = await auth.listUsers(1000, pageToken);
    for (const user of result.users) {
      const role = user.customClaims?.role;
      if (isAdminRole(role)) {
        toMigrate.push(user);
      }
    }
    pageToken = result.pageToken;
  } while (pageToken);

  console.log(`   Usuários Auth com claim role=="admin": ${toMigrate.length}`);

  if (toMigrate.length === 0) {
    console.log('   ✅ Nenhuma claim admin encontrada — Auth já está limpo.');
    return { toMigrate: [] };
  }

  toMigrate.forEach(u => {
    console.log(`   • ${u.displayName || '(sem nome)'} <${maskEmail(u.email)}> role="${u.customClaims.role}" → "master"`);
  });

  if (!APPLY) {
    console.log('\n   [DRY-RUN] Nenhuma escrita realizada.');
    return { toMigrate };
  }

  let updated = 0;
  for (const u of toMigrate) {
    const existingClaims = u.customClaims || {};
    await auth.setCustomUserClaims(u.uid, { ...existingClaims, role: 'master' });
    await auth.revokeRefreshTokens(u.uid);
    console.log(`   ✅ ${maskEmail(u.email)} atualizado → role="master" (sessões revogadas)`);
    updated++;
  }

  console.log(`\n   ✅ ${updated} claim(s) atualizadas no Firebase Auth.`);
  return { toMigrate };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mode = APPLY ? '⚠️  APPLY (escrita real)' : '🔍 DRY-RUN (somente leitura)';
  console.log('════════════════════════════════════════════════════════════');
  console.log(' migrate_admin_to_master.js');
  console.log(` Modo: ${mode}`);
  console.log('════════════════════════════════════════════════════════════');

  if (APPLY) {
    console.log('\n⚠️  MODO APPLY ATIVO — as alterações serão gravadas no Firebase.');
    console.log('   Pressione Ctrl+C nos próximos 5 segundos para cancelar.\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  try {
    const fsResult   = await migrateFirestore();
    const authResult = await migrateAuthClaims();

    const totalFirestore = fsResult.toMigrate.length;
    const totalAuth      = authResult.toMigrate.length;

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(' RESUMO');
    console.log('════════════════════════════════════════════════════════════');
    console.log(` Firestore erp_usuarios — registros a migrar : ${totalFirestore}`);
    console.log(` Firebase Auth claims   — contas a migrar    : ${totalAuth}`);
    if (APPLY) {
      console.log(' ✅ Migração concluída.');
    } else {
      console.log('\n Para executar a migração real, rode:');
      console.log('   node scripts/migrate_admin_to_master.js --apply');
    }
    console.log('════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ Erro durante a migração:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  process.exit(0);
}

main();
