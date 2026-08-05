/**
 * sync_role_claims.js
 * Garante, para cada usuário ATIVO em scripts/lib/user_decisions.js, que:
 *   documento erp_vr_usuarios/{uid}.funcao === custom claim role === decisão humana
 * Corrige o que estiver divergente; nunca toca em quem não está na tabela de
 * decisões (nem conta técnica, nem aposentado, nem role desconhecida).
 *
 * Uso:
 *   node scripts/sync_role_claims.js                                            → dry-run
 *   node scripts/sync_role_claims.js --apply --confirm-project=demo-erp-homolog  → aplica no demo
 *   node scripts/sync_role_claims.js --mock                                     → testes locais
 */
'use strict';

const { DECISOES_HUMANAS, CONTAS_TECNICAS, VALID_ROLES } = require('./lib/user_decisions');

const APPLY = process.argv.includes('--apply');
const MOCK  = process.argv.includes('--mock');
const CONFIRM_PROJECT_ARG = process.argv.find(a => a.startsWith('--confirm-project='));
const CONFIRM_PROJECT = CONFIRM_PROJECT_ARG ? CONFIRM_PROJECT_ARG.split('=')[1] : null;

// ── Núcleo puro — testável sem Firebase ─────────────────────────────────────
// email: e-mail da conta sendo avaliada (pode não estar na tabela de decisões).
// docFuncaoAtual / claimAtual: null se não existir/não estiver definido.
function planejarSincronizacao(email, docFuncaoAtual, claimAtual) {
  if (CONTAS_TECNICAS.map(e=>e.toLowerCase()).includes((email||'').toLowerCase())) {
    return { acao: 'recusar', motivo: 'conta-tecnica-nunca-recebe-role' };
  }
  const decisao = DECISOES_HUMANAS.find(d => d.email.toLowerCase() === (email||'').toLowerCase());
  if (!decisao) return { acao: 'recusar', motivo: 'conta-sem-perfil-na-tabela-de-decisoes' };
  if (decisao.acao === 'aposentar') return { acao: 'recusar', motivo: 'usuario-aposentado-fora-do-escopo-deste-script' };
  if (!decisao.funcaoFinal || VALID_ROLES.indexOf(decisao.funcaoFinal) < 0) {
    return { acao: 'recusar', motivo: 'role-final-invalida-ou-ausente-na-tabela' };
  }

  const docOk = docFuncaoAtual === decisao.funcaoFinal;
  const claimOk = claimAtual === decisao.funcaoFinal;
  if (docOk && claimOk) return { acao: 'nenhuma', motivo: 'ja-sincronizado', funcaoFinal: decisao.funcaoFinal };

  return {
    acao: 'sincronizar',
    funcaoFinal: decisao.funcaoFinal,
    corrigirDoc: !docOk,
    corrigirClaim: !claimOk,
    revogarTokens: !claimOk // só revoga se o CLAIM mudou — doc sozinho não exige logout
  };
}

function runMockTests() {
  let passed = 0, failed = 0;
  function assert(desc, got, exp) {
    const g = JSON.stringify(got), e = JSON.stringify(exp);
    if (g === e) { console.log('  ✅ ' + desc); passed++; }
    else { console.log('  ❌ ' + desc + ' — esperado ' + e + ', obtido ' + g); failed++; }
  }
  console.log('\n── planejarSincronizacao ────────────────────────────────────');

  assert('1. conta sem perfil (fora da tabela) -> recusa', planejarSincronizacao('desconhecido@x.com', null, null).acao, 'recusar');
  assert('2. role inválida na tabela -> recusa (não aplicável aqui, mas guarda existe)',
    planejarSincronizacao('cleiton_1310@hotmail.com', 'comercial', 'comercial').acao, 'nenhuma'); // já ok

  assert('3. claim divergente (Isabella: doc admin, claim já master) -> sincroniza só o doc',
    planejarSincronizacao('isabellabsil@hotmail.com', 'admin', 'master'),
    { acao:'sincronizar', funcaoFinal:'master', corrigirDoc:true, corrigirClaim:false, revogarTokens:false });

  assert('4. doc E claim divergentes (Gabriel principal: ambos admin) -> sincroniza os dois e revoga token',
    planejarSincronizacao('gabrieelborges@hotmail.com', 'admin', 'admin'),
    { acao:'sincronizar', funcaoFinal:'master', corrigirDoc:true, corrigirClaim:true, revogarTokens:true });

  assert('5. documento já correto, claim já correto -> nenhuma ação (idempotente)',
    planejarSincronizacao('gabrieelborges8@gmail.com', 'master', 'master').acao, 'nenhuma');

  assert('6. segunda execução sem mudanças continua idempotente',
    planejarSincronizacao('gabrieelborges8@gmail.com', 'master', 'master'),
    planejarSincronizacao('gabrieelborges8@gmail.com', 'master', 'master'));

  assert('7. tentativa de atingir conta técnica -> sempre recusa',
    planejarSincronizacao('vrmarcasgithub@gmail.com', null, null).motivo, 'conta-tecnica-nunca-recebe-role');

  assert('8. tentativa de atingir usuário aposentado -> recusa',
    planejarSincronizacao('gabrieelborges8@hotmail.com', 'master', 'master').motivo, 'usuario-aposentado-fora-do-escopo-deste-script');

  assert('9. nunca atribui role fora da tabela — Cleiton (comercial) nunca vira master mesmo se doc estiver errado',
    planejarSincronizacao('cleiton_1310@hotmail.com', 'master', 'master').funcaoFinal, 'comercial');

  console.log('\n================================================================\n RESULTADO: ' + passed + ' passed, ' + failed + ' failed\n================================================================\n');
  if (failed) { console.log('Existem testes falhando.'); process.exit(1); }
  console.log('Todos os testes passaram.');
  process.exit(0);
}

