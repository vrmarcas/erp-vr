/**
 * test_sprint_posauditoria_p0_4_cp_bulkpay_pendente_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.4 — a auditoria read-only anterior
 * encontrou um bug financeiro real: o pagamento INDIVIDUAL de uma conta a
 * pagar (finCPPagar) verificava r.valorPendente antes de prosseguir, mas
 * o pagamento em LOTE (finCPBulkPagar) chamava _finCPPagarConfirmar()
 * diretamente, sem esse guard — era possível selecionar uma competência
 * de recorrência variável ainda "a informar" (valorPendente:true,
 * valor:null) junto com outras e dar baixa em massa. Ela ficava marcada
 * status:'pago' com valor:null, e esse "pagamento" sumia silenciosamente
 * dos totais de Caixa (finCPValorNum trata valorPendente como 0) até
 * alguém notar e corrigir manualmente.
 *
 * Corrigido: o guard agora mora em _finCPPagarConfirmar() — o nível MAIS
 * BAIXO usado por toda rota de pagamento (individual e em lote), nunca
 * mais contornável por um caller futuro. Além disso, finCPBulkPagar()
 * bloqueia o LOTE INTEIRO (não só a conta pendente) quando qualquer
 * selecionado tem valor pendente, com mensagem clara — comportamento
 * mais previsível financeiramente do que pagar parte e ignorar o resto.
 *
 * Uso: node scripts/test_sprint_posauditoria_p0_4_cp_bulkpay_pendente_2026-08-09.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

var FN_NAMES = ['_confirmarAposSalvar', '_finCPPagarConfirmar', 'finCPBulkPagar'];
var src = [
  'var FIN_CP = []; var _finCPSel = {}; var _toasts = [];',
  'function showToast(msg, tipo){ _toasts.push({msg:msg, tipo:tipo}); }',
  'function _finSaveCP(){ return Promise.resolve({ok:true}); }',
  'function finCPRender(){} function finDashKPIs(){} function finDonutRender(){} function finCPUpdateBulkBar(){}',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  pagarConfirmar: _finCPPagarConfirmar, bulkPagar: finCPBulkPagar,',
  '  setCP: function(v){ FIN_CP = v; }, getCP: function(){ return FIN_CP; },',
  '  setSel: function(v){ _finCPSel = v; }, getToasts: function(){ return _toasts; }, clearToasts: function(){ _toasts = []; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_p0_4_cp_bulkpay_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.4 — CP: bulk-pay bloqueia valor pendente ===\n');

function fixtureBase() {
  return [
    { id: 'cp1', descricao: 'Energia agosto', status: 'pendente', valor: 997.34, valorPendente: false },
    { id: 'cp2', descricao: 'Água agosto',    status: 'pendente', valor: 150.00, valorPendente: false },
    { id: 'cp3', descricao: 'Energia setembro (a informar)', status: 'pendente', valor: null, valorPendente: true },
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// 1-3. Pagamento INDIVIDUAL (via _finCPPagarConfirmar direto — o nível
// mais baixo, chamado tanto por finCPPagar quanto por finCPBulkPagar).
// ─────────────────────────────────────────────────────────────────────────
(function () {
  mod.setCP(fixtureBase()); mod.clearToasts();
  return Promise.resolve(mod.pagarConfirmar('cp3', '2026-08-09')).then(function () {
    var cp3 = mod.getCP().find(function (r) { return r.id === 'cp3'; });
    test('1. individual: pagar competência com valorPendente:true é BLOQUEADO (status continua pendente)', cp3.status, 'pendente');
    test('2. individual: NENHUM registro fica pago com valor:null', cp3.valor, null);
    test('3. individual: mensagem de aviso clara foi emitida', mod.getToasts().some(function (t) { return /Informe o valor/.test(t.msg); }), true);
  });
})()
// ─────────────────────────────────────────────────────────────────────────
// 4-8. Pagamento em LOTE — bug real da auditoria: 5 contas válidas + 1
// pendente não deve pagar NENHUMA (bloqueia o lote inteiro).
// ─────────────────────────────────────────────────────────────────────────
.then(function () {
  var fixture = fixtureBase();
  mod.setCP(fixture);
  mod.setSel({ cp1: true, cp2: true, cp3: true }); // 2 válidas + 1 pendente
  mod.clearToasts();
  mod.bulkPagar();
  var cp1 = mod.getCP().find(function (r) { return r.id === 'cp1'; });
  var cp2 = mod.getCP().find(function (r) { return r.id === 'cp2'; });
  var cp3 = mod.getCP().find(function (r) { return r.id === 'cp3'; });
  test('4. lote com 1 pendente entre 3 selecionados — BLOQUEIA O LOTE INTEIRO (cp1 continua pendente)', cp1.status, 'pendente');
  test('5. ...cp2 (também válida) também NÃO foi paga — nunca paga "parte" do lote silenciosamente', cp2.status, 'pendente');
  test('6. ...cp3 (a pendente) continua com valor:null, nunca "pago"', [cp3.status, cp3.valor], ['pendente', null]);
  test('7. mensagem final é exatamente a exigida pelo enunciado', mod.getToasts().some(function (t) {
    return t.msg.indexOf('Há despesas com valor ainda não informado. Preencha os valores antes de dar baixa') === 0;
  }), true);
  test('8. mensagem lista a conta pendente pelo nome (não é genérica)', mod.getToasts().some(function (t) { return t.msg.indexOf('Energia setembro (a informar)') >= 0; }), true);
})
// ─────────────────────────────────────────────────────────────────────────
// 9-11. Lote 100% válido — paga normalmente (não deve haver falso
// positivo do guard bloqueando contas que JÁ têm valor).
// ─────────────────────────────────────────────────────────────────────────
.then(function () {
  var fixture = fixtureBase();
  mod.setCP(fixture);
  mod.setSel({ cp1: true, cp2: true }); // só as 2 válidas
  mod.clearToasts();
  mod.bulkPagar();
  return new Promise(function (resolve) { setTimeout(resolve, 10); }).then(function () {
    var cp1 = mod.getCP().find(function (r) { return r.id === 'cp1'; });
    var cp2 = mod.getCP().find(function (r) { return r.id === 'cp2'; });
    var cp3 = mod.getCP().find(function (r) { return r.id === 'cp3'; });
    test('9. lote 100% válido — cp1 pago normalmente', cp1.status, 'pago');
    test('10. lote 100% válido — cp2 pago normalmente', cp2.status, 'pago');
    test('11. cp3 (não selecionada) permanece intocada', [cp3.status, cp3.valor], ['pendente', null]);
  });
})
// ─────────────────────────────────────────────────────────────────────────
// 12. R$0,00 explicitamente informado é distinto de "a informar" — uma
// competência com valor:0 e valorPendente:false PODE ser paga
// normalmente (0 é um valor real informado, não "desconhecido").
// ─────────────────────────────────────────────────────────────────────────
.then(function () {
  mod.setCP([{ id: 'cpZero', descricao: 'Taxa isenta este mês', status: 'pendente', valor: 0, valorPendente: false }]);
  mod.clearToasts();
  return Promise.resolve(mod.pagarConfirmar('cpZero', '2026-08-09')).then(function () {
    var r = mod.getCP().find(function (x) { return x.id === 'cpZero'; });
    test('12. R$0,00 explicitamente informado (valorPendente:false) é pago normalmente — nunca confundido com "a informar"', r.status, 'pago');
  });
})
// ─────────────────────────────────────────────────────────────────────────
// 13. Regressão: pagar uma conta já paga continua idempotente (não é
// tema deste bloco, mas garante que o novo guard não quebrou o guard
// pré-existente de status==='pago').
// ─────────────────────────────────────────────────────────────────────────
.then(function () {
  mod.setCP([{ id: 'cpPago', descricao: 'Já paga', status: 'pago', valor: 100, valorPendente: false, dataPagamento: '01/08/2026' }]);
  mod.clearToasts();
  return Promise.resolve(mod.pagarConfirmar('cpPago', '2026-08-09')).then(function () {
    var r = mod.getCP().find(function (x) { return x.id === 'cpPago'; });
    test('13. pagar uma conta já paga continua bloqueado (idempotência pré-existente preservada)', r.dataPagamento, '01/08/2026');
  });
})
.then(function () {
  try { fs.unlinkSync(modPath); } catch (e) {}
  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})
.catch(function (e) {
  console.error('ERRO INESPERADO NO TESTE:', e);
  try { fs.unlinkSync(modPath); } catch (e2) {}
  process.exitCode = 1;
});
