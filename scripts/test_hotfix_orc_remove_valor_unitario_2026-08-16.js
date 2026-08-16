/**
 * test_hotfix_orc_remove_valor_unitario_2026-08-16.js
 *
 * HOTFIX OPERACIONAL 2026-08-16 (P0.11) — o resumo lateral do orçamento
 * mostrava "R$X / unidade" abaixo do Orçamento Total sempre que a
 * quantidade total de peças fosse > 1. Isso é enganoso quando o
 * orçamento tem produtos DIFERENTES (Caixa + Display + Bandeja, cada um
 * com preço próprio) — não existe "valor unitário médio" útil nesse
 * cenário. Removido: orcUnitLbl/orcUnitLbl3 (cards principal e da Etapa
 * 3) nunca mais são populados, independente da quantidade total. Preço
 * unitário continua disponível na linha de cada item (oi_unit_<idx>).
 *
 * Reusa o harness real de orcRecalc() (mesmo padrão de
 * test_sprint_pregolive_blocoD_integracao_orcRecalc_2026-08-09.js — nunca
 * reimplementado).
 *
 * Uso: node scripts/test_hotfix_orc_remove_valor_unitario_2026-08-16.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
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

var FN_NAMES = ['orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'orcRecalc'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = { orcRecalc: orcRecalc };"
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_orc_unit_removido_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== HOTFIX 2026-08-16 (P0.11) — "R$/unidade" removido do resumo do orçamento ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false }, props || {}); }

function rodarCenario(qty) {
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oi_qty_1: makeEl({ value: String(qty) }), oi_larg_1: makeEl({ value: '100' }), oi_alt_1: makeEl({ value: '100' }),
    oi_mat_1: makeEl({ value: 'ac3' }),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(),
    oir_1: { dataset: {} },
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl({ textContent: 'lixo-anterior' }), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl({ textContent: 'lixo-anterior' }), orcBreak3: makeEl()
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return [{ dataset: { idx: '1' } }];
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;

  var mod = require(modPath);
  mod.orcRecalc();
  return _els;
}

test('1. qty=1 (nunca mostrou "/unidade" mesmo antes) — orcUnitLbl continua vazio', rodarCenario(1).orcUnitLbl.textContent, '');
test('2. qty=3 (ANTES do hotfix mostraria "R$X / unidade") — orcUnitLbl fica vazio', rodarCenario(3).orcUnitLbl.textContent, '');
test('3. qty=3 — orcUnitLbl3 (card da Etapa 3) também fica vazio', rodarCenario(3).orcUnitLbl3.textContent, '');
test('4. qty=10 — nenhum valor "/ unidade" vaza em nenhum dos dois cards', (function () {
  var e = rodarCenario(10);
  return { u1: e.orcUnitLbl.textContent, u2: e.orcUnitLbl3.textContent };
})(), { u1: '', u2: '' });
{
  var e5 = rodarCenario(3);
  test('5. o total geral (orcTotalVal) continua correto — só a linha de unitário foi removida', e5.orcTotalVal.textContent, orcFmtEsperado(300));
}
function orcFmtEsperado(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
fs.unlinkSync(modPath);
if (failed > 0) process.exitCode = 1;
