/**
 * test_hist_financeiro_rules_2026-08-08.js
 *
 * RODADA 3 — seção 37 (RBAC): prova real via Auth Emulator + REST do
 * Firestore (não Admin SDK) de que a camada histórica financeira
 * (hist_mensal etc., ver import_historico_financeiro.js) segue a mesma
 * regra de privacidade já provada para kb_os_fin — Produção nunca recebe
 * acesso, mesmo por acidente, a um documento financeiro novo.
 *
 * Mesmo padrão de test_kb_os_fin_rules_2026-08-08.js.
 *
 * Uso: node scripts/test_hist_financeiro_rules_2026-08-08.js
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

const { USUARIOS, SENHA_PADRAO } = require('./e2e_clean_env');
var FIX = {};
USUARIOS.forEach((u) => { FIX[u.name] = { email: u.email, role: u.role }; });

console.log('\n=== RODADA 3 — hist_mensal (histórico financeiro): Produção negado, Financeiro/Master permitidos (Rules reais) ===\n');

(async function main() {
  // garante o documento existir para diferenciar "403 por Rules" de "404 por não existir"
  var ref = db.collection('erp_vr').doc('hist_mensal');
  var snap = await ref.get();
  if (!snap.exists) await ref.set({ data: JSON.stringify({}), ts: Date.now() });

  var tokProducao = await signIn(FIX.producao.email, SENHA_PADRAO);
  var tokMaster = await signIn(FIX.master.email, SENHA_PADRAO);
  var tokFinanceiro = await signIn(FIX.financeiro.email, SENHA_PADRAO);
  var tokComercial = await signIn(FIX.comercial.email, SENHA_PADRAO);

  await test('1. Produção lendo hist_mensal → NEGADO (403)', async function () {
    var r = await firestoreRead(tokProducao, 'hist_mensal');
    assertEq(r.status, 403);
  });

  await test('2. Comercial lendo hist_mensal → NEGADO (403) — decisão desta rodada, não presumida', async function () {
    var r = await firestoreRead(tokComercial, 'hist_mensal');
    assertEq(r.status, 403);
  });

  await test('3. Master lendo hist_mensal → PERMITIDO (200)', async function () {
    var r = await firestoreRead(tokMaster, 'hist_mensal');
    assertEq(r.status, 200);
  });

  await test('4. Financeiro lendo hist_mensal → PERMITIDO (200)', async function () {
    var r = await firestoreRead(tokFinanceiro, 'hist_mensal');
    assertEq(r.status, 200);
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
