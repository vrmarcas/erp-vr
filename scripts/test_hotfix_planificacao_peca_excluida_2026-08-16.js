/**
 * test_hotfix_planificacao_peca_excluida_2026-08-16.js
 *
 * HOTFIX OPERACIONAL 2026-08-16 (P0.1-P0.4) — "peça excluída não pode
 * voltar". Bug real reproduzido em produção: numa Caixa 20x20x20 (receita
 * gera Lateral/Frente-Fundo/Base/Tampa), excluir a Tampa e depois fazer
 * quase qualquer coisa (adicionar peça manual, mudar dimensão, editar outra
 * peça, fechar/reabrir o modal, recarregar) fazia a Tampa reaparecer — e o
 * layout de corte não refletia a exclusão em tempo real.
 *
 * Causa raiz (achada por auditoria estática de index.html, não suposição):
 * planCalc()/_planCalcOrig() SUBSTITUÍA _planEditPieces inteiro a cada
 * chamada (`_planEditPieces = pieces.map(...)`), descartando qualquer flag
 * `_deleted`; e planAbrir() nunca lia o snapshot persistido
 * (row.dataset.planPecas) para semear o catálogo automático, sempre
 * re-derivando puro da receita. planDrawCanvas()/planExportSVG() liam
 * sumBox.dataset.pcs sem filtrar `_deleted`.
 *
 * Corrigido: _planEditPieces passa a ser reconciliado (nunca substituído)
 * via _planReconcilePieces() — identidade estável por slug do nome da peça
 * — preservando `_deleted`; planAbrir() semeia o catálogo do snapshot
 * persistido via _planSeedFromPersisted() (peça ausente no snapshot =
 * excluída) quando o item já foi aplicado antes; todo write de
 * sumBox.dataset.pcs filtra `_deleted`.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas) — usa
 * a RECEITA REAL 'Caixa' de PLAN_RECIPES, não uma receita fake.
 *
 * Uso: node scripts/test_hotfix_planificacao_peca_excluida_2026-08-16.js
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
function assertApprox(got, exp, msg, eps) {
  if (Math.abs(got - exp) > (eps || 0.01)) throw new Error((msg || 'valores diferentes') + ' — esperado ~' + exp + ', obtido ' + got);
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
  'planGetRecipe', '_matGetRsm2', '_matResolverPrecoFamiliaEspessura', '_planDeltaEspecificoPecas', '_planConsumiveisChip', '_planConsumiveisCelulaHtml', 'planAbrir', 'planFechar', 'planCalc',
  'planAplicar', 'planLimpar', '_planDeleteAuto', '_planEditField',
  '_planRecompute', 'planAddManual', 'planRemoveManual', 'planRenderManual',
  '_planCalcAndMerge', '_planPieceSlug', '_planReconcilePieces',
  '_planSeedFromPersisted', '_planBuildAllPecas',
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
var modPath = path.join(__dirname, '_hotfix_planificacao_peca_excluida_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo (mesmo padrão de test_planificacao_manual.js) ──────────
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
global.setTimeout = function () {};

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
function nomesEfetivos() { return pecasEfetivas().map(function (p) { return p.nome; }); }
function totalQty(arr) { return arr.reduce(function (s, p) { return s + p.qty; }, 0); }
function findPci(nome) {
  var arr = mod.getPlanEditPieces();
  for (var i = 0; i < arr.length; i++) if (arr[i].nome === nome) return i;
  throw new Error('peça "' + nome + '" não encontrada em _planEditPieces');
}
function excluirPeca(nome) { mod._planDeleteAuto(findPci(nome)); }

console.log('\n=== HOTFIX 2026-08-16 (P0.1-P0.4) — peça excluída não pode voltar (Caixa 20x20x20) ===\n');

// ── Cenário do prompt, passo a passo ────────────────────────────────────────
test('1-2. receita inicial da Caixa 20x20x20 = 6 peças (2 Lateral+2 Frente/Fundo+1 Base+1 Tampa); excluir Tampa → ficam 5', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  assertEq(totalQty(pecasEfetivas()), 6, 'receita inicial deve somar 6 peças físicas');
  assertTrue(nomesEfetivos().indexOf('Tampa') >= 0, 'Tampa deve existir antes da exclusão');

  excluirPeca('Tampa');
  assertEq(totalQty(pecasEfetivas()), 5, 'após excluir Tampa (qty 1) devem restar 5 peças');
  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'Tampa não pode aparecer nas peças efetivas');
});

test('3. adicionar Peça 1 manual 20x20 → ficam 6; Tampa NÃO reaparece', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  excluirPeca('Tampa');

  mod.planAddManual();
  var mi = mod.getPlanManualPieces().length - 1;
  mod.getPlanManualPieces()[mi].nome = 'Peça 1';
  mod.getPlanManualPieces()[mi].larg = 20;
  mod.getPlanManualPieces()[mi].alt = 20;
  mod.getPlanManualPieces()[mi].qty = 1;
  mod._planCalcAndMerge();

  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'Tampa NÃO pode reaparecer após adicionar peça manual (bug original)');
  var totalComManual = totalQty(pecasEfetivas()) + totalQty(mod.getPlanManualPieces());
  assertEq(totalComManual, 6, 'total (automáticas + manual) deve ser 6');
});

test('4. layout (sumBox.dataset.pcs) não contém Tampa; contém as demais peças automáticas', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  excluirPeca('Tampa');

  var pcs = JSON.parse(_elements['planSumBox'].dataset.pcs);
  var nomesPcs = pcs.map(function (p) { return p.nome; });
  assertTrue(nomesPcs.indexOf('Tampa') === -1, 'layout (dataset.pcs) não pode conter a peça excluída');
  assertTrue(nomesPcs.indexOf('Lateral') >= 0, 'layout deve continuar mostrando Lateral');
  assertTrue(nomesPcs.indexOf('Base') >= 0, 'layout deve continuar mostrando Base');
});

test('5. Tampa não retorna após: alterar qty/larg/alt de OUTRA peça, recalcular (planCalc de novo)', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  excluirPeca('Tampa');

  // alterar largura/altura/quantidade da Base (outra peça, via _planEditField)
  var pciBase = findPci('Base');
  mod._planEditField({ dataset: { planf: 'larg', pci: String(pciBase) }, value: '25' });
  mod._planEditField({ dataset: { planf: 'alt', pci: String(pciBase) }, value: '25' });
  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'Tampa não pode voltar após editar largura/altura de outra peça');

  // "recalcular" = chamar planCalc() de novo com as mesmas dimensões (é
  // exatamente isso que roda a cada oninput de L/A/P no modal real)
  mod.planCalc();
  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'Tampa não pode voltar ao recalcular (planCalc chamado de novo)');
  assertEq(totalQty(pecasEfetivas()), 5, 'total de peças automáticas continua 5 após recalcular');
});

test('6. Tampa não retorna após ALTERAR AS DIMENSÕES DA CAIXA (L/A/P) — regeneração de geometria preserva exclusão', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  excluirPeca('Tampa');

  // vendedor muda a caixa para 30x30x30 — pieces são recalculadas pela
  // receita (novas dimensões), mas a exclusão da Tampa tem que sobreviver
  setDims(30, 30, 30);
  mod.planCalc();
  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'Tampa não pode voltar após mudar as dimensões da caixa');
  // e a Base (não excluída) deve refletir a NOVA dimensão (30x30), prova de
  // que a reconciliação não "travou" a geometria das peças não excluídas
  var base = mod.getPlanEditPieces()[findPci('Base')];
  assertApprox(base.larg, 30, 'Base deve recalcular para a nova largura da caixa (30cm)');
});

test('7. Aplicar → fechar → reabrir o MESMO item → Tampa continua ausente (fonte: snapshot persistido, não a receita)', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  excluirPeca('Tampa');
  mod.planAplicar();

  var pecasSalvas = JSON.parse(row(0).dataset.planPecas);
  assertTrue(pecasSalvas.every(function (p) { return p.nome !== 'Tampa'; }), 'planPecas persistido não pode conter Tampa');

  // fecha e reabre o MESMO item — simula "fechar modal" + "abrir novamente"
  mod.planFechar();
  abrir(0);
  // planAbrir já chama planCalc() internamente pois savedLarg/savedAlt existem
  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'Tampa não pode reaparecer ao reabrir o modal do mesmo item');
  assertEq(totalQty(pecasEfetivas()), 5, 'reabrir deve mostrar as mesmas 5 peças automáticas de antes');
});

test('8. "salvar orçamento; reabrir orçamento" simulado (novo processo/módulo) — snapshot persistido continua a fonte', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  excluirPeca('Tampa');
  mod.planAplicar();
  var planPecasSalvo = row(0).dataset.planPecas;
  var planLargSalvo = row(0).dataset.planLarg;
  var planAltSalvo = row(0).dataset.planAlt;
  var planProfSalvo = row(0).dataset.planProf;

  // "recarregar página" = reprocessar o módulo do zero, com um DOM novo mas
  // o MESMO dataset persistido (é o que realmente sobrevive a um F5: o
  // dataset em si não, mas o Firestore sim — orcEnvEditar/restauração real
  // recompõe esse mesmo dataset a partir do documento salvo antes de o
  // vendedor clicar em "Editar Planificação"; replicamos aqui a PARTE que
  // pertence a este módulo, não a leitura do Firestore em si).
  delete _elements['oir_0'];
  var rowNova = registerItem(0, 'Caixa');
  rowNova.dataset.planPecas = planPecasSalvo;
  rowNova.dataset.planLarg = planLargSalvo;
  rowNova.dataset.planAlt = planAltSalvo;
  rowNova.dataset.planProf = planProfSalvo;

  abrir(0);
  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'Tampa não pode reaparecer depois de "recarregar" com o snapshot persistido restaurado');
  assertEq(totalQty(pecasEfetivas()), 5, 'peças automáticas restauradas continuam 5');
});

test('9. peça manual mantém material/espessura próprios — múltiplas espessuras coexistem (P0.5 base)', function () {
  registerItem(0, 'Caixa');
  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();

  mod.planAddManual();
  var mi = mod.getPlanManualPieces().length - 1;
  Object.assign(mod.getPlanManualPieces()[mi], { nome: 'Peça 1', larg: 20, alt: 20, qty: 1, esp: 4, precoM2: 200 });
  mod._planCalcAndMerge();
  mod.planAplicar();

  var todas = _planBuildAllPecasTest(row(0));
  var espessuras = Array.from(new Set(todas.map(function (p) { return p.espessuraMm; })));
  assertTrue(espessuras.indexOf(3) >= 0, 'peças automáticas devem preservar espessura 3mm');
  assertTrue(espessuras.indexOf(4) >= 0, 'peça manual deve preservar espessura 4mm');
  assertTrue(todas.every(function (p) { return p.origem === 'AUTOMATICA' || p.origem === 'MANUAL'; }), 'toda peça persistida deve ter origem AUTOMATICA ou MANUAL');
  function _planBuildAllPecasTest(r) { return JSON.parse(r.dataset.planPecas); }
});

test('10. excluir Tampa não afeta outro item/orçamento (isolamento entre aberturas)', function () {
  registerItem(0, 'Caixa');
  registerItem(1, 'Caixa');

  abrir(0);
  setDims(20, 20, 20);
  mod.planCalc();
  excluirPeca('Tampa');
  mod.planAplicar();

  // abre um SEGUNDO item de Caixa (produto igual, portanto mesmo slug de
  // peça "Tampa") — a exclusão do item0 não pode vazar para o item1
  abrir(1);
  setDims(20, 20, 20);
  mod.planCalc();
  assertTrue(nomesEfetivos().indexOf('Tampa') >= 0, 'item1 (nunca teve exclusão) deve ter Tampa normalmente — isolamento entre itens');
  assertEq(totalQty(pecasEfetivas()), 6, 'item1 deve ter as 6 peças completas da receita');

  // reabre item0 — continua sem Tampa
  abrir(0);
  assertTrue(nomesEfetivos().indexOf('Tampa') === -1, 'item0 deve continuar sem Tampa após abrir item1 no meio do caminho');
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
fs.unlinkSync(modPath);
if (failed > 0) process.exitCode = 1;
