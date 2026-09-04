/**
 * test_estabilizacao_bloco3_adesivo_legado_soma_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 3 — "adesivo marcado na peça
 * não afeta o preço". Uma das causas raiz confirmadas nesta rodada:
 * quando o toggle GLOBAL legado (oc_adh/oc_adhb, Step 3 "⚙️ Custos") está
 * 'sim' — só acontece em orçamento salvo ANTES da Rodada 5, ou se alguém
 * mexer manualmente nesse controle legado — o cálculo `adhYes ? X : Y`
 * DESCARTAVA por completo qualquer adesivo marcado peça a peça: o
 * checkbox aparecia marcado no modal de Planificação, mas o preço nunca
 * reagia, sem nenhum aviso visual do porquê.
 *
 * Corrigido: os dois valores agora SOMAM (`(adhYes?X:0) + adhPecasTotal`)
 * em vez de um substituir o outro — nunca cobrança dupla no caso comum
 * (legado 'sim' só ocorre em orçamento sem nenhuma peça com adesivo
 * marcado, então adhPecasTotal=0 nesse cenário), mas o checkbox por peça
 * passa a ter efeito real em QUALQUER situação.
 *
 * Uso: node scripts/test_estabilizacao_bloco3_adesivo_legado_soma_2026-09-04.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function testePerto(desc, got, expected, tolerancia) {
  tolerancia = tolerancia == null ? 0.02 : tolerancia;
  if (Math.abs(got - expected) <= tolerancia) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado ≈ ' + expected + '\n       obtido   = ' + got); failed++; }
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

var FN_NAMES = ['orcFmt', 'orcSetV', 'orcGetItemExtrasTotal', 'orcRecalc', '_planPecaAdesivos', '_planPecaEspOverride', '_matResolverPrecoFamiliaEspessura'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_bloco3_adesivo_legado_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 3 — adesivo legado + por peça somam ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// 1 item, 1 peça automática 100x100cm (1m² = 10000cm²) marcada com
// adesivo normal. adhPrecoCm2 default = 0.0056 (hardcoded fallback).
function montarCenario(oc_adh_value, pecaTemAdesivo) {
  var materiaisCatalogo = [{ nome: 'Acrílico Cristal', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }];
  var pecas = pecaTemAdesivo ? [{ nome: 'Base', larg: 100, alt: 100, qty: 1, origem: 'AUTOMATICA', adesivoNormal: true }] : [];
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: oc_adh_value }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl({ value: '100' }), oi_alt_1: makeEl({ value: '100' }),
    oi_mat_1: makeEl({ value: 'cfg_0' }), oi_esp_1: makeEl({ value: '3' }), oi_prod_1: makeEl({ value: 'Caixa' }),
    oi_det_1: makeEl({ value: '' }), oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(), oi_opcaoBadge_1: makeEl(),
    oir_1: { dataset: { idx: '1', planArea: '10000', planPecas: JSON.stringify(pecas) } }
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) { return sel === '#orcItemBody tr' ? [{ dataset: _els['oir_1'].dataset }] : []; }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: materiaisCatalogo, financeiro: {} }; };
  global._matGetRsm2 = function () { return 100; };
  global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = []; global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  mod.orcRecalc();
  return _els;
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 1 — legado 'nao' (caso comum, esmagadora maioria dos orçamentos):
// marcar adesivo na peça reflete no preço normalmente. Área=1m²=10000cm²,
// preço/cm²=0.0056 → adesivo = R$56,00.
// ══════════════════════════════════════════════════════════════════════
{
  montarCenario('nao', false);
  var adhSemMarcar = parseFloat(document.getElementById('ocv_adh').textContent.replace('R$', '').replace(',', '.'));
  ok('1.1 sem peça marcada: consumível Adesivo = R$0', Math.abs(adhSemMarcar) < 0.01);

  montarCenario('nao', true);
  var adhComMarcar = parseFloat(document.getElementById('ocv_adh').textContent.replace('R$', '').replace(',', '.'));
  testePerto('1.2 peça marcada (legado=nao): consumível Adesivo = R$56,00 (10000cm² × 0,0056)', adhComMarcar, 56, 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 2 — BUG reproduzido: legado 'sim' (orçamento salvo antes da
// Rodada 5, ou toggle legado ligado manualmente) + peça SEM adesivo
// marcado → cobra só a área total (comportamento antigo 100% preservado).
// ══════════════════════════════════════════════════════════════════════
{
  montarCenario('sim', false);
  var adhLegadoSoZinho = parseFloat(document.getElementById('ocv_adh').textContent.replace('R$', '').replace(',', '.'));
  testePerto('2.1 legado=sim, nenhuma peça marcada: cobra área total (R$56,00) — comportamento antigo preservado', adhLegadoSoZinho, 56, 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 3 — BUG reproduzido: legado 'sim' + peça TAMBÉM marcada — antes
// desta correção, o `? :` descartava a marcação da peça (checkbox
// aparecia marcado, preço não mudava nada); agora os dois SOMAM.
// ══════════════════════════════════════════════════════════════════════
{
  montarCenario('sim', true);
  var adhSoma = parseFloat(document.getElementById('ocv_adh').textContent.replace('R$', '').replace(',', '.'));
  testePerto('3.1 legado=sim + peça marcada: os DOIS somam (R$56 + R$56 = R$112,00) — checkbox por peça finalmente tem efeito', adhSoma, 112, 0.05);
  ok('3.2 NÃO é mais R$56 (bug antigo: peça marcada sem nenhum efeito no preço)', Math.abs(adhSoma - 56) > 10);
}

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
