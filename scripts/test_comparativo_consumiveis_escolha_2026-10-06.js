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
  '_orcItemEntraNaOperacao', 'orcRegistroComparativoPendente', '_orcEntraNaOperacaoDoRegistro', 'orcEnvNormalizar', 'orcPecasHerdarEspessura', 'orcSincronizarEspPecasHerdadas', 'orcPctBR', 'orcMontarBlocosPagamento', 'orcComparativoPendente', 'orcTextoValorCliente', 'orcOrdemBlocosPagamento', 'orcMontarBlocosPagamento', 'orcComparativoPendenteDOM', 'orcBloqueioComparativoPendente', 'orcItensDistribuidosDeOrc', 'orcMontarPayloadVitreParaOS', '_planReconcilePieces', '_planSeedFromPersisted', '_planPieceSlug', '_planBuildAllPecas', 'osProjecaoOperacionalItem'];
var src = [
  'var ORC_REGRA_COMPARATIVO_ATUAL = 2;',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, ' +
  '_planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, ' +
  '_planBuildAllPecas: _planBuildAllPecas, osProjecaoOperacionalItem: osProjecaoOperacionalItem, _orcItemEntraNaOperacao: _orcItemEntraNaOperacao, orcComparativoPendente: orcComparativoPendente, orcTextoValorCliente: orcTextoValorCliente, orcMontarBlocosPagamento: orcMontarBlocosPagamento, orcBloqueioComparativoPendente: orcBloqueioComparativoPendente, orcItensDistribuidosDeOrc: orcItensDistribuidosDeOrc, orcMontarPayloadVitreParaOS: orcMontarPayloadVitreParaOS, orcRegistroComparativoPendente: orcRegistroComparativoPendente, _orcEntraNaOperacaoDoRegistro: _orcEntraNaOperacaoDoRegistro, orcEnvNormalizar: orcEnvNormalizar, orcPecasHerdarEspessura: orcPecasHerdarEspessura, orcSincronizarEspPecasHerdadas: orcSincronizarEspPecasHerdadas, orcPctBR: orcPctBR };'
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
var ORC_PEND = { regraComparativo: 2, valorFinal: 999, itens: [
  { qty: 1, total: 'R$ 100,00', mat: 'Cristal', espMm: 2, grupoOpcao: opA(false) },
  { qty: 1, total: 'R$ 150,00', mat: 'Cristal', espMm: 3, grupoOpcao: opB(false) }] };
var itensPend = orcItensDistribuidosDeOrc(ORC_PEND, 999);
var totB = itensPend.filter(function (x) { return x.grupoOpcaoId; })[1].total;
testePerto('C8a. PDF pendente: opção B mostra o PRÓPRIO total (150), não o escalado pela A', totB, 150, 0.01);
var ORC_OK = JSON.parse(JSON.stringify(ORC_PEND)); ORC_OK.regraComparativo = 2; ORC_OK.itens[0].grupoOpcao = opA(true); ORC_OK.itens[1].grupoOpcao = opB(false);
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
ok('C15g. OS/Vitre filtram pelo registro (regra nova: só escolha confirmada)', /_orcEntraNaOperacaoDoRegistro/.test(corpo('orcEnvGerarOS')) && /_orcEntraNaOperacaoDoRegistro/.test(corpo('_orcSincronizarOSVinculada')));

// ══════════════════════════════════════════════════════════════════════
// VALOR FINAL PERSISTIDO + COMPATIBILIDADE HISTÓRICA + STEP 3 (2026-10-06)
// ══════════════════════════════════════════════════════════════════════
var orcRegistroComparativoPendente = mod.orcRegistroComparativoPendente;
var _orcEntraNaOperacaoDoRegistro = mod._orcEntraNaOperacaoDoRegistro;
var orcEnvNormalizar = mod.orcEnvNormalizar;
var orcPctBR = mod.orcPctBR;
function _regGrupo(regra, confA, confB, valorFinal, extras) {
  var itens = [
    { mat: 'Acrílico Cristal 2mm', espMm: 2, total: 'R$ 100,00', grupoOpcao: { grupoId: 'g1', selecionada: true, escolhaConfirmada: confA } },
    { mat: 'Acrílico Cristal 3mm', espMm: 3, total: 'R$ 150,00', grupoOpcao: { grupoId: 'g1', selecionada: false, escolhaConfirmada: confB } }
  ];
  var r = { id: 'ORC-T', num: 'T', cliente: 'Teste', itens: itens, valorBase: valorFinal, valorFinal: valorFinal, status: 'aguardando' };
  if (regra !== undefined) r.regraComparativo = regra;
  return Object.assign(r, extras || {});
}
// Registro NOVO pendente: valores definitivos NULL (como o save novo grava).
var PEND = _regGrupo(2, false, false, null, { valorPendenteComparativo: true });
var CONF_A = _regGrupo(2, true, false, 100);     // persistido com a opção A (100)
var CONF_B = _regGrupo(2, false, true, 150);     // persistido com a opção B (150)
var LEG = _regGrupo(undefined, false, false, 2607.17); // histórico: sem regraComparativo

// A — comparativo pendente
ok('A1. registro novo pendente → orcRegistroComparativoPendente = true', orcRegistroComparativoPendente(PEND) === true);
ok('A2. valorFinal persistido NÃO é definitivo (null) para pendente', PEND.valorFinal === null && PEND.valorBase === null);
var nPend = orcEnvNormalizar(PEND);
ok('A3. normalizado: valorPendente=true e agregados recebem 0 (nunca a opção interna)', nPend.valorPendente === true && nPend.valorFinal === 0);
var somaVendas = [PEND, CONF_A].reduce(function (s, o) { return s + (orcEnvNormalizar(o).valorFinal || 0); }, 0);
test('A4. dashboard/relatório: soma só o confirmado (100), nunca a opção interna do pendente', somaVendas, 100);
ok('A5. financeiro bloqueado com comparativo pendente', orcBloqueioComparativoPendente(PEND) === true);
ok('A6. OS: nenhum item de opção interna entra', _orcEntraNaOperacaoDoRegistro(PEND).length === 0);
var vitPend = [_regGrupo(2, false, false, null)];
vitPend[0].itens = [{ tipoItem: 'vitre_catalogo', sku: 'V-1', qty: 2, grupoOpcao: { grupoId: 'g1', selecionada: true, escolhaConfirmada: false } }];
test('A7. Vitre: payload vazio com comparativo pendente', mod.orcMontarPayloadVitreParaOS(_orcEntraNaOperacaoDoRegistro(vitPend[0])), []);

// B — comparativo escolhido
ok('B1. registro escolhido (A) → não pendente', orcRegistroComparativoPendente(CONF_A) === false);
var nA = orcEnvNormalizar(CONF_A);
test('B2. valorFinal = valor da opção confirmada (A = 100), não pendente', [nA.valorFinal, nA.valorPendente], [100, false]);
test('B3. dashboard/relatório usam o valor confirmado (B = 150)', orcEnvNormalizar(CONF_B).valorFinal, 150);
test('B4. OS usa só a opção confirmada (B)', _orcEntraNaOperacaoDoRegistro(CONF_B).map(function (i) { return i.mat; }), ['Acrílico Cristal 3mm']);
ok('B5. financeiro liberado para registro escolhido', orcBloqueioComparativoPendente(CONF_B) === false);
var vitB = _regGrupo(2, false, true, 150);
vitB.itens = [{ tipoItem: 'vitre_catalogo', sku: 'V-1', qty: 2, grupoOpcao: { grupoId: 'g1', selecionada: false, escolhaConfirmada: true } }];
test('B6. Vitre usa a mesma opção confirmada', mod.orcMontarPayloadVitreParaOS(_orcEntraNaOperacaoDoRegistro(vitB)), [{ sku: 'V-1', qtd: 2 }]);

// C — histórico (sem regraComparativo): comportamento anterior preservado
ok('C1. histórico sem regra NUNCA vira pendente (nenhuma reescrita retroativa)', orcRegistroComparativoPendente(LEG) === false);
var nLeg = orcEnvNormalizar(LEG);
test('C2. histórico: valorFinal persistido é preservado (2607,17)', [nLeg.valorFinal, nLeg.valorPendente], [2607.17, false]);
ok('C3. histórico: financeiro/OS NÃO são bloqueados (comportamento anterior)', orcBloqueioComparativoPendente(LEG) === false);
test('C4. histórico: OS usa a opção selecionada, como antes da regra nova', _orcEntraNaOperacaoDoRegistro(LEG).map(function (i) { return i.mat; }), ['Acrílico Cristal 2mm']);
var LEG_SEM_CAMPO = { itens: [{ mat: 'X', grupoOpcao: { grupoId: 'g', selecionada: true } }], valorFinal: 50 };
ok('C5. histórico antigo sem escolhaConfirmada: fallback selecionada, sem migração', _orcEntraNaOperacaoDoRegistro(LEG_SEM_CAMPO).length === 1);

// D — novo orçamento: antes genérico (pendente), depois específico (escolhido)
ok('D1. novo orçamento antes da escolha: pendente', orcRegistroComparativoPendente(PEND) === true);
ok('D2. novo orçamento depois da escolha: não pendente, valor específico', orcRegistroComparativoPendente(CONF_B) === false && orcEnvNormalizar(CONF_B).valorFinal === 150);

// E — Step 3 e fiação de persistência (fonte)
var srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok('E1. Step 3: rótulo do card é trocado por "PRÉVIA INTERNA" quando há comparativo', /PRÉVIA INTERNA — opção em edição \(não é escolha do cliente\)/.test(srcIndex) && /id="orcTotalLblCard"/.test(srcIndex));
ok('E2. salvamento: comparativo pendente grava valorBase/valorFinal nulos', /valorBase: _pendSalvarCmp \? null : c\.finalPrice/.test(srcIndex) && /valorFinal: _pendSalvarCmp \? null : afterDisc/.test(srcIndex));
ok('E3. salvamento: orçamento antigo re-salvo não ganha a regra nova (herda o marcador)', /_regraSalvarCmp = orcExistente \? orcExistente\.regraComparativo : ORC_REGRA_COMPARATIVO_ATUAL/.test(srcIndex));
ok('E4. lista e detalhe mostram "aguardando escolha" em vez de R$ 0,00 para pendente', /valorPendente \? '<span[^']*>aguardando escolha<\/span>'/.test(srcIndex) && /VALOR FINAL: '\+\(_n\.valorPendente/.test(srcIndex));

// F — duplicação: peças herdadas seguem a espessura da linha nova (defeito real achado no smoke)
var orcPecasHerdarEspessura = mod.orcPecasHerdarEspessura;
var PEC_ORIG = JSON.stringify([
  { nome: 'Tampa', qty: 1, larg: 100, alt: 50, esp: '2', origem: 'AUTOMATICA', adesivoNormal: true, gravacao: 20 },
  { nome: 'Lateral', qty: 2, larg: 30, alt: 20, esp: '5', origem: 'AUTOMATICA', espOverride: 5 },
  { nome: 'Manual', qty: 1, larg: 10, alt: 10, esp: '2', origem: 'MANUAL' }
]);
var PEC_B = JSON.parse(orcPecasHerdarEspessura(PEC_ORIG, '3'));
test('F1. peça herdada (sem espOverride) passa a 3mm na alternativa', PEC_B[0].esp, '3');
test('F2. peça com espOverride explícito (5mm) é preservada', PEC_B[1].esp, '5');
test('F3. peça MANUAL mantém a espessura própria (2mm)', PEC_B[2].esp, '2');
test('F4. consumíveis da peça herdada são preservados (adesivo/gravação)', [PEC_B[0].adesivoNormal, PEC_B[0].gravacao], [true, 20]);
test('F5. sem espessura válida nada muda', orcPecasHerdarEspessura(PEC_ORIG, ''), JSON.stringify(JSON.parse(PEC_ORIG)));
var srcIdx2 = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok('F6. espessura herdada NÃO é mais restrita a grupo: orcMatChanged não re-carimba por grupo (centralizado em orcRecalc)', !/_rowCmp/.test(srcIdx2) && /orcSincronizarEspPecasHerdadas\(\)/.test(srcIdx2));
ok('F7. duplicação também chama o helper (cópia já nasce com a espessura certa quando o material muda)', /orcPecasHerdarEspessura\(rowNovo\.dataset\.planPecas/.test(srcIdx2));
// G — Step 3: rótulo de três estados
ok('G1. Step 3: sem comparativo → "ORÇAMENTO TOTAL"; pendente → "PRÉVIA INTERNA"; escolhido → "opção escolhida pelo cliente"', /ORÇAMENTO TOTAL/.test(srcIdx2) && /PRÉVIA INTERNA — opção em edição \(não é escolha do cliente\)/.test(srcIdx2) && /ORÇAMENTO — opção escolhida pelo cliente/.test(srcIdx2));

// H — espessura herdada em orçamento NORMAL (sem comparativo) e save/reopen
var orcSincronizarEspPecasHerdadas = mod.orcSincronizarEspPecasHerdadas;
function pecasDe(r) { return JSON.parse(r.oir_1.dataset.planPecas); }
var PN = [{ nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '2', origem: 'AUTOMATICA' }, { nome: 'Base', qty: 1, larg: 40, alt: 30, esp: '2', origem: 'AUTOMATICA' }];
var rH1 = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: PN }], materiaisCatalogo: MATS });
test('H1. orçamento normal 2mm→3mm: peças automáticas passam para 3mm', pecasDe(rH1).map(function (p) { return p.esp; }), ['3', '3']);
var PM = [{ nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '2', origem: 'AUTOMATICA' }, { nome: 'Manual', qty: 1, larg: 10, alt: 10, esp: '4', origem: 'MANUAL' }];
var rH2 = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: PM }], materiaisCatalogo: MATS });
test('H2. peça MANUAL 4mm permanece 4mm (a automática vai a 3mm)', pecasDe(rH2).map(function (p) { return p.esp; }), ['3', '4']);
var PO = [{ nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '5', espOverride: 5, origem: 'AUTOMATICA' }];
var rH3 = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: PO }], materiaisCatalogo: MATS });
test('H3. peça com espOverride explícito permanece no override (5mm, espOverride 5)', [pecasDe(rH3)[0].esp, pecasDe(rH3)[0].espOverride], ['5', 5]);
// H4 — save/reopen: o estado salvo, reaberto e recalculado, não muda de novo
var salvo = rH1.oir_1.dataset.planPecas;
var rH4 = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: JSON.parse(salvo) }], materiaisCatalogo: MATS });
test('H4. save/reopen: reabrir o salvo (3mm) mantém o resultado idêntico', rH4.oir_1.dataset.planPecas, salvo);
var rH4b = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: JSON.parse(salvo) }], materiaisCatalogo: MATS });
test('H4b. recalcular duas vezes não altera o snapshot (idempotente)', rH4b.oir_1.dataset.planPecas, salvo);
// H5 — histórico: sessão legada nunca é tocada
window._orcSessaoRegraComparativo = 'legado';
var rH5 = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: PN }], materiaisCatalogo: MATS });
test('H5. orçamento histórico (sessão legada) NÃO é re-carimbado: snapshot 2mm preservado', pecasDe(rH5).map(function (p) { return p.esp; }), ['2', '2']);
window._orcSessaoRegraComparativo = undefined;
var srcIdxH = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok('H6. sincronização roda no início de orcRecalc (toda linha, qualquer orçamento novo)', /function orcRecalc\(\) \{\n  orcSincronizarEspPecasHerdadas\(\);/.test(srcIdxH));
ok('H7. sessão de orçamento antigo é definida ANTES de reconstruir as linhas (orcEnvEditar)', srcIdxH.indexOf("window._orcSessaoRegraComparativo = (o.regraComparativo === ORC_REGRA_COMPARATIVO_ATUAL)") < srcIdxH.indexOf("orcItemCount=0;\n      if(typeof ORC_ITEM_EXTRAS"));

// P — Pix em pt-BR nos dois estados; texto histórico preservado
var CP = { pxPct: 3.99, pixTotal: 306.22, parcela: { nParc: 3, valorParcela: 106.31, totalCents: 31895 } };
var txtConf = orcMontarBlocosPagamento(CP, false, 0, '', FMT, false, false).map(function (b) { return b.texto; }).join('|');
var txtPend = orcMontarBlocosPagamento(CP, false, 0, '', FMT, true, false).map(function (b) { return b.texto; }).join('|');
var txtHist = orcMontarBlocosPagamento(CP, false, 0, '', FMT, false, true).map(function (b) { return b.texto; }).join('|');
ok('P1. confirmado: Pix em pt-BR "3,99%" (sem "3.99")', /3,99% de desconto pagando/.test(txtConf) && !/3\.99/.test(txtConf));
ok('P2. pendente: Pix em pt-BR "3,99%" (mesma formatação)', /3,99% de desconto no pagamento/.test(txtPend));
ok('P3. histórico (formatoAntigo): texto antigo preservado "3.99%"', /3\.99% de desconto pagando/.test(txtHist));
ok('P4. matemática intocada: valor com PIX continua R$ 306,22', /valor com PIX: R\$ 306,22/.test(txtConf));
test('P5. orcPctBR: 5,14 e 5 em pt-BR', [orcPctBR(5.14), orcPctBR(5)], ['5,14', '5']);

// K — salvamento recusado pela nuvem (conflito): memória volta à verdade do servidor
var orcSetEnviados_ctx = null;
(function () {
  var fnSrc = extractFn('orcSetEnviados');
  var ctx = { console: console, _ORC_ENVIADOS_DATA: null, _cloudReady: true, _cloudSave: function () {}, orcEnviadosRender: function () {}, _orcamentosSalvarComMerge: null };
  require('vm').createContext(ctx);
  require('vm').runInContext(fnSrc, ctx);
  orcSetEnviados_ctx = ctx;
})();
var _regPend = function (conf) { return { id: 'ORC-K', regraComparativo: 2, valorFinal: conf ? 318.95 : null, valorPendenteComparativo: conf ? undefined : true,
  itens: [{ mat: 'Acrílico Cristal 3mm', grupoOpcao: { grupoId: 'g', selecionada: true, escolhaConfirmada: conf } }] }; };
var _Kservidor = [_regPend(false)];          // verdade da nuvem: escolha NÃO persistida
var _Klocal = [_regPend(true)];              // memória otimista: escolha que a nuvem recusou
var _Kok = [{ id: 'ORC-K2', valorFinal: 100 }];
orcSetEnviados_ctx._orcamentosSalvarComMerge = function () { return Promise.resolve({ ok: false, reason: 'conflito', serverData: _Kservidor }); };
orcSetEnviados_ctx.orcSetEnviados(_Klocal).then(function () {
  ok('K1. conflito na nuvem: memória volta à versão do servidor (escolha não persistida some)', orcSetEnviados_ctx._ORC_ENVIADOS_DATA === _Kservidor);
  ok('K2. após o conflito, o registro na memória é pendente (gate financeiro/OS bloqueia)', orcRegistroComparativoPendente(orcSetEnviados_ctx._ORC_ENVIADOS_DATA[0]) === true);
  orcSetEnviados_ctx._orcamentosSalvarComMerge = function () { return Promise.resolve({ ok: true }); };
  return orcSetEnviados_ctx.orcSetEnviados(_Kok);
}).then(function () {
  ok('K3. gravação aceita: memória fica com a lista gravada (caminho de conflito não interfere)', orcSetEnviados_ctx._ORC_ENVIADOS_DATA === _Kok);
});

ok('K4. fonte: orcSetEnviados reconcilia com serverData em qualquer conflito', /reason\.indexOf\('conflito'\) === 0 && Array\.isArray\(r\.serverData\)/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')));

// L — conflito: a tela (ORC_ITEM_OPCOES) é reidratada a partir do registro do servidor
(function () {
  var fnSrc = extractFn('orcReidratarGruposDoServidor');
  var ctx = { console: console, window: { _orcSessaoAtualId: 'ORC-L' }, ORC_ITEM_OPCOES: {}, orcRecalc: function () { ctx._recalc = (ctx._recalc || 0) + 1; }, _recalc: 0 };
  ctx.document = { querySelectorAll: function () { return [{ dataset: { idx: '1' } }, { dataset: { idx: '2' } }]; } };
  require('vm').createContext(ctx);
  require('vm').runInContext(fnSrc, ctx);
  // tela: escolha B confirmada (rejeitada pela nuvem)
  ctx.ORC_ITEM_OPCOES['1'] = { grupoId: 'g', selecionada: false, escolhaConfirmada: false };
  ctx.ORC_ITEM_OPCOES['2'] = { grupoId: 'g', selecionada: true, escolhaConfirmada: true };
  var servidor = [{ id: 'ORC-L', itens: [
    { mat: 'A', grupoOpcao: { grupoId: 'g', selecionada: true, escolhaConfirmada: false } },
    { mat: 'B', grupoOpcao: { grupoId: 'g', selecionada: false, escolhaConfirmada: false } },
    { tipoItem: 'vitre_catalogo', sku: 'V-1' }
  ] }];
  ctx.orcReidratarGruposDoServidor(servidor);
  ok('L1. após conflito a tela reidrata A/B do servidor: nenhuma escolha confirmada permanece', ctx.ORC_ITEM_OPCOES['2'].escolhaConfirmada === false && ctx.ORC_ITEM_OPCOES['1'].selecionada === true);
  ok('L2. alinhamento ignora o item Vitre (cumulativo, fora das linhas) e recalcula a tela', ctx._recalc === 1 && Object.keys(ctx.ORC_ITEM_OPCOES).length === 2);
  ctx.window._orcSessaoAtualId = 'OUTRO';
  ctx.ORC_ITEM_OPCOES['1'] = { grupoId: 'x', selecionada: true, escolhaConfirmada: true };
  ctx.orcReidratarGruposDoServidor(servidor);
  ok('L3. sessão de outro orçamento não é tocada', ctx.ORC_ITEM_OPCOES['1'].grupoId === 'x');
})();

// M — feedback de salvamento: sucesso só depois da confirmação real da nuvem
(function () {
  var toasts = [];
  var ctx = { console: console, showToast: function (m, k) { toasts.push((k || '') + ':' + m); } };
  require('vm').createContext(ctx);
  require('vm').runInContext(extractFn('orcFeedbackSalvamento'), ctx);
  var sucesso = function (t) { return t.filter(function (x) { return /^ok:.*(salvo!|atualizado!)/.test(x); }).length; };
  var p = function (r) { toasts.length = 0; return ctx.orcFeedbackSalvamento(Promise.resolve(r), 7, true); };
  p({ ok: true }).then(function () {
    ok('M1. save aceito: toast de sucesso aparece UMA vez', sucesso(toasts) === 1);
    return p({ ok: false, reason: 'conflito', serverData: [] });
  }).then(function () {
    ok('M2. save com conflito: NENHUM toast de sucesso', sucesso(toasts) === 0);
    return p({ ok: false, reason: 'conflito-persistente' });
  }).then(function () {
    ok('M3. conflito persistente: nenhum sucesso (o merge já avisa o conflito)', sucesso(toasts) === 0);
    return p({ ok: false, reason: 'nuvem-nao-pronta' });
  }).then(function () {
    ok('M3b. rejeição genérica (não é conflito): nenhum sucesso e erro explícito', sucesso(toasts) === 0 && toasts.some(function (x) { return x.indexOf('err:') === 0; }));
    return p({ ok: true });
  }).then(function () {
    ok('M4. nova tentativa aceita após o conflito: sucesso aparece', sucesso(toasts) === 1);
  });
})();
ok('M5. orcSalvarOrcamento não dispara sucesso de forma síncrona (usa a promessa real)', /orcFeedbackSalvamento\(_pSalvarOrc, num, !!orcExistente\);/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')) && !/showToast\(\(orcExistente\?'Orçamento #'\+num\+' atualizado!'/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')));

// N — OS: vínculo conhecido no primeiro write; base/memória de kb_os voltam à nuvem
(function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok('N1. criação da OS: grupoPedidoId entra no primeiro write (pedido com Vitre)', /grupoPedidoId:\(_vitreItensPayload\.length\?newId:undefined\)/.test(src));
  ok('N2. após o vínculo CR e após o vínculo Vitre, a base de kb_os é atualizada (orcRefrescarKbOsDoServidor)', /_vincularCrPromise\.then\(function\(\)\{ return orcRefrescarKbOsDoServidor\(\); \}\)/.test(src) && /\}\)\.then\(function\(\)\{ return orcRefrescarKbOsDoServidor\(\); \}\)\.then\(function\(\)\{ return resultado; \}\)/.test(src));
  var ctx = { console: console, _COL: 'erp_vr', _cloudLastPayload: {}, KB_OS: {}, _KB_OS_FIN_CACHE: {}, _kbMergeFinCache: function () {}, kbRender: function () {} };
  var srvKb = JSON.stringify({ 'os1': { id: 'os1', num: '1', material: 'Acrílico Cristal 3mm', grupoPedidoId: 'os1', vitreOsRef: 'vx1' } });
  var srvFin = JSON.stringify({ 'os1': { cr: [] } });
  ctx._db = { collection: function () { return { doc: function (d) { return { get: function () { return Promise.resolve({ exists: true, data: function () { return { data: d === 'kb_os' ? srvKb : srvFin }; } }); } }; } }; } };
  require('vm').createContext(ctx);
  require('vm').runInContext(extractFn('orcRefrescarKbOsDoServidor'), ctx);
  ctx.KB_OS = { os1: { id: 'os1', num: '1', material: 'stale' } };
  ctx.orcRefrescarKbOsDoServidor().then(function () {
    ok('N3. refresh: memória de kb_os = nuvem (vínculos gravados aparecem, nada local some)', ctx.KB_OS.os1.grupoPedidoId === 'os1' && ctx.KB_OS.os1.vitreOsRef === 'vx1');
    ok('N4. refresh: base de kb_os = nuvem (próximo save compara com a versão real)', ctx._cloudLastPayload.kb_os === srvKb);
  });
})();

// Resumo só depois das asserções assíncronas (K1–K3) — evita contar a menos.
setTimeout(function () {
  console.log('\n RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  process.exit(failed ? 1 : 0);
}, 50);
