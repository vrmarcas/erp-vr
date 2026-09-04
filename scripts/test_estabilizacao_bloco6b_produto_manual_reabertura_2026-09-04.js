/**
 * test_estabilizacao_bloco6b_produto_manual_reabertura_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 6 (gap adicional) — achado no
 * SMOKE EM PRODUÇÃO após o fix de orcProdutoNomeResolvido(): salvar um
 * item com produto digitado manualmente ("Aparador TESTE...") persiste o
 * nome real corretamente (confirmado em produção), MAS reabrir esse
 * orçamento para EDITAR deixava o <select> do produto em BRANCO — o
 * <select> nativo ignora silenciosamente um `.value = "Aparador..."` sem
 * nenhuma <option> correspondente. Reproduzido ao vivo: reabrir
 * ORC-000106 (VR Marcas) mostrava o produto do item 2 vazio no dropdown.
 *
 * Risco real: reabrir e clicar "Salvar" de novo sem tocar nesse item
 * reescreveria `prod` como STRING VAZIA (orcProdutoNomeResolvido não acha
 * texto nenhum num <select> sem seleção), apagando o nome real que já
 * estava correto — uma via NOVA de perda de dado, pior que o bug
 * original porque acontece silenciosamente numa reabertura comum.
 *
 * Corrigido em orcEnvEditar(): depois de setV('oi_prod_'+ri, it.prod),
 * se o value não colou (nenhuma option igual), sintetiza a option
 * __typed__ com o nome salvo — mesmo padrão já usado em
 * orcRefreshProdSelects() para preservar produto personalizado.
 *
 * Reaproveita o harness de
 * test_rodada_correcao_definitiva_orcamento_reabrir_e2e_2026-09-01.js
 * (DOM fake auto-vivificante, mesmo padrão desta suíte de reabertura).
 *
 * Uso: node scripts/test_estabilizacao_bloco6b_produto_manual_reabertura_2026-09-04.js
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

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 6b — produto manual sobrevive à reabertura ===\n');

var FN_NAMES = [
  'orcFmt', 'orcEnvNormalizar', 'orcItemVRRestaurarDados', 'setBrand',
  'orcSyncStep3Result', 'orcUpdateSummary', 'orcAddItem', 'orcResetFormularioVR',
  'orcRecalc', 'orcStep', 'orcAplicarSnapshotCongelado', 'orcEnvEditar',
  'orcProdutoNomeResolvido',
];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_estabilizacao_bloco6b_produto_manual_reabertura.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake — mesmo padrão de
// test_rodada_correcao_definitiva_orcamento_reabrir_e2e_2026-09-01.js,
// com <select>.add() real (necessário para sintetizar a option __typed__).
var _els;
function makeEl(id) {
  var _classes = {};
  var _value = '';
  var el = {
    id: id || '', textContent: '', innerHTML: '', disabled: false, checked: false,
    style: {}, dataset: {},
    classList: {
      add: function (c) { _classes[c] = true; },
      remove: function (c) { delete _classes[c]; },
      contains: function (c) { return !!_classes[c]; }
    },
    appendChild: function () {}, insertBefore: function () {}, remove: function () {}, focus: function () {},
    // Para o <select> de produto, simula um catálogo real já carregado
    // (com 'Caixa', o produto usado no cenário de regressão abaixo) —
    // um <select> de produto de verdade sempre tem as opções do catálogo
    // populadas ANTES de orcEnvEditar() rodar (carregadas no boot da
    // página), nunca vazio feito o DOM fake genérico de outros testes.
    options: /^oi_prod_/.test(id || '')
      ? [{ dataset: {}, text: '', value: '' }, { dataset: {}, text: 'Caixa', value: 'Caixa' }]
      : [{ dataset: {}, text: '', value: '' }],
    selectedIndex: 0,
    add: function (opt) { el.options.push(opt); el.selectedIndex = el.options.length - 1; _value = opt.value; }
  };
  // Semântica REAL de <select>.value — reproduz o comportamento nativo do
  // browser que causou o bug: atribuir um value sem NENHUMA <option>
  // correspondente falha silenciosamente (fica em branco/selectedIndex
  // -1), nunca "aceita" o texto livre. Restrito aos <select> de produto
  // (id "oi_prod_*", os únicos que este teste sintetiza <option> para) —
  // todo outro elemento (input/textarea/etc.) continua aceitando
  // qualquer valor livremente, como sempre.
  var _ehSelectProduto = /^oi_prod_/.test(id || '');
  if (_ehSelectProduto) {
    Object.defineProperty(el, 'value', {
      get: function () { return _value; },
      set: function (v) {
        if (v == null || v === '') { _value = ''; el.selectedIndex = -1; return; }
        var idx = -1;
        for (var i = 0; i < el.options.length; i++) { if (el.options[i].value === v) { idx = i; break; } }
        if (idx >= 0) { _value = v; el.selectedIndex = idx; }
        else { _value = ''; el.selectedIndex = -1; } // <select> nativo: sem match, fica vazio
      },
      enumerable: true, configurable: true
    });
  } else {
    el.value = '';
  }
  return el;
}
function reset() {
  _els = {};
  global.orcItemCount = 0;
  global.document = {
    body: makeEl('body'),
    createElement: function () { return makeEl(); },
    getElementById: function (id) { return _els[id] || (_els[id] = makeEl(id)); },
    querySelector: function (sel) {
      if (sel === '.orc-steps') return makeEl();
      return null;
    },
    querySelectorAll: function (sel) {
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
  global.setTimeout = function (fn) { if (typeof fn === 'function') fn(); return 0; };
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
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════
// CENÁRIO — orçamento salvo com 1 item de produto DIGITADO MANUALMENTE
// ("Aparador TESTE"). Reabrir (orcEnvEditar) tem que repopular o
// <select> mostrando o nome real, nunca em branco.
// ══════════════════════════════════════════════════════════════════════
(function () {
  reset();
  global._ORC_ENVIADOS_DATA = [{
    id: 'orcManual1', num: '000106', cliente: 'TESTE SMOKE', tel: '', email: '',
    vendedor: 'Gabriel', marca: 'vr', status: 'aguardando', dataSalvo: '04/09/2026',
    valorFinal: 5.08, valorBase: 5.08,
    itens: [
      { prod: 'Aparador TESTE 2026-09-04 (apagar)', qty: '1', larg: '10', alt: '10', matKey: 'cfg_0', mat: 'Acrílico Cristal 2mm', det: '', unit: 'R$ 5,01', total: 'R$ 5,08' }
    ],
    snapshotCompleto: { breakdown: { totalCost: 5.08, matTotal: 5.08 }, parametros: {} }
  }];
  mod.orcEnvEditar('orcManual1');

  var sel = _els['oi_prod_1'];
  assertTrue(!!sel, 'pré-condição: select do produto do item 1 existe');
  assertEq(sel.value, '__typed__', 'select fica com value=__typed__ (sentinel interno), nunca vazio');
  var optSelecionada = sel.options[sel.selectedIndex];
  assertTrue(!!optSelecionada, 'há uma option selecionada (nunca selectedIndex órfão)');
  assertEq(optSelecionada && optSelecionada.text, 'Aparador TESTE 2026-09-04 (apagar)', 'texto da option sintetizada é o nome REAL salvo, nunca em branco');
  assertEq(mod.orcProdutoNomeResolvido('1'), 'Aparador TESTE 2026-09-04 (apagar)', 'orcProdutoNomeResolvido() resolve o nome real após reabrir — pronto para salvar de novo sem perder o dado');
})();

// ══════════════════════════════════════════════════════════════════════
// REGRESSÃO — produto de CATÁLOGO (não digitado) continua reabrindo
// normalmente, sem sintetizar nenhuma option extra.
// ══════════════════════════════════════════════════════════════════════
(function () {
  reset();
  global._ORC_ENVIADOS_DATA = [{
    id: 'orcCatalogo1', num: '000107', cliente: 'Cliente Normal', tel: '', email: '',
    vendedor: 'Gabriel', marca: 'vr', status: 'aguardando', dataSalvo: '04/09/2026',
    valorFinal: 130.10, valorBase: 130.10,
    itens: [
      { prod: 'Caixa', qty: '1', larg: '20', alt: '20', matKey: 'cfg_0', mat: 'Acrílico Cristal 2mm', det: '', unit: 'R$ 127,80', total: 'R$ 130,10' }
    ],
    snapshotCompleto: { breakdown: { totalCost: 130.10, matTotal: 23.38 }, parametros: {} }
  }];
  mod.orcEnvEditar('orcCatalogo1');

  var sel = _els['oi_prod_1'];
  assertEq(sel.value, 'Caixa', 'produto de catálogo continua reabrindo com o value normal (nome do produto), sem sintetizar option');
  assertEq(sel.options.length, 2, 'nenhuma option extra sintetizada para produto de catálogo (só as 2 options padrão do DOM fake: em branco + Caixa)');
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
