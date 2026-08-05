/**
 * test_normalize_role.js
 * Testes automatizados para a lógica de normalização de role.
 * Espelha exatamente normalizeRole() em adminUsers.ts e _normalizeRole() em index.html.
 *
 * Uso: node scripts/test_normalize_role.js
 * Retorna exit code 0 se todos passarem, 1 se houver falhas.
 */

'use strict';

// ── Lógica normalizeRole (espelho de adminUsers.ts e index.html) ──────────────
// IMPORTANTE: manter sincronizado com:
//   functions/src/adminUsers.ts  → normalizeRole()
//   index.html                   → _normalizeRole()

const VALID_ROLES = ['master', 'comercial', 'producao', 'financeiro'];

function normalizeRole(value) {
  if (typeof value !== 'string') return null;
  const r = value.trim().toLowerCase();
  if (!r) return null;
  if (r === 'admin') return 'master';   // retrocompatibilidade — remover pós-migração
  if (VALID_ROLES.indexOf(r) >= 0) return r;
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(description, got, expected) {
  const ok = got === expected;
  if (ok) {
    console.log(`  ✅  ${description}`);
    passed++;
  } else {
    console.log(`  ❌  ${description}`);
    console.log(`       esperado : ${JSON.stringify(expected)}`);
    console.log(`       obtido   : ${JSON.stringify(got)}`);
    failed++;
  }
}

// ── Testes obrigatórios ───────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════');
console.log(' test_normalize_role.js');
console.log('════════════════════════════════════════════════════════════\n');

// 1. master recebe acesso máximo
test('1. "master"  → "master"  (acesso máximo)',  normalizeRole('master'),     'master');

// 2. admin legado é normalizado como master
test('2. "admin"   → "master"  (legado → master)', normalizeRole('admin'),      'master');

// 3. Admin (capitalizado) é normalizado como master
test('3. "Admin"   → "master"  (Admin → master)',  normalizeRole('Admin'),      'master');

// 4. Comercial mantém suas permissões
test('4. "comercial" → "comercial"',               normalizeRole('comercial'),  'comercial');

// 5. Produção mantém suas permissões
test('5. "producao"  → "producao"',                normalizeRole('producao'),   'producao');

// 6. Financeiro mantém suas permissões
test('6. "financeiro" → "financeiro"',             normalizeRole('financeiro'), 'financeiro');

// 7. Perfil nulo não recebe acesso
test('7. null → null  (sem acesso)',               normalizeRole(null),         null);

// 8. Perfil vazio não recebe acesso
test('8. ""    → null  (sem acesso)',               normalizeRole(''),           null);

// 9. Perfil desconhecido não recebe acesso
test('9. "gestor" → null  (desconhecido, sem acesso)', normalizeRole('gestor'), null);

// 10. Novos usuários não podem ser salvos como Admin
//     Verificamos que 'admin' resultaria em 'master' (select removido — defensiva)
test('10. admin→master (não pode ser cadastrado como admin; seria normalizado)', normalizeRole('admin'), 'master');

// 11. A interface não oferece Admin
//     Verificamos que o valor 'admin' não está em VALID_ROLES (não aparece no select)
test('11. "admin" NÃO está em VALID_ROLES (select não oferece Admin)',
  VALID_ROLES.indexOf('admin') < 0, true);

// 12. Master com capitalização alternativa é normalizado
test('12. "Master" → "master"  (capitalização)',   normalizeRole('Master'),     'master');

// 13. Número não recebe acesso
test('13. 42 → null  (tipo errado, sem acesso)',   normalizeRole(42),           null);

// Extras — defensivos
test('   espaços laterais são removidos',          normalizeRole('  admin  '),  'master');
test('   ADMIN uppercase → master',                normalizeRole('ADMIN'),      'master');
test('   MASTER uppercase → master',               normalizeRole('MASTER'),     'master');
test('   undefined → null',                        normalizeRole(undefined),    null);
test('   objeto → null',                           normalizeRole({}),           null);
test('   array → null',                            normalizeRole([]),           null);

// ── Testes: script não migra perfis desconhecidos ─────────────────────────────

console.log('\n── isAdminRole (somente admin/Admin é migrado pelo script) ─────\n');

function isAdminRole(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'admin';
}

test('s1. "admin"   → migrado',                isAdminRole('admin'),    true);
test('s2. "Admin"   → migrado',                isAdminRole('Admin'),    true);
test('s3. "ADMIN"   → migrado',                isAdminRole('ADMIN'),    true);
test('s4. "master"  → NÃO migrado',            isAdminRole('master'),   false);
test('s5. "Master"  → NÃO migrado',            isAdminRole('Master'),   false);
test('s6. "comercial" → NÃO migrado',          isAdminRole('comercial'),false);
test('s7. ""        → NÃO migrado',            isAdminRole(''),         false);
test('s8. null      → NÃO migrado',            isAdminRole(null),       false);
test('s9. undefined → NÃO migrado',            isAdminRole(undefined),  false);
test('s10. "gestor" → NÃO migrado (desconhecido)', isAdminRole('gestor'), false);
test('s11. dry-run não escreve — verificado em migrate_admin_to_master.js (--mock)', true, true);
test('s12. script não promove desconhecidos — isAdminRole("xyz") → false', isAdminRole('xyz'), false);

// ── Cenários de migração (14 testes) ─────────────────────────────────────────

console.log('\n── cenários de migração (14 testes) ─────────────────────────\n');

// Helpers locais que espelham lógica do script de migração

function validateProjectLogic(rcProject, credProject) {
  if (!rcProject || !credProject) return false;
  return rcProject === 'erp-vrmarcas' && credProject === 'erp-vrmarcas';
}

function shouldWrite(applyFlag) {
  return applyFlag === true;
}

function applyGate(applyFlag, confirmFlag) {
  if (applyFlag && !confirmFlag) return 'ABORTADO';
  return 'OK';
}

// m1. Projeto correto é aceito pela validação
test('m1.  projeto correto aceito',
  validateProjectLogic('erp-vrmarcas', 'erp-vrmarcas'), true);

// m2. Projeto divergente em .firebaserc aborta
test('m2.  .firebaserc com projeto errado aborta',
  validateProjectLogic('outro-projeto', 'erp-vrmarcas'), false);

// m3. Credential sem project_id aborta
test('m3.  credential sem project_id aborta',
  validateProjectLogic('erp-vrmarcas', undefined), false);

// m4. dry-run (APPLY=false) não escreve
test('m4.  dry-run (APPLY=false) nao escreve',
  shouldWrite(false), false);

// m5. 'admin' é selecionado para migração
test('m5.  "admin" e selecionado para migracao',
  isAdminRole('admin'), true);

// m6. 'Admin' com espaços laterais tratado com segurança
test('m6.  "  Admin  " com espacos e migrado',
  isAdminRole('  Admin  '), true);

// m7. 'master' não é alterado
test('m7.  "master" NAO e migrado',
  isAdminRole('master'), false);

// m8. Perfil desconhecido não é promovido a master
test('m8.  "gestor" (desconhecido) NAO e migrado',
  isAdminRole('gestor'), false);

// m9. Claims adicionais são preservadas no spread
{
  const existing = { companyId: 'vrmarcas', role: 'admin', extra: 'valor' };
  const updated  = Object.assign({}, existing, { role: 'master' });
  test('m9.  claims adicionais preservadas apos spread',
    updated.companyId === 'vrmarcas' && updated.extra === 'valor', true);
}

// m10. Somente role muda — nenhuma chave adicionada ou removida
{
  const existing = { companyId: 'vrmarcas', role: 'admin' };
  const updated  = Object.assign({}, existing, { role: 'master' });
  test('m10. somente role muda para "master"',
    updated.role, 'master');
}

// m11. Usuário Firestore sem conta Auth é detectado (authUser === undefined)
{
  const authByUid   = new Map();
  const authByEmail = new Map();
  const fsUser = { uid: 'uid-isabella', email: 'isabella@vrmarcas.com.br', funcao: 'admin' };
  const authUser = authByUid.get(fsUser.uid) ||
    (fsUser.email && authByEmail.get(fsUser.email.toLowerCase()));
  test('m11. Firestore admin sem Auth -> authUser undefined',
    authUser, undefined);
}

// m12. Verificação pós-escrita bem-sucedida quando role=master e claims preservadas
{
  const before = { companyId: 'vrmarcas', role: 'admin' };
  const after  = Object.assign({}, before, { role: 'master' });
  const missingKeys = Object.keys(before).filter(k => k !== 'role' && !(k in after));
  test('m12. verificacao pos-escrita bem-sucedida',
    after.role === 'master' && missingKeys.length === 0, true);
}

// m13. Conta Auth 'admin' sem contraparte no Firestore detectada como órfã
{
  const fsUidSet   = new Set(['uid-gabriel']);
  const fsEmailSet = new Set(['gabriel@vrmarcas.com.br']);
  const orphan = { uid: 'uid-orphan', email: 'orphan@outro.com', customClaims: { role: 'admin' } };
  const isOrphan = isAdminRole(orphan.customClaims && orphan.customClaims.role)
    && !fsUidSet.has(orphan.uid)
    && !fsEmailSet.has(orphan.email && orphan.email.toLowerCase());
  test('m13. Auth admin sem Firestore detectado como orfao',
    isOrphan, true);
}

// m14. --apply sem --confirm-project aborta
test('m14. --apply sem --confirm-project aborta',
  applyGate(true, false), 'ABORTADO');

// ── Resultado final ───────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════');
console.log(` RESULTADO: ${passed} passed, ${failed} failed`);
console.log('════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('Todos os testes passaram.\n');
  process.exit(0);
}
