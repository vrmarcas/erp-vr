/**
 * migrate_erp_usuarios_normalizado.js
 * Migra perfis do array legado erp_vr/erp_usuarios para documentos
 * individuais erp_vr_usuarios/{uid} (Rules já preparadas para essa
 * coleção — ver firestore.rules).
 *
 * Escopo estrito (não faz mais que isto):
 *   - CRIA erp_vr_usuarios/{uid} só para correspondência INEQUÍVOCA:
 *       (a) o registro legado já tem `uid` e essa conta existe no Auth; ou
 *       (b) o registro legado NÃO tem `uid`, mas o e-mail bate com
 *           EXATAMENTE 1 conta do Firebase Auth.
 *   - NUNCA sobrescreve um documento erp_vr_usuarios/{uid} já existente
 *     (usa .create(), que falha se o documento já existir — idempotência
 *     garantida pelo próprio Firestore, não por lógica própria frágil).
 *   - NUNCA cria conta no Firebase Auth, nunca altera senha/e-mail/custom
 *     claim/role — só cria o documento normalizado, preservando a role
 *     exatamente como está gravada no array legado (sem normalizar
 *     admin→master aqui; isso é escopo do migrate_admin_to_master.js).
 *   - Registros ambíguos (0 ou >1 correspondência) são sempre PULADOS —
 *     nunca associados automaticamente.
 *
 * Uso:
 *   node scripts/migrate_erp_usuarios_normalizado.js                                            → dry-run (projeto default do .firebaserc)
 *   node scripts/migrate_erp_usuarios_normalizado.js --apply --confirm-project=demo-erp-homolog  → aplica no projeto demo
 *   node scripts/migrate_erp_usuarios_normalizado.js --apply --confirm-project=erp-vrmarcas       → aplica em produção (NÃO usado nesta rodada)
 *   node scripts/migrate_erp_usuarios_normalizado.js --mock                                      → testes locais, sem Firebase
 *
 * Pré-requisito para --apply:
 *   Emulador: FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST
 *   Produção: GOOGLE_APPLICATION_CREDENTIALS apontando para um service account
 */

'use strict';

const APPLY = process.argv.includes('--apply');
const MOCK  = process.argv.includes('--mock');
const CONFIRM_PROJECT_ARG = process.argv.find(a => a.startsWith('--confirm-project='));
const CONFIRM_PROJECT = CONFIRM_PROJECT_ARG ? CONFIRM_PROJECT_ARG.split('=')[1] : null;

function maskEmail(email) {
  if (!email) return '***';
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***@***';
  return local[0] + '***@' + domain;
}

// ── Núcleo puro (testável sem Firebase) ─────────────────────────────────────
// Recebe o array legado, a lista de usuários do Auth ({uid,email}) e o
// conjunto de UIDs que já têm doc normalizado — devolve o plano de ação,
// nunca executa nada. Mesma função usada pelo dry-run, pelo --apply e pelos
// testes --mock, então dry-run e apply NUNCA podem divergir na decisão.
function planejarMigracao(legacyArr, authUsers, existingNormUids) {
  const authByUid = new Map(authUsers.map(u => [u.uid, u]));
  const authByEmail = new Map();
  authUsers.forEach(u => {
    if (!u.email) return;
    const key = u.email.toLowerCase();
    if (!authByEmail.has(key)) authByEmail.set(key, []);
    authByEmail.get(key).push(u);
  });

  const criar = [];
  const pular = [];

  legacyArr.forEach((rec, idx) => {
    const label = 'legado[' + idx + ']';
    if (rec.uid) {
      const authUser = authByUid.get(rec.uid);
      if (!authUser) { pular.push({ label, motivo: 'uid-nao-existe-no-auth' }); return; }
      if (existingNormUids.has(rec.uid)) { pular.push({ label, uid: rec.uid, motivo: 'ja-existe-normalizado' }); return; }
      criar.push({ label, uid: rec.uid, funcao: rec.funcao, nome: rec.nome, email: authUser.email || rec.email || null, origem: 'uid-direto' });
      return;
    }
    if (!rec.email) { pular.push({ label, motivo: 'sem-uid-e-sem-email' }); return; }
    const matches = authByEmail.get(rec.email.toLowerCase()) || [];
    if (matches.length === 0) { pular.push({ label, motivo: 'email-nao-encontrado-no-auth' }); return; }
    if (matches.length > 1)  { pular.push({ label, motivo: 'email-ambiguo', qtd: matches.length }); return; }
    const authUser = matches[0];
    if (existingNormUids.has(authUser.uid)) { pular.push({ label, uid: authUser.uid, motivo: 'ja-existe-normalizado' }); return; }
    criar.push({ label, uid: authUser.uid, funcao: rec.funcao, nome: rec.nome, email: authUser.email, origem: 'email-unico' });
  });

  return { criar, pular };
}

