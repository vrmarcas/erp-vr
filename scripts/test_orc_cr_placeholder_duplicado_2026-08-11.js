/**
 * test_orc_cr_placeholder_duplicado_2026-08-11.js
 *
 * GO-LIVE 2026-08-11 — SMOKE VISUAL FINAL, achado real: aprovar um
 * orçamento (orcEnvSetStatus) cria um CR "placeholder" com o VALOR TOTAL
 * (status=pendente, sem osId) para cobrir o caso de aprovação sem
 * confirmação de pagamento imediata. Confirmado em produção real (orçamento
 * de teste #000017, R$765,37): depois de Aprovar → Confirmar Pagamento
 * (entrada 50%), o Dashboard mostrava Vendas=R$1.530,74 e CR
 * Pendente=R$1.148,05 — exatamente o dobro/inflado pelo placeholder nunca
 * removido quando a entrada/saldo definitivos foram criados.
 *
 * Corrigido em orcEnvGerarOS (nos dois caminhos — transação real e
 * fallback local): ao criar a entrada/saldo definitivos, remove o
 * placeholder (identificado por o.crId) do mesmo array de FIN_CR.
 *
 * Uso: node scripts/test_orc_cr_placeholder_duplicado_2026-08-11.js
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
function testTrue(desc, condition) {
  if (condition) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + ' (condição falsa)'); failed++; }
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

var FN_NAMES = ['orcEnvSetStatus', 'orcEnvGerarOS'];
var src = [
  "var _ORC_ENVIADOS_DATA = [];",
  "function _isTestRecord(o){ return !!(o && (o.isTest === true || o.environment === 'test')); }",
  "function orcGetEnviados(){ return _ORC_ENVIADOS_DATA.filter(function(o){ return !_isTestRecord(o); }); }",
  "function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; return Promise.resolve({ok:true}); }",
  "var KB_OS = {}; var _OS_COUNTER = 0; var FIN_CR = []; var FIN_TX = [];",
  "var _pgtoTipoAtual = null; var _orcPagtoId = null;",
  "var domStore = {}; function document_getElementById(id){ if(!domStore[id]) domStore[id] = { value:'', style:{} }; return domStore[id]; }",
  "var document = { getElementById: document_getElementById };",
  "var _toasts = []; function showToast(msg,tipo){ _toasts.push({msg:msg,tipo:tipo}); }",
  "function orcEnviadosRender(){} function nav(){} function kbRender(){}",
  "function orcAtualizarBadgeEnviados(){} function _finSaveCR(){ return Promise.resolve({ok:true}); }",
  FN_NAMES.map(extractFn).join('\n\n'),
  [
    'module.exports = {',
    '  setStatus: orcEnvSetStatus,',
    '  gerarOS: orcEnvGerarOS,',
    '  addOrc: function (orc) { _ORC_ENVIADOS_DATA.push(orc); },',
    '  getCR: function () { return FIN_CR; },',
    '  getOrc: function (id) { return _ORC_ENVIADOS_DATA.find(function (o) { return o.id === id; }); },',
    '  setPgtoCtx: function (id, tipo, forma, entradaVal) {',
    '    _orcPagtoId = id; _pgtoTipoAtual = tipo;',
    '    document_getElementById("pgtoForma").value = forma;',
    '    document_getElementById("pgtoEntradaVal").value = String(entradaVal);',
    '  },',
    '};',
  ].join('\n'),
].join('\n\n');
var modPath = path.join(__dirname, '_orc_cr_placeholder_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== GO-LIVE SMOKE FINAL — CR placeholder duplicado ao aprovar + confirmar pagamento ===\n');

var ORC_ID = 'orc_teste_1';
mod.addOrc({
  id: ORC_ID, num: '999', cliente: 'Cliente Smoke', tel: '(11) 90000-0000',
  marca: 'vr', valorFinal: 765.37, produto: 'Carrinho de Make Patrícia',
  itens: [{ prod: 'Carrinho de Make Patrícia', qty: '1', mat: 'Acrílico Cristal 2mm', unit: 'R$743,35', total: 'R$743,35' }],
  status: 'aguardando',
});

// 1. Aprovar cria o placeholder (comportamento documentado — nunca removido aqui)
mod.setStatus(ORC_ID, 'aprovado');
var crAposAprovar = mod.getCR();
test('1. aprovar o orçamento cria exatamente 1 CR placeholder com o valor TOTAL', crAposAprovar.map(function (c) { return c.valor; }), [765.37]);
testTrue('2. o placeholder fica com status=pendente (nunca "recebido" — nada foi pago ainda)', crAposAprovar[0].status === 'pendente');
var orcDepoisAprovar = mod.getOrc(ORC_ID);
testTrue('3. o orçamento guarda o crId do placeholder', !!orcDepoisAprovar.crId && orcDepoisAprovar.crId === crAposAprovar[0].id);

// 2. Confirmar pagamento (entrada 50%) gera OS — o placeholder precisa sumir
mod.setPgtoCtx(ORC_ID, '50-50', 'PIX', 382.69);
mod.gerarOS();
var crDepoisPagamento = mod.getCR();
test('4. depois de confirmar o pagamento, o placeholder de R$765,37 NÃO existe mais (foi substituído pela entrada+saldo definitivos)', crDepoisPagamento.some(function (c) { return c.valor === 765.37 && c.status === 'pendente' && !c.osId; }), false);
test('5. sobram exatamente 2 lançamentos de CR: entrada (recebido) + saldo (pendente)', crDepoisPagamento.length, 2);
var soma = crDepoisPagamento.reduce(function (s, c) { return s + c.valor; }, 0);
test('6. a soma dos 2 lançamentos bate EXATO com o valor do orçamento (765,37 — nunca 1.530,74 em dobro)', Math.round(soma * 100), 76537);
var entrada = crDepoisPagamento.find(function (c) { return c.status === 'recebido'; });
var saldo = crDepoisPagamento.find(function (c) { return c.status === 'pendente'; });
testTrue('7. a entrada tem osId vinculado (rastreável até a OS gerada)', !!entrada && !!entrada.osId);
testTrue('8. o saldo tem osId vinculado (rastreável até a OS gerada)', !!saldo && !!saldo.osId);

// 3. Cenário de controle — aprovar SEM nunca confirmar pagamento: placeholder deve continuar existindo (é a única fonte do valor devido)
{
  var ORC_ID2 = 'orc_teste_2';
  mod.addOrc({ id: ORC_ID2, num: '998', cliente: 'Cliente Smoke 2', tel: '(11) 90000-0001', marca: 'vr', valorFinal: 500, produto: 'X', itens: [] });
  mod.setStatus(ORC_ID2, 'aprovado');
  var crTotal = mod.getCR();
  testTrue('9. controle: um orçamento aprovado mas NUNCA pago mantém seu placeholder (é a única fonte real do valor devido) — nada foi removido indevidamente', crTotal.some(function (c) { return c.orcamentoId === ORC_ID2 && c.valor === 500 && c.status === 'pendente'; }));
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
