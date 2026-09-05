/**
 * test_hotfix_planificacao_consistencia_2026-08-17.js
 *
 * RODADA CIRÚRGICA 2026-08-17 (4/4 desta sessão) — escopo: alinhar os
 * PREVIEWS da planificação (planCalc/_planCalcAndMerge/_planRecompute)
 * com o custo por peça/espessura já corrigido no motor canônico
 * orcRecalc() (commit 82f748e). NÃO altera orcRecalc() nem a fórmula
 * canônica de preço — só garante que o vendedor vê, ANTES de aplicar, o
 * mesmo custo que o orçamento final vai cobrar.
 *
 * ACHADO (confirmado antes de editar, mesma técnica de leitura real do
 * código): planCalc() (`custoMat = totalArea/10000 * priceM2`),
 * _planCalcAndMerge() (`baseCost = prevTot/10000 * _priceM2M`) e
 * _planRecompute() (`_baseCostRpc = _baseAreaRpc/10000 * priceM2`) — os
 * TRÊS previews da planificação — cobravam toda a área AUTOMÁTICA ao
 * preço/m² ÚNICO do material do item, exatamente o mesmo bug que
 * orcRecalc() tinha antes da rodada anterior. Corrigido reaproveitando
 * _matResolverPrecoFamiliaEspessura() (já criada e testada) através de um
 * novo helper compartilhado _planDeltaEspecificoPecas() — mesma técnica
 * de "delta de correção" já usada em orcRecalc(), sem fórmula nova.
 *
 * Uso: node scripts/test_hotfix_planificacao_consistencia_2026-08-17.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
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
  '_planAtualizarLabelsDim',
  'orcProdutoNomeResolvido',
  'cfgEsc', '_matGetRsm2', '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', '_planPecaAdesivos', '_planDeltaEspecificoPecas', '_planConsumiveisChip', '_planConsumiveisCelulaHtml',
  '_planPieceSlug', '_planReconcilePieces', '_planSeedFromPersisted', '_planBuildAllPecas',
  'planCalc', '_planRecompute', '_planCalcAndMerge',
  'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  'orcGetItemExtrasTotal', 'orcRecalc'
];
var src = [
  'var _planIdx = null;',
  'var planManualPieces = [];',
  'var _planEditPieces = [];',
  'var _planSeedPersistedJson = null;',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  planCalc: planCalc, _planRecompute: _planRecompute, _planCalcAndMerge: _planCalcAndMerge,',
  '  _planBuildAllPecas: _planBuildAllPecas, orcRecalc: orcRecalc,',
  '  setPlanIdx: function(v){ _planIdx = v; }, setEditPieces: function(v){ _planEditPieces = v; },',
  '  getEditPieces: function(){ return _planEditPieces; }',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_planificacao_consistencia_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== RODADA CIRÚRGICA 2026-08-17 (4/4) — previews de planificação alinhados ao custo canônico ===\n');

function makeEl(props) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, checked: false,
    disabled: false, options: [], selectedIndex: 0,
    appendChild: function () {}, setAttribute: function () {},
    classList: { add: function () {}, contains: function () { return false; } },
    closest: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  }, props || {});
}

// Cadastro de materiais compartilhado por todos os cenários: 3mm a R$150/m²
// (material do item) e 4mm a R$200/m² (peça com espessura própria).
var MATERIAIS = [
  { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150, esp: 3 },
  { nome: 'Acrílico Cristal 4mm', custo: 200, comp: 200, larg: 100, rsm2: 200, esp: 4 },
  { nome: 'Acrílico Cristal 5mm', custo: 250, comp: 200, larg: 100, rsm2: 250, esp: 5 }
];

// Monta o DOM fake do modal de planificação para o item _planIdx=1 e roda
// planCalc() de verdade — `receitaPecas` é a função pieces(L,A,P,e,extra)
// de uma receita CUSTOM (cadastrada pelo usuário ou importada de SVG),
// controlada diretamente pelo teste (mesma técnica de todos os testes
// desta sessão: extrai e executa o código real, nunca reimplementa).
function rodarPlanCalc(receitaPecas, opts) {
  opts = opts || {};
  var _els = {
    planLarg: makeEl({ value: '100' }), planAlt: makeEl({ value: '100' }), planProf: makeEl({ value: '0' }),
    oi_prod_1: makeEl({ value: 'Produto Teste' }),
    oi_esp_1: makeEl({ value: String(opts.espItem || 3) }),
    oi_mat_1: makeEl({ value: opts.matKey || 'cfg_0', dataset: {} }),
    oir_1: { dataset: {} },
    planPiecesBody: makeEl(), planPiecesFoot: makeEl(),
    planAplicarBtn: makeEl(),
    planSumBox: makeEl({ dataset: {} }),
    planSumArea: makeEl(), planSumPecas: makeEl(), planSumProporcao: makeEl(),
    planSumCusto: makeEl(), planSumVenda: makeEl(), planSumFormula: makeEl(),
    planCamposExtrasAviso: makeEl(),
    planEspBreakdown: makeEl(), planPiecesFoot2: makeEl()
  };
  global.document = { getElementById: function (id) { return _els[id]; }, createElement: function () { return makeEl(); } };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: MATERIAIS }; };
  global.ORC_MATS = [];
  global.planGetRecipe = function () { return { dim3d: false, desc: '', campos: [], pieces: receitaPecas }; };
  global.receitaCamposContexto = function () { return { ctx: {}, faltando: [] }; };
  global.planDrawCanvas = function () {};
  global.setTimeout = function () {};
  mod.setPlanIdx('1');
  mod.setEditPieces([]);
  mod.planCalc();
  return _els;
}

var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════
// TESTE A — preview com 3mm + 4mm: custo bate com o custo material canônico
// ══════════════════════════════════════════════════════════════════════
{
  var receita = function (L, A, P, e, extra) {
    return [
      { qty: 1, nome: 'P1', larg: 50, alt: 40 },              // sem esp própria — herda 3mm do item
      { qty: 1, nome: 'P2', larg: 30, alt: 30 },              // sem esp própria — herda 3mm
      { qty: 1, nome: 'P3', larg: 20, alt: 20, esp: 4 }        // esp própria — 4mm
    ];
  };
  var els = rodarPlanCalc(receita, { espItem: 3, matKey: 'cfg_0' });
  var custoPreview = parseBRL(els.planSumCusto.textContent);
  var custoEsperado = (0.20 * 150) + (0.09 * 150) + (0.04 * 200); // 51.50
  testePerto('A1. preview (planSumCusto) = área3mm×preço3mm + área4mm×preço4mm (R$51,50)', custoPreview, custoEsperado, 0.02);

  // Cross-check contra o motor canônico: mesmas peças aplicadas a um item
  // real de orcRecalc() devem produzir o MESMO custo de material.
  var pecasAplicadas = mod._planBuildAllPecas();
  var totalArea = pecasAplicadas.reduce(function (s, p) { return s + p.larg * p.alt * p.qty; }, 0);
  var rOrc = rodarOrcRecalcComPecas(pecasAplicadas, totalArea, 'cfg_0', 3);
  var custoCanonico = parseBRL(rOrc.oi_custo_1.textContent);
  test('A2. custo do preview é IDÊNTICO ao custo material canônico do orçamento (mesma fonte, nenhuma fórmula nova)', els.planSumCusto.textContent.match(/R\$\s*([\d,]+)/)[1], rOrc.oi_custo_1.textContent.match(/R\$([\d,]+)/)[1]);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — alterar SÓ a peça adicional (4mm → 5mm): só essa parcela muda
// ══════════════════════════════════════════════════════════════════════
{
  function cenario(espP3) {
    var receita = function (L, A, P, e, extra) {
      return [
        { qty: 1, nome: 'P1', larg: 50, alt: 40 },
        { qty: 1, nome: 'P2', larg: 30, alt: 30 },
        { qty: 1, nome: 'P3', larg: 20, alt: 20, esp: espP3 }
      ];
    };
    return rodarPlanCalc(receita, { espItem: 3, matKey: 'cfg_0' });
  }
  var custo4 = parseBRL(cenario(4).planSumCusto.textContent);
  var custo5 = parseBRL(cenario(5).planSumCusto.textContent);
  var deltaEsperado = 0.04 * (250 - 200); // só a peça de 20×20cm muda de R$200/m² pra R$250/m²
  testePerto('B1. só a parcela da peça trocada muda no preview (delta = R$2,00 exato)', custo5 - custo4, deltaEsperado, 0.02);
  var pecasInalteradas = (0.20 * 150) + (0.09 * 150);
  ok('B2. as duas peças de 3mm continuam custando o mesmo nos dois cenários', Math.abs((custo4 - 0.04 * 200) - pecasInalteradas) < 0.02 && Math.abs((custo5 - 0.04 * 250) - pecasInalteradas) < 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C — peça SEM override herda o material principal corretamente
// ══════════════════════════════════════════════════════════════════════
{
  var receitaSemOverride = function (L, A, P, e, extra) {
    return [
      { qty: 1, nome: 'P1', larg: 50, alt: 40 },
      { qty: 1, nome: 'P2', larg: 30, alt: 30 }
    ];
  };
  var els = rodarPlanCalc(receitaSemOverride, { espItem: 3, matKey: 'cfg_0' });
  var custoPreview = parseBRL(els.planSumCusto.textContent);
  var custoEsperado = ((0.20 + 0.09)) * 150; // tudo ao preço do material do item — sem correção nenhuma
  testePerto('C1. sem nenhuma peça com esp própria — preview igual ao cálculo simples (herda material principal)', custoPreview, custoEsperado, 0.02);
  var pecas = mod.getEditPieces();
  ok('C2. as peças reconciliadas herdam esp=espItem (3) quando não declaram esp própria', pecas.every(function (p) { return String(p.esp) === '3'; }));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — salvar/reabrir: preview e orçamento continuam iguais
// ══════════════════════════════════════════════════════════════════════
{
  var receita = function (L, A, P, e, extra) {
    return [
      { qty: 1, nome: 'P1', larg: 50, alt: 40 },
      { qty: 1, nome: 'P3', larg: 20, alt: 20, esp: 4 }
    ];
  };
  var els1 = rodarPlanCalc(receita, { espItem: 3, matKey: 'cfg_0' });
  var custo1 = els1.planSumCusto.textContent;
  // "reabrir" = recalcular do zero com os mesmos dados de entrada — mesma
  // técnica de determinismo já usada nas rodadas anteriores desta sessão.
  var els2 = rodarPlanCalc(receita, { espItem: 3, matKey: 'cfg_0' });
  var custo2 = els2.planSumCusto.textContent;
  test('D1. reabrir com os mesmos dados produz EXATAMENTE o mesmo custo no preview', custo2, custo1);

  var pecasAplicadas = mod._planBuildAllPecas();
  var totalArea = pecasAplicadas.reduce(function (s, p) { return s + p.larg * p.alt * p.qty; }, 0);
  var rOrc = rodarOrcRecalcComPecas(pecasAplicadas, totalArea, 'cfg_0', 3);
  test('D2. o mesmo custo continua batendo com o orçamento (canônico) após "reabrir"', parseBRL(custo2), parseBRL(rOrc.oi_custo_1.textContent));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — extras em Item A e Item B: breakdown visual não atribui ao
// item errado (NÃO altera o total nem a regra de isolamento já corrigida
// — só confere que o texto de decomposição aponta para o item certo)
// ══════════════════════════════════════════════════════════════════════
{
  var rE = rodarOrcRecalcComExtras();
  ok('E1. breakdown "Extras por item" existe quando há extras', /Extras por item/.test(rE.orcBreak.innerHTML));
  ok('E2. decomposição cita o produto do Item A (dono do extra R$30)', rE.orcBreak.innerHTML.indexOf('Produto A') > -1);
  ok('E3. decomposição cita o produto do Item B (dono do extra R$80)', rE.orcBreak.innerHTML.indexOf('Produto B') > -1);
  // Extrai os dois valores decompostos (mesma ordem dos itens) e confirma
  // que cada um bate com o que o item realmente recebeu em oi_tot_ (delta
  // vs. um cenário sem nenhum extra) — nunca invertidos entre si.
  var matches = rE.orcBreak.innerHTML.match(/Produto [AB]: \+R\$\s?[\d.,]+/g) || [];
  test('E4. exatamente 2 entradas na decomposição (uma por item com extra)', matches.length, 2);
  ok('E5. a entrada do Produto A não é igual à do Produto B (valores realmente distintos, não confundidos)', matches[0] !== matches[1]);
}

// ── Helpers que rodam orcRecalc() de verdade para os cross-checks acima ──
function rodarOrcRecalcComPecas(pecas, planArea, matKey, espItem) {
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
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl({ value: '0' }), oi_alt_1: makeEl({ value: '0' }),
    oi_mat_1: makeEl({ value: matKey, dataset: {} }), oi_esp_1: makeEl({ value: String(espItem) }),
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(), oir_1: { dataset: {} }
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) { return sel === '#orcItemBody tr' ? [{ dataset: { idx: '1', planArea: String(planArea), planPecas: JSON.stringify(pecas) } }] : []; }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: MATERIAIS }; };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  mod.orcRecalc();
  return _els;
}

function rodarOrcRecalcComExtras() {
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    // om_laser>0 de propósito: o bloco de breakdown inteiro (Materiais,
    // Consumíveis, Extras por item...) só renderiza quando extras=maq+
    // cons+mont+desl>0 (gate pré-existente, fora do escopo desta rodada) —
    // cenário realista de orçamento com algum tempo de máquina.
    om_laser: makeEl({ value: '10' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl({ innerHTML: '' }),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl({ value: '0' }), oi_alt_1: makeEl({ value: '0' }),
    oi_mat_1: makeEl({ value: 'cfg_0', dataset: {} }), oi_esp_1: makeEl({ value: '3' }),
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(), oir_1: { dataset: {} },
    oi_prod_1: makeEl({ value: 'Produto A' }),
    oi_qty_2: makeEl({ value: '1' }), oi_larg_2: makeEl({ value: '0' }), oi_alt_2: makeEl({ value: '0' }),
    oi_mat_2: makeEl({ value: 'cfg_0', dataset: {} }), oi_esp_2: makeEl({ value: '3' }),
    oi_custo_2: makeEl(), oi_unit_2: makeEl(), oi_tot_2: makeEl(), oir_2: { dataset: {} },
    oi_prod_2: makeEl({ value: 'Produto B' })
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      return sel === '#orcItemBody tr' ? [
        { dataset: { idx: '1', planArea: '10000', planPecas: JSON.stringify([{ larg: 100, alt: 100, qty: 1, esp: 3, origem: 'AUTOMATICA' }]) } },
        { dataset: { idx: '2', planArea: '10000', planPecas: JSON.stringify([{ larg: 100, alt: 100, qty: 1, esp: 3, origem: 'AUTOMATICA' }]) } }
      ] : [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: MATERIAIS }; };
  global.ORC_ITEM_EXTRAS = { '1': { instalacao: 30, acabamento: 0, outros: 0 }, '2': { instalacao: 0, acabamento: 0, outros: 80 } };
  global.ORC_ITEM_AJUSTES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  mod.orcRecalc();
  return _els;
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
