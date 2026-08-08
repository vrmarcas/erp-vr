/**
 * test_kb_os_fin_rules_2026-08-08.js
 *
 * RODADA 2.1 — item 5 (CRÍTICO): prova real, não só "o número não aparece
 * na tela", de que a privacidade financeira da Produção (P0.6) é imposta
 * pelo SERVIDOR — não pela UI.
 *
 * Diferente de test_rodada2_2026-08-07.js (que só espelha a lógica pura de
 * split/merge em memória, sem nenhum Firestore real) e de qualquer teste
 * baseado em Admin SDK/.run() (que SEMPRE ignora Rules, por design), esta
 * suíte ataca a API REST do Firestore Emulator com um idToken REAL emitido
 * pelo Auth Emulator para uma conta 'producao' de verdade — exatamente o
 * caminho que um cliente comprometido (DevTools, app modificado, chamada
 * direta ao SDK) usaria para tentar ler o financeiro sem passar pela tela.
 *
 * Mesmo padrão REST já usado em test_estoque_rules.js — sem dependência nova.
 *
 * Uso: node scripts/test_kb_os_fin_rules_2026-08-08.js
 * Pré-requisito: Emulators rodando (demo-erp-homolog) — Auth :9099, Firestore :8080.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
const http = require('http');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const authAdmin = admin.auth();

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { if (got !== exp) throw new Error((msg || 'valores diferentes') + ' — esperado ' + exp + ', obtido ' + got); }
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
function assertFalsy(v, msg) { if (v) throw new Error(msg || 'esperado valor falsy'); }

function httpJson(opts, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = Object.assign({}, opts.headers || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request(Object.assign({}, opts, { headers }), (res) => {
      let out = ''; res.on('data', (c) => out += c); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
async function signIn(email, password) {
  const r = await httpJson({ hostname: 'localhost', port: 9099, path: '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key', method: 'POST' }, { email, password, returnSecureToken: true });
  const j = JSON.parse(r.body);
  if (!j.idToken) throw new Error('signIn falhou para ' + email + ': ' + r.body);
  return j.idToken;
}
function firestoreWrite(idToken, docId, fields) {
  const body = { fields: {} };
  Object.keys(fields).forEach((k) => { body.fields[k] = typeof fields[k] === 'number' ? { integerValue: String(fields[k]) } : { stringValue: String(fields[k]) }; });
  return httpJson({ hostname: 'localhost', port: 8080, path: `/v1/projects/demo-erp-homolog/databases/(default)/documents/erp_vr/${docId}`, method: 'PATCH', headers: idToken ? { Authorization: 'Bearer ' + idToken } : {} }, body);
}
function firestoreRead(idToken, docId) {
  return httpJson({ hostname: 'localhost', port: 8080, path: `/v1/projects/demo-erp-homolog/databases/(default)/documents/erp_vr/${docId}`, method: 'GET', headers: idToken ? { Authorization: 'Bearer ' + idToken } : {} });
}

const { USUARIOS, SENHA_PADRAO } = require('./e2e_clean_env');
var FIX = {};
USUARIOS.forEach((u) => { FIX[u.name] = { email: u.email, role: u.role, uid: u.uid }; });
var PASSWORD = SENHA_PADRAO;

async function ensureFixtureUsers() {
  for (var key in FIX) { await authAdmin.getUser(FIX[key].uid); }
}

// Seed real (Admin SDK, bypassa Rules — é o "servidor" preparando o
// cenário, não o teste em si) — kb_os operacional + kb_os_fin financeiro
// para a MESMA OS, exatamente como kbSaveKbos()/orcEnvGerarOS() gravam
// depois do split do P0.6. IMPORTANTE: 'kb_os'/'kb_os_fin' são documentos-
// -agregado ÚNICOS compartilhados por todo o emulador (todas as OS de
// todas as suítes desta sessão) — .set() sem merge SUBSTITUIRIA o
// documento inteiro. Lê o que já existe e faz merge, para não destruir
// dado real de outra suíte, e limpa só a própria chave no final.
var OS_ID = 'e2e_rules_kbfin_' + Date.now();
async function mergeDoc(docId, patch) {
  var ref = db.collection('erp_vr').doc(docId);
  var snap = await ref.get();
  var atual = (snap.exists && snap.data() && snap.data().data) ? JSON.parse(snap.data().data) : {};
  Object.assign(atual, patch);
  await ref.set({ data: JSON.stringify(atual), ts: Date.now() });
}
async function seedOS() {
  await mergeDoc('kb_os', { [OS_ID]: {
    id: OS_ID, num: '9001', titulo: 'E2E_FASEF_20260805_Cliente — Caixa', cliente: 'E2E_FASEF_20260805_Cliente',
    status: 'aguardando_saldo', material: 'MDF 6mm', medidas: '30×20cm', qty: 1, prazo: '10/08/2026', entrega: '10/08/2026',
    checks: ['Corte', 'Acabamento', 'Embalagem'], prog: 0, pronto: false,
  } });
  await mergeDoc('kb_os_fin', { [OS_ID]: { valor: 1234.56, totalGeral: 1234.56, valorEntrada: 617.28, restante: 617.28, formaPgto: 'PIX', pagtoTipo: '50-50' } });
}
async function cleanupOS() {
  var refOS = db.collection('erp_vr').doc('kb_os'), refFin = db.collection('erp_vr').doc('kb_os_fin');
  var [snapOS, snapFin] = await Promise.all([refOS.get(), refFin.get()]);
  if (snapOS.exists) { var d1 = JSON.parse(snapOS.data().data); delete d1[OS_ID]; await refOS.set({ data: JSON.stringify(d1), ts: Date.now() }); }
  if (snapFin.exists) { var d2 = JSON.parse(snapFin.data().data); delete d2[OS_ID]; await refFin.set({ data: JSON.stringify(d2), ts: Date.now() }); }
}

function fieldsOf(bodyStr) {
  try { var j = JSON.parse(bodyStr); return j.fields || {}; } catch (e) { return {}; }
}

console.log('\n=== RODADA 2.1 (CRÍTICO) — kb_os_fin: prova real via Auth Emulator + Rules, não Admin SDK ===\n');

(async function main() {
  await ensureFixtureUsers();
  await seedOS();
  var tokProducao = await signIn(FIX.producao.email, PASSWORD);
  var tokMaster = await signIn(FIX.master.email, PASSWORD);
  var tokComercial = await signIn(FIX.comercial.email, PASSWORD);
  var tokFinanceiro = await signIn(FIX.financeiro.email, PASSWORD);

  await test('1. Produção lendo "kb_os_fin" (financeiro) diretamente pelo SDK cliente → NEGADO (403)', async function () {
    var r = await firestoreRead(tokProducao, 'kb_os_fin');
    assertEq(r.status, 403, 'Rules devem recusar — nunca "200 mas o app esconde na tela"');
  });

  await test('2. Produção sem NENHUM token (não autenticado) lendo "kb_os_fin" → NEGADO (403, nunca 200)', async function () {
    var r = await firestoreRead(null, 'kb_os_fin');
    assertEq(r.status, 403);
  });

  await test('3. Produção escrevendo "kb_os_fin" diretamente → NEGADO (mesmo tentando plantar dado financeiro)', async function () {
    var r = await firestoreWrite(tokProducao, 'kb_os_fin', { hack_valor: 1 });
    assertEq(r.status, 403);
  });

  await test('4. Master lendo "kb_os_fin" → PERMITIDO e o payload contém o financeiro real (não é só "não bloqueado")', async function () {
    var r = await firestoreRead(tokMaster, 'kb_os_fin');
    assertEq(r.status, 200, 'Master precisa continuar recebendo o financeiro');
    var fields = fieldsOf(r.body);
    assertTruthy(fields.data && fields.data.stringValue && fields.data.stringValue.indexOf('"valorEntrada":617.28') >= 0, 'payload realmente contém o valor de entrada, não um documento vazio');
  });

  await test('5. Financeiro lendo "kb_os_fin" → PERMITIDO com o financeiro real', async function () {
    var r = await firestoreRead(tokFinanceiro, 'kb_os_fin');
    assertEq(r.status, 200);
    var fields = fieldsOf(r.body);
    assertTruthy(fields.data && fields.data.stringValue.indexOf('"restante":617.28') >= 0);
  });

  await test('6. Comercial lendo "kb_os_fin" → PERMITIDO com o financeiro real (RBAC do vendedor)', async function () {
    var r = await firestoreRead(tokComercial, 'kb_os_fin');
    assertEq(r.status, 200);
    var fields = fieldsOf(r.body);
    assertTruthy(fields.data && fields.data.stringValue.indexOf('"formaPgto":"PIX"') >= 0);
  });

  await test('7. Produção lendo "kb_os" (operacional) → PERMITIDO, e o payload NUNCA contém campos financeiros (nem por engano)', async function () {
    var r = await firestoreRead(tokProducao, 'kb_os');
    assertEq(r.status, 200, 'Produção precisa continuar conseguindo trabalhar no Kanban');
    var fields = fieldsOf(r.body);
    var dataStr = (fields.data && fields.data.stringValue) || '';
    assertTruthy(dataStr.indexOf('"material":"MDF 6mm"') >= 0, 'dado operacional (material) presente');
    assertTruthy(dataStr.indexOf('"medidas":"30') >= 0, 'dado operacional (medidas) presente');
    ['valorEntrada', 'restante', 'formaPgto', 'pagtoTipo', 'valor"', 'totalGeral'].forEach(function (campo) {
      assertFalsy(dataStr.indexOf('"' + campo) >= 0, 'campo financeiro "' + campo + '" NUNCA deve aparecer em kb_os — payload: ' + dataStr.slice(0, 300));
    });
  });

  // Nota: não testamos aqui "Produção escrevendo em kb_os" via REST direto
  // — 'kb_os' é um documento-agregado ÚNICO compartilhado por toda a
  // instância do emulador (todas as OS), e um PATCH REST sem updateMask
  // SUBSTITUI o documento inteiro, o que destruiria dados reais usados por
  // outras suítes (test_producao_autorizacao_server.js etc.) rodando no
  // mesmo emulador de longa duração desta sessão. A permissão de escrita
  // de Produção em 'kb_os' já é exercida de ponta a ponta, sem risco,
  // pelas Cloud Functions reais em test_producao_autorizacao_server.js
  // (29/29) — o que faltava provar aqui era só a NEGAÇÃO de kb_os_fin
  // (testes 1-3) e a ausência de financeiro em kb_os (teste 7), que são
  // as garantias novas do P0.6.

  await cleanupOS(); // nunca deixa a OS de teste residente nos documentos compartilhados

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
