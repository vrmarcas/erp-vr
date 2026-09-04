/**
 * test_hotfix_troca_material_pos_planificacao_2026-08-18.js
 *
 * RODADA 7 — corrige o bug em que trocar o material/espessura principal
 * de um item JÁ planificado não recalculava corretamente o custo de
 * materiais (o item ficava "preso" perto do preço da espessura antiga).
 *
 * CAUSA RAIZ: toda peça AUTOMÁTICA gravava `esp` como um valor CONGELADO
 * herdado da espessura do item no instante em que a planificação rodou
 * (`_planReconcilePieces`/`_planSeedFromPersisted`), sem nenhum jeito de
 * distinguir "esta peça herda a espessura do item" de "esta peça tem
 * override real de espessura" (receita customizada/snapshot). O motor de
 * preço tratava QUALQUER `esp` presente como override permanente — trocar
 * o material sem reabrir o modal deixava `_itemEspMm` correto mas as
 * peças ainda "esp":valor-antigo, e o delta de correção re-precificava
 * cada peça pelo preço/m² ANTIGO, cancelando algebricamente o novo.
 *
 * CORREÇÃO (2 partes):
 * 1) PREÇO — novo campo `espOverride` na peça — vazio = herda a
 *    espessura ATUAL do item (nunca gera delta); preenchido = override
 *    real (gera delta como sempre). Escrito só a partir da peça FRESCA da
 *    receita (`_planReconcilePieces`/`_planSeedFromPersisted`), nunca do
 *    valor persistido — fonte única `_planPecaEspOverride()`, usada tanto
 *    por orcRecalc() quanto pelos 3 previews (via `_planDeltaEspecificoPecas`).
 * 2) GEOMETRIA — `_planResincronizarPecasHerdadas(idx)`, chamada por
 *    orcMatChanged() ANTES de orcRecalc(): recalcula as MEDIDAS das
 *    peças automáticas SEM override (algumas fórmulas de peça dependem
 *    da espessura, ex. parede de Caixa `P-2e`), headless (nunca toca no
 *    estado do modal), preservando peças excluídas/manuais/overrides/
 *    consumíveis.
 *
 * Peça persistida ANTES desta rodada (sem `espOverride`) cai no fallback
 * legado, preservando compatibilidade retroativa.
 *
 * Uso: node scripts/test_hotfix_troca_material_pos_planificacao_2026-08-18.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
function testePerto(desc, got, expected, tolerancia) {
  tolerancia = tolerancia == null ? 0.02 : tolerancia;
  if (Math.abs(got - expected) <= tolerancia) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado ≈ ' + expected + '\n       obtido   = ' + got); failed++; }
}
function parseBRL(str) {
  return parseFloat(String(str).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
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
function extractVar(name) {
  var marker = 'var ' + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

var FN_NAMES = [
  'orcProdutoNomeResolvido','cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', '_planPecaAdesivos', '_planDeltaEspecificoPecas', 'orcGetItemExtrasTotal', 'orcRecalc',
  'orcColetarItensDistribuidos', '_planPieceSlug', '_planReconcilePieces', '_planSeedFromPersisted', '_planBuildAllPecas',
  'planGetRecipe', 'receitaCamposContexto', 'receitaCamposEfetivos', '_planResincronizarPecasHerdadas',
  'planEvalFormulaCtx', 'receitaFormulaAvaliar', 'receitaFormulaTokenizar', 'receitaFormulaParsear'];
var planRecipesSrc = extractVar('PLAN_RECIPES');
var src = [
  'var _planIdx = null;',
  'var planManualPieces = [];',
  'var _planEditPieces = [];',
  'var _planSeedPersistedJson = null;',
  planRecipesSrc,
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, _planPecaEspOverride: _planPecaEspOverride, ' +
  '_planDeltaEspecificoPecas: _planDeltaEspecificoPecas, _planReconcilePieces: _planReconcilePieces, ' +
  '_planSeedFromPersisted: _planSeedFromPersisted, _planBuildAllPecas: _planBuildAllPecas, ' +
  '_matResolverPrecoFamiliaEspessura: _matResolverPrecoFamiliaEspessura, orcColetarItensDistribuidos: orcColetarItensDistribuidos, ' +
  'planGetRecipe: planGetRecipe, _planResincronizarPecasHerdadas: _planResincronizarPecasHerdadas };'
].join('\n\n');
var modPath = path.join(__dirname, '_troca_material_pos_planificacao_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
global._planEditPieces = []; // _planReconcilePieces lê este global (peça em edição no modal — vazio = sem estado anterior)
global.planProdLoad = function () { return []; }; // planGetRecipe: sem receitas customizadas no teste — usa PLAN_RECIPES built-in
var mod = require(modPath);

console.log('\n=== RODADA 7 — troca de material/espessura após planificação já existente ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// Catálogo REAL de Acrílico Cristal em 4 espessuras — preços distintos e
// realistas (mais espesso = mais caro), cada um resolvendo seu próprio
// R$/m² via _matResolverPrecoFamiliaEspessura (família por nome-base).
// cfg_0=2mm, cfg_1=3mm, cfg_2=4mm, cfg_3=5mm.
var CATALOGO = [
  { nome: 'Acrílico Cristal 2mm', custo: 100, comp: 200, larg: 100, rsm2: 98.50,  esp: 2 },
  { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 147.30, esp: 3 },
  { nome: 'Acrílico Cristal 4mm', custo: 200, comp: 200, larg: 100, rsm2: 196.20, esp: 4 },
  { nome: 'Acrílico Cristal 5mm', custo: 250, comp: 200, larg: 100, rsm2: 245.00, esp: 5 }
];
function matKeyPara(espMm) { return 'cfg_' + CATALOGO.findIndex(function(m){ return m.esp===espMm; }); }
function rsm2Para(espMm) { return CATALOGO.find(function(m){ return m.esp===espMm; }).rsm2; }

var L=40, A=30, P=20; // Caixa 40×30×20cm, usada em todos os cenários

// Monta as peças "como se tivessem acabado de ser planificadas" (mesma
// chamada real: planGetRecipe → rec.pieces(L,A,P,e) → _planReconcilePieces
// → shape final igual a _planBuildAllPecas, com espessuraMm/origem).
function planificarCaixa(espMm, overridesExtra) {
  var rec = mod.planGetRecipe('Caixa', null);
  var fresh = rec.pieces(L, A, P, espMm/10, {}).concat(overridesExtra || []);
  return mod._planReconcilePieces(fresh, espMm).map(function(p){
    return Object.assign({}, p, { espessuraMm: parseInt(p.esp||0)||null, origem: 'AUTOMATICA' });
  });
}
function areaPlan(pecas) { return pecas.reduce(function(s,p){ return s + p.larg*p.alt*p.qty; }, 0); }

// Receita CUSTOMIZADA real (via planProdLoad, mesmo caminho de produção —
// _planResincronizarPecasHerdadas chama planGetRecipe(produto,...) de
// novo a cada troca de material, então o override "Vidro interno" PRECISA
// fazer parte da receita de verdade para sobreviver à resincronização —
// nunca um artifício só do teste). Mesmas fórmulas da Caixa built-in
// (L-2*e etc., avaliadas por receitaFormulaAvaliar) + 1 peça com esp
// própria fixa (override real).
var PRODUTO_CAIXA_COM_OVERRIDE = 'Caixa c/ Vidro Interno';
function ativarReceitaComOverride() {
  global.planProdLoad = function () {
    return [{
      nome: PRODUTO_CAIXA_COM_OVERRIDE, dim3d: true, campos: [],
      pecas: [
        { qty: 2, nome: 'Lateral',      larg: 'P-2*e', alt: 'A-e' },
        { qty: 2, nome: 'Frente/Fundo', larg: 'L-2*e', alt: 'A-e' },
        { qty: 1, nome: 'Base',         larg: 'L',     alt: 'P'   },
        { qty: 1, nome: 'Tampa',        larg: 'L',     alt: 'P'   },
        { qty: 1, nome: 'Vidro interno', larg: '15',   alt: '15', esp: 4 } // override real
      ]
    }];
  };
}
function desativarReceitaComOverride() { global.planProdLoad = function () { return []; }; }
function planificarCaixaComOverride(espMm) {
  ativarReceitaComOverride();
  var rec = mod.planGetRecipe(PRODUTO_CAIXA_COM_OVERRIDE, null);
  var fresh = rec.pieces(L, A, P, espMm/10, {});
  var pecas = mod._planReconcilePieces(fresh, espMm).map(function(p){
    return Object.assign({}, p, { espessuraMm: parseInt(p.esp||0)||null, origem: 'AUTOMATICA' });
  });
  desativarReceitaComOverride();
  return pecas;
}

// Monta o DOM fake para um item já com planificação aplicada — não chama
// orcRecalc() sozinho, pra permitir simular a troca de material antes.
function montarDOM(itens) {
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }),
    oc_imp: makeEl({ value: '0' }), oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  itens.forEach(function (it) {
    var planArea = areaPlan(it.pecas || []);
    _els['oi_qty_' + it.idx] = makeEl({ value: String(it.qty || 1) });
    _els['oi_larg_' + it.idx] = makeEl({ value: '0' });
    _els['oi_alt_' + it.idx] = makeEl({ value: '0' });
    var _matEntry = CATALOGO[parseInt(String(it.matKey).replace('cfg_', ''), 10)] || {};
    _els['oi_mat_' + it.idx] = makeEl({ value: it.matKey, dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: _matEntry.nome, esp: String(_matEntry.esp || '') }, text: _matEntry.nome }] });
    _els['oi_esp_' + it.idx] = makeEl({ value: String(it.espItem) });
    _els['oi_prod_' + it.idx] = makeEl({ value: it.prod || 'Caixa' });
    _els['oi_det_' + it.idx] = makeEl({ value: '' });
    _els['oi_custo_' + it.idx] = makeEl();
    _els['oi_unit_' + it.idx] = makeEl();
    _els['oi_tot_' + it.idx] = makeEl();
    _els['oi_opcaoBadge_' + it.idx] = makeEl();
    _els['oir_' + it.idx] = { dataset: { idx: it.idx, planArea: String(planArea), planPecas: JSON.stringify(it.pecas || []), planLarg: String(L), planAlt: String(A), planProf: String(P) } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return itens.map(function (it) { return { dataset: _els['oir_' + it.idx].dataset }; });
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: CATALOGO, financeiro: {} }; };
  global._matGetRsm2 = function (matKey) {
    var m = CATALOGO.find(function (mm) { return mm.nome && ('cfg_' + CATALOGO.indexOf(mm)) === matKey; });
    return m ? m.rsm2 : 100;
  };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.window._orcAdhPrecoSnapshot = null;
  return _els;
}
function rodarCenario(itens, opts) {
  var _els = montarDOM(itens);
  if (opts && opts.opcoes) global.ORC_ITEM_OPCOES = opts.opcoes;
  mod.orcRecalc();
  return _els;
}
// Simula o clique real do vendedor no <select> de material: atualiza
// oi_esp_<idx>/oi_mat_<idx> (o que orcMatChanged() já fazia antes desta
// rodada) + chama _planResincronizarPecasHerdadas (novo) — SEM chamar
// orcRecalc() ainda, pra podermos inspecionar o dataset.planPecas
// resincronizado antes de precificar.
function simularTrocaDeMaterialSemReabrir(_els, idx, novoEspMm) {
  _els['oi_esp_' + idx].value = String(novoEspMm);
  _els['oi_mat_' + idx].value = matKeyPara(novoEspMm);
  mod._planResincronizarPecasHerdadas(idx);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE A — convergência direta: criar em 2mm DESDE O INÍCIO vs criar em
// 4mm → planificar → trocar select para 2mm (SEM reabrir a planificação).
// ══════════════════════════════════════════════════════════════════════
{
  var pecasDireto2mm = planificarCaixa(2);
  var rDireto = rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: pecasDireto2mm }]);
  var custoDireto = parseBRL(rDireto.oi_custo_1.textContent);

  var pecasPlanificadasEm4mm = planificarCaixa(4);
  var _els = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(4), espItem: 4, pecas: pecasPlanificadasEm4mm }]);
  simularTrocaDeMaterialSemReabrir(_els, '1', 2); // troca o select para 2mm, SEM reabrir a planificação
  mod.orcRecalc();
  var custoTrocado = parseBRL(_els.oi_custo_1.textContent);

  testePerto('A1. custo de materiais: criar em 2mm == planificar em 4mm e trocar para 2mm (sem reabrir)', custoTrocado, custoDireto, 0.05);
  var areaAposTroca = 0; try { areaAposTroca = JSON.parse(_els.oir_1.dataset.planPecas).reduce(function(s,p){return s+p.larg*p.alt*p.qty;},0); } catch(e){}
  testePerto('A2. área (geometria) também converge — Lateral/Frente-Fundo recalculadas com a nova espessura', areaAposTroca, areaPlan(pecasDireto2mm), 0.5);

  // Contraprova: sem a correção desta rodada (peça legada sem espOverride,
  // geometria travada), o resultado ficaria preso perto do custo de 4mm.
  var custoDireto4mm = parseBRL(rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(4), espItem: 4, pecas: planificarCaixa(4) }]).oi_custo_1.textContent);
  var pecasLegadoSemFix = pecasPlanificadasEm4mm.map(function(p){ var p2=Object.assign({},p); delete p2.espOverride; return p2; });
  var custoLegadoSemFix = parseBRL(rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: pecasLegadoSemFix }]).oi_custo_1.textContent);
  ok('A3. (contraprova) peça legada SEM espOverride cai no fallback antigo e replica o bug histórico (preso perto do custo de 4mm, não do de 2mm)', Math.abs(custoLegadoSemFix - custoDireto4mm) < 1.0 && Math.abs(custoLegadoSemFix - custoDireto) > 5);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — caminho inverso: 5mm → 3mm e 2mm → 5mm.
// ══════════════════════════════════════════════════════════════════════
{
  var custoDireto3mm = parseBRL(rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(3), espItem: 3, pecas: planificarCaixa(3) }]).oi_custo_1.textContent);
  var els1 = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(5), espItem: 5, pecas: planificarCaixa(5) }]);
  simularTrocaDeMaterialSemReabrir(els1, '1', 3);
  mod.orcRecalc();
  testePerto('B1. 5mm → 3mm: custo converge com criar direto em 3mm', parseBRL(els1.oi_custo_1.textContent), custoDireto3mm, 0.05);

  var custoDireto5mm = parseBRL(rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(5), espItem: 5, pecas: planificarCaixa(5) }]).oi_custo_1.textContent);
  var els2 = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: planificarCaixa(2) }]);
  simularTrocaDeMaterialSemReabrir(els2, '1', 5);
  mod.orcRecalc();
  testePerto('B2. 2mm → 5mm: custo converge com criar direto em 5mm', parseBRL(els2.oi_custo_1.textContent), custoDireto5mm, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C — override real preservado: peça automática com espessura
// própria (receita customizada/snapshot) NUNCA deve seguir a troca do
// material principal do item.
// ══════════════════════════════════════════════════════════════════════
{
  var pecasComOverride = planificarCaixaComOverride(3); // item nasce em 3mm, receita CUSTOMIZADA real
  ok('C1. peça com esp própria da receita grava espOverride="4" (override real detectado)', pecasComOverride.find(function(p){return p.nome==='Vidro interno';}).espOverride === '4');
  ok('C2. peças herdadas (Lateral/Frente-Fundo/Base/Tampa) gravam espOverride="" (pura herança)', pecasComOverride.filter(function(p){return p.nome!=='Vidro interno';}).every(function(p){return p.espOverride==='';}));

  var els = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(3), espItem: 3, prod: PRODUTO_CAIXA_COM_OVERRIDE, pecas: pecasComOverride }]);
  ativarReceitaComOverride(); // _planResincronizarPecasHerdadas chama planGetRecipe(produto,...) de novo — precisa da receita ativa
  simularTrocaDeMaterialSemReabrir(els, '1', 2); // troca 3mm → 2mm, sem reabrir
  desativarReceitaComOverride();
  mod.orcRecalc();
  var custoObtido = parseBRL(els.oi_custo_1.textContent);
  var pecasFinal = JSON.parse(els.oir_1.dataset.planPecas);
  var vidroFinal = pecasFinal.find(function(p){return p.nome==='Vidro interno';});
  ok('C3. o override (Vidro interno) continua espOverride="4" e com a MESMA geometria depois da troca', vidroFinal.espOverride==='4' && vidroFinal.larg===15 && vidroFinal.alt===15);
  var areaHerdada = pecasFinal.filter(function(p){return p.nome!=='Vidro interno';}).reduce(function(s,p){return s+p.larg*p.alt*p.qty;},0)/10000;
  var areaOverride = 0.15*0.15;
  var custoEsperado = areaHerdada*rsm2Para(2) + areaOverride*rsm2Para(4);
  testePerto('C4. custo = área herdada×preço(2mm, novo, geometria recalculada) + área override×preço(4mm, preservado)', custoObtido, custoEsperado, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — consumíveis por peça continuam na mesma peça após trocar
// espessura principal (Rodada 6, intocado por este fix).
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = planificarCaixa(4);
  var tampa = pecas.find(function(p){return p.nome==='Tampa';});
  // RODADA 8 — Adesivo normal/branco viraram dois booleans independentes
  // (adesivoNormal/adesivoBranco); campo `adesivo` string antigo não é
  // mais a fonte ativa para peça já reconciliada (ver _planPecaAdesivos).
  tampa.adesivoNormal = true; tampa.spray = 5;
  var els = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(4), espItem: 4, pecas: pecas }]);
  simularTrocaDeMaterialSemReabrir(els, '1', 2);
  mod.orcRecalc();
  ok('D1. Adesivo continua marcado na Tampa após trocar espessura principal', parseBRL(els.ocv_adh.textContent) > 0);
  ok('D2. Spray (custo, exibido) continua R$5 na Tampa', Math.abs(parseBRL(els.ocv_spray.textContent) - 5) < 0.02);
  var tampaFinal = JSON.parse(els.oir_1.dataset.planPecas).find(function(p){return p.nome==='Tampa';});
  test('D3. o consumível permanece atribuído à MESMA peça (id) depois da resincronização de geometria', tampaFinal.adesivoNormal, true);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — salvar/reabrir: trocar espessura (o que já resincroniza
// geometria via orcMatChanged→_planResincronizarPecasHerdadas, Teste A),
// "salvar", "fechar", "reabrir" (_planSeedFromPersisted) — o estado
// correto permanece correto (reabrir nunca ressuscita o "4" congelado).
// ══════════════════════════════════════════════════════════════════════
{
  // "Planificado em 4mm" → vendedor troca para 2mm (COMO no Teste A — o
  // resync de geometria já aconteceu nesse momento, é isso que fica
  // persistido em row.dataset.planPecas antes de qualquer "salvar").
  var _elsTrocado = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(4), espItem: 4, pecas: planificarCaixa(4) }]);
  simularTrocaDeMaterialSemReabrir(_elsTrocado, '1', 2);
  var jsonPersistidoApósTroca = _elsTrocado.oir_1.dataset.planPecas;

  // "Reabrir": _planSeedFromPersisted recebe a peça FRESCA da receita já
  // em 2mm (fresh) + o JSON que ficou persistido (já correto, do passo
  // acima) — mesma chamada real de planAbrir()→planCalc().
  var freshEm2mm = mod.planGetRecipe('Caixa', null).pieces(L, A, P, 0.2, {});
  var pecasReabertas = mod._planSeedFromPersisted(freshEm2mm, jsonPersistidoApósTroca, 2);
  ok('E1. Reabrir depois da troca: peças herdadas continuam espOverride="" (nunca ressuscita o "4" congelado)', pecasReabertas.every(function(p){ return p.espOverride===''; }));
  ok('E2. Reabrir depois da troca: esp efetivo das peças = 2 (a espessura atual do item)', pecasReabertas.every(function(p){ return String(p.esp)==='2'; }));
  ok('E3. Reabrir depois da troca: geometria (área) permanece a correta de 2mm (reabrir não corrompe o que já estava certo)', Math.abs(areaPlan(pecasReabertas) - areaPlan(planificarCaixa(2))) < 0.5);

  var rReaberto = rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: pecasReabertas.map(function(p){ return Object.assign({}, p, { espessuraMm: 2, origem: 'AUTOMATICA' }); }) }]);
  var rDiretoComparar = rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: planificarCaixa(2) }]);
  testePerto('E4. Depois de reabrir, custo continua convergindo 100% (inclui geometria) com criar direto em 2mm', parseBRL(rReaberto.oi_custo_1.textContent), parseBRL(rDiretoComparar.oi_custo_1.textContent), 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE F — orçamento comparativo: opção duplicada em 2mm e trocada para
// 4mm deve ter o MESMO preço de material de uma opção criada diretamente
// em 4mm.
// ══════════════════════════════════════════════════════════════════════
{
  var pecasDuplicadasDe2mm = planificarCaixa(2); // "opção duplicada" nasceu com planPecas de uma planificação em 2mm
  var elsDup = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: pecasDuplicadasDe2mm }]);
  simularTrocaDeMaterialSemReabrir(elsDup, '1', 4); // vendedor troca o select da cópia para 4mm, sem reabrir
  mod.orcRecalc();
  var custoDuplicadaTrocada = parseBRL(elsDup.oi_custo_1.textContent);

  var custoCriadaDireto4mm = parseBRL(rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(4), espItem: 4, pecas: planificarCaixa(4) }]).oi_custo_1.textContent);
  testePerto('F1. Opção duplicada de 2mm e trocada p/ 4mm tem o MESMO custo de material que uma opção criada direto em 4mm', custoDuplicadaTrocada, custoCriadaDireto4mm, 0.05);

  // Confirma também no nível do orçamento comparativo real (2 itens, um
  // grupo, só a selecionada entra no total real).
  var opcoes = { '1': { grupoId: 'G1', selecionada: false }, '2': { grupoId: 'G1', selecionada: true } };
  var elsComp = montarDOM([
    { idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: planificarCaixa(2) }, // não selecionada
    { idx: '2', qty: 1, matKey: matKeyPara(4), espItem: 4, pecas: JSON.parse(elsDup.oir_1.dataset.planPecas) } // opção trocada, selecionada
  ]);
  global.ORC_ITEM_OPCOES = opcoes;
  mod.orcRecalc();
  testePerto('F2. No orçamento comparativo real, o TOTAL do pedido = custo da opção 4mm (trocada, selecionada) — bate com criar direto em 4mm', parseBRL(elsComp.orcTotalVal.textContent), custoCriadaDireto4mm, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE G — quantidade: qty=1 vs qty>1, sem multiplicação dupla no delta
// de correção de override real (regressão do mecanismo já existente,
// agora usando _planPecaEspOverride).
// ══════════════════════════════════════════════════════════════════════
{
  var pecasG = planificarCaixaComOverride(3);
  // oi_custo_ mostra o custo UNITÁRIO de material (matCost/qty — sempre
  // invariante por construção); a prova de "sem multiplicação dupla" do
  // delta de override precisa olhar o TOTAL comercial (oi_tot_, que
  // carrega matCost*qty através do pipeline canônico).
  var totalQty1 = parseBRL(rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: pecasG }]).oi_tot_1.textContent);
  var totalQty3 = parseBRL(rodarCenario([{ idx: '1', qty: 3, matKey: matKeyPara(2), espItem: 2, pecas: pecasG }]).oi_tot_1.textContent);
  testePerto('G1. total com qty=3 é exatamente 3× o total com qty=1 (delta de override escalado corretamente, sem dobrar)', totalQty3, totalQty1*3, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE H — previews (_planDeltaEspecificoPecas) batem com o motor
// canônico (orcRecalc) para o mesmo cenário de troca de material.
// ══════════════════════════════════════════════════════════════════════
{
  var pecasH = planificarCaixa(4);
  var priceM2Novo = rsm2Para(2);
  var deltaPreview = mod._planDeltaEspecificoPecas(pecasH, matKeyPara(2), 2, priceM2Novo);
  test('H1. Preview (_planDeltaEspecificoPecas) retorna delta=0 para peças puramente herdadas, mesmo após trocar a espessura do item', deltaPreview, 0);

  var custoCanonico = parseBRL(rodarCenario([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: pecasH }]).oi_custo_1.textContent);
  var areaTotalH = areaPlan(pecasH)/10000;
  testePerto('H2. Preview (delta=0 + área×preço novo) bate com o custo canônico de orcRecalc() (geometria ainda não resincronizada aqui — só o preço)', areaTotalH*priceM2Novo, custoCanonico, 0.05);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
