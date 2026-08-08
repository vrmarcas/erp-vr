/**
 * test_valeria_consultar_os_fin_2026-08-08.js
 *
 * RODADA 3 — seção 36: valeriaConsultarOS (functions/src/valeria.ts) lia
 * `os.valor` direto de `kb_os`. Desde o split financeiro P0.6 (Rodada 2),
 * esse campo nunca mais existe em `kb_os` — a Valéria sempre devolvia
 * `valor: undefined` ao cliente. Corrigido para mesclar `kb_os_fin`
 * (totalGeral/valor) na resposta. Isto NÃO reabre a privacidade da
 * Produção: este endpoint roda com Admin SDK (fora do alcance das Rules
 * por natureza — é o próprio servidor) e devolve ao CLIENTE apenas o
 * valor do PRÓPRIO pedido dele, nunca custo/margem/markup interno.
 *
 * Testado via HTTP real contra o Functions Emulator (mesmo padrão de
 * test_valeria_vitre_server.js), não .run() direto — onRequest exige
 * request/response reais.
 *
 * Uso: node scripts/test_valeria_consultar_os_fin_2026-08-08.js
 * Pré-requisito: Emulators rodando — Firestore :8080, Functions :5001.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const http = require('http');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();

const PROJECT = 'demo-erp-homolog';
const REGION = 'us-central1';
const SECRET = 'e2e_valeria_os_secret_' + Date.now();

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }

function httpJson(method, fnName, body, bearer) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (bearer !== undefined) headers.Authorization = 'Bearer ' + bearer;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({
      hostname: 'localhost', port: 5001, method: method,
      path: `/${PROJECT}/${REGION}/${fnName}`,
      headers: headers,
    }, (res) => {
      let out = ''; res.on('data', (c) => out += c); res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(out); } catch (e) { /* corpo não-JSON */ }
        resolve({ status: res.statusCode, body: parsed, raw: out });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function mergeDoc(docId, patch) {
  var ref = db.collection('erp_vr').doc(docId);
  var snap = await ref.get();
  var atual = (snap.exists && snap.data() && snap.data().data) ? JSON.parse(snap.data().data) : {};
  Object.assign(atual, patch);
  await ref.set({ data: JSON.stringify(atual), ts: Date.now() });
}

console.log('\n=== RODADA 3 — valeriaConsultarOS devolve valor real pós-split kb_os/kb_os_fin ===\n');

(async function main() {
  await db.collection('erp_vr').doc('valeria_config').set({ data: JSON.stringify({ secret: SECRET }), ts: Date.now() });

  var OS_ID = 'e2e_valeria_os_' + Date.now();
  var TEL = '11999990000';
  var CLIENTE_ID = 'e2e_valeria_cliente_' + Date.now();

  // clientes é um documento-agregado (array) — lê/mescla preservando o
  // que já existir (ou array vazio se o documento ainda não existir).
  var refClientes = db.collection('erp_vr').doc('clientes');
  var snapCli = await refClientes.get();
  var parsedCli = (snapCli.exists && snapCli.data() && snapCli.data().data) ? JSON.parse(snapCli.data().data) : [];
  var listaCli = Array.isArray(parsedCli) ? parsedCli : [];
  listaCli.push({ id: CLIENTE_ID, nome: 'E2E Valéria Cliente', tel: TEL, os: [OS_ID] });
  await refClientes.set({ data: JSON.stringify(listaCli), ts: Date.now() });

  await mergeDoc('kb_os', { [OS_ID]: { id: OS_ID, cliente: 'E2E Valéria Cliente', status: 'pronta', descricao: 'Caixa personalizada', data: '08/08/2026' } });
  await mergeDoc('kb_os_fin', { [OS_ID]: { totalGeral: 987.65, valor: 987.65 } });

  await test('1. valeriaConsultarOS devolve o valor real (vindo de kb_os_fin), nunca undefined', async function () {
    var r = await httpJson('POST', 'valeriaConsultarOS', { tel: TEL }, SECRET);
    assertEq(r.status, 200);
    var os = (r.body && r.body.os) || [];
    var found = os.find(function (o) { return o.id === OS_ID; });
    if (!found) throw new Error('OS não encontrada na resposta — payload: ' + r.raw);
    assertEq(found.valor, 987.65, 'valor deve vir do kb_os_fin mesclado, não undefined (bug pré-fix)');
  });

  await test('2. status humano traduzido continua funcionando (não regrediu com o merge)', async function () {
    var r = await httpJson('POST', 'valeriaConsultarOS', { tel: TEL }, SECRET);
    var found = r.body.os.find(function (o) { return o.id === OS_ID; });
    assertEq(found.status, 'Pronta ✅');
  });

  // limpeza — remove só as chaves desta suíte dos documentos compartilhados
  var refOS = db.collection('erp_vr').doc('kb_os'), refFin = db.collection('erp_vr').doc('kb_os_fin');
  var [snapOS, snapFin] = await Promise.all([refOS.get(), refFin.get()]);
  if (snapOS.exists) { var d1 = JSON.parse(snapOS.data().data); delete d1[OS_ID]; await refOS.set({ data: JSON.stringify(d1), ts: Date.now() }); }
  if (snapFin.exists) { var d2 = JSON.parse(snapFin.data().data); delete d2[OS_ID]; await refFin.set({ data: JSON.stringify(d2), ts: Date.now() }); }
  var listaCliFinal = JSON.parse((await refClientes.get()).data().data).filter(function (c) { return c.id !== CLIENTE_ID; });
  await refClientes.set({ data: JSON.stringify(listaCliFinal), ts: Date.now() });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
