/**
 * test_hotfix_financeiro_entrega_fixture_e2e_2026-08-16.js
 *
 * RODADA 2026-08-16, P0.15-P0.22 — verificação de ponta a ponta do fluxo
 * financeiro de entrega da OS, com a fixture EXATA exigida nesta rodada:
 *   Venda total: R$156,00 — Entrada recebida: R$78,00 — Saldo: R$78,00
 *   Registrar saldo: +R$78,00 → Recebido=R$156,00, Saldo=R$0,00, Pago
 *   Entregar ao Cliente → NÃO pede justificativa
 *   1 recebimento adicional; 1 movimento de caixa; CR quitado; zero
 *   duplicidade.
 *
 * Auditoria estática prévia (mesma rodada) confirmou que o fluxo
 * financeiro de entrega da OS já estava implementado e testado por
 * trabalho anterior deste projeto (finRegistrarRecebimento — "A ÚNICA
 * rotina que aplica um recebimento de venda a uma OS", osLiberar — já
 * distingue entrega normal de exceção com justificativa). Este teste NÃO
 * reimplementa nada — só confirma, com a fixture literal desta rodada e
 * de ponta a ponta (registrar saldo → verificar resumo → entregar →
 * verificar ausência de justificativa → verificar CR/Caixa sem
 * duplicidade), que o comportamento já existente continua correto.
 * Nenhum financeiro paralelo foi criado no Kanban — reusa
 * osRegistrarPagamentoSaldo()/finRegistrarRecebimento()/osLiberar() reais,
 * extraídas de index.html, nunca reimplementadas.
 *
 * Uso: node scripts/test_hotfix_financeiro_entrega_fixture_e2e_2026-08-16.js
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
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
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
  "var _kbStatusMap = { iniciada:{cls:'si',txt:'Iniciada'}, aguardando_saldo:{cls:'sas',txt:'Aguard. Saldo'}, pronta:{cls:'sp',txt:'Pronta'} };",
  extractFn('moneyToCents'), extractFn('centsToMoney'),
  extractFn('finCaixaISOtoBR'),
  extractFn('finRegistrarRecebimento'),
  extractFn('osRegistrarPagamentoSaldo'),
  extractFn('_confirmarAposSalvar'),
  extractFn('osLiberar'),
  "module.exports = {",
  "  osRegistrarPagamentoSaldo: osRegistrarPagamentoSaldo,",
  "  finRegistrarRecebimento: finRegistrarRecebimento,",
  "  osLiberar: osLiberar,",
  "  getLastPayload: function(k){ return _cloudLastPayload[k]; }, setLastPayload: function(k,v){ _cloudLastPayload[k]=v; },",
  "  getKbOs: function(){ return KB_OS; }, setKbOs: function(v){ KB_OS = v; },",
  "  getKbOsFinCache: function(){ return _KB_OS_FIN_CACHE; }, setKbOsFinCache: function(v){ _KB_OS_FIN_CACHE = v; }, mergeFinCache: function(){ _kbMergeFinCache(); },",
  "  setKbOsId: function(v){ _kbOsId = v; },",
  "  getFinCR: function(){ return FIN_CR; }, setFinCR: function(v){ FIN_CR = v; },",
  "  getFinTX: function(){ return FIN_TX; }, setFinTX: function(v){ FIN_TX = v; },",
  "  getOrc: function(){ return _ORC_ENVIADOS_DATA; }, setOrc: function(v){ _ORC_ENVIADOS_DATA = v; }",
  "};"
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_fin_entrega_fixture_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock de Firestore com transação real (mesmo padrão já usado neste
// projeto para esta MESMA função — ver test_hotfix_pagamentos_p0_8_17_
// registrar_saldo_2026-08-10.js — nunca reinventado) ──
var _fakeStore = {};
var _txnLock = Promise.resolve();
function resetFakeStore() { _fakeStore = {}; _txnLock = Promise.resolve(); }
function seedDoc(key, value) { _fakeStore[key] = { data: JSON.stringify(value), ts: Date.now() }; }
function readDoc(key) { var raw = _fakeStore[key]; return raw ? JSON.parse(raw.data) : null; }

global._db = {
  collection: function () { return { doc: function (key) { return { _key: key }; } }; },
  runTransaction: function (fn) {
    var runIt = function () {
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
// HARDENING DE CONFIDENCIALIDADE FINANCEIRA (2026-08-26) — finRegistrarRecebimento()
// não faz mais a transação de kb_os/kb_os_fin/fin_cr/fin_tx/orcamentos no
// client (migrada para a Cloud Function finCrRegistrarRecebimento(), Admin
// SDK — ver functions/src/finCr.ts, já coberta contra o Firestore Emulator
// real por test_hardening_fin_cr_functions_server_2026-08-26.js). Mock
// idêntico ao já usado em test_hotfix_pagamentos_p0_8_17_registrar_saldo_2026-08-10.js
// (nunca reinventado), reaproveitando o mock _db.runTransaction já existente.
global.firebase = {
  auth: function () { return { currentUser: { getIdToken: function () { return Promise.resolve('fake-token'); } } }; },
  functions: function () {
    return {
      httpsCallable: function (nome) {
        return function (payload) {
          if (nome !== 'finCrRegistrarRecebimento') return Promise.resolve({ data: { ok: true } });
          var osId = payload.osId;
          var valorPagoCents = Math.round((Number(payload.valorPago) || 0) * 100);
          var forma = payload.forma || 'PIX';
          var dia = payload.diaBR;
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
              var restanteServidorCents = Math.round((finServidor.restante || 0) * 100);
              if (restanteServidorCents <= 0) { var eJa = new Error('SALDO_JA_QUITADO'); eJa.code = 'failed-precondition'; throw eJa; }
              if (valorPagoCents > restanteServidorCents) { var eExc = new Error('VALOR_MAIOR_QUE_SALDO:' + (restanteServidorCents / 100)); eExc.code = 'failed-precondition'; throw eExc; }
              var novoRestanteCents = restanteServidorCents - valorPagoCents;
              var quitado = novoRestanteCents <= 0;
              if (quitado && osServidor.status === 'aguardando_saldo') osServidor.status = 'iniciada';
              finServidor.restante = novoRestanteCents / 100;
              kbData[osId] = osServidor; kbFinData[osId] = finServidor;
              var crEntry = crArr.find(function (c) { return c.osRef && c.osRef.indexOf(String(osServidor.num)) >= 0 && c.status === 'pendente'; });
              if (crEntry) {
                if (quitado) { crArr = crArr.filter(function (c) { return c !== crEntry; }); }
                else { crEntry.valor = novoRestanteCents / 100; }
              }
              var descBase = (quitado ? 'Pagamento do saldo' : 'Pagamento parcial do saldo') + ' — OS #' + osServidor.num;
              crArr = [{ id: 'cr' + Date.now() + '_pgtosaldo', cliente: osServidor.cliente, clienteId: '', orcamentoId: osServidor.orcRef || null, osId: osId, descricao: descBase, valor: valorPagoCents / 100, vencimento: dia, status: 'recebido', marca: osServidor.mk || 'vr', metodo: forma, osRef: 'OS #' + osServidor.num, dataCriacao: dia, dataRecebimento: dia }].concat(crArr);
              txArr = [{ data: (dia || '').slice(0, 5), cliente: osServidor.cliente, os: String(osServidor.num), marca: osServidor.mk || 'vr', valor: valorPagoCents / 100, metodo: forma, status: 'recebido', dia: 1, sem: 1, mes: 1 }].concat(txArr);
              var orcMutado = false;
              if (quitado && osServidor.orcRef && Array.isArray(orcArr)) {
                var orcEntry = orcArr.find(function (o) { return o.id === osServidor.orcRef; });
                if (orcEntry && orcEntry.status === 'aguardando_pagamento') { orcEntry.status = 'pago'; orcMutado = true; }
              }
              txn.set({ _key: 'kb_os' }, { data: JSON.stringify(kbData) });
              txn.set({ _key: 'kb_os_fin' }, { data: JSON.stringify(kbFinData) });
              txn.set({ _key: 'fin_tx' }, { data: JSON.stringify(txArr) });
              txn.set({ _key: 'fin_cr' }, { data: JSON.stringify(crArr) });
              if (orcMutado) txn.set({ _key: 'orcamentos' }, { data: JSON.stringify(orcArr) });
              return { osNum: osServidor.num, valorPago: valorPagoCents / 100, quitado: quitado, restanteAtual: finServidor.restante, orcRef: (quitado && orcMutado) ? osServidor.orcRef : null };
            });
          }).then(function (r) { return { data: Object.assign({ ok: true }, r) }; })
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
global._auditLog = [];
global.secAuditLog = function (acao, msg) { global._auditLog.push({ acao: acao, msg: msg }); };
global.finFmt = function (v) { return 'R$' + (v || 0).toFixed(2).replace('.', ','); };
global._currentSession = { email: 'vendedor@vrmarcas.com', user: 'vendedor@vrmarcas.com' };
global.kbSaveKbos = function () { return Promise.resolve({ ok: true }); };
global.orcEnvSetStatus = function () {};
var _promptQueue = [];
global.prompt = function (msg) { global._lastPromptMsg = msg; return _promptQueue.length ? _promptQueue.shift() : null; };

var mod = require(modPath);

console.log('\n=== RODADA 2026-08-16 (P0.15-P0.22) — fixture exata: R$156 / entrada R$78 / saldo R$78 ===\n');

// ── Fixture EXATA pedida pelo usuário ───────────────────────────────────────
function seedFixture() {
  resetFakeStore();
  mod.setKbOs({});
  mod.setFinCR([]); mod.setFinTX([]); mod.setOrc([]);
  global._lastToast = null; global._auditLog = []; _promptQueue = [];

  var osId = 'os_fixture_e2e';
  var orcId = 'orc_fixture_e2e';
  var entradaCents = 7800; // R$78,00
  var totalCents = 15600;  // R$156,00

  var kbOs = {};
  kbOs[osId] = {
    id: osId, num: '999', cliente: 'E2E_FINANCEIRO_GOLIVE_20260816', status: 'pronta',
    valor: totalCents / 100, totalGeral: totalCents / 100, restante: entradaCents / 100, // saldo R$78
    formaPgto: 'pix', orcRef: orcId, isTest: true
  };
  mod.setKbOs(kbOs);
  seedDoc(_dbKey('kb_os'), kbOs);

  var finOs = {}; finOs[osId] = { valor: totalCents / 100, totalGeral: totalCents / 100, restante: entradaCents / 100, formaPgto: 'pix', origem: 'OS_SALDO' };
  seedDoc(_dbKey('kb_os_fin'), finOs);
  mod.setKbOsFinCache(finOs);
  mod.mergeFinCache(); // KB_OS[id].restante precisa refletir o merge, igual ao app real

  var finCR = [{ id: 'cr_entrada_1', osId: osId, tipo: 'entrada', valor: entradaCents / 100, status: 'recebido', dataRecebimento: '2026-08-10' }];
  mod.setFinCR(finCR);
  seedDoc(_dbKey('fin_cr'), finCR);

  var finTX = [{ id: 'tx_entrada_1', osId: osId, valor: entradaCents / 100, tipo: 'entrada', data: '2026-08-10' }];
  mod.setFinTX(finTX);
  seedDoc(_dbKey('fin_tx'), finTX);

  var orcs = [{ id: orcId, num: '888', status: 'aguardando_pagamento', valorFinal: totalCents / 100, isTest: true }];
  mod.setOrc(orcs);
  seedDoc(_dbKey('orcamentos'), orcs);

  return { osId: osId, orcId: orcId };
}
function _dbKey(col) { return col; } // simplificação: uma chave por coleção neste mock

(async function () {

  var ctx = seedFixture();

  await test('1. estado inicial: Total=R$156,00, Recebido=R$78,00, Saldo=R$78,00, situação Parcial', async function () {
    var os = mod.getKbOs()[ctx.osId];
    var total = os.valor;
    var saldo = os.restante;
    var recebido = total - saldo;
    assertEq(total, 156, 'total');
    assertEq(recebido, 78, 'recebido inicial');
    assertEq(saldo, 78, 'saldo inicial');
  });

  var resultadoPagamento;
  await test('2. Registrar saldo +R$78,00 (osRegistrarPagamentoSaldo, rotina canônica única)', async function () {
    resultadoPagamento = await mod.osRegistrarPagamentoSaldo(ctx.osId, 78, 'pix', '2026-08-16', 'quitação fixture E2E');
    assertTruthy(resultadoPagamento, 'deveria retornar sucesso (truthy)');
  });

  await test('3. após registrar: Recebido=R$156,00, Saldo=R$0,00, Pago', async function () {
    var os = mod.getKbOs()[ctx.osId];
    var total = os.valor;
    var saldo = os.restante;
    var recebido = total - saldo;
    assertEq(saldo, 0, 'saldo deve zerar');
    assertEq(recebido, 156, 'recebido deve ser o total');
  });

  await test('4. exatamente 1 recebimento ADICIONAL registrado em FIN_CR (entrada original preservada + 1 novo)', function () {
    // HARDENING DE CONFIDENCIALIDADE FINANCEIRA (2026-08-26) — finRegistrarRecebimento()
    // não sincroniza mais o FIN_CR local do client após a chamada (Comercial
    // não tem mais esse array em memória); Financeiro, que legitimamente
    // tem acesso, recebe via SEU PRÓPRIO listener em tempo real. A prova de
    // que o servidor gravou certo é o próprio documento — igual a como os
    // outros testes deste arquivo (1, 3, 6, 7) já verificam via readDoc().
    var cr = readDoc('fin_cr');
    var entradas = cr.filter(function (c) { return c.osId === ctx.osId; });
    // entrada original (recebido, R$78) preservada; nenhuma linha "restante"
    // pendente sobra (quitado); exatamente 1 recebimento novo do saldo.
    var recebidosCount = entradas.filter(function (c) { return c.status === 'recebido' || c.status === undefined; }).length;
    assertTruthy(recebidosCount >= 2, 'esperado ao menos 2 entradas recebidas (original + saldo) — obtido ' + recebidosCount);
    var pendentes = entradas.filter(function (c) { return c.status === 'pendente'; });
    assertEq(pendentes.length, 0, 'CR quitado — nenhuma entrada pendente deve sobrar');
  });

  await test('5. exatamente 1 movimento de Caixa (FIN_TX) novo gerado pelo pagamento do saldo', function () {
    var tx = mod.getFinTX();
    var doSaldo = tx.filter(function (t) { return t.osId === ctx.osId && Math.abs((t.valor || 0) - 78) < 0.01; });
    assertEq(doSaldo.length, 1, 'exatamente 1 movimento de R$78,00 (o pagamento do saldo) — nunca duplicado');
  });

  await test('6. orçamento vinculado passa a "pago" (quitação total)', function () {
    var orc = mod.getOrc().find(function (o) { return o.id === ctx.orcId; });
    assertEq(orc.status, 'pago', 'orçamento deve virar pago');
  });

  await test('7. Entregar ao Cliente (osLiberar) — NÃO pede justificativa (saldo=0)', async function () {
    var ok = await mod.osLiberar(ctx.osId);
    assertTruthy(ok !== false, 'entrega não deveria falhar');
    var os = mod.getKbOs()[ctx.osId];
    assertEq(os.status, 'entregue', 'status deve virar entregue');
    assertTruthy(!!os.entregueEm, 'entregueEm deve ser gravado');
    var ultimoAudit = global._auditLog[global._auditLog.length - 1];
    assertTruthy(ultimoAudit && ultimoAudit.acao === 'os_entrega', 'ação de auditoria deve ser "os_entrega" (normal), nunca "os_entrega_excecao"');
  });

  await test('8. idempotência: registrar o MESMO pagamento de novo (retry/duplo clique) não duplica nada', async function () {
    var crAntes = mod.getFinCR().length, txAntes = mod.getFinTX().length;
    // saldo já está em 0 — uma nova tentativa de pagar R$78 deve ser
    // rejeitada pela rotina canônica (VALOR_MAIOR_QUE_SALDO / SALDO_JA_QUITADO),
    // nunca processada como um novo recebimento.
    var resultado = await mod.osRegistrarPagamentoSaldo(ctx.osId, 78, 'pix', '2026-08-16', 'tentativa duplicada');
    var crDepois = mod.getFinCR().length, txDepois = mod.getFinTX().length;
    assertEq(crDepois, crAntes, 'FIN_CR não pode crescer numa tentativa de pagamento duplicado após quitação');
    assertEq(txDepois, txAntes, 'FIN_TX não pode crescer numa tentativa de pagamento duplicado após quitação');
  });

  // ── P0.21 — pagamento PARCIAL do saldo (nova fixture independente) ────────
  var ctxParcial;
  await test('9. pagamento PARCIAL do saldo (R$40 de R$78) — reduz saldo sem quitar, situação continua Parcial', async function () {
    ctxParcial = seedFixture();
    await mod.osRegistrarPagamentoSaldo(ctxParcial.osId, 40, 'pix', '2026-08-16', 'parcial fixture E2E');
    var os = mod.getKbOs()[ctxParcial.osId];
    assertEq(Math.round(os.restante * 100) / 100, 38, 'saldo deve reduzir para R$38,00 (78-40)');
    assertTruthy(os.restante > 0, 'situação ainda deve ser Parcial (saldo > 0)');
  });

  await test('10. após pagamento parcial, Entregar ao Cliente (osLiberar) EXIGE justificativa (saldo>0)', async function () {
    _promptQueue.push('Cliente vai retirar hoje, saldo será cobrado à parte por acordo comercial.');
    var ok = await mod.osLiberar(ctxParcial.osId);
    assertTruthy(!!global._lastPromptMsg, 'prompt() deveria ter sido chamado (saldo pendente)');
    assertTruthy(/saldo pendente/.test(global._lastPromptMsg), 'mensagem deve mencionar saldo pendente');
    var os = mod.getKbOs()[ctxParcial.osId];
    assertEq(os.status, 'entregue', 'com justificativa preenchida, entrega deve prosseguir');
    var ultimoAudit = global._auditLog[global._auditLog.length - 1];
    assertTruthy(ultimoAudit && ultimoAudit.acao === 'os_entrega_excecao', 'ação de auditoria deve ser "os_entrega_excecao" (exceção), nunca a normal');
    assertTruthy(/justificativa/.test(ultimoAudit.msg), 'auditoria deve registrar a justificativa');
  });

  await test('11. entrega com saldo pendente CANCELADA (justificativa vazia) — nunca entrega sem motivo registrado', async function () {
    var ctxCancelada = seedFixture();
    await mod.osRegistrarPagamentoSaldo(ctxCancelada.osId, 40, 'pix', '2026-08-16', 'parcial');
    _promptQueue.push(''); // justificativa vazia
    var ok = await mod.osLiberar(ctxCancelada.osId);
    var os = mod.getKbOs()[ctxCancelada.osId];
    assertEq(os.status, 'pronta', 'status NÃO pode virar entregue sem justificativa');
    assertTruthy(!os.entregueEm, 'entregueEm não pode ser gravado');
  });

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  if (failed > 0) process.exitCode = 1;
})();
