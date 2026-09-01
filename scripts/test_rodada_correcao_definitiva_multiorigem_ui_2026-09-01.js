/**
 * test_rodada_correcao_definitiva_multiorigem_ui_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA, Bloco 6 (MVP) — testa a camada de UI
 * client-side do modal "Iniciar Produção" que monta o array `origens`
 * enviado a producaoIniciarOuEditar() (Cloud Function real, coberta por
 * scripts/test_rodada_correcao_definitiva_multiorigem_2026-09-01.js contra
 * o Firestore Emulator).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _kbProdLerOrigemAtual, kbProdAdicionarOrigem, kbProdRemoverOrigem,
 * kbProdRenderOrigensExtras.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_multiorigem_ui_2026-09-01.js
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
function extractVar(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Multi-origem: UI do modal Iniciar Produção ===\n');

var FN_NAMES = ['_kbProdLerOrigemAtual', 'kbProdAdicionarOrigem', 'kbProdRemoverOrigem', 'kbProdRenderOrigensExtras'];
var src = [
  extractVar('_kbProdOrigensExtras'),
  FN_NAMES.map(extractFn).join('\n\n'),
].join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + ', getExtras: function(){ return _kbProdOrigensExtras; }};';
var modPath = path.join(__dirname, '_rodada_correcao_definitiva_multiorigem_ui.tmp.js');
fs.writeFileSync(modPath, src);

var _els, _toasts;
function makeEl(props) { return Object.assign({ value: '', textContent: '', innerHTML: '' }, props || {}); }
function reset(tipo) {
  _els = {
    kbProdOrigensExtrasList: makeEl(),
    kbProdMatSel: makeEl({ value: 'cfg_0' }),
    kbProdQty: makeEl({ value: '2' }),
    kbProdRetalhoSel: makeEl({ value: '0' }),
  };
  global.document = { getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); } };
  global._kbProdTipo = tipo || 'chapa';
  global.STOCK = { cfg_0: { label: 'Acrílico 3mm', qty: 10 } };
  global.RETALHOS = [{ codigo: 'RET001', label: 'Retalho', dims: '20x20', qty: 1 }];
  _toasts = [];
  global.showToast = function (msg, tipo2) { _toasts.push({ msg: msg, tipo: tipo2 }); };
  global.cfgEsc = function (s) { return String(s == null ? '' : s); };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════════
// 1-3 — _kbProdLerOrigemAtual()
// ══════════════════════════════════════════════════════════════════════════
reset('chapa');
assertEq(mod._kbProdLerOrigemAtual(), { tipo: 'chapa', matKey: 'cfg_0', qty: 2, label: 'Acrílico 3mm — 2 chapas' }, '1. Lê a origem chapa atualmente selecionada corretamente');

reset('retalho');
assertEq(mod._kbProdLerOrigemAtual(), { tipo: 'retalho', retalhoCodigo: 'RET001', label: 'Retalho 20x20 (retalho)' }, '2. Lê a origem retalho atualmente selecionada corretamente');

reset('chapa');
_els.kbProdMatSel.value = '';
assertTrue(mod._kbProdLerOrigemAtual() === null, '3. Sem material selecionado: retorna null (nunca um objeto inválido)');

// ══════════════════════════════════════════════════════════════════════════
// 4-6 — kbProdAdicionarOrigem() / kbProdRemoverOrigem()
// ══════════════════════════════════════════════════════════════════════════
reset('chapa');
mod.getExtras().splice(0); // limpa estado residual de testes anteriores (mesmo módulo, var persiste entre chamadas)
mod.kbProdAdicionarOrigem();
assertEq(mod.getExtras().length, 1, '4. Adicionar uma origem válida: entra na lista');
assertEq(_els.kbProdMatSel.value, '', '4b. Seletor de material é limpo após adicionar (evita adicionar a MESMA origem 2x sem querer)');
assertTrue(_els.kbProdOrigensExtrasList.innerHTML.indexOf('Acrílico 3mm') >= 0, '4c. Lista de origens adicionadas é re-renderizada no DOM');

reset('chapa');
mod.getExtras().splice(0);
_els.kbProdMatSel.value = '';
mod.kbProdAdicionarOrigem();
assertEq(mod.getExtras().length, 0, '5. TESTE OBRIGATÓRIO — tentar adicionar sem nada selecionado NÃO adiciona nada (nunca uma origem vazia/inválida na lista)');
assertTrue(_toasts.some(function (t) { return t.tipo === 'warn'; }), '5b. Avisa com toast (nunca falha silenciosa)');

reset('chapa');
mod.getExtras().splice(0);
mod.kbProdAdicionarOrigem();
_els.kbProdMatSel.value = 'cfg_0'; _els.kbProdQty.value = '1'; // simula selecionar outra
mod.kbProdAdicionarOrigem();
assertEq(mod.getExtras().length, 2, '6. Adicionar duas origens em sequência: as duas ficam na lista');
mod.kbProdRemoverOrigem(0);
assertEq(mod.getExtras().length, 1, '6b. Remover uma origem da lista funciona (índice correto)');
assertEq(mod.getExtras()[0].qty, 1, '6c. A origem que sobrou é a correta (não removeu a errada)');

console.log('\n----------------------------------------------------------------------');

// ══════════════════════════════════════════════════════════════════════════
// 7 — Estrutural: kbConfirmarProd() monta `payload.origens` só quando há
// extras, preservando o caminho legado (sem `origens`) no caso comum.
// ══════════════════════════════════════════════════════════════════════════
var srcConfirmar = extractFn('kbConfirmarProd');
assertTrue(srcConfirmar.indexOf('if (_kbProdOrigensExtras.length > 0)') > 0, '7a. kbConfirmarProd() só monta origens[] quando _kbProdOrigensExtras não está vazio');
assertTrue(srcConfirmar.indexOf('payload.origens = todasOrigens.map(') > 0, '7b. Origens extras + a atual são combinadas em payload.origens');
assertTrue(srcConfirmar.indexOf("payload.tipo = 'chapa'; payload.matKey = matKey; payload.qty = qty;") > 0, '7c. Caminho legado (sem origens[], 1 origem só) preservado intacto — mesmo formato de payload de antes desta rodada');
var idxReset1 = html.indexOf('_kbProdOrigensExtras = [];', html.indexOf('function _kbOpenProdOverlay'));
assertTrue(idxReset1 > 0 && idxReset1 < html.indexOf('function _kbOpenProdOverlay') + 800, '8. _kbOpenProdOverlay() reseta as origens extras ao abrir o modal (nunca herda de uma OS anterior)');
assertTrue(html.indexOf("function kbCloseProd() { _kbProdOverlayEpoch++; document.getElementById('kbProdOverlay').classList.remove('open'); _kbProdSubmitting = false; _kbProdOrigensExtras = []; }") > 0, '9. kbCloseProd() também reseta as origens extras');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
