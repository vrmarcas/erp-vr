/**
 * test_vitre_rules.js
 *
 * FASE G — B11: suíte de Firestore Rules para o bloco vitre_* (produtos,
 * histórico, importações, orçamentos, chaves de idempotência, audit log)
 * adicionado a firestore.rules nesta rodada. Mesmo padrão real de
 * scripts/test_estoque_rules.js — ataca a API REST do Firestore Emulator
 * com idToken real emitido pelo Auth Emulator (nunca @firebase/
 * rules-unit-testing, que não está no repositório), validando exatamente
 * o caminho que um cliente comprometido usaria para tentar burlar as
 * Cloud Functions de vitre.ts.
 *
 * Uso: node scripts/test_vitre_rules.js
 * Pré-requisito: Emulators rodando (demo-erp-homolog) — Auth :9099, Firestore :8080.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
const http = require('http');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
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
function fsWrite(idToken, collection, docId, fields) {
  const body = { fields: {} };
  Object.keys(fields).forEach((k) => { body.fields[k] = typeof fields[k] === 'number' ? { integerValue: String(fields[k]) } : { stringValue: String(fields[k]) }; });
  return httpJson({ hostname: 'localhost', port: 8080, path: `/v1/projects/demo-erp-homolog/databases/(default)/documents/${collection}/${docId}`, method: 'PATCH', headers: idToken ? { Authorization: 'Bearer ' + idToken } : {} }, body);
}
function fsRead(idToken, collection, docId) {
  return httpJson({ hostname: 'localhost', port: 8080, path: `/v1/projects/demo-erp-homolog/databases/(default)/documents/${collection}/${docId}`, method: 'GET', headers: idToken ? { Authorization: 'Bearer ' + idToken } : {} });
}

const { USUARIOS, SENHA_PADRAO } = require('./e2e_clean_env');
var FIX = {};
USUARIOS.forEach((u) => { FIX[u.name] = { email: u.email, role: u.role, uid: u.uid }; });
var PASSWORD = SENHA_PADRAO;

console.log('\n=== FASE G B11 — Rules do Catálogo Vitre (vitre_*): leitura por perfil, escrita sempre negada ao cliente ===\n');

(async function main() {
  // Auto-contido — nunca depende do catálogo real já importado (este
  // arquivo é executado tanto isoladamente quanto dentro de
  // e2e_run_all_tests.js, que só reseta+semeia os 8 usuários base, sem
  // importar a planilha Vitre). Doc mínimo gravado via Admin SDK
  // (bypassa Rules de propósito — é só fixture, não teste de escrita).
  var admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
  await admin.firestore().collection('vitre_produtos').doc('AA001').set({ sku: 'AA001', nome: 'Fixture Rules Test', status: 'ativo', precoVenda: 1 }, { merge: true });

  var tokMaster = await signIn(FIX.master.email, PASSWORD);
  var tokComercial = await signIn(FIX.comercial.email, PASSWORD);
  var tokProducao = await signIn(FIX.producao.email, PASSWORD);
  var tokFinanceiro = await signIn(FIX.financeiro.email, PASSWORD);

  // ── vitre_produtos: leitura para qualquer staff; escrita sempre negada ──
  await test('1. Master lê vitre_produtos → permitido', async function () {
    var r = await fsRead(tokMaster, 'vitre_produtos', 'AA001');
    assertEq(r.status, 200);
  });
  await test('2. Comercial lê vitre_produtos → permitido (consulta p/ orçamento)', async function () {
    var r = await fsRead(tokComercial, 'vitre_produtos', 'AA001');
    assertEq(r.status, 200);
  });
  await test('3. Produção lê vitre_produtos → permitido (consulta ficha técnica)', async function () {
    var r = await fsRead(tokProducao, 'vitre_produtos', 'AA001');
    assertEq(r.status, 200);
  });
  await test('4. Financeiro lê vitre_produtos → permitido (isAnyStaff)', async function () {
    var r = await fsRead(tokFinanceiro, 'vitre_produtos', 'AA001');
    assertEq(r.status, 200);
  });
  await test('5. Não autenticado lê vitre_produtos → negado', async function () {
    var r = await fsRead(null, 'vitre_produtos', 'AA001');
    assertEq(r.status, 403);
  });
  await test('6. Master escreve vitre_produtos diretamente (tentando forjar preço) → negado — só a Cloud Function grava', async function () {
    var r = await fsWrite(tokMaster, 'vitre_produtos', 'AA001', { precoVenda: 1 });
    assertEq(r.status, 403);
  });
  await test('7. Comercial escreve vitre_produtos diretamente → negado', async function () {
    var r = await fsWrite(tokComercial, 'vitre_produtos', 'HACK001', { precoVenda: 999999 });
    assertEq(r.status, 403);
  });
  await test('8. Produção escreve vitre_produtos diretamente (tentando burlar o bloqueio de campo comercial da Function) → negado', async function () {
    var r = await fsWrite(tokProducao, 'vitre_produtos', 'AA001', { precoVenda: 1 });
    assertEq(r.status, 403);
  });

  // ── vitre_orcamentos: leitura só Comercial/Financeiro (inclui Master); escrita sempre negada ──
  await test('9. Master lê vitre_orcamentos → permitido (isComercial() inclui master)', async function () {
    var r = await fsRead(tokMaster, 'vitre_orcamentos', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida (200 ou 404 p/ doc inexistente), obtido ' + r.status); // 404 = Rules permitiram, doc só não existe; 403 = Rules negaram
  });
  await test('10. Comercial lê vitre_orcamentos → permitido', async function () {
    var r = await fsRead(tokComercial, 'vitre_orcamentos', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida, obtido ' + r.status);
  });
  await test('11. Financeiro lê vitre_orcamentos → permitido (conciliação)', async function () {
    var r = await fsRead(tokFinanceiro, 'vitre_orcamentos', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida, obtido ' + r.status);
  });
  await test('12. Produção lê vitre_orcamentos → negado (não participa do orçamento comercial)', async function () {
    var r = await fsRead(tokProducao, 'vitre_orcamentos', 'inexistente');
    assertEq(r.status, 403);
  });
  await test('13. Não autenticado lê vitre_orcamentos → negado', async function () {
    var r = await fsRead(null, 'vitre_orcamentos', 'inexistente');
    assertEq(r.status, 403);
  });
  await test('14. Comercial escreve vitre_orcamentos diretamente (tentando forjar total) → negado — só vitreCriarOrcamento/vitreAtualizarOrcamento gravam', async function () {
    var r = await fsWrite(tokComercial, 'vitre_orcamentos', 'HACKORC', { total: 1 });
    assertEq(r.status, 403);
  });
  await test('15. Master escreve vitre_orcamentos diretamente → negado', async function () {
    var r = await fsWrite(tokMaster, 'vitre_orcamentos', 'HACKORC2', { total: 1 });
    assertEq(r.status, 403);
  });

  // ── vitre_importacoes: leitura master-only (só quem importa) ──
  await test('16. Master lê vitre_importacoes → permitido', async function () {
    var r = await fsRead(tokMaster, 'vitre_importacoes', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida, obtido ' + r.status);
  });
  await test('17. Comercial lê vitre_importacoes → negado', async function () {
    var r = await fsRead(tokComercial, 'vitre_importacoes', 'inexistente');
    assertEq(r.status, 403);
  });
  await test('18. Produção lê vitre_importacoes → negado', async function () {
    var r = await fsRead(tokProducao, 'vitre_importacoes', 'inexistente');
    assertEq(r.status, 403);
  });

  // ── vitre_idem_keys: uso interno exclusivo das Cloud Functions — negado a TODOS, inclusive Master ──
  await test('19. Master lê vitre_idem_keys → negado (uso interno exclusivo da Function)', async function () {
    var r = await fsRead(tokMaster, 'vitre_idem_keys', 'crud:algum');
    assertEq(r.status, 403);
  });
  await test('20. Master escreve vitre_idem_keys diretamente (tentando forjar idempotência) → negado', async function () {
    var r = await fsWrite(tokMaster, 'vitre_idem_keys', 'crud:hack', { ts: 1 });
    assertEq(r.status, 403);
  });

  // ── vitre_audit_log: leitura master-only; escrita sempre negada (só Admin SDK) ──
  await test('21. Master lê vitre_audit_log → permitido', async function () {
    var r = await fsRead(tokMaster, 'vitre_audit_log', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida, obtido ' + r.status);
  });
  await test('22. Comercial lê vitre_audit_log → negado', async function () {
    var r = await fsRead(tokComercial, 'vitre_audit_log', 'inexistente');
    assertEq(r.status, 403);
  });
  await test('23. Master escreve vitre_audit_log diretamente (tentando apagar rastro) → negado', async function () {
    var r = await fsWrite(tokMaster, 'vitre_audit_log', 'HACKLOG', { action: 'forjado' });
    assertEq(r.status, 403);
  });

  // ── vitre_os (Parte 9 da homologação, 2026-08-06): Comercial/Produção/
  // Financeiro leem (Produção precisa ver a OS resultante, mesmo sem ler
  // o orçamento comercial de origem); escrita sempre negada — só
  // vitreConverterOrcamentoParaOS grava ──
  await test('24. Master lê vitre_os → permitido', async function () {
    var r = await fsRead(tokMaster, 'vitre_os', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida, obtido ' + r.status);
  });
  await test('25. Comercial lê vitre_os → permitido', async function () {
    var r = await fsRead(tokComercial, 'vitre_os', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida, obtido ' + r.status);
  });
  await test('26. Produção lê vitre_os → permitido (mesmo sem ler o orçamento de origem)', async function () {
    var r = await fsRead(tokProducao, 'vitre_os', 'inexistente');
    assertEq(r.status !== 403, true, 'esperado leitura permitida, obtido ' + r.status);
  });
  await test('27. Não autenticado lê vitre_os → negado', async function () {
    var r = await fsRead(null, 'vitre_os', 'inexistente');
    assertEq(r.status, 403);
  });
  await test('28. Master escreve vitre_os diretamente (tentando forjar OS pronta_expedicao sem passar pela Function) → negado', async function () {
    var r = await fsWrite(tokMaster, 'vitre_os', 'HACKOS', { status: 'pronta_expedicao' });
    assertEq(r.status, 403);
  });

  console.log('\n=== resultado ===\npassed=' + passed + ' failed=' + failed + '\n');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Erro fatal:', e); process.exit(1); });
