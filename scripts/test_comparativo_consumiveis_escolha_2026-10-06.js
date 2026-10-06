/**
 * test_comparativo_consumiveis_escolha_2026-10-06.js
 *
 * Regressões do comparativo de orçamento (correção cirúrgica 2026-10-06):
 *  - BLOCO A: consumíveis por peça (adesivo/gravação) de uma opção NÃO
 *    escolhida precisam continuar precificando a PRÓPRIA linha (preço
 *    informativo), mesmo sem entrar no total real do pedido.
 *  - BLOCO B: a escolha do cliente (`escolhaConfirmada`) é separada da
 *    seleção interna de cálculo (`selecionada`). OS/financeiro/Vitre só
 *    usam a escolha confirmada.
 *
 * Uso: node scripts/test_comparativo_consumiveis_escolha_2026-10-06.js
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

var FN_NAMES = [
  'orcProdutoNomeResolvido','cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', '_planPecaAdesivos', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos',
  '_orcItemEntraNaOperacao', '_planReconcilePieces', '_planSeedFromPersisted', '_planPieceSlug', '_planBuildAllPecas', 'osProjecaoOperacionalItem'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, ' +
  '_planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, ' +
  '_planBuildAllPecas: _planBuildAllPecas, osProjecaoOperacionalItem: osProjecaoOperacionalItem, _orcItemEntraNaOperacao: _orcItemEntraNaOperacao };'
].join('\n\n');
var modPath = path.join(__dirname, '_comparativo_escolha_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Consumíveis por peça (Adesivo/Adh.Branco/Gravação/Spray/Extra) ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

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
    if (o) { if (o.adesivo!==undefined) p.adesivo=o.adesivo; if (o.gravacao!==undefined) p.gravacao=o.gravacao; if (o.spray!==undefined) p.spray=o.spray; if (o.extra!==undefined) p.extra=o.extra; }
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
  var _cfgFinObj = Object.assign({ overhead: opts.overhead || 0, vrml: opts.vrml || 0, impostos: opts.impostos || 0 }, opts.cfgFinExtra || {});
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: opts.ocAdh || 'nao' }), oc_adhb: makeEl({ value: opts.ocAdhb || 'nao' }),
    oc_imp: makeEl({ value: String(opts.ocImp||0) }), oc_spray: makeEl({ value: String(opts.ocSpray||0) }), oc_extra: makeEl({ value: String(opts.ocExtra||0) }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: !!opts.soCorte }), orcSoCorteMin: makeEl({ value: String(opts.soCorteMin||30) }),
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
    _els['oi_prod_' + it.idx] = makeEl({ value: it.prod || ('Item ' + it.idx) });
    _els['oi_det_' + it.idx] = makeEl({ value: '' });
    _els['oi_custo_' + it.idx] = makeEl();
    _els['oi_unit_' + it.idx] = makeEl();
    _els['oi_tot_' + it.idx] = makeEl();
    _els['oi_opcaoBadge_' + it.idx] = makeEl();
    _els['oir_' + it.idx] = { dataset: { idx: it.idx, planArea: String(planArea), planPecas: JSON.stringify(it.pecas || []) } };
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

var ADH = 0.0056;
var _orcItemEntraNaOperacao = mod._orcItemEntraNaOperacao;
var MATS = [
  { nome: 'Acrílico Cristal 2mm', custo: 100, comp: 200, larg: 100, rsm2: 100, esp: 2 },
  { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150, esp: 3 }
];
// Item com adesivo na Tampa + gravação R$20 (consumíveis por peça).
function itemComConsumiveis(idx, matKey, espItem) {
  return { idx: idx, qty: 1, matKey: matKey, espItem: espItem, prod: 'Placa ' + espItem + 'mm',
    pecas: caixaPecas({ Tampa: { adesivo: 'normal', gravacao: 20 } }) };
}
var OP_GRUPO = function (sel, conf) { return { grupoId: 'g1', selecionada: sel, escolhaConfirmada: conf }; };

// ══════════════════════════════════════════════════════════════════════
// BLOCO A — consumíveis preservados nas opções comparativas
// ══════════════════════════════════════════════════════════════════════
// Cenário base: A = 2mm + adesivo + gravação (selecionada internamente),
// B = 3mm + adesivo + gravação (duplicada, NÃO escolhida).
var rCmp = rodarCenario({
  itens: [itemComConsumiveis('1', 'cfg_0', 2), itemComConsumiveis('2', 'cfg_1', 3)],
  opcoes: { '1': OP_GRUPO(true, false), '2': OP_GRUPO(false, false) },
  materiaisCatalogo: MATS
});
var rA = rodarCenario({ itens: [itemComConsumiveis('1', 'cfg_0', 2)], materiaisCatalogo: MATS });
var rB = rodarCenario({ itens: [itemComConsumiveis('2', 'cfg_1', 3)], materiaisCatalogo: MATS });

// T1 — a opção A (selecionada) mantém o consumível no próprio preço.
testePerto('T1a. A (selecionada) preço = standalone (adesivo+gravação preservados)', parseBRL(rCmp.oi_tot_1.textContent), parseBRL(rA.oi_tot_1.textContent), 0.02);
// T2 — a opção B (NÃO escolhida) mantém adesivo+gravação no próprio preço
// (antes: o `return` cedo de !_contaItem zerava o consumível dela).
testePerto('T1b. B (não escolhida) preço = standalone (adesivo+gravação preservados)', parseBRL(rCmp.oi_tot_2.textContent), parseBRL(rB.oi_tot_2.textContent), 0.02);
// Só a opção escolhida entra no total real do pedido (consumível global).
testePerto('T1c. Total real de adesivo = só A (1200cm² × 0,0056)', parseBRL(rCmp.ocv_adh.textContent), 1200*ADH, 0.01);
testePerto('T1d. Total real de gravação = só A (R$20)', parseBRL(rCmp.ocv_imp.textContent), 20, 0.01);

// ══════════════════════════════════════════════════════════════════════
// TESTE 2 — independência: editar B (trocar só a espessura) não altera A
// ══════════════════════════════════════════════════════════════════════
var rCmpEditB = rodarCenario({
  itens: [itemComConsumiveis('1', 'cfg_0', 2), itemComConsumiveis('2', 'cfg_0', 2)],
  opcoes: { '1': OP_GRUPO(true, false), '2': OP_GRUPO(false, false) },
  materiaisCatalogo: MATS
});
testePerto('T2. editar B não altera o preço de A', parseBRL(rCmpEditB.oi_tot_1.textContent), parseBRL(rCmp.oi_tot_1.textContent), 0.02);

// ══════════════════════════════════════════════════════════════════════
// TESTE 3 — exclusão: remover B não altera A (A vira cumulativa/única)
// ══════════════════════════════════════════════════════════════════════
var rSemB = rodarCenario({ itens: [itemComConsumiveis('1', 'cfg_0', 2)], opcoes: { '1': OP_GRUPO(true, false) }, materiaisCatalogo: MATS });
testePerto('T3. remover B não altera o preço/consumíveis de A', parseBRL(rSemB.oi_tot_1.textContent), parseBRL(rA.oi_tot_1.textContent), 0.02);
testePerto('T3b. remover B: adesivo total continua só de A', parseBRL(rSemB.ocv_adh.textContent), 1200*ADH, 0.01);

// ══════════════════════════════════════════════════════════════════════
// BLOCO B — escolha do cliente ≠ seleção interna
// ══════════════════════════════════════════════════════════════════════
// T4 — antes da escolha: `selecionada` NUNCA vale como escolha do cliente.
ok('T4a. Opção só selecionada internamente NÃO conta como escolha do cliente — OS/financeiro excluem',
  _orcItemEntraNaOperacao({ grupoOpcao: OP_GRUPO(true, false) }) === false);
ok('T4b. Alternativa não selecionada nunca entra em OS/financeiro',
  _orcItemEntraNaOperacao({ grupoOpcao: OP_GRUPO(false, false) }) === false);
// T5 — depois da escolha explícita: só a escolhida entra.
ok('T5a. Opção com escolha confirmada entra em OS/financeiro',
  _orcItemEntraNaOperacao({ grupoOpcao: OP_GRUPO(true, true) }) === true);
ok('T5b. Item cumulativo (sem grupo) sempre entra',
  _orcItemEntraNaOperacao({}) === true);
// Bloco F — registro legado (sem escolhaConfirmada) mantém o comportamento salvo.
ok('T6. Registro legado sem escolhaConfirmada preserva o selecionada salvo (sem migração)',
  _orcItemEntraNaOperacao({ grupoOpcao: { grupoId: 'g', selecionada: true } }) === true);

console.log('\n RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed ? 1 : 0);
