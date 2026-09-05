/**
 * test_estabilizacao_bloco2_planificacao_zerada_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 2 — "abrir a Planificação
 * durante edição mostra 0 peças / 0 m² / R$0", mesmo quando a linha do
 * orçamento já mostra corretamente "Planificado · N peças · X m²".
 *
 * Causa raiz confirmada (investigação desta rodada): planAbrir() só
 * chamava planCalc() quando row.dataset.planLarg/planAlt existiam
 * (`if(savedLarg && savedAlt) planCalc();`). Se esses dois campos não
 * foram restaurados por qualquer motivo (dado legado, gap de
 * persistência), o modal ficava parado no estado inicial "Preencha as
 * dimensões" e NUNCA lia row.dataset.planPecas — o snapshot que a tag da
 * linha já usa para mostrar "N peças · X m²" corretamente.
 *
 * Corrigido: planCalc() ganhou um caminho de hidratação DIRETA do
 * snapshot persistido (_planHidratarDireto) quando L/A/P estão ausentes
 * mas HÁ planificação salva; planAbrir() chama planCalc() também nesse
 * caso. Item genuinamente nunca planificado continua mostrando o aviso
 * "Preencha as dimensões" — zero mudança de comportamento aí.
 *
 * Reaproveita o harness/DOM fake de
 * test_hotfix_planificacao_peca_excluida_2026-08-16.js (mesma receita
 * real 'Caixa' de PLAN_RECIPES, nunca uma receita fake).
 *
 * Uso: node scripts/test_estabilizacao_bloco2_planificacao_zerada_2026-09-04.js
 */
'use strict';
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
  'orcAutoLaserSeNecessario', 'orcAutoLaser'
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
var modPath = path.join(__dirname, '_estabilizacao_bloco2_planificacao_zerada_extracted.tmp.js');
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
global.planProdLoad = function () { return []; };
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
function row(idx) { return _elements['oir_' + idx]; }
function pecasEfetivas() { return mod.getPlanEditPieces().filter(function (p) { return !p._deleted; }); }
function totalQty(arr) { return arr.reduce(function (s, p) { return s + p.qty; }, 0); }

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 2 — planificação não abre mais zerada ===\n');

test('1. Reproduz o bug no cenário real: item planificado (Caixa 20x20x20), mas dataset.planLarg/planAlt/planProf AUSENTES (planLarg vazios, ex.: dado legado) — reabrir o modal NÃO mostra 0 peças/0 m²', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  mod.planAplicar();

  var pecasSalvas = row(0).dataset.planPecas;
  assertTrue(pecasSalvas && pecasSalvas !== '[]', 'pré-condição: snapshot persistido tem peças');

  // Simula "reabertura" com planLarg/planAlt/planProf ausentes (o gap real
  // investigado) — só planPecas sobrevive, exatamente como a tag da linha
  // do orçamento (que lê o dataset intacto) continua mostrando certo.
  delete _elements['oir_0'];
  var rowNova = registerItem(0, 'Caixa');
  rowNova.dataset.planPecas = pecasSalvas;
  // propositalmente NÃO copia planLarg/planAlt/planProf — reproduz o gap
  _elements['planLarg'].value = '';
  _elements['planAlt'].value = '';
  _elements['planProf'].value = '';
  _elements['oi_larg_0'].value = '';
  _elements['oi_alt_0'].value = '';

  abrir(0);

  var efetivas = pecasEfetivas();
  assertTrue(efetivas.length > 0, 'BUG: modal abriu com 0 peças mesmo havendo snapshot persistido');
  assertEq(totalQty(efetivas), 6, 'total de peças deve ser o mesmo do snapshot original (6)');
  assertTrue(_elements['planSumBox'].style.display !== 'none', 'caixa de resumo (planSumBox) deve estar visível, não escondida');
  assertTrue(parseFloat(_elements['planSumBox'].dataset.totalArea) > 0, 'área total não pode ser 0');
  assertTrue(/R\$\s*[1-9]/.test(_elements['planSumCusto'].textContent), 'custo do material exibido não pode ser R$0');
  assertTrue(/R\$\s*[1-9]/.test(_elements['planSumVenda'].textContent), 'preço de venda exibido não pode ser R$0');
});

test('2. Nomes e medidas das peças hidratadas batem com o snapshot persistido (não são reconstruídas do zero)', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(22, 18, 15);
  mod.planCalc();
  mod.planAplicar();
  var pecasSalvas = row(0).dataset.planPecas;
  var pecasSalvasArr = JSON.parse(pecasSalvas);

  delete _elements['oir_0'];
  var rowNova = registerItem(0, 'Caixa');
  rowNova.dataset.planPecas = pecasSalvas;
  _elements['planLarg'].value = '';
  _elements['planAlt'].value = '';
  _elements['planProf'].value = '';

  abrir(0);
  var efetivas = pecasEfetivas();
  var nomesEfetivos = efetivas.map(function (p) { return p.nome; }).sort();
  var nomesSalvos = pecasSalvasArr.filter(function (p) { return p.origem === 'AUTOMATICA'; }).map(function (p) { return p.nome; }).sort();
  assertEq(nomesEfetivos, nomesSalvos, 'nomes das peças hidratadas devem ser exatamente os do snapshot');

  var baseSalva = pecasSalvasArr.find(function (p) { return p.nome === 'Base'; });
  var baseHidratada = efetivas.find(function (p) { return p.nome === 'Base'; });
  assertEq(baseHidratada.larg, baseSalva.larg, 'largura da Base hidratada deve ser a persistida (22x18x15), não recalculada');
  assertEq(baseHidratada.alt, baseSalva.alt, 'altura da Base hidratada deve ser a persistida');
});

test('3. REGRESSÃO — item GENUINAMENTE nunca planificado (sem planPecas nenhum) continua mostrando "Preencha as dimensões" (zero mudança de comportamento)', function () {
  registerItem(1, 'Caixa');
  abrir(1);
  // L/A/P vazios, dataset.planPecas nunca existiu
  assertEq(_elements['planSumBox'].style.display, 'none', 'sumBox deve continuar escondida para item nunca planificado');
  assertTrue(_elements['planAplicarBtn'].disabled === true, 'botão Aplicar deve continuar desabilitado');
  assertEq(mod.getPlanEditPieces().length, 0, '_planEditPieces deve continuar vazio — nada para hidratar');
});

test('4. REGRESSÃO — fluxo normal (planLarg/planAlt presentes) continua idêntico: abrir → editar → aplicar → fechar → reabrir', function () {
  registerItem(2, 'Caixa');
  abrir(2);
  setDims(20, 20, 20);
  mod.planCalc();
  mod.planAplicar();
  mod.planFechar();
  abrir(2); // agora COM planLarg/planAlt/planProf presentes (caminho normal)
  assertEq(totalQty(pecasEfetivas()), 6, 'fluxo normal (planLarg/planAlt presentes) continua reidratando 6 peças');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
