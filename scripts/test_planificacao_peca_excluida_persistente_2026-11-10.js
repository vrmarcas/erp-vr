/**
 * test_planificacao_peca_excluida_persistente_2026-11-10.js
 *
 * ACHADO REPORTADO PELO USUÁRIO (smoke real, 2026-11-10): "eu apago uma
 * peça automática; depois clico em + Adicionar Peça; a peça que eu já
 * apaguei volta sozinha." Regra exigida (obrigatória, verbatim do
 * usuário): uma vez excluída, uma peça automática é um OVERRIDE
 * PERSISTENTE daquela planificação — nenhuma ação (+ Adicionar Peça,
 * recálculo, troca de consumível/material/máquina, salvar, reabrir)
 * pode ressuscitá-la.
 *
 * Este teste usa as funções REAIS extraídas de index.html, nunca
 * reimplementadas: _planReconcilePieces, _planHidratarDireto,
 * _planSeedFromPersisted, _planBuildAllPecas, _planDeleteAuto,
 * _planCalcAndMerge, _planRecompute, planAddManual, planRemoveManual,
 * planRenderManual, _planAtualizarLabelsDim, e o planCalc() REAL
 * (função original de linha ~11859, mais o wrapper global que decide
 * entre _planCalcAndMerge/_planCalcOrig+_planRecompute). planGetRecipe
 * (catálogo de receitas, não é o alvo deste teste) é um STUB controlado
 * que sempre devolve a MESMA receita fixture de 3 peças (A, B, C) para
 * qualquer L/A/P — exatamente o papel de `rec.pieces(L,A,P,e,extra)`
 * seria em produção.
 *
 * Cenário EXATO pedido pelo usuário:
 *   receita gera A + B + C
 *   → usuário exclui B
 *   → adiciona peça manual D
 *   → resultado deve continuar A + C + D (B nunca volta)
 *   → salvar/reabrir
 *   → continua A + C + D.
 *
 * Uso: node scripts/test_planificacao_peca_excluida_persistente_2026-11-10.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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
function extractBlockUntilBalanced(markerStart, name) {
  var start = html.indexOf(markerStart);
  if (start < 0) throw new Error('Marcador não encontrado: ' + name);
  return start;
}

// ── Funções REAIS sob teste (extraídas, nunca reimplementadas) ──
var fnPieceSlug = extractFn('_planPieceSlug');
var fnPecaAdesivos = extractFn('_planPecaAdesivos');
var fnPecaEspOverride = extractFn('_planPecaEspOverride');
var fnDeltaEspecifico = extractFn('_planDeltaEspecificoPecas');
var fnReconcile = extractFn('_planReconcilePieces');
var fnHidratarDireto = extractFn('_planHidratarDireto');
var fnSeedFromPersisted = extractFn('_planSeedFromPersisted');
var fnBuildAllPecas = extractFn('_planBuildAllPecas');
var fnDeleteAuto = extractFn('_planDeleteAuto');
var fnEditField = extractFn('_planEditField');
var fnAtualizarLabelsDim = extractFn('_planAtualizarLabelsDim');
var fnRecompute = extractFn('_planRecompute');
var fnCalcAndMerge = extractFn('_planCalcAndMerge');
var fnAddManual = extractFn('planAddManual');
var fnRemoveManual = extractFn('planRemoveManual');
var fnRenderManual = extractFn('planRenderManual');
var fnPlanCalcReal = extractFn('planCalc'); // função original real, linha ~11859

// Bloco real do wrapper global: "var _planCalcOrig = (typeof planCalc...); if(_planCalcOrig) { planCalc = function() {...}; }"
var wrapVarStart = extractBlockUntilBalanced('var _planCalcOrig = (typeof planCalc', 'wrapper planCalc (var)');
var wrapVarEnd = html.indexOf(';', wrapVarStart) + 1;
var ifStart = html.indexOf('if(_planCalcOrig) {', wrapVarEnd);
if (ifStart < 0) throw new Error('bloco "if(_planCalcOrig) {" não encontrado após a var');
var ifBraceOpen = html.indexOf('{', ifStart);
var depthIf = 0, iIf = ifBraceOpen;
for (; iIf < html.length; iIf++) {
  if (html[iIf] === '{') depthIf++;
  else if (html[iIf] === '}') { depthIf--; if (depthIf === 0) break; }
}
if (depthIf !== 0) throw new Error('chaves desbalanceadas extraindo o bloco if(_planCalcOrig)');
var wrapperBlock = html.slice(ifStart, iIf + 1);
if (wrapperBlock.indexOf('planCalc = function') < 0) throw new Error('bloco do wrapper de planCalc não capturou o esperado');

// ── DOM mínimo, fiel aos ids reais usados por estas funções ──
function makeDom() {
  var store = {};
  function el(id) {
    if (!store[id]) {
      store[id] = {
        id: id, value: '', innerHTML: '', textContent: '', disabled: false,
        style: {}, dataset: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
        appendChild: function () {}, querySelector: function () { return null; }, closest: function () { return null; },
        children: []
      };
    }
    return store[id];
  }
  return {
    getElementById: function (id) { return el(id); },
    createElement: function () {
      return { style: {}, innerHTML: '', setAttribute: function () {}, appendChild: function () {}, dataset: {} };
    },
    _store: store,
  };
}

// ── Receita fixture controlada: SEMPRE A+B+C, independente de L/A/P ──
// (planGetRecipe/catálogo de receitas não é o alvo deste teste — já
// provado correto em outros testes desta rodada; aqui o alvo é a
// PERSISTÊNCIA da exclusão através de reconciliações sucessivas.)
var src = [
  'var _planIdx = null;',
  'var _planEditPieces = [];',
  'var planManualPieces = [];',
  'var _planSeedPersistedJson = null;',
  'var ORC_MATS = [];',
  'var _cfgData = {};',
  "function orcProdutoNomeResolvido(){ return 'ProdutoTesteABC'; }",
  "var _RECEITA_FIXTURE = [ {nome:'A', larg:30, alt:30, qty:1}, {nome:'B', larg:20, alt:20, qty:1}, {nome:'C', larg:10, alt:10, qty:1} ];",
  "function planGetRecipe(){ return { dim3d:false, labelL:'Largura', labelA:'Altura', campos:[], descontoMontagemOpcional:false, pieces: function(){ return _RECEITA_FIXTURE; } }; }",
  "function _matGetRsm2(){ return 100; }",
  "function _matResolverPrecoFamiliaEspessura(){ return 100; }",
  "function _planConsumiveisCelulaHtml(){ return ''; }",
  "function _planSincronizarComItem(){}",
  "function planDrawCanvas(){}",
  "function _planGetEspOptions(){ return []; }",
  "function receitaCamposContexto(){ return { ctx:{}, faltando:[] }; }",
  "function planLerCamposExtras(){ return {}; }",
  fnPieceSlug, fnPecaAdesivos, fnPecaEspOverride, fnDeltaEspecifico,
  fnReconcile, fnHidratarDireto, fnSeedFromPersisted, fnBuildAllPecas,
  fnAtualizarLabelsDim,
  fnPlanCalcReal,
  'var _planCalcOrig = planCalc;',
  wrapperBlock,
  fnDeleteAuto, fnEditField, fnRecompute, fnCalcAndMerge,
  fnAddManual, fnRemoveManual, fnRenderManual,
  'module.exports = {',
  '  abrirItemNovo: function (idx) {',
  '    _planIdx = idx; planManualPieces = []; _planEditPieces = []; _planSeedPersistedJson = null;',
  '    document.getElementById("planLarg").value = "100";',
  '    document.getElementById("planAlt").value = "100";',
  '    document.getElementById("oi_esp_"+idx).value = "4";',
  '  },',
  '  reabrirItem: function (idx, planPecasJson, planPecasManualJson) {',
  '    _planIdx = idx;',
  '    planManualPieces = planPecasManualJson ? (JSON.parse(planPecasManualJson)||[]) : [];',
  '    _planEditPieces = [];',
  '    _planSeedPersistedJson = planPecasJson || null;',
  '  },',
  '  planCalc: function () { planCalc(); },',
  '  addManual: function () { planAddManual(); },',
  '  setManualProps: function (i, props) { Object.assign(planManualPieces[i], props); },',
  '  deleteAutoByNome: function (nome) {',
  '    var pci = _planEditPieces.findIndex(function(p){ return p.nome===nome && !p._deleted; });',
  '    if (pci < 0) throw new Error("peça não encontrada para excluir: " + nome);',
  '    _planDeleteAuto(pci);',
  '  },',
  '  deleteAutoAt: function (pci) { _planDeleteAuto(pci); },',
  '  getEditPieces: function () { return _planEditPieces.map(function(p){ return { id:p.id, nome:p.nome, _deleted:!!p._deleted }; }); },',
  '  efetivas: function () {',
  '    var autos = _planEditPieces.filter(function(p){ return !p._deleted; }).map(function(p){ return p.nome; });',
  '    var manuais = planManualPieces.filter(function(p){ return p.larg>0 && p.alt>0; }).map(function(p){ return p.nome; });',
  '    return autos.concat(manuais);',
  '  },',
  '  buildAllPecas: function () { return _planBuildAllPecas(); },',
  '  onlyManualPersistiveis: function () { return planManualPieces.filter(function(p){ return parseFloat(p.larg)>0 && parseFloat(p.alt)>0; }); },',
  '  setReceita: function (pecas) { _RECEITA_FIXTURE = pecas; },',
  '};',
].join('\n\n');

var modPath = path.join(__dirname, '_test_peca_excluida_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
global.document = makeDom();
var mod = require(modPath);

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }
function setEq(desc, arr, expected) {
  var a = arr.slice().sort(), e = expected.slice().sort();
  ok(desc, JSON.stringify(a) === JSON.stringify(e), 'obtido=' + JSON.stringify(arr) + ' esperado=' + JSON.stringify(expected));
}

console.log('\n=== Peça automática excluída é OVERRIDE PERSISTENTE da planificação (achado real 2026-11-10) ===\n');

mod.abrirItemNovo(0);
mod.planCalc();
setEq('1. receita gera A + B + C', mod.efetivas(), ['A', 'B', 'C']);

mod.deleteAutoByNome('B');
setEq('2. usuário exclui B → A + C', mod.efetivas(), ['A', 'C']);

mod.addManual(); // "+ Adicionar Peça" — chama _planCalcAndMerge() internamente, reconcilia de novo
mod.setManualProps(0, { nome: 'D', larg: 15, alt: 15 });
// dispara a reconciliação de novo (mesmo oninput real ao digitar larg/alt/nome da peça manual)
mod.planCalc();
setEq('3. adiciona peça manual D (após + Adicionar Peça) → A + C + D, B NUNCA volta', mod.efetivas(), ['A', 'C', 'D']);

// Mais uma reconciliação (ex.: trocar consumível, editar outro campo) — B continua fora.
mod.planCalc();
setEq('4. nova reconciliação (recálculo) ainda → A + C + D', mod.efetivas(), ['A', 'C', 'D']);

var persistido = mod.buildAllPecas();
var nomesPersistidos = persistido.map(function (p) { return p.nome; });
setEq('5. snapshot persistido (_planBuildAllPecas, o que vai para row.dataset.planPecas) = A + C + D', nomesPersistidos, ['A', 'C', 'D']);
ok('5b. nenhuma peça persistida tem _deleted:true vazando pro snapshot', persistido.every(function (p) { return !p._deleted; }));

// ── "salvar" — mesmo contrato de planAplicar(): grava planPecas (catálogo
// completo via _planBuildAllPecas) e planPecasManual (só as manuais) no
// dataset do item. ──
var planPecasJsonSalvo = JSON.stringify(persistido);
var planPecasManualJsonSalvo = JSON.stringify(mod.onlyManualPersistiveis());

// ── "reabrir" — mesmo reset de planAbrir(): _planEditPieces=[], recarrega
// planManualPieces do snapshot manual, semeia _planSeedPersistedJson do
// snapshot completo, e deixa a próxima planCalc() hidratar. ──
mod.reabrirItem(0, planPecasJsonSalvo, planPecasManualJsonSalvo);
mod.planCalc();
setEq('6. reabrir o item → ainda A + C + D (B não ressuscita na reabertura)', mod.efetivas(), ['A', 'C', 'D']);

// Depois de reaberto, repetir a AÇÃO EXATA relatada pelo usuário
// ("+ Adicionar Peça") mais uma vez — B precisa continuar fora mesmo numa
// sessão de edição iniciada por reabertura (não só na sessão original).
mod.addManual();
mod.setManualProps(1, { nome: 'E', larg: 5, alt: 5 });
mod.planCalc();
setEq('7. depois de reaberto, + Adicionar Peça de novo → A + C + D + E, B continua fora', mod.efetivas(), ['A', 'C', 'D', 'E']);

// ── Regressão de borda: receita com NOME REPETIDO (ex.: duas "Lateral" de
// pares opostos da geometria — colisão real já corrigida em 2026-10-09).
// Exclui a SEGUNDA ocorrência ("auto_lateral_2") e confirma que só ela
// fica marcada, nunca a primeira (nem via nova reconciliação por
// "+ Adicionar Peça"). ──
mod.abrirItemNovo(1);
mod.setReceita([
  { nome: 'Lateral', larg: 40, alt: 10, qty: 1 },
  { nome: 'Lateral', larg: 40, alt: 10, qty: 1 },
  { nome: 'Tampa', larg: 40, alt: 40, qty: 1 },
]);
mod.planCalc();
var pecasDup = mod.getEditPieces();
ok('8. duas peças "Lateral" recebem ids distintos (auto_lateral / auto_lateral_2)', pecasDup[0].id === 'auto_lateral' && pecasDup[1].id === 'auto_lateral_2', JSON.stringify(pecasDup));

mod.deleteAutoAt(1); // exclui a 2ª "Lateral" (auto_lateral_2), nunca a 1ª
mod.addManual();
mod.setManualProps(0, { nome: 'Reforço', larg: 5, alt: 5 });
mod.planCalc();
var pecasDupPos = mod.getEditPieces();
ok('9. após excluir a 2ª "Lateral" + Adicionar Peça: só a 2ª fica _deleted, a 1ª sobrevive', !pecasDupPos[0]._deleted && pecasDupPos[1]._deleted && !pecasDupPos[2]._deleted, JSON.stringify(pecasDupPos));
setEq('10. efetivas finais do item com nomes duplicados: Lateral (1x) + Tampa + Reforço', mod.efetivas(), ['Lateral', 'Tampa', 'Reforço']);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
