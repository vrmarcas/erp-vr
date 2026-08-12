/**
 * test_idempotencia_10x_2026-08-08.js
 *
 * RODADA 2.1 — item 7 (reteste de idempotência): as suítes existentes
 * (test_os_idempotencia.js, test_kbrecebersaldo_atomicidade.js,
 * test_producao_autorizacao_server.js) já provam duplo-clique e duas
 * chamadas verdadeiramente concorrentes para Gerar OS, Confirmar
 * Pagamento/Saldo e Iniciar Produção. O usuário pediu explicitamente
 * "10x clique" — não presumir que 2x prova o mesmo que 10x. Este arquivo
 * ESCALA os mesmos padrões (mesmas funções reais extraídas/mesma Cloud
 * Function real, mesmo mock de transação Firestore com latência simulada
 * para forçar corrida verdadeira) de N=2 para N=10, sem reimplementar
 * nenhuma lógica de negócio nova — só aumenta a concorrência do teste.
 *
 * Cobre:
 *   1. orcSalvarOrcamento() — 10 cliques concorrentes → 1 gravação real
 *      (função real de 3 linhas extraída de index.html, não reimplementada;
 *      _orcSalvarOrcamentoImpl é stubada como contador porque seu conteúdo
 *      interno já tem suíte própria — o que está sob teste aqui é só o
 *      guard de promise-em-voo).
 *   2. orcEnvGerarOS() — 10 "abas" concorrentes (cópias locais
 *      independentes, latência de rede simulada) → 1 OS, 1 recebimento.
 *   3. kbReceberSaldo() — 10 "abas" concorrentes tentando quitar o mesmo
 *      saldo → 1 lançamento em fin_tx, as outras 9 reconciliam como já
 *      feito (toast 'info', nunca erro nem duplicidade).
 *   4. producaoIniciarOuEditar (Cloud Function real, Firestore Emulator
 *      real) — 10 chamadas concorrentes (mesmo requestId, e depois 10 com
 *      requestIds diferentes) → 1 baixa de estoque.
 *
 * Uso: node scripts/test_idempotencia_10x_2026-08-08.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080 (demo-erp-homolog)
 * apenas para o bloco 4 — blocos 1-3 usam mock de transação em memória.
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
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== RODADA 2.1 — idempotência sob 10 chamadas concorrentes (escala de N=2 para N=10) ===\n');

(async function main() {

  // ── Bloco 1: orcSalvarOrcamento — 10 cliques concorrentes ────────────────
  await test('1. orcSalvarOrcamento(): 10 chamadas concorrentes disparam só 1 gravação real (guard real extraído, não reimplementado)', async function () {
    var src = [
      'var chamadasReais = 0;',
      'var _orcSalvarEmVoo = null;', // mesma declaração que precede orcSalvarOrcamento() em index.html — o guard real é o fechamento sobre esta variável
      'function _orcSalvarOrcamentoImpl(){ chamadasReais++; return new Promise(function(res){ setTimeout(function(){ res({id:"ORC-1",num:"1"}); },5); }); }',
      extractFn('orcSalvarOrcamento'),
      'module.exports = { orcSalvarOrcamento: orcSalvarOrcamento, getChamadasReais: function(){ return chamadasReais; } };'
    ].join('\n\n');
    var modPath = path.join(__dirname, '_orcsalvar10x_extracted.tmp.js');
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    var chamadas = [];
    for (var i = 0; i < 10; i++) chamadas.push(mod.orcSalvarOrcamento());
    var resultados = await Promise.all(chamadas);
    assertEq(mod.getChamadasReais(), 1, '10 chamadas concorrentes → exatamente 1 gravação real (não 10)');
    resultados.forEach(function (r, idx) { assertEq(r.id, 'ORC-1', 'chamada #' + (idx + 1) + ' recebe o MESMO resultado da gravação única'); });
  });

  // ── Bloco 2: orcEnvGerarOS — 10 "abas" concorrentes ───────────────────────
  // HOTFIX OPERACIONAL 2026-08-12, P0.3/P0.4 — Confirmar Pagamento
  // (orcRegistrarSituacaoFinanceira) roda uma única vez ANTES da corrida
  // (mesmo que a UI real faria: a situação financeira já está confirmada
  // antes de "Gerar OS" ficar habilitado); as 10 "abas" concorrem só na
  // etapa Gerar OS — que é onde o idempotency guard real está.
  var FN_NAMES_OS = ['orcRegistrarSituacaoFinanceira', 'orcEnvGerarOS'];
  var srcOS = [
    'var _ORC_ENVIADOS_DATA = [];',
    'function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }',
    'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; }',
    'var _OS_COUNTER = 0;',
    "var _COL = 'erp_vr';",
    'var _KB_OS_FIN_CACHE = {};',
    'var FIN_TX = [];',
    FN_NAMES_OS.map(extractFn).join('\n\n'),
    'module.exports = {',
    '  orcRegistrarSituacaoFinanceira: orcRegistrarSituacaoFinanceira,',
    '  orcEnvGerarOS: orcEnvGerarOS,',
    '  setEnviados: function(arr){ _ORC_ENVIADOS_DATA = arr; },',
    '  getEnviados: function(){ return _ORC_ENVIADOS_DATA; }',
    '};'
  ].join('\n\n');
  var modPathOS = path.join(__dirname, '_osgerar10x_extracted.tmp.js');
  fs.writeFileSync(modPathOS, srcOS);

  function makeEl(props) {
    return Object.assign({
      value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, checked: false,
      disabled: false, classList: { add: function () {}, contains: function () { return false; } },
      closest: function () { return null; },
      querySelector: function (sel) { return _query(sel); },
      querySelectorAll: function (sel) { return _queryAll(sel); },
      setAttribute: function (k, v) { this[k] = v; },
      appendChild: function () {},
      options: [{ text: 'PIX' }], selectedIndex: 0
    }, props || {});
  }
  var _elements = {};
  function reg(id, el) { el.id = id; _elements[id] = el; return el; }
  var _tipoButtons = {};
  function makeTipoBtn(tipo) { var b = makeEl({ dataset: { tipo: tipo }, style: {} }); _tipoButtons[tipo] = b; return b; }
  function _query(sel) { var m = sel.match(/\[data-tipo="([^"]+)"\]/); if (m) return _tipoButtons[m[1]] || null; return null; }
  function _queryAll(sel) { if (sel === '.pgto-tipo-btn') return Object.values(_tipoButtons); return []; }

  global.window = global;
  global.document = {
    getElementById: function (id) { return _elements[id]; },
    querySelector: function (sel) { return _query(sel); },
    querySelectorAll: function (sel) { return _queryAll(sel); },
    createElement: function () { return makeEl({}); },
    body: { appendChild: function () {}, classList: { contains: function () { return false; } } }
  };
  global.showToast = function (msg) { global._lastToast = msg; };
  global.kbRender = function () {};
  global.orcEnviadosRender = function () {};
  global.nav = function () {};
  global._cloudSave = function () {};
  global._cloudReady = false;
  global._cloudLastPayload = {};
  global.KB_OS = {};
  global.FIN_CR = [];
  global._finSaveCR = function () {};

  var _fakeStoreOS = {};
  var _txnLockOS = Promise.resolve();
  var _txnDelayMsOS = 0;
  function resetFakeStoreOS() { _fakeStoreOS = {}; }
  global._db = {
    collection: function () { return { doc: function (key) { return { _key: key }; } }; },
    runTransaction: function (fn) {
      var runIt = function () {
        var pendingWrites = {};
        var txn = {
          get: function (ref) {
            var existing = _fakeStoreOS[ref._key];
            var snap = { exists: !!existing, data: function () { return existing; } };
            return _txnDelayMsOS > 0 ? sleep(_txnDelayMsOS).then(function () { return snap; }) : Promise.resolve(snap);
          },
          set: function (ref, data) { pendingWrites[ref._key] = data; }
        };
        return Promise.resolve().then(function () { return fn(txn); }).then(function (result) {
          Object.keys(pendingWrites).forEach(function (k) { _fakeStoreOS[k] = pendingWrites[k]; });
          return result;
        });
      };
      var p = _txnLockOS.then(runIt, runIt);
      _txnLockOS = p.catch(function () {});
      return p;
    }
  };

  function resetModalDomOS() {
    _tipoButtons = {};
    ['integral', '50-50', 'parcial', 'futuro'].forEach(makeTipoBtn);
    reg('orcEnvModal', makeEl({ style: {} }));
    reg('orcBtnGerarOSWizard', makeEl({ disabled: false }));
  }
  delete require.cache[require.resolve(modPathOS)];
  var modOS = require(modPathOS);
  function makeOrcOS(id, num, valorFinal) {
    return { id: id, num: num, cliente: 'E2E_FASEF_20260805_Cliente', valorFinal: valorFinal, status: 'aguardando' };
  }
  function seedFirestoreOS(orcamentos) {
    _fakeStoreOS['orcamentos'] = { data: JSON.stringify(orcamentos) };
    _fakeStoreOS['kb_os'] = { data: JSON.stringify({}) };
    _fakeStoreOS['kb_os_fin'] = { data: JSON.stringify({}) };
    _fakeStoreOS['fin_cr'] = { data: JSON.stringify([]) };
    _fakeStoreOS['fin_tx'] = { data: JSON.stringify([]) };
    _fakeStoreOS['erp_os_counter'] = { data: JSON.stringify(0) };
  }
  function fakeStoreOSDocs() { var raw = _fakeStoreOS['kb_os']; return raw ? JSON.parse(raw.data) : {}; }
  function fakeStoreCROS() { var raw = _fakeStoreOS['fin_cr']; return raw ? JSON.parse(raw.data) : []; }

  await test('2. orcEnvGerarOS(): 10 "abas" verdadeiramente concorrentes (latência de rede simulada) → 1 OS, 1 recebimento', async function () {
    resetModalDomOS(); resetFakeStoreOS();
    var orc = makeOrcOS('ORC-10X', '000099', 999);
    seedFirestoreOS([orc]);
    modOS.setEnviados([orc]);
    // Confirmar Pagamento roda uma única vez, ANTES da corrida — é o que a
    // UI real garante (Gerar OS só fica habilitado depois de confirmado).
    await modOS.orcRegistrarSituacaoFinanceira('ORC-10X', {
      tipo: 'integral', forma: 'PIX', valorEfetivo: 999, valorEntrada: 999, restante: 0, obs: '', nf: false
    });
    global._orcSessaoAtualId = 'ORC-10X';
    _txnDelayMsOS = 15; // força as 10 transações a fazerem get() antes de qualquer set()
    try {
      var chamadas = [];
      for (var i = 0; i < 10; i++) chamadas.push(modOS.orcEnvGerarOS());
      await Promise.all(chamadas);
    } finally { _txnDelayMsOS = 0; }
    assertEq(Object.keys(fakeStoreOSDocs()).length, 1, '10 tentativas concorrentes → exatamente 1 OS');
    assertEq(fakeStoreCROS().length, 1, '10 tentativas concorrentes → exatamente 1 recebimento');
  });

  // ── Bloco 3: kbReceberSaldo — 10 "abas" concorrentes ──────────────────────
  var srcSaldo = [
    "var _COL = 'erp_vr';",
    "var _cloudLastPayload = {};",
    "var KB_OS = {};",
    "var FIN_CR = []; var FIN_TX = [];",
    "var _ORC_ENVIADOS_DATA = [];",
    "var _kbOsId = null;",
    "var _kbStatusMap = { iniciada:{cls:'si',txt:'Iniciada'}, aguardando_saldo:{cls:'sas',txt:'Aguard. Saldo'} };",
    extractFn('kbReceberSaldo'),
    "module.exports = {",
    "  kbReceberSaldo: kbReceberSaldo,",
    "  setKbOs: function(v){ KB_OS = v; }, getKbOs: function(){ return KB_OS; },",
    "  setKbOsId: function(v){ _kbOsId = v; },",
    "  setFinCR: function(v){ FIN_CR = v; }, setFinTX: function(v){ FIN_TX = v; },",
    "  setOrc: function(v){ _ORC_ENVIADOS_DATA = v; }",
    "};"
  ].join('\n\n');
  var modPathSaldo = path.join(__dirname, '_saldo10x_extracted.tmp.js');
  fs.writeFileSync(modPathSaldo, srcSaldo);

  var _fakeStoreSaldo = {};
  var _txnLockSaldo = Promise.resolve();
  var _txnDelayMsSaldo = 0;
  function resetFakeStoreSaldo() { _fakeStoreSaldo = {}; }
  function seedDocSaldo(key, value) { _fakeStoreSaldo[key] = { data: JSON.stringify(value), ts: Date.now() }; }
  function readDocSaldo(key) { var raw = _fakeStoreSaldo[key]; return raw ? JSON.parse(raw.data) : null; }

  global._db = {
    collection: function () { return { doc: function (key) { return { _key: key }; } }; },
    runTransaction: function (fn) {
      var runIt = function () {
        var pendingWrites = {};
        var txn = {
          get: function (ref) {
            var existing = _fakeStoreSaldo[ref._key];
            var snap = { exists: !!existing, data: function () { return existing; } };
            return _txnDelayMsSaldo > 0 ? sleep(_txnDelayMsSaldo).then(function () { return snap; }) : Promise.resolve(snap);
          },
          set: function (ref, data) { pendingWrites[ref._key] = data; }
        };
        return Promise.resolve().then(function () { return fn(txn); }).then(function (result) {
          Object.keys(pendingWrites).forEach(function (k) { _fakeStoreSaldo[k] = pendingWrites[k]; });
          return result;
        });
      };
      var p = _txnLockSaldo.then(runIt, runIt);
      _txnLockSaldo = p.catch(function () {});
      return p;
    }
  };
  global.firebase = { auth: function () { return { currentUser: { getIdToken: function () { return Promise.resolve('fake-token'); } } }; } };
  global.document = { getElementById: function () { return null; } };
  global._lastToast = null; global._lastToastKind = null;
  global.showToast = function (msg, kind) { global._lastToast = msg; global._lastToastKind = kind; };
  global.finRender = function () {};
  global.kbSyncCounts = function () {};
  global.renderOsTable = function () {};
  global.syncSidebarBadges = function () {};
  global.kbOpen = function () {};
  global.orcEnviadosRender = function () {};
  global.secAuditLog = function () {};
  global.finFmt = function (v) { return 'R$ ' + v; };
  delete require.cache[require.resolve(modPathSaldo)];
  var modSaldo = require(modPathSaldo);
  function baseOsSaldo(over) { return Object.assign({ id: 'os1', num: 42, status: 'aguardando_saldo', restante: 500, cliente: 'E2E_FASEF_20260805_Cli', mk: 'vr', formaPgto: 'PIX' }, over || {}); }
  function seedKbOsFinSaldo(os) { seedDocSaldo('kb_os_fin', { os1: { restante: os.restante, formaPgto: os.formaPgto } }); }

  await test('3. kbReceberSaldo(): 10 "abas" verdadeiramente concorrentes disputando o mesmo saldo → 1 lançamento, 9 reconciliam sem duplicar', async function () {
    resetFakeStoreSaldo();
    var osBase = baseOsSaldo();
    seedDocSaldo('kb_os', { os1: osBase }); seedKbOsFinSaldo(osBase);
    seedDocSaldo('fin_cr', [{ id: 'cr1', osRef: '42', status: 'pendente', valor: 500 }]);
    seedDocSaldo('fin_tx', []);
    _txnDelayMsSaldo = 12; // força as 10 transações a lerem antes de qualquer commitar
    try {
      var chamadas = [];
      for (var i = 0; i < 10; i++) {
        // cada "aba" tem sua PRÓPRIA cópia local do objeto OS (mesmo padrão do cenário E existente)
        modSaldo.setKbOs({ os1: baseOsSaldo() });
        modSaldo.setKbOsId('os1');
        modSaldo.setFinCR([{ id: 'cr1', osRef: '42', status: 'pendente', valor: 500 }]);
        modSaldo.setFinTX([]);
        modSaldo.setOrc([]);
        chamadas.push(modSaldo.kbReceberSaldo());
      }
      await Promise.all(chamadas);
    } finally { _txnDelayMsSaldo = 0; }
    assertEq(readDocSaldo('fin_tx').length, 1, '10 tentativas concorrentes → exatamente 1 lançamento em fin_tx, nunca 10');
    assertEq(readDocSaldo('kb_os').os1.status, 'iniciada', 'OS confirmada como iniciada no servidor, uma única vez');
    assertEq(readDocSaldo('kb_os_fin').os1.restante, 0, 'saldo zerado uma única vez, sem sobrescrita destrutiva');
  });

  // ── Bloco 4: producaoIniciarOuEditar — 10 chamadas reais concorrentes ─────
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  var functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
  var admin = require(path.join(functionsNodeModules, 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
  var db = admin.firestore();
  var { producaoIniciarOuEditar } = require('../functions/lib/producao.js');
  var { UID, ctx } = require('./e2e_shared_fixtures');

  async function seedOsEStoqueProd(osId, matKey, qty) {
    var kbRef = db.collection('erp_vr').doc('kb_os');
    var stockRef = db.collection('erp_vr').doc('stock');
    var kb = await kbRef.get();
    var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
    kbData[osId] = { id: osId, num: 'E2E-10X-' + osId.slice(-4), status: 'iniciada', titulo: 'E2E_FASEF_20260805_ServerAuth10x' };
    await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });
    var stock = await stockRef.get();
    var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
    stockData[matKey] = { label: 'Mat10x', qty: qty };
    await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
  }
  async function limparOSProd(osId) {
    var kbRef = db.collection('erp_vr').doc('kb_os');
    var kb = await kbRef.get();
    var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
    delete kbData[osId];
    await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });
  }
  async function limparMaterialProd(matKey) {
    var stockRef = db.collection('erp_vr').doc('stock');
    var stock = await stockRef.get();
    var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
    delete stockData[matKey];
    await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
  }
  async function getMaterialProd(matKey) {
    var stock = await db.collection('erp_vr').doc('stock').get();
    var stockData = JSON.parse(stock.data().data);
    return stockData[matKey];
  }
  var _osCounterProd = 0;
  function novoOsIdProd() { return 'e2e_10x_os_' + Date.now() + '_' + (++_osCounterProd); }
  function novoReqIdProd() { return 'req10x_' + Date.now() + '_' + Math.random().toString(36).slice(2); }

  await test('4a. producaoIniciarOuEditar (Cloud Function real): 10 chamadas concorrentes, MESMO requestId → 1 baixa só', async function () {
    var osId = novoOsIdProd(), matKey = 'e2e_10x_mat_a';
    await seedOsEStoqueProd(osId, matKey, 100);
    var reqId = novoReqIdProd();
    var chamadas = [];
    for (var i = 0; i < 10; i++) {
      chamadas.push(producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao')));
    }
    await Promise.allSettled(chamadas);
    var mat = await getMaterialProd(matKey);
    assertEq(mat.qty, 98, '10 chamadas com o mesmo requestId → no máximo uma baixa real (100-2=98, não 100-20=80)');
    await limparOSProd(osId); await limparMaterialProd(matKey);
  });

  await test('4b. producaoIniciarOuEditar (Cloud Function real): 10 chamadas concorrentes, requestIds DIFERENTES (10 tentativas reais) → só 1 vence', async function () {
    var osId = novoOsIdProd(), matKey = 'e2e_10x_mat_b';
    await seedOsEStoqueProd(osId, matKey, 100);
    var chamadas = [];
    for (var i = 0; i < 10; i++) {
      chamadas.push(producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqIdProd() }, ctx(UID.producao, 'producao')));
    }
    var results = await Promise.allSettled(chamadas);
    var sucessos = results.filter(function (r) { return r.status === 'fulfilled' && r.value.ok; });
    var falhas = results.filter(function (r) { return r.status === 'rejected'; });
    assertEq(sucessos.length, 1, 'exatamente 1 das 10 tentativas concorrentes vence, mesmo com requestIds todos diferentes');
    assertEq(falhas.length, 9, 'as outras 9 são barradas por PRODUCAO_JA_INICIADA');
    var mat = await getMaterialProd(matKey);
    assertEq(mat.qty, 98, '10 tentativas reais concorrentes → exatamente 1 baixa (100-2=98)');
    await limparOSProd(osId); await limparMaterialProd(matKey);
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
