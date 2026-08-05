/**
 * retire_erp_user.js
 * Aposenta com segurança a conta marcada como acao:'aposentar' em
 * scripts/lib/user_decisions.js (hoje: gabrieelborges8@hotmail.com).
 *
 * O que faz:
 *   - Desabilita a conta no Firebase Auth (disabled: true) — NUNCA exclui.
 *   - Revoga os refresh tokens — sessões já abertas param de funcionar.
 *   - Remove o custom claim de role, se existir.
 *   - Garante que NÃO existe documento ativo em erp_vr_usuarios/{uid}.
 *   - Idempotente: rodar de novo não falha, só confirma que já está aposentada.
 *   - Reversível: --reactivate reverte tudo (reabilita a conta) — é uma
 *     operação administrativa explícita e separada, nunca o caminho padrão.
 *
 * Uso:
 *   node scripts/retire_erp_user.js                                            → dry-run
 *   node scripts/retire_erp_user.js --apply --confirm-project=demo-erp-homolog  → aplica no demo
 *   node scripts/retire_erp_user.js --apply --confirm-project=demo-erp-homolog --reactivate → reverte no demo
 *   node scripts/retire_erp_user.js --mock                                     → testes locais
 */
'use strict';

const { DECISOES_HUMANAS } = require('./lib/user_decisions');

const APPLY = process.argv.includes('--apply');
const MOCK  = process.argv.includes('--mock');
const REACTIVATE = process.argv.includes('--reactivate');
const CONFIRM_PROJECT_ARG = process.argv.find(a => a.startsWith('--confirm-project='));
const CONFIRM_PROJECT = CONFIRM_PROJECT_ARG ? CONFIRM_PROJECT_ARG.split('=')[1] : null;

const ALVO = DECISOES_HUMANAS.find(d => d.acao === 'aposentar');

// ── Núcleo puro ──────────────────────────────────────────────────────────
function planejarAposentadoria(estadoAtual) {
  // estadoAtual: { disabled, temClaim, temDocAtivo }
  if (estadoAtual.disabled && !estadoAtual.temClaim && !estadoAtual.temDocAtivo) {
    return { acao: 'nenhuma', motivo: 'ja-aposentada' };
  }
  return {
    acao: 'aposentar',
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
  console.log('\n── planejarAposentadoria ────────────────────────────────────');
  assert('1. conta ativa, com claim e doc -> aposenta tudo',
    planejarAposentadoria({disabled:false, temClaim:true, temDocAtivo:true}),
    { acao:'aposentar', desabilitar:true, removerClaim:true, removerDoc:true, revogarTokens:true });
  assert('2. já aposentada (idempotente) -> nenhuma ação',
    planejarAposentadoria({disabled:true, temClaim:false, temDocAtivo:false}).acao, 'nenhuma');
  assert('3. desabilitada mas ainda com claim residual -> corrige só o que falta',
    planejarAposentadoria({disabled:true, temClaim:true, temDocAtivo:false}),
    { acao:'aposentar', desabilitar:false, removerClaim:true, removerDoc:false, revogarTokens:true });
  console.log('\n================================================================\n RESULTADO: ' + passed + ' passed, ' + failed + ' failed\n================================================================\n');
  if (failed) { console.log('Existem testes falhando.'); process.exit(1); }
  console.log('Todos os testes passaram.');
  process.exit(0);
}

async function runReal() {
  if (APPLY && !CONFIRM_PROJECT) { console.error('❌ --apply exige --confirm-project=<projectId>.'); process.exit(1); }
  if (APPLY && CONFIRM_PROJECT === 'erp-vrmarcas') { console.error('❌ Esta rodada NÃO autoriza aposentar contas em produção.'); process.exit(1); }
  const admin = require('firebase-admin');
  const projectId = CONFIRM_PROJECT || require('../.firebaserc').projects.default;
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const auth = admin.auth();
  const db = admin.firestore();

  let authUser;
  try { authUser = await auth.getUserByEmail(ALVO.email); }
  catch (e) { console.log('Conta', ALVO.email, 'não existe no Auth deste projeto — nada a fazer.'); process.exit(0); }

  const docRef = db.collection('erp_vr_usuarios').doc(authUser.uid);
  const doc = await docRef.get();

  if (REACTIVATE) {
    console.log('=== REATIVAÇÃO (operação administrativa explícita) — projeto:', projectId, '===');
    if (!APPLY) { console.log('[dry-run] reativaria a conta', ALVO.email); process.exit(0); }
    await auth.updateUser(authUser.uid, { disabled: false });
    console.log('✅ conta reabilitada — nenhum claim ou documento restaurado automaticamente (decisão administrativa separada, deliberadamente manual)');
    process.exit(0);
  }

  const estadoAtual = {
    disabled: authUser.disabled,
    temClaim: !!(authUser.customClaims && authUser.customClaims.role),
    temDocAtivo: doc.exists
  };
  const plano = planejarAposentadoria(estadoAtual);
  console.log('=== ' + (APPLY ? 'APLICANDO' : 'DRY-RUN — NENHUMA ESCRITA') + ' — projeto: ' + projectId + ' ===\n');
  console.log('Alvo:', ALVO.nome, '(' + ALVO.email + ') uid', authUser.uid.slice(0,6)+'…');
  console.log('Estado atual:', JSON.stringify(estadoAtual));

  if (plano.acao === 'nenhuma') { console.log('✅ já está totalmente aposentada — idempotência confirmada, nenhuma ação necessária'); process.exit(0); }

  console.log('Plano:', JSON.stringify(plano));
  if (!APPLY) process.exit(0);

  if (plano.desabilitar) { await auth.updateUser(authUser.uid, { disabled: true }); console.log('✅ conta desabilitada no Auth (NÃO excluída)'); }
  if (plano.removerClaim) { await auth.setCustomUserClaims(authUser.uid, {}); console.log('✅ custom claim de role removido'); }
  if (plano.removerDoc && doc.exists) { await docRef.delete(); console.log('✅ documento normalizado ativo removido (sem acesso ao ERP)'); }
  if (plano.revogarTokens) { await auth.revokeRefreshTokens(authUser.uid); console.log('✅ tokens revogados — nenhuma sessão aberta continua válida'); }

  // Auditoria da aposentadoria — preserva rastro, nunca no array legado (que fica intacto para rollback/auditoria à parte).
  await db.collection('erp_vr_aposentadoria_auditoria').doc(authUser.uid).set({
    email: ALVO.email, nome: ALVO.nome, aposentadoEm: new Date().toISOString(), aposentadoPor: 'retire_erp_user.js'
  });
  console.log('\n✅ aposentadoria concluída — conta preservada no Auth, desabilitada, sem claim, sem documento ativo, tokens revogados.');
  process.exit(0);
}

if (MOCK) runMockTests();
else runReal().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

module.exports = { planejarAposentadoria };
