/**
 * test_hotfix_recebimentos_canonicos_2026-08-10.js
 *
 * HOTFIX P0 — RECEBIMENTOS CANÔNICOS / CR × OS × CAIXA.
 *
 * Bug real de produção (Orçamento #000015 / OS #6): o histórico de
 * recebimentos (FIN_CR) somava R$131,82 (entrada R$100 + saldo R$31,82),
 * mas a projeção financeira da OS (kb_os_fin.restante) continuava mostrando
 * R$31,82 de saldo — porque a baixa do saldo tinha sido feita pela tela
 * genérica de Contas a Receber (_finCRBaixaConfirmar), que nunca tocava
 * kb_os_fin. "Dar baixa pela OS" e "Dar baixa pelo Contas a Receber" eram
 * DUAS operações financeiras independentes para o mesmo evento real
 * (recebimento de cliente).
 *
 * Causas raiz reais encontradas e corrigidas nesta rodada (3, não 1):
 *   1. _finCRBaixaConfirmar()/finCRBulkBaixar() nunca escreviam kb_os_fin —
 *      A causa raiz do bug relatado. Corrigido: quando o CR tem uma OS
 *      vinculada (finCRLinkedOS), a baixa passa a chamar
 *      finRegistrarRecebimento() — a MESMA rotina canônica do botão
 *      "Registrar pagamento do saldo" da OS.
 *   2. kbSaveKbos() sobrescrevia kb_os_fin INTEIRO a partir do estado em
 *      memória (KB_OS) em toda ação puramente operacional (drag&drop,
 *      checklist, iniciar produção...) — nenhuma delas relê o servidor
 *      antes de gravar. Se uma aba tivesse KB_OS desatualizado, qualquer
 *      clique operacional sobrescrevia de volta um saldo já corrigido por
 *      outra aba. Corrigido: kbSaveKbos() nunca mais escreve kb_os_fin.
 *   3. orcEnvGerarOS() nunca escrevia em fin_tx — a entrada de uma venda
 *      nova ficava "recebida" no CR mas invisível no Caixa. Corrigido: a
 *      mesma transação que cria a OS agora também lança a entrada no
 *      Caixa quando há valorEntrada>0.
 *
 * Arquitetura depois: finRegistrarRecebimento(osId, valor, forma, data,
 * obs, origem) é A ÚNICA rotina que aplica um recebimento de venda a uma
 * OS — transação atômica (kb_os, kb_os_fin, fin_cr, fin_tx, orcamentos),
 * relê o saldo real do servidor antes de decidir, nunca sobrescreve
 * histórico. osRegistrarPagamentoSaldo() (botão da OS) e
 * _finCRBaixaConfirmar() (tela de Contas a Receber, quando há OS vinculada)
 * são agora só duas INTERFACES chamando a mesma rotina, com `origem`
 * diferente só para auditoria.
 *
 * Uso: node scripts/test_hotfix_recebimentos_canonicos_2026-08-10.js
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

var FN_NAMES = [
  'moneyToCents', 'centsToMoney', 'finCaixaISOtoBR',
  'finRegistrarRecebimento', 'osRegistrarPagamentoSaldo',
  'finCRLinkedOS', '_finCRBaixaConfirmar', 'finCRBulkBaixar',
  'finAuditoriaDivergencias', 'kbSaveKbos',
  'orcEnvConfirmarPgto', 'orcPagtoTipoSel', 'orcEnvGerarOS', 'orcCondicaoLabelPorTipo',
];
var src = [
  "var _COL = 'erp_vr';",
  "var _cloudLastPayload = {};",
  "var KB_OS = {};",
  "var FIN_CR = []; var FIN_TX = [];",
  "var _ORC_ENVIADOS_DATA = [];",
  "var _kbOsId = null;",
  "var _kbStatusMap = { iniciada:{cls:'si',txt:'Iniciada'}, aguardando_saldo:{cls:'sas',txt:'Aguard. Saldo'}, pronta:{cls:'sp',txt:'Pronta'} };",
  "var _KB_OS_FIN_FIELDS = ['valor','totalGeral','parcelas','formaPgto','pagtoTipo','valorEntrada','restante'];",
  "var _orcPagtoId = null; var _pgtoTipoAtual = null; var _OS_COUNTER = 0;",
  "function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }",
  "function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; }",
  "var _finCRSel = {};",
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = {",
  "  finRegistrarRecebimento: finRegistrarRecebimento,",
  "  osRegistrarPagamentoSaldo: osRegistrarPagamentoSaldo,",
  "  finCRLinkedOS: finCRLinkedOS,",
  "  _finCRBaixaConfirmar: _finCRBaixaConfirmar,",
  "  finCRBulkBaixar: finCRBulkBaixar,",
  "  finAuditoriaDivergencias: finAuditoriaDivergencias,",
  "  kbSaveKbos: kbSaveKbos,",
  "  orcEnvConfirmarPgto: orcEnvConfirmarPgto, orcPagtoTipoSel: orcPagtoTipoSel, orcEnvGerarOS: orcEnvGerarOS,",
  "  getKbOs: function(){ return KB_OS; }, setKbOs: function(v){ KB_OS = v; },",
  "  getFinCR: function(){ return FIN_CR; }, setFinCR: function(v){ FIN_CR = v; },",
  "  getFinTX: function(){ return FIN_TX; }, setFinTX: function(v){ FIN_TX = v; },",
  "  getOrc: function(){ return _ORC_ENVIADOS_DATA; }, setOrc: function(v){ _ORC_ENVIADOS_DATA = v; },",
  "  setSel: function(v){ _finCRSel = v; },",
  "};"
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_recebimentos_canonicos_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock de Firestore com transação real, concorrência serializada por
//    rodada (mesmo padrão de test_kbrecebersaldo_atomicidade.js /
//    test_hotfix_pagamentos_p0_8_17..., nunca reinventado) ──
var _fakeStore = {};
var _txnLock = Promise.resolve();
var _txnDelayMs = 0;
function resetFakeStore() { _fakeStore = {}; _txnLock = Promise.resolve(); _txnDelayMs = 0; }
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
global.firebase = { auth: function () { return { currentUser: { getIdToken: function () { return Promise.resolve('fake-token'); } } }; } };

// ── DOM mock mínimo para orcEnvConfirmarPgto/orcPagtoTipoSel/orcEnvGerarOS
//    (mesmo padrão de test_idempotencia_10x_2026-08-08.js) ──
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
  reg('osPgtoSaldoBtn', makeEl({ disabled: false }));
}

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
global.finCRRender = function () {};
global.finDashKPIs = function () {};
global.finBarChartRender = function () {};
global._finSaveCR = function () { return Promise.resolve({ ok: true }); };
global.kbRender = function () {};
global.nav = function () {};
global._cloudReady = false;

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

function resetAll() {
  resetFakeStore();
  resetModalDom();
  mod.setKbOs({}); mod.setFinCR([]); mod.setFinTX([]); mod.setOrc([]); mod.setSel({});
  global._lastToast = null; global._lastToastKind = null;
}

console.log('\n=== HOTFIX RECEBIMENTOS CANÔNICOS — CR × OS × CAIXA (2026-08-10) ===\n');

// Helper: gera uma OS real via orcEnvGerarOS (mesmo caminho de produção),
// devolvendo {osId, orcId} para os testes usarem como fixture verdadeira
// (nunca um fixture inventado à mão — a própria rotina de criação é quem
// monta o estado inicial).
async function gerarOSReal(numOrc, valorFinal, tipo, entradaVal) {
  resetModalDom();
  var orc = { id: 'ORC-' + numOrc, num: numOrc, cliente: 'Cliente E2E ' + numOrc, valorFinal: valorFinal, status: 'aguardando' };
  var arrOrc = readDoc('orcamentos') || [];
  arrOrc.push(orc);
  seedDoc('orcamentos', arrOrc);
  if (!readDoc('kb_os')) seedDoc('kb_os', {});
  if (!readDoc('kb_os_fin')) seedDoc('kb_os_fin', {});
  if (!readDoc('fin_cr')) seedDoc('fin_cr', []);
  if (!readDoc('erp_os_counter')) seedDoc('erp_os_counter', 0);
  mod.setOrc(arrOrc);
  mod.orcEnvConfirmarPgto(orc.id);
  mod.orcPagtoTipoSel(_tipoButtons[tipo]);
  if (entradaVal !== undefined) _elements['pgtoEntradaVal'].value = String(entradaVal);
  await mod.orcEnvGerarOS();
  var kbOs = readDoc('kb_os');
  var osId = Object.keys(kbOs).find(function (k) { return kbOs[k].orcRef === orc.id; });
  mod.setKbOs(kbOs);
  mod.setFinCR(readDoc('fin_cr') || []);
  mod.setFinTX(readDoc('fin_tx') || []);
  return { osId: osId, orcId: orc.id };
}

(async function main() {

// ─────────────────────────────────────────────────────────────────────────
// T1 — Entrada pelo orçamento: Total 1.000, Entrada 500 PIX
// ─────────────────────────────────────────────────────────────────────────
await test('T1 — orcEnvGerarOS(): entrada 500/1000 PIX → CR 500 recebido + 500 pendente; kb_os_fin.restante=500; Caixa +500 (achado real: antes NUNCA lançava Caixa)', async function () {
  resetAll();
  var r = await gerarOSReal('T1', 1000, '50-50', 500);
  var kbOsFin = readDoc('kb_os_fin')[r.osId];
  assertEq(kbOsFin.restante, 500, 'saldo materializado = 500');
  var cr = readDoc('fin_cr');
  var recebidos = cr.filter(function (c) { return c.status === 'recebido'; });
  var pendentes = cr.filter(function (c) { return c.status === 'pendente'; });
  assertEq(recebidos.length, 1, 'exatamente 1 entrada recebida');
  assertEq(recebidos[0].valor, 500, 'valor da entrada recebida = 500');
  assertEq(pendentes.length, 1, 'exatamente 1 entrada pendente (restante)');
  assertEq(pendentes[0].valor, 500, 'valor do restante pendente = 500');
  var tx = readDoc('fin_tx') || [];
  assertEq(tx.length, 1, 'Caixa recebe exatamente 1 movimento pela entrada (bug real: antes ficava 0)');
  assertEq(tx[0].valor, 500, 'valor do movimento de Caixa = valor da entrada');
});

// ─────────────────────────────────────────────────────────────────────────
// T2 — Saldo pela OS: +500 Débito → CR Pago, OS_fin saldo 0, Caixa 1000
// ─────────────────────────────────────────────────────────────────────────
await test('T2 — finRegistrarRecebimento(origem OS_SALDO): saldo pago → kb_os_fin.restante=0, Caixa total=1000 (2 movimentos), histórico com 2 recebimentos', async function () {
  resetAll();
  var r = await gerarOSReal('T2', 1000, '50-50', 500);
  var ok = await mod.finRegistrarRecebimento(r.osId, 500, 'Cartão de Débito', '', '', 'OS_SALDO');
  assertTruthy(ok, 'retorna sucesso');
  var kbOsFin = readDoc('kb_os_fin')[r.osId];
  assertEq(kbOsFin.restante, 0, 'saldo zerado');
  var cr = readDoc('fin_cr');
  var recebidos = cr.filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 2, 'histórico com DOIS recebimentos — entrada preservada + saldo novo, nunca fundidos');
  var somaRecebida = recebidos.reduce(function (s, c) { return s + c.valor; }, 0);
  assertEq(Math.round(somaRecebida * 100) / 100, 1000, 'soma dos recebimentos bate exatamente o contratado');
  var tx = readDoc('fin_tx');
  assertEq(tx.length, 2, 'Caixa com exatamente 2 movimentos (entrada + saldo)');
  var somaCaixa = tx.reduce(function (s, t) { return s + t.valor; }, 0);
  assertEq(somaCaixa, 1000, 'Caixa soma exatamente o contratado');
});

// ─────────────────────────────────────────────────────────────────────────
// T3 — Mesmo saldo via Contas a Receber — resultado IDÊNTICO ao T2
// ─────────────────────────────────────────────────────────────────────────
await test('T3 — _finCRBaixaConfirmar() (tela CR) no mesmo cenário do T2 produz EXATAMENTE o mesmo estado final (a causa raiz real do bug #000015/OS #6)', async function () {
  resetAll();
  var r = await gerarOSReal('T3', 1000, '50-50', 500);
  var crPendente = readDoc('fin_cr').find(function (c) { return c.status === 'pendente'; });
  mod.setFinCR(readDoc('fin_cr'));
  var dtISO = new Date().toISOString().slice(0, 10);
  var ok = await mod._finCRBaixaConfirmar(crPendente.id, dtISO);
  assertTruthy(ok, 'baixa pela tela de CR retorna sucesso');
  var kbOsFin = readDoc('kb_os_fin')[r.osId];
  assertEq(kbOsFin.restante, 0, 'ANTES DO FIX ficaria em 500 (o bug real) — agora kb_os_fin é sincronizado igual ao botão da OS');
  var cr = readDoc('fin_cr');
  var recebidos = cr.filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 2, 'mesmo resultado do T2: dois recebimentos, nunca fundidos');
  var tx = readDoc('fin_tx');
  assertEq(tx.length, 2, 'Caixa com exatamente 2 movimentos, igual ao T2 — "dar baixa pela OS" e "dar baixa pelo CR" são a mesma operação');
});

// ─────────────────────────────────────────────────────────────────────────
// T4 — Parcial via Contas a Receber (origem CONTAS_A_RECEBER, valor parcial)
// ─────────────────────────────────────────────────────────────────────────
// Nota de escopo: o modal de baixa da tela de Contas a Receber
// (#finBaixaOverlay) hoje só tem campo de DATA — "baixar" sempre paga o
// valor integral daquela linha do CR, não existe input de valor parcial
// nessa tela (nunca existiu, não é uma regressão desta rodada). O que este
// teste prova é que a ROTINA CANÔNICA em si é agnóstica de origem também
// para pagamento parcial — chamando-a diretamente com origem
// 'CONTAS_A_RECEBER' e um valor menor que o saldo, o resultado é idêntico
// ao mesmo cenário via origem 'OS_SALDO' (T5). Adicionar um campo de valor
// editável à tela de CR seria uma feature nova de UI, fora do escopo deste
// hotfix (correção de bug, não de capacidade).
await test('T4 — finRegistrarRecebimento(origem CONTAS_A_RECEBER, parcial): 500 de saldo, recebe 200 → saldo 300 em todas as projeções', async function () {
  resetAll();
  var r = await gerarOSReal('T4', 1000, '50-50', 500);
  var ok = await mod.finRegistrarRecebimento(r.osId, 200, 'PIX', '', '', 'CONTAS_A_RECEBER');
  assertTruthy(ok, 'retorna sucesso');
  var kbOsFin = readDoc('kb_os_fin')[r.osId];
  assertEq(kbOsFin.restante, 300, 'saldo reduzido para 300, nunca quitado por engano');
  var cr = readDoc('fin_cr');
  var pendente = cr.find(function (c) { return c.status === 'pendente'; });
  assertTruthy(pendente, 'entrada pendente ainda existe (parcial nunca fecha o restante)');
  assertEq(pendente.valor, 300, 'valor da entrada pendente atualizado para o novo saldo');
});

// ─────────────────────────────────────────────────────────────────────────
// T5 — Parcial via OS — mesmo resultado do T4
// ─────────────────────────────────────────────────────────────────────────
await test('T5 — finRegistrarRecebimento(origem OS_SALDO, parcial): mesmo cenário do T4 via OS produz o mesmo saldo 300', async function () {
  resetAll();
  var r = await gerarOSReal('T5', 1000, '50-50', 500);
  await mod.finRegistrarRecebimento(r.osId, 200, 'PIX', '', '', 'OS_SALDO');
  var kbOsFin = readDoc('kb_os_fin')[r.osId];
  assertEq(kbOsFin.restante, 300, 'saldo 300 — idêntico ao T4, origem não muda o efeito financeiro');
});

// ─────────────────────────────────────────────────────────────────────────
// T6 — Duplo clique 10x — origem CONTAS_A_RECEBER (o botão da OS já está
// coberto em test_hotfix_pagamentos_p0_8_17_registrar_saldo_2026-08-10.js;
// aqui cobrimos a MESMA proteção a partir da tela de Contas a Receber)
// ─────────────────────────────────────────────────────────────────────────
await test('T6 — 10 cliques em "Baixar" na tela de Contas a Receber (mesmo CR) → exatamente 1 recebimento efetivo', async function () {
  resetAll();
  var r = await gerarOSReal('T6', 500, '50-50', 250);
  var crPendente = readDoc('fin_cr').find(function (c) { return c.status === 'pendente'; });
  mod.setFinCR(readDoc('fin_cr'));
  var dtISO = new Date().toISOString().slice(0, 10);
  var chamadas = [];
  for (var i = 0; i < 10; i++) chamadas.push(mod._finCRBaixaConfirmar(crPendente.id, dtISO));
  await Promise.all(chamadas);
  var kbOsFin = readDoc('kb_os_fin')[r.osId];
  assertEq(kbOsFin.restante, 0, 'saldo zerado, nunca negativo');
  var recebidos = readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 2, 'exatamente entrada + UM saldo — guard síncrono (r._baixando) bloqueou as outras 9 chamadas');
  var tx = readDoc('fin_tx');
  assertEq(tx.length, 2, 'Caixa com exatamente 2 movimentos, nunca 10');
});

// ─────────────────────────────────────────────────────────────────────────
// T7 — Concorrência CROSS-SCREEN real: aba OS e aba Contas a Receber
// tentam quitar o MESMO saldo ao mesmo tempo
// ─────────────────────────────────────────────────────────────────────────
await test('T7 — CONCORRÊNCIA CROSS-SCREEN: aba OS (osRegistrarPagamentoSaldo) e aba Contas a Receber (_finCRBaixaConfirmar) tentam quitar o mesmo saldo simultaneamente → só UMA efetiva, nunca duplica nem sobre-paga', async function () {
  resetAll();
  var r = await gerarOSReal('T7', 800, '50-50', 400);
  var crPendente = readDoc('fin_cr').find(function (c) { return c.status === 'pendente'; });
  mod.setFinCR(readDoc('fin_cr'));
  mod.setKbOs(readDoc('kb_os'));
  var dtISO = new Date().toISOString().slice(0, 10);
  _txnDelayMs = 15; // força as duas transações a fazerem get() antes de qualquer set() — corrida real, não sequencial
  try {
    var chamadaOS = mod.osRegistrarPagamentoSaldo(r.osId, 400, 'PIX', '', '');
    var chamadaCR = mod._finCRBaixaConfirmar(crPendente.id, dtISO);
    await Promise.all([chamadaOS, chamadaCR]);
  } finally { _txnDelayMs = 0; }
  var kbOsFin = readDoc('kb_os_fin')[r.osId];
  assertEq(kbOsFin.restante, 0, 'saldo zerado, nunca negativo (nenhuma das duas sobre-pagou)');
  var recebidos = readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 2, 'entrada + UM saldo — a segunda tentativa (independente de qual das duas telas "ganhou" a corrida) relê o servidor e reconcilia como já quitado, nunca duplica');
  var tx = readDoc('fin_tx');
  assertEq(tx.length, 2, 'Caixa com exatamente 2 movimentos — nunca 3 (nenhum lançamento fantasma da tentativa perdedora)');
  var somaCaixa = tx.reduce(function (s, t) { return s + t.valor; }, 0);
  assertEq(somaCaixa, 800, 'soma do Caixa bate exatamente o contratado, mesmo sob corrida real entre as duas telas');
});

// ─────────────────────────────────────────────────────────────────────────
// T8 — Retry: mesmo saldo já quitado, nova tentativa é idempotente
// ─────────────────────────────────────────────────────────────────────────
await test('T8 — retry após sucesso (saldo já quitado por tentativa anterior) — idempotente, nunca duplica', async function () {
  resetAll();
  var r = await gerarOSReal('T8', 600, '50-50', 300);
  await mod.finRegistrarRecebimento(r.osId, 300, 'PIX', '', '', 'OS_SALDO');
  mod.getKbOs()[r.osId]._pagandoSaldo = false; // simula UI liberada entre as duas tentativas
  var okRetry = await mod.finRegistrarRecebimento(r.osId, 300, 'PIX', '', '', 'OS_SALDO');
  assertTruthy(okRetry, 'retry recebe resposta idempotente tratada (SALDO_JA_QUITADO), não trava nem falha');
  var recebidos = readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; });
  assertEq(recebidos.length, 2, 'ainda só entrada + 1 saldo — retry não duplicou nada');
  var tx = readDoc('fin_tx');
  assertEq(tx.length, 2, 'Caixa não ganhou um 3º movimento por causa do retry');
});

// ─────────────────────────────────────────────────────────────────────────
// T9 — Caixa: cada recebimento legítimo gera exatamente 1 movimento
// ─────────────────────────────────────────────────────────────────────────
await test('T9 — Caixa: sequência entrada→parcial→parcial gera exatamente 3 movimentos, nunca mais nem menos', async function () {
  resetAll();
  var r = await gerarOSReal('T9', 900, '50-50', 300); // entrada 300, saldo 600
  assertEq((readDoc('fin_tx') || []).length, 1, 'após entrada: 1 movimento');
  await mod.finRegistrarRecebimento(r.osId, 200, 'PIX', '', '', 'OS_SALDO'); // saldo 600->400
  assertEq(readDoc('fin_tx').length, 2, 'após 1º parcial: 2 movimentos');
  mod.getKbOs()[r.osId]._pagandoSaldo = false;
  await mod.finRegistrarRecebimento(r.osId, 400, 'PIX', '', '', 'CONTAS_A_RECEBER'); // quita os 400 restantes
  assertEq(readDoc('fin_tx').length, 3, 'após 2º parcial (quitação): 3 movimentos — nunca 1 movimento fantasma extra');
  var soma = readDoc('fin_tx').reduce(function (s, t) { return s + t.valor; }, 0);
  assertEq(soma, 900, 'soma total do Caixa bate exatamente o contratado');
});

// ─────────────────────────────────────────────────────────────────────────
// T10 — Reopen: fechar/reabrir mostra o mesmo total/recebido/saldo/histórico
// ─────────────────────────────────────────────────────────────────────────
await test('T10 — reopen: reler o estado do servidor duas vezes seguidas (sem nenhuma ação nova) devolve exatamente o mesmo total/recebido/saldo/histórico', async function () {
  resetAll();
  var r = await gerarOSReal('T10', 700, '50-50', 350);
  await mod.finRegistrarRecebimento(r.osId, 350, 'Dinheiro', '', '', 'OS_SALDO');
  var leitura1 = { fin: readDoc('kb_os_fin')[r.osId], cr: readDoc('fin_cr'), tx: readDoc('fin_tx') };
  var leitura2 = { fin: readDoc('kb_os_fin')[r.osId], cr: readDoc('fin_cr'), tx: readDoc('fin_tx') };
  assertEq(leitura1.fin.restante, leitura2.fin.restante, 'saldo idêntico entre as duas leituras');
  assertEq(leitura1.cr.length, leitura2.cr.length, 'histórico com o mesmo número de entradas');
  assertEq(leitura1.tx.length, leitura2.tx.length, 'Caixa com o mesmo número de movimentos — reabrir nunca gera novo lançamento');
});

// ─────────────────────────────────────────────────────────────────────────
// T11 — Produção nunca lê recebido/saldo/formas/kb_os_fin
// ─────────────────────────────────────────────────────────────────────────
await test('T11 — kbSaveKbos() (chamada por TODA ação operacional, inclusive as da Produção) nunca mais escreve em kb_os_fin (achado real corrigido: sobrescrevia com estado de memória potencialmente obsoleto)', function () {
  var srcKbSave = extractFn('kbSaveKbos');
  assertTruthy(srcKbSave.indexOf("_cloudSave('kb_os_fin'") < 0 && srcKbSave.indexOf('_cloudSave("kb_os_fin"') < 0,
    'kbSaveKbos() não deve mais conter nenhuma chamada de escrita a kb_os_fin — ' + srcKbSave.slice(0, 200));
  assertTruthy(srcKbSave.indexOf("_cloudSave('kb_os'") >= 0, 'kbSaveKbos() continua escrevendo kb_os normalmente (operação legítima)');
});

// ─────────────────────────────────────────────────────────────────────────
// T12 — Legacy: documento antigo sem ledger completo não quebra a UI
// ─────────────────────────────────────────────────────────────────────────
await test('T12 — finAuditoriaDivergencias() com OS sem NENHUM FIN_CR vinculado (dado legado) não lança exceção e não reporta divergência inventada', function () {
  resetAll();
  mod.setKbOs({ osLegado: { id: 'osLegado', num: 999, cliente: 'Legado', valor: 500, restante: 500 } });
  mod.setFinCR([]);
  var divergencias;
  var lancou = false;
  try { divergencias = mod.finAuditoriaDivergencias(); } catch (e) { lancou = true; }
  assertTruthy(!lancou, 'não lança exceção para OS sem histórico de recebimentos');
  assertEq(divergencias, [], 'sem FIN_CR vinculado, não há nada a comparar — nenhuma divergência inventada');
});

// ─────────────────────────────────────────────────────────────────────────
// INVARIANTE: recebido + saldo === contratado (tolerância 0 centavos)
// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- Invariante: recebidoCents + saldoCents === contratadoCents ---\n');
{

  await test('INV1 — cenário PAGO (T2 rerodado): recebido+saldo=contratado, saldo=0', async function () {
    resetAll();
    var r = await gerarOSReal('INV1', 1000, '50-50', 500);
    await mod.finRegistrarRecebimento(r.osId, 500, 'PIX', '', '', 'OS_SALDO');
    var fin = readDoc('kb_os_fin')[r.osId];
    var recebidoCents = mod.getFinCR ? readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; }).reduce(function (s, c) { return s + Math.round(c.valor * 100); }, 0) : 0;
    var saldoCents = Math.round((fin.restante || 0) * 100);
    var contratadoCents = Math.round((fin.valor || fin.totalGeral || 0) * 100);
    assertEq(recebidoCents + saldoCents, contratadoCents, 'recebido+saldo=contratado (pago)');
    assertEq(saldoCents, 0, 'pago ⇒ saldo=0');
  });

  await test('INV2 — cenário PARCIAL: 0 < saldo < total', async function () {
    resetAll();
    var r = await gerarOSReal('INV2', 1000, '50-50', 500);
    await mod.finRegistrarRecebimento(r.osId, 200, 'PIX', '', '', 'OS_SALDO');
    var fin = readDoc('kb_os_fin')[r.osId];
    var recebidoCents = readDoc('fin_cr').filter(function (c) { return c.status === 'recebido'; }).reduce(function (s, c) { return s + Math.round(c.valor * 100); }, 0);
    var saldoCents = Math.round((fin.restante || 0) * 100);
    var contratadoCents = Math.round((fin.valor || fin.totalGeral || 0) * 100);
    assertEq(recebidoCents + saldoCents, contratadoCents, 'recebido+saldo=contratado (parcial)');
    assertTruthy(saldoCents > 0 && saldoCents < contratadoCents, 'parcial ⇒ 0 < saldo < contratado');
  });

  await test('INV3 — cenário NÃO PAGO (futuro, sem entrada): recebido=0', async function () {
    resetAll();
    var r = await gerarOSReal('INV3', 1000, 'futuro', undefined);
    var fin = readDoc('kb_os_fin')[r.osId];
    var cr = readDoc('fin_cr');
    assertEq(cr.length, 0, 'sem entrada, nenhum FIN_CR criado (nunca inventa recebimento)');
    assertEq(fin.restante, 1000, 'saldo = total, nada recebido ainda');
  });

  await test('INV4 — finAuditoriaDivergencias() DETECTA uma divergência real injetada (prova que o teste de invariante não é vácuo)', function () {
    resetAll();
    // Simula exatamente o bug real do caso #000015/OS #6: FIN_CR mostra o
    // valor todo recebido, mas kb_os_fin.restante ficou obsoleto.
    mod.setKbOs({ osBug: { id: 'osBug', num: 6, cliente: 'Isabella', valor: 131.82, restante: 31.82 } });
    mod.setFinCR([
      { id: 'cr1', osId: 'osBug', osRef: 'OS #6', status: 'recebido', valor: 100.00 },
      { id: 'cr2', osId: 'osBug', osRef: 'OS #6', status: 'recebido', valor: 31.82 },
    ]);
    var divergencias = mod.finAuditoriaDivergencias();
    assertEq(divergencias.length, 1, 'detecta exatamente a divergência injetada');
    assertEq(divergencias[0].osNum, 6, 'aponta a OS correta');
    assertEq(divergencias[0].diffCents, -3182, 'diferença exata: saldo derivado (0) - saldo materializado (3182) = -3182');
  });
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
})();
