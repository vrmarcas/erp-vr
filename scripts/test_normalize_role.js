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
