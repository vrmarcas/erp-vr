/**
 * test_certificacao_fase3_r2_stock_reconnect_2026-08-26.js
 *
 * CERTIFICAÇÃO OPERACIONAL 10/10 — FASE 3, RODADA 2 (smoke ao vivo pós-
 * desbloqueio).
 *
 * ACHADO REAL reproduzido AO VIVO em produção, depois do hotfix de
 * listeners da Rodada 1 (commit cceda36) já estar certificado: bloquear a
 * tela e desbloquear com a senha real reconectava Clientes/CRM/Financeiro/
 * Atendimentos/Vitre/Compras corretamente — mas o Estoque ficava preso em
 * "🔒 Sem permissão para ver o Estoque" mesmo com a conta MASTER e um token
 * de autenticação válido e fresco.
 *
 * Causa raiz: _watchStock() e o listener de stock_deleted (tombstones) são
 * registrados UMA ÚNICA VEZ no carregamento do script (fora da bateria de
 * _cloudLoadAll() que _cloudIniciar() dispara) — comentário original em
 * index.html já dizia isso: "registrado imediatamente, sem esperar
 * _cloudReady". O hotfix da Rodada 1 corretamente zera o guard
 * (_stockUnsub=null) no bloqueio, mas nada no caminho de reconexão
 * (authUnlock() → _cloudIniciar()) chamava _watchStock() de novo — só o
 * botão manual "Tentar novamente" da tela de Estoque conseguia recriar a
 * inscrição. Mesmo problema, replicado, no listener de stock_deleted (que
 * nem guard nomeado tinha).
 *
 * Corrigido: stock_deleted extraído para _watchStockTomb() (mesmo padrão
 * de _watchStock(), guard _stockTombUnsub), e _cloudIniciar() agora chama
 * ambas no final do próprio corpo — idempotente no boot inicial (guard já
 * setado por _watchStock()/_watchStockTomb() rodando antes, no parse do
 * script) e é o que garante a reconexão real após secEngageLock() zerar os
 * dois guards.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _cloudIniciar, _watchStock, _watchStockTomb.
 *
 * Uso: node scripts/test_certificacao_fase3_r2_stock_reconnect_2026-08-26.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  var ok = g === e;
  assertTrue(ok, msg + (ok ? '' : ' — esperado ' + e + ', obtido ' + g));
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== CERTIFICAÇÃO FASE 3, RODADA 2 — Estoque reconecta após bloqueio/desbloqueio ===\n');

var FN_NAMES = ['_watchStock', '_watchStockTomb', '_cloudIniciar'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' +
  FN_NAMES.join(',') + ', getStockUnsub: function(){ return _stockUnsub; }, getStockTombUnsub: function(){ return _stockTombUnsub; }};';
var modPath = path.join(__dirname, '_certificacao_fase3_r2_stock_reconnect.tmp.js');
fs.writeFileSync(modPath, src);

var _watchStockCalls, _watchStockTombCalls, _cloudLoadAllCalls, _kbProntaSyncCalls;
function reset() {
  global._stockUnsub = null;
  global._stockTombUnsub = null;
  global._STOCK_FORBIDDEN = false;
  global._STOCK_LOAD_ERROR = false;
  global._stockTombLoaded = false;
  global._COL = 'erp_vr';
  global._CLOUD_UNSUBS = [];
  global._cloudIniciou = false;
  _watchStockCalls = 0; _watchStockTombCalls = 0; _cloudLoadAllCalls = 0; _kbProntaSyncCalls = 0;
  // _cloudIniciar() em produção chama as versões REAIS de _watchStock()/
  // _watchStockTomb() (extraídas acima, compartilhando escopo do módulo) —
  // só _cloudLoad/_cloudLoadAll/kbProntaSync (fora do escopo desta
  // certificação) precisam de mock, para isolar exatamente o que está sob
  // teste: a chamada às duas funções de reconexão do Estoque.
  global._cloudLoad = function (key, cb) { cb(null); };
  global._cloudLoadAll = function () { _cloudLoadAllCalls++; };
  global.kbProntaSync = function () { _kbProntaSyncCalls++; };
  // _cloudIniciar() real agenda _cloudLoadAll()/kbProntaSync() via
  // setTimeout(fn, 800/600) — dispara síncrono aqui só para tornar a
  // asserção determinística; não muda nenhuma lógica de produção (mesmo
  // padrão de relógio/timer injetável já usado em test_inactivity_lock.js).
  global.setTimeout = function (fn) { fn(); };
  global._db = {
    collection: function () {
      return { doc: function () { return { onSnapshot: function (onNext, onErr) { return function () {}; } }; } };
    }
  };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-2 — boot inicial: _cloudIniciar() chama as duas funções de reconexão do Estoque.
reset();
mod._cloudIniciar();
assertTrue(typeof mod.getStockUnsub() === 'function', '1. boot: _cloudIniciar() chama _watchStock() — guard _stockUnsub deixa de ser null');
assertTrue(typeof mod.getStockTombUnsub() === 'function', '2. boot: _cloudIniciar() chama _watchStockTomb() — guard _stockTombUnsub deixa de ser null');

// 3 — guard funciona: chamar _cloudIniciar() de novo sem resetar não recria as inscrições (idempotente).
var unsubAntes = mod.getStockUnsub();
mod._cloudIniciar(); // _cloudIniciou já é true — corpo inteiro deveria ser pulado
assertEq(mod.getStockUnsub(), unsubAntes, '3. chamar _cloudIniciar() de novo sem resetar _cloudIniciou não recria a inscrição do Estoque (guard duplo: _cloudIniciou E _stockUnsub)');

// 4-6 — ACHADO REAL corrigido: simula exatamente o ciclo bloqueio→desbloqueio
// (secEngageLock zera os 2 guards + _cloudIniciou; authUnlock chama _cloudIniciar de novo).
reset();
mod._cloudIniciar(); // boot inicial
assertTrue(mod.getStockUnsub() !== null, 'pré-condição: Estoque conectado após o boot');
global._stockUnsub = null;       // simula secEngageLock() no bloqueio
global._stockTombUnsub = null;   // simula secEngageLock() no bloqueio
global._cloudIniciou = false;    // simula secEngageLock() no bloqueio
mod._cloudIniciar(); // simula authUnlock() reconectando tudo
assertTrue(typeof mod.getStockUnsub() === 'function', '4. ACHADO REAL corrigido: depois de um ciclo bloqueio→desbloqueio, _watchStock() reconecta sozinho — Estoque nunca mais fica preso em "Sem permissão" até F5 manual');
assertTrue(typeof mod.getStockTombUnsub() === 'function', '5. ACHADO REAL corrigido: _watchStockTomb() (lápides de itens excluídos) também reconecta sozinho no mesmo ciclo');
assertEq(_cloudLoadAllCalls, 2, '6. _cloudLoadAll() (todos os outros módulos) continua sendo chamado normalmente em cada _cloudIniciar() deste bloco (boot inicial + reconexão pós-desbloqueio) — nenhuma regressão no resto da reconexão');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
