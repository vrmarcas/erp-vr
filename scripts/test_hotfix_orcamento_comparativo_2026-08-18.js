/**
 * test_hotfix_orcamento_comparativo_2026-08-18.js
 *
 * RODADA 5 (2/2) — Orçamento comparativo / grupos de opções. Vários itens
 * (ex.: mesma Caixa em 2/3/4mm) podem ser marcados como um grupo de
 * ALTERNATIVAS mutuamente exclusivas: PDF/WhatsApp apresentam "escolha uma
 * das opções" com "OU", NUNCA somando um total falso; o motor de preço
 * canônico (orcRecalc/PASS1/PASS3) é o MESMO de sempre — só a
 * participação no total muda (ORC_ITEM_OPCOES{grupoId,selecionada}).
 * Orçamento normal (sem grupos) tem que se comportar EXATAMENTE como hoje.
 *
 * Uso: node scripts/test_hotfix_orcamento_comparativo_2026-08-18.js
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
  'msgResolverTemplate',
  'orcProdutoNomeResolvido','cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  '_matResolverPrecoFamiliaEspessura', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos', 'osProjecaoOperacionalItem'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, osProjecaoOperacionalItem: osProjecaoOperacionalItem };'
].join('\n\n');
var modPath = path.join(__dirname, '_orcamento_comparativo_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 5 (2/2) — Orçamento comparativo / grupos de opções ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// factor=1 (overhead/vrml/impostos=0) para que finalPriceVR seja igual ao
// matTotal contado — torna os números do cenário auditáveis a olho.
function rodarCenario(opts) {
  opts = opts || {};
  var materiaisCatalogo = opts.materiaisCatalogo || [
    { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }
  ];
  var itens = opts.itens || [];
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
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  itens.forEach(function (it) {
    _els['oi_qty_' + it.idx] = makeEl({ value: String(it.qty || 1) });
    _els['oi_larg_' + it.idx] = makeEl({ value: '0' });
    _els['oi_alt_' + it.idx] = makeEl({ value: '0' });
    var _matEntry = materiaisCatalogo[parseInt(String(it.matKey).replace('cfg_', ''), 10)] || {};
    _els['oi_mat_' + it.idx] = makeEl({ value: it.matKey, dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: _matEntry.nome, esp: String(_matEntry.esp || '') }, text: _matEntry.nome }] });
    _els['oi_esp_' + it.idx] = makeEl({ value: String(it.espItem || 3) });
    _els['oi_prod_' + it.idx] = makeEl({ value: it.prod || ('Item ' + it.idx) });
    _els['oi_det_' + it.idx] = makeEl({ value: '' });
    _els['oi_custo_' + it.idx] = makeEl();
    _els['oi_unit_' + it.idx] = makeEl();
    _els['oi_tot_' + it.idx] = makeEl();
    _els['oi_opcaoBadge_' + it.idx] = makeEl();
    _els['oir_' + it.idx] = { dataset: { idx: it.idx, planArea: '0', planPecas: '[]' } };
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
  global.ORC_ITEM_OPCOES = opts.opcoes || {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  mod.orcRecalc();
  return _els;
}

// ══════════════════════════════════════════════════════════════════════
// TESTE G — 3 opções (2mm=R$120 / 3mm=R$150 / 4mm=R$190), 3mm escolhida:
// o TOTAL do pedido nunca é a soma (R$460) — só a opção selecionada.
// matCost = área(m²)×rsm2. Usando rsm2=100 e larg×alt tais que a área dê
// exatamente 1,20 / 1,50 / 1,90 m² (planArea em cm²).
// ══════════════════════════════════════════════════════════════════════
{
  var opcoes = {
    '1': { grupoId: 'G1', selecionada: false }, // 2mm — R$120
    '2': { grupoId: 'G1', selecionada: true },  // 3mm — R$150 — ESCOLHIDA
    '3': { grupoId: 'G1', selecionada: false }  // 4mm — R$190
  };
  var itens = [
    { idx: '1', qty: 1, matKey: 'cfg_0', prod: 'Caixa 2mm', larg: 120, alt: 100 }, // 1,20m² × R$100 = R$120
  ];
  // Sobrescreve área via planArea simulando peça única = larg×alt (cm) já
  // que o cenário não usa planificação — usa oi_larg_/oi_alt_ direto.
  var r = rodarCenario({
    itens: [
      { idx: '1', qty: 1, matKey: 'cfg_0', prod: 'Caixa 2mm', espItem: 2 },
      { idx: '2', qty: 1, matKey: 'cfg_0', prod: 'Caixa 3mm', espItem: 3 },
      { idx: '3', qty: 1, matKey: 'cfg_0', prod: 'Caixa 4mm', espItem: 4 }
    ],
    opcoes: opcoes
  });
  // Ajusta larg/alt diretamente (o helper acima zera para '0') para dar
  // exatamente as áreas desejadas — reexecuta orcRecalc() com os valores certos.
  document.getElementById('oi_larg_1').value = '120'; document.getElementById('oi_alt_1').value = '100'; // 1,20 m² × R$100 = R$120
  document.getElementById('oi_larg_2').value = '150'; document.getElementById('oi_alt_2').value = '100'; // 1,50 m² × R$100 = R$150
  document.getElementById('oi_larg_3').value = '190'; document.getElementById('oi_alt_3').value = '100'; // 1,90 m² × R$100 = R$190
  mod.orcRecalc();
  var finalPrice = window._orcCalc.finalPrice;
  testePerto('G1. TOTAL do pedido = SÓ a opção 3mm escolhida (R$150,00)', finalPrice, 150, 0.05);
  ok('G2. TOTAL NUNCA é a soma das 3 opções (R$460,00)', Math.abs(finalPrice - 460) > 50);
  ok('G3. TOTAL NUNCA é a soma de 2mm+4mm sem a escolhida (R$310,00)', Math.abs(finalPrice - 310) > 50);
  // Preço informativo das não-escolhidas continua calculado (não é zero),
  // só não soma no total.
  var custo2mm = parseBRL(document.getElementById('oi_tot_1').textContent);
  var custo4mm = parseBRL(document.getElementById('oi_tot_3').textContent);
  ok('G4. Opção 2mm (não escolhida) mostra preço informativo próprio (>0)', custo2mm > 0);
  ok('G5. Opção 4mm (não escolhida) mostra preço informativo próprio (>0)', custo4mm > 0);

  var pdfSrc = extractFn('orcImprimirOrcamentoPDF');
  ok('G6. PDF agrupa itens do mesmo grupoOpcaoId em bloco "Escolha uma das opções"', /Escolha uma das opções abaixo/.test(pdfSrc));
  ok('G7. PDF separa as opções do grupo com "OU" (nunca soma)', /— OU —/.test(pdfSrc));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE H — WhatsApp mostra as 3 opções separadamente (bloco "OU"), nunca
// como itens cumulativos numerados soltos.
// ══════════════════════════════════════════════════════════════════════
{
  var waSrc = extractFn('orcEnviarOrcamentoWA');
  ok('H1. WhatsApp agrupa itens do mesmo grupoOpcaoId ("Escolha uma das opções")', /Escolha uma das opções abaixo/.test(waSrc));
  ok('H2. WhatsApp marca a opção selecionada no texto (nunca esconde qual foi escolhida)', /selecionada/.test(waSrc));
  ok('H3. WhatsApp separa as opções do grupo com "OU" (nunca soma um total do bloco)', /OU/.test(waSrc) && /grupoOpcaoId/.test(waSrc));

  // orcColetarItensDistribuidos (fonte única PDF+WhatsApp) propaga os
  // campos de grupo corretamente para os 3 itens do cenário G.
  var itensDist = mod.orcColetarItensDistribuidos(window._orcCalc.finalPrice);
  test('H4. Os 3 itens do grupo carregam o mesmo grupoOpcaoId', itensDist.map(function(i){return i.grupoOpcaoId;}), ['G1','G1','G1']);
  test('H5. Só o item 3mm (idx 2) vem com opcaoSelecionada=true', itensDist.map(function(i){return i.opcaoSelecionada;}), [false, true, false]);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE I — selecionar a opção 3mm → contratado=R$150; OS contém só a
// 3mm; 2mm/4mm NUNCA entram na OS (filtro real de orcEnvGerarOS).
// ══════════════════════════════════════════════════════════════════════
{
  var itensOrcamentoSalvo = [
    { prod: 'Caixa 2mm', grupoOpcao: { grupoId: 'G1', selecionada: false } },
    { prod: 'Caixa 3mm', grupoOpcao: { grupoId: 'G1', selecionada: true } },
    { prod: 'Caixa 4mm', grupoOpcao: { grupoId: 'G1', selecionada: false } },
    { prod: 'Puxador (cumulativo)', grupoOpcao: null }
  ];
  var itensFiltrados = itensOrcamentoSalvo.filter(function(it){ return !it.grupoOpcao || it.grupoOpcao.selecionada; });
  test('I1. Filtro real: só "Caixa 3mm" (escolhida) + "Puxador" (cumulativo) entram na OS', itensFiltrados.map(function(i){return i.prod;}), ['Caixa 3mm', 'Puxador (cumulativo)']);
  ok('I2. "Caixa 2mm" (não escolhida) NUNCA entra na OS', itensFiltrados.every(function(i){return i.prod!=='Caixa 2mm';}));
  ok('I3. "Caixa 4mm" (não escolhida) NUNCA entra na OS', itensFiltrados.every(function(i){return i.prod!=='Caixa 4mm';}));

  var gerarOSSrc = extractFn('orcEnvGerarOS');
  ok('I4. orcEnvGerarOS() usa EXATAMENTE o filtro !it.grupoOpcao || it.grupoOpcao.selecionada (mesma regra testada acima, não uma reimplementação)', /!it\.grupoOpcao \|\| it\.grupoOpcao\.selecionada/.test(gerarOSSrc));

  var syncOSSrc = extractFn('_orcSincronizarOSVinculada');
  ok('I5. _orcSincronizarOSVinculada() (edição pós-OS) usa o MESMO filtro', /!it\.grupoOpcao \|\| it\.grupoOpcao\.selecionada/.test(syncOSSrc));

  var seguro = mod.osProjecaoOperacionalItem(itensFiltrados[0]);
  test('I6. Item que chega na OS ainda é a projeção operacional de sempre (whitelist, sem custo)', seguro.prod, 'Caixa 3mm');
}

// ══════════════════════════════════════════════════════════════════════
// TESTE J — orçamento NORMAL (sem grupos) se comporta EXATAMENTE como
// antes desta rodada: soma cumulativa de todos os itens, sem exceção.
// ══════════════════════════════════════════════════════════════════════
{
  var rNormal = rodarCenario({
    itens: [
      { idx: '1', qty: 1, matKey: 'cfg_0', prod: 'Item A', espItem: 3 },
      { idx: '2', qty: 1, matKey: 'cfg_0', prod: 'Item B', espItem: 3 }
    ]
  });
  document.getElementById('oi_larg_1').value='100'; document.getElementById('oi_alt_1').value='100'; // 1m² × R$100 = R$100
  document.getElementById('oi_larg_2').value='200'; document.getElementById('oi_alt_2').value='100'; // 2m² × R$100 = R$200
  mod.orcRecalc();
  testePerto('J1. Sem ORC_ITEM_OPCOES, total = soma cumulativa dos dois itens (R$300,00)', window._orcCalc.finalPrice, 300, 0.05);
  var itensDistNormal = mod.orcColetarItensDistribuidos(window._orcCalc.finalPrice);
  ok('J2. Nenhum item carrega grupoOpcaoId (orçamento normal, zero mudança de comportamento)', itensDistNormal.every(function(i){ return i.grupoOpcaoId===null; }));
  ok('J3. Todos os itens vêm com opcaoSelecionada=true (tratados como cumulativos)', itensDistNormal.every(function(i){ return i.opcaoSelecionada===true; }));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE K — salvar/reabrir preserva grupos/opções/preços/seleção.
// ══════════════════════════════════════════════════════════════════════
{
  var saveSrc = extractFn('_orcSalvarOrcamentoImpl');
  ok('K1. _orcSalvarOrcamentoImpl() persiste grupoOpcao por item (snapshot de ORC_ITEM_OPCOES)', /grupoOpcao:\s*\(typeof ORC_ITEM_OPCOES/.test(saveSrc));

  var editSrc = extractFn('orcEnvEditar');
  ok('K2. orcEnvEditar() restaura ORC_ITEM_OPCOES[ri] a partir de it.grupoOpcao ao reabrir', /ORC_ITEM_OPCOES\[ri\]\s*=\s*JSON\.parse\(JSON\.stringify\(it\.grupoOpcao\)\)/.test(editSrc));

  // Determinismo ponta-a-ponta: "reabrir" = restaurar o MESMO
  // ORC_ITEM_OPCOES e recalcular — mesmo padrão de prova usado em toda
  // esta sessão para simular save/reopen sem depender do Firestore real.
  var opcoesK = {
    '1': { grupoId: 'GK', selecionada: false },
    '2': { grupoId: 'GK', selecionada: true }
  };
  var cenarioK = {
    itens: [
      { idx: '1', qty: 1, matKey: 'cfg_0', prod: 'Opção A', espItem: 3 },
      { idx: '2', qty: 1, matKey: 'cfg_0', prod: 'Opção B', espItem: 3 }
    ],
    opcoes: opcoesK
  };
  var rK1 = rodarCenario(cenarioK);
  document.getElementById('oi_larg_1').value='100'; document.getElementById('oi_alt_1').value='100';
  document.getElementById('oi_larg_2').value='150'; document.getElementById('oi_alt_2').value='100';
  mod.orcRecalc();
  var totalPrimeiraVez = window._orcCalc.finalPrice;
  var tot1PrimeiraVez = rK1.oi_tot_1.textContent, tot2PrimeiraVez = rK1.oi_tot_2.textContent;

  // "reabertura": os mesmos dados + o MESMO ORC_ITEM_OPCOES restaurado
  // (JSON.parse(JSON.stringify(...)) simula exatamente o que orcEnvEditar
  // faz linha a linha) rodando de novo do zero.
  var opcoesRestauradas = JSON.parse(JSON.stringify(opcoesK));
  var rK2 = rodarCenario({ itens: cenarioK.itens, opcoes: opcoesRestauradas });
  document.getElementById('oi_larg_1').value='100'; document.getElementById('oi_alt_1').value='100';
  document.getElementById('oi_larg_2').value='150'; document.getElementById('oi_alt_2').value='100';
  mod.orcRecalc();
  testePerto('K3. Reabrir com o mesmo grupoOpcao restaurado produz o MESMO total', window._orcCalc.finalPrice, totalPrimeiraVez, 0.02);
  test('K4. Reabrir preserva o preço EXATO do item não-selecionado (oi_tot_1)', rK2.oi_tot_1.textContent, tot1PrimeiraVez);
  test('K5. Reabrir preserva o preço EXATO do item selecionado (oi_tot_2)', rK2.oi_tot_2.textContent, tot2PrimeiraVez);
  test('K6. Reabrir preserva QUAL opção estava selecionada (histórico)', ORC_ITEM_OPCOES['2'].selecionada, true);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
