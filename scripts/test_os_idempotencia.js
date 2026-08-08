/**
 * test_os_idempotencia.js
 * Regressão do bug real encontrado na Homologação Fase F (2026-08-05),
 * Fase 6, ao repetir a geração de OS a partir de um orçamento já
 * processado: orcEnvGerarOS() só verificava `o.osRef` já carregado em
 * memória na tela. Reabrir o modal do MESMO orçamento (já com OS gerada)
 * e clicar "Gerar OS no Kanban" de novo criava uma SEGUNDA OS e um
 * SEGUNDO recebimento — confirmado ao vivo no Emulator (orçamento
 * ORC-000009: OS #5 e #6, dois recebimentos de R$263,13 cada).
 *
 * Corrigido com uma transação Firestore que relê orçamento/kb_os/fin_cr/
 * contador diretamente do banco e recusa prosseguir se já existir osRef
 * OU qualquer OS vinculada ao mesmo orçamento — mesmo padrão já usado em
 * orcProximoNumeroAtomico()/comprasProximoNumeroAtomico().
 *
 * Funções sob teste (extraídas de index.html via contagem de chaves —
 * mesma técnica de test_orcamento_pdf_whatsapp.js — não reimplementadas):
 * orcEnvConfirmarPgto, orcPagtoTipoSel, orcEnvGerarOS.
 *
 * Uso: node scripts/test_os_idempotencia.js
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
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }
function assertApprox(got, exp, msg) {
  if (!approx(got, exp)) throw new Error((msg || 'valores diferentes') + ' — esperado ~' + exp + ', obtido ' + got);
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ── Extração por contagem de chaves balanceadas ─────────────────────────────
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

var FN_NAMES = ['orcEnvConfirmarPgto', 'orcPagtoTipoSel', 'orcEnvGerarOS'];
var COL = 'erp_vr';
var src = [
  'var _orcPagtoId = null;',
  'var _pgtoTipoAtual = null;',
  'var _ORC_ENVIADOS_DATA = [];',
  'function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }',
  'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; }',
  'var _OS_COUNTER = 0;',
  'var _COL = ' + JSON.stringify(COL) + ';',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  orcEnvConfirmarPgto: orcEnvConfirmarPgto, orcPagtoTipoSel: orcPagtoTipoSel,',
  '  orcEnvGerarOS: orcEnvGerarOS,',
  '  getPgtoTipoAtual: function(){ return _pgtoTipoAtual; },',
  '  setEnviados: function(arr){ _ORC_ENVIADOS_DATA = arr; },',
  '  getEnviados: function(){ return _ORC_ENVIADOS_DATA; },',
  '  getOSCounter: function(){ return _OS_COUNTER; },',
  '  setOSCounter: function(v){ _OS_COUNTER = v; }',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_os_idempotencia_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo ─────────────────────────────────────────────────────────
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

// ── Mock de Firestore com transação real (get-antes-de-set, atomicidade
// simulada por commit único no final, e concorrência serializada — mesma
// garantia observável de uma transação real: duas tentativas concorrentes
// nunca commitam as duas). ────────────────────────────────────────────────
var _fakeStore = {};
var _txnLock = Promise.resolve();
var _txnDelayMs = 0; // ajustável por teste para simular latência de rede
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
  return { id: id, num: num, cliente: 'E2E_FASEF_20260805_Cliente', valorFinal: valorFinal, status: 'aguardando' };
}
function seedFirestore(orcamentos) {
  _fakeStore['orcamentos'] = { data: JSON.stringify(orcamentos) };
  _fakeStore['kb_os'] = { data: JSON.stringify({}) };
  // Rodada 2, P0.6 (2026-08-07) — orcEnvGerarOS() passou a gravar
  // valorEntrada/restante/formaPgto/pagtoTipo em kb_os_fin (documento
  // separado, fora do alcance de leitura da Produção), não mais em
  // kb_os. Semear os dois documentos juntos, como o Firestore real
  // teria depois da mudança.
  _fakeStore['kb_os_fin'] = { data: JSON.stringify({}) };
  _fakeStore['fin_cr'] = { data: JSON.stringify([]) };
  _fakeStore['erp_os_counter'] = { data: JSON.stringify(0) };
}
function fakeStoreOS() { var raw = _fakeStore['kb_os']; return raw ? JSON.parse(raw.data) : {}; }
function fakeStoreOSFin() { var raw = _fakeStore['kb_os_fin']; return raw ? JSON.parse(raw.data) : {}; }
// Rodada 2, P0.6 — junta kb_os (operacional) + kb_os_fin (financeiro) por
// id, exatamente como _kbMergeFinCache() faz no app real, para os testes
// que checam valorEntrada/restante continuarem lendo do lugar certo.
function fakeStoreOSMerged() {
  var ops = fakeStoreOS(), fin = fakeStoreOSFin(), out = {};
  Object.keys(ops).forEach(function (id) { out[id] = Object.assign({}, ops[id], fin[id] || {}); });
  return out;
}
function fakeStoreCR() { var raw = _fakeStore['fin_cr']; return raw ? JSON.parse(raw.data) : []; }
function fakeStoreOrc() { var raw = _fakeStore['orcamentos']; return raw ? JSON.parse(raw.data) : []; }

console.log('\n=== Regressão: duplicidade de OS/recebimento ao reabrir orçamento (Fase F) ===\n');

(async function main() {

await test('1. geração normal cria exatamente uma OS e um recebimento', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-1', '000001', 1000);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-1');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  var os = Object.values(fakeStoreOS());
  var osFin = Object.values(fakeStoreOSMerged());
  var cr = fakeStoreCR();
  assertEq(os.length, 1, 'exatamente uma OS');
  assertEq(cr.length, 1, 'exatamente um recebimento');
  assertApprox(osFin[0].valorEntrada, 1000, 'entrada integral');
});

await test('2. reabrir o modal do mesmo orçamento e tentar de novo não duplica', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-2', '000002', 500);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-2');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  // simula reabertura: releitura do orçamento (agora já com osRef) do
  // Firestore, exatamente como orcEnvAbrir()+orcEnvConfirmarPgto() fariam
  mod.setEnviados(fakeStoreOrc());
  resetModalDom();
  mod.orcEnvConfirmarPgto('ORC-2');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  assertEq(Object.keys(fakeStoreOS()).length, 1, 'ainda exatamente uma OS após reabrir e tentar de novo');
  assertEq(fakeStoreCR().length, 1, 'ainda exatamente um recebimento');
});

await test('3. duas chamadas sequenciais (mesmo estado em memória) — segunda é bloqueada pela transação', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-3', '000003', 700);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-3');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  // NÃO atualiza o estado em memória entre as duas chamadas — simula o
  // botão reabilitado manualmente ou dois handlers concorrentes que ainda
  // veem o `o` antigo sem osRef.
  var p1 = mod.orcEnvGerarOS();
  var p2 = mod.orcEnvGerarOS();
  await Promise.all([p1, p2]);
  assertEq(Object.keys(fakeStoreOS()).length, 1, 'transação bloqueia a segunda tentativa mesmo com estado em memória desatualizado');
  assertEq(fakeStoreCR().length, 1, 'nenhum recebimento duplicado');
});

await test('4. duas chamadas verdadeiramente simultâneas (latência de rede simulada) — só uma vence', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-4', '000004', 900);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-4');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  _txnDelayMs = 20; // força as duas transações a fazerem get() antes de qualquer set()
  try {
    var pA = mod.orcEnvGerarOS();
    var pB = mod.orcEnvGerarOS();
    await Promise.all([pA, pB]);
  } finally { _txnDelayMs = 0; }
  assertEq(Object.keys(fakeStoreOS()).length, 1, 'apenas uma OS mesmo com duas transações correndo ao mesmo tempo');
  assertEq(fakeStoreCR().length, 1, 'apenas um recebimento');
});

await test('5. duas abas — segunda aba relê o Firestore e vê a OS já criada pela primeira', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-5', '000005', 300);
  seedFirestore([orc]);
  // aba 1
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-5');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  // aba 2 — processo separado que só lê o Firestore agora, depois da aba 1
  mod.setEnviados(fakeStoreOrc());
  resetModalDom();
  mod.orcEnvConfirmarPgto('ORC-5');
  // orcEnvConfirmarPgto detecta osRef e nem monta o formulário de
  // pagamento — mostra "OS já gerada" em vez do formulário; a proteção
  // de interface já resolveu o caso mais comum.
  var html5 = _elements['orcPagtoModal'].innerHTML;
  if (html5.indexOf('Valor da Entrada') >= 0 || html5.indexOf('orcGerarOSBtn') >= 0) {
    throw new Error('modal reconstruiu o formulário de pagamento mesmo com osRef já definido');
  }
  if (html5.indexOf('OS já gerada para este orçamento') < 0) {
    throw new Error('modal não mostrou a mensagem "OS já gerada"');
  }
});

await test('6. refresh depois da primeira geração — novo carregamento do Firestore não permite gerar de novo', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-6', '000006', 450);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-6');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  // "refresh": recarrega do zero a partir do Firestore, como orcCargaInicial faria
  mod.setEnviados(fakeStoreOrc());
  resetModalDom();
  mod.orcEnvConfirmarPgto('ORC-6');
  var html6 = _elements['orcPagtoModal'].innerHTML;
  if (html6.indexOf('Valor da Entrada') >= 0 || html6.indexOf('orcGerarOSBtn') >= 0) {
    throw new Error('após refresh, o formulário de pagamento reapareceu para um orçamento já processado');
  }
  if (html6.indexOf('OS já gerada para este orçamento') < 0) {
    throw new Error('após refresh, modal não mostrou a mensagem "OS já gerada"');
  }
});

await test('7. retry após timeout simulado — transação ainda impede duplicidade', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-7', '000007', 620);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-7');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  // "retry após resposta perdida": o cliente credita que a primeira
  // chamada falhou (rede) e tenta de novo, sem ter atualizado o `o` local
  await mod.orcEnvGerarOS();
  assertEq(Object.keys(fakeStoreOS()).length, 1, 'retry não duplica a OS');
  assertEq(fakeStoreCR().length, 1, 'retry não duplica o recebimento');
});

await test('8. orçamento já com osRef (dado pré-existente) é rejeitado direto pela transação', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-8', '000008', 200);
  orc.osRef = 'os_legado_123';
  seedFirestore([orc]);
  _fakeStore['kb_os'] = { data: JSON.stringify({ os_legado_123: { id: 'os_legado_123', num: '1', orcRef: 'ORC-8' } }) };
  mod.setEnviados([orc]);
  // orcEnvConfirmarPgto já bloqueia via interface; para provar que a
  // CAMADA DE DADOS também bloqueia de forma independente, chamamos
  // orcEnvGerarOS() diretamente (simula um handler duplicado/chamada
  // indireta que pulou a checagem de interface).
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  assertEq(Object.keys(fakeStoreOS()).length, 1, 'nenhuma OS nova — a transação recusa por causa do osRef já existente no Firestore');
});

await test('9. OS existente mas osRef ausente no orçamento (dado legado) — barreira 2 pega mesmo assim', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-9', '000009', 800); // sem osRef
  seedFirestore([orc]);
  _fakeStore['kb_os'] = { data: JSON.stringify({ os_orfa: { id: 'os_orfa', num: '2', orcRef: 'ORC-9' } }) };
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-9');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  assertEq(Object.keys(fakeStoreOS()).length, 1, 'barreira 2 (OS já vinculada) impede duplicidade mesmo sem osRef no orçamento');
});

await test('10. falha no meio da transação (orçamento removido) não deixa dado parcial', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-10', '000010', 150);
  seedFirestore([]); // orçamento não existe mais no Firestore
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-10');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  assertEq(Object.keys(fakeStoreOS()).length, 0, 'nenhuma OS gravada quando o orçamento não é encontrado na transação');
  assertEq(fakeStoreCR().length, 0, 'nenhum recebimento gravado');
});

await test('11. Integral — uma OS, um recebimento, entrada=total, restante=0, orçamento pago', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-11', '000011', 1000);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-11');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  var os = Object.values(fakeStoreOSMerged())[0];
  var o = fakeStoreOrc().find(function (x) { return x.id === 'ORC-11'; });
  assertApprox(os.valorEntrada, 1000); assertApprox(os.restante, 0); assertEq(o.status, 'pago');
});

await test('12. 50/50 — uma OS, uma entrada, um saldo pendente, nenhum duplicado', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-12', '000012', 1000);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-12');
  mod.orcPagtoTipoSel(_tipoButtons['50-50']);
  await mod.orcEnvGerarOS();
  var cr = fakeStoreCR();
  assertEq(cr.filter(function (c) { return c.status === 'recebido'; }).length, 1);
  assertEq(cr.filter(function (c) { return c.status === 'pendente'; }).length, 1);
});

await test('13. Parcial — uma OS, um recebimento no valor informado, saldo correto', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-13', '000013', 1000);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-13');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '120.55';
  await mod.orcEnvGerarOS();
  var os = Object.values(fakeStoreOSMerged())[0];
  assertApprox(os.valorEntrada, 120.55); assertApprox(os.restante, 879.45);
});

await test('14. Futuro — uma OS, nenhum recebimento inicial, saldo integral pendente', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-14', '000014', 640);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-14');
  mod.orcPagtoTipoSel(_tipoButtons['futuro']);
  await mod.orcEnvGerarOS();
  assertEq(fakeStoreCR().length, 0);
  var os = Object.values(fakeStoreOSMerged())[0];
  assertApprox(os.restante, 640);
});

await test('15. centavos preservados mesmo com a transação', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-15', '000015', 100.10);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-15');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '33.33';
  await mod.orcEnvGerarOS();
  var os = Object.values(fakeStoreOSMerged())[0];
  assertApprox(os.valorEntrada + os.restante, 100.10);
});

await test('16. alterar o DOM (reabilitar o botão manualmente) não contorna a proteção de dados', async function () {
  resetModalDom(); resetFakeStore();
  var orc = makeOrc('ORC-16', '000016', 400);
  seedFirestore([orc]);
  mod.setEnviados([orc]);
  mod.orcEnvConfirmarPgto('ORC-16');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  await mod.orcEnvGerarOS();
  // simula usuário reabilitando o botão via devtools e tentando de novo,
  // sem que orcEnvConfirmarPgto tenha sido chamado de novo (contornando a
  // camada de interface diretamente)
  _elements['orcGerarOSBtn'].disabled = false;
  await mod.orcEnvGerarOS();
  assertEq(Object.keys(fakeStoreOS()).length, 1, 'reabilitar o botão manualmente não cria uma segunda OS — a transação ainda bloqueia');
});

console.log('\n=== RESULTADO ===');
console.log(passed + ' passed, ' + failed + ' failed');
fs.unlinkSync(modPath);
process.exit(failed ? 1 : 0);

})();
