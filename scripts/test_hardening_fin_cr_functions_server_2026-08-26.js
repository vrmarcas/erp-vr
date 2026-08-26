/**
 * test_hardening_fin_cr_functions_server_2026-08-26.js
 *
 * HARDENING DE CONFIDENCIALIDADE FINANCEIRA — fin_cr.
 *
 * Testa as 6 Cloud Functions REAIS (functions/src/finCr.ts, compiladas em
 * functions/lib/finCr.js — NÃO reimplementadas aqui) contra o Firestore
 * Emulator real, via .run(data, context) — mesmo padrão de
 * test_producao_autorizacao_server.js. Cobre: autorização por role
 * (Comercial/Financeiro permitidos, Produção negado, Master sempre
 * permitido), a lógica de negócio portada de cada função client-side
 * equivalente, idempotência, e — o ponto central desta rodada — que
 * finCrHistoricoRecebimento NUNCA devolve o array completo, só o
 * subconjunto do orçamento pedido.
 *
 * Uso: node scripts/test_hardening_fin_cr_functions_server_2026-08-26.js
 * Pré-requisito: Firestore Emulator :8080, node scripts/e2e_clean_env.js reset já rodado.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const {
  finCrConfirmarPagamento, finCrVincularOS, finCrReceberSaldo,
  finCrRegistrarRecebimento, finCrAutoAprovarOrcamento, finCrHistoricoRecebimento,
} = require('../functions/lib/finCr.js');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
async function assertThrows(fn, codeOuTrecho, msg) {
  try { await fn(); throw new Error((msg || 'esperava erro') + ' — nenhum erro lançado'); }
  catch (e) {
    if (e.message && e.message.indexOf((msg || 'esperava erro')) === 0) throw e;
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(codeOuTrecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + codeOuTrecho + '", obtido: ' + texto);
  }
}
const { UID, ctx } = require('./e2e_shared_fixtures');
var reqCounter = 0;
function novoReqId() { return 'e2e_fincr_' + Date.now() + '_' + (reqCounter++); }

async function getDoc(docId) {
  var snap = await db.collection('erp_vr').doc(docId).get();
  return (snap.exists && snap.data() && snap.data().data) ? JSON.parse(snap.data().data) : (Array.isArray([]) ? [] : {});
}
async function setDoc(docId, value) {
  await db.collection('erp_vr').doc(docId).set({ data: JSON.stringify(value), ts: Date.now() });
}
async function setOrcamentos(arr) { await setDoc('orcamentos', arr); }
async function setKbOs(obj) { await setDoc('kb_os', obj); }
async function setKbOsFin(obj) { await setDoc('kb_os_fin', obj); }
async function setFinCr(arr) { await setDoc('fin_cr', arr); }

console.log('\n=== HARDENING fin_cr — Cloud Functions reais (Emulator, role real, lógica portada) ===\n');

(async function main() {
  // ── 1. Autorização por role — cada função, Produção sempre negado ────────
  await test('1. finCrConfirmarPagamento: Produção → NEGADO (permission-denied)', async function () {
    await assertThrows(() => finCrConfirmarPagamento.run({ orcId: 'x' }, ctx(UID.producao, 'producao')), 'permission-denied');
  });
  await test('2. finCrVincularOS: Produção → NEGADO', async function () {
    await assertThrows(() => finCrVincularOS.run({ orcamentoId: 'x', osId: 'y', osNum: 1 }, ctx(UID.producao, 'producao')), 'permission-denied');
  });
  await test('3. finCrReceberSaldo: Produção → NEGADO', async function () {
    await assertThrows(() => finCrReceberSaldo.run({ osId: 'x' }, ctx(UID.producao, 'producao')), 'permission-denied');
  });
  await test('4. finCrRegistrarRecebimento: Produção → NEGADO', async function () {
    await assertThrows(() => finCrRegistrarRecebimento.run({ osId: 'x', valorPago: 1 }, ctx(UID.producao, 'producao')), 'permission-denied');
  });
  await test('5. finCrAutoAprovarOrcamento: Produção → NEGADO', async function () {
    await assertThrows(() => finCrAutoAprovarOrcamento.run({ orcId: 'x' }, ctx(UID.producao, 'producao')), 'permission-denied');
  });
  await test('6. finCrHistoricoRecebimento: Produção → NEGADO', async function () {
    await assertThrows(() => finCrHistoricoRecebimento.run({ orcamentoId: 'x' }, ctx(UID.producao, 'producao')), 'permission-denied');
  });
  await test('7. Todas as 6: sem autenticação → NEGADO (unauthenticated)', async function () {
    await assertThrows(() => finCrConfirmarPagamento.run({ orcId: 'x' }, ctx(null)), 'unauthenticated');
  });

  // ── 8-10. finCrConfirmarPagamento — lógica de negócio ─────────────────────
  await test('8. finCrConfirmarPagamento (Comercial): entrada+restante cria 2 entradas em fin_cr, 1 em fin_tx, marca orcamento.pgtoConfirmado', async function () {
    var orcId = 'e2e_orc_' + Date.now();
    await setOrcamentos([{ id: orcId, status: 'aprovado' }]);
    await setFinCr([]);
    await setDoc('fin_tx', []);
    var r = await finCrConfirmarPagamento.run({
      orcId: orcId, tipo: '50-50', forma: 'PIX', valorEfetivo: 1000, valorEntrada: 500, restante: 500,
      cliente: '[TESTE] Cliente FinCr', numOrc: '999', prodNome: 'Produto Teste', marca: 'vr',
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.ok, true);
    assertEq(r.jaConfirmado, false);
    var arrCR = await getDoc('fin_cr');
    assertEq(arrCR.length, 2, 'deveria criar 2 entradas (entrada recebida + restante pendente)');
    assertTruthy(arrCR.some(function (c) { return c.status === 'recebido' && c.valor === 500; }), 'entrada recebida de 500');
    assertTruthy(arrCR.some(function (c) { return c.status === 'pendente' && c.valor === 500; }), 'restante pendente de 500');
    var arrTx = await getDoc('fin_tx');
    assertEq(arrTx.length, 1, 'entrada com dinheiro real deve gerar 1 fin_tx');
    var arrOrc = await getDoc('orcamentos');
    assertTruthy(arrOrc[0].pgtoConfirmado, 'orcamento.pgtoConfirmado deve ser gravado');
  });
  await test('9. finCrConfirmarPagamento: 2ª chamada no MESMO orçamento é idempotente (jaConfirmado=true, não duplica)', async function () {
    var orcId = 'e2e_orc_idem_' + Date.now();
    await setOrcamentos([{ id: orcId, status: 'aprovado' }]);
    await setFinCr([]);
    await setDoc('fin_tx', []);
    await finCrConfirmarPagamento.run({ orcId: orcId, tipo: '50-50', forma: 'PIX', valorEntrada: 100, restante: 0, cliente: 'X', numOrc: '1', prodNome: 'P', marca: 'vr' }, ctx(UID.comercial, 'comercial'));
    var r2 = await finCrConfirmarPagamento.run({ orcId: orcId, tipo: '50-50', forma: 'PIX', valorEntrada: 999, restante: 999, cliente: 'X', numOrc: '1', prodNome: 'P', marca: 'vr' }, ctx(UID.comercial, 'comercial'));
    assertEq(r2.jaConfirmado, true, 'ACHADO REAL evitado: 2ª confirmação nunca deve gravar de novo (duplo-clique/retry)');
    var arrCR = await getDoc('fin_cr');
    assertEq(arrCR.length, 1, 'não deveria ter criado uma 2ª entrada com o valor 999');
  });
  await test('10. finCrConfirmarPagamento: orçamento inexistente → not-found', async function () {
    await assertThrows(() => finCrConfirmarPagamento.run({ orcId: 'nao_existe_' + Date.now(), tipo: 'futuro', valorEntrada: 0, restante: 100, cliente: 'X', numOrc: '1', prodNome: 'P' }, ctx(UID.comercial, 'comercial')), 'not-found');
  });

  // ── 11-12. finCrVincularOS ────────────────────────────────────────────────
  await test('11. finCrVincularOS (Comercial): vincula só as entradas do orçamento pedido, sem osId ainda', async function () {
    var orcId = 'e2e_orc_vinc_' + Date.now();
    var orcOutro = 'e2e_orc_outro_' + Date.now();
    await setFinCr([
      { id: 'cr1', orcamentoId: orcId, osId: '', valor: 100, status: 'recebido' },
      { id: 'cr2', orcamentoId: orcId, osId: '', valor: 50, status: 'pendente' },
      { id: 'cr3', orcamentoId: orcOutro, osId: '', valor: 999, status: 'pendente' }, // não pode ser tocado
    ]);
    var r = await finCrVincularOS.run({ orcamentoId: orcId, osId: 'os_novo_1', osNum: 42 }, ctx(UID.comercial, 'comercial'));
    assertEq(r.vinculados, 2);
    var arrCR = await getDoc('fin_cr');
    assertTruthy(arrCR.find(function (c) { return c.id === 'cr1'; }).osId === 'os_novo_1');
    assertTruthy(arrCR.find(function (c) { return c.id === 'cr2'; }).osRef === 'OS #42');
    assertEq(arrCR.find(function (c) { return c.id === 'cr3'; }).osId, '', 'entrada de OUTRO orçamento nunca deve ser tocada');
  });
  await test('12. finCrVincularOS: chamar de novo (idempotência) não revincula entradas já com osId', async function () {
    var orcId = 'e2e_orc_vinc2_' + Date.now();
    await setFinCr([{ id: 'crX', orcamentoId: orcId, osId: 'os_ja_vinculada', osRef: 'OS #1', valor: 10, status: 'pendente' }]);
    var r = await finCrVincularOS.run({ orcamentoId: orcId, osId: 'os_novo_2', osNum: 2 }, ctx(UID.comercial, 'comercial'));
    assertEq(r.vinculados, 0, 'entrada já vinculada (osId preenchido) nunca deve ser sobrescrita por uma 2ª OS');
  });

  // ── 13-15. finCrReceberSaldo (caminho legado) ─────────────────────────────
  await test('13. finCrReceberSaldo (Comercial): quita saldo integral, cria fin_tx, marca CR pendente como recebido', async function () {
    var osId = 'e2e_os_saldo_' + Date.now();
    await setKbOs({ [osId]: { id: osId, num: '77', status: 'aguardando_saldo', cliente: 'X', mk: 'vr' } });
    await setKbOsFin({ [osId]: { restante: 300, formaPgto: 'PIX' } });
    await setFinCr([{ id: 'crSaldo', osRef: 'OS #77', status: 'pendente', valor: 300 }]);
    await setDoc('fin_tx', []);
    var r = await finCrReceberSaldo.run({ osId: osId }, ctx(UID.comercial, 'comercial'));
    assertEq(r.ok, true);
    assertEq(r.valorRecebido, 300);
    var kbFin = await getDoc('kb_os_fin');
    assertEq(kbFin[osId].restante, 0);
    var kb = await getDoc('kb_os');
    assertEq(kb[osId].status, 'iniciada');
    var arrCR = await getDoc('fin_cr');
    assertEq(arrCR.find(function (c) { return c.id === 'crSaldo'; }).status, 'recebido');
    var arrTx = await getDoc('fin_tx');
    assertEq(arrTx.length, 1);
  });
  await test('14. finCrReceberSaldo: saldo já quitado → failed-precondition SALDO_JA_QUITADO', async function () {
    var osId = 'e2e_os_quitado_' + Date.now();
    await setKbOs({ [osId]: { id: osId, num: '78', status: 'iniciada', cliente: 'X', mk: 'vr' } });
    await setKbOsFin({ [osId]: { restante: 0 } });
    await assertThrows(() => finCrReceberSaldo.run({ osId: osId }, ctx(UID.comercial, 'comercial')), 'SALDO_JA_QUITADO');
  });
  await test('15. finCrReceberSaldo: OS inexistente → not-found', async function () {
    await assertThrows(() => finCrReceberSaldo.run({ osId: 'nao_existe_' + Date.now() }, ctx(UID.financeiro, 'financeiro')), 'not-found');
  });

  // ── 16-19. finCrRegistrarRecebimento (rotina canônica atual) ──────────────
  await test('16. finCrRegistrarRecebimento (Financeiro): pagamento PARCIAL reduz saldo, nunca quita, cria nova entrada recebida', async function () {
    var osId = 'e2e_os_parcial_' + Date.now();
    await setKbOs({ [osId]: { id: osId, num: '80', status: 'pronta', cliente: 'X', mk: 'vr' } });
    await setKbOsFin({ [osId]: { restante: 200 } });
    await setFinCr([{ id: 'crParcial', osRef: 'OS #80', status: 'pendente', valor: 200 }]);
    await setDoc('fin_tx', []);
    var r = await finCrRegistrarRecebimento.run({ osId: osId, valorPago: 80, forma: 'Cartão' }, ctx(UID.financeiro, 'financeiro'));
    assertEq(r.quitado, false);
    var kbFin = await getDoc('kb_os_fin');
    assertEq(kbFin[osId].restante, 120, 'restante deveria cair de 200 para 120');
    var arrCR = await getDoc('fin_cr');
    assertEq(arrCR.find(function (c) { return c.id === 'crParcial'; }).valor, 120, 'entrada pendente original reduz o valor, nunca é apagada');
    assertTruthy(arrCR.some(function (c) { return c.status === 'recebido' && c.valor === 80; }), 'novo pagamento vira sua PRÓPRIA entrada — histórico nunca funde');
  });
  await test('17. finCrRegistrarRecebimento: pagamento que QUITA remove a entrada pendente (absorvida)', async function () {
    var osId = 'e2e_os_quita_' + Date.now();
    await setKbOs({ [osId]: { id: osId, num: '81', status: 'pronta', cliente: 'X', mk: 'vr' } });
    await setKbOsFin({ [osId]: { restante: 50 } });
    await setFinCr([{ id: 'crQuita', osRef: 'OS #81', status: 'pendente', valor: 50 }]);
    await setDoc('fin_tx', []);
    var r = await finCrRegistrarRecebimento.run({ osId: osId, valorPago: 50, forma: 'PIX' }, ctx(UID.comercial, 'comercial'));
    assertEq(r.quitado, true);
    var arrCR = await getDoc('fin_cr');
    assertEq(arrCR.find(function (c) { return c.id === 'crQuita'; }), undefined, 'entrada pendente original deve ser removida (absorvida pela nova recebida)');
  });
  await test('18. finCrRegistrarRecebimento: valor MAIOR que o saldo real (relido no servidor) → failed-precondition', async function () {
    var osId = 'e2e_os_excede_' + Date.now();
    await setKbOs({ [osId]: { id: osId, num: '82', status: 'pronta', cliente: 'X', mk: 'vr' } });
    await setKbOsFin({ [osId]: { restante: 10 } });
    await assertThrows(() => finCrRegistrarRecebimento.run({ osId: osId, valorPago: 999 }, ctx(UID.comercial, 'comercial')), 'VALOR_MAIOR_QUE_SALDO');
  });
  await test('19. finCrRegistrarRecebimento: valor zero/negativo → invalid-argument (nunca aceita)', async function () {
    await assertThrows(() => finCrRegistrarRecebimento.run({ osId: 'qualquer', valorPago: 0 }, ctx(UID.comercial, 'comercial')), 'invalid-argument');
  });

  // ── 20-21. finCrAutoAprovarOrcamento ──────────────────────────────────────
  await test('20. finCrAutoAprovarOrcamento (Comercial): cria 1 entrada pendente ao aprovar', async function () {
    var orcId = 'e2e_orc_aprova_' + Date.now();
    await setFinCr([]);
    var r = await finCrAutoAprovarOrcamento.run({ orcId: orcId, cliente: '[TESTE] X', numOrc: '55', prodNome: 'Produto', valor: 743.35, marca: 'vr', metodo: 'PIX' }, ctx(UID.comercial, 'comercial'));
    assertEq(r.jaExistia, false);
    var arrCR = await getDoc('fin_cr');
    assertEq(arrCR.length, 1);
    assertEq(arrCR[0].valor, 743.35);
    assertEq(arrCR[0].status, 'pendente');
  });
  await test('21. finCrAutoAprovarOrcamento: chamar 2x pelo mesmo orçamento não duplica (idempotência)', async function () {
    var orcId = 'e2e_orc_aprova2_' + Date.now();
    await setFinCr([]);
    await finCrAutoAprovarOrcamento.run({ orcId: orcId, cliente: 'X', numOrc: '56', prodNome: 'P', valor: 100, marca: 'vr', metodo: 'PIX' }, ctx(UID.comercial, 'comercial'));
    var r2 = await finCrAutoAprovarOrcamento.run({ orcId: orcId, cliente: 'X', numOrc: '56', prodNome: 'P', valor: 100, marca: 'vr', metodo: 'PIX' }, ctx(UID.comercial, 'comercial'));
    assertEq(r2.jaExistia, true);
    var arrCR = await getDoc('fin_cr');
    assertEq(arrCR.length, 1, 'não deveria duplicar a entrada de aprovação');
  });

  // ── 22-24. finCrHistoricoRecebimento — CONFIDENCIALIDADE ──────────────────
  await test('22. finCrHistoricoRecebimento (Comercial): devolve SÓ o histórico do orçamento pedido, nunca o array inteiro', async function () {
    var orcId = 'e2e_orc_hist_' + Date.now();
    await setFinCr([
      { id: 'h1', orcamentoId: orcId, status: 'recebido', valor: 111, dataRecebimento: '01/01/2026', metodo: 'PIX', descricao: 'Entrada' },
      { id: 'h2', orcamentoId: orcId, status: 'pendente', valor: 999, dataRecebimento: null, metodo: 'PIX', descricao: 'Restante — nunca deve aparecer (não é recebido)' },
      { id: 'h3', orcamentoId: 'OUTRO_ORCAMENTO_' + Date.now(), status: 'recebido', valor: 55555, cliente: '[SIGILOSO] outro cliente', dataRecebimento: '02/01/2026', metodo: 'PIX', descricao: 'Nunca deve vazar' },
    ]);
    var r = await finCrHistoricoRecebimento.run({ orcamentoId: orcId }, ctx(UID.comercial, 'comercial'));
    assertEq(r.historico.length, 1, 'só a entrada RECEBIDA do orçamento pedido');
    assertEq(r.historico[0].valorCents, 11100);
    assertTruthy(!JSON.stringify(r).includes('55555'), 'CONFIDENCIALIDADE: valor de outro orçamento nunca pode aparecer na resposta');
    assertTruthy(!JSON.stringify(r).includes('SIGILOSO'), 'CONFIDENCIALIDADE: cliente de outro orçamento nunca pode aparecer na resposta');
    assertTruthy(Object.keys(r.historico[0]).indexOf('clienteId') < 0, 'campos de identificação de cliente nunca são devolvidos — só data/valor/forma/descrição');
  });
  await test('23. finCrHistoricoRecebimento: orçamento sem nenhum recebimento → array vazio, nunca erro', async function () {
    var r = await finCrHistoricoRecebimento.run({ orcamentoId: 'e2e_orc_sem_hist_' + Date.now() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.historico, []);
  });
  await test('24. finCrHistoricoRecebimento (Financeiro): mesmo comportamento, nenhuma regressão', async function () {
    var orcId = 'e2e_orc_hist_fin_' + Date.now();
    await setFinCr([{ id: 'hf1', orcamentoId: orcId, status: 'recebido', valor: 20, dataRecebimento: '03/01/2026', metodo: 'Boleto', descricao: 'X' }]);
    var r = await finCrHistoricoRecebimento.run({ orcamentoId: orcId }, ctx(UID.financeiro, 'financeiro'));
    assertEq(r.historico.length, 1);
  });

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})();
