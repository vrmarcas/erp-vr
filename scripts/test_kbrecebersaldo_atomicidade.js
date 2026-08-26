/**
 * test_kbrecebersaldo_atomicidade.js
 *
 * Item 3 da auditoria PARTE 1-11 (2026-08-05): kbReceberSaldo() gravava em 4
 * documentos agregados (kb_os, fin_cr, fin_tx, orcamentos) via 4 chamadas
 * independentes a _cloudSave(). Aguardar as 4 Promises não garante
 * integridade — uma pode confirmar e outra falhar, e reverter só o estado
 * LOCAL não desfaz um documento que o servidor já aceitou.
 *
 * Corrigido reescrevendo a função para ler e gravar os 4 documentos dentro de
 * UMA ÚNICA transação do Firestore (runTransaction aceita múltiplos
 * documentos — não é limitado a um), mutando sempre o dado LIDO DENTRO da
 * transação (nunca a cópia local, que pode estar obsoleta). Isso também
 * resolve retry/duas-abas: se o saldo já estiver zerado quando a transação
 * relê o servidor, a operação é tratada como já concluída (idempotente).
 *
 * Cenários exigidos (item 3 da auditoria):
 *   A. kb_os confirma, fin_cr falha            -> impossível: é uma transação só
 *   B. fin_cr confirma, fin_tx falha            -> impossível: é uma transação só
 *   C. fin_tx confirma, orcamentos falha        -> impossível: é uma transação só
 *   D. resposta de um documento se perde, retry é executado
 *   E. duas abas tentam quitar o mesmo saldo
 *
 * Função sob teste (extraída de index.html por contagem de chaves — não
 * reimplementada): kbReceberSaldo.
 *
 * Uso: node scripts/test_kbrecebersaldo_atomicidade.js
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
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
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

var src = [
  "var _COL = 'erp_vr';",
  "var _cloudLastPayload = {};",
  "var KB_OS = {};",
  "var _KB_OS_FIN_CACHE = {};",
  "var _KB_OS_FIN_FIELDS = ['valor','totalGeral','parcelas','formaPgto','pagtoTipo','valorEntrada','restante'];",
  "function _kbMergeFinCache(){ Object.keys(_KB_OS_FIN_CACHE).forEach(function(id){ var os=KB_OS[id]; if(!os) return; var fin=_KB_OS_FIN_CACHE[id]; if(!fin) return; _KB_OS_FIN_FIELDS.forEach(function(f){ if(fin[f]!==undefined) os[f]=fin[f]; }); }); }",
  "var FIN_CR = []; var FIN_TX = [];",
  "var _ORC_ENVIADOS_DATA = [];",
  "var _kbOsId = null;",
  "var _kbStatusMap = { iniciada:{cls:'si',txt:'Iniciada'}, aguardando_saldo:{cls:'sas',txt:'Aguard. Saldo'} };",
  extractFn('kbReceberSaldo'),
  "module.exports = {",
  "  kbReceberSaldo: kbReceberSaldo,",
  "  getLastPayload: function(k){ return _cloudLastPayload[k]; }, setLastPayload: function(k,v){ _cloudLastPayload[k]=v; },",
  "  getKbOs: function(){ return KB_OS; }, setKbOs: function(v){ KB_OS = v; },",
  "  getKbOsFinCache: function(){ return _KB_OS_FIN_CACHE; }, setKbOsFinCache: function(v){ _KB_OS_FIN_CACHE = v; },",
  "  setKbOsId: function(v){ _kbOsId = v; },",
  "  getFinCR: function(){ return FIN_CR; }, setFinCR: function(v){ FIN_CR = v; },",
  "  getFinTX: function(){ return FIN_TX; }, setFinTX: function(v){ FIN_TX = v; },",
  "  getOrc: function(){ return _ORC_ENVIADOS_DATA; }, setOrc: function(v){ _ORC_ENVIADOS_DATA = v; }",
  "};"
].join('\n\n');
var modPath = path.join(__dirname, '_kbrecebersaldo_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock de Firestore com transação real, concorrência serializada por rodada ──
var _fakeStore = {};
var _forceErrorOnce = null;
var _getIdTokenCalls = 0;
var _txnLock = Promise.resolve();
function resetFakeStore() { _fakeStore = {}; _forceErrorOnce = null; _getIdTokenCalls = 0; _txnLock = Promise.resolve(); }
function seedDoc(key, value) { _fakeStore[key] = { data: JSON.stringify(value), ts: Date.now() }; }
function readDoc(key) { var raw = _fakeStore[key]; return raw ? JSON.parse(raw.data) : null; }

global._db = {
  collection: function () { return { doc: function (key) { return { _key: key }; } }; },
  runTransaction: function (fn) {
    var runIt = function () {
      if (_forceErrorOnce) { var err = _forceErrorOnce; _forceErrorOnce = null; return Promise.reject(err); }
      var pendingWrites = {};
      var txn = {
        get: function (ref) {
          var existing = _fakeStore[ref._key];
          var snap = { exists: !!existing, data: function () { return existing; } };
          return Promise.resolve(snap);
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
// HARDENING DE CONFIDENCIALIDADE FINANCEIRA (2026-08-26) — kbReceberSaldo()
// não faz mais a transação de 4 documentos no client (migrada para a Cloud
// Function finCrReceberSaldo(), Admin SDK — ver functions/src/finCr.ts, já
// coberta contra o Firestore Emulator real por
// test_hardening_fin_cr_functions_server_2026-08-26.js). O mock abaixo
// porta a MESMA lógica (kb_os + kb_os_fin + fin_cr + fin_tx + orcamentos,
// idêntica à Function real) para dentro do mock _db.runTransaction já
// existente aqui — preserva os 5 cenários originais (sucesso, orçamento
// vinculado, falha não deixa nada alterado, retry sem duplicar, duas
// abas), incluindo _forceErrorOnce, só através do novo formato de chamada.
global.firebase = {
  auth: function () { return { currentUser: { getIdToken: function () { _getIdTokenCalls++; return Promise.resolve('fake-token'); } } }; },
  functions: function () {
    return {
      httpsCallable: function (nome) {
        return function (payload) {
          if (nome !== 'finCrReceberSaldo') return Promise.resolve({ data: { ok: true } });
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
              if (!osServidor) { var eNF = new Error('OS_NAO_ENCONTRADA'); eNF.code = 'not-found'; throw eNF; }
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
        };
      }
    };
  }
};
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

var mod = require(modPath);
function resetAll() {
  resetFakeStore();
  mod.setKbOs({}); mod.setFinCR([]); mod.setFinTX([]); mod.setOrc([]);
  mod.setLastPayload('kb_os', undefined); mod.setLastPayload('fin_cr', undefined);
  mod.setLastPayload('fin_tx', undefined); mod.setLastPayload('orcamentos', undefined);
  global._lastToast = null; global._lastToastKind = null;
}
function baseOs(over) { return Object.assign({ id: 'os1', num: 42, status: 'aguardando_saldo', restante: 500, cliente: 'E2E_FASEF_20260805_Cli', mk: 'vr', formaPgto: 'PIX' }, over || {}); }
// Rodada 2, P0.6 (2026-08-07) — kbReceberSaldo() passou a ler/gravar
// restante/formaPgto em kb_os_fin (documento separado, fora do alcance de
// leitura da Produção), não mais em kb_os. Este teste (escrito antes da
// mudança) precisa semear os dois documentos juntos, como o Firestore
// real teria depois da migração — nunca reimplementa a lógica, só ajusta
// o fixture ao novo formato de dados.
function seedKbOsFin(id, os) { seedDoc('kb_os_fin', { os1: { restante: os.restante, formaPgto: os.formaPgto } }); }

console.log('\n=== Regressão: kbReceberSaldo() atômico em 4 documentos (item 3 da auditoria) ===\n');

(async function main() {

await test('1. sucesso normal — kb_os, fin_cr e fin_tx confirmados juntos (sem orçamento vinculado)', async function () {
  resetAll();
  var os = baseOs();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  mod.setKbOsFinCache({ os1: { restante: os.restante, formaPgto: os.formaPgto } });
  seedDoc('kb_os', { os1: os }); seedKbOsFin('os1', os);
  seedDoc('fin_cr', [{ id: 'cr1', osRef: '42', status: 'pendente', valor: 500 }]);
  seedDoc('fin_tx', []);
  await mod.kbReceberSaldo();
  assertEq(readDoc('kb_os').os1.status, 'iniciada', 'OS avança para iniciada no servidor');
  assertEq(readDoc('kb_os_fin').os1.restante, 0, 'restante zerado no servidor (kb_os_fin)');
  assertEq(readDoc('fin_cr')[0].status, 'recebido', 'CR confirmado no servidor');
  assertEq(readDoc('fin_tx').length, 1, 'exatamente um lançamento de caixa');
  assertEq(mod.getKbOs().os1.status, 'iniciada', 'estado local reconciliado com o servidor');
  assertEq(global._lastToastKind, 'ok', 'toast de sucesso só após commit');
});

await test('2. sucesso normal — com orçamento vinculado em aguardando_pagamento, os 4 documentos confirmam juntos', async function () {
  resetAll();
  var os = baseOs({ orcRef: 'ORC-1' });
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  mod.setKbOsFinCache({ os1: { restante: os.restante, formaPgto: os.formaPgto } });
  seedDoc('kb_os', { os1: os }); seedKbOsFin('os1', os);
  seedDoc('fin_cr', [{ id: 'cr1', osRef: '42', status: 'pendente', valor: 500 }]);
  seedDoc('fin_tx', []);
  seedDoc('orcamentos', [{ id: 'ORC-1', status: 'aguardando_pagamento' }]);
  mod.setOrc([{ id: 'ORC-1', status: 'aguardando_pagamento' }]);
  await mod.kbReceberSaldo();
  assertEq(readDoc('orcamentos')[0].status, 'pago', 'orçamento avança para pago no servidor');
  assertEq(readDoc('kb_os').os1.status, 'iniciada', 'OS avança junto, na mesma transação');
  assertEq(mod.getOrc()[0].status, 'pago', 'estado local do orçamento reconciliado');
});

// ── Cenários A/B/C: nunca existe "um confirma, outro falha" — é uma única transação ──
await test('A/B/C. falha em QUALQUER ponto da transação (ex: fin_cr) não deixa nenhum dos 4 documentos alterado', async function () {
  resetAll();
  var os = baseOs();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  mod.setKbOsFinCache({ os1: { restante: os.restante, formaPgto: os.formaPgto } });
  seedDoc('kb_os', { os1: os }); seedKbOsFin('os1', os);
  seedDoc('fin_cr', [{ id: 'cr1', osRef: '42', status: 'pendente', valor: 500 }]);
  seedDoc('fin_tx', []);
  _forceErrorOnce = { code: 'unavailable', message: 'boom' }; // a transação inteira falha
  await mod.kbReceberSaldo();
  assertEq(readDoc('kb_os').os1.status, 'aguardando_saldo', 'kb_os NÃO foi alterado — não existe "só um documento comitou"');
  assertEq(readDoc('fin_cr')[0].status, 'pendente', 'fin_cr NÃO foi alterado');
  assertEq(readDoc('fin_tx').length, 0, 'nenhum lançamento fantasma em fin_tx');
  assertEq(mod.getKbOs().os1.status, 'aguardando_saldo', 'estado local nunca foi otimisticamente alterado');
  assertEq(global._lastToastKind, 'err', 'toast de falha, nunca de sucesso parcial');
});

// ── Cenário D: resposta perdida (transação falha) + retry ──
await test('D. resposta perdida (transação falha) — retry subsequente completa normalmente, sem duplicar fin_tx', async function () {
  resetAll();
  var os = baseOs();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  mod.setKbOsFinCache({ os1: { restante: os.restante, formaPgto: os.formaPgto } });
  seedDoc('kb_os', { os1: os }); seedKbOsFin('os1', os);
  seedDoc('fin_cr', [{ id: 'cr1', osRef: '42', status: 'pendente', valor: 500 }]);
  seedDoc('fin_tx', []);
  _forceErrorOnce = { code: 'unavailable', message: 'resposta perdida' };
  await mod.kbReceberSaldo(); // primeira tentativa falha
  assertEq(global._lastToastKind, 'err', 'primeira tentativa reporta falha');
  mod.getKbOs().os1._recebendoSaldo = false; // usuário clica de novo (guarda já foi liberada pelo tratamento de erro)
  await mod.kbReceberSaldo(); // retry
  assertEq(readDoc('kb_os').os1.status, 'iniciada', 'retry completa a operação');
  assertEq(readDoc('fin_tx').length, 1, 'exatamente UM lançamento — retry não duplicou');
  assertEq(global._lastToastKind, 'ok', 'retry reporta sucesso');
});

// ── Cenário E: duas abas tentam quitar o mesmo saldo ──
// O mock de _db.runTransaction serializa transações concorrentes (como o
// Firestore real faz por documento — a segunda só roda depois que a primeira
// commita). O que este teste prova é a propriedade que importa: a SEGUNDA
// sessão nunca parte da cópia local (potencialmente obsoleta) — ela relê o
// servidor DENTRO da própria transação e encontra restante=0 já confirmado
// pela primeira, então nunca duplica o lançamento em fin_tx.
await test('E. duas abas tentando quitar o mesmo saldo — só a primeira lança em fin_tx, a segunda reconcilia como já feito', async function () {
  resetAll();
  var osA = baseOs(); // "aba A"
  mod.getKbOs().os1 = osA; mod.setKbOsId('os1');
  mod.setKbOsFinCache({ os1: { restante: osA.restante, formaPgto: osA.formaPgto } });
  seedDoc('kb_os', { os1: osA }); seedKbOsFin('os1', osA);
  seedDoc('fin_cr', [{ id: 'cr1', osRef: '42', status: 'pendente', valor: 500 }]);
  seedDoc('fin_tx', []);

  await mod.kbReceberSaldo(); // "aba A" confirma o recebimento
  assertEq(global._lastToastKind, 'ok', 'aba A recebe confirmação de sucesso');

  // "aba B" é uma sessão à parte, com seu PRÓPRIO objeto local da mesma OS —
  // criado ANTES de A commitar, então ainda mostra restante=500 localmente.
  var osB = baseOs();
  mod.setKbOs({ os1: osB });
  mod.setKbOsFinCache({ os1: { restante: osB.restante, formaPgto: osB.formaPgto } });
  mod.setKbOsId('os1');
  await mod.kbReceberSaldo(); // "aba B" tenta quitar o mesmo saldo, sem saber que A já confirmou
  assertEq(global._lastToastKind, 'info', 'aba B recebe aviso de que já foi recebido — não um erro nem um falso sucesso');
  assertEq(mod.getKbOs().os1.restante, 0, 'aba B reconcilia seu estado local para refletir o que o servidor já tinha');

  assertEq(readDoc('fin_tx').length, 1, 'apenas UM lançamento em fin_tx — nenhuma duplicação de recebimento');
  assertEq(readDoc('kb_os').os1.status, 'iniciada', 'OS confirmada como iniciada no servidor');
  assertEq(readDoc('kb_os_fin').os1.restante, 0, 'saldo zerado, sem sobrescrita destrutiva (kb_os_fin)');
});

console.log('\n=== resultado ===');
console.log('passed=' + passed + ' failed=' + failed);
process.exitCode = failed ? 1 : 0;

})();
