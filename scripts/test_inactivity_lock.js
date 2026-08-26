/**
 * test_inactivity_lock.js
 * Testa as funções REAIS de bloqueio por inatividade (extraídas de
 * index.html via regex, não reimplementadas) com relógio e setInterval
 * injetáveis — nenhum teste espera 10 minutos reais. A injeção acontece
 * inteiramente no harness (sobrescrevendo setInterval/Date.now só neste
 * processo Node de teste); o código de produção em index.html não muda.
 *
 * Funções sob teste: secEngageLock, authLock, authUnlock, authInit,
 * secStartInactivityTimer, secStopInactivityTimer, secGetInactMins,
 * secGetLockState/secSetLockState/secClearLockState, secApplyLockUI,
 * secHideBootGate.
 *
 * Uso: node scripts/test_inactivity_lock.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTrue(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
function assertFalse(v, msg) { if (v) throw new Error(msg || 'esperado valor falsy'); }

// ── Extrai as funções REAIS de index.html (bundle único — várias delas se
// chamam entre si, precisam compartilhar o mesmo escopo de módulo) ─────────
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Extração por contagem de chaves balanceadas — o regex ingênuo "\n\}" usado
// em outros scripts deste repo (test_homolog_guard.js) quebra em funções de
// uma linha só (ex.: secGetSession) porque o "}" de fechamento não vem
// precedido de quebra de linha; aqui varremos char a char até a chave que
// realmente fecha a função.
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}
var FN_NAMES = [
  'secGetSession', 'secSetSession', 'secClearSession',
  'secGetLockState', 'secSetLockState', 'secClearLockState',
  'secGetInactMins', 'secHideBootGate', 'secApplyLockUI',
  'secEngageLock', 'authLock', 'authUnlock', 'authInit',
  'secStartInactivityTimer', 'secStopInactivityTimer'
];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_inactivity_lock_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Ambiente fake compartilhado (globals que as funções extraídas esperam
// encontrar como variáveis livres, exatamente como em index.html) ─────────
var _mockNow = Date.parse('2026-08-05T10:00:00-03:00');
var _origDateNow = Date.now;
Date.now = function () { return _mockNow; };
function advanceMinutes(m) { _mockNow += m * 60000; }
function advanceMs(ms) { _mockNow += ms; }

// localStorage in-memory
var _lsStore = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null; },
  setItem: function (k, v) { _lsStore[k] = String(v); },
  removeItem: function (k) { delete _lsStore[k]; }
};

function makeEl() {
  var _classes = {};
  return {
    value: '', textContent: '', disabled: false,
    classList: {
      add: function (c) { _classes[c] = true; },
      remove: function (c) { delete _classes[c]; },
      contains: function (c) { return !!_classes[c]; }
    },
    focus: function () {}
  };
}
var _dom = {};
function resetDom() {
  ['bootGate', 'authOverlay', 'lockOverlay', 'lockAvatar', 'lockName', 'lockSub', 'lockPwd', 'lockErr', 'lockBtn'].forEach(function (id) { _dom[id] = makeEl(); });
}
resetDom();
global.document = { getElementById: function (id) { return _dom[id] || null; } };

var _mockCurrentUser = null;
var _mockSignInImpl = null;
global.firebase = {
  auth: function () {
    return {
      get currentUser() { return _mockCurrentUser; },
      signOut: function () { _mockCurrentUser = null; return Promise.resolve(); },
      signInWithEmailAndPassword: function (email, pwd) {
        if (!_mockSignInImpl) return Promise.reject({ code: 'auth/network-request-failed' });
        return _mockSignInImpl(email, pwd);
      }
    };
  }
};

var _mockUsuarioDoc = null;
global._db = {
  collection: function () {
    return { doc: function () { return { get: function () { return Promise.resolve(_mockUsuarioDoc || { exists: false }); } }; } };
  }
};

var _capturedIntervalFn = null, _intervalActive = false;
global.setInterval = function (fn) { _capturedIntervalFn = fn; _intervalActive = true; return 999; };
global.clearInterval = function () { _intervalActive = false; };
function fireIntervalTick() { if (_intervalActive && _capturedIntervalFn) _capturedIntervalFn(); }

global.secAuditLog = function () {};
global.secPopulateUserSelect = function () {};
global.secCheckLockout = function () {};
global.authApplySession = function () {};
global._cloudStartTokenRenewal = function () {};
global._cloudIniciou = false;
var _cloudIniciarCallCount = 0;
global._cloudIniciar = function () { _cloudIniciarCallCount++; };
// HOTFIX CERTIFICAÇÃO FASE 3 (achado ao vivo, 2026-08-26) — secEngageLock()
// passou a encerrar todos os listeners realtime antes do signOut() (mesmo
// padrão de authLogout()/pagehide), para permitir que authUnlock() os
// reconecte do zero via _cloudIniciar() (guardado por _cloudIniciou).
var _unsubCalls = { cloud: 0, atd: 0, atdMsg: 0, atdBriefing: 0, comprasV2: 0, vitre: 0 };
global._CLOUD_UNSUBS = [
  function () { _unsubCalls.cloud++; },
  function () { _unsubCalls.cloud++; }
];
global.ATD_UNSUB = function () { _unsubCalls.atd++; };
global.ATD_MSG_UNSUB = function () { _unsubCalls.atdMsg++; };
global.ATD_BRIEFING_UNSUB = function () { _unsubCalls.atdBriefing++; };
global._comprasV2Unsubs = [function () { _unsubCalls.comprasV2++; }];
global._comprasV2ComprasSub = function () {};
global._comprasV2FinCpSub = function () {};
global._vitreCatUnsub = function () { _unsubCalls.vitre++; };
global._stockUnsub = function () {};
global._stockTombUnsub = function () {};
global._normalizeRole = function (v) {
  if (typeof v !== 'string') return null;
  var r = v.trim().toLowerCase();
  if (r === 'admin') return 'master';
  if (['master', 'comercial', 'producao', 'financeiro'].indexOf(r) >= 0) return r;
  return null;
};
global._authFirebaseError = function (code) { return '❌ erro (' + code + ')'; };
global.authLogout = function () { global._currentSession = null; };

global.SEC_LOCK_STATE_KEY = 'erp_lock_state';
global.SEC_SESSION_KEY = 'erp_session';
global._SEC_INACT_MINS = 10;
global._secTimer = null;
global._tokenRenewalTimer = null;
global._unlockInFlight = false;
global._currentSession = null;

var mod = require(modPath);
var secGetLockState = mod.secGetLockState;
var secEngageLock = mod.secEngageLock, authUnlock = mod.authUnlock, authInit = mod.authInit;
var secStartInactivityTimer = mod.secStartInactivityTimer;
var secGetInactMins = mod.secGetInactMins;

function resetAll() {
  _lsStore = {};
  resetDom();
  _mockCurrentUser = null;
  _mockSignInImpl = null;
  _mockUsuarioDoc = null;
  _capturedIntervalFn = null; _intervalActive = false;
  global._cloudIniciou = false;
  _cloudIniciarCallCount = 0;
  _unsubCalls = { cloud: 0, atd: 0, atdMsg: 0, atdBriefing: 0, comprasV2: 0, vitre: 0 };
  global._CLOUD_UNSUBS = [
    function () { _unsubCalls.cloud++; },
    function () { _unsubCalls.cloud++; }
  ];
  global.ATD_UNSUB = function () { _unsubCalls.atd++; };
  global.ATD_MSG_UNSUB = function () { _unsubCalls.atdMsg++; };
  global.ATD_BRIEFING_UNSUB = function () { _unsubCalls.atdBriefing++; };
  global._comprasV2Unsubs = [function () { _unsubCalls.comprasV2++; }];
  global._vitreCatUnsub = function () { _unsubCalls.vitre++; };
  global._stockUnsub = function () {};
global._stockTombUnsub = function () {};
  global._SEC_INACT_MINS = 10;
  global._secTimer = null;
  global._tokenRenewalTimer = null;
  global._unlockInFlight = false;
  global._currentSession = null;
  _mockNow = Date.parse('2026-08-05T10:00:00-03:00');
}

function mockUser(uid) {
  return { uid: uid, getIdTokenResult: function () { return Promise.resolve({ claims: {} }); } };
}

function loginSessionFixture(uid, funcao) {
  global._currentSession = { user: 'E2E Teste', email: 'e2e@local.test', funcao: funcao || 'producao', uid: uid || 'uid123', loginTime: Date.now(), lastActivity: Date.now() };
  _mockCurrentUser = { uid: uid || 'uid123' };
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log(' test_inactivity_lock.js — funções reais extraídas de index.html');
  console.log('='.repeat(70) + '\n');

  console.log('-- Ausência de bloqueio antes do tempo configurado --');
  await test('1. secStartInactivityTimer não bloqueia com <10min de inatividade', function () {
    resetAll(); loginSessionFixture();
    secStartInactivityTimer();
    advanceMinutes(9);
    fireIntervalTick();
    assertTrue(global._currentSession !== null, 'sessão deveria continuar ativa');
    assertEq(secGetLockState(), null, 'não deveria haver lock state');
  });

  console.log('\n-- Fronteira exata de 600.000 ms (Rodada E.1) --');
  await test('1b. NÃO bloqueia em 599.999 ms de inatividade', function () {
    resetAll(); loginSessionFixture();
    secStartInactivityTimer();
    advanceMs(599999);
    fireIntervalTick();
    assertTrue(global._currentSession !== null, 'sessão não deveria ter sido bloqueada em 599999ms');
    assertEq(secGetLockState(), null, 'não deveria haver lock state em 599999ms');
  });
  await test('1c. bloqueia em exatamente 600.000 ms de inatividade (limite inclusivo, elapsed>=mins)', function () {
    resetAll(); loginSessionFixture();
    secStartInactivityTimer();
    advanceMs(600000);
    fireIntervalTick();
    assertEq(global._currentSession, null, 'sessão deveria ter sido bloqueada em exatamente 600000ms');
    assertTrue(!!secGetLockState(), 'deveria existir lock state em 600000ms');
  });

  console.log('\n-- Bloqueio após o tempo configurado --');
  await test('2. secStartInactivityTimer bloqueia exatamente ao atingir 10min', function () {
    resetAll(); loginSessionFixture();
    secStartInactivityTimer();
    advanceMinutes(10);
    fireIntervalTick();
    assertEq(global._currentSession, null, 'sessão deveria ter sido zerada pelo bloqueio');
    var ls = secGetLockState();
    assertTrue(!!ls, 'deveria existir um lock state persistido');
    assertEq(ls.motivo, 'auto', 'motivo deveria ser "auto"');
    assertEq(_mockCurrentUser, null, 'firebase deveria estar signed-out');
  });

  await test('3. atividade humana reinicia a contagem (não bloqueia se lastActivity for recente)', function () {
    resetAll(); loginSessionFixture();
    secStartInactivityTimer();
    advanceMinutes(9);
    global._currentSession.lastActivity = Date.now(); // simula clique/digitação real
    fireIntervalTick();
    assertTrue(global._currentSession !== null, 'sessão não deveria ter sido bloqueada');
    advanceMinutes(9);
    fireIntervalTick();
    assertTrue(global._currentSession !== null, 'sessão não deveria ter sido bloqueada (contagem reiniciada)');
  });

  await test('4. polling/timers isolados não reiniciam a contagem (o próprio poll de 30s não altera lastActivity)', function () {
    resetAll(); loginSessionFixture();
    secStartInactivityTimer();
    var la0 = global._currentSession.lastActivity;
    advanceMinutes(5);
    fireIntervalTick();
    assertEq(global._currentSession.lastActivity, la0, 'lastActivity não deveria mudar sem interação real');
  });

  console.log('\n-- Persistência do bloqueio --');
  await test('5. refresh durante o bloqueio (authInit) mantém o bloqueio, nunca restaura sessão', function () {
    resetAll(); loginSessionFixture('uid-refresh');
    secEngageLock('manual');
    global._currentSession = null; // "refresh": zera estado em memória, preserva localStorage
    authInit();
    assertEq(global._currentSession, null, 'authInit não deveria restaurar sessão enquanto há lock state');
    assertTrue(_dom.lockOverlay.classList.contains('show'), 'tela de bloqueio deveria estar visível');
    assertFalse(_dom.authOverlay.classList.contains('show'), 'tela de login normal não deveria aparecer');
    assertTrue(_dom.bootGate.classList.contains('hide'), 'boot-gate deveria ter sido escondido após a decisão');
  });

  await test('6. fechar e reabrir a aba (novo authInit "do zero") também respeita o lock state', function () {
    resetAll(); loginSessionFixture('uid-reopen');
    secEngageLock('manual');
    global._currentSession = null; global._secTimer = null; global._tokenRenewalTimer = null;
    authInit();
    assertEq(global._currentSession, null);
    assertTrue(_dom.lockOverlay.classList.contains('show'));
  });

  await test('7. duas abas — a 2ª aba reflete o lock state assim que consulta authInit()', function () {
    resetAll();
    loginSessionFixture('uid-tabA');
    secEngageLock('manual');
    var domB = {}; ['bootGate', 'authOverlay', 'lockOverlay', 'lockAvatar', 'lockName', 'lockSub', 'lockPwd', 'lockErr', 'lockBtn'].forEach(function (id) { domB[id] = makeEl(); });
    var origGetById = document.getElementById;
    document.getElementById = function (id) { return domB[id] || null; };
    global._currentSession = null;
    authInit();
    assertTrue(domB.lockOverlay.classList.contains('show'), 'aba B deveria mostrar o bloqueio também');
    document.getElementById = origGetById;
  });

  console.log('\n-- Navegação direta / inicialização sem flash --');
  await test('8. navegação direta para outra rota durante o bloqueio: authInit ainda bloqueia', function () {
    resetAll(); loginSessionFixture('uid-nav');
    secEngageLock('manual');
    global._currentSession = null;
    authInit();
    assertEq(global._currentSession, null);
    assertTrue(_dom.lockOverlay.classList.contains('show'));
  });

  await test('14. inicialização sem sessão nem lock state mostra login; boot-gate só escondido no final', function () {
    resetAll();
    assertFalse(_dom.bootGate.classList.contains('hide'), 'pré-condição: boot-gate começa visível');
    authInit();
    assertTrue(_dom.authOverlay.classList.contains('show'));
    assertFalse(_dom.lockOverlay.classList.contains('show'));
    assertTrue(_dom.bootGate.classList.contains('hide'), 'boot-gate só deveria sumir depois da decisão');
  });

  console.log('\n-- Desbloqueio --');
  await test('9. senha correta da mesma conta desbloqueia', async function () {
    resetAll(); loginSessionFixture('uid-ok', 'financeiro');
    secEngageLock('manual');
    _mockSignInImpl = function (email, pwd) {
      assertEq(email, 'e2e@local.test');
      assertEq(pwd, 'SenhaCorreta123!');
      return Promise.resolve({ user: mockUser('uid-ok') });
    };
    _mockUsuarioDoc = { exists: true, data: function () { return { nome: 'E2E Teste', funcao: 'financeiro' }; } };
    _dom.lockPwd.value = 'SenhaCorreta123!';
    await authUnlock();
    assertTrue(global._currentSession !== null, 'sessão deveria ter sido restaurada');
    assertEq(secGetLockState(), null, 'lock state deveria ter sido limpo');
  });

  await test('10. senha incorreta não desbloqueia', async function () {
    resetAll(); loginSessionFixture('uid-wrong');
    secEngageLock('manual');
    _mockSignInImpl = function () { return Promise.reject({ code: 'auth/wrong-password' }); };
    _dom.lockPwd.value = 'errada';
    await authUnlock();
    assertEq(global._currentSession, null, 'não deveria ter restaurado sessão');
    assertTrue(secGetLockState() !== null, 'lock state deveria continuar');
    assertTrue(_dom.lockErr.textContent.length > 0, 'deveria mostrar mensagem de erro');
  });

  await test('11. senha de outra conta (uid diferente) nunca desbloqueia, mesmo sendo credencial válida', async function () {
    resetAll(); loginSessionFixture('uid-locked');
    secEngageLock('manual');
    _mockSignInImpl = function () { return Promise.resolve({ user: mockUser('uid-OUTRA-CONTA') }); };
    _dom.lockPwd.value = 'SenhaValidaDeOutraConta!';
    await authUnlock();
    assertEq(global._currentSession, null, 'não deveria autenticar com outra conta');
    assertTrue(secGetLockState() !== null, 'continua bloqueado');
    assertTrue(/outra conta/i.test(_dom.lockErr.textContent), 'mensagem deveria indicar conta diferente');
  });

  console.log('\n-- Logout na tela bloqueada --');
  await test('12. authUnlock sem senha não faz nada perigoso (não autentica, não limpa o bloqueio)', function () {
    resetAll(); loginSessionFixture('uid-logout');
    secEngageLock('manual');
    assertTrue(secGetLockState() !== null);
    _dom.lockPwd.value = '';
    authUnlock();
    assertEq(global._currentSession, null);
    assertTrue(secGetLockState() !== null, 'lock state não deveria ter sido removido sem senha');
  });

  console.log('\n-- Remoção manual do marcador de bloqueio --');
  await test('13b. apagar o marcador de localStorage NUNCA restaura a sessão — no máximo leva ao login normal', function () {
    resetAll(); loginSessionFixture('uid-tamper');
    secEngageLock('manual');
    assertTrue(secGetLockState() !== null, 'pré-condição: deveria estar bloqueado');
    localStorage.removeItem(SEC_LOCK_STATE_KEY); // ataque simulado: apagar só o marcador
    authInit();
    assertEq(global._currentSession, null, 'sessão NUNCA deveria ser restaurada só por apagar o marcador');
    assertEq(secGetLockState(), null, 'marcador continua ausente (não foi recriado)');
    assertEq(firebase.auth().currentUser, null, 'firebase continua signed-out — não há atalho de volta');
  });

  console.log('\n-- Leitura/ação enquanto bloqueado --');
  await test('13. depois do bloqueio, firebase.auth().currentUser é null (sem token utilizável)', function () {
    resetAll(); loginSessionFixture('uid-noaccess');
    secEngageLock('manual');
    assertEq(firebase.auth().currentUser, null, 'não deveria sobrar usuário autenticado após o bloqueio');
  });

  console.log('\n-- Configuração de tempo --');
  await test('15. secGetInactMins nunca usa 5min como padrão (era o bug antigo)', function () {
    resetAll();
    global._SEC_INACT_MINS = 10;
    assertEq(secGetInactMins(), 10);
  });
  await test('15b. "Desativado" (0) é respeitado — não cai em nenhum default', function () {
    resetAll();
    global._SEC_INACT_MINS = 0;
    assertEq(secGetInactMins(), 0, '0 deveria ser um valor explícito válido, não um "ausente"');
  });
  await test('15c. com inatividade desativada (0), o timer nunca chama secEngageLock', function () {
    resetAll(); loginSessionFixture();
    global._SEC_INACT_MINS = 0;
    secStartInactivityTimer();
    assertFalse(_intervalActive, 'não deveria nem agendar o timer com 0 (desativado)');
  });

  console.log('\n-- Ausência de senha em qualquer armazenamento --');
  await test('16. lock state em localStorage nunca contém a senha, só os campos mínimos', function () {
    resetAll(); loginSessionFixture();
    secEngageLock('manual');
    var raw = localStorage.getItem(SEC_LOCK_STATE_KEY);
    assertTrue(raw.indexOf('SenhaCorreta') === -1);
    var parsed = JSON.parse(raw);
    assertEq(Object.keys(parsed).sort(), ['email', 'funcao', 'lockedAt', 'motivo', 'nome', 'uid'].sort(), 'lock state só deve ter esses campos — nunca senha/token');
  });

  console.log('\n-- Tentativas repetidas de desbloqueio --');
  await test('17. submissões simultâneas de desbloqueio são ignoradas (trava _unlockInFlight)', async function () {
    resetAll(); loginSessionFixture('uid-race');
    secEngageLock('manual');
    var callCount = 0;
    _mockSignInImpl = function () { callCount++; return new Promise(function () {}); };
    _mockUsuarioDoc = { exists: true, data: function () { return { nome: 'X', funcao: 'master' }; } };
    _dom.lockPwd.value = 'x';
    authUnlock();
    authUnlock();
    await new Promise(function (r) { setTimeout(r, 10); });
    assertEq(callCount, 1, 'a segunda chamada deveria ter sido ignorada por _unlockInFlight');
  });

  console.log('\n-- Retorno seguro ao estado anterior --');
  await test('18. após desbloqueio bem-sucedido, o timer de inatividade reinicia do zero', async function () {
    resetAll(); loginSessionFixture('uid-restart', 'master');
    secEngageLock('manual');
    _mockSignInImpl = function () { return Promise.resolve({ user: mockUser('uid-restart') }); };
    _mockUsuarioDoc = { exists: true, data: function () { return { nome: 'Master X', funcao: 'master' }; } };
    _dom.lockPwd.value = 'ok';
    await authUnlock();
    assertTrue(global._currentSession !== null, 'sessão deveria ter sido restaurada');
    assertEq(global._currentSession.funcao, 'master', 'perfil deveria vir do Firestore, não do lock state antigo');
    assertTrue(_intervalActive, 'timer de inatividade deveria estar rodando de novo');
    assertEq(secGetLockState(), null, 'lock state deveria ter sido limpo');
  });

  console.log('\n-- Listeners realtime no bloqueio/desbloqueio (achado ao vivo, 2026-08-26) --');
  await test('18b. ACHADO REAL: secEngageLock() encerra TODOS os listeners realtime antes do signOut() — nunca mais um permission-denied em massa no instante do bloqueio', function () {
    resetAll(); loginSessionFixture('uid-listeners', 'master');
    assertEq(_unsubCalls, { cloud: 0, atd: 0, atdMsg: 0, atdBriefing: 0, comprasV2: 0, vitre: 0 }, 'nenhum unsub deveria ter sido chamado ainda');
    secEngageLock('manual');
    assertEq(_unsubCalls.cloud, 2, 'todos os listeners de _CLOUD_UNSUBS (clientes/kb_os/fin_cr/fin_cp/retalhos/orcamentos/stock/...) devem ser encerrados no bloqueio');
    assertEq(_unsubCalls.atd, 1, 'listener da lista de Atendimentos deve ser encerrado');
    assertEq(_unsubCalls.atdMsg, 1, 'listener da thread de mensagens deve ser encerrado');
    assertEq(_unsubCalls.atdBriefing, 1, 'listener do briefing ValerIA deve ser encerrado');
    assertEq(_unsubCalls.comprasV2, 1, 'listener(s) de Compras v2 devem ser encerrados');
    assertEq(_unsubCalls.vitre, 1, 'listener do Catálogo Vitre deve ser encerrado');
    assertEq(global._CLOUD_UNSUBS.length, 0, '_CLOUD_UNSUBS deve ficar vazio após o bloqueio — nunca reaproveitar referências já encerradas');
    assertEq(global.ATD_UNSUB, null, 'ATD_UNSUB deve voltar a null — mesmo padrão de authLogout()');
    assertEq(global._comprasV2Unsubs, null, '_comprasV2Unsubs deve voltar a null');
    assertEq(global._vitreCatUnsub, null, '_vitreCatUnsub deve voltar a null — permite reconectar na próxima visita à tela Vitre');
  });

  await test('18c. ACHADO REAL corrigido: bloqueio reseta _cloudIniciou — desbloqueio bem-sucedido da MESMA conta reconecta todos os listeners do zero (antes, o app inteiro ficava preso em "sem permissão" após qualquer bloqueio, manual ou pelos 30min de inatividade)', async function () {
    resetAll(); loginSessionFixture('uid-reconnect', 'master');
    global._cloudIniciou = true; // simula boot já concluído antes do bloqueio (estado real de qualquer sessão em uso)
    secEngageLock('manual');
    assertEq(global._cloudIniciou, false, 'ACHADO REAL: sem isto, authUnlock() nunca chama _cloudIniciar() de novo (guardado por _cloudIniciou), e o app inteiro fica com todos os listeners mortos e todas as flags FORBIDDEN presas para sempre');
    _mockSignInImpl = function () { return Promise.resolve({ user: mockUser('uid-reconnect') }); };
    _mockUsuarioDoc = { exists: true, data: function () { return { nome: 'Master X', funcao: 'master' }; } };
    _dom.lockPwd.value = 'ok';
    await authUnlock();
    assertEq(_cloudIniciarCallCount, 1, 'authUnlock() bem-sucedido deve reconectar tudo via _cloudIniciar() — exatamente como um login novo, nunca uma segunda fórmula');
  });

  await test('18d. ACHADO REAL corrigido (smoke ao vivo pós-desbloqueio, Certificação Fase 3 R2): secEngageLock() também reseta o guard de _watchStockTomb() — sem isto, só o Estoque em si reconectava; a lápide de itens excluídos (stock_deleted) ficava presa em "Sem permissão" para sempre após qualquer bloqueio, porque _watchStock()/_watchStockTomb() são registrados uma única vez no boot do script, fora da bateria de _cloudLoadAll()', function () {
    resetAll(); loginSessionFixture('uid-stocktomb', 'master');
    global._stockTombUnsub = function () {};
    secEngageLock('manual');
    assertEq(global._stockTombUnsub, null, 'ACHADO REAL: sem isto, _watchStockTomb() nunca recriava a inscrição (seu guard "if(_stockTombUnsub) return;" ficava preso apontando pro listener morto) — mesmo problema que _stockUnsub já tinha antes de ser corrigido');
  });

  await test('19. conta sem perfil (erp_vr_usuarios inexistente) não desbloqueia mesmo com senha certa', async function () {
    resetAll(); loginSessionFixture('uid-noperfil');
    secEngageLock('manual');
    _mockSignInImpl = function () { return Promise.resolve({ user: mockUser('uid-noperfil') }); };
    _mockUsuarioDoc = { exists: false };
    _dom.lockPwd.value = 'certa';
    await authUnlock();
    assertEq(global._currentSession, null);
    assertTrue(/perfil/i.test(_dom.lockErr.textContent));
  });

  await test('20. secStartInactivityTimer não afeta sessão já nula (guard defensivo)', function () {
    resetAll();
    global._currentSession = null;
    secStartInactivityTimer();
    fireIntervalTick();
    assertEq(secGetLockState(), null, 'sem sessão, nunca deveria criar lock state');
  });

  fs.unlinkSync(modPath);
  Date.now = _origDateNow;
  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
  console.log('='.repeat(70));
  if (failed > 0) { console.log('\nAlguns testes falharam.'); process.exit(1); }
  console.log('\nTodos os testes passaram.');
}

main();
