/**
 * test_financeiro_novas_colecoes_rules_2026-08-08.js
 *
 * RODADA 4 — seção 25 (segurança/Rules): prova real via Auth Emulator +
 * REST do Firestore de que as novas coleções financeiras (despesas
 * recorrentes, cartões, compras de cartão, faturas) seguem a mesma regra
 * de privacidade das demais: Produção nunca acessa, Master/Financeiro
 * permitidos, Comercial negado (mesmo grupo de fin_cp/fin_tx).
 *
 * Uso: node scripts/test_financeiro_novas_colecoes_rules_2026-08-08.js
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

var DOCS = ['fin_cp_recorrencias', 'fin_cartoes', 'fin_cartao_compras', 'fin_faturas', 'fin_caixa_ajustes'];

console.log('\n=== RODADA 4 — novas coleções financeiras: Rules reais (Produção negado, Master/Financeiro permitidos) ===\n');

(async function main() {
  for (var i = 0; i < DOCS.length; i++) {
    var ref = db.collection('erp_vr').doc(DOCS[i]);
    var snap = await ref.get();
    if (!snap.exists) await ref.set({ data: JSON.stringify([]), ts: Date.now() });
  }

  var tokProducao = await signIn(FIX.producao.email, SENHA_PADRAO);
  var tokMaster = await signIn(FIX.master.email, SENHA_PADRAO);
  var tokFinanceiro = await signIn(FIX.financeiro.email, SENHA_PADRAO);
  var tokComercial = await signIn(FIX.comercial.email, SENHA_PADRAO);

  for (var j = 0; j < DOCS.length; j++) {
    var docId = DOCS[j];
    await test(docId + ': Produção → NEGADO (403)', async function () {
      var r = await firestoreRead(tokProducao, docId);
      assertEq(r.status, 403);
    });
    await test(docId + ': Comercial → NEGADO (403)', async function () {
      var r = await firestoreRead(tokComercial, docId);
      assertEq(r.status, 403);
    });
    await test(docId + ': Master → PERMITIDO (200)', async function () {
      var r = await firestoreRead(tokMaster, docId);
      assertEq(r.status, 200);
    });
    await test(docId + ': Financeiro → PERMITIDO (200)', async function () {
      var r = await firestoreRead(tokFinanceiro, docId);
      assertEq(r.status, 200);
    });
  }

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
