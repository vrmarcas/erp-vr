/**
 * test_hardening_fase2_blococ_atendimentos_retry_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, BLOCO C (2026-08-26) — retry
 * controlado, primeira implementação de referência (Atendimentos).
 *
 * ACHADO REAL: antes desta rodada, uma falha do listener de 'atendimentos'
 * (rede/permissão) só gerava console.error — a única recuperação era
 * recarregar a página inteira, mesmo para uma falha transitória (rede)
 * que uma nova tentativa resolveria sozinha.
 *
 * Corrigido: atdListenerInit() agora distingue permission-denied
 * (_ATD_FORBIDDEN — TERMINAL, nunca oferece retry, reautorização não é
 * decisão que uma nova tentativa resolve) de falha transitória
 * (_ATD_LOAD_ERROR — recuperável). atdTentarNovamente() reconecta o
 * listener sem reload completo, com backoff crescente (500ms × tentativa,
 * teto 3s) e um limite de 5 tentativas manuais consecutivas (nunca retry
 * automático/infinito) — depois disso, orienta a recarregar a página.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * atdListenerInit, atdTentarNovamente, atdRenderLista.
 *
 * Uso: node "scripts/test_hardening_fase2_blococ_atendimentos_retry_2026-08-26.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

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

console.log('\n=== HARDENING FASE 2, BLOCO C — retry controlado (Atendimentos, referência) ===\n');

var FN_NAMES = ['atdListenerInit', 'atdTentarNovamente', 'atdRenderLista', 'atdModoLabel', 'atdIniciais', 'atdFmtHora', 'atdSyncBadge'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_hardening_fase2_blococ_atendimentos.tmp.js');
fs.writeFileSync(modPath, src);

var _errCb, _els, _toasts;
function reset() {
  global.window = global;
  global.ATD_UNSUB = null;
  global.ATD_CACHE = [];
  global.ATD_SELECTED_ID = null;
  global.ATD_FILTRO = 'todos';
  global._ATD_LOADED = false;
  global._ATD_LOAD_ERROR = false;
  global._ATD_FORBIDDEN = false;
  global._ATD_RETRY_COUNT = 0;
  global._ATD_RETRY_BUSY = false;
  global._db = {
    collection: function () {
      return {
        orderBy: function () {
          return {
            limit: function () {
              return {
                onSnapshot: function (successCb, errorCb) { _errCb = errorCb; return function () {}; }
              };
            }
          };
        }
      };
    }
  };
  _els = { atdListaBody: { innerHTML: '' }, atdSearch: { value: '' }, sbBadgeAtend: { textContent: '', style: {} } };
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  global.cfgEsc = function (v) { return v == null ? '' : String(v); };
  global.console = console;
  var _timers = [];
  global.setTimeout = function (fn, ms) { _timers.push({ fn: fn, ms: ms }); return _timers.length; };
  global.__timers = _timers;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-2 — permission-denied é TERMINAL: nunca oferece retry, mensagem própria.
reset();
mod.atdListenerInit();
_errCb({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
assertTrue(global._ATD_FORBIDDEN === true && global._ATD_LOAD_ERROR === false, '1. permission-denied marca _ATD_FORBIDDEN (nunca _ATD_LOAD_ERROR) — estado distinto e terminal');
assertTrue(_els.atdListaBody.innerHTML.indexOf('Tentar novamente') < 0 && _els.atdListaBody.innerHTML.indexOf('Sem permissão') >= 0, '2. ACHADO REAL: tela de permission-denied NUNCA mostra botão "Tentar novamente" — reautorização não é algo que um retry resolve');

// 3-4 — falha transitória (unavailable) É recuperável: mostra o botão.
reset();
mod.atdListenerInit();
_errCb({ code: 'unavailable', message: 'network error' });
assertTrue(global._ATD_LOAD_ERROR === true && global._ATD_FORBIDDEN === false, '3. falha transitória (unavailable) marca _ATD_LOAD_ERROR (nunca _ATD_FORBIDDEN)');
assertTrue(_els.atdListaBody.innerHTML.indexOf('Tentar novamente') >= 0, '4. ACHADO REAL corrigido: falha transitória oferece "Tentar novamente" — recuperação sem precisar recarregar a página inteira');

// 5-7 — atdTentarNovamente() reconecta (ATD_UNSUB solto pelo erro, novo
// onSnapshot criado) com backoff — nunca síncrono/imediato (nunca reagindo
// como um loop apertado).
reset();
mod.atdListenerInit();
_errCb({ code: 'unavailable' });
assertTrue(global.ATD_UNSUB === null, '5. listener morto solta ATD_UNSUB (nunca fica "preso" numa referência inválida que bloquearia uma nova tentativa)');
mod.atdTentarNovamente();
assertTrue(global.__timers.length === 1 && global.__timers[0].ms === 500, '6. primeira tentativa espera 500ms (backoff) antes de reconectar — nunca instantâneo/loop apertado');
global.__timers[0].fn(); // simula o timer disparando
assertTrue(global.ATD_UNSUB !== null, '7. após o backoff, atdListenerInit() roda de novo e recria o listener (ATD_UNSUB volta a existir) — sem reload completo da página');

// 8-9 — limite de tentativas: nunca deixa o operador clicar pra sempre
// sem uma saída (retry NUNCA vira loop infinito, mesmo manual).
reset();
global._ATD_RETRY_COUNT = 5;
mod.atdTentarNovamente();
assertTrue(global.__timers.length === 0, '8. ACHADO REAL: com 5 tentativas já esgotadas, atdTentarNovamente() NUNCA agenda mais uma — nunca um retry sem fim');
assertTrue(_toasts.some(function (t) { return t.tipo === 'warn' && /recarregue/.test(t.msg); }), '9. operador é orientado a recarregar a página como última saída, nunca deixado sem nenhuma opção');

// 10 — clique duplicado enquanto uma tentativa já está em andamento é
// ignorado (nunca duas reconexões simultâneas / listeners duplicados).
reset();
mod.atdListenerInit();
_errCb({ code: 'unavailable' });
mod.atdTentarNovamente();
var timersAntes = global.__timers.length;
mod.atdTentarNovamente(); // segundo clique, ainda com a 1ª tentativa "em voo" (_ATD_RETRY_BUSY)
assertTrue(global.__timers.length === timersAntes, '10. clique duplicado em "Tentar novamente" enquanto uma tentativa já está em andamento é ignorado — nunca duas reconexões/listeners simultâneos');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
