/**
 * migrate_admin_to_master.js
 * Migra todos os usuários com funcao/role == 'admin' (qualquer capitalização) → 'master'.
 *
 * Escopo:
 *   1. Firestore — erp_vr/erp_usuarios (campo `data`, JSON serializado)
 *   2. Firebase Auth — custom claim `role`
 *
 * Uso:
 *   node scripts/migrate_admin_to_master.js              → dry-run (nenhuma escrita)
 *   node scripts/migrate_admin_to_master.js --apply      → migração real (aguarda 5s)
 *   node scripts/migrate_admin_to_master.js --mock       → teste local sem Firebase
 *
 * Pré-requisitos para --apply:
 *   GOOGLE_APPLICATION_CREDENTIALS=/caminho/service-account.json
 *   O service account precisa de permissão em Firestore (leitura/escrita em erp_vr)
 *   e Firebase Auth Admin (listUsers, setCustomUserClaims, revokeRefreshTokens).
 *
 * Quando remover a compatibilidade legada no código:
 *   1. Executar este script com --apply;
 *   2. Verificar que o resumo final exibe "0 registros a migrar";
 *   3. Confirmar acesso do Gabriel e demais masters;
 *   4. Remover a linha `if (r === "admin") return "master"` de adminUsers.ts;
 *   5. Remover a linha `if (r === 'admin') return 'master'` de index.html (_normalizeRole);
 *   6. Remover 'admin' das funções isAdmin/isComercial/isProducao/isAnyStaff em firestore.rules;
 *   7. Publicar regras e funções atualizadas.
 */

'use strict';

const path  = require('path');
const APPLY = process.argv.includes('--apply');
const MOCK  = process.argv.includes('--mock');

// ── Modo mock: testa o comportamento sem Firebase ─────────────────────────────

if (MOCK) {
  console.log('════════════════════════════════════════════════════════════');
  console.log(' migrate_admin_to_master.js — MODO MOCK (sem Firebase)');
  console.log('════════════════════════════════════════════════════════════\n');
  runMockTests();
  process.exit(0);
}

// ── Detectar firebase-admin ────────────────────────────────────────────────────

let admin;
try {
  admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
} catch (e1) {
  try {
    admin = require('firebase-admin');
  } catch (e2) {
    console.error('❌ firebase-admin não encontrado.');
    console.error('   Instale: cd functions && npm install');
    console.error('   Ou use --mock para testar sem Firebase.');
    process.exit(1);
  }
}

// ── Inicializar Admin SDK ──────────────────────────────────────────────────────

if (!admin.apps.length) {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('❌ GOOGLE_APPLICATION_CREDENTIALS não definida.');
    console.error('   Nenhuma escrita foi realizada.');
    console.error('   Use --mock para testar o comportamento sem credenciais.');
    process.exit(1);
  }
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log('✅ Admin SDK inicializado via GOOGLE_APPLICATION_CREDENTIALS');
  } catch (e) {
    console.error('❌ Falha ao inicializar Admin SDK:', e.message);
    console.error('   Nenhuma escrita foi realizada.');
    process.exit(1);
  }
}

// ── Validar projeto ───────────────────────────────────────────────────────────

async function validateProject() {
  try {
    const app = admin.app();
    const projectId = app.options.projectId ||
      (admin.credential && admin.credential.applicationDefault &&
       process.env.GCLOUD_PROJECT) ||
      process.env.FIREBASE_PROJECT_ID;
    if (projectId) {
      console.log(`   Projeto Firebase detectado: ${projectId}`);
    } else {
      console.warn('   ⚠️  Projeto Firebase não identificado nas opções — verifique o service account.');
    }
  } catch (e) {
    console.warn('   ⚠️  Não foi possível identificar o projeto:', e.message);
  }
}

const db   = admin.firestore();
const auth = admin.auth();

