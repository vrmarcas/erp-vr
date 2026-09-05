/**
 * test_admin_delete_user_server_2026-09-05.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-05 — pedido de acompanhamento do Bloco
 * 7 (onboarding de usuários): não existia nenhuma forma de excluir
 * DEFINITIVAMENTE um usuário — só `adminToggleStatus` (desativar) e
 * `planProdDel`-like remoções locais no array legado (que nunca tocavam
 * Auth nem o perfil canônico). Este teste cobre a nova Cloud Function
 * `adminDeleteUser` (functions/src/adminUsers.ts) contra o Firestore +
 * Auth Emulator reais (demo-erp-homolog) — mesmo mecanismo `.run(data,
 * context)` já usado por test_producao_autorizacao_server.js.
 *
 * Cobre: proteção contra não-master, contra auto-exclusão, contra
 * excluir o último master ativo, idempotência (alvo já não existe),
 * exclusão consistente real (Auth + erp_vr_usuarios + legado) quando
 * segura, e que o usuário excluído realmente não consegue mais logar
 * (perfil ausente em erp_vr_usuarios).
 *
 * Uso: node scripts/test_admin_delete_user_server_2026-09-05.js
 * Pré-requisito: Firestore + Auth Emulator rodando (demo-erp-homolog) e
 * `node scripts/e2e_clean_env.js reset` já executado.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { adminDeleteUser } = require('../functions/lib/adminUsers.js');
const { UID, ctx } = require('./e2e_shared_fixtures');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
async function assertThrows(fn, codeOuTrecho, msg) {
  try { await fn(); throw new Error((msg || 'esperava erro') + ' — nenhum erro lançado'); }
  catch (e) {
    if (e.message && e.message.indexOf((msg || 'esperava erro')) === 0) throw e;
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(codeOuTrecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + codeOuTrecho + '", obtido: ' + texto);
  }
}

const UID_MASTER2 = 'e2efasef20260905master2';
const UID_TARGET = 'e2efasef20260905deletetarget';
const EMAIL_MASTER2 = 'e2efasef20260905master2@example.com';
const EMAIL_TARGET = 'e2efasef20260905deletetarget@example.com';

async function criarUsuarioCompleto(uid, email, role) {
  try { await admin.auth().deleteUser(uid); } catch (e) { /* já não existe — ok */ }
  await admin.auth().createUser({ uid: uid, email: email, password: 'Teste2026Clean!' });
  await admin.auth().setCustomUserClaims(uid, { role: role });
  await db.collection('erp_vr_usuarios').doc(uid).set({ nome: 'E2E Delete Test', email: email, funcao: role, ativo: 1 });
}
async function limparUsuarioSeExistir(uid) {
  try { await admin.auth().deleteUser(uid); } catch (e) { /* já não existe */ }
  await db.collection('erp_vr_usuarios').doc(uid).delete().catch(() => {});
}

console.log('\n=== adminDeleteUser — Cloud Function real (Auth + Firestore Emulator) ===\n');

