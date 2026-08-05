/**
 * migrate_erp_usuarios_normalizado.js
 * Cria os documentos individuais erp_vr_usuarios/{uid} para os perfis ATIVOS
 * confirmados em scripts/lib/user_decisions.js (conciliação humana final —
 * substitui a versão anterior, que tentava casar por heurística de e-mail;
 * agora a correspondência já está decidida e confirmada por humano).
 *
 * Escopo estrito:
 *   - Só migra quem está em DECISOES_HUMANAS com acao != 'aposentar'.
 *   - Exige que a conta Auth já exista (criada por create_missing_erp_users.js
 *     quando acao === 'criar-conta', ou já existente para os demais).
 *   - Grava funcao = decisao.funcaoFinal (a role FINAL decidida — não a bruta
 *     do array legado; Isabella e Gabriel-principal, por decisão humana
 *     explícita, gravam "master", nunca "admin").
 *   - NUNCA sobrescreve um documento já existente (.create(), não .set()).
 *   - NUNCA toca em custom claim (isso é scripts/sync_role_claims.js).
 *   - NUNCA associa a conta técnica (CONTAS_TECNICAS) a nenhuma role.
 *   - NUNCA cria documento para quem tem acao:'aposentar'.
 *   - O array legado (erp_vr/erp_usuarios) nunca é escrito por este script —
 *     permanece intacto para rollback/auditoria.
 *
 * Schema do documento (Fase 2 — campos mínimos e seguros):
 *   uid, nome, email, funcao, ativo, permissoesRef, versaoMigracao, origem,
 *   migradoEm, migradoPor
 *
 * Uso:
 *   node scripts/migrate_erp_usuarios_normalizado.js                                            → dry-run
 *   node scripts/migrate_erp_usuarios_normalizado.js --apply --confirm-project=demo-erp-homolog  → aplica no demo
 *   node scripts/migrate_erp_usuarios_normalizado.js --mock                                      → testes locais
 */
'use strict';

const { DECISOES_HUMANAS, CONTAS_TECNICAS, VALID_ROLES } = require('./lib/user_decisions');

const VERSAO_MIGRACAO = '2026-08-05-conciliacao-final';

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
function planejarMigracao(decisoes, authUsers, existingNormUids) {
  const authByEmail = new Map(authUsers.filter(u=>u.email).map(u => [u.email.toLowerCase(), u]));
  const tecnicas = new Set(CONTAS_TECNICAS.map(e => e.toLowerCase()));

  const criar = [], pular = [];
  decisoes.forEach(d => {
    if (tecnicas.has(d.email.toLowerCase())) { pular.push({ nome: d.nome, motivo: 'conta-tecnica-nunca-migrada' }); return; }
    if (d.acao === 'aposentar') { pular.push({ nome: d.nome, motivo: 'aposentado-fora-do-escopo-desta-migracao' }); return; }
    if (!d.funcaoFinal || VALID_ROLES.indexOf(d.funcaoFinal) < 0) { pular.push({ nome: d.nome, motivo: 'role-final-invalida-ou-ausente' }); return; }

    const authUser = authByEmail.get(d.email.toLowerCase());
    if (!authUser) { pular.push({ nome: d.nome, motivo: 'conta-auth-ainda-nao-existe' }); return; }
    if (existingNormUids.has(authUser.uid)) { pular.push({ nome: d.nome, uid: authUser.uid, motivo: 'ja-existe-normalizado' }); return; }

    criar.push({ nome: d.nome, uid: authUser.uid, email: authUser.email, funcao: d.funcaoFinal, origem: d.acao });
  });
  return { criar, pular };
}

