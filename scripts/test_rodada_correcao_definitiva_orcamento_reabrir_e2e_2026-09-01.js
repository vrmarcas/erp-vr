/**
 * test_rodada_correcao_definitiva_orcamento_reabrir_e2e_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA, Bloco 2 — fecha o gap de cobertura
 * identificado na investigação de 2026-09-01: "não existe teste
 * automatizado que exercite o fluxo real de UI orcEnvEditar(id) de ponta a
 * ponta (abrir → estado do DOM/resumo)". O teste existente
 * (test_estabilizacao_bloco_a_b_orcamento_2026-08-23.js) só faz asserção
 * estática (regex) sobre a estrutura de try/catch — nunca RODA a função.
 *
 * CONCLUSÃO DA INVESTIGAÇÃO (2026-09-01): não há bug de código em `master`
 * — orcEnvEditar() já tem o try/catch + setBrand() corretos. O sintoma
 * relatado ("Cliente vazio/Itens 0/Custo R$0/Total R$0" ao reabrir) foi
 * causado por um INCIDENTE DE DEPLOY (produção servindo
 * feat/valeria-atendimentos-mvp-2026-08-21 em vez de master por horas —
 * ver scripts/guard_deploy_branch.js, que já bloqueia isso). Este teste
 * não prova um bug novo — fecha a lacuna de cobertura para que uma
 * FUTURA regressão real neste caminho seja pega automaticamente.
 *
 * Roda orcEnvEditar() de verdade (não reimplementada) contra um DOM
 * fake, para dois schemas reais (legado VR e ValerIA), e verifica que o
 * Cliente/Itens/Custo/Total do resumo terminam com os valores corretos
 * — nunca zerados — exatamente os 4 campos citados no bug original.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * orcEnvEditar, orcEnvNormalizar, orcResetFormularioVR, orcAddItem,
 * orcItemVRRestaurarDados, orcRecalc, orcStep, orcSyncStep3Result,
 * orcUpdateSummary, orcAplicarSnapshotCongelado, setBrand, orcFmt.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_orcamento_reabrir_e2e_2026-09-01.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) { console.log('  ❌  ' + msg + '\n       esperado ' + e + '\n       obtido   ' + g); failed++; }
  else { console.log('  ✅  ' + msg); passed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — orcEnvEditar() de ponta a ponta (Cliente/Itens/Custo/Total) ===\n');

var FN_NAMES = [
  'orcFmt', 'orcEnvNormalizar', 'orcItemVRRestaurarDados', 'setBrand',
  'orcSyncStep3Result', 'orcUpdateSummary', 'orcAddItem', 'orcResetFormularioVR',
  'orcRecalc', 'orcStep', 'orcAplicarSnapshotCongelado', 'orcEnvEditar',
];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_rodada_correcao_definitiva_orcamento_reabrir_e2e.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake genérico: qualquer id nunca visto antes se auto-cria em
// branco na hora (mesmo padrão de outros testes deste repo, ex.
// test_orc_cr_placeholder_duplicado_2026-08-11.js) — cobre as dezenas de
// ids que orcEnvEditar()/orcRecalc()/orcStep() tocam sem precisar listar
// cada um manualmente.
var _els;
function makeEl(id) {
  var _classes = {};
  return {
    id: id || '', value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
    style: {}, dataset: {},
    classList: {
      add: function (c) { _classes[c] = true; },
      remove: function (c) { delete _classes[c]; },
      contains: function (c) { return !!_classes[c]; }
    },
    appendChild: function () {}, insertBefore: function () {}, remove: function () {}, focus: function () {},
    options: [{ dataset: {}, text: '', value: '' }], selectedIndex: 0
  };
}
function reset() {
  _els = {};
  global.orcItemCount = 0; // incrementado pelo orcAddItem() REAL (extraído) — bare identifier, cai no global (non-strict)
  global.document = {
    body: makeEl('body'),
    createElement: function () { return makeEl(); },
    getElementById: function (id) { return _els[id] || (_els[id] = makeEl(id)); },
    querySelector: function (sel) {
      if (sel === '.orc-steps') return makeEl();
      return null;
    },
    querySelectorAll: function (sel) {
      // Deriva a lista de linhas AO VIVO de global.orcItemCount (mantido
      // pelo orcAddItem() real a cada chamada) — nunca uma cópia
      // reconstruída depois, para não desalinhar da sequência real de
      // orcRecalc()/orcUpdateSummary()/orcAplicarSnapshotCongelado()
      // dentro de orcEnvEditar().
      if (sel === '#orcItemBody tr' || sel === '#orcItemBody tr[data-idx]') {
        var out = [];
        for (var i = 1; i <= (global.orcItemCount || 0); i++) out.push({ dataset: { idx: String(i) } });
        return out;
      }
      if (sel === '.orc-pg') return [makeEl(), makeEl(), makeEl(), makeEl(), makeEl(), makeEl()];
      return [];
    }
  };
  global.window = global;
  global.setTimeout = function (fn) { if (typeof fn === 'function') fn(); return 0; }; // síncrono — sem esperar 100ms/0ms de verdade
  global.ORC_TIPO = null;
  global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = [];
  global._orcHidratando = false;
  global._orcMostrandoCongelado = false;
  global._orcClienteAprovado = false;
  global._orcCalc = {};
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; };
  global._currentSession = { user: 'Vendedor Teste' };
  global._toasts = []; global.showToast = function (msg, tipo) { global._toasts.push({ msg: msg, tipo: tipo }); };
  global.nav = function () {};
  global.orcEscolhaFluxo = function () {};
  global.orcIniciarFluxoVR = function () {};
  global.orcMatChanged = function () {};
  global.orcAutoLaserSeNecessario = function () {};
  global.orcProdutosCanonicos = function () { return []; };
  global.planProdLoad = function () { return []; };
  global.ORC_PRODUTOS = [];
  global.orcConstruirMatOpts = function () { return ''; };
  global.orcVitreRenderLista = function () {};
  global.vitreCatalogoInit = function () {};
  global.orcResetCondicoesPagamentoCompartilhadas = function () {};
  global.orcSalvarOrcamento = function () {};
  global.orcPreencherPrazoAuto = function () {};
  global.orcLoadMatPrecos = function () {};
  global.orcToggleParc = function () {};
  global.orcTogglePixDisc = function () {};
  global.orcAtualizarIconePgto = function () {};
  global.orcPgtoAtualizarValorReceber = function () {};
  global._orcAtualizarVisibilidadeEnvio = function () {};
  global.orcGetEnviados = function () { return global._ORC_ENVIADOS_DATA || []; };
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.orcItemDescricaoComercial = function (item) { return item.prod || 'Item'; };
  global.osItemMateriaisResumo = function () { return ''; };
  global.orcOpcaoSelecionar = function () {};
  global.orcSetV = function (id, v) { var el = _els[id] || (_els[id] = makeEl(id)); el.value = v; };
  global.orcGetItemExtrasTotal = function () { return 0; };
  global.orcMotorPagamento = function (v) { return { afterPix: v }; };
  // orcAddItem() cria linhas reais via document.createElement/tbody.
  // appendChild (stub, não gera HTML de verdade) — mantemos _rows em
  // paralelo, no mesmo pulso de orcItemCount, para querySelectorAll
  // devolver a contagem certa de linhas (usada por orcUpdateSummary).
  var _origIncCount = 0;
}

function parseReais(txt) { return parseFloat(String(txt || '').replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0; }

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════════
// CENÁRIO 1 — Orçamento schema LEGADO VR (cliente/tel/valorFinal diretos)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset();
  global._ORC_ENVIADOS_DATA = [{
    id: 'orcLegado1', num: '000123', cliente: 'Maria Oliveira', tel: '11999998888', email: 'maria@teste.com',
    vendedor: 'João', marca: 'vr', status: 'aguardando', dataSalvo: '01/09/2026',
    valorFinal: 1250.50, valorBase: 1250.50,
    itens: [
      { prod: 'Placa Acrílico', qty: '2', larg: '30', alt: '20', matKey: 'ac3', mat: 'Acrílico 3mm', det: '', unit: 'R$ 100,00', total: 'R$ 200,00' },
      { prod: 'Display', qty: '1', larg: '40', alt: '40', matKey: 'ac5', mat: 'Acrílico 5mm', det: 'polido', unit: 'R$ 50,00', total: 'R$ 50,00' }
    ],
    snapshotCompleto: { breakdown: { totalCost: 400, matTotal: 400 }, parametros: {} }
  }];

  mod.orcEnvEditar('orcLegado1');
  var n = global.orcItemCount;

  assertEq(n, 2, '1a. orcEnvEditar() (schema legado VR) restaura exatamente 2 itens (orcAddItem chamado 2x)');
  assertEq(_els['orcClientNome'].value, 'Maria Oliveira', '1b. Cliente restaurado corretamente — NUNCA vazio (sintoma original do bug)');
  assertEq(_els['orcClientTel'].value, '11999998888', '1c. Telefone restaurado corretamente');
  assertEq(_els['oi_qty_1'].value, '2', '1d. Item 1 — quantidade restaurada (2)');
  assertEq(_els['oi_qty_2'].value, '1', '1e. Item 2 — quantidade restaurada (1)');
  assertEq(_els['oi_det_2'].value, 'polido', '1f. Item 2 — detalhe/acabamento restaurado');
  assertTrue(_els['orcRsmItens'].textContent !== '0un', '1g. Resumo "Itens" NUNCA mostra 0un (sintoma original do bug) — obtido: ' + _els['orcRsmItens'].textContent);
  assertEq(_els['orcRsmItens'].textContent, '3un', '1h. Resumo "Itens" soma as QUANTIDADES reais (2+1=3un), não a contagem de linhas');
  assertTrue(parseReais(_els['orcRsmCusto'].textContent) > 0, '1i. Resumo "Custo" NUNCA R$0,00 (sintoma original do bug) — obtido: ' + _els['orcRsmCusto'].textContent);
  assertEq(parseReais(_els['orcRsmCusto'].textContent), 400, '1j. Resumo "Custo" reflete o breakdown.totalCost do snapshot salvo (R$400,00) — congelado, nunca recalculado com preço/config atual');
  assertTrue(parseReais(_els['orcRsmTotal'].textContent) > 0, '1k. Resumo "Total" NUNCA R$0,00 (sintoma original do bug) — obtido: ' + _els['orcRsmTotal'].textContent);
  assertEq(parseReais(_els['orcRsmTotal'].textContent), 1250.50, '1l. Resumo "Total" reflete o valorFinal salvo (R$1.250,50) — congelado (orcAplicarSnapshotCongelado)');
})();

// ══════════════════════════════════════════════════════════════════════════
// CENÁRIO 2 — Orçamento schema ValerIA (n/nomeCliente/telCliente/total)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset();
  global._ORC_ENVIADOS_DATA = [{
    id: 'orcValeria1', n: '000456', nomeCliente: 'Pedro Souza', telCliente: '21988887777',
    vendedor: 'Valéria (WhatsApp)', marca: 'vr', status: 'aguardando', dataSalvo: '01/09/2026',
    total: 890.00,
    itens: [
      { prod: 'Troféu', qty: '3', larg: '15', alt: '15', matKey: 'ac3', mat: 'Acrílico 3mm', det: '', unit: 'R$ 100,00', total: 'R$ 300,00' }
    ],
    snapshotCompleto: { breakdown: { totalCost: 150 }, parametros: {} }
  }];
  mod.orcEnvEditar('orcValeria1');
  var n = global.orcItemCount;

  assertEq(n, 1, '2a. orcEnvEditar() (schema ValerIA) restaura o item corretamente mesmo com nomes de campo diferentes (n/nomeCliente/telCliente/total)');
  assertEq(_els['orcClientNome'].value, 'Pedro Souza', '2b. Cliente restaurado a partir de nomeCliente (schema ValerIA) — via orcEnvNormalizar()');
  assertEq(_els['orcClientTel'].value, '21988887777', '2c. Telefone restaurado a partir de telCliente (schema ValerIA)');
  assertTrue(parseReais(_els['orcRsmTotal'].textContent) > 0, '2d. Resumo "Total" (schema ValerIA) NUNCA R$0,00');
  assertEq(parseReais(_els['orcRsmTotal'].textContent), 890.00, '2e. Resumo "Total" reflete o campo .total (schema ValerIA), via orcEnvNormalizar()');
})();

// ══════════════════════════════════════════════════════════════════════════
// 3 — Orçamento inexistente: nunca lança exceção, avisa e não mexe no DOM.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset();
  global._ORC_ENVIADOS_DATA = [];
  global._toasts = [];
  var threw = false;
  try { mod.orcEnvEditar('id-que-nao-existe'); } catch (e) { threw = true; }
  assertTrue(!threw, '3a. orcEnvEditar() com id inexistente nunca lança exceção');
  assertTrue(global._toasts.some(function (t) { return t.tipo === 'warn'; }), '3b. Avisa com toast ("Orçamento não encontrado")');
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
