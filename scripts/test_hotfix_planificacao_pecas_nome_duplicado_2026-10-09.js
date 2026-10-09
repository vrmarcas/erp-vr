/**
 * test_hotfix_planificacao_pecas_nome_duplicado_2026-10-09.js
 *
 * HOTFIX CIRÚRGICO 2026-10-09 — P0 ABSOLUTO. Bug real reproduzido
 * visualmente em produção: um item com receita (built-in ou produto
 * customizado em Produtos & Planificação) que gera DUAS peças automáticas
 * com o MESMO nome (ex.: duas peças "Lateral", de pares diferentes da
 * geometria). Estado inicial: Lateral(qtd2,20×5) + Lateral(qtd2,20×5) +
 * Tampa(qtd1,20×20) = 5 peças, 0,0800 m². Excluir UMA das Laterais deixa
 * Lateral + Tampa = 3 peças, 0,0600 m² (correto). Ao clicar
 * "+ Adicionar Peça" em seguida, a Lateral restante desaparecia sozinha
 * — sobrava só a Tampa — reduzindo área/preço silenciosamente.
 *
 * Causa raiz (achada por auditoria estática de index.html, não suposição):
 * _planReconcilePieces()/_planSeedFromPersisted()/_planHidratarDireto()
 * identificavam cada peça automática só por `'auto_' + slug(nome)`. Duas
 * peças com o mesmo nome colidem no MESMO id; `prevByKey[id]` (um objeto
 * JS comum) só guarda a ÚLTIMA peça processada com aquele id no forEach —
 * então, na reconciliação seguinte (disparada por planAddManual/
 * _planCalcAndMerge, por qualquer edição, ou por recálculo), AMBAS as
 * peças com o nome duplicado herdavam o `_deleted` de uma só delas.
 *
 * Corrigido: as três funções agora desambiguam peças de mesmo nome por
 * ORDEM DE OCORRÊNCIA dentro do array da receita (1ª ocorrência mantém o
 * id de sempre — compatível com qualquer item já salvo antes desta
 * correção —, a 2ª vira 'auto_<slug>_2', a 3ª 'auto_<slug>_3' etc.), nunca
 * pelo índice bruto do array (que mudaria a cada exclusão/edição).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas) — usa
 * um produto CUSTOM real (mesmo formato gravado por Produtos &
 * Planificação), não uma receita fake fora do formato real.
 *
 * Uso: node scripts/test_hotfix_planificacao_pecas_nome_duplicado_2026-10-09.js
 */
'use strict';
require(require('path').join(__dirname, '_comparativo_shim.js'));
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
function assertApprox(got, exp, msg, eps) {
  if (Math.abs(got - exp) > (eps || 0.0001)) throw new Error((msg || 'valores diferentes') + ' — esperado ~' + exp + ', obtido ' + got);
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
function extractVar(name) {
  var marker = 'var ' + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1) + ';';
}
function extractBetween(startMarker, endMarker) {
  var start = html.indexOf(startMarker);
  if (start < 0) throw new Error('Marcador de início não encontrado: ' + startMarker);
  var end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Marcador de fim não encontrado: ' + endMarker);
  return html.slice(start, end + endMarker.length);
}

var FN_NAMES = [
  '_planAtualizarLabelsDim',
  'orcProdutoNomeResolvido',
  'planGetRecipe', '_matGetRsm2', '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', '_planPecaAdesivos', '_planDeltaEspecificoPecas', '_planConsumiveisChip', '_planConsumiveisCelulaHtml', 'planAbrir', 'planFechar', 'planCalc',
  'planAplicar', 'planLimpar', '_planDeleteAuto', '_planEditField',
  '_planRecompute', 'planAddManual', 'planRemoveManual', 'planRenderManual',
  '_planCalcAndMerge', '_planPieceSlug', '_planReconcilePieces',
  '_planSeedFromPersisted', '_planHidratarDireto', '_planBuildAllPecas',
  'planRenderCamposExtras', 'planLerCamposExtras', 'receitaCamposEfetivos', 'receitaCamposContexto',
  'orcAutoLaserSeNecessario', 'orcAutoLaser',
  'planEvalFormulaCtx', 'receitaFormulaAvaliar', 'receitaFormulaTokenizar', 'receitaFormulaParsear',
  'receitaResolverParaCalculo', 'receitaSnapshotParaItem'
];
var wrapBlock = extractBetween(
  '// Wrap planCalc to also merge manual pieces if any exist',
  "planAbrir = function(i){ planManualPieces=[]; planRenderManual(); _origAbrir(i); };"
);
var planRecipesSrc = extractVar('PLAN_RECIPES');

