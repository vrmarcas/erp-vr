/**
 * test_hotfix_pagamentos_p0_8_17_registrar_saldo_2026-08-10.js
 *
 * HOTFIX PÓS-HOMOLOGAÇÃO — Pagamentos/Saldo/Entrega de OS, P0.8-P0.17.
 *
 * Bug real em produção: OS "pronta" (produção concluída) com saldo
 * pendente não tinha NENHUMA ação para registrar esse pagamento antes da
 * entrega — só existia "Entregar mesmo assim" (exceção) ou
 * kbReceberSaldo(), que só aparece em status='aguardando_saldo', só
 * aceita pagamento INTEGRAL e sempre reaproveita a forma da entrada
 * original.
 *
 * osRegistrarPagamentoSaldo() (função nova e independente — kbReceberSaldo()
 * permanece 100% intocada) cobre exatamente o cenário real do bug:
 *   TOTAL R$131,82 — ENTRADA R$100,00 (PIX) já recebida — SALDO R$31,82.
 *
 * Cenários T5/T6/T9/T10/T12/T13 do hotfix: pagamento integral em OS
 * "pronta" nunca reverte o status para "iniciada"; pagamento parcial
 * reduz o saldo sem quitar; duplo-clique é bloqueado pelo guard síncrono;
 * duas "abas" concorrentes nunca duplicam nem sobre-pagam (transação
 * relê o saldo real); entrada original nunca desaparece do histórico
 * (FIN_CR); entrega com saldo (excepcional) continua funcionando à parte
 * (osLiberar, não tocado por este hotfix).
 *
 * Uso: node scripts/test_hotfix_pagamentos_p0_8_17_registrar_saldo_2026-08-10.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + ((e && e.stack) || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }

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
  "var FIN_CR = []; var FIN_TX = [];",
  "var _ORC_ENVIADOS_DATA = [];",
  "var _kbOsId = null;",
  "var _kbStatusMap = { iniciada:{cls:'si',txt:'Iniciada'}, aguardando_saldo:{cls:'sas',txt:'Aguard. Saldo'}, pronta:{cls:'sp',txt:'Pronta'} };",
  extractFn('moneyToCents'), extractFn('centsToMoney'),
  extractFn('finCaixaISOtoBR'),
  extractFn('osRegistrarPagamentoSaldo'),
  "module.exports = {",
  "  osRegistrarPagamentoSaldo: osRegistrarPagamentoSaldo,",
  "  getLastPayload: function(k){ return _cloudLastPayload[k]; }, setLastPayload: function(k,v){ _cloudLastPayload[k]=v; },",
  "  getKbOs: function(){ return KB_OS; }, setKbOs: function(v){ KB_OS = v; },",
  "  setKbOsId: function(v){ _kbOsId = v; },",
  "  getFinCR: function(){ return FIN_CR; }, setFinCR: function(v){ FIN_CR = v; },",
  "  getFinTX: function(){ return FIN_TX; }, setFinTX: function(v){ FIN_TX = v; },",
  "  getOrc: function(){ return _ORC_ENVIADOS_DATA; }, setOrc: function(v){ _ORC_ENVIADOS_DATA = v; }",
  "};"
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_pgto_saldo_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock de Firestore com transação real, concorrência serializada por rodada
//    (mesmo padrão de test_kbrecebersaldo_atomicidade.js — nunca reinventado) ──
var _fakeStore = {};
var _forceErrorOnce = null;
var _txnLock = Promise.resolve();
function resetFakeStore() { _fakeStore = {}; _forceErrorOnce = null; _txnLock = Promise.resolve(); }
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
global.finFmt = function (v) { return 'R$ ' + (v || 0).toFixed(2); };

var mod = require(modPath);
function resetAll() {
  resetFakeStore();
  mod.setKbOs({}); mod.setFinCR([]); mod.setFinTX([]); mod.setOrc([]);
  global._lastToast = null; global._lastToastKind = null;
}
// Cenário real do bug (P0.10): TOTAL R$131,82 — entrada R$100 (PIX) já
// recebida — saldo R$31,82 pendente. status='pronta' (produção concluída).
function baseOsProntaComSaldo(over) {
  return Object.assign({ id: 'os1', num: 77, status: 'pronta', valor: 131.82, totalGeral: 131.82, restante: 31.82, formaPgto: 'PIX', cliente: 'Cliente E2E', mk: 'vr' }, over || {});
}
function seedFinDoc(os) { seedDoc('kb_os_fin', { os1: { valor: os.valor, totalGeral: os.totalGeral, restante: os.restante, formaPgto: os.formaPgto } }); }

console.log('\n=== HOTFIX PAGAMENTOS/SALDO/ENTREGA — P0.8-P0.17: osRegistrarPagamentoSaldo() ===\n');

(async function main() {

await test('1. cenário real do bug — OS PRONTA + saldo R$31,82 pago via PIX — status NUNCA reverte para iniciada', async function () {
  resetAll();
  var os = baseOsProntaComSaldo();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [
    { id: 'cr1', osRef: 'OS #77', status: 'recebido', valor: 100.00, metodo: 'PIX', dataRecebimento: '10/08/2026' },
    { id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 31.82, metodo: 'PIX' },
  ]);
  seedDoc('fin_tx', []);
  var ok = await mod.osRegistrarPagamentoSaldo('os1', 31.82, 'PIX', '', '');
  assertTruthy(ok, 'retorna sucesso');
  assertEq(readDoc('kb_os').os1.status, 'pronta', 'status PERMANECE pronta (nunca regride para iniciada)');
  assertEq(readDoc('kb_os_fin').os1.restante, 0, 'saldo zerado no servidor');
  assertEq(mod.getKbOs().os1.status, 'pronta', 'estado local também permanece pronta');
});

await test('2. entrada original (R$100 PIX) permanece intacta no histórico — nunca funde num pagamento só', async function () {
  resetAll();
  var os = baseOsProntaComSaldo();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [
    { id: 'cr1', osRef: 'OS #77', status: 'recebido', valor: 100.00, metodo: 'PIX', dataRecebimento: '10/08/2026' },
    { id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 31.82, metodo: 'PIX' },
  ]);
  seedDoc('fin_tx', []);
  await mod.osRegistrarPagamentoSaldo('os1', 31.82, 'PIX', '', '');
  var cr = readDoc('fin_cr');
  var entradaOriginal = cr.find(function (c) { return c.id === 'cr1'; });
  assertTruthy(entradaOriginal, 'entrada original ainda existe');
  assertEq(entradaOriginal.valor, 100.00, 'valor da entrada original preservado');
  assertEq(entradaOriginal.status, 'recebido', 'status da entrada original preservado');
  var recebidos = cr.filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 2, 'DOIS recebimentos no histórico (entrada + saldo), nunca um só');
  var somaTotal = recebidos.reduce(function (s, c) { return s + c.valor; }, 0);
  assertEq(Math.round(somaTotal * 100) / 100, 131.82, 'soma dos recebimentos bate exatamente o total');
});

await test('3. Caixa (fin_tx) registra exatamente o valor pago agora (R$31,82), nunca o total R$131,82', async function () {
  resetAll();
  var os = baseOsProntaComSaldo();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 31.82, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  await mod.osRegistrarPagamentoSaldo('os1', 31.82, 'Cartão de Débito', '', '');
  var tx = readDoc('fin_tx');
  assertEq(tx.length, 1, 'exatamente um lançamento de Caixa');
  assertEq(tx[0].valor, 31.82, 'valor do lançamento é o pago agora, não o total');
  assertEq(tx[0].metodo, 'Cartão de Débito', 'forma escolhida AGORA é a registrada, mesmo divergindo da entrada original (PIX)');
});

await test('4. pagamento PARCIAL (R$100 de um saldo R$300) — reduz sem quitar, status permanece pendente', async function () {
  resetAll();
  var os = baseOsProntaComSaldo({ valor: 400, totalGeral: 400, restante: 300 });
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 300, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  var ok = await mod.osRegistrarPagamentoSaldo('os1', 100, 'PIX', '', '');
  assertTruthy(ok, 'retorna sucesso');
  assertEq(readDoc('kb_os_fin').os1.restante, 200, 'novo saldo = 300 - 100 = 200 (nunca assume quitação automática)');
  var crEntry = readDoc('fin_cr').find(function (c) { return c.id === 'cr2'; });
  assertEq(crEntry.status, 'pendente', 'entrada "Restante" continua pendente (não foi 100% pago)');
  assertEq(crEntry.valor, 200, 'valor da entrada pendente reduzido para o novo saldo');
  var novoRecebido = readDoc('fin_cr').find(function (c) { return c.status === 'recebido'; });
  assertTruthy(novoRecebido, 'um novo recebimento de R$100 foi registrado');
  assertEq(novoRecebido.valor, 100, 'valor do recebimento parcial é exatamente o pago agora');
});

await test('5. segundo pagamento parcial completa a quitação (100 + 200 = 300) — soma bate exatamente', async function () {
  resetAll();
  var os = baseOsProntaComSaldo({ valor: 400, totalGeral: 400, restante: 300 });
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 300, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  await mod.osRegistrarPagamentoSaldo('os1', 100, 'PIX', '', '');
  mod.getKbOs().os1._pagandoSaldo = false; // simula UI liberada entre as duas chamadas
  await mod.osRegistrarPagamentoSaldo('os1', 200, 'Dinheiro', '', '');
  assertEq(readDoc('kb_os_fin').os1.restante, 0, 'saldo final zerado');
  var recebidos = readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 2, 'dois recebimentos parciais no histórico');
  var soma = recebidos.reduce(function (s, c) { return s + c.valor; }, 0);
  assertEq(Math.round(soma * 100) / 100, 300, 'soma dos dois pagamentos parciais bate exatamente o saldo original');
});

await test('6. duplo clique (guard síncrono) — 10 chamadas simultâneas geram só UM pagamento efetivo', async function () {
  resetAll();
  var os = baseOsProntaComSaldo();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 31.82, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  var chamadas = [];
  for (var i = 0; i < 10; i++) chamadas.push(mod.osRegistrarPagamentoSaldo('os1', 31.82, 'PIX', '', ''));
  await Promise.all(chamadas);
  assertEq(readDoc('kb_os_fin').os1.restante, 0, 'saldo zerado (não negativo)');
  var recebidos = readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 1, 'exatamente UM recebimento — guard síncrono bloqueou as outras 9 chamadas');
});

await test('7. duas abas — segunda relê o saldo real e é bloqueada por VALOR_MAIOR_QUE_SALDO (nunca sobre-paga)', async function () {
  resetAll();
  var os = baseOsProntaComSaldo();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 31.82, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  // Aba A quita o saldo inteiro.
  await mod.osRegistrarPagamentoSaldo('os1', 31.82, 'PIX', '', '');
  // Aba B (estado local desatualizado — ainda acha que o guard está livre e
  // que o saldo é R$31,82) tenta registrar o MESMO valor com base no que
  // tinha na tela antes de A confirmar.
  mod.getKbOs().os1._pagandoSaldo = false;
  var okB = await mod.osRegistrarPagamentoSaldo('os1', 31.82, 'PIX', '', '');
  assertTruthy(okB, 'aba B recebe resposta tratada (idempotente — SALDO_JA_QUITADO), não trava nem duplica');
  var recebidos = readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 1, 'ainda exatamente UM recebimento — aba B nunca duplicou o pagamento');
});

await test('8. tentar pagar MAIS que o saldo real (servidor) é rejeitado — nunca cria saldo negativo', async function () {
  resetAll();
  var os = baseOsProntaComSaldo();
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 31.82, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  var ok = await mod.osRegistrarPagamentoSaldo('os1', 50.00, 'PIX', '', '');
  assertEq(ok, false, 'operação rejeitada');
  assertEq(readDoc('kb_os_fin').os1.restante, 31.82, 'saldo no servidor não foi alterado');
  assertEq(global._lastToastKind, 'err', 'toast de erro explicando o valor real');
});

await test('9. caminho legado aguardando_saldo + quitação integral — status VAI para iniciada (compat com kbReceberSaldo)', async function () {
  resetAll();
  var os = baseOsProntaComSaldo({ status: 'aguardando_saldo', restante: 500, valor: 1000, totalGeral: 1000 });
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 500, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  await mod.osRegistrarPagamentoSaldo('os1', 500, 'PIX', '', '');
  assertEq(readDoc('kb_os').os1.status, 'iniciada', 'compatibilidade preservada — igual kbReceberSaldo sempre fez');
});

await test('10. orçamento vinculado em aguardando_pagamento vira pago quando o saldo quita totalmente', async function () {
  resetAll();
  var os = baseOsProntaComSaldo({ orcRef: 'ORC-1' });
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 31.82, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  seedDoc('orcamentos', [{ id: 'ORC-1', status: 'aguardando_pagamento' }]);
  await mod.osRegistrarPagamentoSaldo('os1', 31.82, 'PIX', '', '');
  assertEq(readDoc('orcamentos')[0].status, 'pago', 'orçamento avança para pago só quando REALMENTE quitado');
});

await test('11. orçamento NÃO muda de status em pagamento parcial (ainda não quitado)', async function () {
  resetAll();
  var os = baseOsProntaComSaldo({ orcRef: 'ORC-1', valor: 400, totalGeral: 400, restante: 300 });
  mod.getKbOs().os1 = os; mod.setKbOsId('os1');
  seedDoc('kb_os', { os1: os }); seedFinDoc(os);
  seedDoc('fin_cr', [{ id: 'cr2', osRef: 'OS #77', status: 'pendente', valor: 300, metodo: 'PIX' }]);
  seedDoc('fin_tx', []);
  seedDoc('orcamentos', [{ id: 'ORC-1', status: 'aguardando_pagamento' }]);
  await mod.osRegistrarPagamentoSaldo('os1', 100, 'PIX', '', '');
  assertEq(readDoc('orcamentos')[0].status, 'aguardando_pagamento', 'orçamento continua aguardando — só quitação integral muda o status');
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
})();
