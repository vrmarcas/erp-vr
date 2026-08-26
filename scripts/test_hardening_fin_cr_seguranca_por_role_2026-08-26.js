/**
 * test_hardening_fin_cr_seguranca_por_role_2026-08-26.js
 *
 * HARDENING DE CONFIDENCIALIDADE FINANCEIRA — fin_cr.
 *
 * Prova real (via Auth Emulator + REST do Firestore, mesmo padrão já usado
 * por test_financeiro_novas_colecoes_rules_2026-08-08.js / test_estoque_rules.js)
 * de que o perfil Comercial NÃO consegue mais ler nem escrever o documento
 * completo erp_vr/fin_cr — só Master/Financeiro têm essa Rule.
 *
 * ETAPA 2 do enunciado (provar o vazamento): rodado ANTES da correção das
 * Rules, este arquivo falha exatamente nos casos "Comercial → NEGADO" (a
 * leitura/escrita retorna 200, não 403) — essa falha É a prova concreta do
 * vazamento, capturada em texto no relatório final, sem expor nenhum dado
 * real (fixture isolado no Emulator, nunca produção).
 *
 * ETAPA 13/14 do enunciado (teste de segurança por role, permanente): rodado
 * DEPOIS da correção, todos os casos passam — vira regressão permanente.
 *
 * Uso: node scripts/test_hardening_fin_cr_seguranca_por_role_2026-08-26.js
 * Pré-requisito: Auth Emulator :9099, Firestore Emulator :8080.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
const http = require('http');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { if (got !== exp) throw new Error((msg || 'valores diferentes') + ' — esperado ' + exp + ', obtido ' + got); }

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
function firestoreRead(idToken, docId) {
  return httpJson({ hostname: 'localhost', port: 8080, path: `/v1/projects/demo-erp-homolog/databases/(default)/documents/erp_vr/${docId}`, method: 'GET', headers: idToken ? { Authorization: 'Bearer ' + idToken } : {} });
}
function firestoreWrite(idToken, docId, fields) {
  var body = { fields: {} };
  Object.keys(fields).forEach(function (k) { body.fields[k] = { stringValue: String(fields[k]) }; });
  var mask = Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  return httpJson({ hostname: 'localhost', port: 8080, path: `/v1/projects/demo-erp-homolog/databases/(default)/documents/erp_vr/${docId}?${mask}`, method: 'PATCH', headers: idToken ? { Authorization: 'Bearer ' + idToken } : {} }, body);
}

const { USUARIOS, SENHA_PADRAO } = require('./e2e_clean_env');
var FIX = {};
USUARIOS.forEach((u) => { FIX[u.name] = { email: u.email, role: u.role }; });

console.log('\n=== HARDENING fin_cr — segurança por role (Rules reais, Auth+Firestore Emulator) ===\n');

(async function main() {
  var ref = db.collection('erp_vr').doc('fin_cr');
  var snap = await ref.get();
  if (!snap.exists) {
    // Fixture mínimo, só para o doc existir — nenhum dado real, nunca usado
    // como base de comparação financeira (esse é o papel do snapshot de
    // produção, feito à parte, fora do Emulator).
    await ref.set({ data: JSON.stringify([{ id: 'cr_fixture_teste', cliente: '[TESTE] fixture', valor: 1, status: 'pendente' }]), ts: Date.now() });
  }

  var tokMaster = await signIn(FIX.master.email, SENHA_PADRAO);
  var tokFinanceiro = await signIn(FIX.financeiro.email, SENHA_PADRAO);
  var tokComercial = await signIn(FIX.comercial.email, SENHA_PADRAO);
  var tokProducao = await signIn(FIX.producao.email, SENHA_PADRAO);

  await test('1. Comercial → LEITURA de fin_cr NEGADA (403) — achado central desta rodada', async function () {
    var r = await firestoreRead(tokComercial, 'fin_cr');
    assertEq(r.status, 403, 'GET erp_vr/fin_cr como Comercial deveria ser 403');
  });
  await test('2. Comercial → ESCRITA em fin_cr NEGADA (403)', async function () {
    var r = await firestoreWrite(tokComercial, 'fin_cr', { hack: 'x' });
    assertEq(r.status, 403, 'PATCH erp_vr/fin_cr como Comercial deveria ser 403');
  });
  await test('3. Produção → LEITURA de fin_cr NEGADA (403) — nunca teve acesso, continua negado', async function () {
    var r = await firestoreRead(tokProducao, 'fin_cr');
    assertEq(r.status, 403);
  });
  await test('4. Produção → ESCRITA em fin_cr NEGADA (403)', async function () {
    var r = await firestoreWrite(tokProducao, 'fin_cr', { hack: 'x' });
    assertEq(r.status, 403);
  });
  await test('5. Financeiro → LEITURA de fin_cr PERMITIDA (200) — nenhuma regressão', async function () {
    var r = await firestoreRead(tokFinanceiro, 'fin_cr');
    assertEq(r.status, 200);
  });
  await test('6. Financeiro → ESCRITA em fin_cr PERMITIDA (200) — nenhuma regressão (tela Contas a Receber continua funcionando)', async function () {
    var r = await firestoreWrite(tokFinanceiro, 'fin_cr', { ts: String(Date.now()) });
    assertEq(r.status, 200);
  });
  await test('7. Master → LEITURA de fin_cr PERMITIDA (200) — nenhuma regressão', async function () {
    var r = await firestoreRead(tokMaster, 'fin_cr');
    assertEq(r.status, 200);
  });
  await test('8. Master → ESCRITA em fin_cr PERMITIDA (200) — nenhuma regressão', async function () {
    var r = await firestoreWrite(tokMaster, 'fin_cr', { ts: String(Date.now()) });
    assertEq(r.status, 200);
  });
  await test('9. Sem autenticação → LEITURA de fin_cr NEGADA (403 ou 401)', async function () {
    var r = await firestoreRead(null, 'fin_cr');
    assertEq(r.status === 403 || r.status === 401, true, 'esperado 401 ou 403, obtido ' + r.status);
  });

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})();
