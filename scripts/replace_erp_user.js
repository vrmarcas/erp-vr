/**
 * replace_erp_user.js
 * Trata contas "substituídas" (scripts/lib/user_decisions.js -> CONTAS_SUBSTITUIDAS):
 * contas criadas com e-mail incorreto e substituídas por uma conta nova e correta.
 *
 * ESTADO DISTINTO de 'aposentar' — NUNCA deve ser confundido com a aposentadoria
 * de um colaborador que efetivamente se desligou (isso continua sendo escopo
 * exclusivo de scripts/retire_erp_user.js, dirigido por DECISOES_HUMANAS). Este
 * script só enxerga CONTAS_SUBSTITUIDAS e nunca toca em nada listado como
 * 'aposentar'.
 *
 * O que faz com a conta ANTIGA (emailAntigo):
 *   - Desabilita no Firebase Auth (disabled: true) — NUNCA exclui. A exclusão
 *     definitiva fica para uma rodada administrativa futura, separada.
 *   - Revoga refresh tokens.
 *   - Remove o custom claim de role, se existir.
 *   - Remove o documento ativo erp_vr_usuarios/{uid}, se existir.
 *   - Grava um registro de auditoria em erp_vr_substituicao_auditoria/{uid}.
 *   - Idempotente: rodar de novo não falha, só confirma que já está substituída.
 *
 * NÃO cria nem toca a conta NOVA — isso é escopo de create_missing_erp_users.js,
 * sync_role_claims.js e migrate_erp_usuarios_normalizado.js, já dirigidos pela
 * entrada corrigida em DECISOES_HUMANAS.
 *
 * Uso:
 *   node scripts/replace_erp_user.js                                            → dry-run
 *   node scripts/replace_erp_user.js --apply --confirm-project=demo-erp-homolog  → aplica no demo
 *   node scripts/replace_erp_user.js --mock                                     → testes locais
 */
'use strict';

const { CONTAS_SUBSTITUIDAS } = require('./lib/user_decisions');

const APPLY = process.argv.includes('--apply');
const MOCK  = process.argv.includes('--mock');
const CONFIRM_PROJECT_ARG = process.argv.find(a => a.startsWith('--confirm-project='));
const CONFIRM_PROJECT = CONFIRM_PROJECT_ARG ? CONFIRM_PROJECT_ARG.split('=')[1] : null;

// ── Núcleo puro ──────────────────────────────────────────────────────────
function planejarSubstituicao(estadoAtual) {
  // estadoAtual: { disabled, temClaim, temDocAtivo }
  if (estadoAtual.disabled && !estadoAtual.temClaim && !estadoAtual.temDocAtivo) {
    return { acao: 'nenhuma', motivo: 'ja-substituida' };
  }
  return {
    acao: 'substituir',
    desabilitar: !estadoAtual.disabled,
    removerClaim: estadoAtual.temClaim,
    removerDoc: estadoAtual.temDocAtivo,
    revogarTokens: true // sempre revoga, mesmo que já estivesse desabilitada, por segurança
  };
}

function runMockTests() {
  let passed = 0, failed = 0;
  function assert(desc, got, exp) {
    const g = JSON.stringify(got), e = JSON.stringify(exp);
    if (g === e) { console.log('  ✅ ' + desc); passed++; }
    else { console.log('  ❌ ' + desc + ' — esperado ' + e + ', obtido ' + g); failed++; }
  }
  console.log('\n── planejarSubstituicao ─────────────────────────────────────');
  assert('1. conta antiga ativa, com claim e doc -> substitui tudo',
    planejarSubstituicao({disabled:false, temClaim:true, temDocAtivo:true}),
    { acao:'substituir', desabilitar:true, removerClaim:true, removerDoc:true, revogarTokens:true });
  assert('2. já substituída (idempotente) -> nenhuma ação',
    planejarSubstituicao({disabled:true, temClaim:false, temDocAtivo:false}).acao, 'nenhuma');
  assert('3. desabilitada mas ainda com claim residual -> corrige só o que falta',
    planejarSubstituicao({disabled:true, temClaim:true, temDocAtivo:false}),
    { acao:'substituir', desabilitar:false, removerClaim:true, removerDoc:false, revogarTokens:true });
  assert('4. CONTAS_SUBSTITUIDAS aponta exatamente 1 entrada (Paulo Victor)', CONTAS_SUBSTITUIDAS.length, 1);
  assert('5. entrada aponta cortevr@gmail.com -> contato@aprovain.com',
    { antigo: CONTAS_SUBSTITUIDAS[0].emailAntigo, novo: CONTAS_SUBSTITUIDAS[0].emailNovo },
    { antigo: 'cortevr@gmail.com', novo: 'contato@aprovain.com' });
  console.log('\n================================================================\n RESULTADO: ' + passed + ' passed, ' + failed + ' failed\n================================================================\n');
  if (failed) { console.log('Existem testes falhando.'); process.exit(1); }
  console.log('Todos os testes passaram.');
  process.exit(0);
}

