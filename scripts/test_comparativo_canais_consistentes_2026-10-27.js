/**
 * test_comparativo_canais_consistentes_2026-10-27.js
 *
 * Prova de fechamento exigida pelo usuário (2026-10-27): o preço de uma
 * alternativa de comparativo precisa ser IDÊNTICO em todos os canais —
 * tela ao vivo/Preview/WhatsApp (orcColetarItensDistribuidos, lê do DOM)
 * e PDF de um registro JÁ SALVO (orcItensDistribuidosDeOrc, lê só o
 * `orc` persistido) — ANTES e DEPOIS da escolha confirmada, e que:
 *
 *  - o gross-up de cartão nunca é aplicado duas vezes;
 *  - o PIX usa a MESMA base do cartão;
 *  - financeiro (orc.valorFinal) bate com a soma dos itens distribuídos
 *    depois da escolha;
 *  - OS/produção (orc.itens[].total persistido) NUNCA inclui o cartão —
 *    é a mesma base crua usada para custo/produção, por design;
 *  - o "Total Geral" exibido ao cliente continua "a definir" enquanto
 *    pendente, mesmo com os itens individuais já corretos.
 *
 * Usa as FUNÇÕES REAIS extraídas de index.html — nunca reimplementa.
 *
 * Uso: node scripts/test_comparativo_canais_consistentes_2026-10-27.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function testePerto(desc, got, expected, tolerancia) {
  tolerancia = tolerancia == null ? 0.01 : tolerancia;
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
  '_orcEntraNaOperacaoDoRegistro', 'orcComparativoPendenteDOM', 'orcComparativoPendente', 'orcTextoValorCliente',
  'orcOpcaoSelecionar', 'orcMotorComercial', 'orcDistribuirParcelas', 'cfgMaqOperInfo', '_orcMaqInfo',
  'orcSincronizarEspPecasHerdadas', 'orcPecasHerdarEspessura'
];
var src = [
  'var ORC_REGRA_COMPARATIVO_ATUAL = 2;',
  extractArr('ORC_MAQ_OPS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, orcItensDistribuidosDeOrc: orcItensDistribuidosDeOrc, orcOpcaoSelecionar: orcOpcaoSelecionar, orcMotorComercial: orcMotorComercial, orcTextoValorCliente: orcTextoValorCliente, orcComparativoPendenteDOM: orcComparativoPendenteDOM, orcComparativoPendente: orcComparativoPendente, _orcEntraNaOperacaoDoRegistro: _orcEntraNaOperacaoDoRegistro };'
].join('\n\n');
var modPath = path.join(__dirname, '_comparativo_canais_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 2026-10-27 (fechamento) — Paridade de canais do comparativo ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {}, style: {} }, props || {}); }

function montarCenario(opts) {
  opts = opts || {};
  var MATS = [{ nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }];
  var MAQUINAS = [{ id: 'maq_laser_vermelha', nome: 'Laser Vermelha', unidade: 'hora', custo: 130, setup: 0 }];
  var PARCELAMENTO = [{ parcelas: 1, taxa: 7.35 }];

  global.cfgLoad = function () {
    return {
      materiais: MATS, financeiro: { overhead: 0, vrml: 0, impostos: 0 },
      maquinas: MAQUINAS,
      maquinasOperacoes: opts.vinculado ? { laser: 'maq_laser_vermelha' } : {},
      parcelamento: PARCELAMENTO
    };
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; };

  var ITEM_A = '1', ITEM_B = '2';
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: String(opts.laserMin != null ? opts.laserMin : 12.7) }),
    om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }), om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocu_laser: makeEl(), ocu_dobra: makeEl(), ocu_pol: makeEl(), ocu_uv: makeEl(), ocu_lixa: makeEl(), ocu_tupia: makeEl(),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    orcMaqAlertaSemCusto: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }),
    oc_imp: makeEl({ value: '0' }), oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(), orcTotalLblCard: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  [[ITEM_A, 100, 100], [ITEM_B, 150, 100]].forEach(function (cfg) {
    var idx = cfg[0];
    _els['oi_qty_' + idx] = makeEl({ value: '1' });
    _els['oi_larg_' + idx] = makeEl({ value: String(cfg[1]) });
    _els['oi_alt_' + idx] = makeEl({ value: String(cfg[2]) });
    _els['oi_mat_' + idx] = makeEl({ value: 'cfg_0', dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: 'Acrílico Cristal', esp: '3' }, text: 'Acrílico Cristal 3mm' }] });
    _els['oi_esp_' + idx] = makeEl({ value: '3' });
    _els['oi_prod_' + idx] = makeEl({ value: 'Caixa ' + idx });
    _els['oi_det_' + idx] = makeEl({ value: '' });
    _els['oi_custo_' + idx] = makeEl();
    _els['oi_unit_' + idx] = makeEl();
    _els['oi_tot_' + idx] = makeEl();
    _els['oi_opcaoBadge_' + idx] = makeEl();
    _els['oir_' + idx] = { dataset: { idx: idx, planArea: '0' } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return [ITEM_A, ITEM_B].map(function (idx) { return { dataset: _els['oir_' + idx].dataset }; });
      return [];
    }
  };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global.ORC_ITEM_OPCOES = {};
  global.ORC_ITEM_OPCOES[ITEM_A] = { grupoId: 'g1', selecionada: true, escolhaConfirmada: false };
  global.ORC_ITEM_OPCOES[ITEM_B] = { grupoId: 'g1', selecionada: false, escolhaConfirmada: false };
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.window._orcAdhPrecoSnapshot = null;

  mod.orcRecalc();

  function parseBRL(str) { return parseFloat(String(str).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0; }

  // Simula exatamente o que _orcSalvarOrcamentoImpl() grava: itens[].unit/
  // total CRUS (lidos do DOM, sem gross-up — ver PASS 3 de orcRecalc),
  // valorBase/valorFinal/valorPrevia calculados da MESMA forma real
  // (afterDisc = orcMotorComercial(finalPrice).cartao[nParc].total).
  function salvarComo(escolhaConfirmadaA) {
    var c = global.window._orcCalc || {};
    var pend = !escolhaConfirmadaA ? global.ORC_ITEM_OPCOES[ITEM_A].grupoId && true : false;
    // orcComparativoPendente real: verdadeiro enquanto nenhuma opção do
    // grupo tiver escolhaConfirmada=true.
    var itensSnapshot = [ITEM_A, ITEM_B].map(function (idx) {
      var op = global.ORC_ITEM_OPCOES[idx];
      return {
        qty: 1, total: _els['oi_tot_' + idx].textContent, unit: _els['oi_unit_' + idx].textContent,
        mat: 'Acrílico Cristal', espMm: 3,
        grupoOpcao: { grupoId: op.grupoId, selecionada: op.selecionada, escolhaConfirmada: op.escolhaConfirmada }
      };
    });
    var _pendenteReal = mod.orcComparativoPendente(itensSnapshot);
    var motor = mod.orcMotorComercial(c.finalPrice || 0, { nParcAtual: 1 });
    var afterDisc = motor.cartao[1].totalCents / 100;
    return {
      regraComparativo: 2,
      itens: itensSnapshot,
      valorBase: _pendenteReal ? null : (c.finalPrice || 0),
      valorFinal: _pendenteReal ? null : afterDisc,
      valorPrevia: afterDisc,
      _pendenteReal: _pendenteReal,
      _finalPriceVivo: c.finalPrice || 0
    };
  }

  return {
    els: _els, ITEM_A: ITEM_A, ITEM_B: ITEM_B, parseBRL: parseBRL, salvarComo: salvarComo,
    precoVivo: function (idxAlvo) {
      var c = global.window._orcCalc || {};
      var baseEfetiva = mod.orcMotorComercial(c.finalPrice || 0, { nParcAtual: 1 }).cartao[1].totalCents / 100;
      var itens = mod.orcColetarItensDistribuidos(baseEfetiva);
      return itens.filter(function (x) { return x.grupoOpcaoId === 'g1'; })[idxAlvo === ITEM_A ? 0 : 1];
    },
    precoPDF: function (orcSalvo, idxAlvo) {
      var totalCartaoPDF = orcSalvo.valorFinal || orcSalvo.valorPrevia || 0;
      var itens = mod.orcItensDistribuidosDeOrc(orcSalvo, totalCartaoPDF);
      return itens.filter(function (x) { return x.grupoOpcaoId === 'g1'; })[idxAlvo === ITEM_A ? 0 : 1];
    }
  };
}

(function provaCompleta() {
  var cen = montarCenario({ vinculado: true, laserMin: 12.7 });

  // ── ANTES DA ESCOLHA ──────────────────────────────────────────────────
  var vivoAntes = cen.precoVivo(cen.ITEM_A);
  var orcSalvoAntes = cen.salvarComo(false);
  ok('ANTES: comparativo salvo como PENDENTE (grupo sem escolhaConfirmada)', orcSalvoAntes._pendenteReal === true);
  ok('ANTES: valorFinal/valorBase ficam null (gate financeiro intacto)', orcSalvoAntes.valorFinal === null && orcSalvoAntes.valorBase === null);
  ok('ANTES: valorPrevia calculado mesmo pendente (apoio só ao PDF/WhatsApp)', orcSalvoAntes.valorPrevia > 0);
  var pdfAntes = cen.precoPDF(orcSalvoAntes, cen.ITEM_A);

  testePerto('PARIDADE DE CANAL (ANTES): Preview/WhatsApp (DOM ao vivo) == PDF (registro salvo pendente)', vivoAntes.total, pdfAntes.total, 0.01);
  ok('ANTES: preço já inclui cartão+máquina (não é mais o cru de R$100)', vivoAntes.total > 127);

  // ── ESCOLHA CONFIRMADA (cliente escolhe A) ───────────────────────────
  mod.orcOpcaoSelecionar(cen.ITEM_A);
  var vivoDepois = cen.precoVivo(cen.ITEM_A);
  var orcSalvoDepois = cen.salvarComo(true);
  ok('DEPOIS: comparativo NÃO está mais pendente', orcSalvoDepois._pendenteReal === false);
  ok('DEPOIS: valorFinal/valorBase voltam a ser preenchidos (venda real)', orcSalvoDepois.valorFinal > 0 && orcSalvoDepois.valorBase > 0);
  var pdfDepois = cen.precoPDF(orcSalvoDepois, cen.ITEM_A);

  // ═══ CRITÉRIO OBRIGATÓRIO DO USUÁRIO: PREÇO ANTES == PREÇO DEPOIS ═══
  testePerto('*** BUG 1 FECHADO *** opção A: PREÇO ANTES da escolha == PREÇO DEPOIS (tela ao vivo)', vivoAntes.total, vivoDepois.total, 0.01);
  testePerto('*** BUG 1 FECHADO *** opção A: PREÇO ANTES == PREÇO DEPOIS (PDF/registro salvo)', pdfAntes.total, pdfDepois.total, 0.01);
  testePerto('PARIDADE DE CANAL (DEPOIS): Preview/WhatsApp == PDF, e ambos == ANTES', vivoDepois.total, pdfDepois.total, 0.01);

  // ── GROSS-UP APLICADO UMA ÚNICA VEZ ──────────────────────────────────
  var c = global.window._orcCalc;
  var rawTotalA = cen.parseBRL(cen.els['oi_tot_' + cen.ITEM_A].textContent); // valor cru (PASS 3, sem cartão)
  var fatorCartaoEsperado = mod.orcMotorComercial(100, { nParcAtual: 1 }).cartao[1].totalCents / 10000; // ratio puro de 7,35%
  var fatorAplicadoNoVivo = vivoDepois.total / rawTotalA;
  // O fator aplicado é a escala UNIFORME do pedido (cartão + rateio de
  // máquina/mont/desl sobre a base crua) — estritamente MAIOR que o fator
  // de cartão puro (porque também carrega o custo de máquina embutido),
  // mas nunca o cartão sozinho aplicado duas vezes (o que daria um fator
  // ao quadrado, ~1,166, bem acima do que medimos aqui).
  ok('Gross-up de cartão aplicado UMA única vez (fator ' + fatorAplicadoNoVivo.toFixed(4) + ' != fator-ao-quadrado ' + (fatorCartaoEsperado * fatorCartaoEsperado).toFixed(4) + ')', Math.abs(fatorAplicadoNoVivo - fatorCartaoEsperado * fatorCartaoEsperado) > 0.05);

  // ── PIX USA A MESMA BASE DO CARTÃO ───────────────────────────────────
  var pixTotal = mod.orcMotorComercial(c.finalPrice, { nParcAtual: 1 }).pix.totalCents / 100;
  var baseEfetivaUsada = mod.orcMotorComercial(c.finalPrice, { nParcAtual: 1 }).cartao[1].totalCents / 100;
  testePerto('PIX = preço comercial (cartão) × (1 − 7,35%) — mesma base, nunca uma base diferente', pixTotal, baseEfetivaUsada * (1 - 7.35 / 100), 0.01);

  // ── FINANCEIRO bate com o que o cliente viu ──────────────────────────
  // Depois da escolha, valorFinal (financeiro) tem que ser EXATAMENTE o
  // total efetivo distribuído (soma dos itens que contam no pedido).
  var itensFinanceiro = mod.orcItensDistribuidosDeOrc(orcSalvoDepois, orcSalvoDepois.valorFinal);
  var somaItensDistribuidos = itensFinanceiro.filter(function (x) { return x.opcaoSelecionada !== false; }).reduce(function (s, x) { return s + x.total; }, 0);
  testePerto('FINANCEIRO: valorFinal persistido bate com a soma dos itens realmente vendidos (A escolhida)', orcSalvoDepois.valorFinal, somaItensDistribuidos, 0.02);

  // ── OS/produção nunca vê o cartão embutido (by design) ───────────────
  var itemOSFormatoBruto = orcSalvoDepois.itens.filter(function (it) { return it.grupoOpcao && it.grupoOpcao.selecionada; })[0];
  var totalBrutoOS = cen.parseBRL(itemOSFormatoBruto.total);
  ok('OS/produção usa o total CRU (sem gross-up de cartão) — nunca o preço inflado ao cliente', Math.abs(totalBrutoOS - rawTotalA) < 0.01 && totalBrutoOS < vivoDepois.total);
  ok('_orcEntraNaOperacaoDoRegistro: só a opção A (confirmada) entra em OS/financeiro', mod._orcEntraNaOperacaoDoRegistro(orcSalvoDepois).length === 1 && mod._orcEntraNaOperacaoDoRegistro(orcSalvoDepois)[0].grupoOpcao.selecionada === true);

  // ── "Total Geral" ao cliente: "a definir" antes, valor real depois ──
  ok('Texto do total ANTES da escolha: "a definir..." (nunca um número de opção interna)', mod.orcTextoValorCliente(orcSalvoAntes._pendenteReal, 'R$ 999,00').indexOf('a definir') >= 0);
  ok('Texto do total DEPOIS da escolha: valor real exibido', mod.orcTextoValorCliente(orcSalvoDepois._pendenteReal, 'R$ 999,00') === 'R$ 999,00');

  // ── Opção B (não escolhida) também não "aparece crua" antes da escolha ──
  var vivoAntesB = cen.precoVivo(cen.ITEM_B);
  var pdfAntesB = cen.precoPDF(orcSalvoAntes, cen.ITEM_B);
  testePerto('Opção B (não escolhida): Preview/WhatsApp == PDF também ANTES da escolha', vivoAntesB.total, pdfAntesB.total, 0.01);
  ok('Opção B: preço comercial (nunca cru R$150) mesmo sem ser a confirmada', vivoAntesB.total > 150.5);
})();

console.log('\n' + (failed === 0 ? '✅ TODOS OS TESTES PASSARAM' : '❌ ' + failed + ' TESTE(S) FALHARAM') + ' (' + passed + ' passou/passaram, ' + failed + ' falhou/falharam)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