// ── Modo mock (testes locais, sem Firebase) ─────────────────────────────────
function runMockTests() {
  let passed = 0, failed = 0;
  function assert(desc, got, expected) {
    const gotStr = JSON.stringify(got), expStr = JSON.stringify(expected);
    if (gotStr === expStr) { console.log('  ✅ ' + desc); passed++; }
    else { console.log('  ❌ ' + desc + ' — esperado ' + expStr + ', obtido ' + gotStr); failed++; }
  }

  console.log('\n── planejarMigracao ─────────────────────────────────────────');

  (function() {
    const legacy = [{ uid: 'u1', funcao: 'master', nome: 'A' }];
    const auth = [{ uid: 'u1', email: 'a@x.com' }];
    const r = planejarMigracao(legacy, auth, new Set());
    assert('1. uid direto existente no Auth -> cria', r.criar.length, 1);
    assert('2. origem correta = uid-direto', r.criar[0].origem, 'uid-direto');
  })();

  (function() {
    const legacy = [{ uid: 'u-fantasma', funcao: 'master', nome: 'A' }];
    const auth = [{ uid: 'u1', email: 'a@x.com' }];
    const r = planejarMigracao(legacy, auth, new Set());
    assert('3. uid direto que NÃO existe no Auth -> pula', r.criar.length, 0);
    assert('4. motivo correto', r.pular[0].motivo, 'uid-nao-existe-no-auth');
  })();

  (function() {
    const legacy = [{ funcao: 'comercial', nome: 'B', email: 'b@x.com' }];
    const auth = [{ uid: 'u2', email: 'b@x.com' }];
    const r = planejarMigracao(legacy, auth, new Set());
    assert('5. sem uid, email único no Auth -> cria via email-unico', r.criar.length, 1);
    assert('6. origem correta = email-unico', r.criar[0].origem, 'email-unico');
  })();

  (function() {
    const legacy = [{ funcao: 'comercial', nome: 'C', email: 'dup@x.com' }];
    const auth = [{ uid: 'u3', email: 'dup@x.com' }, { uid: 'u4', email: 'dup@x.com' }];
    const r = planejarMigracao(legacy, auth, new Set());
    assert('7. email duplicado no Auth -> NUNCA associa (ambíguo)', r.criar.length, 0);
    assert('8. motivo = email-ambiguo', r.pular[0].motivo, 'email-ambiguo');
  })();

  (function() {
    const legacy = [{ funcao: 'comercial', nome: 'D', email: 'inexistente@x.com' }];
    const auth = [{ uid: 'u5', email: 'outro@x.com' }];
    const r = planejarMigracao(legacy, auth, new Set());
    assert('9. email não encontrado -> pula', r.criar.length, 0);
    assert('10. motivo = email-nao-encontrado-no-auth', r.pular[0].motivo, 'email-nao-encontrado-no-auth');
  })();

  (function() {
    const legacy = [{ funcao: 'producao', nome: 'E' }]; // sem uid, sem email
    const r = planejarMigracao(legacy, [], new Set());
    assert('11. sem uid e sem email -> pula', r.criar.length, 0);
    assert('12. motivo = sem-uid-e-sem-email', r.pular[0].motivo, 'sem-uid-e-sem-email');
  })();

  (function() {
    const legacy = [{ uid: 'u6', funcao: 'master', nome: 'F' }];
    const auth = [{ uid: 'u6', email: 'f@x.com' }];
    const r1 = planejarMigracao(legacy, auth, new Set());
    // simula que a 1a rodada já criou o doc — a 2a rodada não deve recriar
    const r2 = planejarMigracao(legacy, auth, new Set(['u6']));
    assert('13. IDEMPOTÊNCIA: 1a rodada cria', r1.criar.length, 1);
    assert('14. IDEMPOTÊNCIA: 2a rodada (uid já normalizado) não recria', r2.criar.length, 0);
    assert('15. IDEMPOTÊNCIA: 2a rodada reporta já-existe-normalizado', r2.pular[0].motivo, 'ja-existe-normalizado');
  })();

  (function() {
    // Reproduz exatamente o cenário real de produção descrito no incidente:
    // 8 perfis legados, 2 com uid direto, 3 com email único, 3 sem match.
    const legacy = [
      { funcao: 'comercial', nome: 'X0' },                          // sem email nem uid -> pula
      { funcao: 'producao',  nome: 'X1', email: 'naoexiste1@x.com' }, // email não encontrado -> pula
      { funcao: 'admin',     nome: 'X2', email: 'x2@x.com' },        // email único -> cria
      { funcao: 'master',    nome: 'X3', email: 'x3@x.com' },        // email único -> cria
      { funcao: 'producao',  nome: 'X4', email: 'naoexiste4@x.com' }, // email não encontrado -> pula
      { funcao: 'admin',     nome: 'X5', email: 'x5@x.com' },        // email único -> cria
      { uid: 'u6', funcao: 'master', nome: 'X6' },                    // uid direto -> cria
      { uid: 'u7', funcao: 'master', nome: 'X7' },                    // uid direto -> cria
    ];
    const auth = [
      { uid: 'u2', email: 'x2@x.com' }, { uid: 'u3', email: 'x3@x.com' },
      { uid: 'u5', email: 'x5@x.com' }, { uid: 'u6', email: 'u6@x.com' },
      { uid: 'u7', email: 'u7@x.com' },
    ];
    const r = planejarMigracao(legacy, auth, new Set());
    assert('16. cenário real: 5 criados (2 uid-direto + 3 email-unico)', r.criar.length, 5);
    assert('17. cenário real: 3 pulados (ambíguos/sem match)', r.pular.length, 3);
  })();

  console.log('\n================================================================');
  console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
  console.log('================================================================\n');
  if (failed > 0) { console.log('Existem testes falhando.'); process.exit(1); }
  console.log('Todos os testes passaram.');
  process.exit(0);
}

