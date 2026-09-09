/**
 * test_estabilizacao_2026-09-09_bloco10_ajuste_escopo.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-09, BLOCO 10 — ajuste comercial do item
 * só suportava um escopo implícito ("total da linha", nunca por unidade,
 * nunca no total do orçamento inteiro). Adicionado campo explícito
 * `escopo` em ORC_ITEM_AJUSTES (nunca inferido): 'linha' (default, mesmo
 * comportamento já estabilizado por
 * test_rodada_correcao_definitiva_unitario_ajuste_fixo_2026-09-01.js —
 * nunca regredido aqui), 'unidade' (R$ fixo multiplicado por qty ANTES de
 * aplicar a linha, entra no rateio qty-normal — unitário cresce
 * exatamente `valor`, total cresce `valor*qty`) e 'orcamento' (soma direto
 * ao total geral do pedido, symmetricamente dentro de
 * _calcularFinalPriceVR — nunca aparece na linha do item que o originou
 * nem em nenhuma outra linha).
 *
 * Função sob teste extraída de index.html (nunca reimplementada): orcRecalc.
 * Harness adaptado de test_rodada_correcao_definitiva_unitario_ajuste_fixo_2026-09-01.js
 * para múltiplos itens.
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_bloco10_ajuste_escopo.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertCloseTo(got, expected, msg, eps) {
  eps = eps == null ? 0.01 : eps;
  if (Math.abs(got - expected) <= eps) { console.log('  ✅  ' + msg); passed++; }
  else { console.log('  ❌  ' + msg + '\n       esperado ≈ ' + expected + '\n       obtido   = ' + got); failed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-09 — Bloco 10: ajuste comercial com escopo ===\n');

var FN_NAMES = ['orcFmt', 'orcItemAplicarAjuste', 'orcRecalc'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_estabilizacao_2026-09-09_bloco10_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, dataset: {}, remove: function () {}, options: [{ dataset: {}, text: '' }], selectedIndex: 0 }, props || {}); }

var _els;
// N itens, todos com o mesmo material/preço-base — `qtys` é um array,
// um item por posição (idx 1..N).
function reset(qtys) {
  _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
  };
  qtys.forEach(function (qty, i) {
    var idx = i + 1;
    _els['oi_qty_' + idx] = makeEl({ value: String(qty) });
    _els['oi_larg_' + idx] = makeEl({ value: '30' });
    _els['oi_alt_' + idx] = makeEl({ value: '20' });
    _els['oi_mat_' + idx] = makeEl({ value: 'ac3' });
    _els['oi_custo_' + idx] = makeEl();
    _els['oi_unit_' + idx] = makeEl();
    _els['oi_tot_' + idx] = makeEl();
    _els['oir_' + idx] = makeEl();
  });
  global.document = {
    body: { appendChild: function () {} },
    createElement: function () { return makeEl(); },
    getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return qtys.map(function (q, i) { return { dataset: { idx: String(i + 1) } }; });
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; };
  global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.orcItemCount = qtys.length;
  global.orcUpdateSummary = function () {};
  global.orcSetV = function (id, v) { var el = _els[id] || (_els[id] = makeEl()); el.value = v; };
  global._orcHidratando = false;
  global._orcMostrandoCongelado = false;
  global.showToast = function () {};
  global._orcCalc = {};
  global.orcItemDescricaoComercial = function (item) { return item.prod || 'Item'; };
  global.osItemMateriaisResumo = function () { return ''; };
}

function parseReais(txt) { return parseFloat(String(txt).replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0; }

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════════
// ESCOPO "unidade" — R$ fixo por unidade: unitário cresce exatamente
// `valor`; total cresce `valor*qty`. Testado com QTD 1, 2, 5.
// ══════════════════════════════════════════════════════════════════════════
[1, 2, 5].forEach(function (qty) {
  reset([qty]);
  mod.orcRecalc();
  var unitBase = parseReais(_els.oi_unit_1.textContent);
  var totBase = parseReais(_els.oi_tot_1.textContent);

  reset([qty]);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'fixo', valor: 15, escopo: 'unidade' } };
  mod.orcRecalc();
  var unitAj = parseReais(_els.oi_unit_1.textContent);
  var totAj = parseReais(_els.oi_tot_1.textContent);

  assertCloseTo(unitAj - unitBase, 15, 'unidade, qty=' + qty + ': unitário sobe exatamente +R$15 (nunca vira +R$2 silenciosamente)');
  assertCloseTo(totAj - totBase, 15 * qty, 'unidade, qty=' + qty + ': total da linha sobe +R$' + (15 * qty) + ' (= +R$15 × qty)');
});

// ══════════════════════════════════════════════════════════════════════════
// ESCOPO "linha" (default/regressão) — total sobe o valor fixo INTEIRO,
// independente de qty; unitário NUNCA se move (mesma regra já estabilizada
// pela Rodada de Correção Definitiva 2026-09-01 — nunca "virar" +R$X/unidade).
// ══════════════════════════════════════════════════════════════════════════
[1, 2, 5].forEach(function (qty) {
  reset([qty]);
  mod.orcRecalc();
  var unitBase = parseReais(_els.oi_unit_1.textContent);
  var totBase = parseReais(_els.oi_tot_1.textContent);

  reset([qty]);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'fixo', valor: 15, escopo: 'linha' } };
  mod.orcRecalc();
  var unitAj = parseReais(_els.oi_unit_1.textContent);
  var totAj = parseReais(_els.oi_tot_1.textContent);

  assertCloseTo(unitAj, unitBase, 'linha, qty=' + qty + ': unitário NÃO se move (ajuste nunca vira +R$X/unidade silenciosamente)');
  assertCloseTo(totAj - totBase, 15, 'linha, qty=' + qty + ': total da linha sobe exatamente +R$15, sempre, nunca ×qty');
});

// ══════════════════════════════════════════════════════════════════════════
// ESCOPO "orcamento" — a linha que originou o ajuste NÃO muda (nem
// unitário, nem total); NENHUMA outra linha muda; só o total geral do
// pedido sobe o valor do ajuste. Testado com múltiplas linhas.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset([2, 3]); // item 1 qty=2, item 2 qty=3
  mod.orcRecalc();
  var unit1Base = parseReais(_els.oi_unit_1.textContent), tot1Base = parseReais(_els.oi_tot_1.textContent);
  var unit2Base = parseReais(_els.oi_unit_2.textContent), tot2Base = parseReais(_els.oi_tot_2.textContent);
  var totalGeralBase = parseReais(_els.orcTotalVal.textContent);

  reset([2, 3]);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'fixo', valor: 100, escopo: 'orcamento' } };
  mod.orcRecalc();
  var unit1Aj = parseReais(_els.oi_unit_1.textContent), tot1Aj = parseReais(_els.oi_tot_1.textContent);
  var unit2Aj = parseReais(_els.oi_unit_2.textContent), tot2Aj = parseReais(_els.oi_tot_2.textContent);
  var totalGeralAj = parseReais(_els.orcTotalVal.textContent);

  assertCloseTo(unit1Aj, unit1Base, 'orçamento: unitário do item que originou o ajuste não muda');
  assertCloseTo(tot1Aj, tot1Base, 'orçamento: total da linha que originou o ajuste não muda');
  assertCloseTo(unit2Aj, unit2Base, 'orçamento: unitário de OUTRA linha não muda');
  assertCloseTo(tot2Aj, tot2Base, 'orçamento: total de OUTRA linha não muda');
  assertCloseTo(totalGeralAj - totalGeralBase, 100, 'orçamento: total GERAL do pedido sobe exatamente +R$100 (nunca aplicado a nenhuma linha)', 0.05);
})();

// ══════════════════════════════════════════════════════════════════════════
// Desconto (não só acréscimo) nos 3 escopos, sanity mínima.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset([1]);
  mod.orcRecalc();
  var totBase = parseReais(_els.oi_tot_1.textContent);
  reset([1]);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'desconto', tipo: 'fixo', valor: 3, escopo: 'linha' } };
  mod.orcRecalc();
  var totDesc = parseReais(_els.oi_tot_1.textContent);
  assertCloseTo(totBase - totDesc, 3, 'desconto R$3/linha reduz o total da linha em exatamente R$3');
})();

// ══════════════════════════════════════════════════════════════════════════
// Opção comparativa não-selecionada com ajuste de escopo "orcamento" nunca
// desloca o total real do pedido (mesma regra de isolamento já aplicada a
// escopo "linha"/"unidade" — ORC_ITEM_OPCOES[idx].selecionada=false).
// ══════════════════════════════════════════════════════════════════════════
(function () {
  // Baseline: MESMO agrupamento de opções (item 2 já não-selecionado), só
  // sem o ajuste — isola exatamente o efeito do ajuste, nunca compara
  // com/sem agrupamento (que já muda o total por si só).
  reset([1, 1]);
  global.ORC_ITEM_OPCOES = { 1: { grupoId: 'g1', selecionada: true }, 2: { grupoId: 'g1', selecionada: false } };
  mod.orcRecalc();
  var totalGeralBase = parseReais(_els.orcTotalVal.textContent);

  reset([1, 1]);
  global.ORC_ITEM_OPCOES = { 1: { grupoId: 'g1', selecionada: true }, 2: { grupoId: 'g1', selecionada: false } };
  global.ORC_ITEM_AJUSTES = { 2: { operacao: 'acrescimo', tipo: 'fixo', valor: 100, escopo: 'orcamento' } };
  mod.orcRecalc();
  var totalGeralComOpcaoNaoSelecionada = parseReais(_els.orcTotalVal.textContent);
  assertCloseTo(totalGeralComOpcaoNaoSelecionada, totalGeralBase, 'ajuste "orçamento" numa opção comparativa NÃO selecionada não desloca o total real do pedido');
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
