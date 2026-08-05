/**
 * create_missing_erp_users.js
 * Cria, uma conta por vez, as contas Auth ainda ausentes para os perfis
 * confirmados em scripts/lib/user_decisions.js (acao === 'criar-conta').
 *
 * Segurança:
 *   - NUNCA define senha na criação (Admin SDK cria a conta sem senha —
 *     signInWithEmailAndPassword falha até o usuário definir uma).
 *   - Usa auth.generatePasswordResetLink(email) para provar que o fluxo
 *     oficial de definição de senha funciona, mas NUNCA imprime, loga,
 *     grava em arquivo ou devolve o link em si — só um booleano de sucesso.
 *     Em produção, o link real deve ser enviado por e-mail via o fluxo do
 *     próprio Firebase Auth (client SDK sendPasswordResetEmail), nunca
 *     copiado/colado por um operador.
 *   - Se o e-mail já existir no Auth, ABORTA essa conta específica sem
 *     sobrescrever nada — exige nova conciliação humana antes de prosseguir.
 *   - Idempotente: rodar de novo não recria nem falha as que já existem —
 *     só pula, reportando que já existem.
 *
 * Uso:
 *   node scripts/create_missing_erp_users.js                                            → dry-run
 *   node scripts/create_missing_erp_users.js --apply --confirm-project=demo-erp-homolog  → cria no demo
 *   node scripts/create_missing_erp_users.js --mock                                      → testes locais
 */
'use strict';

const { DECISOES_HUMANAS } = require('./lib/user_decisions');

const APPLY = process.argv.includes('--apply');
const MOCK  = process.argv.includes('--mock');
const CONFIRM_PROJECT_ARG = process.argv.find(a => a.startsWith('--confirm-project='));
const CONFIRM_PROJECT = CONFIRM_PROJECT_ARG ? CONFIRM_PROJECT_ARG.split('=')[1] : null;

// ── Núcleo puro: decide o que fazer para 1 decisão, dado se o e-mail já
// existe no Auth. Testável sem Firebase. ────────────────────────────────────
function planejarCriacao(decisao, jaExisteNoAuth) {
  if (decisao.acao !== 'criar-conta') return { acao: 'ignorar', motivo: 'nao-e-criar-conta' };
  if (jaExisteNoAuth) return { acao: 'abortar-conciliacao', motivo: 'email-ja-existe-no-auth-fora-do-esperado' };
  return { acao: 'criar', email: decisao.email, nome: decisao.nome, funcaoFinal: decisao.funcaoFinal };
}

function runMockTests() {
  let passed = 0, failed = 0;
  function assert(desc, got, exp) {
    const g = JSON.stringify(got), e = JSON.stringify(exp);
    if (g === e) { console.log('  ✅ ' + desc); passed++; }
    else { console.log('  ❌ ' + desc + ' — esperado ' + e + ', obtido ' + g); failed++; }
  }
  console.log('\n── planejarCriacao ──────────────────────────────────────────');
  assert('1. conta a criar, e-mail livre -> cria', planejarCriacao({acao:'criar-conta', email:'x@y.com', nome:'X', funcaoFinal:'comercial'}, false).acao, 'criar');
  assert('2. conta a criar, e-mail já existe -> aborta (não sobrescreve)', planejarCriacao({acao:'criar-conta', email:'x@y.com'}, true).acao, 'abortar-conciliacao');
  assert('3. decisão que não é criar-conta -> ignora', planejarCriacao({acao:'normalizar-existente'}, false).acao, 'ignorar');
  console.log('\n================================================================\n RESULTADO: ' + passed + ' passed, ' + failed + ' failed\n================================================================\n');
  if (failed) { console.log('Existem testes falhando.'); process.exit(1); }
  console.log('Todos os testes passaram.');
  process.exit(0);
}

