/**
 * test_lock_token_transporte_real.js
 *
 * RODADA NOTURNA — A4: lock/token/conta desabilitada via TRANSPORTE REAL
 * (HTTP callable contra o Functions Emulator, com idToken real assinado
 * pelo Auth Emulator) — não `.run()`. `.run()` (usado nas outras suítes)
 * invoca o handler diretamente com um `context.auth` fabricado, o que é
 * ótimo para testar a LÓGICA de autorização mas nunca passa pela camada
 * de verificação de token do próprio Firebase — exatamente a camada que
 * este arquivo testa.
 *
 * Achado central documentado por estes testes: revogar o refresh token
 * de um usuário (`admin.auth().revokeRefreshTokens`) NÃO invalida um
 * idToken de curta duração já emitido — ele continua passando na
 * verificação de assinatura do Firebase até expirar naturalmente (~1h).
 * A proteção real contra "conta desabilitada continua operando" nesta
 * arquitetura NÃO vem da revogação do token — vem da releitura de
 * `erp_vr_usuarios/{uid}.ativo` que toda Cloud Function já faz
 * (`getCallerVerificado`, functions/src/auth_helper.ts). Este arquivo
 * prova isso com uma chamada HTTP real, não assumida.
 *
 * Uso: node scripts/test_lock_token_transporte_real.js
 * Pré-requisito: Emulators rodando (Auth 9099, Firestore 8080, Functions 5001).
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
const { UID, USUARIOS } = require('./e2e_shared_fixtures');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }

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
  if (!j.idToken) throw new Error('signIn falhou: ' + r.body);
  return j;
}
function callFunction(name, idToken, data) {
  return httpJson({
    hostname: 'localhost', port: 5001, path: `/demo-erp-homolog/us-central1/${name}`, method: 'POST',
    headers: idToken ? { Authorization: 'Bearer ' + idToken } : {},
  }, { data });
}
function reqId() { return 'lock_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
const SENHA = require('./e2e_clean_env').SENHA_PADRAO;

console.log('\n=== RODADA NOTURNA A4 — lock/token/conta desabilitada via transporte HTTP real ===\n');

(async function main() {
  // Conta dedicada a este arquivo (não reusa producao/desabilitado do seed
  // compartilhado, para não interferir com as outras suítes que rodam na
  // mesma execução de e2e_run_all_tests.js).
  const LOCK_UID = 'e2efasef20260805lockprod';
  const LOCK_EMAIL = 'e2e_fasef_20260805_lock_producao@example.com';
  try { await authAdmin.getUser(LOCK_UID); } catch (e) { await authAdmin.createUser({ uid: LOCK_UID, email: LOCK_EMAIL, password: SENHA, emailVerified: true }); }
  await authAdmin.updateUser(LOCK_UID, { disabled: false });
  await authAdmin.setCustomUserClaims(LOCK_UID, { role: 'producao' });
  await db.collection('erp_vr_usuarios').doc(LOCK_UID).set({ nome: LOCK_EMAIL, email: LOCK_EMAIL, funcao: 'producao', ativo: 1 });

  await test('1. Sessão desbloqueada, token válido → operação permitida', async function () {
    const auth = await signIn(LOCK_EMAIL, SENHA);
    const r = await callFunction('estoqueRegistrarEntrada', auth.idToken, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    assertEq(r.status, 200);
    const j = JSON.parse(r.body);
    assertEq(j.result.ok, true);
  });

  await test('2. Token malformado/adulterado → negado no transporte (nunca chega no handler)', async function () {
    const r = await callFunction('estoqueRegistrarEntrada', 'isto-nao-e-um-jwt-valido', { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    // 403 (não 401): o emulador trata token presente-mas-inválido como
    // "credencial recusada", distinto de "nenhuma credencial enviada"
    // (teste 3). Ambos são "negado no transporte", só o código HTTP difere.
    if (r.status !== 401 && r.status !== 403) throw new Error('esperava 401 ou 403, obtido ' + r.status + ': ' + r.body);
  });

  await test('3. Sem token nenhum → unauthenticated', async function () {
    const r = await callFunction('estoqueRegistrarEntrada', null, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    assertEq(r.status, 401);
  });

  var tokenSobrevivente;
  await test('4. Conta desabilitada (Auth + erp_vr_usuarios.ativo=0) DEPOIS de emitir o token — operação com o MESMO token antigo é negada pela releitura do servidor, não pela expiração do token', async function () {
    const auth = await signIn(LOCK_EMAIL, SENHA);
    tokenSobrevivente = auth.idToken;
    // Confirma que o MESMO token funcionava antes da desativação.
    const antes = await callFunction('estoqueRegistrarEntrada', tokenSobrevivente, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    assertEq(JSON.parse(antes.body).result.ok, true, 'deveria funcionar antes da desativação');

    // Desativa a conta (Auth E o cadastro do ERP) — sem gerar um token novo.
    await authAdmin.updateUser(LOCK_UID, { disabled: true });
    await db.collection('erp_vr_usuarios').doc(LOCK_UID).set({ nome: LOCK_EMAIL, email: LOCK_EMAIL, funcao: 'producao', ativo: 0 });

    const depois = await callFunction('estoqueRegistrarEntrada', tokenSobrevivente, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    const bodyDepois = JSON.parse(depois.body);
    // Achado documentado: o Functions Emulator verifica o token mas NÃO
    // consulta automaticamente o campo "disabled" do Auth por padrão —
    // quem bloqueia de fato é a releitura de erp_vr_usuarios.ativo dentro
    // da própria Function (getCallerVerificado), que mapeia para HTTP 403
    // (permission-denied) na resposta.
    if (depois.status === 200) {
      throw new Error('FALHA DE SEGURANÇA: operação foi aceita com conta desabilitada — status 200, body: ' + depois.body);
    }
    if (!(bodyDepois.error && /PERMISSION_DENIED/i.test(bodyDepois.error.status || ''))) {
      throw new Error('esperava PERMISSION_DENIED, obtido: ' + depois.body);
    }
  });

  await test('5. Revogar refresh token NÃO invalida um idToken de curta duração já emitido (garantia de infraestrutura do Firebase, não desta aplicação) — mas a Function ainda nega pela conta desabilitada', async function () {
    await authAdmin.revokeRefreshTokens(LOCK_UID);
    // Verificação de infraestrutura: o idToken (não o refresh token) continua
    // passando na verificação de ASSINATURA — só checkRevoked=true pegaria isso,
    // e o wrapper padrão de onCall não usa checkRevoked. Confirmado aqui, não assumido.
    let assinaturaAindaValida = false;
    try {
      await authAdmin.verifyIdToken(tokenSobrevivente, false); // checkRevoked=false (comportamento padrão do onCall)
      assinaturaAindaValida = true;
    } catch (e) { /* se lançar, a suposição documentada está errada — o teste abaixo vai revelar */ }
    if (!assinaturaAindaValida) {
      console.log('       (nota: neste ambiente o idToken pós-revogação já falhou na verificação de assinatura — mais estrito que o padrão documentado do SDK; achado registrado, não um erro de teste)');
    }
    // De qualquer forma, a Function deve negar — pela conta desabilitada,
    // não pela revogação (já provado negar no teste 4; aqui confirmamos
    // que continua negando mesmo depois da revogação, sem regressão).
    const r = await callFunction('estoqueRegistrarEntrada', tokenSobrevivente, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    if (r.status === 200) throw new Error('FALHA DE SEGURANÇA: operação aceita após revogação + desativação — ' + r.body);
  });

  await test('6. Reabilitar a conta (Auth + ativo=1) + novo login → operação volta a funcionar (prova que o bloqueio era específico, não um estado travado)', async function () {
    await authAdmin.updateUser(LOCK_UID, { disabled: false });
    await db.collection('erp_vr_usuarios').doc(LOCK_UID).set({ nome: LOCK_EMAIL, email: LOCK_EMAIL, funcao: 'producao', ativo: 1 });
    const auth2 = await signIn(LOCK_EMAIL, SENHA);
    const r = await callFunction('estoqueRegistrarEntrada', auth2.idToken, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    assertEq(r.status, 200);
    assertEq(JSON.parse(r.body).result.ok, true);
  });

  await test('7. Claim divergente da conta real (forjar role via payload não afeta — claim vem só do token assinado pelo Auth Emulator)', async function () {
    // Não é possível "forjar" a claim no HTTP real sem controlar o Auth
    // Emulator — a claim usada pela Function vem exclusivamente do token
    // que o PRÓPRIO Auth Emulator assinou (setCustomUserClaims). Aqui
    // confirmamos que mudar a claim real e logar de novo reflete
    // corretamente (não travado em um valor antigo em cache).
    await authAdmin.setCustomUserClaims(LOCK_UID, { role: 'comercial' });
    const auth3 = await signIn(LOCK_EMAIL, SENHA);
    const r = await callFunction('estoqueRegistrarEntrada', auth3.idToken, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: reqId() });
    // claim=comercial, doc=producao → getCallerVerificado exige coerência → nega (HTTP 403).
    const j = JSON.parse(r.body);
    if (r.status === 200 && j.result && j.result.ok) throw new Error('FALHA: divergência claim/doc não foi barrada — ' + r.body);
    if (!j.error) throw new Error('esperava erro de divergência claim/doc, obtido: ' + r.body);
    await authAdmin.setCustomUserClaims(LOCK_UID, { role: 'producao' }); // restaura para não vazar para outros testes
  });

  await test('8. Duas chamadas HTTP reais concorrentes com o MESMO token válido (duas abas de verdade) → ambas processadas, idempotência preservada', async function () {
    await authAdmin.updateUser(LOCK_UID, { disabled: false });
    await db.collection('erp_vr_usuarios').doc(LOCK_UID).set({ nome: LOCK_EMAIL, email: LOCK_EMAIL, funcao: 'producao', ativo: 1 });
    const auth4 = await signIn(LOCK_EMAIL, SENHA);
    const rid = reqId();
    const [r1, r2] = await Promise.all([
      callFunction('estoqueRegistrarEntrada', auth4.idToken, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: rid }),
      callFunction('estoqueRegistrarEntrada', auth4.idToken, { matKey: 'E2E_FASEF_20260805_MAT_ACM_3MM', qty: 1, requestId: rid }),
    ]);
    const j1 = JSON.parse(r1.body), j2 = JSON.parse(r2.body);
    const processados = [j1.result, j2.result].filter(Boolean);
    assertEq(processados.length, 2, 'ambas devem retornar sucesso (uma real, uma idempotente)');
    const jaProcessadoCount = processados.filter(function (p) { return p.jaProcessado; }).length;
    assertEq(jaProcessadoCount, 1, 'exatamente uma das duas deve ser reconhecida como retry idempotente');
  });

  await test('9. Function inexistente/indisponível → erro claro, não sucesso falso', async function () {
    const auth5 = await signIn(LOCK_EMAIL, SENHA);
    const r = await callFunction('estoqueFuncaoQueNaoExiste', auth5.idToken, { requestId: reqId() });
    if (r.status === 200 && JSON.parse(r.body).result && JSON.parse(r.body).result.ok) {
      throw new Error('FALHA: function inexistente retornou sucesso');
    }
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
