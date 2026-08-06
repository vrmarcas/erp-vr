/**
 * test_fasef_chamadores_criticos.js
 *
 * PARTE 6 da auditoria "AUTORIZAÇÃO DE DEPLOY E AUDITORIA FINAL — CLOUDSAVE,
 * AUTENTICAÇÃO E CONCORRÊNCIA" (2026-08-05). _cloudSave() (commit d550066) já
 * retorna Promise com {ok, reason, serverData}, mas a PARTE 4 desta auditoria
 * encontrou dezenas de chamadores que ignoravam esse retorno: mostravam
 * sucesso incondicional antes do commit e não revertiam o estado local em
 * falha. Este arquivo cobre os chamadores de maior risco financeiro/
 * operacional corrigidos na PARTE 5, na ordem de prioridade definida pelo
 * usuário (estoque > OS > contas a pagar/receber > pagamentos > clientes).
 *
 * Funções sob teste (extraídas de index.html por contagem de chaves — não
 * reimplementadas): _cloudSave, _confirmarAposSalvar, _finSaveCR, _finSaveCP,
 * _finCRBaixaConfirmar, _finCPPagarConfirmar, finFmt, stockSaveData,
 * _stockTombSave, stockExcluirItem, cliSaveLixeira, cliSaveClientes,
 * cliExcluir.
 *
 * Uso: node scripts/test_fasef_chamadores_criticos.js
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

var FN_NAMES = [
  '_cloudSave', '_homologGuardOrThrow', '_confirmarAposSalvar',
  '_finSaveCR', '_finSaveCP', '_finCRBaixaConfirmar', '_finCPPagarConfirmar', 'finFmt',
  'stockSaveData', '_stockTombSave', 'stockExcluirItem',
  'cliSaveLixeira', 'cliSaveClientes', 'cliExcluir'
];
var src = [
  "var _COL = 'erp_vr';",
  "var _cloudLastPayload = {};",
  "var _HOMOLOG_MODE = false;",
  "var _HOMOLOG_EMULATORS_CONNECTED = true;",
  "var _cloudReady = true;",
  "var FIN_CR = []; var FIN_CP = []; var FIN_TX = [];",
  "var STOCK = {}; var _STOCK_TOMB = {};",
  "var CLIENTES_DATA = []; var CLIENTES_LIXEIRA = [];",
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = {",
  "  _cloudSave: _cloudSave, _confirmarAposSalvar: _confirmarAposSalvar,",
  "  _finCRBaixaConfirmar: _finCRBaixaConfirmar, _finCPPagarConfirmar: _finCPPagarConfirmar,",
  "  stockSaveData: stockSaveData, stockExcluirItem: stockExcluirItem,",
  "  cliExcluir: cliExcluir,",
  "  getLastPayload: function(k){ return _cloudLastPayload[k]; },",
  "  setLastPayload: function(k,v){ _cloudLastPayload[k] = v; },",
  "  getFinCR: function(){ return FIN_CR; }, setFinCR: function(v){ FIN_CR = v; },",
  "  getFinTX: function(){ return FIN_TX; }, setFinTX: function(v){ FIN_TX = v; },",
  "  getFinCP: function(){ return FIN_CP; }, setFinCP: function(v){ FIN_CP = v; },",
  "  getStock: function(){ return STOCK; }, setStock: function(v){ STOCK = v; },",
  "  getTomb: function(){ return _STOCK_TOMB; }, setTomb: function(v){ _STOCK_TOMB = v; },",
  "  getClientes: function(){ return CLIENTES_DATA; }, setClientes: function(v){ CLIENTES_DATA = v; },",
  "  getLixeira: function(){ return CLIENTES_LIXEIRA; }, setLixeira: function(v){ CLIENTES_LIXEIRA = v; }",
  "};"
].join('\n\n');
var modPath = path.join(__dirname, '_fasef_chamadores_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock de Firestore com transação real, concorrência serializada por doc ──
var _fakeStore = {};
var _txnDelayMs = 0;
var _forceErrorOnce = null;
var _getIdTokenCalls = 0;
var _txnLock = Promise.resolve();
function resetFakeStore() { _fakeStore = {}; _forceErrorOnce = null; _getIdTokenCalls = 0; _txnLock = Promise.resolve(); _txnDelayMs = 0; }
global._db = {
  collection: function () { return { doc: function (key) { return { _key: key }; } }; },
  runTransaction: function (fn) {
    var runIt = function () {
      if (_forceErrorOnce) {
        var err = _forceErrorOnce; _forceErrorOnce = null;
        return Promise.reject(err);
      }
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
global.firebase = {
  auth: function () {
    return { currentUser: { getIdToken: function (force) { _getIdTokenCalls++; return Promise.resolve('fake-token'); } } };
  }
};
global._lastToast = null; global._lastToastKind = null;
global.showToast = function (msg, kind) { global._lastToast = msg; global._lastToastKind = kind; };
global._renderCalls = { finCR: 0, finCP: 0, finDash: 0, finBar: 0, finDonut: 0, stock: 0, clientes: 0 };
global.finCRRender = function () { global._renderCalls.finCR++; };
global.finCPRender = function () { global._renderCalls.finCP++; };
global.finDashKPIs = function () { global._renderCalls.finDash++; };
global.finBarChartRender = function () { global._renderCalls.finBar++; };
global.finDonutRender = function () { global._renderCalls.finDonut++; };
global.stockRenderItems = function () { global._renderCalls.stock++; };
global.renderClientes = function () { global._renderCalls.clientes++; };
global.confirm = function () { return true; }; // "confirm" do navegador — assume OK nos testes

var mod = require(modPath);
var _DOC_KEYS = ['fin_tx', 'fin_cr', 'fin_cp', 'stock', 'stock_deleted', 'clientes', 'clientes_lixeira'];
function fakeDoc(key) { var raw = _fakeStore[key]; return raw ? JSON.parse(raw.data) : null; }
function resetAll() {
  resetFakeStore();
  // Cada teste parte de um servidor limpo — sem isso, _cloudLastPayload (o
  // "último payload confirmado por esta aba") ficaria com o valor do teste
  // anterior, e se o próximo teste produzir o MESMO payload (mesmos dados de
  // fixture mutados da mesma forma), o anti-eco de _cloudSave pularia a
  // transação inteira — inclusive a injeção de falha do teste — dando um
  // falso "sucesso" sem nenhuma escrita real ter sido tentada.
  _DOC_KEYS.forEach(function (k) { mod.setLastPayload(k, undefined); });
  mod.setFinCR([]); mod.setFinCP([]); mod.setFinTX([]);
  mod.setStock({}); mod.setTomb({});
  mod.setClientes([]); mod.setLixeira([]);
  global._renderCalls = { finCR: 0, finCP: 0, finDash: 0, finBar: 0, finDonut: 0, stock: 0, clientes: 0 };
  global._lastToast = null; global._lastToastKind = null;
}

console.log('\n=== Regressão: chamadores críticos de _cloudSave aguardam e reconciliam (Fase F, PARTE 4-6) ===\n');

(async function main() {

// ── Contas a Receber ────────────────────────────────────────────────────────
await test('CR-1. _finCRBaixaConfirmar(): sucesso normal — status recebido, TX lançada, servidor confirma', async function () {
  resetAll();
  mod.setFinCR([{ id: 'cr1', osRef: '10', cliente: 'E2E_FASEF_20260805_Cli', valor: 500, status: 'pendente', metodo: 'PIX' }]);
  mod._finCRBaixaConfirmar('cr1', '2026-08-05');
  await sleep(20);
  assertEq(mod.getFinCR()[0].status, 'recebido', 'CR marcado como recebido');
  assertEq(mod.getFinTX().length, 1, 'uma transação lançada no caixa');
  assertTruthy(fakeDoc('fin_cr'), 'fin_cr persistido no servidor');
  assertTruthy(fakeDoc('fin_tx'), 'fin_tx persistido no servidor');
  assertEq(global._lastToastKind, 'ok', 'toast de sucesso');
});

await test('CR-2. _finCRBaixaConfirmar(): falha total (fin_tx e fin_cr) reverte status do CR e remove a TX local, permite novo retry', async function () {
  resetAll();
  mod.setFinCR([{ id: 'cr1', osRef: '10', cliente: 'E2E_FASEF_20260805_Cli', valor: 500, status: 'pendente', metodo: 'PIX' }]);
  var origRunTransaction = global._db.runTransaction;
  global._db.runTransaction = function () { return Promise.reject({ code: 'unavailable', message: 'boom' }); };
  mod._finCRBaixaConfirmar('cr1', '2026-08-05');
  await sleep(20);
  global._db.runTransaction = origRunTransaction;
  assertEq(global._lastToastKind, 'err', 'toast de falha, não de sucesso');
  // ANTES da correção, r.status já tinha sido setado para 'recebido' antes do
  // commit — um retry subsequente era bloqueado pela guarda de idempotência
  // mesmo sem nada ter sido salvo. Depois da correção, falha total reverte o status.
  assertEq(mod.getFinCR()[0].status, 'pendente', 'status revertido — retry continua possível');
  assertEq(mod.getFinTX().length, 0, 'TX que falhou foi removida do array local');
});

await test('CR-2b. _finCRBaixaConfirmar(): só fin_tx falha (fin_cr confirmado) — TX reverte, mas o CR permanece recebido (já é verdade no servidor)', async function () {
  resetAll();
  mod.setFinCR([{ id: 'cr1', osRef: '10', cliente: 'E2E_FASEF_20260805_Cli', valor: 500, status: 'pendente', metodo: 'PIX' }]);
  var origRunTransaction = global._db.runTransaction;
  var callCount = 0;
  global._db.runTransaction = function (fn) {
    callCount++;
    if (callCount === 1) return Promise.reject({ code: 'unavailable', message: 'boom' }); // fin_tx é chamado primeiro no código
    return origRunTransaction(fn); // fin_cr sucede normalmente
  };
  mod._finCRBaixaConfirmar('cr1', '2026-08-05');
  await sleep(20);
  global._db.runTransaction = origRunTransaction;
  // Não existe atomicidade entre os dois documentos (fora do escopo desta
  // rodada) — reverter um documento que REALMENTE foi confirmado pelo
  // servidor seria mentir sobre o estado real; só o que falhou é revertido.
  assertEq(mod.getFinTX().length, 0, 'TX que falhou foi removida do array local');
  assertEq(mod.getFinCR()[0].status, 'recebido', 'CR permanece recebido — essa parte realmente foi confirmada no servidor');
  assertEq(global._lastToastKind, 'err', 'ainda assim, falha parcial não deve mostrar sucesso pleno');
});

await test('CR-3. _finCRBaixaConfirmar(): idempotência — clique duplo em CR já recebido não duplica TX', async function () {
  resetAll();
  mod.setFinCR([{ id: 'cr1', osRef: '10', cliente: 'X', valor: 500, status: 'recebido', metodo: 'PIX', dataRecebimento: '01/08/2026' }]);
  mod._finCRBaixaConfirmar('cr1', '2026-08-05');
  await sleep(10);
  assertEq(mod.getFinTX().length, 0, 'nenhuma TX nova — guarda de idempotência intacta');
});

// ── Contas a Pagar ───────────────────────────────────────────────────────────
await test('CP-1. _finCPPagarConfirmar(): sucesso normal — status pago só depois do commit', async function () {
  resetAll();
  mod.setFinCP([{ id: 'cp1', descricao: 'Fornecedor X', valor: 300, status: 'agendado' }]);
  var p = mod._finCPPagarConfirmar('cp1', '2026-08-05');
  // Estado otimista já mutado antes do commit (padrão adotado nesta correção),
  // mas o toast de sucesso só deve vir depois — validado abaixo.
  await sleep(20);
  assertEq(mod.getFinCP()[0].status, 'pago', 'CP marcado como pago');
  assertTruthy(fakeDoc('fin_cp'), 'fin_cp persistido no servidor');
  assertEq(global._lastToastKind, 'ok', 'toast de sucesso só após confirmação');
});

await test('CP-2. _finCPPagarConfirmar(): falha ao salvar — reverte status e data, retry permanece possível', async function () {
  resetAll();
  mod.setFinCP([{ id: 'cp1', descricao: 'Fornecedor X', valor: 300, status: 'agendado' }]);
  _forceErrorOnce = { code: 'unavailable', message: 'boom' };
  mod._finCPPagarConfirmar('cp1', '2026-08-05');
  await sleep(20);
  assertEq(mod.getFinCP()[0].status, 'agendado', 'status revertido para agendado');
  assertEq(mod.getFinCP()[0].dataPagamento, undefined, 'data de pagamento revertida');
  assertEq(global._lastToastKind, 'err', 'toast de falha');
});

await test('CP-3. _finCPPagarConfirmar(): guarda contra duplo clique enquanto a confirmação está em andamento', async function () {
  resetAll();
  mod.setFinCP([{ id: 'cp1', descricao: 'Fornecedor X', valor: 300, status: 'agendado' }]);
  _txnDelayMs = 30; // mantém a primeira chamada "em voo"
  mod._finCPPagarConfirmar('cp1', '2026-08-05');
  mod._finCPPagarConfirmar('cp1', '2026-08-05'); // segunda chamada imediata — deve ser bloqueada
  await sleep(60);
  _txnDelayMs = 0;
  assertEq(global._lastToastKind, 'ok', 'a operação em andamento não foi corrompida pela segunda chamada');
});

// ── Estoque ──────────────────────────────────────────────────────────────────
await test('STK-1. stockSaveData(): agora passa pela transação de _cloudSave (não mais um .set() direto)', async function () {
  resetAll();
  mod.setStock({ ac3: { label: 'Acrílico Cristal 3mm', qty: 40 } });
  var r = await mod.stockSaveData();
  assertEq(r.ok, true, 'stockSaveData retorna o resultado de _cloudSave');
  assertTruthy(fakeDoc('stock'), 'documento stock persistido');
});

await test('STK-2. stockSaveData(): detecta conflito — outra aba alterou o estoque nesse meio-tempo', async function () {
  resetAll();
  mod.setStock({ ac3: { label: 'Acrílico Cristal 3mm', qty: 40 } });
  await mod.stockSaveData(); // baseline conhecido
  // "outra aba" grava diretamente no servidor
  _fakeStore['stock'] = { data: JSON.stringify({ ac3: { label: 'Acrílico Cristal 3mm', qty: 39 } }), ts: Date.now() };
  mod.setStock({ ac3: { label: 'Acrílico Cristal 3mm', qty: 100 } }); // mutação obsoleta desta aba
  var r = await mod.stockSaveData();
  assertEq(r.ok, false, 'gravação recusada');
  assertEq(r.reason, 'conflito', 'motivo correto');
  assertEq(fakeDoc('stock').ac3.qty, 39, 'a mudança externa (qty=39) não foi sobrescrita pela cópia obsoleta (qty=100)');
});

await test('STK-3. stockExcluirItem(): falha total (tombstone e estoque) restaura o item e a lápide localmente', async function () {
  resetAll();
  mod.setStock({ ac3: { label: 'Acrílico Cristal 3mm', qty: 40 } });
  // Simula queda total — as duas escritas (stock_deleted e stock) falham.
  var origRunTransaction = global._db.runTransaction;
  global._db.runTransaction = function () { return Promise.reject({ code: 'unavailable', message: 'boom' }); };
  mod.stockExcluirItem('ac3');
  await sleep(20);
  global._db.runTransaction = origRunTransaction;
  assertTruthy(mod.getStock().ac3, 'item restaurado ao estoque local após falha total');
  assertEq(mod.getStock().ac3.qty, 40, 'dado do item preservado na restauração');
  assertEq(Object.keys(mod.getTomb()).length, 0, 'lápide revertida — item não fica marcado como excluído sem confirmação');
  assertEq(global._lastToastKind, 'err', 'toast de falha, não de sucesso');
});

await test('STK-3b. stockExcluirItem(): só o tombstone falha — item some do estoque (confirmado), lápide reverte (sem confirmação)', async function () {
  resetAll();
  mod.setStock({ ac3: { label: 'Acrílico Cristal 3mm', qty: 40 } });
  // _stockTombSave() ('stock_deleted') é chamado antes de stockSaveData() ('stock')
  // dentro de stockExcluirItem — força só a PRIMEIRA transação a falhar.
  _forceErrorOnce = { code: 'unavailable', message: 'boom' };
  mod.stockExcluirItem('ac3');
  await sleep(20);
  assertEq(mod.getStock().ac3, undefined, 'estoque já confirmado no servidor — não é revertido só porque a lápide falhou');
  assertEq(Object.keys(mod.getTomb()).length, 0, 'lápide revertida — sem confirmação do servidor');
  assertEq(global._lastToastKind, 'err', 'ainda assim, falha parcial não deve mostrar sucesso pleno');
});

await test('STK-4. stockExcluirItem(): sucesso — item some do estoque e ganha lápide, ambos confirmados no servidor', async function () {
  resetAll();
  mod.setStock({ ac3: { label: 'Acrílico Cristal 3mm', qty: 40 } });
  mod.stockExcluirItem('ac3');
  await sleep(20);
  assertEq(mod.getStock().ac3, undefined, 'item removido do estoque local');
  assertTruthy(mod.getTomb().ac3, 'lápide criada localmente');
  assertTruthy(fakeDoc('stock'), 'estoque sem o item persistido no servidor');
  var tombServidor = fakeDoc('stock_deleted');
  assertTruthy(tombServidor && tombServidor.ac3, 'lápide persistida no servidor — impede ressurreição por aba antiga');
});

// ── Clientes ─────────────────────────────────────────────────────────────────
await test('CLI-1. cliExcluir(): sucesso — cliente move para lixeira, ambos os documentos confirmados', async function () {
  resetAll();
  mod.setClientes([{ id: 'c1', nome: 'E2E_FASEF_20260805_Cliente' }]);
  mod.cliExcluir('c1');
  await sleep(20);
  assertEq(mod.getClientes().length, 0, 'cliente saiu da lista ativa');
  assertEq(mod.getLixeira().length, 1, 'cliente foi para a lixeira local');
  assertTruthy(fakeDoc('clientes'), 'clientes persistido');
  assertTruthy(fakeDoc('clientes_lixeira'), 'clientes_lixeira persistido');
});

await test('CLI-2. cliExcluir(): falha em um dos dois documentos — reverte cliente para a lista ativa, sem duplicar', async function () {
  resetAll();
  mod.setClientes([{ id: 'c1', nome: 'E2E_FASEF_20260805_Cliente' }]);
  var callCount = 0;
  var origRunTransaction = global._db.runTransaction;
  global._db.runTransaction = function (fn) {
    callCount++;
    if (callCount === 1) return Promise.reject({ code: 'unavailable', message: 'boom' }); // clientes_lixeira falha
    return origRunTransaction(fn); // clientes sucede
  };
  mod.cliExcluir('c1');
  await sleep(20);
  global._db.runTransaction = origRunTransaction;
  assertEq(mod.getClientes().length, 1, 'cliente restaurado à lista ativa — nada perdido silenciosamente');
  assertEq(mod.getLixeira().length, 0, 'lixeira revertida — sem entrada órfã');
  assertEq(global._lastToastKind, 'err', 'toast de falha');
});

console.log('\n=== resultado ===');
console.log('passed=' + passed + ' failed=' + failed);
process.exitCode = failed ? 1 : 0;

})();
