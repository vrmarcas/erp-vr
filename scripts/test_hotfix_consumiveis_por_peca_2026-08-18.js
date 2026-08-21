/**
 * test_hotfix_consumiveis_por_peca_2026-08-18.js
 *
 * RODADA 6 — Consumíveis (Adesivo, Adh. Branco, Gravação, Spray, Extra)
 * reorganizados para pertencer à PEÇA da planificação, não mais ao
 * orçamento inteiro. Gravação já tinha regra própria (custo×2 fora do
 * markup, Rodada 1); Spray e Extra passam a seguir a MESMA regra nesta
 * rodada (antes: dentro do markup geral). "Só Corte" NÃO é consumível —
 * é modo de precificação global do pedido — e permanece intocado. A
 * seção "Consumíveis" foi removida do modal "⚙️ Custos" e ocultada do
 * Step 3 (mantida só como fallback de leitura para orçamentos legados).
 *
 * Uso: node scripts/test_hotfix_consumiveis_por_peca_2026-08-18.js
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
  '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', '_planPecaAdesivos', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos',
  '_planReconcilePieces', '_planSeedFromPersisted', '_planPieceSlug', '_planBuildAllPecas', 'osProjecaoOperacionalItem'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, ' +
  '_planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, ' +
  '_planBuildAllPecas: _planBuildAllPecas, osProjecaoOperacionalItem: osProjecaoOperacionalItem };'
].join('\n\n');
var modPath = path.join(__dirname, '_consumiveis_por_peca_extracted.tmp.js');
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

var ADH = 0.0056, ADHB = 0.0011;

// ══════════════════════════════════════════════════════════════════════
// TESTE A — Adesivo por peça (regressão: continua funcionando após a
// reestruturação do orcRecalc desta rodada)
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: { adesivo: 'normal' } });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  testePerto('A1. Adesivo cobra só a área da Tampa (1200cm²)', parseBRL(r.ocv_adh.textContent), 1200*ADH, 0.01);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — Adesivo Branco por peça (regressão)
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Base: { adesivo: 'branco' } });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  testePerto('B1. Adh. Branco cobra só a área da Base (1200cm²)', parseBRL(r.ocv_adhb.textContent), 1200*ADHB, 0.01);
  ok('B2. Adesivo normal continua zerado (nenhuma peça marcada normal)', parseBRL(r.ocv_adh.textContent) === 0);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C — Gravação R$20 → +R$40 no preço final; markup NÃO incide
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: { gravacao: 20 } });
  // factor<1 (overhead 41.16% + vrml 20%) para provar que o markup NÃO
  // multiplica a Gravação — se incidisse, o incremento seria bem maior que R$40.
  var semG = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: caixaPecas({}) }], overhead: 41.16, vrml: 20 });
  var comG = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }], overhead: 41.16, vrml: 20 });
  var delta = parseBRL(comG.orcTotalVal.textContent) - parseBRL(semG.orcTotalVal.textContent);
  testePerto('C1. Gravação R$20 numa peça soma EXATAMENTE +R$40 ao total (custo×2, sem markup)', delta, 40, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — Spray R$10 → +R$20; markup NÃO incide (regra NOVA desta rodada)
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: { spray: 10 } });
  var semS = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: caixaPecas({}) }], overhead: 41.16, vrml: 20 });
  var comS = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }], overhead: 41.16, vrml: 20 });
  var delta = parseBRL(comS.orcTotalVal.textContent) - parseBRL(semS.orcTotalVal.textContent);
  testePerto('D1. Spray R$10 numa peça soma EXATAMENTE +R$20 ao total (custo×2, sem markup)', delta, 20, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — Extra R$15 → +R$30; markup NÃO incide (regra NOVA desta rodada)
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({ Tampa: { extra: 15 } });
  var semE = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: caixaPecas({}) }], overhead: 41.16, vrml: 20 });
  var comE = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }], overhead: 41.16, vrml: 20 });
  var delta = parseBRL(comE.orcTotalVal.textContent) - parseBRL(semE.orcTotalVal.textContent);
  testePerto('E1. Extra R$15 numa peça soma EXATAMENTE +R$30 ao total (custo×2, sem markup)', delta, 30, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE F — combinação: Tampa (Adesivo normal + Spray), Base (Adesivo
// Branco), Lateral (Gravação) — cada parcela e o total corretos
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = caixaPecas({
    Tampa:   { adesivo: 'normal', spray: 10 },
    Base:    { adesivo: 'branco' },
    Lateral: { gravacao: 20 }
  });
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecas }] });
  testePerto('F1. Adesivo normal (Tampa, 1200cm²)', parseBRL(r.ocv_adh.textContent), 1200*ADH, 0.01);
  testePerto('F2. Adh. Branco (Base, 1200cm²)', parseBRL(r.ocv_adhb.textContent), 1200*ADHB, 0.01);
  testePerto('F3. Custo de Gravação exibido = R$20 (custo, não venda)', parseBRL(r.ocv_imp.textContent), 20, 0.02);
  testePerto('F4. Custo de Spray exibido = R$10 (custo, não venda)', parseBRL(r.ocv_spray.textContent), 10, 0.02);
  var matTotalF = (areaPlan(pecas)/10000) * 150; // 0,52m² × R$150/m² = R$78 (material da caixa inteira, sempre cobrado)
  var esperadoTotal = matTotalF + 1200*ADH + 1200*ADHB + 20*2 + 10*2; // adesivos entram no markup (factor=1 aqui), gravação/spray somam ×2 direto
  testePerto('F5. TOTAL do pedido bate com material + soma de todas as parcelas de consumível', parseBRL(r.orcTotalVal.textContent), esperadoTotal, 0.05);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE G — remover todos os consumíveis: preço volta ao estado anterior
// ══════════════════════════════════════════════════════════════════════
{
  var base = { itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: caixaPecas({}) }] };
  var antes = rodarCenario(base);
  var pecasComTudo = caixaPecas({ Tampa: { adesivo: 'normal', gravacao: 20, spray: 10, extra: 15 } });
  var depoisComTudo = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasComTudo }] });
  ok('G1. Com consumíveis configurados, o total é MAIOR que o estado base', parseBRL(depoisComTudo.orcTotalVal.textContent) > parseBRL(antes.orcTotalVal.textContent));
  var pecasRemovidas = caixaPecas({ Tampa: { adesivo: '', gravacao: 0, spray: 0, extra: 0 } });
  var depoisRemovido = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasRemovidas }] });
  test('G2. Removendo todos os consumíveis, o total volta EXATAMENTE ao estado anterior', depoisRemovido.orcTotalVal.textContent, antes.orcTotalVal.textContent);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE H — salvar/reabrir preserva consumíveis configurados em peças distintas
// ══════════════════════════════════════════════════════════════════════
{
  // H1 — _planReconcilePieces preserva gravacao/spray/extra em memória.
  global._planEditPieces = [
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', tipo: '', adesivo: 'normal', gravacao: 0, spray: 5, extra: 0, _deleted: false }
  ];
  var freshPieces = [{ nome: 'Tampa', qty: 1, larg: 42, alt: 30, esp: '3', tipo: '' }];
  var reconciliado = mod._planReconcilePieces(freshPieces, 3);
  test('H1. _planReconcilePieces preserva spray=5 mesmo após editar largura', reconciliado[0].spray, 5);

  // H2 — _planSeedFromPersisted restaura gravacao/spray/extra do JSON salvo.
  var persistedJson = JSON.stringify([
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', espessuraMm: 3, tipo: '', adesivo: 'normal', gravacao: 0, spray: 5, extra: 0, origem: 'AUTOMATICA' },
    { id: 'auto_lateral', nome: 'Lateral', qty: 2, larg: 30, alt: 20, esp: '3', espessuraMm: 3, tipo: '', adesivo: '', gravacao: 20, spray: 0, extra: 0, origem: 'AUTOMATICA' }
  ]);
  var freshPieces2 = [{ nome: 'Tampa', qty: 1, larg: 40, alt: 30, esp: '3', tipo: '' }, { nome: 'Lateral', qty: 2, larg: 30, alt: 20, esp: '3', tipo: '' }];
  var seeded = mod._planSeedFromPersisted(freshPieces2, persistedJson, 3);
  test('H2. _planSeedFromPersisted restaura spray=5 da Tampa ao reabrir', seeded[0].spray, 5);
  test('H3. _planSeedFromPersisted restaura gravacao=20 da Lateral ao reabrir', seeded[1].gravacao, 20);

  // H4 — determinismo ponta-a-ponta: reabrir = restaurar o mesmo
  // planPecas e recalcular (mesmo padrão de prova usado em toda a sessão).
  var pecasH = caixaPecas({ Tampa: { spray: 5 }, Lateral: { gravacao: 20 } });
  var cenarioOpts = { itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasH }] };
  var rA = rodarCenario(cenarioOpts);
  var rB = rodarCenario(cenarioOpts);
  test('H4. Reabrir com o mesmo planPecas restaurado produz o MESMO total', rA.orcTotalVal.textContent, rB.orcTotalVal.textContent);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE I — OS: snapshot técnico correto por peça, sem custo financeiro
// ══════════════════════════════════════════════════════════════════════
{
  var pecasI = caixaPecas({ Tampa: { adesivo: 'normal', spray: 5 }, Lateral: { gravacao: 20 } });
  var itemOrcamento = { tipoItem: 'personalizado_vr', prod: 'Caixa', qty: 1, larg: 0, alt: 0, pieces: pecasI, planArea: areaPlan(pecasI), det: '' };
  var seguro = mod.osProjecaoOperacionalItem(itemOrcamento);
  test('I1. Tampa chega na OS com spray=5 intacto', seguro.pieces.find(function(p){return p.nome==='Tampa';}).spray, 5);
  test('I2. Lateral chega na OS com gravacao=20 intacto', seguro.pieces.find(function(p){return p.nome==='Lateral';}).gravacao, 20);
  ok('I3. osProjecaoOperacionalItem() nunca inclui preço/custo/margem (whitelist só técnica)', !('unit' in seguro) && !('total' in seguro) && !('custo' in seguro) && !('matCost' in seguro));

  var kbSrc = extractFn('kbAbrirPlanificacaoItem');
  ok('I4. kbAbrirPlanificacaoItem() exibe coluna "Consumíveis" (não mais só "Adesivo")', /<th style="padding:4px">Consumíveis<\/th>/.test(kbSrc));
  ok('I5. kbAbrirPlanificacaoItem() lê p.gravacao/p.spray/p.extra para o rótulo técnico', /p\.gravacao/.test(kbSrc) && /p\.spray/.test(kbSrc) && /p\.extra/.test(kbSrc));
  ok('I6. a coluna Consumíveis da OS nunca mostra preço (só rótulo textual)', !/R\$.*gravacao|adhPrecoCm2/i.test(kbSrc));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE J — orçamento ANTIGO (legado): consumíveis globais, nenhuma peça
// configurada — não perde valor, não duplica, compatibilidade preservada
// ══════════════════════════════════════════════════════════════════════
{
  var pecasLegado = caixaPecas({}); // nenhuma peça com consumível
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasLegado }], ocAdh: 'sim', ocAdhb: 'nao', ocImp: 20, ocSpray: 3, ocExtra: 15 });
  var areaTotalEsperada = areaPlan(pecasLegado);
  testePerto('J1. Adesivo legado (toggle "sim") cobra a ÁREA TOTAL do item — comportamento histórico preservado', parseBRL(r.ocv_adh.textContent), areaTotalEsperada*ADH, 0.02);
  testePerto('J2. Gravação legada (oc_imp=20) vira custo — fallback correto', parseBRL(r.ocv_imp.textContent), 20, 0.02);
  testePerto('J3. Spray legado (oc_spray=3 UNIDADES, fórmula antiga ×16) vira custo R$48', parseBRL(r.ocv_spray.textContent), 48, 0.02);
  testePerto('J4. Extra legado (oc_extra=15) vira custo — fallback correto', parseBRL(r.ocv_extra.textContent), 15, 0.02);
  var matTotalJ = (areaTotalEsperada/10000) * 150; // material da caixa inteira, sempre cobrado
  var esperadoVenda = matTotalJ + areaTotalEsperada*ADH + 20*2 + 48*2 + 15*2;
  testePerto('J5. TOTAL do pedido aplica a regra NOVA (custo×2 fora do markup) sobre o valor legado — não perde nem duplica o dado histórico', parseBRL(r.orcTotalVal.textContent), esperadoVenda, 0.05);

  // Compatibilidade dos parâmetros salvos/restaurados (regex sobre o código real).
  var saveSrc = extractFn('_orcSalvarOrcamentoImpl');
  ok('J6. _orcSalvarOrcamentoImpl() continua salvando oc_imp/oc_spray/oc_extra no snapshot (parametros)', /oc_imp: _gv\('oc_imp'\), oc_spray: _gv\('oc_spray'\), oc_extra: _gv\('oc_extra'\)/.test(saveSrc));
  var editSrc = extractFn('orcEnvEditar');
  ok('J7. orcEnvEditar() continua restaurando oc_imp/oc_spray/oc_extra ao reabrir', /setV\('oc_imp', p\.oc_imp\); setV\('oc_spray', p\.oc_spray\); setV\('oc_extra', p\.oc_extra\)/.test(editSrc));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE K — orçamento comparativo: consumível de peça de opção NÃO
// selecionada nunca entra no total real (fecha bug pré-existente)
// ══════════════════════════════════════════════════════════════════════
{
  var pecasOpcaoA = caixaPecas({ Tampa: { adesivo: 'normal', gravacao: 20, spray: 10, extra: 15 } }); // opção 2mm, NÃO escolhida
  var pecasOpcaoB = caixaPecas({}); // opção 3mm, escolhida, sem consumíveis
  var opcoes = { '1': { grupoId: 'G1', selecionada: false }, '2': { grupoId: 'G1', selecionada: true } };
  var r = rodarCenario({
    itens: [
      { idx: '1', qty: 1, matKey: 'cfg_0', espItem: 2, pecas: pecasOpcaoA },
      { idx: '2', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: pecasOpcaoB }
    ],
    opcoes: opcoes
  });
  ok('K1. Consumíveis da peça da opção NÃO selecionada NUNCA entram no total real (Adesivo)', parseBRL(r.ocv_adh.textContent) === 0);
  ok('K2. Consumíveis da peça da opção NÃO selecionada NUNCA entram no total real (Gravação)', parseBRL(r.ocv_imp.textContent) === 0);
  ok('K3. Consumíveis da peça da opção NÃO selecionada NUNCA entram no total real (Spray)', parseBRL(r.ocv_spray.textContent) === 0);
  ok('K4. Consumíveis da peça da opção NÃO selecionada NUNCA entram no total real (Extra)', parseBRL(r.ocv_extra.textContent) === 0);
  // Opção B (escolhida) não tem consumível, mas TEM material próprio
  // (mesma geometria de caixa, 0,52m²×R$150/m²=R$78) — que corretamente
  // entra no total; só os CONSUMÍVEIS da opção A (não escolhida) são
  // excluídos (ver K1-K4 acima).
  var matTotalK = (areaPlan(pecasOpcaoB)/10000) * 150;
  testePerto('K5. TOTAL do pedido = só o material da opção B escolhida (R$78) — nada da opção A não escolhida', parseBRL(r.orcTotalVal.textContent), matTotalK, 0.05);

  // Preço informativo da opção NÃO selecionada continua calculado (nunca some da linha).
  ok('K6. Item da opção NÃO selecionada mostra preço informativo próprio (>0)', parseBRL(r.oi_tot_1.textContent) > 0);
}

// ══════════════════════════════════════════════════════════════════════
// REGRESSÃO — Só Corte é MODO DE PRECIFICAÇÃO GLOBAL, não consumível;
// permanece intocado por esta rodada.
// ══════════════════════════════════════════════════════════════════════
{
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, pecas: caixaPecas({ Tampa: { gravacao: 20 } }) }], soCorte: true, soCorteMin: 60 });
  testePerto('R1. Só Corte (60min) cobra 60/60×R$130 = R$130, ignorando material/consumíveis normais', parseBRL(r.orcTotalVal.textContent) - (20*2), 130, 0.5);
  // (a Gravação soma DEPOIS do override de Só Corte — ver finalPrice = finalPriceVR(=Só Corte) + ... + gravacaoAdicionalVenda)
}

// ══════════════════════════════════════════════════════════════════════
// REGRESSÃO — modal "⚙️ Custos" não tem mais a seção Consumíveis; Step 3
// não expõe mais os campos globais de Adesivo/Gravação/Spray/Extra na UI.
// ══════════════════════════════════════════════════════════════════════
{
  var modalSrc = extractFn('orcItemExtras');
  ok('R2. Modal Custos NÃO renderiza mais o array de Consumíveis (Adesivo/Adh.Branco/Gravação/Spray/Extra)', !/\['🩹','Adesivo'/.test(modalSrc));
  ok('R3. Modal Custos continua com "Só Corte" (não é consumível, fica global)', /Só Corte/.test(modalSrc));
  ok('R4. Modal Custos continua com "Extras deste Item" (acabamento/instalação/outros — item-local, não migrou)', /Extras deste Item/.test(modalSrc));

  var idxOcAdh = html.indexOf('id="oc_adh"');
  var antesOcAdh = html.slice(Math.max(0, idxOcAdh - 600), idxOcAdh);
  ok('R5. Step 3: painel Consumíveis global está oculto (display:none) — não editável, só fallback', /style="display:none"/.test(antesOcAdh));
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
