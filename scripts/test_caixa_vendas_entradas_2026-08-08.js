/**
 * test_caixa_vendas_entradas_2026-08-08.js
 *
 * RODADA 3 — seção 13: Caixa Diário não separava VENDAS de
 * ENTRADAS/RECEBIMENTOS — só mostrava Entradas (fin_cr recebido no dia).
 * Uma venda 50/50 de R$200 (R$100 recebido hoje + R$100 pendente) aparecia
 * como R$100 de "atividade do dia", nunca os R$200 vendidos. Corrigido
 * adicionando o card "Vendas do Dia" = soma de TODO fin_cr criado no dia
 * (dataCriacao), independente de status — nunca duplicando quando o
 * restante é recebido depois (aquele dia posterior só soma em Entradas,
 * nunca de novo em Vendas, porque dataCriacao continua sendo o dia
 * original).
 *
 * Testa a função REAL relCaixaDiario() extraída de index.html, com mocks
 * mínimos de DOM (mesmo padrão de outros testes deste bloco).
 *
 * Uso: node scripts/test_caixa_vendas_entradas_2026-08-08.js
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
var src = [
  'var _CX_ALL = {};',
  'function relNormMetodo(m){ return m||"—"; }',
  'function relMetodoBadge(m){ return m; }',
  extractFn('relCaixaDiario'),
  'module.exports = { relCaixaDiario: relCaixaDiario };'
].join('\n\n');
var modPath = path.join(__dirname, '_caixa_vendas_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', innerHTML: '' }, props || {}); }
var _elements = {};
function reg(id, el) { _elements[id] = el; return el; }
global.document = { getElementById: function (id) { return _elements[id]; } };
global.finFmt = function (v) { return 'R$ ' + v.toFixed(2); };

var mod;
function reset(dtBR) {
  _elements = {};
  reg('relCaixaData', makeEl({ value: '' }));
  reg('relCaixaAnt', makeEl({ value: '0' }));
  reg('relCaixaGrid', makeEl({}));
  reg('relCaixaEntradas', makeEl({}));
  delete require.cache[require.resolve(modPath)];
  mod = require(modPath);
}

console.log('\n=== RODADA 3 — Caixa Diário: Vendas do Dia separado de Entradas (função real) ===\n');

// Cenário do exemplo da instrução: venda 50/50 de R$200 hoje, R$100 recebido hoje, R$100 pendente
reset();
var hoje = new Date();
var dtISO = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
var dtBR = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
_elements['relCaixaData'].value = dtISO;

global.FIN_CR = [
  { id: 'cr1', cliente: 'Cliente A', valor: 100, status: 'recebido', dataCriacao: dtBR, dataRecebimento: dtBR, metodo: 'PIX', descricao: 'Entrada' },
  { id: 'cr2', cliente: 'Cliente A', valor: 100, status: 'pendente', dataCriacao: dtBR, dataRecebimento: null, metodo: 'PIX', descricao: 'Restante' },
];
global.FIN_CP = [];
mod.relCaixaDiario();
var gridHtml = _elements['relCaixaGrid'].innerHTML;

test('1. "Vendas do Dia" mostra R$200,00 (venda inteira, não só a parte recebida)', gridHtml.indexOf('R$ 200.00') >= 0, true);
test('2. "Total Entradas" continua mostrando só R$100,00 (o que realmente entrou hoje)', gridHtml.indexOf('R$ 100.00') >= 0, true);
test('3. Vendas do Dia e Total Entradas são valores DIFERENTES (nunca somados/confundidos)', gridHtml.indexOf('R$ 200.00') >= 0 && gridHtml.indexOf('R$ 100.00') >= 0, true);

// Cenário: restante recebido em um dia DEPOIS — não deve duplicar Vendas naquele dia posterior
reset();
var amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
var dtAmanhaISO = amanha.getFullYear() + '-' + String(amanha.getMonth() + 1).padStart(2, '0') + '-' + String(amanha.getDate()).padStart(2, '0');
var dtAmanhaBR = String(amanha.getDate()).padStart(2, '0') + '/' + String(amanha.getMonth() + 1).padStart(2, '0') + '/' + amanha.getFullYear();
_elements['relCaixaData'].value = dtAmanhaISO;
global.FIN_CR = [
  { id: 'cr1', cliente: 'Cliente A', valor: 100, status: 'recebido', dataCriacao: dtBR, dataRecebimento: dtBR, metodo: 'PIX' },
  { id: 'cr2', cliente: 'Cliente A', valor: 100, status: 'recebido', dataCriacao: dtBR, dataRecebimento: dtAmanhaBR, metodo: 'PIX' }, // restante pago amanhã
];
global.FIN_CP = [];
mod.relCaixaDiario();
var gridAmanha = _elements['relCaixaGrid'].innerHTML;
test('4. no dia seguinte, "Vendas do Dia" é R$0,00 — a venda foi ontem, não duplica hoje', gridAmanha.indexOf('Vendas do Dia</div><div class="caixa-card-val">R$ 0.00') >= 0, true);
test('5. no dia seguinte, "Total Entradas" mostra R$100,00 (o restante que entrou hoje de fato)', gridAmanha.indexOf('caixa-saldo-pos">R$ 100.00') >= 0, true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
