/**
 * test_e2e_smoke_vr_2026-08-08.js
 * RODADA 2.1 — item 3 (smoke E2E pós-deploy, fluxo VR).
 *
 * As funções deste fluxo já são testadas isoladamente, cada uma com seu
 * próprio fixture sintético (orcEnvGerarOS em test_os_idempotencia.js,
 * kbReceberSaldo em test_kbrecebersaldo_atomicidade.js, o painel Tipo de
 * Pagamento em test_pgto_tipo_pagamento.js). O que NENHUM desses arquivos
 * prova é a COMPOSIÇÃO real: a OS que orcEnvGerarOS() cria é exatamente o
 * que kbReceberSaldo() consegue consumir depois — mesmo id, mesmo split
 * kb_os/kb_os_fin, valorEntrada/restante corretos ponta a ponta, sem
 * depender de nenhum fixture "já pronto" preparado à mão.
 *
 * HOTFIX OPERACIONAL 2026-08-12, P0.3/P0.4 — Confirmar Pagamento e Gerar OS
 * viraram duas ações separadas (o modal secundário "Confirmar Pagamento"
 * foi removido; tudo vive na própria Etapa 4 do wizard). Este smoke agora
 * exercita as duas etapas reais nessa ordem: orcRegistrarSituacaoFinanceira
 * (o que orcConfirmarPagamentoWizard() grava — CR/FIN_TX/pgtoConfirmado,
 * sem OS) e só depois orcEnvGerarOS() (que exige o.pgtoConfirmado e só
 * VINCULA o CR/FIN_TX já existentes à OS, nunca cria um segundo
 * lançamento).
 *
 * Funções extraídas de index.html (mesma técnica de test_os_idempotencia.js
 * — nunca reimplementadas): orcRegistrarSituacaoFinanceira, orcEnvGerarOS,
 * kbReceberSaldo.
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

// HOTFIX BLOCO G (Rodada de Hardening, Fase 2, 2026-08-26) — orcRegistrarSituacaoFinanceira()/
// orcEnvGerarOS() passaram a normalizar o orçamento via orcEnvNormalizar()
// (schema legado × ValerIA), nunca reimplementada.
var FN_NAMES = ['orcRegistrarSituacaoFinanceira', 'orcEnvGerarOS', 'kbReceberSaldo', 'orcEnvNormalizar'];
var COL = 'erp_vr';
var src = [
  'var _ORC_ENVIADOS_DATA = [];',
  'function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }',
  'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; }',
  'var _OS_COUNTER = 0;',
  'var _COL = ' + JSON.stringify(COL) + ';',
  'var KB_OS = {};',
  'var _KB_OS_FIN_CACHE = {};',
  'var _KB_OS_FIN_FIELDS = ["valor","totalGeral","parcelas","formaPgto","pagtoTipo","valorEntrada","restante"];',
  'function _kbMergeFinCache(){ Object.keys(_KB_OS_FIN_CACHE).forEach(function(id){ var os=KB_OS[id]; if(!os) return; var fin=_KB_OS_FIN_CACHE[id]; if(!fin) return; _KB_OS_FIN_FIELDS.forEach(function(f){ if(fin[f]!==undefined) os[f]=fin[f]; }); }); }',
  'var _kbOsId = null;',
  'var _kbStatusMap = { iniciada:{cls:"si",txt:"Iniciada"}, aguardando_saldo:{cls:"sas",txt:"Aguard. Saldo"} };',
  'var FIN_CR = [];',
  'var FIN_TX = [];',
  'var _cloudLastPayload = {};',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  orcRegistrarSituacaoFinanceira: orcRegistrarSituacaoFinanceira,',
  '  orcEnvGerarOS: orcEnvGerarOS, kbReceberSaldo: kbReceberSaldo,',
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

// HARDENING DE CONFIDENCIALIDADE FINANCEIRA (2026-08-26) — orcRegistrarSituacaoFinanceira()/
// orcEnvGerarOS()/kbReceberSaldo() não fazem mais suas transações de
// fin_cr/fin_tx no client (migradas para Cloud Functions reais — ver
// functions/src/finCr.ts, já cobertas contra o Firestore Emulator real por
// test_hardening_fin_cr_functions_server_2026-08-26.js). O mock abaixo
// porta a MESMA lógica das 3 Functions usadas por este smoke E2E
// (finCrConfirmarPagamento, finCrVincularOS, finCrReceberSaldo) para
// dentro do mock _db.runTransaction já existente aqui.
function _dataHojeBR() { var h = new Date(); return String(h.getDate()).padStart(2, '0') + '/' + String(h.getMonth() + 1).padStart(2, '0') + '/' + h.getFullYear(); }
global.firebase = {
  auth: function () { return { currentUser: { getIdToken: function () { return Promise.resolve('fake'); } } }; },
  functions: function () {
    return {
      httpsCallable: function (nome) {
        return function (payload) {
          if (nome === 'finCrConfirmarPagamento') {
            return global._db.runTransaction(function (txn) {
              return Promise.all([txn.get({ _key: 'orcamentos' }), txn.get({ _key: 'fin_cr' }), txn.get({ _key: 'fin_tx' })]).then(function (snaps) {
                var arrOrc = (snaps[0].exists && JSON.parse(snaps[0].data().data)) || [];
                var arrCR = (snaps[1].exists && JSON.parse(snaps[1].data().data)) || [];
                var arrTx = (snaps[2].exists && JSON.parse(snaps[2].data().data)) || [];
                var idx = arrOrc.findIndex(function (o) { return o.id === payload.orcId; });
                if (idx < 0) { var eNF = new Error('ORC_NAO_ENCONTRADO'); eNF.code = 'not-found'; throw eNF; }
                var orc = arrOrc[idx];
                if (orc.pgtoConfirmado) return { ok: true, jaConfirmado: true, dados: orc.pgtoConfirmado, semGravar: true };
                var dia = _dataHojeBR();
                var txMutado = false;
                if (payload.valorEntrada > 0) {
                  if (orc.crId) { var iOld = arrCR.findIndex(function (c) { return c.id === orc.crId; }); if (iOld >= 0) arrCR.splice(iOld, 1); }
                  var nowMs = Date.now();
                  arrCR.unshift({ id: 'cr' + nowMs, cliente: payload.cliente, clienteId: '', orcamentoId: payload.orcId, osId: '', descricao: 'Entrada ORC #' + payload.numOrc, valor: payload.valorEntrada, vencimento: dia, status: 'recebido', marca: payload.marca || 'vr', metodo: payload.forma, osRef: '', dataCriacao: dia, dataRecebimento: dia });
                  if (payload.restante > 0) arrCR.unshift({ id: 'cr' + (nowMs + 1), cliente: payload.cliente, clienteId: '', orcamentoId: payload.orcId, osId: '', descricao: 'Restante ORC #' + payload.numOrc, valor: payload.restante, vencimento: dia, status: 'pendente', marca: payload.marca || 'vr', metodo: payload.forma, osRef: '', dataCriacao: dia, dataRecebimento: null });
                  arrTx.unshift({ data: dia.slice(0, 5), cliente: payload.cliente, os: '', orcamentoId: payload.orcId, marca: payload.marca || 'vr', valor: payload.valorEntrada, metodo: payload.forma, status: 'recebido', dia: 1, sem: 1, mes: 1 });
                  txMutado = true;
                } else if (payload.tipo === 'futuro') {
                  var iCr = orc.crId ? arrCR.findIndex(function (c) { return c.id === orc.crId; }) : -1;
                  if (iCr >= 0) { arrCR[iCr].valor = payload.valorEfetivo; arrCR[iCr].metodo = payload.forma; }
                  else { var novoCrId = 'cr' + Date.now(); arrCR.unshift({ id: novoCrId, cliente: payload.cliente, clienteId: '', orcamentoId: payload.orcId, osId: '', descricao: 'ORC #' + payload.numOrc, valor: payload.valorEfetivo, vencimento: dia, status: 'pendente', marca: payload.marca || 'vr', metodo: payload.forma, osRef: '', dataCriacao: dia, dataRecebimento: null }); orc.crId = novoCrId; }
                }
                var pgtoConfirmado = { tipo: payload.tipo, forma: payload.forma, valorEfetivo: payload.valorEfetivo, valorEntrada: payload.valorEntrada, restante: payload.restante, obs: payload.obs, nf: payload.nf, confirmadoEm: dia, confirmadoPor: 'mock' };
                orc.pgtoConfirmado = pgtoConfirmado;
                arrOrc[idx] = orc;
                txn.set({ _key: 'orcamentos' }, { data: JSON.stringify(arrOrc) });
                txn.set({ _key: 'fin_cr' }, { data: JSON.stringify(arrCR) });
                if (txMutado) txn.set({ _key: 'fin_tx' }, { data: JSON.stringify(arrTx) });
                return { ok: true, jaConfirmado: false, dados: pgtoConfirmado, semGravar: false };
              });
            }).then(function (r) { return { data: r }; });
          }
          if (nome === 'finCrVincularOS') {
            return global._db.runTransaction(function (txn) {
              return Promise.all([txn.get({ _key: 'fin_cr' }), txn.get({ _key: 'fin_tx' })]).then(function (snaps) {
                var arrCR = (snaps[0].exists && JSON.parse(snaps[0].data().data)) || [];
                var arrTx = (snaps[1].exists && JSON.parse(snaps[1].data().data)) || [];
                var nCR = 0, nTx = 0;
                arrCR.forEach(function (c) { if (c.orcamentoId === payload.orcamentoId && !c.osId) { c.osId = payload.osId; c.osRef = 'OS #' + payload.osNum; nCR++; } });
                arrTx.forEach(function (t) { if (t.orcamentoId === payload.orcamentoId && !t.os) { t.os = String(payload.osNum); nTx++; } });
                if (nCR > 0) txn.set({ _key: 'fin_cr' }, { data: JSON.stringify(arrCR) });
                if (nTx > 0) txn.set({ _key: 'fin_tx' }, { data: JSON.stringify(arrTx) });
                return { ok: true, vinculados: nCR };
              });
            }).then(function (r) { return { data: r }; });
          }
          if (nome === 'finCrReceberSaldo') {
            var osId = payload.osId;
            return global._db.runTransaction(function (txn) {
              return Promise.all([txn.get({ _key: 'kb_os' }), txn.get({ _key: 'kb_os_fin' }), txn.get({ _key: 'fin_cr' }), txn.get({ _key: 'fin_tx' }), txn.get({ _key: 'orcamentos' })]).then(function (snaps) {
                var kbData = (snaps[0].exists && JSON.parse(snaps[0].data().data)) || {};
                var kbFinData = (snaps[1].exists && JSON.parse(snaps[1].data().data)) || {};
                var crArr = (snaps[2].exists && JSON.parse(snaps[2].data().data)) || [];
                var txArr = (snaps[3].exists && JSON.parse(snaps[3].data().data)) || [];
                var orcArr = snaps[4].exists ? JSON.parse(snaps[4].data().data) : null;
                var osServidor = kbData[osId];
                var finServidor = kbFinData[osId] || {};
                if (!osServidor) { var eNF2 = new Error('OS_NAO_ENCONTRADA'); eNF2.code = 'not-found'; throw eNF2; }
                if ((finServidor.restante || 0) <= 0) { var eJa = new Error('SALDO_JA_QUITADO'); eJa.code = 'failed-precondition'; throw eJa; }
                var valorRecebido = finServidor.restante || 0;
                osServidor.status = 'iniciada'; finServidor.restante = 0;
                kbData[osId] = osServidor; kbFinData[osId] = finServidor;
                var crEntry = crArr.find(function (c) { return c.osRef && c.osRef.indexOf(String(osServidor.num)) >= 0 && c.status === 'pendente'; });
                if (crEntry) { crEntry.status = 'recebido'; }
                txArr = [{ os: String(osServidor.num), valor: valorRecebido }].concat(txArr);
                var orcMutado = false;
                if (osServidor.orcRef && Array.isArray(orcArr)) {
                  var orcEntry = orcArr.find(function (o) { return o.id === osServidor.orcRef; });
                  if (orcEntry && orcEntry.status === 'aguardando_pagamento') { orcEntry.status = 'pago'; orcMutado = true; }
                }
                txn.set({ _key: 'kb_os' }, { data: JSON.stringify(kbData) });
                txn.set({ _key: 'kb_os_fin' }, { data: JSON.stringify(kbFinData) });
                txn.set({ _key: 'fin_tx' }, { data: JSON.stringify(txArr) });
                if (crEntry) txn.set({ _key: 'fin_cr' }, { data: JSON.stringify(crArr) });
                if (orcMutado) txn.set({ _key: 'orcamentos' }, { data: JSON.stringify(orcArr) });
                return { osNum: osServidor.num, valorRecebido: valorRecebido, orcRef: orcMutado ? osServidor.orcRef : null };
              });
            }).then(function (r) { return { data: Object.assign({ ok: true, jaProcessado: false }, r) }; })
              .catch(function (e) { var err = new Error(e.message); err.code = e.code || 'internal'; throw err; });
          }
          return Promise.resolve({ data: { ok: true } });
        };
      }
    };
  }
};

function resetModalDom() {
  _tipoButtons = {};
  ['integral', '50-50', 'parcial', 'futuro'].forEach(makeTipoBtn);
  reg('orcEnvModal', makeEl({ style: {} }));
  reg('orcBtnGerarOSWizard', makeEl({ disabled: false }));
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
  _fakeStore['fin_tx'] = { data: JSON.stringify([]) };
  _fakeStore['erp_os_counter'] = { data: JSON.stringify(0) };
}
function fakeStoreOS() { var raw = _fakeStore['kb_os']; return raw ? JSON.parse(raw.data) : {}; }
function fakeStoreOSFin() { var raw = _fakeStore['kb_os_fin']; return raw ? JSON.parse(raw.data) : {}; }
function fakeStoreOSMerged() {
  var ops = fakeStoreOS(), fin = fakeStoreOSFin(), out = {};
  Object.keys(ops).forEach(function (id) { out[id] = Object.assign({}, ops[id], fin[id] || {}); });
  return out;
}
// HOTFIX OPERACIONAL 2026-08-12, P0.3/P0.4 — simula exatamente o que
// orcConfirmarPagamentoWizard() calcula e passa adiante (base já validada
// pelos testes dedicados de orcPgtoTipoSelWizard), sem depender do DOM
// completo do wizard nem de orcSalvarOrcamento().
async function confirmarPagamento(orcId, tipo, valorTotal, valorEntrada, restante) {
  global.window._orcSessaoAtualId = orcId;
  return mod.orcRegistrarSituacaoFinanceira(orcId, {
    tipo: tipo, forma: 'PIX', valorEfetivo: valorTotal, valorEntrada: valorEntrada, restante: restante, obs: '', nf: false
  });
}

console.log('\n=== SMOKE E2E — fluxo VR: aprovar → confirmar pagamento (50/50) → gerar OS → receber saldo → iniciada ===\n');

(async function main() {
  await test('1. orçamento aprovado → Confirmar Pagamento (50/50) → Gerar OS sem exigir pagamento total', async function () {
    resetModalDom(); resetFakeStore();
    var orc = makeOrc('ORC-SMOKE-1', '000901', 1000);
    seedFirestore([orc]);
    mod.setEnviados([orc]);
    var confirmado = await confirmarPagamento('ORC-SMOKE-1', '50-50', 1000, 500, 500);
    assertEq(confirmado.ok, true, 'Confirmar Pagamento grava a situação financeira com sucesso');
    assertEq(confirmado.dados.tipo, '50-50', 'tipo confirmado é o mesmo enviado');
    global.window._orcSessaoAtualId = 'ORC-SMOKE-1';
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
    assertEq(cr.every(function (c) { return c.osId === os.id; }), true, 'Gerar OS vinculou os CRs já registrados na Confirmação à OS recém-criada, sem duplicar');
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
    await confirmarPagamento('ORC-SMOKE-2', 'integral', 500, 500, 0);
    global.window._orcSessaoAtualId = 'ORC-SMOKE-2';
    await mod.orcEnvGerarOS();
    var os = Object.values(fakeStoreOSMerged())[0];
    assertEq(os.status, 'iniciada', 'pago 100% já nasce iniciada, sem etapa extra de "receber saldo"');
    assertEq(os.restante, 0);
    assertApprox(os.totalGeral, 500);
  });

  await test('4. Gerar OS é bloqueado sem Confirmar Pagamento antes (P0.3/P0.4 — ações separadas)', async function () {
    resetModalDom(); resetFakeStore();
    var orc = makeOrc('ORC-SMOKE-3', '000903', 300);
    seedFirestore([orc]);
    mod.setEnviados([orc]);
    global.window._orcSessaoAtualId = 'ORC-SMOKE-3';
    // Sem chamar orcRegistrarSituacaoFinanceira antes — Gerar OS não pode
    // criar a OS nem registrar nenhum pagamento por conta própria.
    var resultado = await mod.orcEnvGerarOS();
    assertEq(resultado, undefined, 'orcEnvGerarOS() retorna sem prosseguir quando o.pgtoConfirmado não existe');
    var osList = Object.values(fakeStoreOSMerged());
    assertEq(osList.length, 0, 'nenhuma OS é criada sem confirmação de pagamento prévia');
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