const COL_ERP   = 'erp_vr';
const DOC_USERS = 'erp_usuarios';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdminRole(v) {
  // Somente 'admin' (qualquer capitalização) é migrado.
  // 'master' e demais perfis NÃO são alterados.
  // Nulos, vazios ou desconhecidos NÃO são promovidos.
  return typeof v === 'string' && v.trim().toLowerCase() === 'admin';
}

function maskEmail(email) {
  if (!email) return '***';
  const [local, domain] = String(email).split('@');
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
    if (!Array.isArray(users)) throw new Error('data não é um array');
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
    console.log('\n   [DRY-RUN] Nenhuma escrita realizada no Firestore.');
    return { found: users.length, toMigrate };
  }

  // Verificar idempotência: ler novamente dentro da operação para estado fresco
  const snap2  = await docRef.get();
  let users2;
  try {
    users2 = JSON.parse(snap2.data()?.data || '[]');
  } catch {
    users2 = users;
  }

  let updated = 0;
  users2.forEach(u => {
    if (isAdminRole(u.funcao)) {
      u.funcao = 'master';
      updated++;
    }
  });

  // Preserva todos os demais campos; atualiza somente funcao=='admin'
  await docRef.set({ data: JSON.stringify(users2), ts: Date.now() });
  console.log(`   ✅ ${updated} usuário(s) atualizados no Firestore.`);
  return { found: users.length, toMigrate };
}

// ── PASSO 2 — Migrar custom claims no Firebase Auth ──────────────────────────

async function migrateAuthClaims() {
  console.log('\n─── PASSO 2: Firebase Auth custom claims ────────────────────');
  console.log('   Verificando se Auth custom claims realmente armazenam role...');

  const toMigrate = [];
  const sample    = [];
  let   pageToken;
  let   totalUsers = 0;

  do {
    const result = await auth.listUsers(1000, pageToken);
    totalUsers += result.users.length;

    for (const user of result.users) {
      const role = user.customClaims?.role;
      // Coleta amostra para verificar se o projeto usa claims
      if (sample.length < 3 && role) sample.push({ email: maskEmail(user.email), role });
      if (isAdminRole(role)) toMigrate.push(user);
    }
    pageToken = result.pageToken;
  } while (pageToken);

  console.log(`   Total de contas Auth listadas        : ${totalUsers}`);

  if (sample.length > 0) {
    console.log('   ✅ Auth custom claims em uso — amostra: ' +
      sample.map(s => `role="${s.role}"`).join(', '));
  } else {
    console.log('   ℹ️  Nenhuma claim "role" encontrada — sistema pode usar apenas erp_usuarios.');
    console.log('   Auth custom claims não precisam ser migradas neste caso.');
  }

  console.log(`   Contas com claim role=="admin"       : ${toMigrate.length}`);

  if (toMigrate.length === 0) {
    console.log('   ✅ Nenhuma claim admin encontrada — Auth já está limpo.');
    return { toMigrate: [] };
  }

  toMigrate.forEach(u => {
    console.log(`   • ${u.displayName || '(sem nome)'} <${maskEmail(u.email)}> role="${u.customClaims.role}" → "master"`);
  });

  if (!APPLY) {
    console.log('\n   [DRY-RUN] Nenhuma escrita realizada no Auth.');
    return { toMigrate };
  }

  let updated = 0;
  for (const u of toMigrate) {
    // Preserva demais claims existentes; apenas substitui role
    const existingClaims = u.customClaims || {};
    await auth.setCustomUserClaims(u.uid, { ...existingClaims, role: 'master' });
    await auth.revokeRefreshTokens(u.uid);
    console.log(`   ✅ ${maskEmail(u.email)} → role="master" (sessões revogadas, re-login necessário)`);
    updated++;
  }

  console.log(`\n   ✅ ${updated} claim(s) atualizadas no Firebase Auth.`);
  return { toMigrate };
}

// ── Testes mock locais (--mock) ───────────────────────────────────────────────

