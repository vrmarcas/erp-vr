/**
 * test_estabilizacao_2026-09-09_bloco5_produto_simples.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-09, BLOCO 5 — "Produtos Padrão"
 * continuavam exigindo pelo menos uma peça com fórmula de largura/altura
 * preenchida para poder ser salvos (planProdSalvar()), mesmo quando o
 * vendedor só quer cadastrar um produto comercial simples (nome + ativo +
 * descrição), sem planificação/receita. Corrigido: peças/fórmulas agora
 * são opcionais — só validadas quando o usuário de fato adiciona alguma.
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_bloco5_produto_simples.js
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

var FN_NAMES = [
  'receitaMudancaRelevante', 'receitaCriarNovaVersao',
  'receitaCamposValidar', 'receitaMaterialValidar', 'receitaOperacoesValidar', 'receitaConsumiveisValidar',
  'planProdLoad', 'planProdSaveList',
  'planProdReadPecas', 'planProdReadCampos',
  'planProdLerMaterial', 'planProdLerOperacoes', 'planProdLerMaquinas', 'planProdLerConsumiveis',
  'planProdSalvar'
];
var src = [
  'var _PLAN_PROD_DATA = global.__PLAN_PROD_DATA__;',
  'var _planProdPecas = global.__planProdPecas__;',
  'var _planProdCampos = global.__planProdCampos__;',
  'var _planPlanificacoes = [];',
  'var _planProdEditId = global.__planProdEditId__;',
  'var ORC_PRODUTOS = global.ORC_PRODUTOS;',
  'var OPERACOES_PADRAO = [];',
  'var CONSUMIVEIS_PADRAO = [];',
  'var OPERACAO_STATUS_VALIDOS = ["obrigatoria","opcional","nao_aplicavel"];',
  'var RECEITA_CAMPOS_RESERVADOS = ["L","A","P","e"];',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { planProdSalvar: planProdSalvar, getProdData: function(){ return _PLAN_PROD_DATA; }, resetProdData: function(){ _PLAN_PROD_DATA = []; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_2026-09-09_bloco5_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', checked: false, dataset: {}, querySelectorAll: function () { return []; } }, props || {}); }
var _elements = {};
function reg(id, el) { _elements[id] = el; return el; }
global.window = global;
global.document = { getElementById: function (id) { return _elements[id]; } };
global.showToast = function (msg) { global.__lastToast = msg; };
global.cfgEsc = function (v) { return v == null ? '' : String(v); };
global._cloudSave = function () {};
global._cloudReady = false;
global.planProdFechar = function () {};
global.planProdRender = function () {};
global.orcRefreshProdSelects = function () {};
global.__PLAN_PROD_DATA__ = [];
global.__planProdPecas__ = [];
global.__planProdCampos__ = [];
global.__planProdEditId__ = null;
global.ORC_PRODUTOS = [];

reg('planProdNome', makeEl());
reg('planProdDesc', makeEl());
reg('planProdDim3d', makeEl({ checked: false }));
reg('planProdLabelL', makeEl());
reg('planProdLabelA', makeEl());
reg('planProdLabelP', makeEl());

// planProdReadPecas() lê as peças diretamente do DOM (#planProdPecasBody),
// SEMPRE reconstruindo _planProdPecas do zero a partir das linhas — para o
// teste refletir o array `global.__planProdPecas__` que cada caso seta,
// simulamos as linhas reais que planProdReadPecas() espera encontrar.
function makeFakeRow(peca) {
  var fields = { qty: peca.qty, nome: peca.nome, larg: peca.larg, alt: peca.alt, esp: peca.esp, tipo: peca.tipo };
  return {
    dataset: { src: peca.__src || null },
    querySelector: function (sel) {
      var m = /data-field="(\w+)"/.exec(sel);
      var f = m ? m[1] : null;
      return f && fields[f] != null ? { value: String(fields[f]) } : null;
    }
  };
}
var _planProdPecasBody = makeEl({ querySelectorAll: function () { return (global.__planProdPecas__ || []).map(makeFakeRow); } });
reg('planProdPecasBody', _planProdPecasBody);

var mod = require(modPath);

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-09 — Bloco 5: Produtos Padrão simples (sem receita) ===\n');

test('BLOCO 5 — produto SEM peças/receita salva com sucesso (nome + ativo, sem planificação obrigatória)', function () {
  _elements['planProdNome'].value = 'Cartão de Visita TESTE';
  _elements['planProdDesc'].value = 'Cadastro comercial simples, sem planificação';
  global.__lastToast = null;
  mod.planProdSalvar();
  var lista = mod.getProdData();
  var criado = lista.find(function (p) { return p.nome === 'Cartão de Visita TESTE'; });
  assertTrue(!!criado, 'BUG: produto sem peças deveria ter sido salvo em _PLAN_PROD_DATA');
  assertEq(criado.pecas, [], 'produto simples deve persistir com pecas:[]');
  assertEq(criado.ativo, 1, 'produto novo nasce ativo');
});

test('BLOCO 5 — REGRESSÃO: produto com peça incompleta (fórmula em branco) continua bloqueado', function () {
  mod.resetProdData();
  global.__planProdPecas__.length = 0;
  global.__planProdPecas__.push({ qty: 1, nome: 'Tampo', larg: '', alt: 'L', esp: '', tipo: '' });
  global.__planProdEditId__ = null;
  _elements['planProdNome'].value = 'Produto Incompleto TESTE';
  global.__lastToast = null;
  mod.planProdSalvar();
  var lista = mod.getProdData();
  assertEq(lista.length, 0, 'BUG DE REGRESSÃO: produto com fórmula em branco não pode ser salvo silenciosamente');
  assertTrue(/fórmulas/.test(global.__lastToast || ''), 'deve mostrar aviso pedindo para preencher a fórmula ou remover a peça');
});

test('BLOCO 5 — REGRESSÃO: produto com peças TODAS preenchidas continua funcionando normalmente', function () {
  mod.resetProdData();
  global.__planProdPecas__.length = 0;
  global.__planProdPecas__.push({ qty: 1, nome: 'Tampo', larg: 'L', alt: 'A', esp: '', tipo: '' });
  global.__planProdEditId__ = null;
  _elements['planProdNome'].value = 'Produto Completo TESTE';
  global.__lastToast = null;
  mod.planProdSalvar();
  var lista = mod.getProdData();
  var criado = lista.find(function (p) { return p.nome === 'Produto Completo TESTE'; });
  assertTrue(!!criado, 'produto com peças válidas deve continuar salvando normalmente');
  assertEq(criado.pecas.length, 1, 'peça válida deve ser persistida');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
