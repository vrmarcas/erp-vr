/**
 * test_estabilizacao_2026-09-09_bloco8_selecionada_fantasma.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-09, BLOCO 8 — ao enviar um orçamento
 * comparativo, uma das opções já aparecia marcada "(selecionada)" para o
 * cliente mesmo antes de qualquer escolha real — porque `selecionada`
 * (estado de CÁLCULO: qual opção conta no total exibido) e "escolha do
 * cliente" usavam o MESMO campo, e `selecionada` já nasce true para a
 * primeira opção do grupo (necessário para computar um total).
 *
 * Corrigido: novo campo `escolhaConfirmada` em ORC_ITEM_OPCOES, sempre
 * false ao criar/duplicar uma opção — só vira true quando o vendedor
 * explicitamente aciona orcOpcaoSelecionar() ("Marcar escolhida", ação
 * real após o cliente responder). orcColetarItensDistribuidos() propaga
 * isso como `opcaoConfirmadaCliente` (distinto de `opcaoSelecionada`, que
 * continua controlando só o cálculo/total) — WhatsApp/PDF passam a usar
 * opcaoConfirmadaCliente para decidir se mostram "(selecionada)"/✓.
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_bloco8_selecionada_fantasma.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

// ── Parte 1: orcOpcaoSelecionar() — mutual exclusão e campo correto ──
var src1 = [
  'var ORC_ITEM_OPCOES = global.__ORC_ITEM_OPCOES__;',
  extractFn('orcOpcaoSelecionar'),
  'module.exports = { orcOpcaoSelecionar: orcOpcaoSelecionar };'
].join('\n\n');
var modPath1 = path.join(__dirname, '_estabilizacao_2026-09-09_bloco8_p1_extracted.tmp.js');
fs.writeFileSync(modPath1, src1);
global.window = global;
global.orcRecalc = function () {};
global.orcAutoLaserSeNecessario = function () {};
global.__ORC_ITEM_OPCOES__ = {
  1: { grupoId: 'grpA', selecionada: true, escolhaConfirmada: false },
  2: { grupoId: 'grpA', selecionada: false, escolhaConfirmada: false }
};
var mod1 = require(modPath1);

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-09 — Bloco 8: seleção fantasma no comparativo ===\n');

test('BLOCO 8.1 — grupo recém-criado (selecionada default) NÃO tem nenhuma opção com escolhaConfirmada=true', function () {
  assertEq(global.__ORC_ITEM_OPCOES__[1].escolhaConfirmada, false, 'BUG: opção default já nasce com escolha do cliente confirmada');
  assertEq(global.__ORC_ITEM_OPCOES__[2].escolhaConfirmada, false);
});

test('BLOCO 8.2 — orcOpcaoSelecionar(idx) marca escolhaConfirmada=true SÓ na opção escolhida pelo vendedor', function () {
  mod1.orcOpcaoSelecionar(2);
  assertEq(global.__ORC_ITEM_OPCOES__[2].escolhaConfirmada, true, 'opção marcada pelo vendedor deve ficar com escolha confirmada');
  assertEq(global.__ORC_ITEM_OPCOES__[1].escolhaConfirmada, false, 'irmã do mesmo grupo deve perder escolhaConfirmada (mutuamente exclusivo)');
  assertEq(global.__ORC_ITEM_OPCOES__[2].selecionada, true, 'selecionada (cálculo) continua correta também');
  assertEq(global.__ORC_ITEM_OPCOES__[1].selecionada, false);
});

// ── Parte 2: orcColetarItensDistribuidos() propaga opcaoConfirmadaCliente, distinto de opcaoSelecionada ──
var FN_NAMES2 = ['orcColetarItensDistribuidos', 'orcItemDescricaoComercial', 'osItemMateriaisResumo', 'orcProdutoNomeResolvido'];
var src2 = [
  'var ORC_ITEM_OPCOES = global.__ORC_ITEM_OPCOES2__;',
  FN_NAMES2.map(extractFn).join('\n\n'),
  'module.exports = { orcColetarItensDistribuidos: orcColetarItensDistribuidos };'
].join('\n\n');
var modPath2 = path.join(__dirname, '_estabilizacao_2026-09-09_bloco8_p2_extracted.tmp.js');
fs.writeFileSync(modPath2, src2);

function makeEl(props) { return Object.assign({ value: '', textContent: '', dataset: {}, options: [], selectedIndex: 0 }, props || {}); }
var _elements = {};
function reg(id, el) { _elements[id] = el; return el; }
global.document = {
  getElementById: function (id) { return _elements[id]; },
  querySelectorAll: function (sel) {
    if (sel === '#orcItemBody tr') return [_elements['__row1'], _elements['__row2']];
    return [];
  }
};
global._orcCalc = { finalPrice: 400 };

function setupItem(idx, matEsp) {
  reg('oi_prod_' + idx, makeEl({ value: 'Caixa' }));
  reg('oi_qty_' + idx, makeEl({ value: '1' }));
  reg('oi_larg_' + idx, makeEl({ value: '' }));
  reg('oi_alt_' + idx, makeEl({ value: '' }));
  reg('oi_esp_' + idx, makeEl({ value: matEsp }));
  reg('oi_mat_' + idx, makeEl({ value: 'cfg_0', selectedIndex: 0, options: [{ dataset: { nome: 'Acrílico Cristal', esp: matEsp }, text: 'Acrílico Cristal ' + matEsp + 'mm' }] }));
  reg('oi_det_' + idx, makeEl({ value: '' }));
  reg('oi_tot_' + idx, makeEl({ textContent: 'R$ 200,00' }));
  reg('__row' + idx, { dataset: { idx: String(idx), planLarg: '', planAlt: '', planProf: '', planPecas: '[]' } });
}
setupItem(1, '2');
setupItem(2, '3');

global.__ORC_ITEM_OPCOES2__ = {
  1: { grupoId: 'grpB', selecionada: true, escolhaConfirmada: false },
  2: { grupoId: 'grpB', selecionada: false, escolhaConfirmada: false }
};
var mod2 = require(modPath2);

test('BLOCO 8.3 — antes de qualquer escolha real, NENHUM item coletado tem opcaoConfirmadaCliente=true (mesmo com uma opcaoSelecionada=true para o cálculo)', function () {
  var itens = mod2.orcColetarItensDistribuidos(400);
  assertEq(itens.length, 2);
  assertTrue(itens[0].opcaoSelecionada === true, 'item 1 continua contando no total (estado de cálculo)');
  assertEq(itens[0].opcaoConfirmadaCliente, false, 'BUG: item sem escolha real do cliente aparece como confirmado');
  assertEq(itens[1].opcaoConfirmadaCliente, false);
});

test('BLOCO 8.4 — depois de orcOpcaoSelecionar(2) (escolha real), SÓ a opção 2 aparece como opcaoConfirmadaCliente=true', function () {
  global.__ORC_ITEM_OPCOES2__[1].selecionada = false; global.__ORC_ITEM_OPCOES2__[1].escolhaConfirmada = false;
  global.__ORC_ITEM_OPCOES2__[2].selecionada = true; global.__ORC_ITEM_OPCOES2__[2].escolhaConfirmada = true;
  var itens = mod2.orcColetarItensDistribuidos(400);
  assertEq(itens[0].opcaoConfirmadaCliente, false);
  assertEq(itens[1].opcaoConfirmadaCliente, true, 'opção efetivamente marcada pelo vendedor deve aparecer confirmada');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
