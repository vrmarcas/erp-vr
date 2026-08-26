/**
 * test_hardening_fase2_blocon_pagamento_wizard_exception_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, BLOCO N (2026-08-26) — achado real:
 * orcConfirmarPagamentoWizard() é uma async function SEM nenhum try/catch
 * ao redor de todo o corpo. Ela chama `await orcSalvarOrcamento()`, que por
 * sua vez chama _orcSalvarOrcamentoImpl() — uma função de ~400 linhas com
 * try/catch só em pontos específicos (parse de JSON salvo em dataset),
 * nunca um catch-all. Qualquer exceção não prevista em qualquer ponto
 * dessa cadeia (ex.: um bug real, um DOM inesperado) rejeitava a Promise
 * SEM que orcConfirmarPagamentoWizard() nunca resetasse o botão — ele
 * ficava travado em "Salvando…" para sempre, sem nenhum toast/erro
 * avisando o operador.
 *
 * Corrigido: todo o corpo de orcConfirmarPagamentoWizard() agora está
 * dentro de um try/catch — qualquer exceção inesperada (de
 * orcSalvarOrcamento() ou de qualquer outro ponto) sempre reabilita o
 * botão, restaura o texto original e mostra um toast de erro claro. NÃO
 * altera nenhum cálculo/preço/pagamento — só garante recuperação da UI.
 *
 * Função sob teste extraída de index.html (nunca reimplementada):
 * orcConfirmarPagamentoWizard.
 *
 * Uso: node "scripts/test_hardening_fase2_blocon_pagamento_wizard_exception_2026-08-26.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractAsyncFn(name) {
  var marker = 'async function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função async ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== HARDENING FASE 2, BLOCO N — orcConfirmarPagamentoWizard() nunca trava em "Salvando…" ===\n');

var src = extractAsyncFn('orcConfirmarPagamentoWizard') + '\n\nmodule.exports = {orcConfirmarPagamentoWizard};';
var modPath = path.join(__dirname, '_hardening_fase2_blocon_pgto_wizard.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', disabled: false, style: {}, checked: false }, props || {}); }

var _els, _toasts;
function reset(opts) {
  opts = opts || {};
  _els = {
    orcBtnConfirmarPagamento: makeEl({ disabled: false, textContent: '💳 Confirmar Pagamento' }),
    orcSimMetodo: makeEl({ value: 'pix' }),
    pgtoEntradaValWizard: makeEl({ value: '' }),
    pgtoObsWizard: makeEl({ value: '' }),
    orcNFToggle: makeEl({ checked: false }),
    orcBtnGerarOSWizard: makeEl({ disabled: true, style: {} }),
  };
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  global.window = global;
  window._orcSessaoAtualId = 'ORC-57';
  window._orcMostrandoCongelado = true;
  window._orcPgtoValorEfetivo = 806.84;
  global._pgtoTipoAtualWizard = 'integral';
  global.orcGetEnviados = function () { return [{ id: 'ORC-57', num: '000057', status: 'aprovado', valorFinal: 806.84 }]; };
  global.orcSalvarOrcamento = opts.orcSalvarOrcamento || function () { return Promise.resolve({ id: 'ORC-57', num: '000057', valorFinal: 806.84 }); };
  global.orcRegistrarSituacaoFinanceira = opts.orcRegistrarSituacaoFinanceira || function () { return Promise.resolve({ ok: true, jaConfirmado: false, dados: {} }); };
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  global.orcPgtoMostrarStatusWizard = function () {};
  global.orcPgtoBloquearEdicaoWizard = function () {};
  global.console = console;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-4 — ACHADO REAL: uma exceção não prevista propagada por
// orcSalvarOrcamento() (simula um bug real dentro de
// _orcSalvarOrcamentoImpl, fora do escopo dos try/catch pontuais que já
// existem lá) NUNCA deve deixar o botão travado em "Salvando…", nem
// silenciar o erro do operador.
(function () {
  reset({
    congelado: false,
    orcSalvarOrcamento: function () { return Promise.reject(new TypeError("Cannot read properties of null (reading 'value')")); },
  });
  window._orcMostrandoCongelado = false; // força o caminho que chama orcSalvarOrcamento()
  return mod.orcConfirmarPagamentoWizard().then(function () {
    assertTrue(_els.orcBtnConfirmarPagamento.disabled === false, '1. ACHADO REAL corrigido: exceção não prevista em orcSalvarOrcamento() NÃO deixa o botão travado desabilitado');
    assertTrue(_els.orcBtnConfirmarPagamento.textContent === '💳 Confirmar Pagamento', '2. ACHADO REAL corrigido: texto do botão volta ao original (nunca fica preso em "Salvando…")');
    assertTrue(_toasts.some(function (t) { return t.tipo === 'err'; }), '3. um toast de erro claro é mostrado ao operador (nunca falha silenciosa)');
    assertTrue(!_toasts.some(function (t) { return t.tipo === 'ok'; }), '4. nenhum toast de sucesso falso é mostrado quando a operação realmente falhou');
  });
})()
// 5-6 — mesma proteção quando quem rejeita é orcRegistrarSituacaoFinanceira().
.then(function () {
  reset({
    orcRegistrarSituacaoFinanceira: function () { return Promise.reject(new Error('boom inesperado')); },
  });
  return mod.orcConfirmarPagamentoWizard().then(function () {
    assertTrue(_els.orcBtnConfirmarPagamento.disabled === false, '5. mesma proteção quando quem rejeita é orcRegistrarSituacaoFinanceira() — botão nunca trava');
    assertTrue(_toasts.some(function (t) { return t.tipo === 'err'; }), '6. toast de erro mostrado também nesse caminho');
  });
})
// 7-9 — caminho feliz (nenhuma exceção) continua funcionando exatamente
// como antes — o try/catch novo não muda nada no fluxo normal.
.then(function () {
  reset({});
  return mod.orcConfirmarPagamentoWizard().then(function () {
    assertTrue(_els.orcBtnConfirmarPagamento.textContent === '✅ Pagamento confirmado', '7. caminho feliz preservado: botão mostra confirmação normalmente');
    assertTrue(_toasts.some(function (t) { return t.tipo === 'ok'; }), '8. toast de sucesso continua aparecendo no caminho feliz');
    assertTrue(_els.orcBtnGerarOSWizard.disabled === false, '9. botão "Gerar OS" continua sendo liberado no caminho feliz (nenhuma regressão de comportamento)');

    try { fs.unlinkSync(modPath); } catch (e) {}
    console.log('\n' + '='.repeat(70));
    console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
    console.log('='.repeat(70) + '\n');
    process.exit(failed > 0 ? 1 : 0);
  });
})
.catch(function (e) {
  console.log('  ❌  Exceção inesperada no teste: ' + (e && e.stack || e));
  process.exit(1);
});
