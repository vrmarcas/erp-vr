/**
 * test_hotfix_adesivo_normal_branco_simultaneo_2026-08-18.js
 *
 * RODADA 8 — Adesivo normal e Adesivo branco deixam de ser mutuamente
 * exclusivos na mesma peça da planificação. Antes: campo único
 * `adesivo: ''|'normal'|'branco'` (exclusivo, confirmado por
 * investigação). Agora: dois campos booleanos independentes
 * (`adesivoNormal`/`adesivoBranco`), com custo somado quando ambos ativos
 * — nunca escolhido/sobrescrito/só o maior. Compatibilidade retroativa:
 * peça persistida ANTES desta rodada (só o campo antigo) é lida
 * corretamente via `_planPecaAdesivos()`, fonte única de leitura (mesmo
 * padrão de `_planPecaEspOverride()`, Rodada 7).
 *
 * NÃO reabre: espOverride, _planPecaEspOverride,
 * _planResincronizarPecasHerdadas, custo multi-espessura, Gravação/Spray/
 * Extra ×2, orçamento comparativo, PDF/WhatsApp, OS, financeiro — só
 * confirma que continuam intactos (Teste J = regressão direta do commit
 * 3cc691e usando peça com os dois adesivos).
 *
 * Uso: node scripts/test_hotfix_adesivo_normal_branco_simultaneo_2026-08-18.js
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

var FN_NAMES = ['cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', '_planPecaAdesivos', '_planDeltaEspecificoPecas',
  'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos', '_planPieceSlug', '_planReconcilePieces',
  '_planSeedFromPersisted', '_planBuildAllPecas', 'osProjecaoOperacionalItem',
  'planGetRecipe', 'receitaCamposContexto', 'receitaCamposEfetivos', '_planResincronizarPecasHerdadas',
  'planEvalFormulaCtx', 'receitaFormulaAvaliar', 'receitaFormulaTokenizar', 'receitaFormulaParsear'];
var planRecipesSrc = extractVar('PLAN_RECIPES');
// Sem declarações locais de _planIdx/_planEditPieces/planManualPieces/
// _planSeedPersistedJson no módulo extraído: essas referências ficam
// "soltas" e resolvem para global.* (padrão da Rodada 6), o que permite
// injetar fixtures via `global._planEditPieces = [...]` mid-teste (Teste
// F). Com uma declaração `var` local no módulo, a atribuição em global
// não teria efeito nenhum (bug real encontrado ao escrever este teste).
var src = [
  planRecipesSrc,
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, _planPecaAdesivos: _planPecaAdesivos, ' +
  '_planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, ' +
  '_planBuildAllPecas: _planBuildAllPecas, osProjecaoOperacionalItem: osProjecaoOperacionalItem, ' +
  'orcColetarItensDistribuidos: orcColetarItensDistribuidos, planGetRecipe: planGetRecipe, ' +
  '_planResincronizarPecasHerdadas: _planResincronizarPecasHerdadas };'
].join('\n\n');
var modPath = path.join(__dirname, '_adesivo_normal_branco_simultaneo_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
global._planEditPieces = [];
global.planManualPieces = [];
global._planIdx = null;
global._planSeedPersistedJson = null;
global.planProdLoad = function () { return []; };
var mod = require(modPath);

console.log('\n=== RODADA 8 — Adesivo normal + Adesivo branco simultâneos na mesma peça ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

var ADH = 0.0056, ADHB = 0.0011; // preço/cm² fallback hardcoded (sem financeiro.adesivo*PrecoCm2 configurado no cenário)

function caixaPecas(overrides) {
  overrides = overrides || {};
  var base = [
    { nome: 'Tampa',   qty: 1, larg: 40, alt: 30, esp: '3', origem: 'AUTOMATICA' }, // 1200 cm²
    { nome: 'Base',    qty: 1, larg: 40, alt: 30, esp: '3', origem: 'AUTOMATICA' }, // 1200 cm²
    { nome: 'Lateral', qty: 2, larg: 30, alt: 20, esp: '3', origem: 'AUTOMATICA' }, // 2×600=1200 cm²
    { nome: 'Frente',  qty: 1, larg: 40, alt: 20, esp: '3', origem: 'AUTOMATICA' }, // 800 cm²
    { nome: 'Fundo',   qty: 1, larg: 40, alt: 20, esp: '3', origem: 'AUTOMATICA' }  // 800 cm²
  ];
  base.forEach(function(p){
    var o = overrides[p.nome];
    if (o) Object.assign(p, o);
  });
  return base;
}
function areaPlan(pecas) { return pecas.reduce(function(s,p){ return s + p.larg*p.alt*p.qty; }, 0); }

function rodarCenario(opts) {
  opts = opts || {};
  var materiaisCatalogo = opts.materiaisCatalogo || [
    { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150, esp: 3 }
  ];
  var itens = opts.itens || [];
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
    var _matEntry = materiaisCatalogo[parseInt(String(it.matKey).replace('cfg_', ''), 10)] || {};
    _els['oi_mat_' + it.idx] = makeEl({ value: it.matKey, dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: _matEntry.nome, esp: String(_matEntry.esp || '') }, text: _matEntry.nome }] });
    _els['oi_esp_' + it.idx] = makeEl({ value: String(it.espItem) });
    _els['oi_prod_' + it.idx] = makeEl({ value: it.prod || 'Caixa' });
    _els['oi_det_' + it.idx] = makeEl({ value: '' });
    _els['oi_custo_' + it.idx] = makeEl();
    _els['oi_unit_' + it.idx] = makeEl();
    _els['oi_tot_' + it.idx] = makeEl();
    _els['oi_opcaoBadge_' + it.idx] = makeEl();
    _els['oir_' + it.idx] = { dataset: { idx: it.idx, planArea: String(planArea), planPecas: JSON.stringify(it.pecas || []), planLarg: '40', planAlt: '30', planProf: '20' } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return itens.map(function (it) { return { dataset: _els['oir_' + it.idx].dataset }; });
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: opts.overhead || 0, vrml: opts.vrml || 0, impostos: opts.impostos || 0 } };
  global.cfgLoad = function () { return { materiais: materiaisCatalogo, financeiro: {} }; };
  global._matGetRsm2 = function (matKey) {
    var m = materiaisCatalogo.find(function (mm) { return mm.nome && ('cfg_' + materiaisCatalogo.indexOf(mm)) === matKey; });
    return m ? m.rsm2 : 100;
  };
  global.ORC_ITEM_EXTRAS = opts.itemExtras || {};
  global.ORC_ITEM_AJUSTES = opts.ajustes || {};
  global.ORC_ITEM_OPCOES = opts.opcoes || {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.window._orcAdhPrecoSnapshot = null;
  mod.orcRecalc();
  return _els;
}

// ══════════════════════════════════════════════════════════════════════
// TESTE A — nenhum adesivo marcado → custo 0
// ══════════════════════════════════════════════════════════════════════
{
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: caixaPecas({}) }] });
  ok('A1. Nenhum adesivo marcado — ocv_adh = R$0,00', parseBRL(r.ocv_adh.textContent) === 0);
  ok('A2. Nenhum adesivo marcado — ocv_adhb = R$0,00', parseBRL(r.ocv_adhb.textContent) === 0);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — somente Normal → área × preçoNormal
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: { adesivoNormal: true } });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  testePerto('B1. Só Normal marcado — cobra 1200cm²×preço normal', parseBRL(r.ocv_adh.textContent), 1200*ADH, 0.01);
  ok('B2. Branco continua zerado', parseBRL(r.ocv_adhb.textContent) === 0);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C — somente Branco → área × preçoBranco
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Base: { adesivoBranco: true } });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  testePerto('C1. Só Branco marcado — cobra 1200cm²×preço branco', parseBRL(r.ocv_adhb.textContent), 1200*ADHB, 0.01);
  ok('C2. Normal continua zerado', parseBRL(r.ocv_adh.textContent) === 0);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — Normal + Branco na MESMA peça → soma das duas parcelas
// (nunca escolhe um, nunca sobrescreve, nunca usa o maior)
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: { adesivoNormal: true, adesivoBranco: true } });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  testePerto('D1. Adesivo normal cobrado (1200cm²×preço normal)', parseBRL(r.ocv_adh.textContent), 1200*ADH, 0.01);
  testePerto('D2. Adesivo branco cobrado NA MESMA PEÇA, ao mesmo tempo (1200cm²×preço branco)', parseBRL(r.ocv_adhb.textContent), 1200*ADHB, 0.01);
  ok('D3. Os dois valores são simultâneos e distintos (nem um sobrescreve o outro, nem soma tudo num campo só)', parseBRL(r.ocv_adh.textContent) > 0 && parseBRL(r.ocv_adhb.textContent) > 0 && Math.abs(parseBRL(r.ocv_adh.textContent) - parseBRL(r.ocv_adhb.textContent)) > 1);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — quantidade > 1: área efetiva correta, sem multiplicação dupla
// ══════════════════════════════════════════════════════════════════════
{
  // Lateral já tem qty=2 na receita (2 peças de 30×20 = 1200cm² no total) —
  // marcar os dois adesivos nela testa qty da PEÇA e qty do ITEM juntos.
  var pecasQty1 = caixaPecas({ Lateral: { adesivoNormal: true, adesivoBranco: true } });
  var pecasQty3 = caixaPecas({ Lateral: { adesivoNormal: true, adesivoBranco: true } });
  var r1 = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasQty1 }] });
  var r3 = rodarCenario({ itens: [{ idx: '1', qty: 3, matKey: 'cfg_0', espItem: 3, pecas: pecasQty3 }] });
  testePerto('E1. Adesivo normal com qty do item=3 é EXATAMENTE 3× o de qty=1 (peça já tem qty=2 própria — sem multiplicação dupla)', parseBRL(r3.ocv_adh.textContent), parseBRL(r1.ocv_adh.textContent)*3, 0.02);
  testePerto('E2. Adesivo branco com qty do item=3 é EXATAMENTE 3× o de qty=1', parseBRL(r3.ocv_adhb.textContent), parseBRL(r1.ocv_adhb.textContent)*3, 0.02);
  testePerto('E3. Área efetiva da peça (qty própria=2) confirmada: 1200cm² × preço normal em qty=1', parseBRL(r1.ocv_adh.textContent), 1200*ADH, 0.01);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE F — salvar/reabrir com os dois marcados: estado preservado
// ══════════════════════════════════════════════════════════════════════
{
  // F1 — _planReconcilePieces (edição em memória, mesma sessão do modal).
  global._planEditPieces = [
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', tipo: '', adesivoNormal: true, adesivoBranco: true, gravacao: 0, spray: 0, extra: 0, _deleted: false }
  ];
  var freshPieces = [{ nome: 'Tampa', qty: 1, larg: 42, alt: 30, esp: '3', tipo: '' }]; // vendedor editou a largura
  var reconciliado = mod._planReconcilePieces(freshPieces, 3);
  ok('F1. _planReconcilePieces preserva os dois adesivos mesmo após editar largura', reconciliado[0].adesivoNormal===true && reconciliado[0].adesivoBranco===true);

  // F2 — _planSeedFromPersisted (reabertura real do orçamento salvo).
  var persistedJson = JSON.stringify([
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', espessuraMm: 3, tipo: '', adesivoNormal: true, adesivoBranco: true, origem: 'AUTOMATICA' }
  ]);
  var freshPieces2 = [{ nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', tipo: '' }];
  var seeded = mod._planSeedFromPersisted(freshPieces2, persistedJson, 3);
  ok('F2. _planSeedFromPersisted restaura os dois adesivos ao reabrir', seeded[0].adesivoNormal===true && seeded[0].adesivoBranco===true);

  // F3 — determinismo ponta-a-ponta: "reabrir" = restaurar o mesmo
  // planPecas (com os dois adesivos) e recalcular — mesmo padrão de prova
  // usado em toda a sessão.
  var pecasF = caixaPecas({ Tampa: { adesivoNormal: true, adesivoBranco: true } });
  var cenarioOpts = { itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasF }] };
  var rA = rodarCenario(cenarioOpts);
  var rB = rodarCenario(cenarioOpts);
  test('F3. Reabrir com o mesmo planPecas restaurado produz o MESMO adh/adhb (os dois continuam ativos)', { adh: rA.ocv_adh.textContent, adhb: rA.ocv_adhb.textContent }, { adh: rB.ocv_adh.textContent, adhb: rB.ocv_adhb.textContent });
}

// ══════════════════════════════════════════════════════════════════════
// TESTE G — orçamento LEGADO com apenas `adesivo:'normal'` (formato
// antigo, exclusivo) → abre só com Normal ativo
// ══════════════════════════════════════════════════════════════════════
{
  var pecaLegadoNormal = { nome: 'Tampa', adesivo: 'normal' };
  var r = mod._planPecaAdesivos(pecaLegadoNormal);
  test('G1. Peça legada com adesivo="normal" converte para {normal:true, branco:false}', r, { normal: true, branco: false });

  // Ponta-a-ponta: orçamento legado real (peça salva ANTES desta rodada,
  // sem os campos novos) precificado corretamente.
  var pecasLegadas = caixaPecas({ Tampa: { adesivo: 'normal' } }); // formato ANTIGO, sem adesivoNormal/adesivoBranco
  var rLegado = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasLegadas }] });
  testePerto('G2. Orçamento legado (só "normal") cobra corretamente só o Adesivo normal', parseBRL(rLegado.ocv_adh.textContent), 1200*ADH, 0.01);
  ok('G3. Orçamento legado (só "normal") NÃO cobra Adh. Branco', parseBRL(rLegado.ocv_adhb.textContent) === 0);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE H — orçamento LEGADO com apenas `adesivo:'branco'` → abre só com
// Branco ativo
// ══════════════════════════════════════════════════════════════════════
{
  var pecaLegadoBranco = { nome: 'Base', adesivo: 'branco' };
  var r = mod._planPecaAdesivos(pecaLegadoBranco);
  test('H1. Peça legada com adesivo="branco" converte para {normal:false, branco:true}', r, { normal: false, branco: true });

  var pecasLegadas = caixaPecas({ Base: { adesivo: 'branco' } });
  var rLegado = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasLegadas }] });
  testePerto('H2. Orçamento legado (só "branco") cobra corretamente só o Adh. Branco', parseBRL(rLegado.ocv_adhb.textContent), 1200*ADHB, 0.01);
  ok('H3. Orçamento legado (só "branco") NÃO cobra Adesivo normal', parseBRL(rLegado.ocv_adh.textContent) === 0);

  // Também confirma o caso "sem valor" do mapeamento legado explicitado
  // pelo usuário: ausência total do campo = os dois false.
  var pecaLegadoVazio = { nome: 'X' };
  test('H4. Peça legada SEM o campo adesivo nenhum → {normal:false, branco:false}', mod._planPecaAdesivos(pecaLegadoVazio), { normal: false, branco: false });
}

// ══════════════════════════════════════════════════════════════════════
// TESTE I — snapshot da OS mostra os dois adesivos, sem custo/preço/cm²
// ══════════════════════════════════════════════════════════════════════
{
  var pecasI = caixaPecas({ Tampa: { adesivoNormal: true, adesivoBranco: true } });
  var itemOrcamento = { tipoItem: 'personalizado_vr', prod: 'Caixa', qty: 1, larg: 0, alt: 0, pieces: pecasI, planArea: areaPlan(pecasI), det: '' };
  var seguro = mod.osProjecaoOperacionalItem(itemOrcamento);
  var tampaOS = seguro.pieces.find(function(p){ return p.nome==='Tampa'; });
  ok('I1. Tampa chega na OS com os dois campos intactos (adesivoNormal e adesivoBranco)', tampaOS.adesivoNormal===true && tampaOS.adesivoBranco===true);
  ok('I2. osProjecaoOperacionalItem() nunca inclui preço/custo/margem (whitelist só técnica)', !('unit' in seguro) && !('total' in seguro) && !('custo' in seguro));

  var kbSrc = extractFn('kbAbrirPlanificacaoItem');
  ok('I3. kbAbrirPlanificacaoItem() usa dois `if` independentes (nunca else-if) para mostrar os dois adesivos ao mesmo tempo', /if \(_adesOS\.normal\) _consLabels\.push/.test(kbSrc) && /if \(_adesOS\.branco\) _consLabels\.push/.test(kbSrc) && !/else if \(_adesOS\.branco\)/.test(kbSrc));
  ok('I4. a coluna Consumíveis da OS nunca mostra preço (só rótulo textual)', !/R\$.*adesivo|adhPrecoCm2/i.test(kbSrc));
}
// ══════════════════════════════════════════════════════════════════════
// TESTE J — REGRESSÃO do commit 3cc691e: criar em 4mm, planificar, trocar
// para 2mm, com uma peça tendo os DOIS adesivos. Esperado: espessura
// herdada atualiza corretamente, adesivos permanecem na mesma peça, preço
// recalcula corretamente (custo de material converge com criar direto em
// 2mm) — nada da Rodada 7 regride.
// ══════════════════════════════════════════════════════════════════════
{
  global._planEditPieces = []; // limpa resíduo de testes anteriores (Teste F injeta fixture própria)
  var CATALOGO = [
    { nome: 'Acrílico Cristal 2mm', custo: 100, comp: 200, larg: 100, rsm2: 98.50,  esp: 2 },
    { nome: 'Acrílico Cristal 4mm', custo: 200, comp: 200, larg: 100, rsm2: 196.20, esp: 4 }
  ];
  function matKeyPara(espMm) { return 'cfg_' + CATALOGO.findIndex(function(m){ return m.esp===espMm; }); }
  var L=40, A=30, P=20;

  function montarDOM(itens) {
    var _els = rodarCenarioBase(itens);
    return _els;
  }
  function rodarCenarioBase(itens) {
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
    global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {};
    global._orcVitreItensPedido = [];
    global.orcVitreItensPedidoTotal = function () { return 0; };
    global.window = global;
    global.window._orcAdhPrecoSnapshot = null;
    mod.orcRecalc();
    return _els;
  }
  function planificarCaixa(espMm, adesivosNaTampa) {
    var rec = mod.planGetRecipe('Caixa', null);
    var fresh = rec.pieces(L, A, P, espMm/10, {});
    var pecas = mod._planReconcilePieces(fresh, espMm).map(function(p){
      return Object.assign({}, p, { espessuraMm: parseInt(p.esp||0)||null, origem: 'AUTOMATICA' });
    });
    if (adesivosNaTampa) { var t = pecas.find(function(p){return p.nome==='Tampa';}); t.adesivoNormal=true; t.adesivoBranco=true; }
    return pecas;
  }

  // "Planificado em 4mm" com Tampa levando os DOIS adesivos.
  var pecasEm4mm = planificarCaixa(4, true);
  var els = montarDOM([{ idx: '1', qty: 1, matKey: matKeyPara(4), espItem: 4, pecas: pecasEm4mm }]);
  // Troca o select para 2mm SEM reabrir a planificação (exatamente o
  // fluxo real de orcMatChanged: atualiza oi_esp_ e chama o resync).
  els['oi_esp_1'].value = '2';
  els['oi_mat_1'].value = matKeyPara(2);
  mod._planResincronizarPecasHerdadas('1');
  mod.orcRecalc();

  var pecasAposTroca = JSON.parse(els.oir_1.dataset.planPecas);
  var tampaAposTroca = pecasAposTroca.find(function(p){ return p.nome==='Tampa'; });
  ok('J1. Espessura herdada da Tampa atualiza para 2mm (Rodada 7 intacta)', String(tampaAposTroca.esp)==='2');
  ok('J2. Os dois adesivos permanecem na MESMA peça (Tampa) depois da troca de material', tampaAposTroca.adesivoNormal===true && tampaAposTroca.adesivoBranco===true);

  var custoTrocado = parseBRL(els.oi_custo_1.textContent);
  var custoDireto2mm = parseBRL(rodarCenarioBase([{ idx: '1', qty: 1, matKey: matKeyPara(2), espItem: 2, pecas: planificarCaixa(2, true) }]).oi_custo_1.textContent);
  testePerto('J3. Custo de material converge com criar direto em 2mm (regra da Rodada 7 preservada, mesmo com os dois adesivos na peça)', custoTrocado, custoDireto2mm, 0.05);

  var adhTampaCm2 = tampaAposTroca.larg*tampaAposTroca.alt*tampaAposTroca.qty;
  testePerto('J4. Adesivo normal recalcula pela área ATUAL (2mm) da Tampa, não pela área congelada de 4mm', parseBRL(els.ocv_adh.textContent), adhTampaCm2*ADH, 0.05);
  testePerto('J5. Adesivo branco recalcula pela área ATUAL (2mm) da Tampa, não pela área congelada de 4mm', parseBRL(els.ocv_adhb.textContent), adhTampaCm2*ADHB, 0.05);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
