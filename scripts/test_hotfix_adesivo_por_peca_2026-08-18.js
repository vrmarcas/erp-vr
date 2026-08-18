/**
 * test_hotfix_adesivo_por_peca_2026-08-18.js
 *
 * RODADA 5 (1/2) — Adesivo/Adh. Branco migrado de toggle GLOBAL do
 * orçamento inteiro (oc_adh/oc_adhb) para seleção POR PEÇA dentro da
 * planificação. Custo entra na fórmula do consumível só pela área da(s)
 * peça(s) marcada(s) — nunca a área total do item — preservando o preço/cm²
 * já fixado (Rodada 1, f828a8c). O toggle global vira fallback legado: só
 * é usado quando ligado explicitamente ('sim'), preservando 100% o
 * comportamento de orçamentos antigos salvos antes desta rodada.
 *
 * Uso: node scripts/test_hotfix_adesivo_por_peca_2026-08-18.js
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

var FN_NAMES = ['cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  '_matResolverPrecoFamiliaEspessura', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos',
  '_planReconcilePieces', '_planSeedFromPersisted', '_planPieceSlug', '_planBuildAllPecas', 'osProjecaoOperacionalItem'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, ' +
  '_planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, ' +
  '_planBuildAllPecas: _planBuildAllPecas, osProjecaoOperacionalItem: osProjecaoOperacionalItem };'
].join('\n\n');
var modPath = path.join(__dirname, '_adesivo_por_peca_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 5 (1/2) — Adesivo/Adh. Branco por peça ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// Cenário "Caixa" — 6 peças reais (Tampa/Base/2×Lateral/Frente/Fundo),
// mesmo molde citado pelo usuário na rodada. Áreas em cm².
function caixaPecas(overrides) {
  overrides = overrides || {};
  var base = [
    { nome: 'Tampa',   qty: 1, larg: 40, alt: 30, esp: '3', origem: 'AUTOMATICA' }, // 1200 cm²
    { nome: 'Base',    qty: 1, larg: 40, alt: 30, esp: '3', origem: 'AUTOMATICA' }, // 1200 cm²
    { nome: 'Lateral', qty: 2, larg: 30, alt: 20, esp: '3', origem: 'AUTOMATICA' }, // 2×600=1200 cm²
    { nome: 'Frente',  qty: 1, larg: 40, alt: 20, esp: '3', origem: 'AUTOMATICA' }, // 800 cm²
    { nome: 'Fundo',   qty: 1, larg: 40, alt: 20, esp: '3', origem: 'AUTOMATICA' }  // 800 cm²
  ];
  base.forEach(function(p){ if (overrides[p.nome] !== undefined) p.adesivo = overrides[p.nome]; });
  return base;
}
function areaPlan(pecas) {
  return pecas.reduce(function(s,p){ return s + p.larg*p.alt*p.qty; }, 0);
}

function rodarCenario(opts) {
  opts = opts || {};
  var materiaisCatalogo = opts.materiaisCatalogo || [
    { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150, esp: 3 }
  ];
  var itens = opts.itens || [];
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: opts.ocAdh || 'nao' }), oc_adhb: makeEl({ value: opts.ocAdhb || 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
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
    _els['oir_' + it.idx] = { dataset: { idx: it.idx, planArea: String(planArea), planPecas: JSON.stringify(it.pecas || []) } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return itens.map(function (it) { return { dataset: _els['oir_' + it.idx].dataset }; });
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: materiaisCatalogo, financeiro: {} }; };
  global._matGetRsm2 = function (matKey) {
    var m = materiaisCatalogo.find(function (mm) { return mm.nome && ('cfg_' + materiaisCatalogo.indexOf(mm)) === matKey; });
    return m ? m.rsm2 : 100;
  };
  global.ORC_ITEM_EXTRAS = opts.itemExtras || {};
  global.ORC_ITEM_AJUSTES = opts.ajustes || {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.window._orcAdhPrecoSnapshot = null; // orçamento novo — sem snapshot histórico
  mod.orcRecalc();
  return _els;
}

var ADH = 0.0056, ADHB = 0.0011; // fallback hardcoded (sem financeiro.adesivo*PrecoCm2 configurado no cenário)

// ══════════════════════════════════════════════════════════════════════
// TESTE A — Caixa 6 peças, adesivo SÓ na Tampa: só a área da Tampa entra
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: 'normal' });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  var esperado = 1200 * ADH; // só a Tampa (1200 cm²)
  testePerto('A1. adesivo cobra só a área da Tampa (1200cm²), não a área total do item (5200cm²)', parseBRL(r.ocv_adh.textContent), esperado, 0.01);
  ok('A2. NÃO é a aproximação errada (área total × preço)', Math.abs(parseBRL(r.ocv_adh.textContent) - 5200*ADH) > 0.5);
  ok('A3. Adh. Branco continua zerado (nenhuma peça marcada branco)', parseBRL(r.ocv_adhb.textContent) === 0);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — Tampa + Base marcadas: soma das duas áreas
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: 'normal', Base: 'normal' });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  var esperado = (1200 + 1200) * ADH;
  testePerto('B1. Tampa+Base marcadas — soma exata das duas áreas (2400cm²)', parseBRL(r.ocv_adh.textContent), esperado, 0.01);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C — Tampa=normal, Base=branco: cada uma com o preço/cm² próprio
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: 'normal', Base: 'branco' });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  testePerto('C1. Tampa (normal) usa preço do Adesivo normal (R$0,0056/cm²)', parseBRL(r.ocv_adh.textContent), 1200*ADH, 0.01);
  testePerto('C2. Base (branco) usa preço do Adh. Branco (R$0,0011/cm²), NUNCA misturado com o normal', parseBRL(r.ocv_adhb.textContent), 1200*ADHB, 0.01);
  ok('C3. os dois valores são diferentes (preços distintos aplicados corretamente)', Math.abs(parseBRL(r.ocv_adh.textContent) - parseBRL(r.ocv_adhb.textContent)) > 1);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — qty>1 multiplica corretamente
// ══════════════════════════════════════════════════════════════════════
{
  var pecasQty1 = caixaPecas({ Tampa: 'normal' });
  var pecasQty3 = caixaPecas({ Tampa: 'normal' });
  var r1 = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasQty1 }] });
  var r3 = rodarCenario({ itens: [{ idx: '1', qty: 3, matKey: 'cfg_0', espItem: 3, pecas: pecasQty3 }] });
  testePerto('D1. qty=3 cobra exatamente 3× o adesivo de qty=1', parseBRL(r3.ocv_adh.textContent), parseBRL(r1.ocv_adh.textContent) * 3, 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — salvar/reabrir preserva a configuração por peça
// ══════════════════════════════════════════════════════════════════════
{
  // E1 — _planReconcilePieces preserva `adesivo` do estado anterior em
  // memória mesmo quando a receita fresca não o carrega (edição de
  // larg/alt/qty não pode apagar o campo).
  global._planEditPieces = [
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', tipo: '', adesivo: 'branco', _deleted: false }
  ];
  var freshPieces = [{ nome: 'Tampa', qty: 1, larg: 42, alt: 30, esp: '3', tipo: '' }]; // larg mudou (usuário editou)
  var reconciliado = mod._planReconcilePieces(freshPieces, 3);
  test('E1. _planReconcilePieces preserva adesivo="branco" mesmo após editar largura', reconciliado[0].adesivo, 'branco');

  // E2 — _planSeedFromPersisted (reabertura real do orçamento) restaura
  // `adesivo` a partir do JSON persistido em row.dataset.planPecas.
  var persistedJson = JSON.stringify([
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', espessuraMm: 3, tipo: '', adesivo: 'normal', origem: 'AUTOMATICA' },
    { id: 'auto_base', nome: 'Base', qty: 1, larg: 40, alt: 30, esp: '3', espessuraMm: 3, tipo: '', adesivo: '', origem: 'AUTOMATICA' }
  ]);
  var freshPieces2 = [{ nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', tipo: '' }, { nome: 'Base', qty: 1, larg: 40, alt: 30, esp: '3', tipo: '' }];
  var seeded = mod._planSeedFromPersisted(freshPieces2, persistedJson, 3);
  test('E2. _planSeedFromPersisted restaura adesivo="normal" da Tampa ao reabrir', seeded[0].adesivo, 'normal');
  test('E3. _planSeedFromPersisted restaura peça sem adesivo (Base) como vazia', seeded[1].adesivo, '');

  // E4 — determinismo ponta-a-ponta: rodar orcRecalc() duas vezes com o
  // MESMO planPecas restaurado (== reabrir) produz o mesmo valor de adesivo.
  var pecasE = caixaPecas({ Tampa: 'normal', Base: 'branco' });
  var cenarioOpts = { itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasE }] };
  var rA = rodarCenario(cenarioOpts);
  var rB = rodarCenario(cenarioOpts); // "reabrir" = restaurar os mesmos dados e recalcular
  test('E4. reabrir com o mesmo planPecas restaurado produz o MESMO adh/adhb', { adh: rA.ocv_adh.textContent, adhb: rA.ocv_adhb.textContent }, { adh: rB.ocv_adh.textContent, adhb: rB.ocv_adhb.textContent });
}

// ══════════════════════════════════════════════════════════════════════
// TESTE F — gerar OS preserva o snapshot técnico de qual peça tem adesivo
// ══════════════════════════════════════════════════════════════════════
{
  var pecasF = caixaPecas({ Tampa: 'normal', Base: 'branco' });
  var itemOrcamento = {
    tipoItem: 'personalizado_vr', prod: 'Caixa', qty: 1, larg: 0, alt: 0,
    pieces: pecasF, planArea: areaPlan(pecasF), det: ''
  };
  var seguro = mod.osProjecaoOperacionalItem(itemOrcamento);
  ok('F1. osProjecaoOperacionalItem() propaga pieces com o campo adesivo intacto', Array.isArray(seguro.pieces) && seguro.pieces.filter(function(p){ return p.adesivo==='normal'||p.adesivo==='branco'; }).length === 2);
  test('F2. Tampa chega na OS com adesivo="normal"', seguro.pieces.find(function(p){return p.nome==='Tampa';}).adesivo, 'normal');
  test('F3. Base chega na OS com adesivo="branco"', seguro.pieces.find(function(p){return p.nome==='Base';}).adesivo, 'branco');
  ok('F4. osProjecaoOperacionalItem() nunca inclui preço/custo/margem (whitelist só técnica)', !('unit' in seguro) && !('total' in seguro) && !('custo' in seguro) && !('matCost' in seguro));

  // F5 — bug pré-existente corrigido: kbAbrirPlanificacaoItem() tem que
  // priorizar it.pieces (peças REAIS calculadas, com `adesivo`) sobre
  // recipeSnapshot.pecas (fórmulas cruas da receita, sem `adesivo`).
  var kbSrc = extractFn('kbAbrirPlanificacaoItem');
  ok('F5. kbAbrirPlanificacaoItem() prioriza it.pieces sobre recipeSnapshot.pecas (mesma ordem de osItemMateriaisResumo)', /var pecas = \(it\.pieces && it\.pieces\.length\) \? it\.pieces : /.test(kbSrc));
  ok('F6. kbAbrirPlanificacaoItem() exibe o campo adesivo na tabela de peças da OS/Kanban', /p\.adesivo/.test(kbSrc));
  ok('F7. a coluna Adesivo na OS/Kanban nunca mostra preço (só rótulo textual ⬜/🩹/—)', !/adhPrecoCm2|R\$.*adesivo/i.test(kbSrc));
}

// ══════════════════════════════════════════════════════════════════════
// REGRESSÃO — compatibilidade retroativa: orçamento antigo (toggle global
// 'sim', NENHUMA peça com campo `adesivo`) continua cobrando a área TOTAL
// exatamente como antes desta rodada — o global nunca vira "e mais peça".
// ══════════════════════════════════════════════════════════════════════
{
  var pecasAntigas = caixaPecas({}); // nenhuma peça marcada
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasAntigas }] }, );
  r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasAntigas }], ocAdh: 'sim', ocAdhb: 'sim' });
  var areaTotalEsperada = areaPlan(pecasAntigas); // 5200 cm²
  testePerto('R1. orçamento antigo com toggle global "sim" cobra a ÁREA TOTAL do item (comportamento histórico preservado)', parseBRL(r.ocv_adh.textContent), areaTotalEsperada*ADH, 0.02);
  testePerto('R2. idem para Adh. Branco', parseBRL(r.ocv_adhb.textContent), areaTotalEsperada*ADHB, 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// REGRESSÃO — nenhum toggle ligado e nenhuma peça marcada = R$0,00 (igual
// ao comportamento de sempre quando o consumível não é usado)
// ══════════════════════════════════════════════════════════════════════
{
  var pecasNada = caixaPecas({});
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasNada }] });
  ok('R3. sem toggle global e sem peça marcada — adesivo = R$0,00', parseBRL(r.ocv_adh.textContent) === 0 && parseBRL(r.ocv_adhb.textContent) === 0);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
