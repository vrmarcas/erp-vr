/**
 * test_planificacao_manual.js
 * Regressão do bug real encontrado na Homologação Fase F (2026-08-05):
 * planSumBox (elemento DOM único, reaproveitado entre TODOS os itens do
 * orçamento no wizard de planificação) não zerava dataset.planManualMatCost /
 * dataset.planManualAreaM2 quando o item corrente não tinha peça manual,
 * então herdava os valores deixados pelo item ANTERIOR — corrompendo custo,
 * área e preço do item errado.
 *
 * Funções sob teste (extraídas de index.html via contagem de chaves — mesma
 * técnica de test_orcamento_pdf_whatsapp.js — não reimplementadas):
 * planGetRecipe, _matGetRsm2, planAbrir, planFechar, planCalc, planAplicar,
 * planLimpar, _planDeleteAuto, _planEditField, _planRecompute, planAddManual,
 * planRemoveManual, planRenderManual, _planCalcAndMerge — incluindo o bloco
 * de wrap (planCalc/planFechar/planAbrir reatribuídos no fim do arquivo).
 *
 * Uso: node scripts/test_planificacao_manual.js
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
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }
function assertApprox(got, exp, msg) {
  if (!approx(got, exp)) throw new Error((msg || 'valores diferentes') + ' — esperado ~' + exp + ', obtido ' + got);
}

// ── Extração por contagem de chaves balanceadas ─────────────────────────────
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}
function extractBetween(startMarker, endMarker) {
  var start = html.indexOf(startMarker);
  if (start < 0) throw new Error('Marcador de início não encontrado: ' + startMarker);
  var end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Marcador de fim não encontrado: ' + endMarker);
  return html.slice(start, end + endMarker.length);
}

var FN_NAMES = [
  'planGetRecipe', '_matGetRsm2', 'planAbrir', 'planFechar', 'planCalc',
  'planAplicar', 'planLimpar', '_planDeleteAuto', '_planEditField',
  '_planRecompute', 'planAddManual', 'planRemoveManual', 'planRenderManual',
  '_planCalcAndMerge'
];
var wrapBlock = extractBetween(
  '// Wrap planCalc to also merge manual pieces if any exist',
  "planAbrir = function(i){ planManualPieces=[]; planRenderManual(); _origAbrir(i); };"
);

var src = [
  'var _planIdx = null;',
  'var planManualPieces = [];',
  'var _planEditPieces = [];',
  FN_NAMES.map(extractFn).join('\n\n'),
  wrapBlock,
  // acessores só para o teste — leem o valor ATUAL das vars do módulo,
  // já que planAbrir/planFechar reatribuem planManualPieces (var = [])
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
var modPath = path.join(__dirname, '_planificacao_manual_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo ─────────────────────────────────────────────────────────
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
global.planDrawCanvas = function () {};
global.ORC_MATS = [];
global._cfgData = {};
global.cfgLoad = function () { return { materiais: [] }; };
global.PLAN_RECIPES = {};
global.planProdLoad = function () { return []; };
global._planGetEspOptions = function () { return []; };
global.orcRecalc = function () {};
global.setTimeout = function () {}; // não deixamos planDrawCanvas/timers assíncronos vazarem entre testes

// modal singleton (compartilhado entre itens — é assim que o app funciona:
// um único modal reaberto por item, nunca dois abertos ao mesmo tempo)
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
reg('planManualWrap', makeEl());
reg('planManualHint', makeEl());
reg('planModal', makeEl());
reg('planSumArea', makeEl());
reg('planSumPecas', makeEl());
reg('planSumProporcao', makeEl());
reg('planSumCusto', makeEl());
reg('planSumVenda', makeEl());
reg('planSumFormula', makeEl());
reg('planEspBreakdown', makeEl());

// duas linhas de item do orçamento, cada uma com seu próprio estado
function registerItem(idx, produto, matRsm2) {
  reg('oi_prod_' + idx, makeEl({ value: produto }));
  reg('oi_esp_' + idx, makeEl({ value: '3' }));
  reg('oi_mat_' + idx, makeEl({ value: 'cfg_0', dataset: { rsm2: String(matRsm2) } }));
  reg('oi_larg_' + idx, makeEl());
  reg('oi_alt_' + idx, makeEl());
  return reg('oir_' + idx, makeEl({ dataset: {} }));
}

var mod = require(modPath);

function abrir(idx) { mod.planAbrir(idx); }
function setDims(larg, alt) { _elements['planLarg'].value = String(larg); _elements['planAlt'].value = String(alt); }
function addManual(larg, alt, qty, precoM2) {
  mod.planAddManual();
  var i = mod.getPlanManualPieces().length - 1;
  mod.getPlanManualPieces()[i].larg = larg;
  mod.getPlanManualPieces()[i].alt = alt;
  mod.getPlanManualPieces()[i].qty = qty || 1;
  if (precoM2 != null) mod.getPlanManualPieces()[i].precoM2 = precoM2;
}
function row(idx) { return _elements['oir_' + idx]; }

// Fórmula real de custo por item, replicada de orcRecalc() (index.html ~8149-8152)
// só para comparação independente ("cálculo manual"), não reimplementação da
// lógica sob teste.
function custoEsperado(useAreaM2Cm2, priceM2, manualMatCost, manualAreaM2, qty) {
  var baseAreaM2 = Math.max(0, useAreaM2Cm2 / 10000 - manualAreaM2);
  return (baseAreaM2 * priceM2 + manualMatCost) * (qty || 1);
}

console.log('\n=== Regressão: vazamento de peça manual entre itens do orçamento (Fase F) ===\n');

// ── Cenário 1: item1 com peça manual, item2 sem peça manual ────────────────
test('1. item1 com peça manual, item2 sem — item2 não herda custo/área do item1', function () {
  registerItem(0, 'Painel A', 150);
  registerItem(1, 'Painel B', 150);

  abrir(0);
  setDims(100, 100); // 1 m² de peça automática
  mod.planCalc();
  addManual(50, 50, 1, 200); // peça manual 0.25 m² a R$200/m²
  mod._planCalcAndMerge();
  mod.planAplicar();

  assertApprox(parseFloat(row(0).dataset.planManualMatCost), 0.25 * 200, 'item1 deve reter custo manual');
  assertApprox(parseFloat(row(0).dataset.planManualAreaM2), 0.25, 'item1 deve reter área manual');

  abrir(1);
  setDims(80, 80); // item2 não recebe peça manual nenhuma
  mod.planCalc();
  mod.planAplicar();

  assertEq(parseFloat(row(1).dataset.planManualMatCost), 0, 'item2 (sem peça manual) deve zerar custo manual');
  assertEq(parseFloat(row(1).dataset.planManualAreaM2), 0, 'item2 (sem peça manual) deve zerar área manual');
  // item1 continua intacto após abrir/fechar item2
  assertApprox(parseFloat(row(0).dataset.planManualMatCost), 0.25 * 200, 'item1 não pode ser afetado por item2');
});

// ── Cenário 2: item1 sem peça manual, item2 com peça manual (ordem inversa) ─
test('2. item1 sem peça manual, item2 com — ordem inversa não vaza', function () {
  registerItem(0, 'Painel C', 100);
  registerItem(1, 'Painel D', 100);

  abrir(1);
  setDims(60, 60);
  mod.planCalc();
  addManual(30, 20, 2, 90);
  mod._planCalcAndMerge();
  mod.planAplicar();
  assertApprox(parseFloat(row(1).dataset.planManualMatCost), (30 * 20 * 2 / 10000) * 90, 'item2 retém custo manual');

  abrir(0);
  setDims(40, 40);
  mod.planCalc();
  mod.planAplicar();
  assertEq(parseFloat(row(0).dataset.planManualMatCost), 0, 'item1 aberto depois não herda custo manual do item2');
  assertEq(parseFloat(row(0).dataset.planManualAreaM2), 0, 'item1 aberto depois não herda área manual do item2');
});

// ── Cenário 3: alterar item1 não deve afetar item2 já aplicado ─────────────
test('3. reabrir e alterar item1 não modifica item2', function () {
  registerItem(0, 'Painel E', 120);
  registerItem(1, 'Painel F', 120);

  abrir(0);
  setDims(50, 50);
  mod.planCalc();
  addManual(10, 10, 1, 300);
  mod._planCalcAndMerge();
  mod.planAplicar();

  abrir(1);
  setDims(70, 70);
  mod.planCalc();
  mod.planAplicar();
  var item2Antes = { custo: row(1).dataset.planManualMatCost, area: row(1).dataset.planManualAreaM2, planArea: row(1).dataset.planArea };

  // reabre item1, adiciona uma segunda peça manual e reaplica
  abrir(0);
  addManual(15, 15, 1, 250);
  mod._planCalcAndMerge();
  mod.planAplicar();

  assertEq(row(1).dataset.planManualMatCost, item2Antes.custo, 'item2 deve permanecer inalterado após editar item1');
  assertEq(row(1).dataset.planManualAreaM2, item2Antes.area, 'item2 deve permanecer inalterado após editar item1');
  assertEq(row(1).dataset.planArea, item2Antes.planArea, 'área total de item2 deve permanecer inalterada');
});

// ── Cenário 4: exclusão/reordenação — dataset vive no próprio nó da linha ──
test('4. dataset de planificação vive na linha (oir_idx), não em índice global — exclusão/reordenação não cruza dados', function () {
  registerItem(0, 'Painel G', 100);
  registerItem(1, 'Painel H', 100);
  abrir(0); setDims(30, 30); mod.planCalc(); addManual(5, 5, 1, 100); mod._planCalcAndMerge(); mod.planAplicar();
  abrir(1); setDims(20, 20); mod.planCalc(); mod.planAplicar();
  if (row(0) === row(1)) throw new Error('linhas de item1 e item2 não podem compartilhar o mesmo nó DOM');
  if (row(0).dataset === row(1).dataset) throw new Error('dataset de item1 e item2 não podem ser o mesmo objeto');
  // "excluir" item1 = remover o nó — item2 não é afetado pois seu dataset é outro objeto
  delete _elements['oir_0'];
  assertEq(parseFloat(row(1).dataset.planManualMatCost), 0, 'item2 permanece correto após remoção do nó de item1');
});

// ── Cenário 5: salvar e restaurar rascunho (reabrir item já planificado) ───
test('5. reabrir item com peça manual salva restaura o mesmo estado (sem herdar do último item aberto)', function () {
  registerItem(0, 'Painel I', 100);
  registerItem(1, 'Painel J', 100);

  abrir(0);
  setDims(40, 40);
  mod.planCalc();
  addManual(8, 8, 1, 500);
  mod._planCalcAndMerge();
  mod.planAplicar();
  var custoOriginal = row(0).dataset.planManualMatCost;

  // abre item2 (sem manual) — deixa o modal "sujo" antes de reabrir item1
  abrir(1);
  setDims(10, 10);
  mod.planCalc();
  mod.planAplicar();

  // reabre item1 — deve restaurar a peça manual salva em planPecasManual,
  // não herdar o estado zerado deixado pelo item2
  abrir(0);
  assertEq(mod.getPlanManualPieces().length, 1, 'peça manual salva de item1 deve ser restaurada ao reabrir');
  mod.planCalc();
  mod._planCalcAndMerge();
  assertEq(_elements['planSumBox'].dataset.planManualMatCost, custoOriginal, 'recalcular item1 restaurado reproduz o mesmo custo manual original');
});

// ── Cenário 6: round-trip de serialização (proxy para "refresh") ───────────
test('6. planPecasManual serializado (JSON) não cruza entre itens após round-trip', function () {
  registerItem(0, 'Painel K', 100);
  registerItem(1, 'Painel L', 100);

  abrir(0); setDims(25, 25); mod.planCalc(); addManual(5, 5, 1, 80); mod._planCalcAndMerge(); mod.planAplicar();
  abrir(1); setDims(15, 15); mod.planCalc(); mod.planAplicar();

  var serial0 = JSON.parse(row(0).dataset.planPecasManual);
  var serial1 = JSON.parse(row(1).dataset.planPecasManual);
  assertEq(serial0.length, 1, 'item1 serializado mantém 1 peça manual');
  assertEq(serial1.length, 0, 'item2 serializado não ganha peça manual nenhuma');
});

console.log('\n=== Nota sobre múltiplas abas ===');
console.log('  planManualPieces/_planIdx/_planEditPieces são variáveis de módulo do');
console.log('  script inline da página — cada aba do navegador tem seu próprio heap');
console.log('  JS isolado (sem BroadcastChannel/localStorage compartilhando esse');
console.log('  estado em memória), então duas abas não podem cruzar esse estado entre');
console.log('  si por construção. Não testável de forma significativa em processo Node');
console.log('  único; não reclassificado como testado.');

console.log('\n=== RESULTADO ===');
console.log(passed + ' passed, ' + failed + ' failed');
fs.unlinkSync(modPath);
process.exit(failed ? 1 : 0);
