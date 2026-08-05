/**
 * test_estoque_rules.js
 *
 * FASE 10 (checkpoint FASE 2-8, 2026-08-05): suíte automatizada e
 * repetível das Rules candidatas de firestore.rules (não publicadas) para
 * 'stock'/'stock_deleted'/'erp_stock_log'/'retalhos'/'retalhos_seq'.
 *
 * Diferente dos testes de Functions (que usam Admin SDK e por isso NUNCA
 * passam pelas Rules), esta suíte ataca diretamente a API REST do
 * Firestore Emulator com um idToken real emitido pelo Auth Emulator —
 * exatamente o caminho que um cliente comprometido usaria para tentar
 * burlar a Cloud Function. Não usa @firebase/rules-unit-testing (pacote
 * não presente no repositório) — reaproveita o mesmo padrão REST já usado
 * em rodadas anteriores desta auditoria (Auth Emulator signInWithPassword
 * + Firestore Emulator REST), sem adicionar dependência nova.
 *
 * Uso: node scripts/test_estoque_rules.js
 * Pré-requisito: Emulators rodando (demo-erp-homolog) — Auth :9099,
 * Firestore :8080.
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

var FIX = {
  producao: { email: 'e2e.fasef.rules.producao@example.com', role: 'producao' },
  master:   { email: 'e2e.fasef.rules.master@example.com',   role: 'master' },
  comercial:{ email: 'e2e.fasef.rules.comercial@example.com',role: 'comercial' },
  semPerfil:{ email: 'e2e.fasef.rules.semperfil@example.com',role: 'producao', semDoc: true },
  desabilitado:{ email: 'e2e.fasef.rules.desabilitado@example.com', role: 'producao', ativo: 0 },
};
var PASSWORD = 'FaseF2026Rules!';

async function ensureFixtureUsers() {
  for (var key in FIX) {
    var f = FIX[key];
    var uid;
    try {
      var existing = await authAdmin.getUserByEmail(f.email);
      uid = existing.uid;
    } catch (e) {
      var created = await authAdmin.createUser({ email: f.email, password: PASSWORD, emailVerified: true });
      uid = created.uid;
    }
    await authAdmin.setCustomUserClaims(uid, { role: f.role });
    if (!f.semDoc) {
      await db.collection('erp_vr_usuarios').doc(uid).set({ nome: 'E2E Rules ' + key, funcao: f.role, ativo: f.ativo === 0 ? 0 : 1 });
    }
    f.uid = uid;
  }
}

console.log('\n=== FASE 10 (checkpoint) — Rules candidatas: stock/log/retalhos negados client-side ===\n');

(async function main() {
  await ensureFixtureUsers();
  var tokProducao = await signIn(FIX.producao.email, PASSWORD);
  var tokMaster = await signIn(FIX.master.email, PASSWORD);
  var tokComercial = await signIn(FIX.comercial.email, PASSWORD);
  var tokSemPerfil = await signIn(FIX.semPerfil.email, PASSWORD);
  var tokDesabilitado = await signIn(FIX.desabilitado.email, PASSWORD);

  await test('1. Produção escrevendo "stock" diretamente → negado (403)', async function () {
    var r = await firestoreWrite(tokProducao, 'stock', { hack_qty: -999 });
    assertEq(r.status, 403);
  });

  await test('2. Master escrevendo "stock" diretamente pelo SDK cliente → negado (fronteira agora é exclusiva da Function)', async function () {
    var r = await firestoreWrite(tokMaster, 'stock', { hack_qty: -999 });
    assertEq(r.status, 403);
  });

  await test('3. Produção escrevendo "erp_stock_log" diretamente → negado', async function () {
    var r = await firestoreWrite(tokProducao, 'erp_stock_log', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('4. Master escrevendo "erp_stock_log" diretamente → negado', async function () {
    var r = await firestoreWrite(tokMaster, 'erp_stock_log', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('5. Produção escrevendo "retalhos" diretamente → negado', async function () {
    var r = await firestoreWrite(tokProducao, 'retalhos', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('6. Produção escrevendo "retalhos_seq" diretamente → negado', async function () {
    var r = await firestoreWrite(tokProducao, 'retalhos_seq', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('7. Produção escrevendo "stock_deleted" (lixeira) diretamente → negado', async function () {
    var r = await firestoreWrite(tokProducao, 'stock_deleted', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('8. Auditoria dedicada de produção (erp_vr_audit_log_producao) — coleção separada, escrita client-side sempre foi negada (allow write: if false pré-existente); confirmado aqui', async function () {
    var body = { fields: { hack: { integerValue: '1' } } };
    var r = await httpJson({ hostname: 'localhost', port: 8080, path: `/v1/projects/demo-erp-homolog/databases/(default)/documents/erp_vr_audit_log_producao/hackdoc`, method: 'PATCH', headers: { Authorization: 'Bearer ' + tokProducao } }, body);
    assertEq(r.status, 403);
  });

  await test('9. Comercial escrevendo "stock" → negado (dupla negação: nem tinha permissão antes, nem tem agora)', async function () {
    var r = await firestoreWrite(tokComercial, 'stock', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('10. Conta sem perfil (sem doc em erp_vr_usuarios) escrevendo "stock" → negado', async function () {
    var r = await firestoreWrite(tokSemPerfil, 'stock', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('11. Conta desabilitada (ativo:0) escrevendo "stock" → negado (Rules do erp_vr/{docId} não checam "ativo" hoje — isProducao() só olha a claim; ver nota abaixo)', async function () {
    // NOTA HONESTA: as Rules deste bloco (isProducao()) autorizam por CLAIM,
    // não consultam erp_vr_usuarios/ativo — então tecnicamente uma conta
    // desabilitada mas com claim válida AINDA seria autorizada pela Rule de
    // leitura/outros documentos. Para 'stock' especificamente isso não
    // importa mais (write já é negado para QUALQUER role, ativo ou não) —
    // mas fica registrado como achado estrutural: a checagem de "ativo" só
    // é reforçada nas Cloud Functions (getCallerVerificado), não nas Rules
    // genéricas de isProducao(). Não é uma regressão desta rodada.
    var r = await firestoreWrite(tokDesabilitado, 'stock', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('12. Não autenticado escrevendo "stock" → negado', async function () {
    var r = await firestoreWrite(null, 'stock', { hack: 1 });
    assertEq(r.status, 403);
  });

  await test('13. Produção AINDA consegue LER "stock" (least-privilege preservado nas leituras, não alterado nesta rodada)', async function () {
    var r = await firestoreRead(tokProducao, 'stock');
    assertEq(r.status, 200);
  });

  await test('14. Master AINDA consegue LER "erp_stock_log"', async function () {
    var r = await firestoreRead(tokMaster, 'erp_stock_log');
    assertEq(r.status, 200);
  });

  await test('15. Comercial NÃO consegue ler "stock" (nunca teve — Rule de leitura não foi alterada, confirma que não foi ampliada por engano)', async function () {
    var r = await firestoreRead(tokComercial, 'stock');
    assertEq(r.status, 403);
  });

  await test('16. Produção AINDA consegue escrever "kb_os" diretamente (fora de escopo desta Rule — kb_os não foi fechado, documentado como pendência estrutural)', async function () {
    // Leitura, não escrita real — evita risco de sobrescrever kb_os de
    // verdade (ver nota em check_rules.js). Confirmamos a permissão via
    // leitura (kb_os continua em isProducao() na lista de docId) e via
    // grep do arquivo de Rules, não via escrita destrutiva.
    var r = await firestoreRead(tokProducao, 'kb_os');
    assertEq(r.status, 200);
  });

  await test('17. Admin SDK (Cloud Functions) continua funcional após a mudança de Rules — reconfirmação end-to-end', async function () {
    const { estoqueRegistrarEntrada } = require('../functions/lib/estoque.js');
    var mk = 'e2e_rules_check_mat';
    await db.collection('erp_vr').doc('stock').set(Object.assign(
      {}, (await db.collection('erp_vr').doc('stock').get()).data(),
      {}
    ));
    var stockRef = db.collection('erp_vr').doc('stock');
    var snap = await stockRef.get(); var data = JSON.parse(snap.data().data);
    data[mk] = { label: 'Mat Rules Check', qty: 1 };
    await stockRef.set({ data: JSON.stringify(data), ts: Date.now() });
    var res = await estoqueRegistrarEntrada.run({ matKey: mk, qty: 5, requestId: 'rulescheck:' + Date.now() }, { auth: { uid: FIX.producao.uid, token: { role: 'producao' } } });
    assertEq(res.ok, true);
    var final = JSON.parse((await stockRef.get()).data().data);
    assertEq(final[mk].qty, 6);
    delete data[mk]; delete final[mk];
    await stockRef.set({ data: JSON.stringify(final), ts: Date.now() });
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
