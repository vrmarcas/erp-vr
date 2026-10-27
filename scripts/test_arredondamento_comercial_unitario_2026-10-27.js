/**
 * test_arredondamento_comercial_unitario_2026-10-27.js
 *
 * BUG CRÍTICO real de produção (2026-10-27): orçamento de Display,
 * quantidade 2.000, preço unitário comercial EXIBIDO R$47,00, mas
 * SUBTOTAL exibido R$94.002,61 (não R$94.000,00).
 *
 * Causa raiz: o PASS 3 de orcRecalc() calculava `itemUnitFinal` (o preço
 * comercial unitário de fato — o que o vendedor define/vê) mantendo toda
 * a precisão de ponto flutuante (ex. 47,001305...); só a STRING exibida
 * (.toFixed(2)) era arredondada — o SUBTOTAL continuava sendo esse valor
 * CRU × qty (47,001305×2000=94.002,61), expondo a fração de centavo
 * oculta assim que a quantidade crescia o suficiente. O TOTAL GERAL do
 * pedido (finalPrice/finalPriceVR, calculado por agregados de custo ANTES
 * do PASS 3) também carregava essa mesma fração escondida.
 *
 * Correção: `itemUnitFinal` é consolidado (arredondado) para 2 casas —
 * a fonte canônica única do preço comercial unitário — ANTES de derivar
 * o subtotal da linha (`itemTotalFinal = itemUnitFinal(2 casas) × qty +
 * ajusteFixoPortionRS + extrasProprioMarkup`); `item.tsRaw` é mantido
 * consistente (nunca uma conta paralela) e o delta de consolidação é
 * propagado para finalPriceVR/finalPrice, para o TOTAL GERAL do pedido
 * nunca mais esconder a fração.
 *
 * Usa as FUNÇÕES REAIS extraídas de index.html — nunca reimplementa.
 *
 * Uso: node scripts/test_arredondamento_comercial_unitario_2026-10-27.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function exato(desc, got, expected) {
  if (Math.abs(got - expected) < 0.000001) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado exatamente = ' + expected + '\n       obtido              = ' + got); failed++; }
}
function testePerto(desc, got, expected, tolerancia) {
  tolerancia = tolerancia == null ? 0.01 : tolerancia;
  if (Math.abs(got - expected) <= tolerancia) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado ≈ ' + expected + '\n       obtido   = ' + got); failed++; }
}
function parseBRL(str) { return parseFloat(String(str).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0; }

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
function extractArr(name) {
  var marker = 'var ' + name + ' = [';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Array ' + name + ' não encontrado — teste desatualizado?');
  var bracketOpen = html.indexOf('[', start);
  var depth = 0, i = bracketOpen;
  for (; i < html.length; i++) { if (html[i] === '[') depth++; else if (html[i] === ']') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

var FN_NAMES = [
  'orcProdutoNomeResolvido', 'cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos', 'orcItensDistribuidosDeOrc', '_orcItemEntraNaOperacao',
  'orcComparativoPendenteDOM', 'orcComparativoPendente', 'orcOpcaoSelecionar', 'orcMotorComercial', 'orcDistribuirParcelas',
  'cfgMaqOperInfo', '_orcMaqInfo', 'orcSincronizarEspPecasHerdadas', 'orcPecasHerdarEspessura'
];
var src = [
  'var ORC_REGRA_COMPARATIVO_ATUAL = 2;',
  extractArr('ORC_MAQ_OPS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, orcItensDistribuidosDeOrc: orcItensDistribuidosDeOrc, orcOpcaoSelecionar: orcOpcaoSelecionar, orcMotorComercial: orcMotorComercial, orcItemAplicarAjuste: orcItemAplicarAjuste };'
].join('\n\n');
var modPath = path.join(__dirname, '_arredondamento_comercial_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 2026-10-27 — Arredondamento comercial do preço unitário ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {}, style: {} }, props || {}); }

// Monta um pedido com N itens (cada um: {idx, larg, alt, qty, priceM2,
// ajuste?}) — preço/m² controlado via _matGetRsm2 (mock), permitindo
// construir exatamente o custo-base desejado por item.
function montarPedido(itens, opts) {
  opts = opts || {};
  var PRECOS_POR_IDX = {};
  itens.forEach(function (it) { PRECOS_POR_IDX[it.idx] = it.priceM2; });

  global.cfgLoad = function () {
    return {
      materiais: [{ nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }],
      financeiro: { overhead: 0, vrml: 0, impostos: 0 },
      maquinas: [], maquinasOperacoes: {}, parcelamento: opts.parcelamento || [{ parcelas: 1, taxa: 0 }]
    };
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function (matKey, idx) { return PRECOS_POR_IDX[idx] != null ? PRECOS_POR_IDX[idx] : 100; };

  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocu_laser: makeEl(), ocu_dobra: makeEl(), ocu_pol: makeEl(), ocu_uv: makeEl(), ocu_lixa: makeEl(), ocu_tupia: makeEl(),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    orcMaqAlertaSemCusto: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }),
    oc_imp: makeEl({ value: '0' }), oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }), soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(), orcTotalLblCard: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  itens.forEach(function (it) {
    var idx = it.idx;
    _els['oi_qty_' + idx] = makeEl({ value: String(it.qty) });
    _els['oi_larg_' + idx] = makeEl({ value: String(it.larg) });
    _els['oi_alt_' + idx] = makeEl({ value: String(it.alt) });
    _els['oi_mat_' + idx] = makeEl({ value: 'cfg_0', dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: 'Acrílico Cristal', esp: '3' }, text: 'Acrílico Cristal 3mm' }] });
    _els['oi_esp_' + idx] = makeEl({ value: '3' });
    _els['oi_prod_' + idx] = makeEl({ value: it.prod || ('Display ' + idx) });
    _els['oi_det_' + idx] = makeEl({ value: '' });
    _els['oi_custo_' + idx] = makeEl(); _els['oi_unit_' + idx] = makeEl(); _els['oi_tot_' + idx] = makeEl();
    _els['oi_opcaoBadge_' + idx] = makeEl();
    _els['oir_' + idx] = { dataset: { idx: idx, planArea: '0' } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) { if (sel === '#orcItemBody tr') return itens.map(function (it) { return { dataset: _els['oir_' + it.idx].dataset }; }); return []; }
  };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  itens.forEach(function (it) { if (it.ajuste) global.ORC_ITEM_AJUSTES[it.idx] = it.ajuste; });
  global.ORC_ITEM_OPCOES = opts.opcoes || {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.window._orcAdhPrecoSnapshot = null;

  mod.orcRecalc();

  return {
    els: _els,
    unit: function (idx) { return parseBRL(_els['oi_unit_' + idx].textContent); },
    total: function (idx) { return parseBRL(_els['oi_tot_' + idx].textContent); },
    finalPrice: function () { return (global.window._orcCalc || {}).finalPrice || 0; },
    precoDistribuido: function (idx, grupoId) {
      var c = global.window._orcCalc || {};
      var base = c.finalPrice || 0;
      var lista = mod.orcColetarItensDistribuidos(base);
      if (grupoId) return lista.filter(function (x) { return x.grupoOpcaoId === grupoId; });
      return lista;
    }
  };
}

// ──────────────────────────────────────────────────────────────────────
// TESTE 1 — CASO REAL: R$47,00 × 2.000 = R$94.000,00 (nunca R$94.002,61)
// ──────────────────────────────────────────────────────────────────────
(function teste1_casoReal() {
  // priceM2=47,001305 com área=1m² e qty=2000 reproduz EXATAMENTE o
  // sintoma relatado: custo-base bruto = 94.002,61 (fração de centavo
  // "escondida" atrás do unitário R$47,00 quando dividido por 2000).
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }]);
  exato('*** BUG FECHADO *** Unitário exibido = R$47,00', p.unit('1'), 47.00);
  exato('*** BUG FECHADO *** Subtotal = R$94.000,00 (nunca R$94.002,61)', p.total('1'), 94000.00);
  exato('*** BUG FECHADO *** TOTAL GERAL do pedido também = R$94.000,00 (nunca a fração escondida)', p.finalPrice(), 94000.00);
  ok('Identidade: subtotal === unitário exibido × quantidade', Math.abs(p.total('1') - p.unit('1') * 2000) < 0.001);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 2 — CENTAVOS: R$47,01 × 2.000 = R$94.020,00
// ──────────────────────────────────────────────────────────────────────
(function teste2_centavos() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.01 }]);
  exato('TESTE 2 — Unitário R$47,01', p.unit('1'), 47.01);
  exato('TESTE 2 — Subtotal R$94.020,00', p.total('1'), 94020.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 3 — QUANTIDADE PEQUENA: R$47,00 × 3 = R$141,00
// ──────────────────────────────────────────────────────────────────────
(function teste3_qtyPequena() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 3, priceM2: 47.00 }]);
  exato('TESTE 3 — Unitário R$47,00', p.unit('1'), 47.00);
  exato('TESTE 3 — Subtotal R$141,00', p.total('1'), 141.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 4 — valor interno 47,001305 consolida para 47,00 → 94.000,00
// (mesmo cenário do TESTE 1, nomeado explicitamente conforme o relato)
// ──────────────────────────────────────────────────────────────────────
(function teste4_consolidacaoAntesDoSubtotal() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }]);
  exato('TESTE 4 — valor interno 47,001305 consolida para 47,00 ANTES do subtotal', p.unit('1'), 47.00);
  exato('TESTE 4 — subtotal = 47,00×2.000 = 94.000,00', p.total('1'), 94000.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 5 — ARREDONDAMENTO PARA CIMA: 47,006 → 47,01 × 100 = 4.701,00
// ──────────────────────────────────────────────────────────────────────
(function teste5_arredondaParaCima() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 100, priceM2: 47.006 }]);
  exato('TESTE 5 — 47,006 arredonda para 47,01 (meio-para-cima)', p.unit('1'), 47.01);
  exato('TESTE 5 — Subtotal R$4.701,00', p.total('1'), 4701.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 6 — AJUSTE MANUAL: motor calcula R$52,378..., vendedor define R$47,00
// ──────────────────────────────────────────────────────────────────────
(function teste6_ajusteManual() {
  // Custo-base que o motor calcularia originalmente ≈ R$52,38/un (qty=2000).
  var precoOriginalAprox = 52.378;
  // Vendedor aplica um ajuste comercial (escopo 'unidade', tipo 'fixo',
  // 'desconto') para definir o preço final em R$47,00 — delta por
  // unidade com fração "feia" de propósito (não um número redondo),
  // simulando o caso real em que o vendedor calibra manualmente.
  var deltaPorUnidade = precoOriginalAprox - 47.001305; // não é um número redondo
  var p = montarPedido([{
    idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: precoOriginalAprox,
    ajuste: { operacao: 'desconto', tipo: 'fixo', valor: deltaPorUnidade, escopo: 'unidade' }
  }]);
  exato('TESTE 6 — preço final consolidado é EXATAMENTE R$47,00 (nunca 52,38 nem 47,001...)', p.unit('1'), 47.00);
  exato('TESTE 6 — subtotal deriva do R$47,00 consolidado: R$94.000,00', p.total('1'), 94000.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 7 — SUBTOTAL + TOTAL (item único)
// ──────────────────────────────────────────────────────────────────────
(function teste7_subtotalETotal() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }]);
  exato('TESTE 7 — Subtotal R$94.000,00', p.total('1'), 94000.00);
  exato('TESTE 7 — Total geral do pedido também R$94.000,00', p.finalPrice(), 94000.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 8 — VÁRIOS ITENS: A=94.000 + B=105,00 → total 94.105,00
// ──────────────────────────────────────────────────────────────────────
(function teste8_variosItens() {
  var p = montarPedido([
    { idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }, // A: R$47,00×2000=R$94.000,00
    { idx: '2', larg: 100, alt: 100, qty: 10, priceM2: 10.50 }        // B: R$10,50×10=R$105,00
  ]);
  exato('TESTE 8 — Item A: R$94.000,00', p.total('1'), 94000.00);
  exato('TESTE 8 — Item B: R$105,00', p.total('2'), 105.00);
  exato('TESTE 8 — Total geral = soma dos subtotais comerciais = R$94.105,00', p.finalPrice(), 94105.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 9 — COMPARATIVO: subtotal de cada alternativa = unitário × qty,
// antes e depois da escolha (nunca mais a fração escondida).
// ──────────────────────────────────────────────────────────────────────
(function teste9_comparativo() {
  var opcoes = { '1': { grupoId: 'g1', selecionada: true, escolhaConfirmada: false }, '2': { grupoId: 'g1', selecionada: false, escolhaConfirmada: false } };
  var p = montarPedido([
    { idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }, // alternativa A
    { idx: '2', larg: 130, alt: 100, qty: 2000, priceM2: 38.507 }     // alternativa B (outro valor "feio")
  ], { opcoes: opcoes });

  function checarAlternativa(idxAlvo, posicaoNaLista) {
    var lista = p.precoDistribuido(idxAlvo, 'g1');
    var item = lista[posicaoNaLista];
    var unitEsperado = Math.round((item.total / item.qty) * 100) / 100;
    ok('Comparativo (' + idxAlvo + '): subtotal === unitário exibido × qty (sem fração oculta)', Math.abs(item.total - unitEsperado * item.qty) < 0.01);
  }
  checarAlternativa('1', 0); // ANTES da escolha
  checarAlternativa('2', 1);
  mod.orcOpcaoSelecionar('1');
  checarAlternativa('1', 0); // DEPOIS da escolha
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 10 — PIX sobre o total comercial já consolidado
// ──────────────────────────────────────────────────────────────────────
(function teste10_pix() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }], { parcelamento: [{ parcelas: 1, taxa: 0 }] });
  var motor = mod.orcMotorComercial(p.finalPrice(), { nParcAtual: 1 });
  exato('TESTE 10 — PIX calculado sobre o total comercial consolidado (R$94.000,00), nunca a fração oculta', motor.pix.totalCents / 100, 94000.00);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 11 — PARCELAMENTO deriva do total comercial correto
// ──────────────────────────────────────────────────────────────────────
(function teste11_parcelamento() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }], { parcelamento: [{ parcelas: 3, taxa: 3.99 }] });
  var motor = mod.orcMotorComercial(p.finalPrice(), { nParcAtual: 3 });
  var cartao3x = motor.cartao[3].totalCents / 100;
  var esperado = 94000.00 / (1 - 3.99 / 100);
  testePerto('TESTE 11 — parcelamento nasce do subtotal correto (94.000,00), nunca de 94.002,61', cartao3x, esperado, 0.01);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 12 — PDF/WhatsApp: unitário R$47,00 + qty 2.000 ⇒ subtotal R$94.000,00
// ──────────────────────────────────────────────────────────────────────
(function teste12_pdfWhatsapp() {
  var p = montarPedido([{ idx: '1', larg: 100, alt: 100, qty: 2000, priceM2: 47.001305 }]);
  var c = global.window._orcCalc;
  var baseEfetiva = mod.orcMotorComercial(c.finalPrice, { nParcAtual: 1 }).cartao[1].totalCents / 100;
  var itens = mod.orcColetarItensDistribuidos(baseEfetiva);
  var item = itens[0];
  var unitArredondado = Math.round(item.unit * 100) / 100;
  exato('TESTE 12 — WhatsApp/Preview: unitário R$47,00', unitArredondado, 47.00);
  exato('TESTE 12 — WhatsApp/Preview: subtotal R$94.000,00 (consistente com o unitário)', Math.round(item.total * 100) / 100, 94000.00);
})();

console.log('\n' + (failed === 0 ? '✅ TODOS OS TESTES PASSARAM' : '❌ ' + failed + ' TESTE(S) FALHARAM') + ' (' + passed + ' passou/passaram, ' + failed + ' falhou/falharam)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
