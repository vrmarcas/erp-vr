/**
 * test_maquina_por_item_2026-10-28.js
 *
 * FEATURE OBRIGATÓRIA (2026-10-28) — operação de máquina não estava
 * vinculada à máquina real do cadastro: existiam máquinas cadastradas
 * (Laser Vermelha/Verde R$130/h, Laser Metal R$450/h) mas o orçamento não
 * oferecia nenhuma forma de ESCOLHER qual máquina real está sendo usada
 * por item/operação — só um único tempo/máquina COMPARTILHADO pelo
 * pedido inteiro (campos globais om_laser/om_dobra/...).
 *
 * Corrigido: cada item (ORC_ITEM_MAQUINAS[idx]) escolhe, por operação, a
 * máquina real do cadastro (Config→Máquinas), via select na UI do modal
 * "⚙️ Custos" — nunca mais um vínculo único compartilhado. Fonte canônica
 * do custo/hora continua sendo cfgData.maquinas (nunca duplicada).
 *
 * Testa as 13 provas exigidas: 1-3 (cálculo correto por máquina), 4
 * (trocar máquina recalcula), 5 (trocar tempo recalcula), 6 (sem máquina
 * = R$0+alerta), 7 (persistência salvar/reabrir), 8 (dois itens
 * independentes), 9 (comparativo independente), 10 (mudança de config),
 * 11 (custo entra no preço), 12 (compatibilidade operação→máquinas).
 *
 * Usa as FUNÇÕES REAIS extraídas de index.html (nunca reimplementadas) —
 * inclusive a UI do modal (orcItemExtras/orcItemExtraPreview/
 * orcItemExtrasSalvar/orcItemExtrasFechar), não só o motor de cálculo.
 *
 * Uso: node scripts/test_maquina_por_item_2026-10-28.js
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
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var afterMarker = start + marker.length;
  var openChar = html[afterMarker]; // '[' ou '{'
  var closeChar = openChar === '[' ? ']' : '}';
  var depth = 0, i = afterMarker;
  for (; i < html.length; i++) { if (html[i] === openChar) depth++; else if (html[i] === closeChar) { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

var FN_NAMES = [
  'orcProdutoNomeResolvido', 'cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  'orcGetItemExtrasTotal', 'orcRecalc', 'orcColetarItensDistribuidos', 'orcOpcaoSelecionar', 'orcMotorComercial', 'orcDistribuirParcelas',
  'cfgMaqOperInfo', '_orcMaqInfo', '_maqInfoPorMaquinaId', '_itemMaqInfo', '_cfgMaquinasCompativeis',
  'orcSincronizarEspPecasHerdadas', 'orcPecasHerdarEspessura',
  'orcItemExtras', 'orcItemExtrasFechar', 'orcItemExtrasSalvar', 'orcItemExtraPreview', 'orcExtrasCalcMaq', 'orcExtrasAplicarPreset'
];
var src = [
  'var ORC_REGRA_COMPARATIVO_ATUAL = 2;',
  extractArr('ORC_MAQ_OPS'),
  extractArr('_MAQ_KEYWORDS_POR_OP'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { ' + FN_NAMES.map(function(n){ return n + ': ' + n; }).join(', ') + ' };'
].join('\n\n');
var modPath = path.join(__dirname, '_maquina_por_item_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 2026-10-28 — Máquina selecionável por item/operação ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {}, style: {} }, props || {}); }

// RODADA CIRÚRGICA 2026-10-28 (fechamento — validação pós-relatório) —
// valores REAIS do cadastro de produção (conferidos com o usuário): Laser
// Vermelha/Verde/Metal têm Setup = R$130 cadastrado (não R$0 — achado real
// de auditoria: a primeira versão deste teste usava setup:0 nas 3 máquinas
// Laser, o que fazia os números baterem "por acidente" sem provar que o
// Setup realmente entra no custo. Nunca ignorar um campo preenchido no
// cadastro real só porque o teste antigo usava 0.).
var MAQUINAS = [
  { id: 'maq_laser_vermelha', nome: 'Laser Vermelha', unidade: 'hora', custo: 130, setup: 130 },
  { id: 'maq_laser_verde', nome: 'Laser Verde', unidade: 'hora', custo: 130, setup: 130 },
  { id: 'maq_laser_metal', nome: 'Laser Metal', unidade: 'hora', custo: 450, setup: 130 },
  { id: 'maq_dobra', nome: 'Dobradeira CNC', unidade: 'hora', custo: 80, setup: 0 }
];

function montarPedido(itensSpec, opts) {
  opts = opts || {};
  global.cfgLoad = function () {
    return {
      materiais: [{ nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }],
      financeiro: { overhead: 0, vrml: 0, impostos: 0 },
      maquinas: opts.maquinas || MAQUINAS,
      maquinasOperacoes: {}, // vínculo global LEGADO nunca configurado nesta rodada
      parcelamento: [{ parcelas: 1, taxa: 0 }]
    };
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; };

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
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    orcItemExtrasOverlay: makeEl(), m_presetSel: makeEl(), m_contornos: makeEl({value:'1'}), m_compInt: makeEl({value:'0'}),
    exAcabamento: makeEl({value:'0'}), exInstalacao: makeEl({value:'0'}), exOutros: makeEl({value:'0'}), exDesc: makeEl({value:''}),
    exPreview: makeEl(), exAjusteOp: makeEl({value:''}), exAjusteTipo: makeEl({value:'fixo'}), exAjusteValor: makeEl({value:''}),
    exAjusteEscopo: makeEl({value:'linha'}), exAjustePreview: makeEl(),
    m_laser: makeEl({ value: '0' }), m_dobra: makeEl({ value: '0' }), m_pol: makeEl({ value: '0' }),
    m_uv: makeEl({ value: '0' }), m_lixa: makeEl({ value: '0' }), m_tupia: makeEl({ value: '0' }),
    mm_laser: makeEl({ value: '' }), mm_dobra: makeEl({ value: '' }), mm_pol: makeEl({ value: '' }),
    mm_uv: makeEl({ value: '' }), mm_lixa: makeEl({ value: '' }), mm_tupia: makeEl({ value: '' }),
    m_laserManual: makeEl({ checked: false }), m_laserManualTag: makeEl(), m_laserMemBox: makeEl(), m_laserJust: makeEl({value:''}),
    m_soCorte: makeEl({checked:false}), m_soCorteMin: makeEl({value:'30'}), m_soCorte_v: makeEl()
  };
  itensSpec.forEach(function (it) {
    var idx = it.idx;
    _els['oi_qty_' + idx] = makeEl({ value: String(it.qty || 1) });
    _els['oi_larg_' + idx] = makeEl({ value: String(it.larg || 100) });
    _els['oi_alt_' + idx] = makeEl({ value: String(it.alt || 100) });
    _els['oi_mat_' + idx] = makeEl({ value: 'cfg_0', dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: 'Acrílico Cristal', esp: '3' }, text: 'Acrílico Cristal 3mm' }] });
    _els['oi_esp_' + idx] = makeEl({ value: '3' });
    _els['oi_prod_' + idx] = makeEl({ value: it.prod || ('Item ' + idx) });
    _els['oi_det_' + idx] = makeEl({ value: '' });
    _els['oi_custo_' + idx] = makeEl(); _els['oi_unit_' + idx] = makeEl(); _els['oi_tot_' + idx] = makeEl();
    _els['oi_opcaoBadge_' + idx] = makeEl();
    _els['oir_' + idx] = { dataset: { idx: idx, planArea: '0' } };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) { if (sel === '#orcItemBody tr') return itensSpec.map(function (it) { return { dataset: _els['oir_' + it.idx].dataset }; }); return []; },
    createElement: function () { return { style: {}, appendChild: function(){} }; },
    querySelector: function () { return null; },
    body: { appendChild: function(){} }
  };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global.ORC_ITEM_OPCOES = opts.opcoes || {};
  global.ORC_ITEM_MAQUINAS = opts.maquinasItem || {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.window._orcAdhPrecoSnapshot = null;
  global.showToast = function () {};
  global._MACH_PRESETS = [];
  global._orcLaserAjusteManual = false;

  mod.orcRecalc();

  return {
    els: _els,
    unit: function (idx) { return parseBRL(_els['oi_unit_' + idx].textContent); },
    total: function (idx) { return parseBRL(_els['oi_tot_' + idx].textContent); },
    finalPrice: function () { return (global.window._orcCalc || {}).finalPrice || 0; },
    // Simula o vendedor abrindo o modal "⚙️ Custos" do item, escolhendo
    // a máquina no <select> e digitando o tempo no <input>, via a UI REAL
    // (orcItemExtras/orcItemExtraPreview/orcItemExtrasSalvar).
    configurarMaquina: function (idx, opKey, machineId, minutos) {
      mod.orcItemExtras(idx); // abre o modal do item
      _els['mm_' + opKey].value = machineId || '';
      _els['m_' + opKey].value = String(minutos != null ? minutos : 0);
      mod.orcItemExtraPreview(idx); // vendedor digita/seleciona — ao vivo
      mod.orcItemExtrasSalvar(idx); // "✅ Salvar"
    },
    cancelarSemSalvar: function (idx, opKey, machineId, minutos) {
      mod.orcItemExtras(idx);
      _els['mm_' + opKey].value = machineId || '';
      _els['m_' + opKey].value = String(minutos != null ? minutos : 0);
      mod.orcItemExtraPreview(idx);
      mod.orcItemExtrasFechar(); // Cancelar, nunca Salvar
    }
  };
}

// ──────────────────────────────────────────────────────────────────────
// TESTES 1-3 — cálculo correto por máquina real (fórmula canônica,
// _itemMaqInfo — fonte única também usada por orcRecalc()/PASS 1)
// ──────────────────────────────────────────────────────────────────────
(function testes1a3() {
  // ACHADO REAL DE AUDITORIA (pós-relatório, confirmado com o usuário) —
  // Laser Vermelha/Verde/Metal têm Setup = R$130 no cadastro REAL (não
  // R$0). A fórmula é custo = tempo/60×custoHora + setup (setup cobrado 1x
  // por operação em uso, nunca por minuto) — tempo R$133,68 + setup
  // R$130,00 = R$263,68 (nunca R$133,68 isolado, que seria o cálculo SEM
  // o setup — exatamente o erro que passaria despercebido se o teste
  // continuasse usando setup:0 nas máquinas, como na 1ª versão deste
  // arquivo).
  global.cfgLoad = function () { return { maquinas: MAQUINAS, maquinasOperacoes: {} }; };
  global.ORC_ITEM_MAQUINAS = { '1': { laser: { machineId: 'maq_laser_vermelha', min: 61.7 } } };
  var infoVermelha = mod._itemMaqInfo('1', 'laser');
  ok('TESTE 1 — Laser Vermelha: Setup lido do cadastro é R$130,00 (não R$0, não ignorado)', infoVermelha.setup === 130);
  testePerto('TESTE 1 — Laser Vermelha R$130/h + Setup R$130: 61,7min ⇒ R$133,68 (tempo) + R$130,00 (setup) = R$263,68', infoVermelha.min * infoVermelha.custoMin + infoVermelha.setup, 263.68, 0.02);

  global.ORC_ITEM_MAQUINAS = { '1': { laser: { machineId: 'maq_laser_verde', min: 61.7 } } };
  var infoVerde = mod._itemMaqInfo('1', 'laser');
  testePerto('TESTE 2 — Laser Verde R$130/h + Setup R$130: 61,7min ⇒ R$263,68 (idêntico à Vermelha, mesmo custo/setup)', infoVerde.min * infoVerde.custoMin + infoVerde.setup, 263.68, 0.02);

  global.ORC_ITEM_MAQUINAS = { '1': { laser: { machineId: 'maq_laser_metal', min: 61.7 } } };
  var infoMetal = mod._itemMaqInfo('1', 'laser');
  testePerto('TESTE 3 — Laser Metal R$450/h + Setup R$130: 61,7min ⇒ R$462,75 (tempo) + R$130,00 (setup) = R$592,75', infoMetal.min * infoMetal.custoMin + infoMetal.setup, 592.75, 0.02);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 4 — trocar máquina sem alterar tempo recalcula IMEDIATAMENTE
// ──────────────────────────────────────────────────────────────────────
(function teste4() {
  var p = montarPedido([{ idx: '1' }]);
  p.configurarMaquina('1', 'laser', 'maq_laser_vermelha', 61.7);
  var infoAntes = mod._itemMaqInfo('1', 'laser');
  var custoAntes = infoAntes.min * infoAntes.custoMin + infoAntes.setup;
  var totalAntes = p.finalPrice();
  testePerto('TESTE 4 — custo com Laser Vermelha (tempo+setup) = R$263,68', custoAntes, 263.68, 0.02);

  p.configurarMaquina('1', 'laser', 'maq_laser_metal', 61.7); // mesmo tempo, máquina diferente
  var infoDepois = mod._itemMaqInfo('1', 'laser');
  var custoDepois = infoDepois.min * infoDepois.custoMin + infoDepois.setup;
  var totalDepois = p.finalPrice();
  testePerto('TESTE 4 — custo com Laser Metal (tempo+setup) = R$592,75', custoDepois, 592.75, 0.02);

  ok('TESTE 4 — trocar Laser Vermelha→Metal (mesmo tempo) recalcula o total imediatamente', Math.abs(totalDepois - totalAntes) > 300);
  // Setup (R$130) é IGUAL nas duas máquinas — cancela no delta; só a
  // diferença de custo/hora (tempo×custoMin) aparece aqui. Confirmado
  // separadamente acima (custoAntes/custoDepois) que o setup está, sim,
  // presente nos dois valores absolutos — nunca "some" ao trocar de máquina.
  testePerto('TESTE 4 — delta bate com a diferença de tempo×custo/hora entre as duas máquinas (setup igual nas duas, cancela no delta)', totalDepois - totalAntes, 462.75 - 133.68, 0.05);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 5 — trocar tempo (30→60min) com R$130/h: R$65 → R$130
// ──────────────────────────────────────────────────────────────────────
(function teste5() {
  var p = montarPedido([{ idx: '1' }]);
  p.configurarMaquina('1', 'laser', 'maq_laser_vermelha', 30);
  var custo30 = mod._itemMaqInfo('1', 'laser').min * mod._itemMaqInfo('1', 'laser').custoMin + mod._itemMaqInfo('1', 'laser').setup;
  var total30 = p.finalPrice();
  testePerto('TESTE 5 — 30min (R$130/h + Setup R$130): R$65,00 (tempo) + R$130,00 (setup) = R$195,00', custo30, 195.00, 0.02);

  p.configurarMaquina('1', 'laser', 'maq_laser_vermelha', 60);
  var custo60 = mod._itemMaqInfo('1', 'laser').min * mod._itemMaqInfo('1', 'laser').custoMin + mod._itemMaqInfo('1', 'laser').setup;
  var total60 = p.finalPrice();
  testePerto('TESTE 5 — 60min (R$130/h + Setup R$130): R$130,00 (tempo) + R$130,00 (setup) = R$260,00', custo60, 260.00, 0.02);

  // Setup é cobrado 1x "em uso" (min>0) — não varia com o tempo, só o
  // bloco de tempo varia. Delta continua R$65,00 (o setup, igual nos dois
  // momentos, cancela no delta — confirmado em absoluto acima: R$195,00 e
  // R$260,00, nunca R$65,00/R$130,00 isolados).
  testePerto('TESTE 5 — 30min→60min: delta ≈ R$65,00 (só a parcela de tempo muda; setup constante)', total60 - total30, 65.00, 0.02);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 6 — sem máquina selecionada: R$0 + alerta visível
// ──────────────────────────────────────────────────────────────────────
(function teste6() {
  var p = montarPedido([{ idx: '1' }]);
  p.configurarMaquina('1', 'laser', '', 61.7); // tempo preenchido, SEM máquina
  var info = mod._itemMaqInfo('1', 'laser');
  ok('TESTE 6 — sem máquina selecionada: custo R$0,00', info.custoMin === 0 || !info.ok);
  ok('TESTE 6 — alerta "sem máquina" visível (#orcMaqAlertaSemCusto)', p.els.orcMaqAlertaSemCusto.style.display === 'block' && /sem custo configurado para/.test(p.els.orcMaqAlertaSemCusto.textContent));
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 7 — PERSISTÊNCIA: salvar/reabrir mantém a máquina selecionada
// ──────────────────────────────────────────────────────────────────────
(function teste7() {
  global.cfgLoad = function () { return { maquinas: MAQUINAS, maquinasOperacoes: {} }; };
  global.ORC_ITEM_MAQUINAS = { '1': { laser: { machineId: 'maq_laser_vermelha', min: 61.7 } } };
  // Simula exatamente o snapshot que _orcSalvarOrcamentoImpl grava por item.
  var infoSalvar = mod._itemMaqInfo('1', 'laser');
  var itemSalvo = { maquinas: { laser: { machineId: 'maq_laser_vermelha', min: 61.7, nome: infoSalvar.nome, custoMin: infoSalvar.custoMin, setup: infoSalvar.setup } } };

  // Reabertura: ORC_ITEM_MAQUINAS é reconstruído a partir do snapshot salvo
  // (mesma lógica de orcEnvEditar) — nunca recalcula com a Config vigente.
  global.ORC_ITEM_MAQUINAS = {};
  var restaurado = {};
  Object.keys(itemSalvo.maquinas).forEach(function (opKey) {
    var s = itemSalvo.maquinas[opKey];
    restaurado[opKey] = { machineId: s.machineId, min: s.min, _snapshot: { nome: s.nome, custoMin: s.custoMin, setup: s.setup } };
  });
  global.ORC_ITEM_MAQUINAS['1'] = restaurado;

  var infoReaberto = mod._itemMaqInfo('1', 'laser');
  ok('TESTE 7 — máquina (Laser Vermelha) continua selecionada após reabrir', infoReaberto.nome === 'Laser Vermelha');
  ok('TESTE 7 — Setup (R$130) também sobrevive ao snapshot/reabertura (não só custo/hora)', infoReaberto.setup === 130);
  testePerto('TESTE 7 — tempo (61,7min) + custo + setup continuam idênticos após reabrir: R$263,68', infoReaberto.min * infoReaberto.custoMin + infoReaberto.setup, 263.68, 0.02);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 8 — dois itens com máquinas diferentes calculam independentemente
// ──────────────────────────────────────────────────────────────────────
(function teste8() {
  var p = montarPedido([{ idx: '1' }, { idx: '2' }]);
  p.configurarMaquina('1', 'laser', 'maq_laser_vermelha', 10);
  p.configurarMaquina('2', 'laser', 'maq_laser_metal', 20);

  var info1 = mod._itemMaqInfo('1', 'laser');
  var info2 = mod._itemMaqInfo('2', 'laser');
  testePerto('TESTE 8 — Item 1 (Laser Vermelha, 10min + Setup R$130): R$21,67 (tempo) + R$130,00 (setup) = R$151,67', info1.min * info1.custoMin + info1.setup, 151.67, 0.02);
  testePerto('TESTE 8 — Item 2 (Laser Metal, 20min + Setup R$130): R$150,00 (tempo) + R$130,00 (setup) = R$280,00', info2.min * info2.custoMin + info2.setup, 280.00, 0.02);
  ok('TESTE 8 — os dois itens coexistem no MESMO pedido sem um sobrescrever o outro', info1.nome === 'Laser Vermelha' && info2.nome === 'Laser Metal');
  ok('TESTE 8 — cada item paga seu PRÓPRIO Setup (2 setups de R$130, um por item, nunca um só para o pedido)', info1.setup === 130 && info2.setup === 130);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 9 — COMPARATIVO: cada alternativa mantém sua máquina/tempo/custo
// ──────────────────────────────────────────────────────────────────────
(function teste9() {
  var opcoes = { '1': { grupoId: 'g1', selecionada: true, escolhaConfirmada: false }, '2': { grupoId: 'g1', selecionada: false, escolhaConfirmada: false } };
  var p = montarPedido([{ idx: '1' }, { idx: '2' }], { opcoes: opcoes });
  p.configurarMaquina('1', 'laser', 'maq_laser_vermelha', 10); // alternativa A
  p.configurarMaquina('2', 'laser', 'maq_laser_metal', 10);    // alternativa B

  var infoA = mod._itemMaqInfo('1', 'laser');
  var infoB = mod._itemMaqInfo('2', 'laser');
  ok('TESTE 9 — alternativa A usa Laser Vermelha (não herdou a máquina de B)', infoA.nome === 'Laser Vermelha');
  ok('TESTE 9 — alternativa B usa Laser Metal (não herdou a máquina de A)', infoB.nome === 'Laser Metal');
  testePerto('TESTE 9 — custo de A (R$130/h×10min+Setup R$130 = R$151,67) independente de B', infoA.min * infoA.custoMin + infoA.setup, 151.67, 0.02);
  testePerto('TESTE 9 — custo de B (R$450/h×10min+Setup R$130 = R$205,00) independente de A', infoB.min * infoB.custoMin + infoB.setup, 205.00, 0.02);

  // Confirma a escolha de A — B nunca entra no total, mas continua com seu
  // PRÓPRIO custo calculável (preço informativo, nunca compartilhado).
  mod.orcOpcaoSelecionar('1');
  var infoBDepois = mod._itemMaqInfo('2', 'laser');
  ok('TESTE 9 — depois da escolha de A, B continua com sua própria máquina (Metal), nunca reseta', infoBDepois.nome === 'Laser Metal');
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 10 — mudança de custo na Config: novo cálculo usa o novo custo;
// item com snapshot (histórico) respeita a taxa congelada.
// ──────────────────────────────────────────────────────────────────────
(function teste10() {
  // "Hoje": Laser Vermelha R$130/h + Setup R$130, item NOVO (sem
  // snapshot) lê a Config vigente.
  global.cfgLoad = function () { return { maquinas: MAQUINAS, maquinasOperacoes: {} }; };
  global.ORC_ITEM_MAQUINAS = { '1': { laser: { machineId: 'maq_laser_vermelha', min: 60 } } };
  var infoHoje = mod._itemMaqInfo('1', 'laser');
  testePerto('TESTE 10 — item novo, Config R$130/h+Setup R$130: custo = R$130,00+R$130,00 = R$260,00', infoHoje.min * infoHoje.custoMin + infoHoje.setup, 260.00, 0.01);

  // Config muda para R$150/h (Setup continua R$130) — item NOVO (sem
  // snapshot) usa o valor novo.
  var MAQUINAS_NOVO_PRECO = MAQUINAS.map(function (m) { return m.id === 'maq_laser_vermelha' ? Object.assign({}, m, { custo: 150 }) : m; });
  global.cfgLoad = function () { return { maquinas: MAQUINAS_NOVO_PRECO, maquinasOperacoes: {} }; };
  var infoNovoPreco = mod._itemMaqInfo('1', 'laser');
  testePerto('TESTE 10 — Config mudou p/ R$150/h: item NOVO usa o custo/hora vigente (R$150,00+R$130,00 = R$280,00)', infoNovoPreco.min * infoNovoPreco.custoMin + infoNovoPreco.setup, 280.00, 0.01);

  // Item HISTÓRICO (reaberto, com _snapshot congelado em R$130/h+Setup
  // R$130) NUNCA recalcula com o novo preço de R$150/h.
  global.ORC_ITEM_MAQUINAS = { '1': { laser: { machineId: 'maq_laser_vermelha', min: 60, _snapshot: { nome: 'Laser Vermelha', custoMin: 130 / 60, setup: 130 } } } };
  var infoHistorico = mod._itemMaqInfo('1', 'laser');
  testePerto('TESTE 10 — item HISTÓRICO (snapshot) continua em R$260,00 (R$130/h+Setup R$130), mesmo com Config em R$150/h', infoHistorico.min * infoHistorico.custoMin + infoHistorico.setup, 260.00, 0.01);
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 11 — custo de máquina entra EFETIVAMENTE no preço (markup/subtotal/total)
// ──────────────────────────────────────────────────────────────────────
(function teste11() {
  var pSemMaquina = montarPedido([{ idx: '1' }]);
  var totalSemMaquina = pSemMaquina.finalPrice();

  var pComMaquina = montarPedido([{ idx: '1' }]);
  pComMaquina.configurarMaquina('1', 'laser', 'maq_laser_vermelha', 61.7);
  var totalComMaquina = pComMaquina.finalPrice();

  ok('TESTE 11 — preço final MUDA quando a máquina é configurada (não é só visual)', totalComMaquina > totalSemMaquina);
  // factor=1 (overhead/vrml/impostos=0 no harness) → delta = custo de
  // máquina direto, JÁ incluindo o Setup de R$130 (tempo R$133,68 + setup
  // R$130,00 = R$263,68) — nunca só a parcela de tempo isolada.
  testePerto('TESTE 11 — delta no preço final bate com o custo da máquina, tempo+setup (R$263,68)', totalComMaquina - totalSemMaquina, 263.68, 0.05);
  ok('TESTE 11 — UI (oi_unit_/oi_tot_), custo do item (_itemMaqInfo) e preço final (finalPrice) usam a MESMA fórmula/valor — nenhuma camada mostra um número diferente das outras', Math.abs((pComMaquina.unit('1') * 1) - pComMaquina.total('1')) < 0.01 && Math.abs(pComMaquina.total('1') - totalComMaquina) < 0.01);
})();

// ──────────────────────────────────────────────────────────────────────
// EXTRA — Cancelar o modal (sem Salvar) nunca persiste a máquina/tempo
// ──────────────────────────────────────────────────────────────────────
(function testeCancelar() {
  var p = montarPedido([{ idx: '1' }]);
  p.configurarMaquina('1', 'laser', 'maq_laser_vermelha', 10); // salvo de verdade
  var totalAntes = p.finalPrice();

  p.cancelarSemSalvar('1', 'laser', 'maq_laser_metal', 999); // nunca clica "Salvar"
  var totalDepois = p.finalPrice();

  ok('EXTRA — Cancelar o modal não persiste a troca de máquina/tempo', ORC_ITEM_MAQUINAS['1'].laser.machineId === 'maq_laser_vermelha' && ORC_ITEM_MAQUINAS['1'].laser.min === 10);
  testePerto('EXTRA — total do pedido não muda ao cancelar', totalDepois, totalAntes, 0.01);
})();

// ──────────────────────────────────────────────────────────────────────
// EXTRA 2 — o <select> renderizado na UI mostra as máquinas REAIS vindas
// de Configuração → Máquinas (nunca uma lista hardcoded/mockada)
// ──────────────────────────────────────────────────────────────────────
(function testeSelectReal() {
  var p = montarPedido([{ idx: '1' }]);
  mod.orcItemExtras('1'); // abre o modal — renderiza o HTML completo, inclusive os <select> de máquina
  var htmlModal = p.els.orcItemExtrasOverlay.innerHTML;
  ok('EXTRA 2 — select da operação Laser contém a opção "Laser Vermelha" (vinda do cadastro real)', /<option value="maq_laser_vermelha"[^>]*>Laser Vermelha<\/option>/.test(htmlModal));
  ok('EXTRA 2 — select da operação Laser contém a opção "Laser Verde" (vinda do cadastro real)', /<option value="maq_laser_verde"[^>]*>Laser Verde<\/option>/.test(htmlModal));
  ok('EXTRA 2 — select da operação Laser contém a opção "Laser Metal" (vinda do cadastro real)', /<option value="maq_laser_metal"[^>]*>Laser Metal<\/option>/.test(htmlModal));
  ok('EXTRA 2 — select da operação Dobra NÃO contém nenhuma opção Laser (compatibilidade respeitada na UI, não só no backend)', !/id="mm_dobra"[^]*?<option value="maq_laser[^]*?<\/select>/.test(htmlModal.replace(/\n/g, '')));
})();

// ──────────────────────────────────────────────────────────────────────
// TESTE 12 — compatibilidade operação→máquinas (Dobra não lista Laser)
// ──────────────────────────────────────────────────────────────────────
(function teste12() {
  global.cfgLoad = function () { return { maquinas: MAQUINAS, maquinasOperacoes: {} }; };
  var compativeisLaser = mod._cfgMaquinasCompativeis('laser');
  var compativeisDobra = mod._cfgMaquinasCompativeis('dobra');
  ok('TESTE 12 — operação Laser lista as 3 máquinas Laser (Vermelha/Verde/Metal)', compativeisLaser.length === 3 && compativeisLaser.every(function (m) { return /laser/i.test(m.nome); }));
  ok('TESTE 12 — operação Dobra NÃO lista nenhuma máquina Laser (nunca "sem sentido")', compativeisDobra.every(function (m) { return !/laser/i.test(m.nome); }));
  ok('TESTE 12 — operação Dobra lista a Dobradeira CNC', compativeisDobra.some(function (m) { return m.id === 'maq_dobra'; }));
})();

console.log('\n' + (failed === 0 ? '✅ TODOS OS TESTES PASSARAM' : '❌ ' + failed + ' TESTE(S) FALHARAM') + ' (' + passed + ' passou/passaram, ' + failed + ' falhou/falharam)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