async function runReal() {
  if (APPLY && !CONFIRM_PROJECT) { console.error('❌ --apply exige --confirm-project=<projectId>.'); process.exit(1); }
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
    // null: este script só atua sobre CONTAS_SUBSTITUIDAS, não sobre as
    // contas "a criar" de DECISOES_HUMANAS — não faz sentido exigir
    // presença/ausência delas aqui.
    const check = validarEstadoEsperado(allUsers, new Set(norm.docs.map(d=>d.id)), null);
    console.log('=== validação de estado esperado (produção) ===');
    console.log(JSON.stringify(check.resumo));
    if (!check.ok) { console.error('❌ Estado real diverge do esperado — abortando ANTES de qualquer escrita:'); check.erros.forEach(e => console.error('  -', e)); process.exit(1); }
    console.log('✅ estado confere com o esperado — prosseguindo.\n');
  }

  console.log('=== ' + (APPLY ? 'APLICANDO' : 'DRY-RUN — NENHUMA ESCRITA') + ' — projeto: ' + projectId + ' ===\n');

  for (const sub of CONTAS_SUBSTITUIDAS) {
    let authUser;
    try { authUser = await auth.getUserByEmail(sub.emailAntigo); }
    catch (e) { console.log('Conta', sub.emailAntigo, 'não existe no Auth deste projeto — nada a fazer.'); continue; }

    const docRef = db.collection('erp_vr_usuarios').doc(authUser.uid);
    const doc = await docRef.get();

    const estadoAtual = {
      disabled: authUser.disabled,
      temClaim: !!(authUser.customClaims && authUser.customClaims.role),
      temDocAtivo: doc.exists
    };
    const plano = planejarSubstituicao(estadoAtual);
    console.log('Alvo:', sub.nome, '(' + sub.emailAntigo + ' -> ' + sub.emailNovo + ') uid', authUser.uid.slice(0,6)+'…');
    console.log('Estado atual:', JSON.stringify(estadoAtual));

    if (plano.acao === 'nenhuma') { console.log('✅ já está totalmente substituída — idempotência confirmada, nenhuma ação necessária\n'); continue; }

    console.log('Plano:', JSON.stringify(plano));
    if (!APPLY) { console.log(); continue; }

    if (plano.desabilitar) { await auth.updateUser(authUser.uid, { disabled: true }); console.log('✅ conta antiga desabilitada no Auth (NÃO excluída)'); }
    if (plano.removerClaim) { await auth.setCustomUserClaims(authUser.uid, {}); console.log('✅ custom claim de role removido'); }
    if (plano.removerDoc && doc.exists) { await docRef.delete(); console.log('✅ documento normalizado ativo removido (sem acesso ao ERP)'); }
    if (plano.revogarTokens) { await auth.revokeRefreshTokens(authUser.uid); console.log('✅ tokens revogados — nenhuma sessão aberta continua válida'); }

    await db.collection('erp_vr_substituicao_auditoria').doc(authUser.uid).set({
      emailAntigo: sub.emailAntigo, emailNovo: sub.emailNovo, nome: sub.nome, motivo: sub.motivo,
      substituidoEm: new Date().toISOString(), substituidoPor: 'replace_erp_user.js'
    });
    console.log('\n✅ substituição concluída — conta antiga preservada no Auth, desabilitada, sem claim, sem documento ativo, tokens revogados.\n');
  }
  process.exit(0);
}

if (MOCK) runMockTests();
else runReal().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

module.exports = { planejarSubstituicao };
