/**
 * test_planificacao_espbreakdown_residuo_2026-11-05.js
 *
 * ACHADO REAL (smoke de produção, 2026-11-05): usuário selecionou
 * "Acrílico Cristal 4mm" no item "Display" (receita fallback "peça
 * plana" — Display não tem receita própria, confirmado), planificou
 * 100×100cm, e a tela mostrou "📏 Chapa 5mm: 0,0360 m²".
 *
 * Reprodução com código real (test_repro_espessura, não incluído aqui)
 * já provou que o MOTOR de cálculo (planGetRecipe + _planReconcilePieces)
 * resolve esp=4 corretamente para este cenário — o preço/custo do item
 * SEMPRE usou 4mm. A causa raiz real é outra, e está aqui:
 *
 * #planEspBreakdown ("📏 Chapa Xmm: Y m²") é escrito SÓ por
 * _planRecompute() (index.html) — chamada apenas em resposta a edição de
 * peça/consumível/peça manual (_planEditField/_planConsumiveisSalvar),
 * NUNCA na abertura inicial do modal (planAbrir→planCalc) quando o item
 * não tem nenhuma peça manual (o caso comum — ex.: "Display", sem
 * _planCalcAndMerge sequer rodar, já que o wrapper global de planCalc só
 * chama _planCalcAndMerge quando `planManualPieces.length>0`). Resultado
 * real: abrir um item que nunca disparou uma dessas edições herdava
 * SILENCIOSAMENTE o HTML de #planEspBreakdown deixado pela ÚLTIMA peça
 * editada de QUALQUER item anterior (ou até de outro orçamento, se a
 * aba não recarregou) — exibindo uma espessura que nunca teve nenhuma
 * relação com o item atualmente aberto, mesmo o cálculo real estando
 * 100% correto.
 *
 * Corrigido: planCalc() (o wrapper global) agora chama _planRecompute()
 * SEMPRE, nos dois ramos (com ou sem peça manual) — nunca mais deixa
 * #planEspBreakdown órfão do item realmente aberto.
 *
 * Este teste usa as funções REAIS _planRecompute/_planCalcAndMerge/o
 * wrapper de planCalc (extraídos de index.html, nunca reimplementados).
 * _planCalcOrig é um STUB controlado (dependência upstream já estável,
 * não o alvo deste teste) que simula o que a função real planCalc()
 * sempre faz: repopula _planEditPieces para o item ATUALMENTE aberto.
 *
 * Uso: node scripts/test_planificacao_espbreakdown_residuo_2026-11-05.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractBlock(markerStart, name) {
  var start = html.indexOf(markerStart);
  if (start < 0) throw new Error('Marcador não encontrado: ' + name);
  return start;
}
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

// _planCalcAndMerge() — função inteira, real.
var fnCalcAndMerge = extractFn('_planCalcAndMerge');
// _planRecompute() — função inteira, real.
var fnRecompute = extractFn('_planRecompute');
// O wrapper global de planCalc — bloco real "var _planCalcOrig = ...; if(_planCalcOrig) { planCalc = function() {...}; }".
var wrapVarStart = extractBlock('var _planCalcOrig = (typeof planCalc', 'wrapper planCalc (var)');
var wrapVarEnd = html.indexOf(';', wrapVarStart) + 1;
var wrapVarLine = html.slice(wrapVarStart, wrapVarEnd);
var ifStart = html.indexOf('if(_planCalcOrig) {', wrapVarEnd);
if (ifStart < 0) throw new Error('bloco "if(_planCalcOrig) {" não encontrado após a var');
var ifBraceOpen = html.indexOf('{', ifStart);
var depthIf = 0, iIf = ifBraceOpen;
for (; iIf < html.length; iIf++) {
  if (html[iIf] === '{') depthIf++;
  else if (html[iIf] === '}') { depthIf--; if (depthIf === 0) break; }
}
if (depthIf !== 0) throw new Error('chaves desbalanceadas extraindo o bloco if(_planCalcOrig)');
var ifBlock = html.slice(ifStart, iIf + 1);
void wrapVarLine; // não usado: o stub _planCalcOrig já é definido diretamente no módulo de teste (ver abaixo) — a linha real faria `typeof planCalc` (inexistente aqui) e sobrescreveria com null.
var wrapperBlock = ifBlock;
if (wrapperBlock.indexOf('planCalc = function') < 0) throw new Error('bloco do wrapper de planCalc não capturou o esperado — ver extração');

// ── DOM mínimo e fiel aos ids reais usados por estas 3 funções ──
function makeDom() {
  var store = {};
  function el(id) {
    if (!store[id]) store[id] = { id: id, innerHTML: '', textContent: '', style: {}, dataset: {}, disabled: false, appendChild: function () {} };
    return store[id];
  }
  return {
    getElementById: function (id) { return el(id); },
    createElement: function () { return { style: {}, innerHTML: '' }; },
    _store: store,
  };
}

var fnDeltaEspecifico = extractFn('_planDeltaEspecificoPecas');
var fnPecaEspOverride = extractFn('_planPecaEspOverride');

var src = [
  'var _planEditPieces = [];',
  'var planManualPieces = [];',
  'var _planIdx = 0;',
  'var ORC_MATS = [];',
  'var _cfgData = {};',
  "function _matGetRsm2(){ return 100; }", // preço/m² — irrelevante para o que este teste prova (#planEspBreakdown)
  "function _matResolverPrecoFamiliaEspessura(){ return 100; }", // idem — só usado no DELTA de custo, não na label de espessura sob teste
  "function planDrawCanvas(){}", // desenho do SVG de corte — fora do escopo deste teste (só #planEspBreakdown)
  "function _planConsumiveisCelulaHtml(){ return ''; }", // chip de consumíveis — fora do escopo deste teste
  "function _planSincronizarComItem(){}", // sincroniza o total na linha do item — fora do escopo deste teste (só #planEspBreakdown)
  fnPecaEspOverride,
  fnDeltaEspecifico,
  // _planCalcOrig FIEL ao comportamento real que importa aqui: repopula
  // _planEditPieces para o item ATUALMENTE aberto (_planIdx) — exatamente
  // o que a função real planCalc() sempre faz antes de qualquer outra
  // coisa. planGetRecipe/_planReconcilePieces já estão provados corretos
  // em outro teste desta rodada — aqui o foco é #planEspBreakdown, não a
  // resolução da espessura em si.
  'var _ITENS_FIXTURE = {};',
  'function _planCalcOrig() {',
  '  var fixture = _ITENS_FIXTURE[_planIdx] || { pecas: [] };',
  '  _planEditPieces = fixture.pecas;',
  '  var tfoot = document.getElementById("planPiecesFoot"); tfoot.innerHTML = "";',
  '  var sumBox = document.getElementById("planSumBox");',
  '  var totalArea = _planEditPieces.reduce(function(s,p){ return s + p.larg*p.alt*p.qty; }, 0);',
  '  sumBox.dataset.totalArea = String(totalArea); sumBox.dataset.totalQty = String(_planEditPieces.length);',
  '}',
  '_planCalcOrig.__stub = true;',
  fnCalcAndMerge,
  fnRecompute,
  wrapperBlock,
  'module.exports = {',
  '  setItem: function (idx, pecas, manuais) { _planIdx = idx; _ITENS_FIXTURE[idx] = { pecas: pecas }; planManualPieces = manuais || []; },',
  '  abrirESalvarPlanificacao: function () { planCalc(); },',
  '  getEspBreakdownHtml: function () { return document.getElementById("planEspBreakdown").innerHTML; },',
  '};',
].join('\n\n');

var modPath = path.join(__dirname, '_test_espbreakdown_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

console.log('\n=== #planEspBreakdown — nunca mais herda resíduo de um item ANTERIOR (achado real: Display 4mm → "Chapa 5mm") ===\n');

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);
global.document = makeDom();

// ── Item A: tem 1 peça MANUAL em 5mm, 0,0360 m² (360 cm² = 6×60) — dispara
// _planCalcAndMerge() (planManualPieces.length>0), que SEMPRE chamou
// _planRecompute() mesmo antes desta correção (caminho já funcionava).
mod.setItem('item_A', [{ nome: 'Peça base', larg: 50, alt: 50, qty: 1, esp: '3' }], [{ nome: 'Reforço', larg: 6, alt: 60, qty: 1, esp: '5' }]);
mod.abrirESalvarPlanificacao();
var breakdownA = mod.getEspBreakdownHtml();
console.log('  item A (peça manual 5mm) — breakdown: ' + breakdownA);
ok('A. item A mostra a própria peça manual de 5mm (0,0360 m²) corretamente', breakdownA.indexOf('5mm: 0.0360') >= 0 || breakdownA.indexOf('5mm: 0,0360') >= 0, breakdownA);

// ── Item B: "Display", 4mm, SEM nenhuma peça manual (planManualPieces
// precisa ser resetado como planAbrir() real sempre faz ao trocar de
// item) — cenário EXATO do achado real.
mod.setItem('item_B_display', [{ nome: 'Display', larg: 100, alt: 100, qty: 1, esp: '4' }], []); // planManualPieces=[] — mesmo reset que planAbrir() sempre faz
mod.abrirESalvarPlanificacao();
var breakdownB = mod.getEspBreakdownHtml();
console.log('  item B (Display, 4mm, sem peça manual) — breakdown: ' + breakdownB);
ok('B. item B (Display) mostra 4mm — NUNCA o resíduo "5mm" do item A anterior', breakdownB.indexOf('5mm') < 0 && (breakdownB.indexOf('4mm') >= 0), breakdownB);
ok('B2. a área mostrada é a do item B (1,0000 m² — 100×100cm), não os 0,0360 m² da peça manual do item A', breakdownB.indexOf('1.0000') >= 0 || breakdownB.indexOf('1,0000') >= 0, breakdownB);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