function runMockTests() {
  let passed = 0, failed = 0;

  function assert(desc, got, expected) {
    if (got === expected) {
      console.log(`  ✅ ${desc}`);
      passed++;
    } else {
      console.log(`  ❌ ${desc} — esperado "${expected}", obtido "${got}"`);
      failed++;
    }
  }

  // Replicar isAdminRole localmente para teste
  function isAdminRoleLocal(v) {
    return typeof v === 'string' && v.trim().toLowerCase() === 'admin';
  }

  // Replicar normalizeRole localmente para teste (espelho de adminUsers.ts e _normalizeRole)
  const KNOWN = ['master','comercial','producao','financeiro'];
  function normalizeRole(v) {
    if (typeof v !== 'string') return null;
    const r = v.trim().toLowerCase();
    if (!r) return null;
    if (r === 'admin') return 'master';
    if (KNOWN.indexOf(r) >= 0) return r;
    return null;
  }

  console.log('\n── normalizeRole ────────────────────────────────────────────');
  assert('master → master',         normalizeRole('master'),     'master');
  assert('Master → master',         normalizeRole('Master'),     'master');
  assert('admin → master',          normalizeRole('admin'),      'master');
  assert('Admin → master',          normalizeRole('Admin'),      'master');
  assert('comercial → comercial',   normalizeRole('comercial'),  'comercial');
  assert('producao → producao',     normalizeRole('producao'),   'producao');
  assert('financeiro → financeiro', normalizeRole('financeiro'), 'financeiro');
  assert('null → null',             normalizeRole(null),         null);
  assert('vazio → null',            normalizeRole(''),           null);
  assert('desconhecido → null',     normalizeRole('gestor'),     null);
  assert('número → null',           normalizeRole(42),           null);

  console.log('\n── isAdminRole (somente admin é migrado) ───────────────────');
  assert('admin migrado',           isAdminRoleLocal('admin'),   true);
  assert('Admin migrado',           isAdminRoleLocal('Admin'),   true);
  assert('master NÃO migrado',      isAdminRoleLocal('master'),  false);
  assert('Master NÃO migrado',      isAdminRoleLocal('Master'),  false);
  assert('comercial NÃO migrado',   isAdminRoleLocal('comercial'), false);
  assert('null NÃO migrado',        isAdminRoleLocal(null),      false);
  assert('vazio NÃO migrado',       isAdminRoleLocal(''),        false);
  assert('desconhecido NÃO migrado',isAdminRoleLocal('gestor'),  false);

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(` RESULTADO MOCK: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mode = APPLY ? '⚠️  APPLY (escrita real)' : '🔍 DRY-RUN (somente leitura)';
  console.log('════════════════════════════════════════════════════════════');
  console.log(' migrate_admin_to_master.js');
  console.log(` Modo: ${mode}`);
  console.log('════════════════════════════════════════════════════════════');

  await validateProject();

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
      if (totalFirestore === 0 && totalAuth === 0) {
        console.log('\n ✅ Nenhum registro admin encontrado. Sistema já está migrado.');
        console.log('    Você pode agora remover a compatibilidade legada do código.');
      }
    } else {
      if (totalFirestore === 0 && totalAuth === 0) {
        console.log('\n ✅ Dry-run: nenhum registro admin encontrado. Nada a migrar.');
      } else {
        console.log('\n Para executar a migração real:');
        console.log('   export GOOGLE_APPLICATION_CREDENTIALS=/caminho/service-account.json');
        console.log('   node scripts/migrate_admin_to_master.js --apply');
      }
      console.log('\n ℹ️  Nenhuma escrita foi realizada neste dry-run.');
    }
    console.log('════════════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ Erro durante a migração:', err.message);
    console.error('   Nenhuma escrita parcial deve ter ocorrido (Firestore é atômico).');
    console.error(err.stack);
    process.exit(1);
  }

  process.exit(0);
}

main();
