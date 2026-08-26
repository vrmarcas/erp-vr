/**
 * test_hardening_fase2_blococr_retry_engine_generico_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, FECHAMENTO DO BLOCO C (2026-08-26) —
 * generalização do padrão de retry (referência: Atendimentos,
 * test_hardening_fase2_blococ_atendimentos_retry_2026-08-26.js) para o
 * motor genérico compartilhado por 11 telas: _retryComBackoff/
 * _retryEstado/_retryResetar/_watchTentarNovamente, mais as 7 funções de
 * watch nomeadas (_watchClientes, _watchKbOs, _watchCrmLeads, _watchFinCr,
 * _watchFinCp, _watchRetalhos, _watchOrcamentos) e _watchStock/
 * _loadFornecedoresRetry.
 *
 * Cobre as 10 categorias exigidas para o fechamento do Bloco C: sucesso
 * inicial, erro transitório, retry com sucesso, retry esgotado, retry
 * manual, permission-denied sem retry, logout durante retry, troca de
 * tela durante retry, múltiplos cliques em "Tentar novamente", nenhum
 * listener duplicado.
 *
 * ACHADO REAL corrigido nesta rodada (categoria "logout durante retry"):
 * authLogout() zerava _RETRY_STATE, mas isso não cancelava um timer de
 * backoff JÁ AGENDADO — o closure de _retryComBackoff continua apontando
 * para o objeto `st` antigo, então reconectarFn() ainda rodava depois do
 * logout. _retryComBackoff() agora verifica _currentSession dentro do
 * próprio timer antes de reconectar.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _retryEstado, _retryComBackoff, _retryResetar, _watchTentarNovamente,
 * _cloudWatch, _cloudLoad, _homologGuardOrThrow.
 *
 * Uso: node "scripts/test_hardening_fase2_blococr_retry_engine_generico_2026-08-26.js"
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
function extractVar(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

console.log('\n=== HARDENING FASE 2, FECHAMENTO BLOCO C — motor de retry genérico (11 telas) ===\n');

var FN_NAMES = ['_homologGuardOrThrow', '_cloudWatch', '_cloudLoad', '_retryEstado', '_retryComBackoff', '_retryResetar', '_watchTentarNovamente'];
var src = extractVar('_CLOUD_WATCH_ERROR') + '\n\n'
  + extractVar('_CLOUD_WATCH_CONFIRMED') + '\n\n'
  + extractVar('_CLOUD_WATCH_FORBIDDEN') + '\n\n'
  + extractVar('_CLOUD_LOAD_CONFIRMED') + '\n\n'
  + extractVar('_CLOUD_LOAD_ERROR') + '\n\n'
  + extractVar('_CLOUD_LOAD_FORBIDDEN') + '\n\n'
  + extractVar('_RETRY_STATE') + '\n\n'
  + FN_NAMES.map(extractFn).join('\n\n')
  + '\n\nmodule.exports = {'
  + '_cloudWatch:_cloudWatch, _cloudLoad:_cloudLoad, _retryEstado:_retryEstado, '
  + '_retryComBackoff:_retryComBackoff, _retryResetar:_retryResetar, _watchTentarNovamente:_watchTentarNovamente, '
  + 'getWatchForbidden: function(){return _CLOUD_WATCH_FORBIDDEN;}, getLoadForbidden: function(){return _CLOUD_LOAD_FORBIDDEN;}, '
  + 'getRetryState: function(){return _RETRY_STATE;}'
  + '};';
var modPath = path.join(__dirname, '_hardening_fase2_blococr_retry_engine.tmp.js');
fs.writeFileSync(modPath, src);

function makeFakeDb(behavior) {
  return {
    collection: function () {
      return {
        doc: function () {
          return {
            onSnapshot: function (successCb, errCb) {
              if (behavior.type === 'success') successCb({ exists: true, data: function () { return { data: JSON.stringify(behavior.payload || [1]) }; }, metadata: { fromCache: false } });
              else if (behavior.type === 'error') errCb(behavior.error || new Error('unavailable'));
              return function unsub() {};
            },
            get: function () {
              if (behavior.type === 'success') return Promise.resolve({ exists: true, data: function () { return { data: JSON.stringify(behavior.payload || [1]) }; } });
              return Promise.reject(behavior.error || new Error('unavailable'));
            },
          };
        },
      };
    },
  };
}

var _timers, mod, _toasts;
function reset(behavior, opts) {
  opts = opts || {};
  global.window = global;
  global.console = console;
  global._homologGuardOrThrow = function () {};
  global._HOMOLOG_MODE = false;
  global._HOMOLOG_EMULATORS_CONNECTED = false;
  global._COL = 'erp_vr';
  global._cloudLastPayload = {};
  global._CLOUD_UNSUBS = [];
  global._currentSession = (opts.loggedOut ? null : { user: 'teste', uid: 'u1' });
  global._db = makeFakeDb(behavior || { type: 'success' });
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  _timers = [];
  global.setTimeout = function (fn, ms) { var t = { fn: fn, ms: ms, fired: false }; _timers.push(t); return t; };
  global.clearTimeout = function () {};
  delete require.cache[require.resolve(modPath)];
  mod = require(modPath);
  return mod;
}
function fireTimer(idx) { var t = _timers[idx]; t.fired = true; t.fn(); }

// 1 — sucesso inicial: _cloudWatch entrega dado normalmente, sem erro/forbidden.
reset({ type: 'success', payload: ['x'] });
var recebido1 = null;
mod._cloudWatch('chaveX', function (d) { recebido1 = d; });
assertTrue(recebido1 && recebido1.length === 1, '1. sucesso inicial: callback recebe o dado real na primeira resposta, sem precisar de retry');

// 2 — erro transitório: marca ERROR (nunca FORBIDDEN), watchTentarNovamente aceita.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
mod._cloudWatch('chaveX', function () {});
var aceito2 = mod._watchTentarNovamente('chaveX', function () {}, null);
assertTrue(_timers.length === 1, '2. erro transitório: "Tentar novamente" agenda uma reconexão com backoff — recuperação sem reload completo');

// 3 — retry com sucesso: reconectarFn roda após o backoff e entrega o dado.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
var recebido3 = null;
var watchFn3 = function () { mod._cloudWatch('chaveX', function (d) { recebido3 = d; }); };
mod._watchTentarNovamente('chaveX', watchFn3, null);
global._db = makeFakeDb({ type: 'success', payload: ['y'] }); // servidor volta a responder
fireTimer(0);
assertTrue(recebido3 && recebido3[0] === 'y', '3. retry com sucesso: assim que o backoff dispara, reconecta e entrega o dado real — sem reload');

// 4 — retry esgotado: após maxTentativas (5) ciclos completos (agenda →
// dispara), a 6ª tentativa nunca mais agenda, aciona onEsgotado.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
var esgotado4 = false;
for (var i = 0; i < 5; i++) {
  mod._retryComBackoff('chaveY', function () {}, 5, function () { esgotado4 = true; });
  fireTimer(_timers.length - 1); // simula o backoff completo antes do próximo clique manual
}
var timersAntes4 = _timers.length;
var agendou6a = mod._retryComBackoff('chaveY', function () {}, 5, function () { esgotado4 = true; });
assertTrue(agendou6a === false && _timers.length === timersAntes4, '4. retry esgotado: a 6ª tentativa NUNCA agenda outro backoff (nunca loop infinito, nem manual)');
assertTrue(esgotado4 === true, '4b. onEsgotado() é chamado quando o teto de tentativas é atingido — usuário é avisado, nunca deixado sem saída');

// 5 — retry manual: cada clique subsequente aumenta o backoff (500ms × tentativa, teto 3000ms).
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
mod._retryComBackoff('chaveZ', function () {}, 5, function () {});
assertTrue(_timers[0].ms === 500, '5. 1ª tentativa manual espera 500ms antes de reconectar');
fireTimer(0);
mod._retryComBackoff('chaveZ', function () {}, 5, function () {});
assertTrue(_timers[1].ms === 1000, '5b. 2ª tentativa dobra o backoff (1000ms) — nunca reconecta em loop apertado');

// 6 — permission-denied NUNCA oferece retry (estado terminal).
reset({ type: 'error', error: Object.assign(new Error('permission-denied'), { code: 'permission-denied' }) });
mod._cloudWatch('chaveForb', function () {});
assertTrue(mod.getWatchForbidden()['chaveForb'] === true, '6. permission-denied marca _CLOUD_WATCH_FORBIDDEN (nunca ERROR genérico)');
var timersAntes6 = _timers.length;
mod._watchTentarNovamente('chaveForb', function () {}, null);
assertTrue(_timers.length === timersAntes6, '6b. ACHADO REAL: _watchTentarNovamente() nunca agenda retry para uma chave FORBIDDEN — reautorização não é algo que um retry resolve');

// 7 — logout durante retry: timer já agendado ANTES do logout nunca reconecta depois.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
var reconectouAposLogout7 = false;
mod._retryComBackoff('chaveLogout', function () { reconectouAposLogout7 = true; }, 5, function () {});
global._currentSession = null; // operador desloga enquanto o backoff ainda está em voo
fireTimer(0);
assertTrue(reconectouAposLogout7 === false, '7. ACHADO REAL corrigido: retry agendado antes do logout NUNCA reconecta/repinta depois que a sessão termina');

// 8 — troca de tela durante retry: reconectarFn ainda roda (o listener em si
// não sabe de "tela ativa"), mas quem chama watchFn()+renderFn() deve
// funcionar mesmo que renderFn aponte para uma função que já não está mais
// visível — nunca lança exceção nem deixa estado inconsistente.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
global._db = makeFakeDb({ type: 'success', payload: ['z'] });
var renderChamadoAposTroca8 = 0;
var telaAtual8 = 'clientes';
mod._watchTentarNovamente('chaveTela', function () { mod._cloudWatch('chaveTela', function () {}); }, function () { renderChamadoAposTroca8++; return telaAtual8; });
telaAtual8 = 'crm'; // operador troca de tela enquanto o retry ainda está agendado
assertTrue(_timers.length >= 1, '8. troca de tela durante retry: o timer de reconexão continua agendado normalmente (nenhuma exceção ao trocar de tela)');
fireTimer(_timers.length - 1);
assertTrue(renderChamadoAposTroca8 >= 1, '8b. quando o retry finalmente resolve, o renderFn é chamado sem lançar exceção mesmo com a tela tendo trocado nesse meio-tempo');

// 9 — múltiplos cliques em "Tentar novamente": clique duplicado enquanto a
// 1ª tentativa ainda está em voo (ocupado=true) é ignorado — nunca duas
// reconexões/listeners simultâneos.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
mod._retryComBackoff('chaveDup', function () {}, 5, function () {});
var timersAntes9 = _timers.length;
var agendouSegundo9 = mod._retryComBackoff('chaveDup', function () {}, 5, function () {});
assertTrue(agendouSegundo9 === false && _timers.length === timersAntes9, '9. clique duplicado em "Tentar novamente" enquanto a tentativa anterior ainda está em voo é ignorado — nunca duas reconexões simultâneas');

// 10 — nenhum listener duplicado: reconectarFn (watchFn) chamado pelo
// retry cria só 1 novo listener por vez — _CLOUD_UNSUBS não acumula mais
// de 1 entrada por reconexão bem-sucedida.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
mod._cloudWatch('chaveUnsub', function () {}); // registra o listener original (que falhou)
var unsubsAntes10 = global._CLOUD_UNSUBS.length;
mod._retryComBackoff('chaveUnsub', function () { mod._cloudWatch('chaveUnsub', function () {}); }, 5, function () {});
global._db = makeFakeDb({ type: 'success', payload: ['w'] });
fireTimer(_timers.length - 1);
assertTrue(global._CLOUD_UNSUBS.length === unsubsAntes10 + 1, '10. cada reconexão bem-sucedida registra exatamente 1 novo unsub — nenhum listener duplicado se acumulando por retry');

// 11 — _retryResetar() zera o contador para a PRÓXIMA falha começar do
// zero — incidente antigo resolvido nunca "pesa" contra uma falha futura
// independente.
reset({ type: 'error', error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) });
mod._retryComBackoff('chaveReset', function () {}, 5, function () {});
mod._retryComBackoff('chaveReset', function () {}, 5, function () {}); // clique duplicado enquanto a 1ª ainda está em voo (ocupado=true) — ignorado
assertTrue(mod.getRetryState()['chaveReset'].tentativas === 1, '11a. clique duplicado (ainda ocupado) não incrementa o contador além da 1ª tentativa real');
fireTimer(0);
assertTrue(mod.getRetryState()['chaveReset'].tentativas === 1, '11b. após o backoff disparar, o contador reflete exatamente 1 tentativa consumida (o clique duplicado nunca contou)');
mod._retryResetar('chaveReset');
assertTrue(mod.getRetryState()['chaveReset'].tentativas === 0 && mod.getRetryState()['chaveReset'].ocupado === false, '11c. _retryResetar() zera tentativas e ocupado — uma falha futura começa do zero, nunca herdando incidente antigo já resolvido');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