var src = [
  'var _planIdx = null;',
  'var planManualPieces = [];',
  'var _planEditPieces = [];',
  'var _planSeedPersistedJson = null;',
  planRecipesSrc,
  FN_NAMES.map(extractFn).join('\n\n'),
  wrapBlock,
  'module.exports = {',
  '  planAbrir: planAbrir, planFechar: planFechar, planCalc: planCalc,',
  '  planAplicar: planAplicar, planLimpar: planLimpar,',
  '  _planDeleteAuto: _planDeleteAuto, _planEditField: _planEditField,',
  '  _planRecompute: _planRecompute, planAddManual: planAddManual,',
  '  planRemoveManual: planRemoveManual, planRenderManual: planRenderManual,',
  '  _planCalcAndMerge: _planCalcAndMerge,',
  '  getPlanIdx: function(){ return _planIdx; },',
  '  getPlanManualPieces: function(){ return planManualPieces; },',
  '  getPlanEditPieces: function(){ return _planEditPieces; }',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_planificacao_pecas_nome_duplicado_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo (mesmo padrão de test_hotfix_planificacao_peca_excluida_2026-08-16.js) ──
function makeEl(props) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    disabled: false, classList: { add: function () {}, contains: function () { return false; } },
    closest: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    setAttribute: function (k, v) { this[k] = v; },
    appendChild: function () {},
    options: [], selectedIndex: 0
  }, props || {});
}
var _elements = {};
function reg(id, el) { _elements[id] = el; return el; }

global.window = global;
global.document = {
  getElementById: function (id) { return _elements[id]; },
  querySelectorAll: function () { return []; },
  body: { classList: { contains: function () { return false; } } },
  createElement: function () { return makeEl(); }
};
global.showToast = function () {};
global.cfgEsc = function (v) { return v == null ? '' : String(v); };
global.planDrawCanvas = function () {};
global.ORC_MATS = [{ key: 'cfg_0', label: 'Acrílico Cristal 3mm', esp: 3 }];
global._cfgData = { financeiro: {} };
global.cfgLoad = function () { return { materiais: [] }; };
// Produto CUSTOM real (mesmo formato persistido por Produtos & Planificação)
// — duas peças automáticas com o MESMO nome "Lateral", exatamente como no
// bug real reproduzido em produção.
var CUSTOM_PRODUTO = {
  nome: 'Bandeja com Duas Laterais',
  dim3d: true,
  pecas: [
    { nome: 'Lateral', qty: 2, larg: '20', alt: '5' },
    { nome: 'Lateral', qty: 2, larg: '20', alt: '5' },
    { nome: 'Tampa',   qty: 1, larg: '20', alt: '20' }
  ]
};
global.planProdLoad = function () { return [CUSTOM_PRODUTO]; };
global._planGetEspOptions = function () { return [{ espMm: 3, priceM2: 150, label: 'Acrílico Cristal' }, { espMm: 4, priceM2: 200, label: 'Acrílico Cristal' }]; };
global.orcRecalc = function () { global._orcRecalcCalls = (global._orcRecalcCalls || 0) + 1; };
global.setTimeout = function (fn) { if (typeof fn === 'function') fn(); };

