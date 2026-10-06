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
require(require('path').join(__dirname, '_comparativo_shim.js'));
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
  '_orcItemEntraNaOperacao', 'orcComparativoPendente', 'orcTextoValorCliente', 'orcOrdemBlocosPagamento', 'orcMontarBlocosPagamento', 'orcComparativoPendenteDOM', 'orcBloqueioComparativoPendente', 'orcItensDistribuidosDeOrc', 'orcMontarPayloadVitreParaOS', '_planReconcilePieces', '_planSeedFromPersisted', '_planPieceSlug', '_planBuildAllPecas', 'osProjecaoOperacionalItem'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, ' +
  '_planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, ' +
  '_planBuildAllPecas: _planBuildAllPecas, osProjecaoOperacionalItem: osProjecaoOperacionalItem, _orcItemEntraNaOperacao: _orcItemEntraNaOperacao, orcComparativoPendente: orcComparativoPendente, orcTextoValorCliente: orcTextoValorCliente, orcMontarBlocosPagamento: orcMontarBlocosPagamento, orcBloqueioComparativoPendente: orcBloqueioComparativoPendente, orcItensDistribuidosDeOrc: orcItensDistribuidosDeOrc, orcMontarPayloadVitreParaOS: orcMontarPayloadVitreParaOS };'
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
var fs2 = fs;
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

// ══════════════════════════════════════════════════════════════════════
// BLOCO C/D/E — estado "aguardando escolha" (WhatsApp/PDF/Preview/financeiro/OS/Vitre)
// ══════════════════════════════════════════════════════════════════════
global.cfgLoad = function () { return {}; };
var _toasts = [];
global.showToast = function (m) { _toasts.push(m); };
var orcComparativoPendente = mod.orcComparativoPendente, orcTextoValorCliente = mod.orcTextoValorCliente, orcMontarBlocosPagamento = mod.orcMontarBlocosPagamento, orcBloqueioComparativoPendente = mod.orcBloqueioComparativoPendente, orcItensDistribuidosDeOrc = mod.orcItensDistribuidosDeOrc, orcMontarPayloadVitreParaOS = mod.orcMontarPayloadVitreParaOS;
function test(desc, got, expected) { var g = JSON.stringify(got), e = JSON.stringify(expected); ok(desc, g === e); if (g !== e) console.log('       esperado : ' + e + '\n       obtido   : ' + g); }
var GRP = 'g1';
var opA = function (conf) { return { grupoId: GRP, selecionada: true, escolhaConfirmada: conf }; };
var opB = function (conf) { return { grupoId: GRP, selecionada: false, escolhaConfirmada: conf }; };
var CONT = { pxPct: 5.14, pixTotal: 208.69, parcela: { nParc: 3, valorParcela: 73.33, totalCents: 22000 } };
var FMT = function (v) { return 'R$ ' + v.toFixed(2).replace('.', ','); };

// 1–4 — estado do comparativo
ok('C1. A selecionada internamente, SEM escolha confirmada → pendente', orcComparativoPendente([{ grupoOpcao: opA(false) }, { grupoOpcao: opB(false) }]) === true);
ok('C2. B selecionada internamente, SEM escolha confirmada → pendente', orcComparativoPendente([{ grupoOpcao: opB(false) }, { grupoOpcao: { grupoId: GRP, selecionada: true, escolhaConfirmada: false } }]) === true);
ok('C3. escolha confirmada da A → não pendente', orcComparativoPendente([{ grupoOpcao: opA(true) }, { grupoOpcao: opB(false) }]) === false);
ok('C4. escolha confirmada da B → não pendente', orcComparativoPendente([{ grupoOpcao: opA(false) }, { grupoOpcao: opB(true) }]) === false);
// 11 — registro antigo sem escolhaConfirmada: nunca pendente (fallback, sem migração)
ok('C11. registro legado sem escolhaConfirmada NÃO fica pendente', orcComparativoPendente([{ grupoOpcao: { grupoId: GRP, selecionada: true } }]) === false);
ok('C11b. item cumulativo (sem grupo) NÃO fica pendente', orcComparativoPendente([{}]) === false);

