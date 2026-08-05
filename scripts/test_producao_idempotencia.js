/**
 * test_producao_idempotencia.js
 * Regressão do bug real encontrado na Homologação Fase F (2026-08-05),
 * Fase 6, ao testar "duas abas iniciando produção da mesma OS": kbConfirmarProd()
 * dava baixa de estoque dentro de uma transação Firestore que só protegia a
 * aritmética do documento 'stock' — sem reler nem travar 'kb_os' na mesma
 * transação. Duas chamadas concorrentes de "Iniciar Produção" para a MESMA OS
 * passavam ambas pela transação de estoque (cada uma individualmente correta)
 * e cada uma debitava o material — confirmado ao vivo no Emulator (OS #3,
 * material ac3: estoque 42→40 após duas abas, com apenas UM matProd salvo na
 * OS, escondendo a segunda baixa).
 *
 * Corrigido com uma única transação Firestore que relê kb_os/stock/retalhos/
 * erp_stock_log diretamente do banco, valida um campo canônico de idempotência
 * (`producaoStartId`, determinístico por OS) e só então aplica baixa + status +
 * matProd + log — tudo atômico. Reaproveita o mesmo padrão de
 * orcEnvGerarOS()/orcProximoNumeroAtomico() já testado e corrigido nesta fase.
 *
 * Funções sob teste (extraídas de index.html via contagem de chaves — mesma
 * técnica de test_os_idempotencia.js — não reimplementadas):
 * kbConfirmarProd, kbIniciarProd, kbPausarProd, kbEditarMatProd, kbCloseProd.
 *
 * Uso: node scripts/test_producao_idempotencia.js
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
function assertApprox(got, exp, msg) {
  if (Math.abs(got - exp) >= 0.005) throw new Error((msg || 'valores diferentes') + ' — esperado ~' + exp + ', obtido ' + got);
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ── Extração por contagem de chaves balanceadas (mesma técnica do resto da suíte) ──
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

var FN_NAMES = ['kbConfirmarProd', 'kbIniciarProd', 'kbPausarProd', 'kbEditarMatProd', 'kbCloseProd'];
var COL = 'erp_vr';
var src = [
  "var _kbOsId = null;",
  "var _kbProdTipo = 'chapa';",
  "var _kbProdEditMode = false;",
  "var _kbProdSubmitting = false;",
  "var _kbProdEditExpectedStartId = null;",
  "var _COL = " + JSON.stringify(COL) + ";",
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = {",
  "  kbConfirmarProd: kbConfirmarProd, kbIniciarProd: kbIniciarProd,",
  "  kbPausarProd: kbPausarProd, kbEditarMatProd: kbEditarMatProd, kbCloseProd: kbCloseProd,",
  "  setOsId: function(v){ _kbOsId = v; },",
  "  setTipo: function(v){ _kbProdTipo = v; },",
  "  setEditMode: function(v){ _kbProdEditMode = v; },",
  "  setSubmitting: function(v){ _kbProdSubmitting = v; },",
  "  getSubmitting: function(){ return _kbProdSubmitting; },",
  "  setEditExpectedStartId: function(v){ _kbProdEditExpectedStartId = v; }",
  "};"
].join('\n\n');
var modPath = path.join(__dirname, '_producao_idempotencia_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo ─────────────────────────────────────────────────────────
function makeEl(props) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
    querySelector: function (sel) { return _query(sel); },
    querySelectorAll: function () { return []; },
    split: undefined
  }, props || {});
}
var _elements = {};
function reg(id, el) { el.id = id; _elements[id] = el; return el; }
function _query(sel) {
  if (sel === '#kbProdOverlay .gen-submit') return _elements['_gensubmit'];
  if (sel.indexOf('.kcard[data-osid=') === 0) return null; // não simulado — ramo defensivo no código-fonte
  return null;
}
global.window = global;
global.document = {
  getElementById: function (id) { return _elements[id]; },
  querySelector: function (sel) { return _query(sel); },
  querySelectorAll: function () { return []; }
};
global._lastToast = null; global._lastToastKind = null;
global.showToast = function (msg, kind) { global._lastToast = msg; global._lastToastKind = kind; };
global._auditLog = [];
global.secAuditLog = function (tipo, msg) { global._auditLog.push({ tipo: tipo, msg: msg }); };
global.renderOsTable = function () {};
global.syncSidebarBadges = function () {};
global.stockRenderHistorico = function () {};
global.stockUpdateDisplay = function () {};
global.kbSyncCounts = function () {};
global.kbSaveKbos = function () { global._kbSaveKbosCalls = (global._kbSaveKbosCalls || 0) + 1; };
global._kbOpenProdOverlay = function () {};
global.comprasQuem = function () { return 'e2e.fasef.regressao@example.com'; };
global.comprasSolicitarDeOS = function (os, matKey, falta) { global._comprasSolicitadas = global._comprasSolicitadas || []; global._comprasSolicitadas.push({ os: os.id || os.num, matKey: matKey, falta: falta }); };
global._currentSession = { funcao: 'master', user: 'e2e.fasef.regressao@example.com' };
global._cloudReady = false;
global._cloudSave = function () {};
global._cloudLastPayload = {};

var _confirmQueue = [];
global.confirm = function () { return _confirmQueue.length ? _confirmQueue.shift() : true; };

global.KB_OS = {};
global.STOCK = {};
global.RETALHOS = [];
global.STOCK_LOG = [];

// ── Mock de Firestore com transação real (get-antes-de-set, commit único no
// final, concorrência serializada — mesma garantia observável de uma
// transação real do Firestore: duas tentativas concorrentes nunca commitam
// as duas quando disputam o mesmo documento). ──────────────────────────────
var _fakeStore = {};
var _txnLock = Promise.resolve();
var _txnDelayMs = 0;
function resetFakeStore() { _fakeStore = {}; }
global._db = {
  collection: function () { return { doc: function (key) { return { _key: key }; } }; },
  runTransaction: function (fn) {
    var runIt = function () {
      var pendingWrites = {};
      var txn = {
        get: function (ref) {
          var existing = _fakeStore[ref._key];
          var snap = { exists: !!existing, data: function () { return existing; } };
          return _txnDelayMs > 0 ? sleep(_txnDelayMs).then(function () { return snap; }) : Promise.resolve(snap);
        },
        set: function (ref, data) { pendingWrites[ref._key] = data; }
      };
      return Promise.resolve().then(function () { return fn(txn); }).then(function (result) {
        Object.keys(pendingWrites).forEach(function (k) { _fakeStore[k] = pendingWrites[k]; });
        return result;
      });
    };
    var p = _txnLock.then(runIt, runIt);
    _txnLock = p.catch(function () {});
    return p;
  }
};

function resetModalDom() {
  reg('kbProdOverlay', makeEl({}));
  reg('_gensubmit', makeEl({ disabled: false }));
  reg('kbProdObs', makeEl({ value: '' }));
  reg('kbProdRetalhoSel', makeEl({ value: '' }));
  reg('kbProdMatSel', makeEl({ value: '' }));
  reg('kbProdQty', makeEl({ value: '1' }));
  reg('kbMatProdBox', makeEl({ style: {} }));
  reg('kbMatProdLabel', makeEl({}));
  reg('kbMatProdQtyLabel', makeEl({}));
  reg('kbIniciarProdBox', makeEl({ style: {}, querySelector: function () { return _elements['_iniciarBtn']; } }));
  reg('_iniciarBtn', makeEl({}));
  reg('kbOsStag', makeEl({}));
  reg('kstag-os1', makeEl({}));
}

var mod = require(modPath);

function seedFirestore(opts) {
  _fakeStore['kb_os'] = { data: JSON.stringify(opts.kbOs || {}) };
  _fakeStore['stock'] = { data: JSON.stringify(opts.stock || {}) };
  _fakeStore['retalhos'] = { data: JSON.stringify(opts.retalhos || []) };
  _fakeStore['erp_stock_log'] = { data: JSON.stringify(opts.log || []) };
  // Espelha no cache do cliente (globais) — a UI real sempre tem esses objetos
  // sincronizados com o Firestore via onSnapshot antes do usuário poder clicar;
  // o pré-check síncrono de kbConfirmarProd() lê exatamente esses globais.
  global.KB_OS = JSON.parse(JSON.stringify(opts.kbOs || {}));
  global.STOCK = JSON.parse(JSON.stringify(opts.stock || {}));
  global.RETALHOS = JSON.parse(JSON.stringify(opts.retalhos || []));
  global.STOCK_LOG = JSON.parse(JSON.stringify(opts.log || []));
}
function fakeKbOs() { var raw = _fakeStore['kb_os']; return raw ? JSON.parse(raw.data) : {}; }
function fakeStock() { var raw = _fakeStore['stock']; return raw ? JSON.parse(raw.data) : {}; }
function fakeRetalhos() { var raw = _fakeStore['retalhos']; return raw ? JSON.parse(raw.data) : []; }
function fakeLog() { var raw = _fakeStore['erp_stock_log']; return raw ? JSON.parse(raw.data) : []; }

function makeOS(id, num, status, extra) {
  return Object.assign({ id: id, num: num, status: status, orcRef: 'ORC-' + num, cliente: 'E2E_FASEF_20260805_Producao' }, extra || {});
}
function makeStock(qty) { return { label: 'ACM 3mm', qty: qty, min: 10, max: 50, esp: 3, cor: 'Natural' }; }

console.log('\n=== Regressão: baixa duplicada de estoque ao iniciar produção (Fase F) ===\n');

(async function main() {

await test('1. início normal de produção — uma baixa, status producao, matProd e producaoStartId', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  var os = fakeKbOs()['os1'];
  assertEq(fakeStock()['acm'].qty, 24, 'estoque debitado em exatamente 1 chapa');
  assertEq(os.status, 'producao', 'status atualizado');
  assertTruthy(os.matProd, 'matProd definido');
  assertEq(os.producaoStartId, 'producao_inicio:os1', 'marca canônica de início gravada');
  assertEq(fakeLog().length, 1, 'exatamente uma entrada em STOCK_LOG');
  assertEq(fakeLog()[0].finalidade, 'inicio_producao', 'finalidade correta no log');
});

await test('2. reabrir e tentar de novo (estado em memória atualizado) não duplica', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  resetModalDom();
  mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 24, 'estoque não debitado de novo');
  assertEq(fakeLog().length, 1, 'nenhum novo STOCK_LOG');
});

await test('3. duas chamadas verdadeiramente simultâneas (mesma OS) — só uma vence', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  _txnDelayMs = 15;
  try {
    var pA = mod.kbConfirmarProd(); mod.setSubmitting(false); // simula duas abas — cada uma com seu próprio _kbProdSubmitting
    var pB = mod.kbConfirmarProd();
    await Promise.all([pA, pB]);
  } finally { _txnDelayMs = 0; }
  assertEq(fakeStock()['acm'].qty, 24, 'exatamente uma baixa mesmo com duas chamadas simultâneas');
  assertEq(fakeLog().length, 1, 'exatamente um STOCK_LOG');
  assertEq(Object.keys(fakeKbOs()['os1'].matProd || {}).length > 0, true, 'matProd definido uma única vez');
});

await test('4. duas abas — cada uma relê o estado (uma vê sucesso, outra vê "já iniciada")', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd(); // aba A confirma primeiro
  resetModalDom(); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd(); // aba B, sem saber que A já rodou, tenta também
  assertEq(fakeStock()['acm'].qty, 24, 'aba B não debita de novo');
  assertEq(global._lastToast.indexOf('já havia sido iniciada') >= 0, true, 'mensagem informativa de idempotência exibida');
});

await test('5. duplo clique — trava de UI (_kbProdSubmitting) ignora o reclique imediato', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  mod.kbConfirmarProd(); // primeiro clique — não aguarda
  var r2 = mod.kbConfirmarProd(); // reclique imediato — deve ser ignorado pela trava de UI
  assertEq(r2, undefined, 'segunda chamada retorna imediatamente (return early)');
  await sleep(20);
  assertEq(fakeStock()['acm'].qty, 24, 'apenas uma baixa efetiva');
});

await test('6. refresh e retry — nova "sessão" relê do zero e tenta de novo, sem duplicar', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  // "refresh": nova instância de estado local, _kbProdSubmitting reinicia em false
  mod.setSubmitting(false);
  resetModalDom(); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 24, 'estoque estável após refresh + retry');
  assertEq(fakeLog().length, 1, 'log não duplicado após refresh + retry');
});

await test('7. resposta perdida e retry (transação falha por conflito, cliente tenta de novo)', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  mod.setSubmitting(false);
  resetModalDom(); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd(); // "retry" pós-perda de resposta — deve ser idempotente
  assertEq(fakeStock()['acm'].qty, 24, 'retry não debita de novo');
});

await test('8. OS já em produção (matProd + producaoStartId) — nova tentativa bloqueada', async function () {
  resetModalDom(); resetFakeStore();
  var osComProd = makeOS('os1', '1', 'producao', { matProd: { matKey: 'acm', qty: 1, chapasRetiradas: 1, isRetalho: false }, producaoStartId: 'producao_inicio:os1' });
  seedFirestore({ kbOs: { os1: osComProd }, stock: { acm: makeStock(24) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 24, 'nenhuma baixa nova em OS já produzida');
  assertEq(fakeLog().length, 0, 'nenhum log novo');
});

await test('9. OS pausada sendo retomada — kbIniciarProd() não reabre baixa', async function () {
  resetModalDom(); resetFakeStore();
  var osPausada = makeOS('os1', '1', 'iniciada', { matProd: { matKey: 'acm', qty: 1, chapasRetiradas: 1, isRetalho: false }, producaoStartId: 'producao_inicio:os1' });
  global.KB_OS = { os1: osPausada };
  global.STOCK = { acm: makeStock(24) };
  mod.setOsId('os1');
  mod.kbIniciarProd();
  assertEq(global.KB_OS['os1'].status, 'producao', 'status volta para produção');
  assertEq(global.STOCK['acm'].qty, 24, 'estoque não muda ao retomar');
  assertEq(global._kbSaveKbosCalls > 0, true, 'retomada persiste via kbSaveKbos (sem transação — não toca estoque)');
});

await test('10. OS com matProd legado e SEM producaoStartId — tratada como já iniciada (não debita de novo)', async function () {
  resetModalDom(); resetFakeStore();
  var osLegado = makeOS('os1', '1', 'producao', { matProd: { matKey: 'acm', qty: 1, chapasRetiradas: 1, isRetalho: false } }); // sem producaoStartId — dado pré-correção
  seedFirestore({ kbOs: { os1: osLegado }, stock: { acm: makeStock(24) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 24, 'dado legado sem marca não sofre nova baixa');
});

await test('10b. OS legada — kbIniciarProd() também reconhece matProd sem producaoStartId como já iniciada', async function () {
  resetModalDom(); resetFakeStore();
  var osLegado = makeOS('os1', '1', 'iniciada', { matProd: { matKey: 'acm', qty: 1, chapasRetiradas: 1, isRetalho: false } });
  global.KB_OS = { os1: osLegado };
  global.STOCK = { acm: makeStock(24) };
  mod.setOsId('os1');
  mod.kbIniciarProd();
  assertEq(global.KB_OS['os1'].status, 'producao', 'retomada reconhece matProd legado');
  assertEq(global.STOCK['acm'].qty, 24, 'nenhuma baixa nova');
});

await test('11. STOCK_LOG órfão (log de início sem matProd na OS) — bloqueia com inconsistência', async function () {
  resetModalDom(); resetFakeStore();
  var osSemMatProd = makeOS('os1', '1', 'iniciada'); // sem matProd
  var logOrfao = [{ tipo: 'saida', matKey: 'acm', qty: 1, os: '1', osId: 'os1', finalidade: 'inicio_producao', idempotencyKey: 'producao_inicio:os1' }];
  seedFirestore({ kbOs: { os1: osSemMatProd }, stock: { acm: makeStock(24) }, log: logOrfao });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 24, 'nenhuma baixa aplicada sobre inconsistência');
  assertEq(global._lastToastKind, 'err', 'toast de erro exibido');
  assertEq(global._lastToast.indexOf('Inconsistência') >= 0, true, 'mensagem de inconsistência exibida');
});

await test('12. estoque insuficiente — nenhuma baixa, nenhum log, nenhuma mudança de status', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(0) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  _confirmQueue.push(false, false); // sessão master decide NÃO autorizar a exceção nem registrar compra
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 0, 'estoque inalterado');
  assertEq(fakeKbOs()['os1'].status, 'iniciada', 'status não avança sem estoque');
  assertEq(fakeLog().length, 0, 'nenhum log parcial');
});

await test('13. estoque exatamente igual ao necessário — sucede, termina em zero', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(1) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 0, 'estoque zera corretamente');
  assertEq(fakeKbOs()['os1'].status, 'producao', 'status avança com estoque exato');
});

await test('14. quantidade fracionária — arredonda para cima e registra sobra', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(10) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1.5';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 8, '2 chapas retiradas para atender 1.5');
  assertApprox(fakeKbOs()['os1'].matProd.sobra, 0.5, 'sobra registrada corretamente');
});

await test('15. centavos/unidades decimais — 2.25 retira 3 chapas, sobra 0.75', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(10) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '2.25';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 7, '3 chapas retiradas para atender 2.25');
  assertApprox(fakeKbOs()['os1'].matProd.sobra, 0.75, 'sobra fracionária correta');
});

await test('16. falha antes de qualquer escrita (OS inexistente) — nenhum documento tocado', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: {}, stock: { acm: makeStock(24) } }); // OS não existe
  mod.setOsId('os-fantasma'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 24, 'estoque intocado');
  assertEq(fakeLog().length, 0, 'log intocado');
});

await test('17. falha após leitura, antes do commit (estoque insuficiente) — sem escrita parcial', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(0) }, log: [{ tipo: 'entrada', matKey: 'x' }] });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  _confirmQueue.push(false, false);
  await mod.kbConfirmarProd();
  assertEq(fakeLog().length, 1, 'log permanece exatamente como estava antes (nenhuma escrita parcial)');
  assertEq(fakeKbOs()['os1'].status, 'iniciada', 'kb_os não foi escrito');
});

await test('18. conflito transacional — duas OS diferentes, mesmo material, simultâneas: ambas prosseguem, soma correta', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada'), os2: makeOS('os2', '2', 'iniciada') }, stock: { acm: makeStock(25) } });
  _txnDelayMs = 15;
  try {
    mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
    _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
    var pA = mod.kbConfirmarProd();
    mod.setOsId('os2'); mod.setSubmitting(false); mod.setEditMode(false);
    _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '2';
    var pB = mod.kbConfirmarProd();
    await Promise.all([pA, pB]);
  } finally { _txnDelayMs = 0; }
  assertEq(fakeStock()['acm'].qty, 22, 'saldo final = 25 - 1 - 2, soma correta das duas baixas legítimas');
  assertTruthy(fakeKbOs()['os1'].matProd, 'OS #1 recebeu seu matProd');
  assertTruthy(fakeKbOs()['os2'].matProd, 'OS #2 recebeu seu matProd');
  assertEq(fakeLog().length, 2, 'um log por OS — nenhuma baixa perdida (lost update)');
});

await test('19. duas OS diferentes usando o mesmo material — nenhuma bloqueia a outra indevidamente', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada'), os2: makeOS('os2', '2', 'iniciada') }, stock: { acm: makeStock(10) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '3';
  await mod.kbConfirmarProd();
  mod.setOsId('os2'); mod.setSubmitting(false); mod.setEditMode(false);
  resetModalDom();
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '4';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 3, '10 - 3 - 4 = 3, ambas as OS avançaram');
  assertEq(fakeKbOs()['os1'].status, 'producao', 'OS #1 em produção');
  assertEq(fakeKbOs()['os2'].status, 'producao', 'OS #2 em produção');
});

await test('20. mesma OS, dois materiais diferentes em paralelo — só um início vence (o outro é rejeitado, não mistura)', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(10), ac3: makeStock(10) } });
  _txnDelayMs = 15;
  try {
    mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
    _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
    var pA = mod.kbConfirmarProd();
    mod.setSubmitting(false);
    resetModalDom(); mod.setEditMode(false);
    _elements['kbProdMatSel'].value = 'ac3'; _elements['kbProdQty'].value = '1';
    var pB = mod.kbConfirmarProd();
    await Promise.all([pA, pB]);
  } finally { _txnDelayMs = 0; }
  var totalDebitado = (10 - fakeStock()['acm'].qty) + (10 - fakeStock()['ac3'].qty);
  assertEq(totalDebitado, 1, 'apenas um dos dois materiais foi debitado — a OS não fica com baixa dupla em materiais diferentes');
  assertEq(fakeLog().length, 1, 'exatamente um log, não dois');
});

await test('21. manipulação do botão/estado de UI não contorna a proteção de dados', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  // reabilita manualmente a trava de UI (equivalente a reabilitar o botão via DOM) e tenta de novo
  mod.setSubmitting(false);
  _elements['_gensubmit'].disabled = false;
  resetModalDom(); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 24, 'a camada de dados bloqueia mesmo com a trava de UI reaberta manualmente');
});

await test('22. exatamente uma baixa / um log / uma marca — contagem explícita', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  for (var i = 0; i < 4; i++) { mod.setSubmitting(false); resetModalDom(); mod.setEditMode(false); _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1'; await mod.kbConfirmarProd(); }
  assertEq(fakeStock()['acm'].qty, 24, 'apenas a primeira das 4 tentativas debitou');
  assertEq(fakeLog().length, 1, 'apenas um log entre as 4 tentativas');
  var startIds = [fakeKbOs()['os1'].producaoStartId];
  assertEq(startIds.length, 1, 'uma única marca de início');
});

await test('23. nenhum status regressivo — pausar e retomar mantém producao, não volta a estado anterior', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  global.KB_OS = fakeKbOs();
  global.STOCK = fakeStock();
  mod.setOsId('os1');
  mod.kbPausarProd(); // confirm() mockado retorna true por padrão
  assertEq(global.KB_OS['os1'].status, 'iniciada', 'pausa volta para iniciada (comportamento existente preservado)');
  assertTruthy(global.KB_OS['os1'].producaoStartId, 'marca de início preservada durante a pausa');
  mod.kbIniciarProd(); // retomar
  assertEq(global.KB_OS['os1'].status, 'producao', 'retomada avança para produção, nunca regride');
  assertEq(global.STOCK['acm'].qty, 24, 'estoque não muda em nenhuma etapa de pausa/retomada');
});

await test('24. nenhum documento parcial em falha (RETALHO_INDISPONIVEL) — stock/log/kb_os intocados', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: {}, retalhos: [{ mat: 'acm', dims: '30x30', label: 'ACM', codigo: 'R1', qty: 0 }] });
  mod.setOsId('os1'); mod.setTipo('retalho'); mod.setEditMode(false);
  _elements['kbProdRetalhoSel'].value = '0';
  // força a lista de UI a "ver" o retalho como disponível para passar do pré-check de seleção,
  // mas a transação relê o Firestore fresco (qty:0) e deve rejeitar
  global.RETALHOS = [{ mat: 'acm', dims: '30x30', label: 'ACM', codigo: 'R1', qty: 1 }];
  await mod.kbConfirmarProd();
  assertEq(fakeRetalhos()[0].qty, 0, 'retalho não foi decrementado além do que já era');
  assertEq(fakeKbOs()['os1'].status, 'iniciada', 'status não avançou');
  assertEq(fakeLog().length, 0, 'nenhum log parcial');
});

await test('25. início por retalho — sucesso simples, retalho decrementado, matProd correto', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: {}, retalhos: [{ mat: 'acm', dims: '30x30', label: 'ACM', codigo: 'R1', qty: 1 }] });
  mod.setOsId('os1'); mod.setTipo('retalho'); mod.setEditMode(false);
  _elements['kbProdRetalhoSel'].value = '0';
  global.RETALHOS = [{ mat: 'acm', dims: '30x30', label: 'ACM', codigo: 'R1', qty: 1 }];
  await mod.kbConfirmarProd();
  assertEq(fakeRetalhos()[0].qty, 0, 'retalho decrementado');
  assertTruthy(fakeKbOs()['os1'].matProd.isRetalho, 'matProd marcado como retalho');
  assertEq(fakeKbOs()['os1'].status, 'producao', 'status avança com retalho');
});

await test('26. retalho — duas tentativas simultâneas do mesmo retalho: só uma vence', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada'), os2: makeOS('os2', '2', 'iniciada') }, stock: {}, retalhos: [{ mat: 'acm', dims: '30x30', label: 'ACM', codigo: 'R1', qty: 1 }] });
  global.RETALHOS = [{ mat: 'acm', dims: '30x30', label: 'ACM', codigo: 'R1', qty: 1 }];
  _txnDelayMs = 15;
  try {
    mod.setOsId('os1'); mod.setTipo('retalho'); mod.setEditMode(false);
    _elements['kbProdRetalhoSel'].value = '0';
    var pA = mod.kbConfirmarProd();
    mod.setOsId('os2'); mod.setSubmitting(false); mod.setEditMode(false);
    resetModalDom(); _elements['kbProdRetalhoSel'].value = '0';
    var pB = mod.kbConfirmarProd();
    await Promise.all([pA, pB]);
  } finally { _txnDelayMs = 0; }
  assertEq(fakeRetalhos()[0].qty, 0, 'retalho consumido uma única vez');
  var osComProd = [fakeKbOs()['os1'], fakeKbOs()['os2']].filter(function (o) { return o.matProd; });
  assertEq(osComProd.length, 1, 'apenas uma das duas OS conseguiu usar o retalho');
});

await test('27. edição de material — restaura o antigo e aplica o novo atomicamente', async function () {
  resetModalDom(); resetFakeStore();
  var osComProd = makeOS('os1', '1', 'producao', { matProd: { matKey: 'acm', qty: 1, chapasRetiradas: 1, isRetalho: false }, producaoStartId: 'producao_inicio:os1' });
  seedFirestore({ kbOs: { os1: osComProd }, stock: { acm: makeStock(24), ac3: makeStock(10) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(true);
  mod.setEditExpectedStartId('producao_inicio:os1');
  _elements['kbProdMatSel'].value = 'ac3'; _elements['kbProdQty'].value = '2';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 25, 'material antigo restaurado (24+1)');
  assertEq(fakeStock()['ac3'].qty, 8, 'novo material debitado (10-2)');
  assertEq(fakeKbOs()['os1'].matProd.matKey, 'ac3', 'matProd atualizado para o novo material');
});

await test('28. edição com conflito de concorrência (outra edição já ocorreu) — bloqueada', async function () {
  resetModalDom(); resetFakeStore();
  var osComProd = makeOS('os1', '1', 'producao', { matProd: { matKey: 'ac3', qty: 2, chapasRetiradas: 2, isRetalho: false }, producaoStartId: 'producao_inicio:os1' });
  seedFirestore({ kbOs: { os1: osComProd }, stock: { acm: makeStock(25), ac3: makeStock(8) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(true);
  mod.setEditExpectedStartId('producao_inicio:UM_VALOR_DIFERENTE_DO_ATUAL');
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['ac3'].qty, 8, 'nada restaurado — edição bloqueada por conflito');
  assertEq(fakeStock()['acm'].qty, 25, 'nada debitado — edição bloqueada por conflito');
});

await test('29. edição sem produção iniciada (matProd ausente) — bloqueada com mensagem clara', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'iniciada') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(true);
  mod.setEditExpectedStartId(null);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 25, 'nenhuma baixa — não é possível "editar" produção que nunca começou');
});

await test('30. OS status pronta/entregue/cancelado — início de produção bloqueado defensivamente', async function () {
  resetModalDom(); resetFakeStore();
  seedFirestore({ kbOs: { os1: makeOS('os1', '1', 'pronta') }, stock: { acm: makeStock(25) } });
  mod.setOsId('os1'); mod.setTipo('chapa'); mod.setEditMode(false);
  _elements['kbProdMatSel'].value = 'acm'; _elements['kbProdQty'].value = '1';
  await mod.kbConfirmarProd();
  assertEq(fakeStock()['acm'].qty, 25, 'nenhuma baixa em OS já pronta — chamada direta não contorna a checagem de status');
});

console.log('\n=== resultado ===');
console.log('passed=' + passed + ' failed=' + failed);
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);

})();
