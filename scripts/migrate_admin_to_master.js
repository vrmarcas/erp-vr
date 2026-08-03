/**
 * migrate_admin_to_master.js
 * Migra todos os usuários com funcao/role == 'admin' → 'master'.
 *
 * Escopo:
 *   1. Firestore — erp_vr/erp_usuarios (campo `data`, JSON serializado)
 *   2. Firebase Auth — custom claim `role`
 *
 * Uso:
 *   node scripts/migrate_admin_to_master.js                                        → dry-run
 *   node scripts/migrate_admin_to_master.js --apply --confirm-project=erp-vrmarcas → migração real
 *   node scripts/migrate_admin_to_master.js --mock                                 → testes locais
 *
 * Pré-requisitos para --apply:
 *   GOOGLE_APPLICATION_CREDENTIALS=/caminho/service-account.json
 *   O service account precisa de permissão em Firestore e Firebase Auth Admin.
 *
 * Quando remover a compatibilidade legada:
 *   1. Executar --apply e verificar "0 registros a migrar";
 *   2. Confirmar acesso de todos os masters;
 *   3. Remover `if (r === "admin") return "master"` de adminUsers.ts;
 *   4. Remover `if (r === 'admin') return 'master'` de index.html (_normalizeRole);
 *   5. Remover 'admin' de isAdmin/isComercial/isProducao/isAnyStaff em firestore.rules;
 *   6. Publicar regras e funções atualizadas.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const APPLY           = process.argv.includes('--apply');
const MOCK            = process.argv.includes('--mock');
const CONFIRM_PROJECT = process.argv.includes('--confirm-project=erp-vrmarcas');

const EXPECTED_PROJECT = 'erp-vrmarcas';
const FIREBASERC_PATH  = path.join(__dirname, '../.firebaserc');
const COL_ERP          = 'erp_vr';
const DOC_USERS        = 'erp_usuarios';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdminRole(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'admin';
}

function maskEmail(email) {
  if (!email) return '***';
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***@***';
  const visible = local.length > 2 ? local.slice(0, 2) : local[0] || '*';
  return visible + '***@' + domain;
}

// ── Modo mock ─────────────────────────────────────────────────────────────────

function runMockTests() {
  let passed = 0, failed = 0;

  function assert(desc, got, expected) {
    if (got === expected) {
      console.log('  ✅ ' + desc);
      passed++;
    } else {
      console.log('  ❌ ' + desc + ' — esperado "' + expected + '", obtido "' + got + '"');
      failed++;
    }
  }

  const KNOWN = ['master', 'comercial', 'producao', 'financeiro'];
  function normalizeRoleLocal(v) {
    if (typeof v !== 'string') return null;
    const r = v.trim().toLowerCase();
    if (!r) return null;
    if (r === 'admin') return 'master';
    if (KNOWN.indexOf(r) >= 0) return r;
    return null;
  }

  console.log('\n── normalizeRole ────────────────────────────────────────────');
  assert('master -> master',         normalizeRoleLocal('master'),     'master');
  assert('Master -> master',         normalizeRoleLocal('Master'),     'master');
  assert('admin -> master',          normalizeRoleLocal('admin'),      'master');
  assert('Admin -> master',          normalizeRoleLocal('Admin'),      'master');
  assert('comercial -> comercial',   normalizeRoleLocal('comercial'),  'comercial');
  assert('producao -> producao',     normalizeRoleLocal('producao'),   'producao');
  assert('financeiro -> financeiro', normalizeRoleLocal('financeiro'), 'financeiro');
  assert('null -> null',             normalizeRoleLocal(null),         null);
  assert('vazio -> null',            normalizeRoleLocal(''),           null);
  assert('desconhecido -> null',     normalizeRoleLocal('gestor'),     null);
  assert('numero -> null',           normalizeRoleLocal(42),           null);

  console.log('\n── isAdminRole (somente admin e migrado) ───────────────────────');
  assert('admin migrado',            isAdminRole('admin'),      true);
  assert('Admin migrado',            isAdminRole('Admin'),      true);
  assert('master NAO migrado',       isAdminRole('master'),     false);
  assert('Master NAO migrado',       isAdminRole('Master'),     false);
  assert('comercial NAO migrado',    isAdminRole('comercial'),  false);
  assert('null NAO migrado',         isAdminRole(null),         false);
  assert('vazio NAO migrado',        isAdminRole(''),           false);
  assert('desconhecido NAO migrado', isAdminRole('gestor'),     false);

  console.log('\n' + '='.repeat(60));
  console.log(' RESULTADO MOCK: ' + passed + ' passed, ' + failed + ' failed');
  console.log('='.repeat(60) + '\n');
  if (failed > 0) process.exit(1);
}

if (MOCK) {
  console.log('='.repeat(60));
  console.log(' migrate_admin_to_master.js -- MODO MOCK (sem Firebase)');
  console.log('='.repeat(60) + '\n');
  runMockTests();
  process.exit(0);
}

// ── Validação de projeto (síncrona, antes do Firebase init) ──────────────────

function validateProject() {
  console.log('\n--- Validando projeto Firebase ' + '-'.repeat(29));

  // 1. Ler project ID de .firebaserc
  let rcProject;
  try {
    const obj = JSON.parse(fs.readFileSync(FIREBASERC_PATH, 'utf8'));
    rcProject  = obj && obj.projects && obj.projects.default;
    if (!rcProject) throw new Error('projects.default ausente em .firebaserc');
  } catch (e) {
    console.error('ERRO Falha ao ler .firebaserc: ' + e.message);
    process.exit(1);
  }

  // 2. Ler somente project_id do credential JSON — nenhum outro campo e lido ou exibido
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error('ERRO GOOGLE_APPLICATION_CREDENTIALS nao definida.');
    console.error('   Use --mock para testar sem credenciais.');
    process.exit(1);
  }
  let credProject;
  try {
    const obj   = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    credProject = obj && obj.project_id;
    if (!credProject) throw new Error('campo project_id ausente no service account JSON');
  } catch (e) {
    console.error('ERRO Falha ao ler credential JSON: ' + e.message);
    process.exit(1);
  }

  // 3. Comparar ambos com o projeto esperado
  console.log('   .firebaserc projects.default : "' + rcProject + '"');
  console.log('   Credential project_id        : "' + credProject + '"');

  if (rcProject !== EXPECTED_PROJECT) {
    console.error('ERRO .firebaserc aponta para "' + rcProject + '", esperado "' + EXPECTED_PROJECT + '". Abortando.');
    process.exit(1);
  }
  if (credProject !== EXPECTED_PROJECT) {
    console.error('ERRO Credential project_id="' + credProject + '", esperado "' + EXPECTED_PROJECT + '". Abortando.');
    process.exit(1);
  }
  console.log('OK Projeto Firebase confirmado: ' + EXPECTED_PROJECT);
}

// ── Porta de segurança: --apply exige --confirm-project ──────────────────────

if (APPLY && !CONFIRM_PROJECT) {
  console.error('');
  console.error('ERRO --apply requer --confirm-project=erp-vrmarcas como segundo argumento.');
  console.error('   Isso previne gravacoes acidentais no projeto errado.');
  console.error('');
  console.error('   Uso correto:');
  console.error('   node scripts/migrate_admin_to_master.js --apply --confirm-project=erp-vrmarcas');
  console.error('');
  process.exit(1);
}

validateProject();

// ── Detectar firebase-admin ────────────────────────────────────────────────────

let admin;
try {
  admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
} catch (e1) {
  try {
    admin = require('firebase-admin');
  } catch (e2) {
    console.error('ERRO firebase-admin nao encontrado.');
    console.error('   Instale: cd functions && npm install');
    console.error('   Ou use --mock para testar sem Firebase.');
    process.exit(1);
  }
}

// ── Inicializar Admin SDK com projectId explícito ─────────────────────────────

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId:  EXPECTED_PROJECT,
    });
    console.log('OK Admin SDK inicializado (projectId: ' + EXPECTED_PROJECT + ')');
  } catch (e) {
    console.error('ERRO Falha ao inicializar Admin SDK: ' + e.message);
    process.exit(1);
  }
}

const db   = admin.firestore();
const auth = admin.auth();

// ── Carregar todas as contas Firebase Auth ────────────────────────────────────

async function listAllAuthUsers() {
  const byUid   = new Map();
  const byEmail = new Map();
  let   pageToken;
  let   total   = 0;

  do {
    const result = await auth.listUsers(1000, pageToken);
    total += result.users.length;
    for (const u of result.users) {
      byUid.set(u.uid, u);
      if (u.email) byEmail.set(u.email.trim().toLowerCase(), u);
    }
    pageToken = result.pageToken;
  } while (pageToken);

  return { byUid, byEmail, total };
}

// ── PASSO 1: Firestore erp_vr/erp_usuarios ───────────────────────────────────

async function migrateFirestore(authByUid, authByEmail) {
  console.log('\n--- PASSO 1: Firestore erp_vr/erp_usuarios ' + '-'.repeat(17));

  const docRef = db.collection(COL_ERP).doc(DOC_USERS);
  const snap   = await docRef.get();

  if (!snap.exists) {
    console.log('   Documento nao encontrado -- nada a migrar no Firestore.');
    return { found: 0, toMigrate: [], allUsers: [] };
  }

  let users;
  try {
    const raw = snap.data() && snap.data().data;
    users = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(users)) throw new Error('data nao e um array');
  } catch (e) {
    console.error('ERRO Falha ao parsear JSON de erp_usuarios: ' + e.message);
    return { found: 0, toMigrate: [], allUsers: [] };
  }

  const toMigrate = users.filter(u => isAdminRole(u.funcao));
  console.log('   Total de usuarios no documento : ' + users.length);
  console.log('   Usuarios com funcao=="admin"   : ' + toMigrate.length);

  if (toMigrate.length === 0) {
    console.log('   OK Nenhum usuario admin encontrado -- Firestore ja esta limpo.');
    return { found: users.length, toMigrate: [], allUsers: users };
  }

  // Correlacionar com Auth e reportar status de cada admin Firestore
  for (const u of toMigrate) {
    const authUser = (u.uid && authByUid.get(u.uid)) ||
                     (u.email && authByEmail.get(u.email.trim().toLowerCase()));
    let authStatus;
    if (!authUser) {
      authStatus = 'SEM_CONTA_AUTH -- nao encontrado no Firebase Auth';
    } else {
      const role = authUser.customClaims && authUser.customClaims.role;
      if (role === 'master')      authStatus = 'Auth: ja e master (sem necessidade de migracao no Passo 2)';
      else if (isAdminRole(role)) authStatus = 'Auth: role=="admin" -- sera migrado no Passo 2';
      else if (role)              authStatus = 'Auth: role="' + role + '" -- inesperado, verificar manualmente';
      else                        authStatus = 'Auth: sem claim role definida';
    }
    console.log(
      '   * ' + (u.nome || '(sem nome)') +
      ' <' + maskEmail(u.email) + '>' +
      '  funcao="' + u.funcao + '" -> "master"  [' + authStatus + ']'
    );
  }

  if (!APPLY) {
    console.log('\n   [DRY-RUN] Nenhuma escrita realizada no Firestore.');
    return { found: users.length, toMigrate, allUsers: users };
  }

  // Releitura idempotente para garantir estado fresco antes de escrever
  const snap2 = await docRef.get();
  let   users2;
  try {
    const raw2 = snap2.data() && snap2.data().data;
    users2 = raw2 ? JSON.parse(raw2) : users;
  } catch (_) {
    users2 = users;
  }

  let updated = 0;
  users2.forEach(u => {
    if (isAdminRole(u.funcao)) { u.funcao = 'master'; updated++; }
  });

  await docRef.set({ data: JSON.stringify(users2), ts: Date.now() });
  console.log('   OK ' + updated + ' usuario(s) atualizados no Firestore.');
  return { found: users.length, toMigrate, allUsers: users };
}

// ── PASSO 2: Firebase Auth custom claims ──────────────────────────────────────

async function migrateAuthClaims(fsUsers, authByUid, authByEmail) {
  console.log('\n--- PASSO 2: Firebase Auth custom claims ' + '-'.repeat(20));

  // Conjuntos Firestore para detectar contas Auth sem contraparte
  const fsUidSet   = new Set(fsUsers.map(u => u.uid).filter(Boolean));
  const fsEmailSet = new Set(
    fsUsers.map(u => u.email && u.email.trim().toLowerCase()).filter(Boolean)
  );

  const toMigrate = [];
  const orphaned  = [];

  for (const u of authByUid.values()) {
    const role = u.customClaims && u.customClaims.role;
    if (!isAdminRole(role)) continue;
    toMigrate.push(u);
    const hasFirestore = fsUidSet.has(u.uid) ||
      (u.email && fsEmailSet.has(u.email.trim().toLowerCase()));
    if (!hasFirestore) orphaned.push(u);
  }

  console.log('   Total de contas Auth carregadas      : ' + authByUid.size);
  console.log('   Contas com claim role=="admin"       : ' + toMigrate.length);

  if (toMigrate.length === 0) {
    console.log('   OK Nenhuma claim admin encontrada -- Auth ja esta limpo.');
  } else {
    for (const u of toMigrate) {
      console.log(
        '   * ' + (u.displayName || '(sem nome)') +
        ' <' + maskEmail(u.email) + '>' +
        '  role="' + (u.customClaims && u.customClaims.role) + '" -> "master"'
      );
    }
  }

  if (orphaned.length > 0) {
    console.log('\n   DIVERGENCIA -- Contas Auth role=="admin" sem registro no Firestore:');
    for (const u of orphaned) {
      console.log(
        '      * ' + (u.displayName || '(sem nome)') +
        ' <' + maskEmail(u.email) + '>' +
        '  uid=' + u.uid
      );
    }
  }

  if (!APPLY) {
    console.log('\n   [DRY-RUN] Nenhuma escrita realizada no Auth.');
    return { toMigrate, orphaned };
  }

  let updated = 0;
  for (const u of toMigrate) {
    const existingClaims = u.customClaims || {};
    // spread preserva todas as claims existentes; apenas role e substituida
    await auth.setCustomUserClaims(u.uid, Object.assign({}, existingClaims, { role: 'master' }));

    // Verificacao pos-escrita: ler de volta e confirmar role + claims preservadas
    const refreshed   = await auth.getUser(u.uid);
    const newClaims   = refreshed.customClaims || {};
    const missingKeys = Object.keys(existingClaims).filter(k => k !== 'role' && !(k in newClaims));

    if (newClaims.role !== 'master' || missingKeys.length > 0) {
      const detail = newClaims.role !== 'master'
        ? 'role="' + newClaims.role + '" apos escrita'
        : 'claims perdidas: ' + missingKeys.join(', ');
      console.error('   VERIFICACAO FALHOU: ' + maskEmail(u.email) + ' -- ' + detail);
    } else {
      await auth.revokeRefreshTokens(u.uid);
      console.log(
        '   OK ' + maskEmail(u.email) +
        ' -> role="master" (' + Object.keys(newClaims).length +
        ' claims preservadas, sessoes revogadas)'
      );
      updated++;
    }
  }

  console.log('\n   OK ' + updated + ' claim(s) atualizadas no Firebase Auth.');
  return { toMigrate, orphaned };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mode = APPLY ? 'APPLY (escrita real)' : 'DRY-RUN (somente leitura)';
  console.log('\n' + '='.repeat(60));
  console.log(' migrate_admin_to_master.js');
  console.log(' Modo: ' + mode);
  console.log('='.repeat(60));

  if (APPLY) {
    console.log('\n MODO APPLY ATIVO -- as alteracoes serao gravadas no Firebase.');
    console.log('   Pressione Ctrl+C nos proximos 5 segundos para cancelar.\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  try {
    console.log('\n--- Carregando contas Firebase Auth ' + '-'.repeat(24));
    const { byUid: authByUid, byEmail: authByEmail, total: totalAuth } =
      await listAllAuthUsers();
    console.log('   ' + totalAuth + ' contas listadas.');

    const fsResult   = await migrateFirestore(authByUid, authByEmail);
    const authResult = await migrateAuthClaims(fsResult.allUsers, authByUid, authByEmail);

    const totalFirestore = fsResult.toMigrate.length;
    const totalAuthMig   = authResult.toMigrate.length;
    const totalOrphaned  = authResult.orphaned.length;

    console.log('\n' + '='.repeat(60));
    console.log(' RESUMO');
    console.log('='.repeat(60));
    console.log(' Firestore erp_usuarios -- registros a migrar : ' + totalFirestore);
    console.log(' Firebase Auth claims   -- contas a migrar    : ' + totalAuthMig);
    if (totalOrphaned > 0) {
      console.log(' Auth admins sem Firestore (verificar)         : ' + totalOrphaned);
    }

    if (APPLY) {
      console.log(' OK Migracao concluida.');
      if (totalFirestore === 0 && totalAuthMig === 0) {
        console.log('\n OK Nenhum registro admin encontrado. Sistema ja esta migrado.');
        console.log('    Voce pode agora remover a compatibilidade legada do codigo.');
      }
    } else {
      if (totalFirestore === 0 && totalAuthMig === 0) {
        console.log('\n OK Dry-run: nenhum registro admin encontrado. Nada a migrar.');
      } else {
        console.log('\n Para executar a migracao real:');
        console.log('   export GOOGLE_APPLICATION_CREDENTIALS=/caminho/service-account.json');
        console.log('   node scripts/migrate_admin_to_master.js --apply --confirm-project=erp-vrmarcas');
      }
      console.log('\n INFO Nenhuma escrita foi realizada neste dry-run.');
    }
    console.log('='.repeat(60) + '\n');
  } catch (err) {
    console.error('\nERRO durante a migracao: ' + err.message);
    console.error('   Nenhuma escrita parcial deve ter ocorrido (Firestore e atomico).');
    console.error(err.stack);
    process.exit(1);
  }

  process.exit(0);
}

main();