// 5 — WhatsApp/PDF/Preview: bloco de pagamento antes da escolha é genérico
var blocosPend = orcMontarBlocosPagamento(CONT, false, 0, '', FMT, true);
var txtPend = blocosPend.map(function (b) { return b.texto; }).join(' | ');
ok('C5a. WhatsApp/PDF antes da escolha: Parcelamento genérico (sem valor da parcela)', /em até 3x sem juros/.test(txtPend) && !/R\$/.test(txtPend));
ok('C5b. antes da escolha: Pix só informa percentual (sem valor do Pix)', /5,14% de desconto no pagamento à vista via PIX/.test(txtPend) && !/208/.test(txtPend));
ok('C5c. antes da escolha: nenhum R$ em nenhum bloco de pagamento', !/R\$|\d+,\d\d(?!%)/.test(txtPend.replace(/5,14%/g, '')));
// 6 — PDF/Preview: valor total antes da escolha é texto genérico
var valorPend = orcTextoValorCliente(true, 'R$ 220,00');
ok('C6a. Valor total antes da escolha não mostra número de opção', valorPend.indexOf('R$') < 0 && /aguardando sua escolha/.test(valorPend));
ok('C6b. Valor total depois da escolha usa o valor real', orcTextoValorCliente(false, 'R$ 220,00') === 'R$ 220,00');
// 7 — depois da escolha: parcela/Pix específicos continuam aparecendo (sem regressão)
var blocosOk = orcMontarBlocosPagamento(CONT, false, 0, '', FMT, false);
var txtOk = blocosOk.map(function (b) { return b.texto; }).join(' | ');
ok('C7a. depois da escolha: parcela específica (R$ 73,33) volta a aparecer', /3x de R\$ 73,33 sem juros/.test(txtOk));
ok('C7b. depois da escolha: Pix específico (R$ 208,69) volta a aparecer', /valor com PIX: R\$ 208,69/.test(txtOk));

// PDF — itens não são redistribuídos pela soma da opção interna (vazamento A→B)
var ORC_PEND = { valorFinal: 999, itens: [
  { qty: 1, total: 'R$ 100,00', mat: 'Cristal', espMm: 2, grupoOpcao: opA(false) },
  { qty: 1, total: 'R$ 150,00', mat: 'Cristal', espMm: 3, grupoOpcao: opB(false) }] };
var itensPend = orcItensDistribuidosDeOrc(ORC_PEND, 999);
var totB = itensPend.filter(function (x) { return x.grupoOpcaoId; })[1].total;
testePerto('C8a. PDF pendente: opção B mostra o PRÓPRIO total (150), não o escalado pela A', totB, 150, 0.01);
var ORC_OK = JSON.parse(JSON.stringify(ORC_PEND)); ORC_OK.itens[0].grupoOpcao = opA(true); ORC_OK.itens[1].grupoOpcao = opB(false);
var itensOk = orcItensDistribuidosDeOrc(ORC_OK, 999);
ok('C8b. depois da escolha (A confirmada): total escalado continua coerente com o total geral (A = 999)', Math.abs(itensOk.filter(function (x) { return x.grupoOpcaoId; })[0].total - 999) < 0.01);

// 10 — financeiro/OS antes e depois da escolha (gate)
_toasts = [];
ok('C10a. financeiro/OS ANTES da escolha: gate bloqueia', orcBloqueioComparativoPendente(ORC_PEND) === true && _toasts.length === 1);
ok('C10b. financeiro/OS DEPOIS da escolha: gate libera', orcBloqueioComparativoPendente(ORC_OK) === false);
ok('C10c. legado sem campo: gate libera', orcBloqueioComparativoPendente({ itens: [{ grupoOpcao: { grupoId: GRP, selecionada: true } }] }) === false);

// 9 — OS: só a opção confirmada entra na OS/financeiro (filtro único)
var osAntes = ORC_PEND.itens.filter(_orcItemEntraNaOperacao);
var osDepois = ORC_OK.itens.filter(_orcItemEntraNaOperacao);
ok('C9a. OS ANTES da escolha: nenhuma opção interna entra', osAntes.length === 0);
test('C9b. OS DEPOIS da escolha (A): só A entra', osDepois.map(function (x) { return x.mat + x.espMm; }), ['Cristal2']);