reg('planModalTitle', makeEl());
reg('planInfoBox', makeEl());
reg('planProfWrap', makeEl());
reg('planPiecesBody', makeEl());
reg('planPiecesFoot', makeEl());
reg('planSumBox', makeEl({ dataset: {} }));
reg('planAplicarBtn', makeEl({ disabled: true }));
reg('planLarg', makeEl());
reg('planAlt', makeEl());
reg('planProf', makeEl());
reg('planCamposExtrasRow', makeEl());
reg('planCamposExtrasAviso', makeEl());
reg('planManualWrap', makeEl());
reg('planManualHint', makeEl());
reg('planModal', makeEl());
reg('planLayoutBox', makeEl({ style: { display: '' } }));
reg('planCanvas', makeEl({ width: 0, height: 0, getContext: function () { return { clearRect: function () {} }; } }));
reg('planLayoutLegenda', makeEl());
reg('planSumArea', makeEl());
reg('planSumPecas', makeEl());
reg('planSumProporcao', makeEl());
reg('planSumCusto', makeEl());
reg('planSumVenda', makeEl());
reg('planSumFormula', makeEl());
reg('planEspBreakdown', makeEl());

function registerItem(idx, produto) {
  reg('oi_prod_' + idx, makeEl({ value: produto }));
  reg('oi_esp_' + idx, makeEl({ value: '3' }));
  reg('oi_mat_' + idx, makeEl({ value: 'cfg_0', dataset: { rsm2: '150' } }));
  reg('oi_larg_' + idx, makeEl());
  reg('oi_alt_' + idx, makeEl());
  return reg('oir_' + idx, makeEl({ dataset: {} }));
}

var mod = require(modPath);
function abrir(idx) { mod.planAbrir(idx); }
function setDims(larg, alt, prof) {
  _elements['planLarg'].value = String(larg);
  _elements['planAlt'].value = String(alt);
  if (prof != null) _elements['planProf'].value = String(prof);
}
function pecasEfetivas() { return mod.getPlanEditPieces().filter(function (p) { return !p._deleted; }); }
function nomesEfetivos() { return pecasEfetivas().map(function (p) { return p.nome; }); }
function totalQty(arr) { return arr.reduce(function (s, p) { return s + p.qty; }, 0); }
function totalArea(arr) { return arr.reduce(function (s, p) { return s + (p.larg * p.alt * p.qty); }, 0); }

console.log('\n=== HOTFIX 2026-10-09 (P0) — duas peças de mesmo nome ("Lateral") não podem se confundir ===\n');

test('1. receita do produto custom gera 5 peças físicas (2 Lateral + 2 Lateral + 1 Tampa), 0,0800 m²', function () {
  registerItem(0, CUSTOM_PRODUTO.nome);
  abrir(0);
  setDims(20, 20, 5);
  mod.planCalc();
  assertEq(totalQty(pecasEfetivas()), 5, 'estado inicial deve somar 5 peças físicas');
  assertApprox(totalArea(pecasEfetivas()) / 10000, 0.08, 'área inicial deve ser 0,0800 m²');
  var pecas = mod.getPlanEditPieces();
  assertEq(pecas.length, 3, 'array deve ter 3 entradas (Lateral, Lateral, Tampa)');
  assertTrue(pecas[0].id !== pecas[1].id, 'as duas peças "Lateral" devem ter IDs DIFERENTES (identidade estável, nunca colidir por nome)');
});

test('2. excluir a 2ª Lateral → sobram Lateral(1ª) + Tampa = 3 peças, 0,0600 m²', function () {
  registerItem(0, CUSTOM_PRODUTO.nome);
  abrir(0);
  setDims(20, 20, 5);
  mod.planCalc();

  mod._planDeleteAuto(1); // exclui a 2ª peça "Lateral" (índice 1 do array)

  assertEq(totalQty(pecasEfetivas()), 3, 'após excluir uma Lateral devem restar 3 peças físicas');
  assertApprox(totalArea(pecasEfetivas()) / 10000, 0.06, 'área após exclusão deve ser 0,0600 m²');
  assertEq(nomesEfetivos().filter(function (n) { return n === 'Lateral'; }).length, 1, 'deve restar exatamente 1 peça "Lateral" visível');
  assertTrue(nomesEfetivos().indexOf('Tampa') >= 0, 'Tampa deve continuar visível');
});

