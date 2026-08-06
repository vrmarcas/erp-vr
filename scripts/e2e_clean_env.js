/**
 * e2e_clean_env.js — ambiente de homologação limpo e determinístico
 * (RODADA FINAL, 2026-08-06).
 *
 * Substitui o uso do estado "organicamente acumulado" de demo-erp-homolog
 * como base de verdade — esse estado sofreu 3 incidentes de sobrescrita
 * acidental do documento agregado 'stock' ao longo desta auditoria. Daqui
 * em diante, TODO material/usuário/OS de teste é criado por este script,
 * com IDs determinísticos e prefixo E2E_FASEF_20260805_ — nunca reutiliza
 * chaves reais como 'ac3'/'acm'/'ps3'/'mt2'.
 *
 * Opção A do leque pedido (reset completo + seed determinístico
 * versionado), no MESMO project ID (demo-erp-homolog) — Auth, Firestore e
 * Functions Emulator já apontam para ele; Hosting Emulator serve o mesmo
 * index.html, então não há necessidade de um project ID novo (opção B)
 * nem de import/export (opção C) para atingir determinismo.
 *
 * Uso:
 *   node scripts/e2e_clean_env.js reset    — apaga TUDO (Firestore+Auth) e semeia
 *   node scripts/e2e_clean_env.js verify   — relê o estado e confere o hash
 *   node scripts/e2e_clean_env.js clean    — remove só os IDs criados por este seed
 *
 * Pré-requisito: Firestore Emulator :8080 e Auth Emulator :9099 rodando
 * para o projeto demo-erp-homolog.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'demo-erp-homolog';
const PROD_PROJECT_IDS = ['erp-vrmarcas'];
const FIXTURE_PREFIX = 'E2E_FASEF_20260805_';
const FORBIDDEN_KEYS = ['ac3', 'ac5', 'ac8', 'ac10', 'ps3', 'mt2', 'acm']; // chaves reais legadas — nunca reusar como fixture

function assertProjetoSeguro() {
  if (PROD_PROJECT_IDS.indexOf(PROJECT_ID) >= 0) {
    throw new Error('[e2e_clean_env] RECUSADO: projectId "' + PROJECT_ID + '" é de PRODUÇÃO.');
  }
  if (!/^demo-/.test(PROJECT_ID)) {
    throw new Error('[e2e_clean_env] RECUSADO: projectId "' + PROJECT_ID + '" não começa com "demo-".');
  }
}
assertProjetoSeguro();

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const authAdmin = admin.auth();

function httpDelete(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path: urlPath, method: 'DELETE' }, (res) => {
      let out = ''; res.on('data', (c) => out += c); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Catálogo de fixture — TODO ID começa com FIXTURE_PREFIX, exceto UIDs
// de Auth (que usam um formato próprio determinístico, também prefixado). ──
const MATERIAIS = [
  { key: FIXTURE_PREFIX + 'MAT_ACRILICO_CRISTAL_3MM', label: FIXTURE_PREFIX + 'Acrílico Cristal 3mm', qty: 40, min: 10, max: 50, esp: 3, cor: 'Cristal' },
  { key: FIXTURE_PREFIX + 'MAT_ACRILICO_CRISTAL_5MM', label: FIXTURE_PREFIX + 'Acrílico Cristal 5mm', qty: 18, min: 10, max: 50, esp: 5, cor: 'Cristal' },
  { key: FIXTURE_PREFIX + 'MAT_ACRILICO_LEITOSO_8MM', label: FIXTURE_PREFIX + 'Acrílico Leitoso 8mm', qty: 4, min: 10, max: 50, esp: 8, cor: 'Leitoso' },
  { key: FIXTURE_PREFIX + 'MAT_ACRILICO_ESPELHO_10MM', label: FIXTURE_PREFIX + 'Acrílico Espelho 10mm', qty: 2, min: 5, max: 30, esp: 10, cor: 'Espelho' },
  { key: FIXTURE_PREFIX + 'MAT_PS_CRISTAL_3MM', label: FIXTURE_PREFIX + 'PS Cristal 3mm', qty: 11, min: 8, max: 50, esp: 3, cor: 'Cristal' },
  { key: FIXTURE_PREFIX + 'MAT_ACO_INOX_2MM', label: FIXTURE_PREFIX + 'Chapa Aço Inox 2mm', qty: 18, min: 5, max: 30, esp: 2, cor: 'Inox' },
  { key: FIXTURE_PREFIX + 'MAT_ACM_3MM', label: FIXTURE_PREFIX + 'ACM 3mm', qty: 22, min: 10, max: 50, esp: 3, cor: 'Natural' },
  { key: FIXTURE_PREFIX + 'MAT_BAIXO_ESTOQUE', label: FIXTURE_PREFIX + 'Material Baixo Estoque (para testar insuficiência)', qty: 1, min: 5, max: 20, esp: 3, cor: 'Teste' },
];
// Confere em tempo de definição que nenhuma chave colide com o legado.
MATERIAIS.forEach((m) => {
  if (FORBIDDEN_KEYS.indexOf(m.key) >= 0 || m.key.indexOf(FIXTURE_PREFIX) !== 0) {
    throw new Error('[e2e_clean_env] catálogo de materiais inválido: "' + m.key + '"');
  }
});

// UIDs determinísticos (mesmo texto sempre gera o mesmo UID — reprodutível
// entre execuções do reset). Firebase Auth Emulator aceita UID customizado
// no createUser.
const USUARIOS = [
  { name: 'master', uid: 'e2efasef20260805master', email: FIXTURE_PREFIX.toLowerCase() + 'master@example.com', role: 'master', ativo: 1 },
  { name: 'producao', uid: 'e2efasef20260805producao', email: FIXTURE_PREFIX.toLowerCase() + 'producao@example.com', role: 'producao', ativo: 1 },
  { name: 'producao2', uid: 'e2efasef20260805producao2', email: FIXTURE_PREFIX.toLowerCase() + 'producao2@example.com', role: 'producao', ativo: 1 },
  { name: 'comercial', uid: 'e2efasef20260805comercial', email: FIXTURE_PREFIX.toLowerCase() + 'comercial@example.com', role: 'comercial', ativo: 1 },
  { name: 'financeiro', uid: 'e2efasef20260805financeiro', email: FIXTURE_PREFIX.toLowerCase() + 'financeiro@example.com', role: 'financeiro', ativo: 1 },
  { name: 'desabilitado', uid: 'e2efasef20260805desabilitado', email: FIXTURE_PREFIX.toLowerCase() + 'desabilitado@example.com', role: 'producao', ativo: 0 },
  // e2efasef20260805semperfil: propositalmente SEM doc em erp_vr_usuarios (criado só no Auth)
  { name: 'semPerfil', uid: 'e2efasef20260805semperfil', email: FIXTURE_PREFIX.toLowerCase() + 'semperfil@example.com', role: 'producao', ativo: 1, semDoc: true },
];
const SENHA_PADRAO = 'FaseF2026Clean!';

var OS_FIXTURE = {};
OS_FIXTURE[FIXTURE_PREFIX + 'OS_1'] = {
  id: FIXTURE_PREFIX + 'OS_1', num: 'E2E-CLEAN-001', status: 'iniciada',
  titulo: FIXTURE_PREFIX + 'OS de teste 1', cliente: FIXTURE_PREFIX + 'Cliente Teste',
};

function canonical(obj) {
  // JSON determinístico: chaves ordenadas recursivamente.
  function sort(o) {
    if (Array.isArray(o)) return o.map(sort);
    if (o && typeof o === 'object') {
      return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sort(o[k]); return acc; }, {});
    }
    return o;
  }
  return JSON.stringify(sort(obj));
}
function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }

async function reset() {
  assertProjetoSeguro();
  console.log('[e2e_clean_env] apagando Firestore (' + PROJECT_ID + ')...');
  var rFs = await httpDelete(8080, '/emulator/v1/projects/' + PROJECT_ID + '/databases/(default)/documents');
  console.log('  Firestore:', rFs.status);
  console.log('[e2e_clean_env] apagando Auth (' + PROJECT_ID + ')...');
  var rAuth = await httpDelete(9099, '/emulator/v1/projects/' + PROJECT_ID + '/accounts');
  console.log('  Auth:', rAuth.status);
}

async function seed() {
  assertProjetoSeguro();
  console.log('[e2e_clean_env] semeando usuários (Auth + erp_vr_usuarios)...');
  for (var u of USUARIOS) {
    try {
      await authAdmin.createUser({ uid: u.uid, email: u.email, password: SENHA_PADRAO, emailVerified: true });
    } catch (e) {
      if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') throw e;
    }
    await authAdmin.setCustomUserClaims(u.uid, { role: u.role });
    if (!u.semDoc) {
      // 'email' é o campo que o fluxo de login (index.html) usa para casar
      // a conta autenticada com o cadastro — sem ele, login sempre cai em
      // "Conta sem perfil atribuído" mesmo com claim+doc corretos.
      await db.collection('erp_vr_usuarios').doc(u.uid).set({ nome: u.email, email: u.email, funcao: u.role, ativo: u.ativo });
    }
  }

  console.log('[e2e_clean_env] semeando erp_vr/stock (' + MATERIAIS.length + ' materiais fixture)...');
  var stockObj = {};
  MATERIAIS.forEach((m) => { stockObj[m.key] = { label: m.label, qty: m.qty, min: m.min, max: m.max, esp: m.esp, cor: m.cor }; });
  await db.collection('erp_vr').doc('stock').set({ data: JSON.stringify(stockObj), ts: 0 });
  await db.collection('erp_vr').doc('stock_deleted').set({ data: JSON.stringify({}), ts: 0 });
  await db.collection('erp_vr').doc('erp_stock_log').set({ data: JSON.stringify([]), ts: 0 });
  await db.collection('erp_vr').doc('retalhos').set({ data: JSON.stringify([]), ts: 0 });
  // retalhos_seq intencionalmente ausente (a Function cria com merge:true na primeira criação).
  await db.collection('erp_vr').doc('kb_os').set({ data: JSON.stringify(OS_FIXTURE), ts: 0 });

  console.log('[e2e_clean_env] seed concluído.');
}

async function snapshotState() {
  var stock = await db.collection('erp_vr').doc('stock').get();
  var retalhos = await db.collection('erp_vr').doc('retalhos').get();
  var log = await db.collection('erp_vr').doc('erp_stock_log').get();
  var kbOs = await db.collection('erp_vr').doc('kb_os').get();
  var usuariosSnap = await db.collection('erp_vr_usuarios').get();
  var usuarios = {};
  usuariosSnap.docs.forEach((d) => { usuarios[d.id] = d.data(); });
  return {
    stock: stock.exists ? JSON.parse(stock.data().data) : null,
    retalhos: retalhos.exists ? JSON.parse(retalhos.data().data) : null,
    erp_stock_log: log.exists ? JSON.parse(log.data().data) : null,
    kb_os: kbOs.exists ? JSON.parse(kbOs.data().data) : null,
    erp_vr_usuarios: usuarios,
  };
}

async function hashState() {
  var snap = await snapshotState();
  return { hash: sha256(canonical(snap)), snapshot: snap };
}

async function clean() {
  assertProjetoSeguro();
  console.log('[e2e_clean_env] limpando (removendo docs/usuários com prefixo E2E_FASEF_20260805_ / e2efasef20260805*)...');
  var stockRef = db.collection('erp_vr').doc('stock');
  var snap = await stockRef.get();
  var data = snap.exists ? JSON.parse(snap.data().data) : {};
  var restante = {};
  var removidos = 0;
  Object.keys(data).forEach((k) => {
    if (k.indexOf(FIXTURE_PREFIX) === 0) removidos++; else restante[k] = data[k];
  });
  await stockRef.set({ data: JSON.stringify(restante), ts: Date.now() });
  console.log('  stock: ' + removidos + ' materiais fixture removidos, ' + Object.keys(restante).length + ' restantes (deveria ser 0 num ambiente 100% seed).');

  var usnap = await db.collection('erp_vr_usuarios').get();
  var batch = db.batch();
  var uRemoved = 0;
  usnap.docs.forEach((d) => { if (/^e2efasef20260805/.test(d.id)) { batch.delete(d.ref); uRemoved++; } });
  if (uRemoved) await batch.commit();
  console.log('  erp_vr_usuarios: ' + uRemoved + ' removidos.');

  var kbRef = db.collection('erp_vr').doc('kb_os');
  var kbSnap = await kbRef.get();
  var kbData = kbSnap.exists ? JSON.parse(kbSnap.data().data) : {};
  var kbRestante = {};
  var kbRemovidos = 0;
  Object.keys(kbData).forEach((k) => { if (k.indexOf(FIXTURE_PREFIX) === 0) kbRemovidos++; else kbRestante[k] = kbData[k]; });
  await kbRef.set({ data: JSON.stringify(kbRestante), ts: Date.now() });
  console.log('  kb_os: ' + kbRemovidos + ' OS fixture removidas, ' + Object.keys(kbRestante).length + ' restantes.');
}

async function main() {
  var cmd = process.argv[2];
  if (cmd === 'reset') {
    await reset();
    await seed();
    var h = await hashState();
    console.log('\n[e2e_clean_env] SHA-256 do snapshot inicial: ' + h.hash);
    console.log('[e2e_clean_env] materiais:', Object.keys(h.snapshot.stock).length, '| usuários:', Object.keys(h.snapshot.erp_vr_usuarios).length);
    return h.hash;
  } else if (cmd === 'verify') {
    var h2 = await hashState();
    console.log('[e2e_clean_env] SHA-256 atual: ' + h2.hash);
    return h2.hash;
  } else if (cmd === 'clean') {
    await clean();
  } else {
    console.log('Uso: node scripts/e2e_clean_env.js <reset|verify|clean>');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { reset, seed, clean, hashState, snapshotState, MATERIAIS, USUARIOS, FIXTURE_PREFIX, PROJECT_ID, SENHA_PADRAO };