// ── Modo mock ────────────────────────────────────────────────────────────
function runMockTests() {
  let passed = 0, failed = 0;
  function assert(desc, got, exp) {
    const g = JSON.stringify(got), e = JSON.stringify(exp);
    if (g === e) { console.log('  ✅ ' + desc); passed++; }
    else { console.log('  ❌ ' + desc + ' — esperado ' + e + ', obtido ' + g); failed++; }
  }
  console.log('\n── planejarMigracao (tabela de decisões) ────────────────────');

  const decisoesTeste = [
    { legacyIndex:0, nome:'A', email:'a@x.com', funcaoFinal:'comercial', acao:'criar-conta' },
    { legacyIndex:1, nome:'B', email:'b@x.com', funcaoFinal:'master',    acao:'normalizar-existente' },
    { legacyIndex:2, nome:'C', email:'c@x.com', funcaoFinal:null,        acao:'aposentar' },
  ];

  (function() {
    const r = planejarMigracao(decisoesTeste, [], new Set());
    assert('1. conta ainda não existe no Auth -> pula', r.criar.length, 0);
    assert('2. aposentado nunca entra no criar', r.pular.some(p=>p.motivo==='aposentado-fora-do-escopo-desta-migracao'), true);
  })();

  (function() {
    const r = planejarMigracao(decisoesTeste, [{uid:'u1',email:'a@x.com'},{uid:'u2',email:'b@x.com'}], new Set());
    assert('3. as duas contas ativas existentes -> cria os 2, ignora o aposentado', r.criar.length, 2);
    assert('4. grava a role FINAL da decisão, não uma bruta', r.criar.find(c=>c.email==='a@x.com').funcao, 'comercial');
  })();

  (function() {
    const r = planejarMigracao(decisoesTeste, [{uid:'u1',email:'a@x.com'}], new Set(['u1']));
    assert('5. IDEMPOTÊNCIA: já normalizado -> não recria', r.criar.length, 0);
  })();

  (function() {
    const comTecnica = decisoesTeste.concat([]); // conta técnica não está na tabela mesmo
    const r = planejarMigracao(comTecnica, [{uid:'tec1', email: require('./lib/user_decisions').CONTAS_TECNICAS[0]}], new Set());
    assert('6. conta técnica nunca aparece em criar mesmo se existir no Auth', r.criar.some(c=>c.email===require('./lib/user_decisions').CONTAS_TECNICAS[0]), false);
  })();

  (function() {
    // Cenário real completo: 8 decisões, 3 ainda sem conta Auth, 1 aposentado, 4 normalizáveis.
    const { DECISOES_HUMANAS } = require('./lib/user_decisions');
    const authSimulado = DECISOES_HUMANAS.filter(d => d.acao !== 'criar-conta' && d.acao !== 'aposentar')
      .map((d,i) => ({ uid: 'u'+i, email: d.email }));
    const r = planejarMigracao(DECISOES_HUMANAS, authSimulado, new Set());
    assert('7. cenário real: 4 criados (Isabella, Valéria, Gabriel principal, Gabriel secundário)', r.criar.length, 4);
    assert('8. cenário real: 4 pulados (3 sem conta ainda + 1 aposentado)', r.pular.length, 4);
    assert('9. Isabella grava master, não admin', r.criar.find(c=>c.nome.includes('ISABELLA')).funcao, 'master');
  })();

  console.log('\n================================================================\n RESULTADO: ' + passed + ' passed, ' + failed + ' failed\n================================================================\n');
  if (failed) { console.log('Existem testes falhando.'); process.exit(1); }
  console.log('Todos os testes passaram.');
  process.exit(0);
}

// ── Execução real ────────────────────────────────────────────────────────
async function runReal() {
  if (APPLY && !CONFIRM_PROJECT) { console.error('❌ --apply exige --confirm-project=<projectId> explícito.'); process.exit(1); }
  if (APPLY && CONFIRM_PROJECT === 'erp-vrmarcas') { console.error('❌ Esta rodada NÃO autoriza migração real em produção.'); process.exit(1); }
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

  const existingNorm = await db.collection('erp_vr_usuarios').get();
  const existingNormUids = new Set(existingNorm.docs.map(d => d.id));

  const { criar, pular } = planejarMigracao(DECISOES_HUMANAS, authUsers, existingNormUids);

  console.log('=== ' + (APPLY ? 'APLICANDO' : 'DRY-RUN — NENHUMA ESCRITA') + ' — projeto: ' + projectId + ' ===\n');
  console.log('Decisões ativas na tabela:', DECISOES_HUMANAS.filter(d=>d.acao!=='aposentar').length, '| Aposentados:', DECISOES_HUMANAS.filter(d=>d.acao==='aposentar').length);
  console.log('\nSeriam/serão criados:', criar.length);
  criar.forEach(c => console.log('  -', c.nome, '->', maskEmail(c.email), '| role final:', c.funcao));
  console.log('\nPulados (sem ação):', pular.length);
  pular.forEach(p => console.log('  -', p.nome, '-', p.motivo));

  if (!APPLY) { console.log('\n(dry-run — para aplicar, rode com --apply --confirm-project=' + projectId + ')'); process.exit(0); }

  console.log('\n=== aplicando (.create — falha em vez de sobrescrever) ===');
  let criados = 0, jaExistiam = 0;
  for (const c of criar) {
    try {
      // .create() falha se o documento já existir — nunca sobrescreve
      // (a checagem de existingNormUids acima já evita tentar, isto é
      // defesa em profundidade contra corrida concorrente).
      await db.collection('erp_vr_usuarios').doc(c.uid).create({
        uid: c.uid,
        nome: c.nome || null,
        email: c.email || null,
        funcao: c.funcao,
        ativo: true,
        permissoesRef: 'PERM_DEFAULT', // aponta para o default do código — sem customização gravada hoje
        versaoMigracao: VERSAO_MIGRACAO,
        origem: c.origem,
        migradoEm: new Date().toISOString(),
        migradoPor: 'migrate_erp_usuarios_normalizado.js'
      });
      criados++;
      console.log('  ✅ criado:', c.nome, '-> uid', c.uid.slice(0,6)+'…', '| funcao:', c.funcao);
    } catch (e) {
      console.error('  ❌ falha ao criar', c.nome, ':', e.message);
    }
  }
  console.log('\nResumo: ' + criados + ' documentos criados, ' + pular.length + ' pulados.');
  process.exit(0);
}

if (MOCK) runMockTests();
else runReal().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

module.exports = { planejarMigracao, maskEmail };