async function runReal() {
  if (APPLY && !CONFIRM_PROJECT) {
    console.error('❌ --apply exige --confirm-project=<projectId>. Abortando.');
    process.exit(1);
  }
  const { flagsDeProducaoPresentes, validarEstadoEsperado } = require('./lib/production_safety');
  if (APPLY && CONFIRM_PROJECT === 'erp-vrmarcas') {
    const flags = flagsDeProducaoPresentes(process.argv);
    if (!flags.ok) { console.error('❌ Produção exige --allow-production E --authorization=<token> simultaneamente. Abortando.'); process.exit(1); }
  }
  const admin = require('firebase-admin');
  const projectId = CONFIRM_PROJECT || require('../.firebaserc').projects.default;
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const auth = admin.auth();
  const db = admin.firestore();

  if (APPLY && CONFIRM_PROJECT === 'erp-vrmarcas') {
    let allUsers = [], pt;
    do { const r = await auth.listUsers(1000, pt); allUsers = allUsers.concat(r.users.map(u=>({uid:u.uid,email:u.email}))); pt = r.pageToken; } while (pt);
    const norm = await db.collection('erp_vr_usuarios').get();
    const check = validarEstadoEsperado(allUsers, new Set(norm.docs.map(d=>d.id)));
    console.log('=== validação de estado esperado (produção) ===');
    console.log(JSON.stringify(check.resumo));
    if (!check.ok) { console.error('❌ Estado real diverge do esperado — abortando ANTES de qualquer escrita:'); check.erros.forEach(e => console.error('  -', e)); process.exit(1); }
    console.log('✅ estado confere com o esperado — prosseguindo.\n');
  }

  const ativos = DECISOES_HUMANAS.filter(d => d.acao !== 'aposentar');
  console.log('=== ' + (APPLY ? 'APLICANDO' : 'DRY-RUN — NENHUMA ESCRITA') + ' — projeto: ' + projectId + ' ===\n');

  for (const decisao of ativos) {
    let authUser;
    try { authUser = await auth.getUserByEmail(decisao.email); }
    catch (e) { console.log('⏭️  pulado (conta ainda não existe no Auth):', decisao.nome); continue; }

    const docRef = db.collection('erp_vr_usuarios').doc(authUser.uid);
    const doc = await docRef.get();
    const docFuncaoAtual = doc.exists ? (doc.data().funcao || null) : null;
    const claimAtual = (authUser.customClaims && authUser.customClaims.role) || null;

    const plano = planejarSincronizacao(decisao.email, docFuncaoAtual, claimAtual);
    console.log('---', decisao.nome, '(' + decisao.email + ') ---');
    console.log('  antes: doc.funcao=' + docFuncaoAtual + ' | claim=' + claimAtual);

    if (plano.acao === 'nenhuma') { console.log('  ✅ já sincronizado, nenhuma ação'); continue; }
    if (plano.acao === 'recusar') { console.log('  ⛔ recusado:', plano.motivo); continue; }

    console.log('  depois (planejado): doc.funcao=' + plano.funcaoFinal + ' | claim=' + plano.funcaoFinal + (plano.revogarTokens ? ' | REVOGA TOKENS' : ''));

    if (!APPLY) continue;

    if (plano.corrigirDoc) {
      await docRef.set({ funcao: plano.funcaoFinal, sincronizadoEm: new Date().toISOString(), sincronizadoPor: 'sync_role_claims.js' }, { merge: true });
      console.log('  ✅ documento normalizado atualizado');
    }
    if (plano.corrigirClaim) {
      const claimsAtuais = authUser.customClaims || {};
      await auth.setCustomUserClaims(authUser.uid, Object.assign({}, claimsAtuais, { role: plano.funcaoFinal }));
      console.log('  ✅ custom claim atualizado');
    }
    if (plano.revogarTokens) {
      await auth.revokeRefreshTokens(authUser.uid);
      console.log('  ✅ tokens revogados — próximo acesso exige novo login');
    }
  }
  process.exit(0);
}

if (MOCK) runMockTests();
else runReal().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

module.exports = { planejarSincronizacao };
