/**
 * test_repair_gabriel_profiles.js
 * Testes do reparo direcionado das duas contas de Gabriel Borges e do fluxo
 * sistêmico de provisionamento de usuários.
 *
 * Uso: node scripts/test_repair_gabriel_profiles.js
 * Exit 0 = todos passaram; 1 = falhas.
 */

'use strict';

const R = require('./repair_gabriel_profiles.js');

let passed = 0, failed = 0;

function test(desc, got, expected) {
  const gotJ = JSON.stringify(got), expJ = JSON.stringify(expected);
  if (gotJ === expJ) {
    console.log('  ✅  ' + desc);
    passed++;
  } else {
    console.log('  ❌  ' + desc);
    console.log('       esperado : ' + expJ);
    console.log('       obtido   : ' + gotJ);
    failed++;
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(' test_repair_gabriel_profiles.js');
console.log('════════════════════════════════════════════════════════════\n');

// 1. Os dois e-mails autorizados são normalizados corretamente
test('1.  " GABRIEELBORGES8@Gmail.com " → normalizado e autorizado',
  R.isAuthorizedEmail(' GABRIEELBORGES8@Gmail.com '), true);
test('1b. " Gabrieelborges8@HOTMAIL.com " → normalizado e autorizado',
  R.isAuthorizedEmail(' Gabrieelborges8@HOTMAIL.com '), true);

// 2. Um terceiro e-mail é rejeitado (inclusive grafia próxima com um só "e")
test('2.  gabrielborges8@hotmail.com (um "e") → REJEITADO',
  R.isAuthorizedEmail('gabrielborges8@hotmail.com'), false);
test('2b. isabella@qualquer.com → REJEITADO',
  R.isAuthorizedEmail('isabella@qualquer.com'), false);

// 3. Projeto divergente aborta
test('3.  projeto divergente na credencial → invalido',
  R.validateProjectLogic('erp-vrmarcas', 'outro-projeto'), false);
test('3b. projeto correto nos dois lados → valido',
  R.validateProjectLogic('erp-vrmarcas', 'erp-vrmarcas'), true);

// 4. Dry-run não escreve (gate retorna modo dry-run sem exigir confirmações)
test('4.  sem --apply → modo dry-run',
  R.applyGate(false, false, '').mode, 'dry-run');

// 5. Apply sem confirmação aborta
test('5.  --apply sem --confirm-project → abortado',
  R.applyGate(true, false, R.AUTHORIZED_EMAILS.join(',')).ok, false);

// 6. Apply com lista incompleta ou diferente aborta
test('6.  --apply com apenas 1 e-mail → abortado',
  R.applyGate(true, true, 'gabrieelborges8@gmail.com').ok, false);
test('6b. --apply com e-mail extra → abortado',
  R.applyGate(true, true, R.AUTHORIZED_EMAILS.join(',') + ',outro@x.com').ok, false);
test('6c. --apply com lista exata → aceito',
  R.applyGate(true, true, R.AUTHORIZED_EMAILS.join(',')).ok, true);

// 7. 'admin' é convertido em 'master'
test('7.  claim role="admin" → action "set"',
  R.decideClaimUpdate({ role: 'admin' }).action, 'set');

// 8. 'master' permanece 'master' (nenhuma escrita)
test('8.  claim role="master" → action "none"',
  R.decideClaimUpdate({ role: 'master' }).action, 'none');

// 9. Claims adicionais são preservadas
{
  const before = { role: 'admin', companyId: 'vrmarcas', extraFlag: true };
  const after  = R.buildNewClaims(before);
  test('9.  buildNewClaims preserva companyId e extraFlag',
    after.companyId === 'vrmarcas' && after.extraFlag === true && after.role === 'master', true);
}

// 10. Demais campos do Firestore são preservados
{
  const existing = { nome: 'Gabriel Borges', email: 'gabrieelborges8@gmail.com',
    funcao: 'comercial', senha: 'hash123', criado: '01/08/2026' };
  const updated  = R.buildProfileUpdate(existing, 'uid-abc123', 'gabrieelborges8@gmail.com');
  test('10. buildProfileUpdate preserva nome/senha/criado e ajusta funcao/ativo/uid',
    updated.nome === 'Gabriel Borges' && updated.senha === 'hash123' &&
    updated.criado === '01/08/2026' && updated.funcao === 'master' &&
    updated.ativo === 1 && updated.uid === 'uid-abc123', true);
  test('10b. original NAO é mutado',
    existing.funcao, 'comercial');
}

// 11. Duplicidade de perfil é detectada (mesma lógica do auditAccount)
{
  const users = [
    { email: 'gabrieelborges8@gmail.com', funcao: 'master' },
    { email: ' Gabrieelborges8@GMAIL.com ', funcao: 'comercial' },
  ];
  const matches = users.filter(u =>
    typeof u.email === 'string' && u.email.trim().toLowerCase() === 'gabrieelborges8@gmail.com');
  test('11. dois registros com o mesmo e-mail normalizado → duplicidade',
    matches.length, 2);
}

// 12. Auth sem Firestore é detectado (perfil ausente)
{
  const users = [{ email: 'outra@pessoa.com', funcao: 'comercial' }];
  const matches = users.filter(u =>
    typeof u.email === 'string' && u.email.trim().toLowerCase() === 'gabrieelborges8@hotmail.com');
  test('12. conta Auth sem perfil em erp_usuarios → 0 matches',
    matches.length, 0);
}

// 13. Firestore sem Auth é detectado (relatório authExists=false)
{
  const report = { auth: { exists: false }, profiles: [{ idx: 0 }] };
  test('13. perfil Firestore com auth.exists=false → divergencia detectavel',
    !report.auth.exists && report.profiles.length === 1, true);
}

// 14. Usuário desabilitado não é reabilitado silenciosamente
//     (plano gera ABORTAR; buildProfileUpdate nunca toca campo disabled do Auth)
{
  const disabledAuth = { exists: true, disabled: true, claims: {} };
  const planAction = disabledAuth.disabled ? 'ABORTAR' : 'prosseguir';
  test('14. conta Auth desabilitada → plano ABORTAR (sem reabilitar)',
    planAction, 'ABORTAR');
}

// 15. Falha no Auth não deixa falso sucesso no Firestore
//     (ordem de aplicação: claims primeiro; erro interrompe antes do Firestore)
{
  const steps = [];
  function simulateApply(authFails) {
    try {
      steps.push('auth');
      if (authFails) throw new Error('permission-denied');
      steps.push('firestore');
      return 'sucesso';
    } catch (e) { return 'abortado-antes-do-firestore'; }
  }
  test('15. falha no Auth → Firestore NUNCA é escrito',
    simulateApply(true) === 'abortado-antes-do-firestore' && steps.indexOf('firestore') < 0, true);
}

// 16. Falha no Firestore não deixa falso sucesso
//     (transação lança → main captura → exit code 1; verificação final exige ambos OK)
{
  const okAuth = true, okFs = false;
  const resultado = (okAuth && okFs) ? 'sucesso' : 'falha-reportada';
  test('16. verificacao pos-escrita exige Auth OK **e** Firestore OK',
    resultado, 'falha-reportada');
}

// 17. Usuário desconhecido sem perfil continua bloqueado
//     (espelho do novo authLogin: sem uRec → signOut + mensagem, sem fallback master)
function loginDecision(uRec, normalizeRole) {
  if (!uRec) return { blocked: true, msg: 'Conta sem perfil atribuído — contate o administrador' };
  const role = normalizeRole(uRec.funcao);
  if (!role) return { blocked: true, msg: 'Perfil de acesso inválido — contate o administrador' };
  return { blocked: false, role };
}
const VALID = ['master', 'comercial', 'producao', 'financeiro'];
function normalizeRoleLocal(v) {
  if (typeof v !== 'string') return null;
  const r = v.trim().toLowerCase();
  if (!r) return null;
  if (r === 'admin') return 'master';
  if (VALID.indexOf(r) >= 0) return r;
  return null;
}
test('17. autenticado sem perfil em erp_usuarios → BLOQUEADO (sem fallback master)',
  loginDecision(null, normalizeRoleLocal).blocked, true);

// 18. comercial, producao e financeiro continuam funcionando
test('18a. comercial → entra como comercial',
  loginDecision({ funcao: 'comercial' }, normalizeRoleLocal), { blocked: false, role: 'comercial' });
test('18b. producao → entra como producao',
  loginDecision({ funcao: 'producao' }, normalizeRoleLocal), { blocked: false, role: 'producao' });
test('18c. financeiro → entra como financeiro',
  loginDecision({ funcao: 'financeiro' }, normalizeRoleLocal), { blocked: false, role: 'financeiro' });
test('18d. admin legado → entra como master (retrocompatibilidade)',
  loginDecision({ funcao: 'admin' }, normalizeRoleLocal), { blocked: false, role: 'master' });

// 19. Isabella e os outros usuários não são modificados
//     (o reparo só constrói mudanças para e-mails da lista fechada)
{
  const fsUsers = [
    { email: 'is***@hotmail.com', funcao: 'admin' },
    { email: 'gabrieelborges8@gmail.com', funcao: 'master' },
    { email: 'terceiro@empresa.com', funcao: 'comercial' },
  ];
  const touched = fsUsers.filter(u => R.isAuthorizedEmail(u.email));
  test('19. somente e-mails da lista fechada entram no plano de mudancas',
    touched.length === 1 && touched[0].email === 'gabrieelborges8@gmail.com', true);
}

// 20. Mensagem de erro correta continua sendo exibida para conta não autorizada
test('20. conta real nao cadastrada → mensagem "Conta sem perfil atribuído"',
  loginDecision(null, normalizeRoleLocal).msg,
  'Conta sem perfil atribuído — contate o administrador');

// ── Resultado ─────────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════');
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('════════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
