/**
 * test_estabilizacao_2026-09-09_blocos_2_4_9.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-09 — cobre 3 bugs reportados em produção:
 *
 * BLOCO 4 — Caixa: Base e Tampa usavam Comprimento×Altura (L×P) em vez de
 * Comprimento×Largura (L×A) no layout/planificação. Causa: PLAN_RECIPES.Caixa
 * gerava as peças Base/Tampa com `alt:P` (P é rotulado "Altura" na UI —
 * ver _planAtualizarLabelsDim) em vez de `alt:A` ("Largura"). Corrigido em
 * index.html (receita 'Caixa').
 *
 * BLOCO 2 — layout mostrava espessura divergente da efetivamente usada no
 * item (ex.: "Chapa 3mm" com item em 2mm). Causa: planCalc() priorizava o
 * lookup em ORC_MATS (catálogo legado por key fixa) sobre o campo oi_esp_
 * (fonte real usada por orcRecalc()/orcMatChanged() para o cálculo).
 * Corrigido: oi_esp_ passa a ter prioridade.
 *
 * BLOCO 9 — preço unitário mudava sozinho sem qualquer alteração do
 * usuário. Causa: orcRefreshMatSelects(), chamado passivamente pelo
 * listener em tempo real de erp_config, chamava orcMatChanged(idx)
 * incondicionalmente sempre que o catálogo crescia (hasFewerOpts) — mesmo
 * para linhas que já tinham seleção/preço válidos — forçando orcRecalc()
 * com o preço/m² ATUAL do catálogo. Corrigido: só recalcula quando o select
 * estava genuinamente pendente (isPending); catálogo maior só atualiza a
 * lista de opções, sem reprecificar.
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_blocos_2_4_9.js
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
  'orcAutoLaserSeNecessario', 'orcAutoLaser',
  'orcRefreshMatSelects', 'orcMatChanged', '_planResincronizarPecasHerdadas',
  '_cfgMateriaisReais'
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
  'var orcItemCount = 0;',
  planRecipesSrc,
  FN_NAMES.map(extractFn).join('\n\n'),
  wrapBlock,
  'module.exports = {',
  '  planAbrir: planAbrir, planFechar: planFechar, planCalc: planCalc,',
  '  planAplicar: planAplicar, planLimpar: planLimpar,',
  '  orcRefreshMatSelects: orcRefreshMatSelects, orcMatChanged: orcMatChanged,',
  '  setOrcItemCount: function(n){ orcItemCount = n; },',
  '  getPlanIdx: function(){ return _planIdx; },',
  '  getPlanManualPieces: function(){ return planManualPieces; },',
  '  getPlanEditPieces: function(){ return _planEditPieces; }',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_2026-09-09_blocos_2_4_9_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo (mesmo padrão de test_estabilizacao_bloco2_planificacao_zerada_2026-09-04.js) ──
function makeEl(props) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    disabled: false, classList: { add: function () {}, contains: function () { return false; } },
    closest: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    setAttribute: function (k, v) { this[k] = v; },
    getAttribute: function (k) { return this[k]; },
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
global.ORC_MATS = [{ key: 'ac3', label: 'Acrílico Cristal 3mm', esp: 3 }];
global._cfgData = { financeiro: {}, materiais: [
  { id: 'm2', nome: 'Acrílico Cristal', esp: 2, rsm2: 120 },
  { id: 'm3', nome: 'Acrílico Cristal 3mm', esp: 3, rsm2: 150 }
] };
global.cfgLoad = function () { return global._cfgData; };
global._cfgDataLoaded = true;
global.planProdLoad = function () { return []; };
global._planGetEspOptions = function () { return [{ espMm: 2, priceM2: 120, label: 'Acrílico Cristal' }, { espMm: 3, priceM2: 150, label: 'Acrílico Cristal' }]; };
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
reg('planDescMontagemWrap', makeEl());
reg('planDescMontagem', makeEl());

function registerItem(idx, produto, espValue, matValue) {
  reg('oi_prod_' + idx, makeEl({ value: produto }));
  reg('oi_esp_' + idx, makeEl({ value: espValue != null ? String(espValue) : '2' }));
  reg('oi_mat_' + idx, makeEl({ value: matValue || 'cfg_0', dataset: { rsm2: '120', esp: '2', nome: 'Acrílico Cristal' } }));
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

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-09 — Blocos 2, 4 e 9 ===\n');

test('BLOCO 4 — Caixa: Base usa Comprimento×Largura (L×A), não Comprimento×Altura (L×P)', function () {
  registerItem(0, 'Caixa', 2, 'cfg_0');
  abrir(0);
  setDims(18.5, 12.5, 14); // Comprimento=18.5 (L), Largura=12.5 (A), Altura=14 (P)
  mod.planCalc();
  var base = pecasEfetivas().find(function (p) { return p.nome === 'Base'; });
  assertTrue(!!base, 'peça Base deve existir');
  assertEq(base.larg, 18.5, 'largura da Base deve ser o Comprimento (18.5)');
  assertEq(base.alt, 12.5, 'altura da Base deve ser a Largura (12.5) — NÃO a Altura (14)');
});

test('BLOCO 4 — Caixa: Tampa usa Comprimento×Largura (L×A), não Comprimento×Altura (L×P)', function () {
  registerItem(1, 'Caixa', 2, 'cfg_0');
  abrir(1);
  setDims(18.5, 12.5, 14);
  mod.planCalc();
  var tampa = pecasEfetivas().find(function (p) { return p.nome === 'Tampa'; });
  assertTrue(!!tampa, 'peça Tampa deve existir');
  assertEq(tampa.larg, 18.5, 'largura da Tampa deve ser o Comprimento (18.5)');
  assertEq(tampa.alt, 12.5, 'altura da Tampa deve ser a Largura (12.5) — NÃO a Altura (14)');
});

test('BLOCO 2 — planCalc() usa a espessura do campo oi_esp_ (fonte do cálculo), não o catálogo legado ORC_MATS', function () {
  // Item real = Acrílico Cristal 2mm (oi_esp_0 = '2'), mas matEl.value
  // coincide com a key legada 'ac3' (Acrílico Cristal 3mm) — cenário que
  // reproduzia o bug relatado ("cálculo em 2mm, layout mostra 3mm").
  registerItem(2, 'Caixa', 2, 'ac3');
  abrir(2);
  setDims(20, 20, 20);
  mod.planCalc();
  var pecas = pecasEfetivas();
  assertTrue(pecas.length > 0, 'deve haver peças calculadas');
  assertEq(pecas[0].esp, 2, 'espessura efetiva das peças deve ser 2mm (item real), não 3mm (catálogo legado)');
});

test('BLOCO 9 — orcRefreshMatSelects() NÃO reprecifica (orcRecalc) uma linha já válida quando só o catálogo cresceu', function () {
  mod.setOrcItemCount(1);
  registerItem(1, 'Caixa', 2, 'cfg_0');
  var sel = _elements['oi_mat_1'];
  sel.options = [
    { value: 'cfg_0', text: 'Acrílico Cristal 2mm', dataset: { nome: 'Acrílico Cristal', esp: '2', rsm2: '120' }, getAttribute: function (k) { return this.dataset[k.replace('data-', '')]; } },
    { value: 'cfg_1', text: 'Acrílico Cristal 3mm', dataset: { nome: 'Acrílico Cristal 3mm', esp: '3', rsm2: '150' }, getAttribute: function (k) { return this.dataset[k.replace('data-', '')]; } }
  ];
  sel.selectedIndex = 0;
  global.orcConstruirMatOpts = function () { return '<option value="cfg_0" data-nome="Acrílico Cristal" data-esp="2">Acrílico Cristal 2mm</option><option value="cfg_2" data-nome="Material Novo" data-esp="4">Material Novo 4mm</option>'; };
  // Simula "innerHTML" reconstruindo as options reais a partir do HTML novo
  var origInnerHTMLSetter = Object.getOwnPropertyDescriptor(sel, 'innerHTML');
  Object.defineProperty(sel, 'innerHTML', {
    set: function (html) {
      var opts = [];
      var re = /<option value="([^"]*)" data-nome="([^"]*)" data-esp="([^"]*)">([^<]*)<\/option>/g, m;
      while ((m = re.exec(html))) opts.push({ value: m[1], dataset: { nome: m[2], esp: m[3] }, text: m[4], getAttribute: function (k) { return this.dataset[k.replace('data-', '')]; } });
      sel.options = opts;
      sel.selectedIndex = 0;
    },
    get: function () { return ''; }
  });
  sel.options.length = 1; // simula "menos opções que o catálogo real" (hasFewerOpts)
  global._orcRecalcCalls = 0;
  mod.orcRefreshMatSelects();
  assertEq(global._orcRecalcCalls, 0, 'BUG: orcRecalc() não pode disparar (preço não pode mudar) quando a linha já tinha seleção válida — só o catálogo cresceu');
});

test('BLOCO 9 — orcRefreshMatSelects() AINDA recalcula quando o select estava genuinamente pendente (linha nova)', function () {
  mod.setOrcItemCount(1);
  registerItem(1, 'Caixa', 2, 'cfg_0');
  var sel = _elements['oi_mat_1'];
  sel.options = [{ value: 'pending', text: 'Carregando…', dataset: {}, getAttribute: function () { return ''; } }];
  sel.selectedIndex = 0;
  Object.defineProperty(sel, 'innerHTML', {
    set: function (html) {
      var opts = [];
      var re = /<option value="([^"]*)" data-nome="([^"]*)" data-esp="([^"]*)">([^<]*)<\/option>/g, m;
      while ((m = re.exec(html))) opts.push({ value: m[1], dataset: { nome: m[2], esp: m[3] }, text: m[4], getAttribute: function (k) { return this.dataset[k.replace('data-', '')]; } });
      sel.options = opts;
      sel.selectedIndex = 0;
    },
    get: function () { return ''; }
  });
  global.orcConstruirMatOpts = function () { return '<option value="cfg_0" data-nome="Acrílico Cristal" data-esp="2">Acrílico Cristal 2mm</option>'; };
  global._orcRecalcCalls = 0;
  mod.orcRefreshMatSelects();
  assertTrue(global._orcRecalcCalls > 0, 'select pendente (linha nova, nunca teve preço) precisa recalcular ao ganhar opções reais');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