async function runReal() {
  if (APPLY && !CONFIRM_PROJECT) {
    console.error('❌ --apply exige --confirm-project=<projectId>. Abortando (nenhuma escrita feita).');
    process.exit(1);
  }
  const { flagsDeProducaoPresentes, validarEstadoEsperado, initializeAppComModoCorreto } = require('./lib/production_safety');
  if (APPLY && CONFIRM_PROJECT === 'erp-vrmarcas') {
    const flags = flagsDeProducaoPresentes(process.argv);
    if (!flags.ok) { console.error('❌ Produção exige --allow-production E --authorization=<token> simultaneamente. Abortando.'); process.exit(1); }
  }
  const admin = require('firebase-admin');
  const projectId = CONFIRM_PROJECT || require('../.firebaserc').projects.default;
  initializeAppComModoCorreto(admin, projectId, process.argv);
  const auth = admin.auth();
  const db = admin.firestore();

  if (APPLY && CONFIRM_PROJECT === 'erp-vrmarcas') {
    let allUsers = [], pt;
    do { const r = await auth.listUsers(1000, pt); allUsers = allUsers.concat(r.users.map(u=>({uid:u.uid,email:u.email}))); pt = r.pageToken; } while (pt);
    const norm = await db.collection('erp_vr_usuarios').get();
    const check = validarEstadoEsperado(allUsers, new Set(norm.docs.map(d=>d.id)), false);
    console.log('=== validação de estado esperado (produção) ===');
    console.log(JSON.stringify(check.resumo));
    if (!check.ok) { console.error('❌ Estado real diverge do esperado — abortando ANTES de qualquer escrita:'); check.erros.forEach(e => console.error('  -', e)); process.exit(1); }
    console.log('✅ estado confere com o esperado — prosseguindo.\n');
  }

  const alvos = DECISOES_HUMANAS.filter(d => d.acao === 'criar-conta');
  console.log('=== ' + (APPLY ? 'APLICANDO' : 'DRY-RUN — NENHUMA ESCRITA') + ' — projeto: ' + projectId + ' ===\n');

  for (const decisao of alvos) {
    let jaExiste = false, uidExistente = null;
    try { const u = await auth.getUserByEmail(decisao.email); jaExiste = true; uidExistente = u.uid; } catch (e) { /* não existe, esperado */ }

    const plano = planejarCriacao(decisao, jaExiste);
    if (plano.acao === 'abortar-conciliacao') {
      console.log('⛔ ABORTADO —', decisao.nome, '(' + decisao.email + '): já existe no Auth (uid ' + uidExistente.slice(0,6) + '…) mas a decisão esperava criar uma conta nova. Exige nova conciliação humana antes de prosseguir — nada foi feito.');
      continue;
    }

    if (!APPLY) {
      console.log('[dry-run] criaria conta:', decisao.nome, '(' + decisao.email + ') -> role final:', decisao.funcaoFinal);
      continue;
    }

    try {
      const novoUser = await auth.createUser({ email: decisao.email, emailVerified: false, disabled: false, displayName: decisao.nome });
      console.log('✅ conta criada:', decisao.nome, '-> uid', novoUser.uid.slice(0,6) + '… (SEM senha definida)');

      // Prova que o fluxo oficial de redefinição funciona, sem nunca expor o link.
      let linkGerado = false;
      try { await auth.generatePasswordResetLink(decisao.email); linkGerado = true; } catch (e) { linkGerado = false; }
      console.log('   fluxo oficial de definição de senha: ' + (linkGerado ? 'OK (link gerado, não exibido)' : 'FALHOU'));

      // Marca no Firestore erp_vr_usuarios_pendentes/{uid} — NÃO é o documento
      // ativo final (isso é escopo do migrate_erp_usuarios_normalizado.js,
      // rodado depois, com o claim já sincronizado). Aqui só registramos que
      // a conta foi criada por este processo, para auditoria.
      await db.collection('erp_vr_criacao_auditoria').doc(novoUser.uid).set({
        email: decisao.email, nome: decisao.nome, funcaoPlanejada: decisao.funcaoFinal,
        criadoEm: new Date().toISOString(), criadoPor: 'create_missing_erp_users.js',
        senhaDefinidaPeloUsuario: false
      });
    } catch (e) {
      console.error('❌ falha ao criar', decisao.nome, ':', e.message);
    }
  }
  process.exit(0);
}

if (MOCK) runMockTests();
else runReal().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

module.exports = { planejarCriacao };