// ── Execução real (dry-run ou --apply) ──────────────────────────────────────
async function runReal() {
  if (APPLY && !CONFIRM_PROJECT) {
    console.error('❌ --apply exige --confirm-project=<projectId> explícito. Abortando (nenhuma escrita feita).');
    process.exit(1);
  }
  const admin = require('firebase-admin');
  const projectId = CONFIRM_PROJECT || require('../.firebaserc').projects.default;
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const auth = admin.auth();

  let authUsers = [];
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    authUsers = authUsers.concat(res.users.map(u => ({ uid: u.uid, email: u.email })));
    pageToken = res.pageToken;
  } while (pageToken);

  const legacyDoc = await db.collection('erp_vr').doc('erp_usuarios').get();
  if (!legacyDoc.exists) { console.log('erp_vr/erp_usuarios não existe neste projeto — nada a migrar.'); process.exit(0); }
  const legacyArr = JSON.parse(legacyDoc.data().data || '[]');

  const existingNorm = await db.collection('erp_vr_usuarios').get();
  const existingNormUids = new Set(existingNorm.docs.map(d => d.id));

  const { criar, pular } = planejarMigracao(legacyArr, authUsers, existingNormUids);

  console.log('=== ' + (APPLY ? 'APLICANDO' : 'DRY-RUN — NENHUMA ESCRITA') + ' — projeto: ' + projectId + ' ===\n');
  console.log('Total no Auth:', authUsers.length, '| Total no array legado:', legacyArr.length, '| Já normalizados antes desta execução:', existingNormUids.size);
  console.log('\nSeriam/serão criados:', criar.length);
  criar.forEach(c => console.log('  -', c.label, '->', maskEmail(c.email), '| role:', c.funcao, '| origem:', c.origem));
  console.log('\nPulados (sem ação):', pular.length);
  pular.forEach(p => console.log('  -', p.label, '-', p.motivo));

  if (!APPLY) { console.log('\n(dry-run — para aplicar de fato, rode com --apply --confirm-project=' + projectId + ')'); process.exit(0); }

  console.log('\n=== aplicando (.create — falha em vez de sobrescrever se já existir) ===');
  const criados = [], jaExistiaNoMomentoDoWrite = [];
  for (const c of criar) {
    try {
      await db.collection('erp_vr_usuarios').doc(c.uid).create({
        funcao: c.funcao,
        nome: c.nome || null,
        email: c.email || null,
        migradoEm: new Date().toISOString(),
        migradoPor: 'migrate_erp_usuarios_normalizado.js',
        migradoOrigem: c.origem
      });
      criados.push(c);
      console.log('  ✅ criado:', c.label, '-> uid', c.uid.slice(0,6)+'…');
    } catch (e) {
      if (e.code === 6 || /already exists/i.test(e.message)) {
        jaExistiaNoMomentoDoWrite.push(c);
        console.log('  ⏭️  já existia (corrida concorrente ou 2a execução):', c.label);
      } else {
        console.error('  ❌ falha ao criar', c.label, ':', e.message);
      }
    }
  }
  console.log('\nResumo: ' + criados.length + ' documentos criados, ' + jaExistiaNoMomentoDoWrite.length + ' já existiam (idempotência confirmada), ' + pular.length + ' pulados por ambiguidade/ausência.');
  process.exit(0);
}

if (MOCK) runMockTests();
else runReal().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

module.exports = { planejarMigracao, maskEmail };
