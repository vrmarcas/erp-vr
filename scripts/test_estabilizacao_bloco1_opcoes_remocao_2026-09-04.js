/**
 * test_estabilizacao_bloco1_opcoes_remocao_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 1 — "excluir opção
 * comparativa altera o preço das opções restantes".
 *
 * Causa raiz confirmada (investigação desta rodada): orcRemItem() não
 * promovia um sucessor `selecionada` quando o item removido era a opção
 * ESCOLHIDA do grupo — o grupo inteiro ficava sem nenhuma opção com
 * `selecionada:true`, e em orcRecalc() nenhuma sobrevivente passava a
 * `_contaItem`, zerando matTotal/areaTotal/qtyTotal e derrubando todas
 * as opções no ramo informativo/degradado.
 *
 * Corrigido em orcRemItem(): promove deterministicamente o menor índice
 * remanescente do grupo antes de excluir; dissolve o grupo se sobrar só
 * uma opção.
 *
 * Uso: node scripts/test_estabilizacao_bloco1_opcoes_remocao_2026-09-04.js
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

var FN_NAMES = ['orcFmt', 'orcSetV', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcRemItem'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcRemItem: orcRemItem };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_bloco1_opcoes_remocao_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 1 — remoção de opção comparativa ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// Cenário: 3mm(idx1,selecionada) / 4mm(idx2) / 6mm(idx3) / 8mm(idx4),
// todas no mesmo grupo 'G1'. factor=1 (overhead/vrml/impostos=0) para que
// finalPriceVR == matTotal contado — números auditáveis a olho, mesmo
// padrão do teste RODADA 5 (test_hotfix_orcamento_comparativo_2026-08-18.js).
function montarCenario() {
  var materiaisCatalogo = [{ nome: 'Acrílico Cristal', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }];
  var idxs = ['1', '2', '3', '4'];
  var areasM2 = { '1': 1.20, '2': 1.50, '3': 1.90, '4': 2.30 }; // 3/4/6/8mm — preços distintos e auditáveis
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  var removidos = {};
  idxs.forEach(function (idx) {
    var larg = Math.round(areasM2[idx] * 100); // alt=100cm fixo -> área(cm²) = larg*100
    _els['oi_qty_' + idx] = makeEl({ value: '1' });
    _els['oi_larg_' + idx] = makeEl({ value: String(larg) });
    _els['oi_alt_' + idx] = makeEl({ value: '100' });
    _els['oi_mat_' + idx] = makeEl({ value: 'cfg_0' });
    _els['oi_esp_' + idx] = makeEl({ value: '3' });
    _els['oi_prod_' + idx] = makeEl({ value: 'Caixa' });
    _els['oi_det_' + idx] = makeEl({ value: '' });
    _els['oi_custo_' + idx] = makeEl();
    _els['oi_unit_' + idx] = makeEl();
    _els['oi_tot_' + idx] = makeEl();
    _els['oi_opcaoBadge_' + idx] = makeEl();
    _els['oir_' + idx] = { dataset: { idx: idx, planArea: '0', planPecas: '[]' }, remove: function () { removidos[idx] = true; } };
    _els['oih_' + idx] = { remove: function () { } };
    _els['oip_' + idx] = { remove: function () { } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') {
        return idxs.filter(function (idx) { return !removidos[idx]; })
          .map(function (idx) { return { dataset: _els['oir_' + idx].dataset }; });
      }
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: materiaisCatalogo, financeiro: {} }; };
  global._matGetRsm2 = function () { return 100; };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global.ORC_ITEM_OPCOES = {
    '1': { grupoId: 'G1', selecionada: true },  // 3mm — ESCOLHIDA
    '2': { grupoId: 'G1', selecionada: false }, // 4mm
    '3': { grupoId: 'G1', selecionada: false }, // 6mm
    '4': { grupoId: 'G1', selecionada: false }  // 8mm
  };
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  mod.orcRecalc();
  return _els;
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 1 — excluir opções NÃO selecionadas (8mm, depois 6mm, depois
// 4mm) uma por uma: o preço da opção 3mm (escolhida) fica byte-idêntico
// em cada passo.
// ══════════════════════════════════════════════════════════════════════
{
  var els = montarCenario();
  var totalAntes = els['oi_tot_1'].textContent;
  var finalPriceAntes = window._orcCalc.finalPrice;
  ok('1.0 preço inicial da 3mm (escolhida) > 0', parseBRL(totalAntes) > 0);

  mod.orcRemItem('4'); // exclui 8mm (não escolhida)
  ok('1.1 após excluir 8mm: total exibido da 3mm é byte-idêntico', els['oi_tot_1'].textContent === totalAntes);
  testePerto('1.2 após excluir 8mm: finalPrice do pedido inalterado', window._orcCalc.finalPrice, finalPriceAntes, 0.001);

  mod.orcRemItem('3'); // exclui 6mm (não escolhida)
  ok('1.3 após excluir 6mm: total exibido da 3mm é byte-idêntico', els['oi_tot_1'].textContent === totalAntes);

  mod.orcRemItem('2'); // exclui 4mm (não escolhida) — só resta a 3mm; grupo deve dissolver
  ok('1.4 após excluir 4mm (só resta a escolhida): total exibido da 3mm é byte-idêntico', els['oi_tot_1'].textContent === totalAntes);
  ok('1.5 grupo dissolvido — item 3mm não tem mais entrada em ORC_ITEM_OPCOES', !global.ORC_ITEM_OPCOES['1']);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 2 — excluir a opção ESCOLHIDA (3mm) enquanto outras existem: um
// sucessor determinístico (menor índice remanescente) deve virar a
// selecionada, e o total do pedido deve refletir o preço PRÓPRIO desse
// sucessor (nunca R$0 / nunca o ramo degradado).
// ══════════════════════════════════════════════════════════════════════
{
  var els2 = montarCenario();
  var totalInformativo4mmAntes = parseBRL(els2['oi_tot_2'].textContent); // preço informativo da 4mm ANTES da promoção

  mod.orcRemItem('1'); // exclui a 3mm (era a escolhida)

  ok('2.1 sucessor (4mm, idx2) promovido a selecionada=true', global.ORC_ITEM_OPCOES['2'] && global.ORC_ITEM_OPCOES['2'].selecionada === true);
  ok('2.2 6mm (idx3) e 8mm (idx4) continuam NÃO selecionadas', global.ORC_ITEM_OPCOES['3'].selecionada === false && global.ORC_ITEM_OPCOES['4'].selecionada === false);
  ok('2.3 finalPrice do pedido NÃO é zero (nunca cai no ramo degradado)', window._orcCalc.finalPrice > 0);
  testePerto('2.4 finalPrice do pedido == preço próprio do sucessor promovido (4mm)', window._orcCalc.finalPrice, totalInformativo4mmAntes, 0.05);
}

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
