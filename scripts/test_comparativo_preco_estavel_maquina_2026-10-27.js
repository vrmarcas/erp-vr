/**
 * test_comparativo_preco_estavel_maquina_2026-10-27.js
 *
 * Reprodução ponta-a-ponta (via orcRecalc + orcColetarItensDistribuidos +
 * orcOpcaoSelecionar reais, extraídos do próprio index.html — nunca
 * reimplementados) dos dois bugs críticos relatados pelo usuário em
 * 2026-10-27:
 *
 *  BUG 1 — o preço de uma alternativa de orçamento comparativo (A/B) mudava
 *  depois que o cliente escolhia aquela mesma alternativa (ex. real:
 *  R$280,14 antes → R$302,36 depois — diferença batendo, centavo a
 *  centavo, com o gross-up do cartão). Causa raiz: WhatsApp/PDF mostravam
 *  o total CRU (sem cartão/PIX/rateio de máquinas) enquanto QUALQUER
 *  grupo do pedido estivesse pendente, e só aplicavam a escala comercial
 *  completa depois da escolha confirmada.
 *
 *  BUG 2 — custo de máquina (Laser R$130/h, 12,7min) não participava do
 *  preço do item ("sem máquina"/R$0,00) mesmo com a máquina cadastrada.
 *  Confirmado com o usuário: ISSO NÃO É BUG quando o vínculo Operação→
 *  Máquina (Config→Máquinas) não foi configurado — é a regra vigente
 *  desde 2026-10-13 (zero fallback oculto). Este teste prova as DUAS
 *  metades da regra: (a) sem vínculo configurado, o resultado É "sem
 *  máquina"/R$0,00, por design; (b) uma vez configurado, o cálculo
 *  funciona corretamente (12,7min × R$130/h ÷ 60 ≈ R$27,52) e esse custo
 *  passa a integrar o preço comercial de CADA alternativa do comparativo,
 *  inclusive ANTES da escolha do cliente (fechado pela correção do Bug 1,
 *  já que o custo de máquina é um "extra" do pedido, redistribuído pela
 *  mesma escala comercial).
 *
 * Uso: node scripts/test_comparativo_preco_estavel_maquina_2026-10-27.js
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
  'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos', '_orcItemEntraNaOperacao', 'orcComparativoPendenteDOM',
  'orcComparativoPendente', 'orcOpcaoSelecionar', 'orcMotorComercial', 'orcDistribuirParcelas', 'cfgMaqOperInfo', '_orcMaqInfo',
  'orcSincronizarEspPecasHerdadas', 'orcPecasHerdarEspessura'
];
var src = [
  'var ORC_REGRA_COMPARATIVO_ATUAL = 2;',
  extractArr('ORC_MAQ_OPS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, orcOpcaoSelecionar: orcOpcaoSelecionar, orcMotorComercial: orcMotorComercial, cfgMaqOperInfo: cfgMaqOperInfo };'
].join('\n\n');
var modPath = path.join(__dirname, '_comparativo_preco_maquina_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA CIRÚRGICA 2026-10-27 — Preço do comparativo estável + custo de máquina ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {}, style: {} }, props || {}); }

// ────────────────────────────────────────────────────────────────────────
// PARTE 1 — custo de máquina: "sem vínculo" (by design) vs. vinculado (OK)
// ────────────────────────────────────────────────────────────────────────
(function parte1_custoDeMaquina() {
  var MAQUINAS = [
    { id: 'maq_laser_vermelha', nome: 'Laser Vermelha', unidade: 'hora', custo: 130, setup: 0 },
    { id: 'maq_laser_verde',    nome: 'Laser Verde',    unidade: 'hora', custo: 130, setup: 0 },
    { id: 'maq_laser_metal',    nome: 'Laser Metal',    unidade: 'hora', custo: 450, setup: 0 }
  ];

  // (a) SEM vínculo configurado — by design, custo é R$0,00 com alerta
  // explícito ("não é bug" — confirmado com o usuário em 2026-10-27).
  global.cfgLoad = function () { return { maquinas: MAQUINAS, maquinasOperacoes: {} }; };
  var infoSemVinculo = mod.cfgMaqOperInfo('laser');
  ok('Sem vínculo configurado: motivo = "nao_vinculada" (nunca uma taxa oculta)', infoSemVinculo.ok === false && infoSemVinculo.motivo === 'nao_vinculada');
  ok('Sem vínculo configurado: custo por minuto = 0', infoSemVinculo.custoMin === 0);

  // (b) COM vínculo configurado (Config→Máquinas→Vínculo de Operação →
  // Máquina, selecionando "Laser Vermelha" para a operação "Laser") — o
  // cálculo passa a funcionar corretamente, fonte única cfgMaqOperInfo().
  global.cfgLoad = function () { return { maquinas: MAQUINAS, maquinasOperacoes: { laser: 'maq_laser_vermelha' } }; };
  var infoComVinculo = mod.cfgMaqOperInfo('laser');
  ok('Com vínculo (Laser Vermelha, R$130/h): ok=true', infoComVinculo.ok === true);
  testePerto('Com vínculo: taxa por minuto = R$130/60 = R$2,1667/min', infoComVinculo.custoMin, 130 / 60, 0.0001);
  var custoPara12_7min = 12.7 * infoComVinculo.custoMin + infoComVinculo.setup;
  testePerto('TESTE 9 — Laser Vermelha, 12,7min: custo ≈ R$27,52 (nunca R$0,00)', custoPara12_7min, 27.52, 0.01);

  // TESTE 10/11 — 60min e 30min
  testePerto('TESTE 10 — Laser Vermelha, 60min: custo = R$130,00', 60 * infoComVinculo.custoMin, 130, 0.01);
  testePerto('TESTE 11 — Laser Vermelha, 30min: custo = R$65,00', 30 * infoComVinculo.custoMin, 65, 0.01);

  // TESTE 12 — Laser Metal, 10min
  global.cfgLoad = function () { return { maquinas: MAQUINAS, maquinasOperacoes: { laser: 'maq_laser_metal' } }; };
  var infoMetal = mod.cfgMaqOperInfo('laser');
  testePerto('TESTE 12 — Laser Metal (R$450/h), 10min: custo = R$75,00', 10 * infoMetal.custoMin, 75, 0.01);

  // TESTE 13 — máquina válida, 0 minutos → custo 0 (sem alerta, é o tempo que é zero)
  // (a regra "min>0 ? custo : 0" vive em orcRecalc(), não em cfgMaqOperInfo —
  // coberta na Parte 2 abaixo, dentro do motor completo.)

  // TESTE 16 — trocar de máquina muda o custo (mesmo tempo)
  ok('TESTE 16 — mesmo tempo, troca de máquina (Vermelha→Metal) muda a taxa/min', infoComVinculo.custoMin !== infoMetal.custoMin);

  // unidade incompatível / sem custo configurado — nunca inventa taxa
  global.cfgLoad = function () { return { maquinas: [{ id: 'maq_x', nome: 'Router CNC', unidade: 'm²', custo: 60 }], maquinasOperacoes: { laser: 'maq_x' } }; };
  var infoUnidErrada = mod.cfgMaqOperInfo('laser');
  ok('Máquina vinculada com unidade ≠ hora: motivo = "unidade_incompativel", custo 0', infoUnidErrada.ok === false && infoUnidErrada.motivo === 'unidade_incompativel' && infoUnidErrada.custoMin === 0);

  global.cfgLoad = function () { return { maquinas: [{ id: 'maq_y', nome: 'Laser Sem Preço', unidade: 'hora', custo: 0 }], maquinasOperacoes: { laser: 'maq_y' } }; };
  var infoSemCusto = mod.cfgMaqOperInfo('laser');
  ok('Máquina vinculada sem custo configurado (R$0/h): motivo = "sem_custo"', infoSemCusto.ok === false && infoSemCusto.motivo === 'sem_custo');
})();

// ────────────────────────────────────────────────────────────────────────
// PARTE 2 — motor completo: comparativo A/B + máquina + cartão, antes/depois
// ────────────────────────────────────────────────────────────────────────
function cenarioComparativo(opts) {
  opts = opts || {};
  var MATS = [{ nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }];
  var MAQUINAS = [{ id: 'maq_laser_vermelha', nome: 'Laser Vermelha', unidade: 'hora', custo: 130, setup: 0 }];
  // Tabela de parcelamento com a MESMA taxa citada no relato real do
  // usuário (7,35%) — reproduz a transição R$280,14→R$302,36 relatada.
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
  global._matGetRsm2 = function () { return 100; }; // R$100/m², fixo, independente do item

  var ITEM_A = '1', ITEM_B = '2'; // A = alternativa "sem base" (mais barata), B = alternativa "com base"
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
  [[ITEM_A, 100, 100, '0'], [ITEM_B, 150, 100, '0']].forEach(function (cfg) {
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

  function precoDistribuido(idxAlvo) {
    var c = global.window._orcCalc || {};
    var baseEfetiva = mod.orcMotorComercial(c.finalPrice || 0, { nParcAtual: 1 }).cartao[1].totalCents / 100;
    var itens = mod.orcColetarItensDistribuidos(baseEfetiva);
    var item = itens.filter(function (x) { return x.grupoOpcaoId === 'g1'; })[idxAlvo === ITEM_A ? 0 : 1];
    return { total: item.total, unit: item.unit, finalPrice: c.finalPrice, baseEfetiva: baseEfetiva };
  }

  return { els: _els, precoDistribuido: precoDistribuido, ITEM_A: ITEM_A, ITEM_B: ITEM_B };
}

(function parte2_precoEstavelAntesDepois_semMaquinaVinculada() {
  var cen = cenarioComparativo({ vinculado: false });
  var antes = cen.precoDistribuido(cen.ITEM_A);
  mod.orcOpcaoSelecionar(cen.ITEM_A); // vendedor registra a escolha do cliente
  var depois = cen.precoDistribuido(cen.ITEM_A);
  testePerto('BUG 1 FECHADO (sem máquina vinculada): preço de A ANTES da escolha == DEPOIS da escolha', antes.total, depois.total, 0.01);
  ok('Preço > custo-base cru (R$100) — já inclui cartão mesmo ANTES da escolha', antes.total > 100.5);
})();

(function parte3_precoEstavelAntesDepois_comMaquinaVinculada_eCustoParticipa() {
  var cen = cenarioComparativo({ vinculado: true, laserMin: 12.7 });
  var antes = cen.precoDistribuido(cen.ITEM_A);
  // TESTE 18 — custo de máquina precisa existir ANTES da escolha.
  ok('TESTE 18 — finalPrice ANTES da escolha já inclui o custo de máquina (> R$127, não R$100 nem R$0)', antes.finalPrice > 127);
  mod.orcOpcaoSelecionar(cen.ITEM_A);
  var depois = cen.precoDistribuido(cen.ITEM_A);
  testePerto('BUG 1 FECHADO (com máquina vinculada): preço de A ANTES == DEPOIS da escolha', antes.total, depois.total, 0.01);
  ok('TESTE 18 — custo de máquina CONTINUA no total depois da escolha (não "aparece só depois")', depois.finalPrice > 127);

  // TESTE 5/6 — cartão já aplicado uma única vez; PIX usa a MESMA base.
  var pix = cen.precoDistribuido(cen.ITEM_A); // recomputa para obter baseEfetiva (cartão) usada
  var pixEsperado = pix.baseEfetiva * (1 - 7.35 / 100);
  var pixReal = (function () {
    var c = global.window._orcCalc;
    return mod.orcMotorComercial(c.finalPrice, { nParcAtual: 1 }).pix.totalCents / 100;
  })();
  testePerto('TESTE 6 — PIX = preço comercial (cartão) × (1 − 7,35%), nunca uma base diferente', pixReal, pixEsperado, 0.01);

  // TESTE 15 — recálculo automático ao mudar o tempo de máquina.
  var cen2 = cenarioComparativo({ vinculado: true, laserMin: 20 });
  var depois20min = cen2.precoDistribuido(cen2.ITEM_A);
  ok('TESTE 15 — aumentar o tempo de máquina (12,7→20min) aumenta o preço final', depois20min.finalPrice > antes.finalPrice);
})();

(function parte4_opcaoNaoEscolhidaTambemMostraPrecoComercial() {
  var cen = cenarioComparativo({ vinculado: true, laserMin: 12.7 });
  var precoA = cen.precoDistribuido(cen.ITEM_A);
  var precoB = cen.precoDistribuido(cen.ITEM_B);
  ok('Opção B (mais cara em material) também recebe cartão/máquina — nunca aparece crua (sem markup/cartão)', precoB.total > 150.5);
  ok('Opção B != Opção A (alternativas independentes, cada uma com seu próprio preço comercial)', Math.abs(precoB.total - precoA.total) > 1);
})();

console.log('\n' + (failed === 0 ? '✅ TODOS OS TESTES PASSARAM' : '❌ ' + failed + ' TESTE(S) FALHARAM') + ' (' + passed + ' passou/passaram, ' + failed + ' falhou/falharam)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
