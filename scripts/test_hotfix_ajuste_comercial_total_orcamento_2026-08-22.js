/**
 * test_hotfix_ajuste_comercial_total_orcamento_2026-08-22.js
 *
 * RODADA 9, BLOCO E (2026-08-22) — bug real: preço da linha R$105,12,
 * acréscimo fixo R$10,00 → modal mostra corretamente 105,12 → 115,12;
 * enquanto o modal está aberto, o total do orçamento mostra R$117,41;
 * depois de clicar SALVAR, o total do orçamento cai para R$117,31 — uma
 * perda de R$0,10 que não pode acontecer (mesmas entradas → mesmo total,
 * sempre, antes e depois de salvar).
 *
 * Causa raiz (confirmada por investigação dedicada, lendo o código, não
 * suposição): orcItemExtras() (abre o modal "⚙️ Custos" de um item)
 * dispara orcExtrasAutoLaser() incondicionalmente (linha ~11701), que
 * recalcula o campo LOCAL do modal (m_laser) a partir da geometria do
 * item — mas esse valor só era empurrado para o campo GLOBAL do Step 3
 * (om_laser, que alimenta orcRecalc()/o total ao vivo) no "✅ Salvar" do
 * modal (orcItemExtrasSalvar, linha ~11934). Resultado: enquanto o modal
 * está aberto e o vendedor edita SÓ o ajuste comercial, o total ao vivo
 * (orcItemExtraPreview → orcRecalc) ainda reflete o om_laser ANTIGO; ao
 * salvar, om_laser muda para o valor recalculado e o total muda junto —
 * mesmo o vendedor não tendo tocado em nenhum campo de máquina.
 *
 * Corrigido: orcItemExtras() sincroniza om_laser com o valor recalculado
 * IMEDIATAMENTE na abertura do modal (mesmo valor que "Salvar" aplicaria
 * de qualquer forma) — o total ao vivo já reflete o que será persistido,
 * nunca uma surpresa. Cancelar (orcItemExtrasFechar) reverte om_laser via
 * snapshot (_omLaserSnapshot), exatamente como já fazia para
 * extras/ajuste comercial — abrir e cancelar o modal nunca muda o total.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * orcItemExtras, orcItemExtrasFechar, orcItemExtrasSalvar,
 * orcItemExtraPreview, orcRecalc, orcItemAplicarAjuste, orcFmt, orcSetV.
 * orcExtrasAutoLaser é STUBADA (controlável pelo teste) — é uma função de
 * cálculo geométrico de laser não relacionada ao bug; o mesmo padrão já
 * usado pelos testes existentes de orcRecalc() (_matGetRsm2 stubado).
 *
 * Uso: node scripts/test_hotfix_ajuste_comercial_total_orcamento_2026-08-22.js
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
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

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

var FN_NAMES = ['orcProdutoNomeResolvido', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'orcRecalc', 'orcItemExtras', 'orcItemExtrasFechar', 'orcItemExtrasSalvar', 'orcItemExtraPreview'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_ajuste_comercial_total_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, dataset: {} }, props || {}); }

var _els, _toasts;
function reset(baseOverrides) {
  _els = Object.assign({
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl({ value: '100' }), oi_alt_1: makeEl({ value: '100' }),
    oi_mat_1: makeEl({ value: 'ac3' }),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(),
    oir_1: makeEl(),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    orcItemExtrasOverlay: makeEl(),
    oi_prod_1: makeEl({ value: 'Item Teste' }),
    exAjusteOp: makeEl({ value: '' }), exAjusteTipo: makeEl({ value: 'fixo' }), exAjusteValor: makeEl({ value: '' }),
    exAcabamento: makeEl({ value: '0' }), exInstalacao: makeEl({ value: '0' }), exOutros: makeEl({ value: '0' }), exDesc: makeEl({ value: '' }),
    exPreview: makeEl(), exAjustePreview: makeEl(),
    m_laser: makeEl({ value: '0' }), m_laserManual: makeEl({ checked: false }), m_laserManualTag: makeEl(), m_laserMemBox: makeEl(),
  }, baseOverrides || {});
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
  global._matGetRsm2 = function () { return 105.12; }; // material a R$105,12/m² (área 1m² → linha bate exatamente com o caso relatado)
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.orcItemCount = 1;
  global._orcLaserAjusteManual = false;
  global._MACH_PRESETS = [];
  _toasts = [];
  global.showToast = function (msg, kind) { _toasts.push({ msg: msg, kind: kind }); };
  // orcExtrasAutoLaser é uma função de geometria/velocidade de corte não
  // relacionada ao bug — stubada e controlável pelo teste (mesmo padrão
  // já usado por _matGetRsm2 no teste irmão de integração de orcRecalc).
  global._laserAutoValor = null; // controlado por cada cenário
  global.orcExtrasAutoLaser = function () {
    if (global._laserAutoValor != null) {
      var isManual = !!(_els.m_laserManual || {}).checked;
      if (!isManual) _els.m_laser.value = String(global._laserAutoValor);
    }
  };
  global.orcExtrasCalcMaq = function () {};
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 9, Bloco E — total do orçamento não pode mudar entre "editar" e "salvar" ===\n');

// ── 1-2. Reprodução direta do caso relatado: 105,12 + 10,00 = 115,12 ────────
(function () {
  reset();
  global._laserAutoValor = null; // sem recálculo de laser neste cenário base
  ORC_ITEM_AJUSTES[1] = { operacao: 'acrescimo', tipo: 'fixo', valor: 10 };
  mod.orcRecalc();
  test('1. linha: R$105,12 + R$10,00 (acréscimo fixo) = R$115,12 — exatamente o caso relatado', _els.oi_tot_1.textContent, 'R$115,12');
})();

// ── 3. Achado original: total NÃO pode mudar entre "modal aberto" e "depois de Salvar" ──
(function () {
  reset({ om_laser: makeEl({ value: '0' }) });
  // Simula: o recálculo automático de laser (na abertura do modal)
  // produziria um valor DIFERENTE de om_laser (achado real) — antes da
  // correção, isso só afetava o total DEPOIS de clicar "Salvar" no modal.
  global._laserAutoValor = 12.5;
  mod.orcItemExtras(1); // abre o modal — dispara a sincronização corrigida
  var totalAoAbrir = _els.orcTotalVal.textContent;

  // Vendedor edita SÓ o ajuste comercial, ao vivo (sem tocar em máquinas):
  _els.exAjusteOp.value = 'acrescimo'; _els.exAjusteTipo.value = 'fixo'; _els.exAjusteValor.value = '10';
  mod.orcItemExtraPreview(1);
  var totalAoVivo = _els.orcTotalVal.textContent;

  mod.orcItemExtrasSalvar(1); // "✅ Salvar" do modal
  var totalDepoisDeSalvar = _els.orcTotalVal.textContent;

  test('3. achado original corrigido: total ao vivo (enquanto edito o ajuste) é IDÊNTICO ao total depois de clicar Salvar — nunca uma perda de centavos', totalAoVivo, totalDepoisDeSalvar);
  assertTrue(totalAoAbrir !== undefined, 'pré-condição: modal abriu e calculou um total inicial');
})();

// ── 4. Cancelar o modal (sem Salvar) nunca muda o total ──────────────────
(function () {
  reset({ om_laser: makeEl({ value: '3' }) });
  mod.orcRecalc();
  var totalAntesDeAbrir = _els.orcTotalVal.textContent;

  global._laserAutoValor = 20; // recálculo automático produziria um valor bem diferente
  mod.orcItemExtras(1); // abre — sincroniza om_laser=20 (comportamento corrigido)
  test('4a. ao abrir o modal, om_laser É sincronizado com o valor recalculado (mesmo que "Salvar" aplicaria)', _els.om_laser.value, '20');

  mod.orcItemExtrasFechar(); // Cancelar — nunca clicou em "Salvar"
  test('4b. ao CANCELAR (sem Salvar), om_laser volta ao valor de antes de abrir o modal — nunca fica com a sincronização automática presa', _els.om_laser.value, '3');
  mod.orcRecalc();
  test('4c. total do orçamento depois de abrir-e-cancelar é IDÊNTICO ao de antes de abrir — cancelar nunca muda o total', _els.orcTotalVal.textContent, totalAntesDeAbrir);
})();

// ── 5. Ajuste manual de laser (checkbox "MANUAL") nunca é sobrescrito pela sincronização ──
(function () {
  reset({ om_laser: makeEl({ value: '7' }), m_laser: makeEl({ value: '7' }) });
  _els.m_laserManual.checked = true; // vendedor já fixou o laser manualmente
  global._orcLaserAjusteManual = true;
  global._laserAutoValor = 99; // recálculo automático NUNCA deveria rodar neste modo
  mod.orcItemExtras(1);
  test('5. modo manual de laser: abrir o modal não sobrescreve om_laser com nenhum recálculo automático', _els.om_laser.value, '7');
})();

// ── 6-10. Bases/acréscimos variados pedidos explicitamente — sempre exatos ──
[
  { base: 100.01, acres: 0.10, esperado: 'R$100,11' },
  { base: 105.12, acres: 1.00, esperado: 'R$106,12' },
  { base: 105.12, acres: 10.00, esperado: 'R$115,12' },
  { base: 105.12, acres: 10.37, esperado: 'R$115,49' },
  { base: 199.99, acres: 99.99, esperado: 'R$299,98' },
].forEach(function (c, i) {
  reset();
  global._matGetRsm2 = function () { return c.base; };
  global._laserAutoValor = null;
  ORC_ITEM_AJUSTES[1] = { operacao: 'acrescimo', tipo: 'fixo', valor: c.acres };
  mod.orcRecalc();
  test((6 + i) + '. base R$' + c.base.toFixed(2) + ' + acréscimo fixo R$' + c.acres.toFixed(2) + ' = ' + c.esperado, _els.oi_tot_1.textContent, c.esperado);
});

// ── 11. Acréscimo percentual continua funcionando corretamente ──────────
(function () {
  reset();
  global._matGetRsm2 = function () { return 105.12; };
  global._laserAutoValor = null;
  ORC_ITEM_AJUSTES[1] = { operacao: 'acrescimo', tipo: 'percentual', valor: 10 };
  mod.orcRecalc();
  test('11. base R$105,12 + 10% (percentual) = R$115,63 (105,12×1,10, arredondado ao centavo)', _els.oi_tot_1.textContent, 'R$115,63');
})();

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
