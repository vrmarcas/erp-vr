/**
 * test_e2e_smoke_vr_2026-08-08.js
 * RODADA 2.1 — item 3 (smoke E2E pós-deploy, fluxo VR).
 *
 * As funções deste fluxo já são testadas isoladamente, cada uma com seu
 * próprio fixture sintético (orcEnvGerarOS em test_os_idempotencia.js,
 * kbReceberSaldo em test_kbrecebersaldo_atomicidade.js, orcPagtoTipoSel/
 * default 50-50 em test_pgto_tipo_pagamento.js). O que NENHUM desses
 * arquivos prova é a COMPOSIÇÃO real: a OS que orcEnvGerarOS() cria é
 * exatamente o que kbReceberSaldo() consegue consumir depois — mesmo id,
 * mesmo split kb_os/kb_os_fin, valorEntrada/restante corretos ponta a
 * ponta, sem depender de nenhum fixture "já pronto" preparado à mão.
 *
 * Funções extraídas de index.html (mesma técnica de test_os_idempotencia.js
 * — nunca reimplementadas): orcEnvConfirmarPgto, orcPagtoTipoSel,
 * orcEnvGerarOS, kbReceberSaldo.
 *
 * Uso: node scripts/test_e2e_smoke_vr_2026-08-08.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }
function assertApprox(got, exp, msg) { if (!approx(got, exp)) throw new Error((msg || 'valores diferentes') + ' — esperado ~' + exp + ', obtido ' + got); }

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

var FN_NAMES = ['orcEnvConfirmarPgto', 'orcPagtoTipoSel', 'orcEnvGerarOS', 'kbReceberSaldo', 'orcCondicaoLabelPorTipo', 'orcValorEfetivoPorForma'];
var COL = 'erp_vr';
var src = [
  'var _orcPagtoId = null;',
  'var _pgtoTipoAtual = null;',
  'var _ORC_ENVIADOS_DATA = [];',
  'function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }',
  'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; }',
  'var _OS_COUNTER = 0;',
  'var _COL = ' + JSON.stringify(COL) + ';',
  'var KB_OS = {};',
  'var _kbOsId = null;',
  'var _kbStatusMap = { iniciada:{cls:"si",txt:"Iniciada"}, aguardando_saldo:{cls:"sas",txt:"Aguard. Saldo"} };',
  'var FIN_CR = [];',
  'var _cloudLastPayload = {};',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  orcEnvConfirmarPgto: orcEnvConfirmarPgto, orcPagtoTipoSel: orcPagtoTipoSel,',
  '  orcEnvGerarOS: orcEnvGerarOS, kbReceberSaldo: kbReceberSaldo,',
  '  getPgtoTipoAtual: function(){ return _pgtoTipoAtual; },',
  '  setEnviados: function(arr){ _ORC_ENVIADOS_DATA = arr; },',
  '  getEnviados: function(){ return _ORC_ENVIADOS_DATA; },',
  '  getKbOs: function(){ return KB_OS; },',
  '  setKbOsId: function(v){ _kbOsId = v; },',
  '  getFinCR: function(){ return FIN_CR; }',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_e2e_smoke_vr_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo (mesma técnica de test_os_idempotencia.js) ────────────
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
  getElementById: function (id) { return _elements[id] || (_elements[id] = makeEl()); },
  querySelector: function (sel) { return _query(sel); },
  querySelectorAll: function (sel) { return _queryAll(sel); },
  createElement: function () { return makeEl({}); },
  body: { appendChild: function () {}, classList: { contains: function () { return false; } } }
};
global.showToast = function (msg, kind) { global._lastToast = msg; global._lastToastKind = kind; };
global.kbRender = function () {};
global.orcEnviadosRender = function () {};
global.nav = function () {};
global._cloudSave = function () {};
global._cloudReady = false;
global.finFmt = function (v) { return 'R$ ' + v; };
global.kbSyncCounts = function () {}; global.renderOsTable = function () {}; global.syncSidebarBadges = function () {};
global.kbOpen = function () {}; global.secAuditLog = function () {}; global.finRender = function () {};
global.firebase = { auth: function () { return { currentUser: { getIdToken: function () { return Promise.resolve('fake'); } } }; } };

// ── Mock de Firestore com transação real (mesma garantia observável de uma
// transação real: get-antes-de-set, commit único, serializada por doc) ────
var _fakeStore = {};
var _txnLock = Promise.resolve();
function resetFakeStore() { _fakeStore = {}; }
global._db = {
  collection: function () { return { doc: function (key) { return { _key: key }; } }; },
  runTransaction: function (fn) {
    var runIt = function () {
      var pendingWrites = {};
      var txn = {
        get: function (ref) {
          var existing = _fakeStore[ref._key];
          return Promise.resolve({ exists: !!existing, data: function () { return existing; } });
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
  _tipoButtons = {};
  ['integral', '50-50', 'parcial', 'futuro'].forEach(makeTipoBtn);
  reg('orcEnvModal', makeEl({ style: {} }));
  reg('orcPagtoModal', makeEl({ style: {} }));
  reg('orcGerarOSBtn', makeEl({ disabled: false }));
  reg('pgtoEntradaBox', makeEl({ style: {} }));
  reg('pgtoEntradaVal', makeEl({ value: '' }));
  reg('pgtoEntradaPct', makeEl({}));
  reg('pgtoForma', makeEl({ options: [{ text: 'PIX' }], selectedIndex: 0 }));
  reg('pgtoObs', makeEl({ value: '' }));
}

var mod = require(modPath);
function makeOrc(id, num, valorFinal) {
  return { id: id, num: num, cliente: 'E2E_SMOKE_VR_Cliente', valorFinal: valorFinal, status: 'aguardando' };
}
function seedFirestore(orcamentos) {
  _fakeStore['orcamentos'] = { data: JSON.stringify(orcamentos) };
  _fakeStore['kb_os'] = { data: JSON.stringify({}) };
  _fakeStore['kb_os_fin'] = { data: JSON.stringify({}) };
  _fakeStore['fin_cr'] = { data: JSON.stringify([]) };
  _fakeStore['erp_os_counter'] = { data: JSON.stringify(0) };
}
function fakeStoreOS() { var raw = _fakeStore['kb_os']; return raw ? JSON.parse(raw.data) : {}; }
function fakeStoreOSFin() { var raw = _fakeStore['kb_os_fin']; return raw ? JSON.parse(raw.data) : {}; }
function fakeStoreOSMerged() {
  var ops = fakeStoreOS(), fin = fakeStoreOSFin(), out = {};
  Object.keys(ops).forEach(function (id) { out[id] = Object.assign({}, ops[id], fin[id] || {}); });
  return out;
}

console.log('\n=== SMOKE E2E — fluxo VR: aprovar → 50/50 → gerar OS → receber saldo → iniciada ===\n');

(async function main() {
  await test('1. orçamento aprovado → confirmar pagamento (50/50 é o default) → gerar OS sem exigir pagamento total', async function () {
    resetModalDom(); resetFakeStore();
    var orc = makeOrc('ORC-SMOKE-1', '000901', 1000);
    seedFirestore([orc]);
    mod.setEnviados([orc]);
    mod.orcEnvConfirmarPgto('ORC-SMOKE-1');
    assertEq(mod.getPgtoTipoAtual(), '50-50', 'default é 50/50 — nunca exige pagamento total pra iniciar produção');
    await mod.orcEnvGerarOS();
    var osList = Object.values(fakeStoreOSMerged());
    if (!osList.length) throw new Error('OS não foi criada no servidor');
    var os = osList[0];
    assertEq(os.status, 'aguardando_saldo', 'OS criada com metade paga, aguardando o saldo — produção já pode ser iniciada nesse status');
    assertApprox(os.valorEntrada, 500, 'entrada de 50%');
    assertApprox(os.restante, 500, 'saldo pendente de 50%');
    var cr = JSON.parse(_fakeStore['fin_cr'].data);
    assertEq(cr.filter(function (c) { return c.status === 'recebido'; }).length, 1, 'entrada de 50% já lançada como recebida');
    assertEq(cr.filter(function (c) { return c.status === 'pendente'; }).length, 1, 'saldo de 50% lançado como pendente');
    var orcAtualizado = JSON.parse(_fakeStore['orcamentos'].data)[0];
    assertEq(orcAtualizado.osRef, os.id, 'orçamento fica vinculado à OS gerada');
    global.__smokeOsId = os.id;
  });

  await test('2. kbReceberSaldo() consome a MESMA OS gerada no passo 1 (nunca um fixture pré-fabricado à parte)', async function () {
    // Simula a tela abrindo a MESMA OS que acabou de ser criada — igual
    // ao que a página real faz ao navegar da confirmação de pagamento pro Kanban.
    mod.getKbOs()[global.__smokeOsId] = fakeStoreOS()[global.__smokeOsId];
    mod.setKbOsId(global.__smokeOsId);
    await mod.kbReceberSaldo();
    var os = mod.getKbOs()[global.__smokeOsId];
    assertEq(os.status, 'iniciada', 'OS avança para iniciada assim que o saldo é recebido — produção pode começar');
    assertEq(os.restante, 0, 'saldo zerado');
    var cr = JSON.parse(_fakeStore['fin_cr'].data);
    assertEq(cr.filter(function (c) { return c.status === 'recebido'; }).length, 2, 'as duas parcelas (entrada + saldo) terminam recebidas');
  });

  await test('3. Integral (sem 50/50) também nunca fica pendente de nada — status vai direto para iniciada', async function () {
    resetModalDom(); resetFakeStore();
    var orc = makeOrc('ORC-SMOKE-2', '000902', 500);
    seedFirestore([orc]);
    mod.setEnviados([orc]);
    mod.orcEnvConfirmarPgto('ORC-SMOKE-2');
    mod.orcPagtoTipoSel(_tipoButtons['integral']);
    await mod.orcEnvGerarOS();
    var os = Object.values(fakeStoreOSMerged())[0];
    assertEq(os.status, 'iniciada', 'pago 100% já nasce iniciada, sem etapa extra de "receber saldo"');
    assertEq(os.restante, 0);
    assertApprox(os.totalGeral, 500);
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
