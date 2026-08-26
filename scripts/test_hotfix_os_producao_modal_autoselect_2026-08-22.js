/**
 * test_hotfix_os_producao_modal_autoselect_2026-08-22.js
 *
 * RODADA 9, BLOCO B (2026-08-22) — complementa
 * test_hotfix_os_estoque_retalho_iniciar_producao_2026-08-22.js (lógica
 * pura de retalho) testando o comportamento REAL do modal "Iniciar
 * Produção": pré-seleção automática do material herdado da planificação
 * (os.esp/os.matNomeBase, escritos por orcEnvGerarOS — RODADA 9, Bloco B)
 * e o aviso visível quando o carregamento de Estoque/Retalhos falhou de
 * verdade (antes, só console.warn — indistinguível de "nada cadastrado").
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _kbOpenProdOverlay, kbProdSetTipo, kbProdOnMatChange, kbProdCheckStock,
 * kbSugerirMaterial, kbSugestaoHtml, kbNecessidadesPecasOS,
 * kbNecessidadeDimsOS, kbRetalhoCobertura, kbRetalhoCabeGeometricamente,
 * kbCalcAreaOS, kbMargemSegurancaRetalhoCm, kbParseDimsWH, kbParseDimsArea,
 * _kbRetalhoOptionLabel, cfgEsc.
 *
 * Uso: node scripts/test_hotfix_os_producao_modal_autoselect_2026-08-22.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { console.log('  ✅  ' + msg); passed++; }
  else { console.log('  ❌  ' + msg + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
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

// RODADA CRÍTICA 2026-08-26 — _kbOpenProdOverlay() passou a aguardar
// confirmação real do servidor (_stockServerConfirmed/_CLOUD_WATCH_CONFIRMED)
// antes de popular os selects, com um ciclo de espera/retry — ver
// scripts/test_rodada_critica_leitura_iniciar_producao_2026-08-26.js para
// os testes dedicados a esse ciclo. Este arquivo testa a lógica de
// auto-seleção/avisos, que roda DEPOIS da confirmação — por isso o reset()
// abaixo agora marca os dados como já confirmados por padrão (mesmo
// comportamento síncrono que este arquivo sempre testou), e extrai as
// novas funções/variável de apoio que _kbOpenProdOverlay passou a chamar.
var FN_NAMES = ['_kbOpenProdOverlay', '_kbProdDadosProntos', '_kbProdMostrarCarregando', '_kbProdMostrarFalhaCarregamento', '_kbProdTentarNovamente', '_kbProdAguardarDadosERenderizar', '_kbProdRenderSelects', 'kbCloseProd', 'kbProdSetTipo', 'kbProdOnMatChange', 'kbProdCheckStock', 'kbSugerirMaterial', 'kbSugestaoHtml', 'kbNecessidadesPecasOS', 'kbNecessidadeDimsOS', 'kbRetalhoCobertura', 'kbRetalhoCabeGeometricamente', 'kbCalcAreaOS', 'kbMargemSegurancaRetalhoCm', 'kbParseDimsWH', 'kbParseDimsArea', '_kbRetalhoOptionLabel', 'cfgEsc'];
global.window = global;
global.cfgLoad = function () { return { producao: {} }; };
function extractVar(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}
var src = extractVar('_kbProdOverlayEpoch') + '\n\n' + FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_os_producao_modal_extracted.tmp.js');
fs.writeFileSync(modPath, src);

var _els = {};
function makeEl() {
  var el = { value: '', style: {}, innerHTML: '', disabled: false, querySelector: function () { return null; } };
  var _open = false;
  el.classList = {
    add: function (c) { if (c === 'open') _open = true; },
    remove: function (c) { if (c === 'open') _open = false; },
    contains: function (c) { return c === 'open' ? _open : false; },
  };
  return el;
}
global.document = {
  getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); },
  querySelector: function () { return _els['__submitBtn'] || (_els['__submitBtn'] = makeEl()); },
};
var _toasts = [];
global.showToast = function (msg, kind) { _toasts.push({ msg: msg, kind: kind }); };
// _kbProdAguardarDadosERenderizar agenda retries via setTimeout quando os
// dados ainda não confirmaram — este arquivo testa o caminho já
// confirmado (síncrono), então nenhum teste aqui depende de um timer
// realmente disparar; um stub simples evita processo pendurado se algum
// cenário cair no ramo de espera por engano (sinal de regressão real).
global.setTimeout = function () {};

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

function reset() {
  Object.keys(_els).forEach(function (k) { delete _els[k]; });
  _toasts.length = 0;
  global._kbProdEditMode = false;
  global._kbProdTipo = 'chapa';
  global.RETALHOS = [];
  global._STOCK_LOAD_ERROR = false;
  global._CLOUD_WATCH_ERROR = {};
  // Dados já confirmados pelo servidor por padrão — este arquivo testa a
  // lógica de auto-seleção/avisos, que roda depois da confirmação (ver
  // comentário acima). Testes que simulam erro real de carregamento
  // (_STOCK_LOAD_ERROR/_CLOUD_WATCH_ERROR) sobrescrevem isto abaixo.
  global._stockServerConfirmed = true;
  global._CLOUD_WATCH_CONFIRMED = { retalhos: true };
  // _kbOpenProdOverlay agenda kbProdOnMatChange/kbProdCheckStock via
  // setTimeout(...,50) quando o material já vem pré-selecionado — dispara
  // DEPOIS do teste síncrono terminar; precisa de KB_OS/_kbOsId no escopo
  // para não estourar uma exceção não tratada no processo.
  global.KB_OS = {};
  global._kbOsId = null;
}

console.log('\n=== RODADA 9, Bloco B — modal Iniciar Produção: auto-seleção + aviso de falha ===\n');

// ── Pré-seleção automática por os.esp (achado real: campo nunca era escrito) ──
(function () {
  reset();
  global.STOCK = { ac3: { label: 'Acrílico Cristal', esp: 3, cor: '', qty: 10 } };
  var os = { num: '10', id: 'osA', esp: 3, itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  mod._kbOpenProdOverlay(os);
  assertEq(_els['kbProdMatSel'].value, 'ac3', '1. os.esp herdado da planificação pré-seleciona a única chapa daquela espessura no Estoque — achado original corrigido');
})();

// ── Desempate por os.matNomeBase quando há mais de uma chapa na mesma espessura ──
(function () {
  reset();
  global.STOCK = {
    ac3: { label: 'Acrílico Cristal', esp: 3, cor: '', qty: 10 },
    mdf3: { label: 'MDF Branco', esp: 3, cor: '', qty: 5 }
  };
  var os = { num: '11', id: 'osB', esp: 3, matNomeBase: 'Acrílico Cristal', itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  mod._kbOpenProdOverlay(os);
  assertEq(_els['kbProdMatSel'].value, 'ac3', '2. duas chapas com a mesma espessura — matNomeBase desempata corretamente para a chapa certa');
})();

(function () {
  reset();
  global.STOCK = {
    ac3: { label: 'Acrílico Cristal', esp: 3, cor: '', qty: 10 },
    mdf3: { label: 'MDF Branco', esp: 3, cor: '', qty: 5 }
  };
  // Sem matNomeBase e mais de uma chapa compatível — nunca escolhe errado
  // silenciosamente: não pré-seleciona nada, o operador escolhe.
  var os = { num: '12', id: 'osC', esp: 3, itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  mod._kbOpenProdOverlay(os);
  assertEq(_els['kbProdMatSel'].value, '', '3. ambíguo sem matNomeBase (2 chapas, mesma espessura): NÃO pré-seleciona nada — nunca escolhe errado silenciosamente');
})();

// ── Aviso visível de falha real de carregamento (achado real: só console.warn) ──
(function () {
  reset();
  global.STOCK = {};
  global.RETALHOS = [];
  global._STOCK_LOAD_ERROR = true;
  var os = { num: '13', id: 'osD', itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  mod._kbOpenProdOverlay(os);
  assertTrue(_toasts.some(function (t) { return t.kind === 'err' && /Estoque/.test(t.msg); }), '4. falha real de carregamento do Estoque agora gera aviso visível — achado original corrigido');
})();

(function () {
  reset();
  global.STOCK = { ac3: { label: 'Acrílico', esp: 3, qty: 5 } };
  global.RETALHOS = [];
  global._CLOUD_WATCH_ERROR = { retalhos: true };
  var os = { num: '14', id: 'osE', itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  mod._kbOpenProdOverlay(os);
  assertTrue(_toasts.some(function (t) { return t.kind === 'err' && /Retalhos/.test(t.msg); }), '5. falha real de carregamento dos Retalhos agora gera aviso visível');
})();

(function () {
  reset();
  // Caminho saudável: Estoque vazio de verdade (nunca cadastrou nada),
  // sem erro de carregamento — NÃO deve gerar nenhum toast de erro (não
  // confundir "vazio" com "falhou").
  global.STOCK = {};
  global.RETALHOS = [];
  global._STOCK_LOAD_ERROR = false;
  global._CLOUD_WATCH_ERROR = {};
  var os = { num: '15', id: 'osF', itens: [{ prod: 'Placa', qty: '1', larg: 50, alt: 40 }] };
  mod._kbOpenProdOverlay(os);
  assertTrue(!_toasts.some(function (t) { return t.kind === 'err'; }), '6. Estoque genuinamente vazio (sem erro de carregamento) NÃO dispara aviso de falha — nunca alarme falso');
})();

// ── Rótulo de cobertura no <select> de retalhos (Bloco C, sem reordenar) ──
(function () {
  reset();
  global.STOCK = { ac2: { label: 'Acrílico Cristal', esp: 2, qty: 10 } };
  global.RETALHOS = [
    { mat: 'ac2', qty: 3, dims: '90x60', label: 'Retalho A', codigo: 'RA' },
    { mat: 'outro', qty: 2, dims: '200x200', label: 'Retalho B', codigo: 'RB' }
  ];
  var os = { num: '16', id: 'osG', esp: 2, itens: [{ prod: 'Caixa', qty: '1', planArea: 0.06, pieces: [{ nome: 'Tampa', larg: 30, alt: 20, qty: 1 }] }] };
  mod._kbOpenProdOverlay(os);
  var html = _els['kbProdRetalhoSel'].innerHTML;
  assertTrue(/Retalho A[^<]*atende toda a planificação/.test(html), '7. retalho compatível é rotulado com a cobertura real no dropdown (sem reordenar a lista)');
  assertTrue(html.indexOf('<option value="0"') < html.indexOf('<option value="1"'), '8. índices das opções preservados na ordem original (0 antes de 1) — nunca quebra os.matProd.retalhoIdx já salvo');
})();

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
