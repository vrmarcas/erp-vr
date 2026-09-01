/**
 * test_rodada_correcao_definitiva_unitario_ajuste_fixo_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA — bug recorrente: unitário mudando com qty.
 *
 * BUG real de produção (reportado de novo após a Rodada de Estabilização de
 * 2026-08-23 já ter corrigido o caso de custo fixo do PEDIDO): qty=1 → unit
 * R$26,61, qty=2 → unit R$26,38. Não é o mesmo caminho já coberto por
 * test_estabilizacao_bloco_d_unitario_2026-08-23.js (aquele cobre máquina/
 * montagem/deslocamento; este cobre o ajuste comercial POR ITEM).
 *
 * Causa raiz: um ajuste comercial tipo 'fixo' (R$ fixo NA LINHA — ver preview
 * "Preço da linha: X → Y" em orcItemExtraPreview, index.html) entrava em
 * item.tsRaw, que o PASS 3 de orcRecalc() usa como peso E divide por
 * item.qty para achar o "Unit.". Um valor fixo em R$ dividido por qty nunca
 * é constante — mesma classe de bug do Bloco D, só que pelo ajuste PRÓPRIO
 * do item em vez do custo fixo do pedido. gatilho real na UI: modal "⚙️
 * Custos" do item, campo Acréscimo/Desconto com tipo R$ (default do campo
 * exAjusteTipo é 'fixo').
 *
 * Corrigido: 'fixo' nunca mais entra no peso qty-divisível (tsRaw fica só
 * material/percentual, sempre linear em qty) — o delta vai inteiro, sem
 * divisão, para item.ajusteFixoProprio, somado direto no TOTAL da linha no
 * PASS 3 (nunca no Unit.), exatamente como os extras "➕ deste Item"
 * (Acabamento/Instalação/Outros) já funcionavam. 'percentual' continua
 * embutido no peso como sempre (uma % de uma base linear em qty preserva o
 * unitário constante — nunca foi o bug).
 *
 * Função sob teste extraída de index.html (nunca reimplementada): orcRecalc.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_unitario_ajuste_fixo_2026-09-01.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertCloseTo(got, expected, msg, eps) {
  eps = eps == null ? 0.005 : eps;
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

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Unitário × ajuste comercial fixo por item ===\n');

var FN_NAMES = ['orcFmt', 'orcItemAplicarAjuste', 'orcRecalc'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_rodada_correcao_definitiva_unitario_ajuste_fixo.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, dataset: {}, remove: function () {}, options: [{ dataset: {}, text: '' }], selectedIndex: 0 }, props || {}); }

var _els;
function reset(qty) {
  _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    oi_qty_1: makeEl({ value: String(qty) }), oi_larg_1: makeEl({ value: '30' }), oi_alt_1: makeEl({ value: '20' }),
    oi_mat_1: makeEl({ value: 'ac3' }),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }), // sem custo fixo do pedido — isola o ajuste por item
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(),
    oir_1: makeEl(),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
  };
  global.document = {
    body: { appendChild: function () {} },
    createElement: function () { return makeEl(); },
    getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return [{ dataset: { idx: '1' } }];
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; }; // R$100/m² fixo — mesma config em todos os testes
  global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.orcItemCount = 1;
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
// 1-5 — ajuste comercial FIXO (R$) tipo 'acrescimo' no item: unitário
// IDÊNTICO em qty 1/2/5/10 — reprodução exata do caso real relatado
// (qty 1 → R$26,61, qty 2 → R$26,38).
// ══════════════════════════════════════════════════════════════════════════
var unitariosFixo = {};
[1, 2, 5, 10].forEach(function (qty) {
  reset(qty);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'fixo', valor: 5 } };
  mod.orcRecalc();
  unitariosFixo[qty] = parseReais(_els.oi_unit_1.textContent);
});
assertCloseTo(unitariosFixo[2], unitariosFixo[1], '1. ajuste fixo R$5: qty 1 → 2, unitário idêntico (' + unitariosFixo[1] + ' ≈ ' + unitariosFixo[2] + ') — reprodução exata do caso real (R$26,61 → R$26,38)');
assertCloseTo(unitariosFixo[5], unitariosFixo[1], '2. ajuste fixo R$5: qty 1 → 5, unitário idêntico');
assertCloseTo(unitariosFixo[10], unitariosFixo[1], '3. ajuste fixo R$5: qty 1 → 10, unitário idêntico');
assertTrue(unitariosFixo[1] > 0, '4. (sanity) unitário com ajuste fixo é um valor real positivo');

// ══════════════════════════════════════════════════════════════════════════
// 5-6 — o ajuste fixo continua 100% cobrado no TOTAL da linha — só deixou
// de ser diluído no unitário (mesmo padrão de itemExtrasProprio).
// ══════════════════════════════════════════════════════════════════════════
[1, 3].forEach(function (qty) {
  reset(qty);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'fixo', valor: 5 } };
  mod.orcRecalc();
  reset(qty);
  mod.orcRecalc();
  var totalSemAjuste = parseReais(_els.oi_tot_1.textContent);
  reset(qty);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'fixo', valor: 5 } };
  mod.orcRecalc();
  var totalComAjuste = parseReais(_els.oi_tot_1.textContent);
  assertCloseTo(totalComAjuste - totalSemAjuste, 5, '5b. qty=' + qty + ': ajuste fixo de R$5 aparece INTEIRO no total (diferença = R$5,00, nunca diluído)');
});

// ══════════════════════════════════════════════════════════════════════════
// 7 — desconto fixo (operacao='desconto') também mantém unitário constante.
// ══════════════════════════════════════════════════════════════════════════
var unitariosDescontoFixo = {};
[1, 4].forEach(function (qty) {
  reset(qty);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'desconto', tipo: 'fixo', valor: 3 } };
  mod.orcRecalc();
  unitariosDescontoFixo[qty] = parseReais(_els.oi_unit_1.textContent);
});
assertCloseTo(unitariosDescontoFixo[4], unitariosDescontoFixo[1], '7. desconto fixo R$3: qty 1 → 4, unitário idêntico');

// ══════════════════════════════════════════════════════════════════════════
// 8 — ajuste PERCENTUAL continua funcionando (não é o bug, deve seguir
// mantendo o unitário constante entre qtys, como já garantido pela Rodada
// de Estabilização de 2026-08-23 — aqui só confirmamos que esta correção
// não regrediu o caminho percentual).
// ══════════════════════════════════════════════════════════════════════════
var unitariosPct = {};
[1, 2, 6].forEach(function (qty) {
  reset(qty);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'percentual', valor: 20 } };
  mod.orcRecalc();
  unitariosPct[qty] = parseReais(_els.oi_unit_1.textContent);
});
assertCloseTo(unitariosPct[2], unitariosPct[1], '8a. ajuste percentual 20%: qty 1 → 2, unitário idêntico (não regrediu)');
assertCloseTo(unitariosPct[6], unitariosPct[1], '8b. ajuste percentual 20%: qty 1 → 6, unitário idêntico (não regrediu)');

// ══════════════════════════════════════════════════════════════════════════
// 9 — ida e volta: aplicar ajuste fixo, remover, unitário volta ao valor base.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset(3);
  mod.orcRecalc();
  var unitBase = parseReais(_els.oi_unit_1.textContent);

  reset(3);
  global.ORC_ITEM_AJUSTES = { 1: { operacao: 'acrescimo', tipo: 'fixo', valor: 8 } };
  mod.orcRecalc();
  var unitComAjuste = parseReais(_els.oi_unit_1.textContent);
  assertCloseTo(unitComAjuste, unitBase, '9a. ajuste fixo NÃO altera o unitário (só o total) — unitário com ajuste = unitário base');

  reset(3);
  global.ORC_ITEM_AJUSTES = {};
  mod.orcRecalc();
  var unitSemAjuste = parseReais(_els.oi_unit_1.textContent);
  assertCloseTo(unitSemAjuste, unitBase, '9b. removendo o ajuste fixo, unitário permanece exatamente no valor base');
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
