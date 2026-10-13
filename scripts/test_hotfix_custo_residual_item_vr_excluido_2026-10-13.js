/**
 * test_hotfix_custo_residual_item_vr_excluido_2026-10-13.js
 *
 * RODADA CIRÚRGICA 2026-10-13, BLOCO A — "excluir item VR deixa custo
 * fantasma". Bug real reproduzido em produção: orçamento com 1 item VR
 * (com minutos de Laser já auto-calculados) + 1 item Vitre de R$219,00.
 * Ao excluir COMPLETAMENTE o item VR (Itens VR: 0, Subtotal: R$0,00), o
 * resumo continuava mostrando "Custos gerais (máquinas/montagem/
 * deslocamento) +R$1,83" e TOTAL = R$220,83 em vez de R$219,00.
 *
 * Causa raiz (achada por auditoria estática de index.html, não suposição):
 * orcAutoLaser() (index.html, dentro do motor de orçamento) só escrevia
 * um novo valor em #om_laser quando totalSeg>0 (minutos de corte
 * recalculados a partir dos itens REALMENTE presentes na tabela). Quando
 * o último item era removido, totalSeg voltava a 0, mas a função
 * RETORNAVA sem jamais zerar #om_laser — o valor antigo (minutos de um
 * item que não existe mais) ficava preso no DOM. orcRecalc() relia esse
 * valor obsoleto em maqTotal (index.html ~12055-12061), que por sua vez
 * entra em totalCostParaMarkup → finalPriceVR → finalPrice (~12290-12501)
 * — ou seja, não é só um resíduo visual: o TOTAL COBRADO do orçamento
 * ficava inflado pelo custo de máquina de um item já excluído.
 *
 * Corrigido: a chamada SILENCIOSA de orcAutoLaser (disparada
 * automaticamente por orcAddItem/orcRemItem/edição de item — nunca o
 * clique manual no botão "Auto") agora zera #om_laser e recalcula quando
 * totalSeg<=0; o clique manual continua só avisando, sem apagar um valor
 * que o vendedor possa ter ajustado à mão.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas) —
 * mesmo padrão/fixture de test_estabilizacao_bloco1_opcoes_remocao_2026-09-04.js
 * (factor=1, overhead/vrml/impostos=0, números auditáveis a olho).
 *
 * Uso: node scripts/test_hotfix_custo_residual_item_vr_excluido_2026-10-13.js
 */