async function main() {
  await limparUsuarioSeExistir(UID_MASTER2);
  await limparUsuarioSeExistir(UID_TARGET);

  await test('1. Não-master (producao) NUNCA pode excluir usuário — permission-denied', async () => {
    await assertThrows(
      () => adminDeleteUser.run({ targetUid: UID.producao2 }, ctx(UID.producao, 'producao')),
      'permission-denied'
    );
  });

  await test('2. "admin" (role legada, ainda tecnicamente válida no resto da API) NÃO pode excluir — só master (barra mais alta, irreversível)', async () => {
    await assertThrows(
      () => adminDeleteUser.run({ targetUid: UID.producao2 }, ctx(UID.master, 'admin')),
      'permission-denied'
    );
  });

  await test('3. Master NUNCA pode excluir a própria conta', async () => {
    await assertThrows(
      () => adminDeleteUser.run({ targetUid: UID.master }, ctx(UID.master, 'master')),
      'permission-denied'
    );
  });

  await test('4. targetUid ausente é rejeitado (invalid-argument), nunca tenta prosseguir com uid vazio', async () => {
    await assertThrows(
      () => adminDeleteUser.run({}, ctx(UID.master, 'master')),
      'invalid-argument'
    );
  });

  await test('5. Excluir o ÚLTIMO master ativo é BLOQUEADO — sistema nunca pode ficar sem nenhum master', async () => {
    // Ambiente limpo (e2e_clean_env) semeia só 1 master (UID.master) — ele
    // é, por construção, o único master ativo neste momento.
    await assertThrows(
      () => adminDeleteUser.run({ targetUid: UID.master }, ctx(UID_MASTER2, 'master')),
      'failed-precondition',
      'esperava erro'
    );
  });

  await test('6. Alvo que já não existe no Auth: idempotente (ok:true), nunca erro — e limpa resíduo se houver', async () => {
    await db.collection('erp_vr_usuarios').doc('uid_fantasma_nunca_existiu').set({ nome: 'Fantasma', funcao: 'producao', ativo: 1 });
    var res = await adminDeleteUser.run({ targetUid: 'uid_fantasma_nunca_existiu' }, ctx(UID.master, 'master'));
    assertTruthy(res.ok, 'deve retornar ok:true');
    assertTruthy(res.idempotent, 'deve sinalizar idempotência');
    var doc = await db.collection('erp_vr_usuarios').doc('uid_fantasma_nunca_existiu').get();
    assertTruthy(!doc.exists, 'resíduo de erp_vr_usuarios deve ter sido limpo mesmo sem existir no Auth');
  });

  // ── Cenário de exclusão bem-sucedida: cria um SEGUNDO master (para não
  // esbarrar na proteção do teste 5) e um usuário comum, exclui os dois de
  // verdade, confirma consistência Auth+Firestore+legado. ──
  await criarUsuarioCompleto(UID_MASTER2, EMAIL_MASTER2, 'master');
  await criarUsuarioCompleto(UID_TARGET, EMAIL_TARGET, 'producao');
  // Registra o alvo comum também no array legado (erp_usuarios) para provar que a limpeza dos 3 lugares é real.
  {
    var legadoDoc = await db.collection('erp_vr').doc('erp_usuarios').get();
    var legado = legadoDoc.exists ? JSON.parse(legadoDoc.data().data) : [];
    legado.push({ uid: UID_TARGET, nome: 'E2E Delete Test', email: EMAIL_TARGET, funcao: 'producao', ativo: 1 });
    await db.collection('erp_vr').doc('erp_usuarios').set({ data: JSON.stringify(legado), ts: Date.now() });
  }

  await test('7. Master exclui um usuário comum: sucesso real (ok:true, uidMasked presente)', async () => {
    var res = await adminDeleteUser.run({ targetUid: UID_TARGET }, ctx(UID.master, 'master'));
    assertTruthy(res.ok, 'deve retornar ok:true');
    assertTruthy(res.uidMasked, 'deve retornar o uid mascarado');
  });

  await test('8. Após excluir: a conta NÃO existe mais no Firebase Auth', async () => {
    await assertThrows(() => admin.auth().getUser(UID_TARGET), 'auth/user-not-found', 'esperava erro');
  });

  await test('9. Após excluir: erp_vr_usuarios/{uid} (fonte canônica de login) NÃO existe mais — usuário excluído nunca mais consegue logar', async () => {
    var doc = await db.collection('erp_vr_usuarios').doc(UID_TARGET).get();
    assertTruthy(!doc.exists, 'documento canônico deve ter sido apagado');
  });

  await test('10. Após excluir: também sai do registro legado erp_usuarios (nenhum dos 3 lugares fica órfão)', async () => {
    var legadoDoc = await db.collection('erp_vr').doc('erp_usuarios').get();
    var legado = legadoDoc.exists ? JSON.parse(legadoDoc.data().data) : [];
    assertTruthy(!legado.some((u) => u.uid === UID_TARGET), 'não pode sobrar entrada do usuário excluído no array legado');
  });

  await test('11. Master exclui um SEGUNDO master (não é o último — permitido)', async () => {
    var res = await adminDeleteUser.run({ targetUid: UID_MASTER2 }, ctx(UID.master, 'master'));
    assertTruthy(res.ok, 'excluir um master quando existe outro ativo deve ser permitido');
    await assertThrows(() => admin.auth().getUser(UID_MASTER2), 'auth/user-not-found', 'esperava erro');
  });

  await test('12. Depois de tudo: UID.master (fixture compartilhada de OUTRAS suítes) continua intacto — esta suíte nunca toca em fixture alheia', async () => {
    var u = await admin.auth().getUser(UID.master);
    assertTruthy(!u.disabled, 'fixture compartilhada não pode ter sido afetada por este teste');
    var doc = await db.collection('erp_vr_usuarios').doc(UID.master).get();
    assertTruthy(doc.exists, 'perfil canônico da fixture compartilhada deve continuar existindo');
  });

  // limpeza final defensiva (idempotente mesmo se algum teste acima falhar no meio)
  await limparUsuarioSeExistir(UID_MASTER2);
  await limparUsuarioSeExistir(UID_TARGET);
  await db.collection('erp_vr_usuarios').doc('uid_fantasma_nunca_existiu').delete().catch(() => {});

  console.log('\n' + '─'.repeat(60));
  console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
  if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
  console.log('\n✅ PASSOU\n');
}

main().catch((e) => { console.error('Erro fatal:', e); process.exit(1); });