test('3. P0 — clicar "+ Adicionar Peça" NÃO pode apagar a Lateral restante (bug real de produção)', function () {
  registerItem(0, CUSTOM_PRODUTO.nome);
  abrir(0);
  setDims(20, 20, 5);
  mod.planCalc();
  mod._planDeleteAuto(1);

  mod.planAddManual(); // "+ Adicionar Peça" — dispara _planCalcAndMerge() → reconciliação

  assertEq(nomesEfetivos().filter(function (n) { return n === 'Lateral'; }).length, 1,
    'a Lateral restante NÃO pode desaparecer ao adicionar peça extra (bug real: as duas Laterais colidiam no mesmo id e ambas herdavam o _deleted de uma só)');
  assertTrue(nomesEfetivos().indexOf('Tampa') >= 0, 'Tampa deve continuar visível após adicionar peça extra');
  assertEq(totalQty(pecasEfetivas()), 3, 'total de peças automáticas continua 3 (a peça extra vazia não soma área ainda)');
  assertApprox(totalArea(pecasEfetivas()) / 10000, 0.06, 'área continua 0,0600 m² — não pode cair sozinha ao adicionar peça extra');
});

test('4. preencher a peça extra aumenta a área corretamente, sem afetar as automáticas', function () {
  registerItem(0, CUSTOM_PRODUTO.nome);
  abrir(0);
  setDims(20, 20, 5);
  mod.planCalc();
  mod._planDeleteAuto(1);
  mod.planAddManual();

  var mi = mod.getPlanManualPieces().length - 1;
  Object.assign(mod.getPlanManualPieces()[mi], { nome: 'Peça extra 1', larg: 10, alt: 10, qty: 1 });
  mod._planCalcAndMerge();

  assertEq(nomesEfetivos().filter(function (n) { return n === 'Lateral'; }).length, 1, 'Lateral restante continua intacta após preencher a peça extra');
  assertTrue(nomesEfetivos().indexOf('Tampa') >= 0, 'Tampa continua intacta após preencher a peça extra');
  assertApprox(totalArea(pecasEfetivas()) / 10000, 0.06, 'área das automáticas continua 0,0600 m² (peça extra é somada separadamente pelo laser/preço final, não nesta lista)');
});

test('5. excluir a 1ª Lateral (em vez da 2ª) tem exatamente o mesmo resultado — isolamento simétrico', function () {
  registerItem(0, CUSTOM_PRODUTO.nome);
  abrir(0);
  setDims(20, 20, 5);
  mod.planCalc();

  mod._planDeleteAuto(0); // exclui a 1ª peça "Lateral" desta vez
  mod.planAddManual();

  assertEq(nomesEfetivos().filter(function (n) { return n === 'Lateral'; }).length, 1, 'a Lateral restante (a 2ª) não pode desaparecer');
  assertTrue(nomesEfetivos().indexOf('Tampa') >= 0, 'Tampa deve continuar visível');
  assertApprox(totalArea(pecasEfetivas()) / 10000, 0.06, 'área deve continuar 0,0600 m²');
});

test('6. salvar (planAplicar) e reabrir preserva exatamente as mesmas peças (sem ids colidindo no snapshot)', function () {
  registerItem(0, CUSTOM_PRODUTO.nome);
  abrir(0);
  setDims(20, 20, 5);
  mod.planCalc();
  mod._planDeleteAuto(1);
  mod.planAplicar();

  var row = _elements['oir_0'];
  var pecasSalvas = JSON.parse(row.dataset.planPecas);
  assertEq(pecasSalvas.filter(function (p) { return p.nome === 'Lateral'; }).length, 1, 'snapshot persistido deve conter exatamente 1 "Lateral"');

  mod.planFechar();
  abrir(0);
  assertEq(nomesEfetivos().filter(function (n) { return n === 'Lateral'; }).length, 1, 'reabrir deve mostrar exatamente 1 "Lateral", nunca 0 nem 2');
  assertTrue(nomesEfetivos().indexOf('Tampa') >= 0, 'Tampa deve continuar presente ao reabrir');
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
fs.unlinkSync(modPath);
if (failed > 0) process.exitCode = 1;