'use strict';
require(require('path').join(__dirname, '_comparativo_shim.js'));
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function testePerto(desc, got, expected, tolerancia) {
  tolerancia = tolerancia == null ? 0.005 : tolerancia;
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

var FN_NAMES = ['orcFmt', 'orcSetV', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcRemItem', 'orcAutoLaser', 'orcAutoLaserSeNecessario', 'orcVitreItensPedidoTotal'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcRemItem: orcRemItem, orcAutoLaser: orcAutoLaser, orcAutoLaserSeNecessario: orcAutoLaserSeNecessario };'
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_custo_residual_item_vr_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== HOTFIX 2026-10-13 (P0) — excluir item VR não pode deixar custo de máquina residual ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// Cenário: 1 item VR (idx '1', 100x100cm, Acrílico Cristal R$100/m², sem
// desconto/acréscimo/overhead/vrml/impostos — factor=1, números auditáveis
// a olho) com 7min de Laser JÁ auto-calculados (om_laser='7' — simula o
// estado real de produção: o vendedor planificou o item e orcAutoLaser já
// escreveu 7 nesse campo). + 1 item Vitre de R$219,00.
var _els;
var removidos;
function montarCenario() {
  removidos = {};
  var materiaisCatalogo = [{ nome: 'Acrílico Cristal', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }];
  _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '7' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
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
  function addItem(idx, larg) {
    _els['oi_qty_' + idx] = makeEl({ value: '1' });
    _els['oi_larg_' + idx] = makeEl({ value: String(larg) });
    _els['oi_alt_' + idx] = makeEl({ value: '100' });
    _els['oi_mat_' + idx] = makeEl({ value: 'cfg_0', options: [{ text: 'Acrílico Cristal 3mm' }], selectedIndex: 0 });
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
  }
  addItem('1', 100);
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      var idxs = Object.keys(_els).filter(function (k) { return /^oir_/.test(k); }).map(function (k) { return k.slice(4); });
      var vivos = idxs.filter(function (idx) { return !removidos[idx]; });
      if (sel === '#orcItemBody tr') {
        return vivos.map(function (idx) { return { dataset: _els['oir_' + idx].dataset }; });
      }
      if (sel === '#orcItemBody tr[data-idx]') {
        // orcAutoLaser() recalcula tempo de corte por linha VIVA — sem
        // dimensão/planPecas na linha (caso deste cenário, área definida só
        // por oi_larg_/oi_alt_), comprExt>0 já basta para contar.
        return vivos.map(function (idx) { return { dataset: _els['oir_' + idx].dataset }; });
      }
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: materiaisCatalogo, financeiro: {} }; };
  global._matGetRsm2 = function () { return 100; };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = [{ qty: 1, precoVenda: 219.00 }];
  global.window = global;
  global._orcLaserAjusteManual = false;
  global.showToast = function () {};
  global.cfgLaserSpeed = function () { return 16; };
  mod.orcRecalc();
  return _els;
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 1 — cenário exato do bug: VR (com custo de Laser) + Vitre R$219.
// Excluir o VR → TOTAL tem que ser EXATAMENTE R$219,00, zero resíduo.
// ══════════════════════════════════════════════════════════════════════
{
  var els = montarCenario();
  testePerto('1.0 custo de máquina (Laser) do item VR entra no total inicial', window._orcCalc.maqTotal, 0.70, 0.001);
  ok('1.1 TOTAL inicial > R$219 (VR + custo de máquina + Vitre somados)', window._orcCalc.finalPrice > 219.00);

  mod.orcRemItem('1'); // exclui o único item VR

  ok('1.2 #om_laser foi zerado (não fica preso no valor do item excluído)', parseFloat(els.om_laser.value) === 0);
  testePerto('1.3 maqTotal = R$0,00 (nenhum item VR ativo)', window._orcCalc.maqTotal, 0, 0.001);
  testePerto('1.4 TOTAL = EXATAMENTE R$219,00 (Vitre intacto, zero resíduo)', window._orcCalc.finalPrice, 219.00, 0.005);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 2 (regressão A) — 2 itens VR idênticos (mesma geometria/material),
// o primeiro "carregando" os 7min de Laser antigos (stale). Excluir o
// item 1: o estado final (om_laser/maqTotal/TOTAL) tem que ser
// BYTE-IDÊNTICO ao de um orçamento criado do zero só com o item 2 —
// provando que nada do item 1 (removido) sobrevive, nem por um instante.
// ══════════════════════════════════════════════════════════════════════
function montarCenarioDoisItens(omLaserInicial) {
  removidos = {};
  var materiaisCatalogo = [{ nome: 'Acrílico Cristal', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }];
  var els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: String(omLaserInicial) }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
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
  ['1', '2'].forEach(function (idx) {
    els['oi_qty_' + idx] = makeEl({ value: '1' });
    els['oi_larg_' + idx] = makeEl({ value: '100' });
    els['oi_alt_' + idx] = makeEl({ value: '100' });
    els['oi_mat_' + idx] = makeEl({ value: 'cfg_0', options: [{ text: 'Acrílico Cristal 3mm' }], selectedIndex: 0 });
    els['oi_esp_' + idx] = makeEl({ value: '3' });
    els['oi_prod_' + idx] = makeEl({ value: 'Caixa' });
    els['oi_det_' + idx] = makeEl({ value: '' });
    els['oi_custo_' + idx] = makeEl();
    els['oi_unit_' + idx] = makeEl();
    els['oi_tot_' + idx] = makeEl();
    els['oi_opcaoBadge_' + idx] = makeEl();
    els['oir_' + idx] = { dataset: { idx: idx, planArea: '0', planPecas: '[]' }, remove: function () { removidos[idx] = true; } };
    els['oih_' + idx] = { remove: function () { } };
    els['oip_' + idx] = { remove: function () { } };
  });
  global.document = {
    getElementById: function (id) { return els[id]; },
    querySelectorAll: function (sel) {
      var vivos = ['1', '2'].filter(function (idx) { return !removidos[idx]; });
      return vivos.map(function (idx) { return { dataset: els['oir_' + idx].dataset }; });
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: materiaisCatalogo, financeiro: {} }; };
  global._matGetRsm2 = function () { return 100; };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = [];
  global.window = global;
  global._orcLaserAjusteManual = false;
  global.showToast = function () {};
  global.cfgLaserSpeed = function () { return 16; };
  // calcTempoCorte() real tem dependências de produção fora do escopo
  // deste teste (não é a função sob teste); stub determinístico — mesma
  // geometria em ambos os cenários comparados (2a/2b) produz o MESMO
  // tempo, preservando a validade da comparação byte-a-byte.
  global.calcTempoCorte = function (p) { return { ok: true, tempoFinal: (p.comprExtMm || 0) * (p.contornos || 1) }; };
  mod.orcRecalc();
  return els;
}

{
  // 2a) Cenário "real": item 1 com om_laser='7' (stale) + item 2 — exclui item 1.
  var elsA = montarCenarioDoisItens(7);
  mod.orcRemItem('1');
  var omLaserDepois = elsA.om_laser.value;
  var maqTotalDepois = window._orcCalc.maqTotal;
  var finalPriceDepois = window._orcCalc.finalPrice;

  // 2b) Cenário "limpo": só o item 2 existiu, om_laser nasce em '0' (nunca
  // teve item 1). Mesma geometria/material do item 2 acima.
  var elsB = montarCenarioDoisItens(0);
  mod.orcRemItem('1'); // mesmo setup (2 itens) — remove o 1 para igualar exatamente o estado de elsA, sem nunca ter passado por om_laser='7'

  ok('2.1 #om_laser após excluir item 1 NÃO é mais o valor antigo "7"', omLaserDepois !== '7');
  testePerto('2.2 #om_laser converge para o MESMO valor de um cenário que nunca teve o item 1 com Laser antigo', parseFloat(omLaserDepois), parseFloat(elsB.om_laser.value), 0.001);
  testePerto('2.3 maqTotal idêntico ao cenário sem contaminação do item removido', maqTotalDepois, window._orcCalc.maqTotal, 0.001);
  testePerto('2.4 TOTAL idêntico ao cenário sem contaminação do item removido (zero resíduo)', finalPriceDepois, window._orcCalc.finalPrice, 0.005);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE 3 (regressão D) — excluir o único VR e adicionar um novo: o novo
// item NÃO pode herdar o custo de máquina do item excluído.
// ══════════════════════════════════════════════════════════════════════
{
  var els3 = montarCenario(); // item '1' com om_laser='7' (custo de máquina)
  mod.orcRemItem('1'); // exclui — om_laser deve zerar (teste 1 já confirma)
  ok('3.1 pré-condição: om_laser=0 após excluir o único item', parseFloat(els3.om_laser.value) === 0);

  // "adiciona novo item" — simula orcAddItem(): nova linha SEM dimensão
  // ainda (vendedor ainda não preencheu Larg×Alt), dispara
  // orcAutoLaserSeNecessario() como o fluxo real faz ao criar a linha.
  removidos['2'] = undefined; delete removidos['2'];
  els3['oi_qty_2'] = makeEl({ value: '1' });
  els3['oi_larg_2'] = makeEl({ value: '' }); // sem dimensão ainda
  els3['oi_alt_2'] = makeEl({ value: '' });
  els3['oi_mat_2'] = makeEl({ value: 'cfg_0', options: [{ text: 'Acrílico Cristal 3mm' }], selectedIndex: 0 });
  els3['oi_esp_2'] = makeEl({ value: '3' });
  els3['oir_2'] = { dataset: { idx: '2', planArea: '0', planPecas: '[]' }, remove: function () { removidos['2'] = true; } };
  mod.orcAutoLaserSeNecessario();

  ok('3.2 novo item (sem dimensão ainda) NÃO herda os 7min do item excluído', parseFloat(els3.om_laser.value) === 0);
}

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); fs.unlinkSync(modPath); process.exit(1); }
console.log('\n✅ PASSOU\n');
fs.unlinkSync(modPath);
