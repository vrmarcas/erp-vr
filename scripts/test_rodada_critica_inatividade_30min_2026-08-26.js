/**
 * test_rodada_critica_inatividade_30min_2026-08-26.js
 *
 * RODADA CRÍTICA — adendo: tempo de bloqueio por inatividade era curto
 * demais (5/10 min) para a operação real, interrompendo atendimento/
 * produção no meio do trabalho.
 *
 * AUDITORIA: o valor vivia em 3 lugares que precisam concordar —
 * (1) var _SEC_INACT_MINS (default em memória), (2) secGetInactMins()/
 * secSaveInactTime() (fallback quando o campo do formulário vem vazio/
 * inválido), (3) o <option selected> do <select id="secInactTime"> em
 * Config → Segurança (default visual antes do JS sincronizar via
 * secApplyPerms(), que já faz inactSel.value=String(secGetInactMins())).
 * NÃO havia um 4º valor solto — grep confirma que só esses 3 pontos
 * mencionavam o número. O valor real de 5 min sendo observado em
 * produção vinha do documento erp_vr/erp_inact_mins já persistido no
 * Firestore por uma configuração anterior (secSaveInactTime() sempre
 * grava lá, e _cloudLoad("erp_inact_mins",...) sempre sobrescreve o
 * default em memória quando existe um valor salvo) — corrigido no
 * próprio banco durante o smoke test autenticado (ver relatório final),
 * nunca só no código-fonte, senão o valor antigo persistido continuaria
 * mandando em produção.
 *
 * Mecanismo de bloqueio automático em si NÃO foi alterado — apenas o
 * número. secStartInactivityTimer() já chamava secStopInactivityTimer()
 * antes de criar um novo setInterval (nunca duplicava timers) e a
 * atividade real (mousemove/keydown/click) já atualizava
 * _currentSession.lastActivity — ambos comportamentos pré-existentes,
 * preservados e testados aqui sem modificação.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * secGetInactMins, secSaveInactTime, secStartInactivityTimer,
 * secStopInactivityTimer.
 *
 * Uso: node "scripts/test_rodada_critica_inatividade_30min_2026-08-26.js"
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

console.log('\n=== RODADA CRÍTICA — Bloqueio por inatividade: 5/10min → 30min ===\n');

// 0 — asserção estrutural: os 3 pontos concordam em 30, nenhum valor
// divergente/hardcoded solto ficou para trás.
assertTrue(html.indexOf('var _SEC_INACT_MINS = 30;') >= 0, '0a. Default em memória (_SEC_INACT_MINS) é 30');
assertTrue(/secGetInactMins\(\)\{ return \(typeof _SEC_INACT_MINS===['"]number['"] && !isNaN\(_SEC_INACT_MINS\)\) \? _SEC_INACT_MINS : 30; \}/.test(html), '0b. Fallback de secGetInactMins() é 30 (nunca divergente do default em memória)');
assertTrue(/if\(isNaN\(v\)\) v=30;/.test(html), '0c. Fallback de secSaveInactTime() (campo inválido/vazio) é 30');
assertTrue(html.indexOf('<option value="30" selected>30 minutos</option>') >= 0, '0d. <option> padrão do <select> em Config → Segurança é 30 minutos');
var _selInactStart = html.indexOf('id="secInactTime"');
var _selInactBlock = html.slice(_selInactStart, html.indexOf('</select>', _selInactStart));
assertTrue((_selInactBlock.match(/selected/g) || []).length === 1 && _selInactBlock.indexOf('value="30" selected') >= 0, '0e. Dentro do <select id="secInactTime">, só a opção de 30 minutos está marcada "selected" — nenhum valor antigo (5/10) divergente sobrou');

var FN_NAMES = ['secGetInactMins', 'secSaveInactTime', 'secStartInactivityTimer', 'secStopInactivityTimer'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + ', getTimerHandle: function(){ return _secTimer; }};';
var modPath = path.join(__dirname, '_rodada_critica_inatividade.tmp.js');
fs.writeFileSync(modPath, src);

var _els, _intervalCalls, _clearedIntervals, _now, _lockCalls, _toasts, _saved;
function reset() {
  _els = { secInactTime: { value: '' } };
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  global.window = global;
  global._SEC_INACT_MINS = 30;
  global._secTimer = null;
  global._currentSession = { nome: 'Teste', lastActivity: Date.now() };
  _now = 0;
  var realDateNow = Date.now;
  global._nowOverride = null;
  _intervalCalls = [];
  _clearedIntervals = [];
  global.setInterval = function (fn, ms) { var id = { fn: fn, ms: ms, alive: true }; _intervalCalls.push(id); return id; };
  global.clearInterval = function (id) { if (id) { id.alive = false; _clearedIntervals.push(id); } };
  _lockCalls = [];
  global.secEngageLock = function (motivo) { _lockCalls.push(motivo); global._currentSession = null; };
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  _saved = null;
  global._cloudSave = function (key, v) { _saved = { key: key, v: v }; return Promise.resolve(); };
  global._cloudReady = true;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1 — secGetInactMins() sem nenhum override retorna 30 (o novo padrão).
reset();
assertTrue(mod.secGetInactMins() === 30, '1. secGetInactMins() sem override retorna 30 (novo padrão), nunca mais 5 ou 10');

// 2 — ACHADO/TESTE OBRIGATÓRIO 3: 30 minutos de inatividade real →
// bloqueia (simulado via elapsed>=mins na checagem do setInterval).
reset();
mod.secStartInactivityTimer();
assertTrue(_intervalCalls.length === 1, '2a. secStartInactivityTimer() cria exatamente 1 setInterval');
var _checkFn = _intervalCalls[0].fn;
global._currentSession.lastActivity = Date.now() - (31 * 60000); // 31 min atrás
_checkFn();
assertTrue(_lockCalls.length === 1 && _lockCalls[0] === 'auto', '2b. TESTE OBRIGATÓRIO 3 — 30+ minutos de inatividade real: engaja o bloqueio automático (secEngageLock("auto"))');

// 3 — TESTE OBRIGATÓRIO 1: menos de 30 minutos de inatividade → NÃO bloqueia.
reset();
mod.secStartInactivityTimer();
var _checkFn2 = _intervalCalls[0].fn;
global._currentSession.lastActivity = Date.now() - (29 * 60000); // 29 min atrás
_checkFn2();
assertTrue(_lockCalls.length === 0, '3. TESTE OBRIGATÓRIO 1 — menos de 30 minutos de inatividade: NUNCA bloqueia (era isso que estava curto demais em 5/10min)');

// 4 — TESTE OBRIGATÓRIO 2: atividade real reinicia o contador — já era o
// comportamento existente (listeners de mousemove/keydown/click
// atualizam _currentSession.lastActivity fora desta função, não
// modificados); aqui validamos que a checagem do timer usa sempre o
// lastActivity mais recente, então "atividade reinicia" continua valendo
// com o novo limite de 30 min.
reset();
mod.secStartInactivityTimer();
var _checkFn3 = _intervalCalls[0].fn;
global._currentSession.lastActivity = Date.now() - (29 * 60000);
_checkFn3(); // 29 min — não bloqueia
assertTrue(_lockCalls.length === 0, '4a. Antes de reiniciar: 29 min de inatividade ainda não bloqueia');
global._currentSession.lastActivity = Date.now(); // atividade real — reinicia o contador
_checkFn3();
assertTrue(_lockCalls.length === 0, '4b. TESTE OBRIGATÓRIO 2 — atividade reinicia o contador: mesmo tendo passado perto do limite antes, uma atividade nova evita o bloqueio (mecanismo pré-existente preservado)');

// 5 — TESTE OBRIGATÓRIO 4: não cria timers duplicados após "navegação/
// reload" — simulado chamando secStartInactivityTimer() várias vezes
// seguidas (mesmo padrão real: secApplyPerms/authInit chamam de novo a
// cada navegação/reload autenticado).
reset();
mod.secStartInactivityTimer();
mod.secStartInactivityTimer();
mod.secStartInactivityTimer();
var vivos = _intervalCalls.filter(function (i) { return i.alive; });
assertTrue(_intervalCalls.length === 3 && _clearedIntervals.length === 2 && vivos.length === 1, '5. TESTE OBRIGATÓRIO 4 — chamar secStartInactivityTimer() de novo (navegação/reload) sempre limpa o timer anterior antes de criar um novo — nunca 2 timers rodando ao mesmo tempo');

// 6 — TESTE OBRIGATÓRIO 5: regressão do fluxo de desbloqueio — desligar o
// timer continua funcionando (secStopInactivityTimer), e "Desativado"
// (0 min) continua não criando timer nenhum — comportamento pré-existente
// intocado por esta mudança.
reset();
mod.secStartInactivityTimer();
mod.secStopInactivityTimer();
assertTrue(mod.getTimerHandle() === null, '6a. secStopInactivityTimer() (usado no fluxo de desbloqueio/logout) continua zerando o timer normalmente');
reset();
global._SEC_INACT_MINS = 0; // "Desativado"
mod.secStartInactivityTimer();
assertTrue(_intervalCalls.length === 0, '6b. Regressão: opção "Desativado" (0 min) continua não criando nenhum timer, mesmo após a mudança do default para 30');

// 7 — secSaveInactTime() persiste no Firestore pela MESMA chave/mecanismo
// de sempre (erp_inact_mins) — nunca uma segunda fonte de verdade.
reset();
_els.secInactTime.value = '30';
mod.secSaveInactTime();
assertTrue(_saved && _saved.key === 'erp_inact_mins' && _saved.v === 30, '7. secSaveInactTime() grava 30 na MESMA chave já usada (erp_inact_mins) — nenhuma coleção nova, nenhuma segunda fonte de verdade');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
