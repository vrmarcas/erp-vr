/**
 * test_hotfix_espessura_extras_2026-08-17.js
 *
 * RODADA CIRÚRGICA 2026-08-17 (3/3 desta sessão) — escopo: (1) custo de
 * material por peça com espessura diferente dentro do MESMO item; (2)
 * isolamento de extras "➕ deste Item" (não vazar para outros itens).
 *
 * ACHADO 1 — comprovado por simulação real na investigação prévia: peças
 * AUTOMÁTICAS (origem:'AUTOMATICA', geradas por receita cadastrada ou por
 * importação de SVG multi-espessura) declarando `esp` própria diferente
 * do material selecionado no item eram TODAS cobradas ao preço/m² único
 * do item — só peças MANUAIS já eram precificadas por espessura própria
 * (via `precoM2`). `_matResolverPrecoFamiliaEspessura()` (novo) resolve o
 * preço/m² correto buscando, no MESMO cadastro filtrado que
 * `_matGetRsm2()`/`orcConstruirMatOpts()` já usam, uma entrada da mesma
 * família (nome-base normalizado) na espessura da peça — e `orcRecalc()`
 * usa isso como um DELTA de correção sobre a fórmula existente (delta=0
 * quando nenhuma peça diverge — nunca muda o comportamento anterior nesse
 * caso, que cobre os 14 produtos do catálogo built-in).
 *
 * ACHADO 2 — comprovado por execução real na investigação prévia: extras
 * "➕ deste Item" (Acabamento/Fita, Instalação, Outros) são capturados e
 * persistidos por item (`ORC_ITEM_EXTRAS[idx]`), mas `orcGetItemExtrasTotal()`
 * os agregava num total ÚNICO do pedido, que o PASS 3 (rodada anterior)
 * ratewava por um peso (`tsRaw`) sem NENHUMA referência a qual item tinha
 * o extra — mover o extra do Item A pro Item B produzia preços por item
 * BIT-A-BIT IDÊNTICOS (prova de que o "dono" do extra não tinha nenhum
 * efeito numérico). Corrigido calculando `finalPriceVR` DUAS vezes (com e
 * sem `itemExtrasTotal`) para isolar exatamente a contribuição marcada up
 * dos extras — combinada, matematicamente, com o rateio proporcional
 * (peso = matCost/ajuste, sem extras) do resto — garante atribuição EXATA
 * mesmo com desconto/acréscimo global ativos (prova algébrica no diff/
 * commit; aqui provamos por execução).
 *
 * Uso: node scripts/test_hotfix_espessura_extras_2026-08-17.js
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
  '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', '_planPecaAdesivos', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos, _matResolverPrecoFamiliaEspessura: _matResolverPrecoFamiliaEspessura };'
].join('\n\n');
var modPath = path.join(__dirname, '_espessura_extras_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA CIRÚRGICA 2026-08-17 (3/3) — custo por peça multi-espessura + isolamento de extras ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// Cenário base reutilizável: N itens, cada um com peças AUTOMÁTICAS
// próprias (planPecas), permitindo controlar precisamente espessura por
// peça e extras por item — mesmo padrão de harness já estabelecido nesta
// sessão (extrai as funções REAIS e roda contra DOM fake).
function rodarCenario(opts) {
  opts = opts || {};
  var materiaisCatalogo = opts.materiaisCatalogo || [
    { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150, esp: 3 },
    { nome: 'Acrílico Cristal 4mm', custo: 200, comp: 200, larg: 100, rsm2: 200, esp: 4 }
  ];
  var itens = opts.itens || [];
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: opts.descTipo || 'pct' }), orcDesc: makeEl({ value: String(opts.descVal || 0) }),
    om_laser: makeEl({ value: String(opts.omLaser || 0) }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: String(opts.montagem || 0) }), orcDesl: makeEl({ value: String(opts.desl || 0) }),
    orcAcresTipo: makeEl({ value: opts.acresTipo || 'pct' }), orcAcres: makeEl({ value: String(opts.acresVal || 0) }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  itens.forEach(function (it) {
    _els['oi_qty_' + it.idx] = makeEl({ value: String(it.qty || 1) });
    _els['oi_larg_' + it.idx] = makeEl({ value: '0' });
    _els['oi_alt_' + it.idx] = makeEl({ value: '0' });
    // sem dataset.rsm2 pré-populado — força resolução real via cfgLoad. options/selectedIndex
    // necessários por orcColetarItensDistribuidos() (PDF/WhatsApp) para ler nome/esp do material.
    var _matEntry = materiaisCatalogo[parseInt(String(it.matKey).replace('cfg_', ''), 10)] || {};
    _els['oi_mat_' + it.idx] = makeEl({ value: it.matKey, dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: _matEntry.nome, esp: String(_matEntry.esp || '') }, text: _matEntry.nome }] });
    _els['oi_esp_' + it.idx] = makeEl({ value: String(it.espItem) });
    _els['oi_prod_' + it.idx] = makeEl({ value: it.prod || ('Item ' + it.idx) });
    _els['oi_det_' + it.idx] = makeEl({ value: '' });
    _els['oi_custo_' + it.idx] = makeEl();
    _els['oi_unit_' + it.idx] = makeEl();
    _els['oi_tot_' + it.idx] = makeEl();
    _els['oir_' + it.idx] = { dataset: { idx: it.idx, planArea: String(it.planArea), planPecas: JSON.stringify(it.pecas || []) } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return itens.map(function (it) { return { dataset: _els['oir_' + it.idx].dataset }; });
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: opts.overhead || 0, vrml: opts.vrml || 0, impostos: opts.impostos || 0 } };
  global.cfgLoad = function () { return { materiais: materiaisCatalogo }; };
  global._matGetRsm2 = function (matKey) {
    var m = materiaisCatalogo.find(function (mm) { return mm.nome && ('cfg_' + materiaisCatalogo.indexOf(mm)) === matKey; });
    return m ? m.rsm2 : 100;
  };
  global.ORC_ITEM_EXTRAS = opts.itemExtras || {};
  global.ORC_ITEM_AJUSTES = opts.ajustes || {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  mod.orcRecalc();
  return _els;
}

// ══════════════════════════════════════════════════════════════════════
// TESTE A — 2 peças em 3mm + 1 peça em 4mm no MESMO item
// ══════════════════════════════════════════════════════════════════════
{
  // Material do item = Acrílico Cristal 3mm (cfg_0, R$150/m²). Peça
  // adicional declara esp=4 (cfg_1, R$200/m²) — automática, sem override manual.
  var pecas = [
    { qty: 1, larg: 50, alt: 40, esp: '3', origem: 'AUTOMATICA' },   // 0,20 m²
    { qty: 1, larg: 30, alt: 30, esp: '3', origem: 'AUTOMATICA' },   // 0,09 m²
    { qty: 1, larg: 20, alt: 20, esp: '4', origem: 'AUTOMATICA' }    // 0,04 m²
  ];
  var planArea = 50*40 + 30*30 + 20*20; // cm², soma de todas as peças
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: planArea, pecas: pecas }] });
  var custoEsperado = (0.20*150) + (0.09*150) + (0.04*200); // 30+13.5+8 = 51.50
  var custoObtido = parseBRL(r.oi_custo_1.textContent);
  testePerto('A1. custo = área3mm×preço3mm + área4mm×preço4mm (R$51,50)', custoObtido, custoEsperado, 0.02);
  ok('A2. custo NÃO é a aproximação antiga (toda a área × R$150 = R$49,95)', Math.abs(custoObtido - 49.95) > 0.5);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — trocar SÓ a peça adicional (4mm → 5mm): só essa parcela muda
// ══════════════════════════════════════════════════════════════════════
{
  var materiaisCom5mm = [
    { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150, esp: 3 },
    { nome: 'Acrílico Cristal 4mm', custo: 200, comp: 200, larg: 100, rsm2: 200, esp: 4 },
    { nome: 'Acrílico Cristal 5mm', custo: 250, comp: 200, larg: 100, rsm2: 250, esp: 5 }
  ];
  function cenario4ou5(esp) {
    var pecas = [
      { qty: 1, larg: 50, alt: 40, esp: '3', origem: 'AUTOMATICA' },
      { qty: 1, larg: 30, alt: 30, esp: '3', origem: 'AUTOMATICA' },
      { qty: 1, larg: 20, alt: 20, esp: String(esp), origem: 'AUTOMATICA' }
    ];
    var planArea = 50*40 + 30*30 + 20*20;
    return rodarCenario({ materiaisCatalogo: materiaisCom5mm, itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: planArea, pecas: pecas }] });
  }
  var r4 = cenario4ou5(4);
  var r5 = cenario4ou5(5);
  var custo4 = parseBRL(r4.oi_custo_1.textContent);
  var custo5 = parseBRL(r5.oi_custo_1.textContent);
  var deltaEsperado = 0.04 * (250 - 200); // só a peça de 20×20cm muda de R$200/m² pra R$250/m²
  testePerto('B1. só a parcela da peça trocada muda (delta = R$2,00 exato)', custo5 - custo4, deltaEsperado, 0.02);
  var pecas3mmInalteradas = (0.20*150) + (0.09*150);
  ok('B2. as duas peças de 3mm continuam custando o mesmo nos dois cenários', Math.abs((custo4 - 0.04*200) - pecas3mmInalteradas) < 0.02 && Math.abs((custo5 - 0.04*250) - pecas3mmInalteradas) < 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C — peça SEM espessura própria herda o material principal
// ══════════════════════════════════════════════════════════════════════
{
  var pecasSemOverride = [
    { qty: 1, larg: 50, alt: 40, esp: '', origem: 'AUTOMATICA' },  // sem esp própria
    { qty: 1, larg: 30, alt: 30, origem: 'AUTOMATICA' }             // esp nem declarada
  ];
  var planArea = 50*40 + 30*30;
  var r = rodarCenario({ itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: planArea, pecas: pecasSemOverride }] });
  var custoEsperado = (planArea/10000) * 150; // tudo ao preço do material do item — sem correção nenhuma
  testePerto('C1. peça sem esp própria herda o material principal do item (sem correção aplicada)', parseBRL(r.oi_custo_1.textContent), custoEsperado, 0.02);

  ok('C2. _matResolverPrecoFamiliaEspessura() devolve null para espessura vazia/0 (nunca inventa preço)', mod._matResolverPrecoFamiliaEspessura('cfg_0', 0) === null);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — salvar/reabrir: custo permanece igual (determinismo de orcRecalc
// com o MESMO row.dataset.planPecas restaurado — é exatamente isso que
// orcEnvEditar() faz ao reabrir, linha confirmada: row.dataset.planPecas =
// JSON.stringify(_rd.planPecas||[]))
// ══════════════════════════════════════════════════════════════════════
{
  var pecas = [
    { qty: 1, larg: 50, alt: 40, esp: '3', origem: 'AUTOMATICA' },
    { qty: 1, larg: 20, alt: 20, esp: '4', origem: 'AUTOMATICA' }
  ];
  var planArea = 50*40 + 20*20;
  var cenarioOpts = { itens: [{ idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: planArea, pecas: pecas }] };
  var r1 = rodarCenario(cenarioOpts);
  var r2 = rodarCenario(cenarioOpts); // "reabrir" = restaurar os mesmos dados e rodar orcRecalc() de novo
  test('D1. reabrir com o mesmo planPecas restaurado produz o MESMO custo/unit/total', { c: r2.oi_custo_1.textContent, u: r2.oi_unit_1.textContent, t: r2.oi_tot_1.textContent }, { c: r1.oi_custo_1.textContent, u: r1.oi_unit_1.textContent, t: r1.oi_tot_1.textContent });

  var envEditarSrc = extractFn('orcEnvEditar');
  ok('D2. orcEnvEditar() restaura row.dataset.planPecas ao reabrir (confirma que o cenário acima reflete a UI real)', /row\.dataset\.planPecas\s*=\s*JSON\.stringify\(_rd\.planPecas/.test(envEditarSrc));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — Extra R$50 SOMENTE no Item A: A muda, B permanece EXATAMENTE igual
// ══════════════════════════════════════════════════════════════════════
{
  function cenario2Itens(extraA) {
    return rodarCenario({
      itens: [
        { idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }, // 1m² @150 = R$150
        { idx: '2', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }
      ],
      itemExtras: extraA ? { '1': { instalacao: 50, acabamento: 0, outros: 0 } } : {}
    });
  }
  var semExtra = cenario2Itens(false);
  var comExtra = cenario2Itens(true);
  test('E1. sem nenhum extra — Item A e Item B idênticos (R$150,00 cada)', semExtra.oi_tot_1.textContent, semExtra.oi_tot_2.textContent);
  ok('E2. Extra R$50 SOMENTE no Item A — preço do Item A AUMENTA', parseBRL(comExtra.oi_tot_1.textContent) > parseBRL(semExtra.oi_tot_1.textContent));
  test('E3. Item B permanece EXATAMENTE igual ao cenário sem extra (nenhum vazamento)', comExtra.oi_tot_2.textContent, semExtra.oi_tot_2.textContent);
  testePerto('E4. o aumento do Item A corresponde exatamente ao extra marcado up (R$50/factor)', parseBRL(comExtra.oi_tot_1.textContent) - parseBRL(semExtra.oi_tot_1.textContent), 50/1, 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE F — remover o Extra do Item A: Item B continua inalterado
// ══════════════════════════════════════════════════════════════════════
{
  function cenario(temExtra) {
    return rodarCenario({
      itens: [
        { idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] },
        { idx: '2', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 20000, pecas: [{ qty: 1, larg: 200, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }
      ],
      itemExtras: temExtra ? { '1': { instalacao: 100, acabamento: 0, outros: 0 } } : {}
    });
  }
  var comExtra = cenario(true);
  var semExtraDepois = cenario(false); // "removeu o extra" = recalcula sem ele
  test('F1. remover o Extra do Item A — Item B continua exatamente igual', semExtraDepois.oi_tot_2.textContent, comExtra.oi_tot_2.textContent);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE G — dois itens com extras PRÓPRIOS diferentes — cada um fica no seu
// ══════════════════════════════════════════════════════════════════════
{
  var r = rodarCenario({
    itens: [
      { idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }, // R$150 base
      { idx: '2', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }  // R$150 base
    ],
    itemExtras: { '1': { instalacao: 30, acabamento: 0, outros: 0 }, '2': { instalacao: 0, acabamento: 0, outros: 80 } }
  });
  var baseline = rodarCenario({
    itens: [
      { idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] },
      { idx: '2', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }
    ]
  });
  var delta1 = parseBRL(r.oi_tot_1.textContent) - parseBRL(baseline.oi_tot_1.textContent);
  var delta2 = parseBRL(r.oi_tot_2.textContent) - parseBRL(baseline.oi_tot_2.textContent);
  testePerto('G1. Item 1 (extra R$30) aumenta exatamente R$30 (fora do markup, factor=1)', delta1, 30, 0.02);
  testePerto('G2. Item 2 (extra R$80) aumenta exatamente R$80', delta2, 80, 0.02);
  ok('G3. os dois extras diferentes NÃO se misturam (delta1 ≠ delta2, cada um no seu item)', Math.abs(delta1 - delta2) > 1);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE EXTRA — isolamento de extras MESMO com desconto global E máquinas/
// consumíveis (pool verdadeiramente compartilhado) ativos ao mesmo tempo —
// o caso matematicamente mais difícil, provando que o rateio do pool
// comum (por peso SEM extras) nunca é distorcido pelo extra de outro item.
// ══════════════════════════════════════════════════════════════════════
{
  function cenarioComPoolEDesconto(extraNoA) {
    return rodarCenario({
      itens: [
        { idx: '1', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 10000, pecas: [{ qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }, // 1m²
        { idx: '2', qty: 1, matKey: 'cfg_0', espItem: 3, planArea: 30000, pecas: [{ qty: 1, larg: 300, alt: 100, esp: '3', origem: 'AUTOMATICA' }] }  // 3m² — pesos desiguais de propósito
      ],
      itemExtras: extraNoA ? { '1': { instalacao: 70, acabamento: 0, outros: 0 } } : {},
      omLaser: 50, montagem: 40, desl: 20, // pool GENUINAMENTE global — não pertence a nenhum item
      descTipo: 'pct', descVal: 10 // desconto global de 10% — ativo ao mesmo tempo
    });
  }
  var sem = cenarioComPoolEDesconto(false);
  var com = cenarioComPoolEDesconto(true);
  test('H1. com pool global (máquinas+montagem+deslocamento) E desconto de 10% ativos — Item B (sem extra) continua EXATAMENTE igual', com.oi_tot_2.textContent, sem.oi_tot_2.textContent);
  ok('H2. Item A (dono do extra) muda', parseBRL(com.oi_tot_1.textContent) !== parseBRL(sem.oi_tot_1.textContent));
}

// ══════════════════════════════════════════════════════════════════════
// REGRESSÃO — invariante do preço canônico: UNIT.×QTD=TOTAL e PDF/WhatsApp
// batem com a linha, mesmo com espessura mista + extras isolados juntos
// ══════════════════════════════════════════════════════════════════════
{
  var r = rodarCenario({
    itens: [
      { idx: '1', qty: 3, matKey: 'cfg_0', espItem: 3, planArea: 15000, pecas: [
        { qty: 1, larg: 100, alt: 100, esp: '3', origem: 'AUTOMATICA' },
        { qty: 1, larg: 50, alt: 100, esp: '4', origem: 'AUTOMATICA' }
      ] }
    ],
    itemExtras: { '1': { instalacao: 45, acabamento: 0, outros: 0 } }
  });
  var unit = parseBRL(r.oi_unit_1.textContent);
  var tot = parseBRL(r.oi_tot_1.textContent);
  testePerto('I1. UNIT. × QTD = TOTAL (espessura mista + extra do item juntos)', unit * 3, tot, 0.05);
  var itensDistribuidos = mod.orcColetarItensDistribuidos(window._orcCalc.finalPrice);
  testePerto('I2. PDF/WhatsApp (orcColetarItensDistribuidos) batem com a linha', itensDistribuidos[0].total, tot, 0.02);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
