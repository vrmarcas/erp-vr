/**
 * test_atendimentos_rules.js
 *
 * Testa as Firestore Rules reais de `atendimentos`/`atendimentos/{id}/mensagens`
 * contra o Firestore Emulator + Auth Emulator, com tokens reais (custom
 * claims via setCustomUserClaims, mesmo fixture de e2e_clean_env.js) — não
 * mocka nada, faz requisições REST reais que passam pelo motor de Rules.
 *
 * Uso: node scripts/test_atendimentos_rules.js
 * (requer emulators:start --only firestore,auth já rodando, e
 *  e2e_clean_env.js reset já executado)
 */
'use strict';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { UID, USUARIOS, SENHA_PADRAO, PROJECT_ID } = require('./e2e_shared_fixtures');

const AUTH_EMULATOR = 'http://localhost:9099';
const FIRESTORE_EMULATOR = 'http://localhost:8080';
const API_KEY = 'fake-api-key'; // Auth Emulator não valida a API key

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { if (got !== exp) throw new Error((msg || 'valores diferentes') + ' — esperado ' + exp + ', obtido ' + got); }

async function idTokenPara(email) {
  const res = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: SENHA_PADRAO, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error('Falha ao logar ' + email + ': ' + JSON.stringify(json));
  return json.idToken;
}

async function firestoreGet(pathDoc, idToken) {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${pathDoc}`;
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, { headers });
  return res.status;
}

async function firestorePatch(pathDoc, idToken, fields) {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${pathDoc}`;
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields: fields || {} }) });
  return res.status;
}

console.log('\n=== Atendimentos — Firestore Rules reais (Emulator + Auth) ===\n');

(async function main() {
  const testId = 'E2E_RULES_ATD_' + Date.now();
  await db.collection('atendimentos').doc(testId).set({ id: testId, nome: 'Teste Rules', isTeste: true, createdAt: Date.now() });
  await db.collection('atendimentos').doc(testId).collection('mensagens').doc('m1').set({ text: 'oi', actorType: 'customer', createdAt: Date.now() });

  const emailMaster = USUARIOS.find((u) => u.role === 'master').email;
  const emailComercial = USUARIOS.find((u) => u.role === 'comercial').email;
  const emailProducao = USUARIOS.find((u) => u.role === 'producao').email;
  const emailFinanceiro = USUARIOS.find((u) => u.role === 'financeiro').email;

  const tokMaster = await idTokenPara(emailMaster);
  const tokComercial = await idTokenPara(emailComercial);
  const tokProducao = await idTokenPara(emailProducao);
  const tokFinanceiro = await idTokenPara(emailFinanceiro);

  await test('1. Master LÊ atendimentos/{id} (200)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}`, tokMaster), 200);
  });
  await test('2. Comercial LÊ atendimentos/{id} (200)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}`, tokComercial), 200);
  });
  await test('3. Produção é NEGADO em atendimentos/{id} (403)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}`, tokProducao), 403);
  });
  await test('4. Financeiro é NEGADO em atendimentos/{id} (403)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}`, tokFinanceiro), 403);
  });
  await test('5. Anônimo (sem token) é NEGADO em atendimentos/{id} (403)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}`, null), 403);
  });
  await test('6. Master é NEGADO ao tentar ESCREVER direto (write:false, só Cloud Functions) — 403', async function () {
    assertEq(await firestorePatch(`atendimentos/${testId}`, tokMaster, { nome: { stringValue: 'hack' } }), 403);
  });
  await test('7. Comercial LÊ a subcoleção mensagens (200)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}/mensagens/m1`, tokComercial), 200);
  });
  await test('8. Produção é NEGADO na subcoleção mensagens (403)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}/mensagens/m1`, tokProducao), 403);
  });
  await test('9. Anônimo é NEGADO na subcoleção mensagens (403)', async function () {
    assertEq(await firestoreGet(`atendimentos/${testId}/mensagens/m1`, null), 403);
  });

  await db.collection('atendimentos').doc(testId).collection('mensagens').doc('m1').delete().catch(() => {});
  await db.collection('atendimentos').doc(testId).delete().catch(() => {});

  console.log('\n' + '='.repeat(60));
  console.log('Resultado: ' + passed + ' passou(aram), ' + failed + ' falhou(aram)');
  console.log('='.repeat(60) + '\n');
  process.exitCode = failed > 0 ? 1 : 0;
})();