// 10 (Vitre) — antes e depois
var VIT = [{ tipoItem: 'vitre_catalogo', sku: 'V-1', qty: 2, grupoOpcao: opB(false) }];
var vitAntes = orcMontarPayloadVitreParaOS(VIT.filter(_orcItemEntraNaOperacao));
var vitDepois = orcMontarPayloadVitreParaOS([{ tipoItem: 'vitre_catalogo', sku: 'V-1', qty: 2, grupoOpcao: opB(true) }].filter(_orcItemEntraNaOperacao));
test('C12a. Vitre ANTES da escolha: payload vazio', vitAntes, []);
test('C12b. Vitre DEPOIS da escolha da B: payload só com a B', vitDepois, [{ sku: 'V-1', qtd: 2 }]);

// 13/14 — duplicação e exclusão: já cobertos por T1–T3 (consumíveis); reafirma na presença de escolha
// C13 — duplicação com consumíveis: a cópia carrega adesivo + gravação×2
// (diferença real vs. a mesma linha sem consumíveis = 1200cm²×0,0056 + 2×20)
var rBSem = rodarCenario({ itens: [{ idx: '2', qty: 1, matKey: 'cfg_1', espItem: 3, prod: 'Placa 3mm', pecas: caixaPecas({}) }], materiaisCatalogo: MATS });
testePerto('C13. duplicação: consumíveis da cópia somam adesivo + gravação×2 (≈ R$46,72)', parseBRL(rB.oi_tot_2.textContent) - parseBRL(rBSem.oi_tot_2.textContent), 1200 * ADH + 40, 0.05);
// C14 — exclusão: remover B não altera A (preço e adesivo)
testePerto('C14a. exclusão: preço de A permanece igual ao standalone', parseBRL(rSemB.oi_tot_1.textContent), parseBRL(rA.oi_tot_1.textContent), 0.02);
testePerto('C14b. exclusão: adesivo de A permanece (1200cm²)', parseBRL(rSemB.ocv_adh.textContent), 1200 * ADH, 0.01);

// Fiação: WhatsApp / PDF / Preview / financeiro / OS / Vitre leem o MESMO estado
var htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function corpo(nome) { var i = htmlSrc.indexOf('function ' + nome + '('); var b = htmlSrc.indexOf('{', i); var d = 0, j = b; for (; j < htmlSrc.length; j++) { if (htmlSrc[j] === '{') d++; else if (htmlSrc[j] === '}') { d--; if (d === 0) break; } } return htmlSrc.slice(i, j + 1); }
ok('C15a. WhatsApp usa o estado pendente no valor e nos blocos', /_pendWA/.test(corpo('orcEnviarOrcamentoWA')) && /orcTextoValorCliente\(_pendWA/.test(corpo('orcEnviarOrcamentoWA')));
ok('C15b. PDF usa o estado pendente no total e nos blocos', /_pendPDF/.test(corpo('orcMontarHtmlOrcamento')) && /orcTextoValorCliente\(true/.test(corpo('orcMontarHtmlOrcamento')));
ok('C15c. Preview (desconto) bloqueia valores antes da escolha', /orcComparativoPendenteDOM\(\)/.test(corpo('orcDescCondPreview')));
ok('C15d. financeiro (registro de situação) passa pelo gate', /orcBloqueioComparativoPendente/.test(corpo('orcRegistrarSituacaoFinanceira')));
ok('C15e. confirmação de pagamento passa pelo gate', /orcBloqueioComparativoPendente/.test(corpo('orcEnvConfirmarPgto')));
ok('C15f. geração de OS passa pelo gate', /orcBloqueioComparativoPendente/.test(corpo('orcEnvGerarOS')));
ok('C15g. OS/Vitre filtram só a escolha confirmada', /_orcItemEntraNaOperacao/.test(corpo('orcEnvGerarOS')) && /_orcItemEntraNaOperacao/.test(corpo('_orcSincronizarOSVinculada')));

console.log('\n RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed ? 1 : 0);
