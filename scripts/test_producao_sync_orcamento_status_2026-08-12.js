/**
 * test_producao_sync_orcamento_status_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, gate 1 pós-visual — bug real classificado
 * incorretamente na rodada anterior como "rótulo cosmético": a Cloud
 * Function producaoIniciarOuEditar (functions/src/producao.ts) baixava
 * estoque e avançava a OS para "Em Produção" no 1º "Iniciar Produção",
 * mas NUNCA sincronizava o orçamento vinculado — só o caminho de
 * RETOMADA no frontend (kbIniciarProd, quando producaoStartId já
 * existe) fazia isso. No fluxo real (1ª vez, que sempre passa pela
 * Function), o orçamento ficava parado em "Enviado para Produção" com
 * a OS já em produção — divergência real entre Orçamentos Enviados e o
 * Kanban.
 *
 * Corrigido DENTRO da mesma transação/idempotência já existente: se a
 * OS tem orcRef e o orçamento existe, avança para 'em_producao' (mesmo
 * enum já usado pelo caminho de retomada) — nunca grava nada
 * financeiro (só o campo `status`), nunca bloqueia a produção se o
 * orçamento estiver ausente/órfão.
 *
 * Dado financeiro real (valorEntrada/restante/totalGeral) vive em
 * erp_vr/kb_os_fin, NUNCA em erp_vr/kb_os (ver _KB_OS_FIN_FIELDS /
 * kbSaveKbos() no index.html — kb_os é lido pela role Produção, então
 * nunca pode carregar esses campos). Este teste semeia os dois
 * documentos separadamente, do jeito real, e confirma que a Function
 * nunca toca em kb_os_fin.
 *
 * Testa contra o Firestore Emulator real (mesmo mecanismo de
 * test_producao_autorizacao_server.js — producaoIniciarOuEditar.run(),
 * não reimplementado aqui). Limpa todas as fixtures no final — o
 * emulador é compartilhado entre suítes na mesma sessão.
 *
 * Uso: node scripts/test_producao_sync_orcamento_status_2026-08-12.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080
 * (demo-erp-homolog) — mesmo emulador das outras suítes.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { producaoIniciarOuEditar } = require('../functions/lib/producao.js');
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
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(codeOuTrecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + codeOuTrecho + '", obtido: ' + texto);
  }
}

var KB_OS_FIN_FIELDS = ['valor', 'totalGeral', 'parcelas', 'formaPgto', 'pagtoTipo', 'valorEntrada', 'restante'];

async function getOS(osId) {
  var kb = await db.collection('erp_vr').doc('kb_os').get();
  var kbData = JSON.parse(kb.data().data);
  return kbData[osId];
}
async function getOSFin(osId) {
  var doc = await db.collection('erp_vr').doc('kb_os_fin').get();
  if (!doc.exists) return null;
  var data = JSON.parse(doc.data().data);
  return data[osId] || null;
}
async function getOrc(orcId) {
  var doc = await db.collection('erp_vr').doc('orcamentos').get();
  if (!doc.exists) return null;
  var lista = JSON.parse(doc.data().data);
  return lista.find(function (o) { return o.id === orcId; }) || null;
}
async function seedOrcamento(orcId, campos) {
  var ref = db.collection('erp_vr').doc('orcamentos');
  var doc = await ref.get();
  var lista = doc.exists ? JSON.parse(doc.data().data) : [];
  lista = lista.filter(function (o) { return o.id !== orcId; });
  lista.push(Object.assign({ id: orcId, num: orcId, status: 'enviado_producao' }, campos || {}));
  await ref.set({ data: JSON.stringify(lista), ts: Date.now() });
}
async function seedOsEStoque(osId, opts) {
  opts = opts || {};
  var kbRef = db.collection('erp_vr').doc('kb_os');
  var stockRef = db.collection('erp_vr').doc('stock');
  var kb = await kbRef.get();
  var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
  kbData[osId] = Object.assign({
    id: osId, num: 'E2E-SYNC-' + osId.slice(-4), status: 'iniciada', titulo: 'E2E_GOLIVE_20260812_SyncOrc',
  }, opts.os || {});
  await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });

  var stock = await stockRef.get();
  var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
  Object.assign(stockData, opts.stock || {});
  await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
}
// Financeiro real da OS vive SEPARADO, em erp_vr/kb_os_fin — nunca em kb_os.
async function seedOsFin(osId, campos) {
  var ref = db.collection('erp_vr').doc('kb_os_fin');
  var doc = await ref.get();
  var data = doc.exists ? JSON.parse(doc.data().data) : {};
  data[osId] = campos;
  await ref.set({ data: JSON.stringify(data), ts: Date.now() });
}
async function limparOS(osId) {
  var kbRef = db.collection('erp_vr').doc('kb_os');
  var kb = await kbRef.get();
  var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
  delete kbData[osId];
  await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });

  var finRef = db.collection('erp_vr').doc('kb_os_fin');
  var fin = await finRef.get();
  if (fin.exists) {
    var finData = JSON.parse(fin.data().data);
    if (finData[osId]) { delete finData[osId]; await finRef.set({ data: JSON.stringify(finData), ts: Date.now() }); }
  }
}
async function limparOrc(orcId) {
  var ref = db.collection('erp_vr').doc('orcamentos');
  var doc = await ref.get();
  if (!doc.exists) return;
  var lista = JSON.parse(doc.data().data).filter(function (o) { return o.id !== orcId; });
  await ref.set({ data: JSON.stringify(lista), ts: Date.now() });
}
async function limparMaterial(matKey) {
  var stockRef = db.collection('erp_vr').doc('stock');
  var stock = await stockRef.get();
  var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
  delete stockData[matKey];
  await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
}
var _osCounter = 0;
function novoOsId() { return 'e2e_sync_os_' + Date.now() + '_' + (++_osCounter); }
function novoOrcId() { return 'e2e_sync_orc_' + Date.now() + '_' + (++_osCounter); }
function novoReqId() { return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
var MAT = 'e2e_mat_sync_' + Date.now();

console.log('\n=== GATE 1 — producaoIniciarOuEditar sincroniza o orçamento vinculado (Cloud Function real, Firestore Emulator) ===\n');

(async () => {
  var criados = { os: [], orc: [] }; // rastro para limpeza garantida no final, mesmo se algum teste falhar

  // ── Cenário principal: OS nova + entrada parcial + orçamento "Enviado para Produção" ──
  var osId, orcId;
  await test('SETUP — OS nova com entrada parcial (kb_os_fin real), orçamento vinculado em "enviado_producao"', async () => {
    osId = novoOsId(); orcId = novoOrcId();
    criados.os.push(osId); criados.orc.push(orcId);
    await seedOsEStoque(osId, {
      os: { status: 'iniciada', orcRef: orcId },
      stock: { [MAT]: { label: 'Acrílico E2E Sync', qty: 10 } },
    });
    // status financeiro (entrada parcial) — no schema real, separado em kb_os_fin, nunca em kb_os.
    await seedOsFin(osId, { valorEntrada: 50, restante: 50, totalGeral: 100 });
    await seedOrcamento(orcId, { valorFinal: 100, cliente: 'Cliente E2E Sync' });
  });

  await test('1. Iniciar Produção (1ª vez) — OS avança para "producao"', async () => {
    var r = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: MAT, qty: 1, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertTruthy(r.ok, 'esperava ok:true');
    assertEq(r.osStatus, 'producao', 'status retornado pela Function');
    var os = await getOS(osId);
    assertEq(os.status, 'producao', 'OS.status pós-transação');
  });

  await test('2. Orçamento vinculado avança para "em_producao" NA MESMA transação', async () => {
    var orc = await getOrc(orcId);
    assertTruthy(orc, 'orçamento deveria existir');
    assertEq(orc.status, 'em_producao', 'orc.status');
  });

  await test('3. Reload completo (nova leitura do Firestore) — ambos continuam sincronizados', async () => {
    var os = await getOS(osId);
    var orc = await getOrc(orcId);
    assertEq(os.status, 'producao', 'OS.status após reload');
    assertEq(orc.status, 'em_producao', 'orc.status após reload');
  });

  await test('4. Status financeiro (entrada parcial/saldo, em kb_os_fin) permanece intocado — Function operacional nunca grava nele', async () => {
    var fin = await getOSFin(osId);
    assertTruthy(fin, 'kb_os_fin deveria continuar existindo para esta OS');
    assertEq(fin.valorEntrada, 50, 'valorEntrada não deve mudar');
    assertEq(fin.restante, 50, 'restante (saldo pendente) não deve mudar — parcial nunca bloqueia produção');
    var orc = await getOrc(orcId);
    assertEq(orc.valorFinal, 100, 'valorFinal do orçamento não deve mudar — Function nunca cria fonte financeira no doc operacional');
  });

  await test('4b. kb_os (operacional) nunca ganhou nenhum campo financeiro — privacidade real, não só de tela', async () => {
    var os = await getOS(osId);
    KB_OS_FIN_FIELDS.forEach(function (f) {
      if (os[f] !== undefined) throw new Error('campo financeiro "' + f + '" vazou para kb_os (deveria estar só em kb_os_fin) — valor: ' + JSON.stringify(os[f]));
    });
  });

  // ── Cenário isolado: double-click com o MESMO requestId não duplica a sincronização ──
  var osId2, orcId2, reqIdFixo;
  await test('SETUP 2 — nova OS + orçamento, para testar double-click com requestId fixo', async () => {
    osId2 = novoOsId(); orcId2 = novoOrcId();
    criados.os.push(osId2); criados.orc.push(orcId2);
    reqIdFixo = novoReqId();
    await seedOsEStoque(osId2, {
      os: { status: 'iniciada', orcRef: orcId2 },
      stock: { [MAT]: { label: 'Acrílico E2E Sync', qty: 10 } },
    });
    await seedOrcamento(orcId2, { valorFinal: 200 });
  });
  await test('5. Primeira chamada com requestId fixo — sincroniza normalmente', async () => {
    var r = await producaoIniciarOuEditar.run({ osId: osId2, editMode: false, tipo: 'chapa', matKey: MAT, qty: 1, requestId: reqIdFixo }, ctx(UID.producao, 'producao'));
    assertEq(r.jaProcessado, false, 'primeira chamada não deve ser "já processado"');
    var orc = await getOrc(orcId2);
    assertEq(orc.status, 'em_producao', 'orc.status após 1ª chamada');
  });
  await test('6. Segunda chamada com O MESMO requestId (double-click) — jaProcessado:true, nenhum efeito extra', async () => {
    var r = await producaoIniciarOuEditar.run({ osId: osId2, editMode: false, tipo: 'chapa', matKey: MAT, qty: 1, requestId: reqIdFixo }, ctx(UID.producao, 'producao'));
    assertEq(r.jaProcessado, true, 'reenvio do mesmo requestId deve ser reconhecido como já processado');
    var orc = await getOrc(orcId2);
    assertEq(orc.status, 'em_producao', 'orc.status continua em_producao (não regrediu nem duplicou)');
  });
  await test('7. Terceira tentativa com requestId NOVO na mesma OS (retry real de "Iniciar Produção" já iniciada) — rejeitada, nenhum efeito extra', async () => {
    await assertThrows(
      () => producaoIniciarOuEditar.run({ osId: osId2, editMode: false, tipo: 'chapa', matKey: MAT, qty: 1, requestId: novoReqId() }, ctx(UID.producao, 'producao')),
      'PRODUCAO_JA_INICIADA'
    );
    var orc = await getOrc(orcId2);
    assertEq(orc.status, 'em_producao', 'orc.status permanece em_producao — tentativa rejeitada nunca reprocessa nem duplica');
  });

  // ── Casos de borda: sem orcRef, e orcRef órfão — nunca bloqueiam a produção ──
  var osId3;
  await test('8. OS SEM orcRef — produção inicia normalmente, nenhuma escrita em orcamentos', async () => {
    osId3 = novoOsId(); criados.os.push(osId3);
    await seedOsEStoque(osId3, { os: { status: 'iniciada' }, stock: { [MAT]: { label: 'Acrílico E2E Sync', qty: 10 } } });
    var r = await producaoIniciarOuEditar.run({ osId: osId3, editMode: false, tipo: 'chapa', matKey: MAT, qty: 1, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertTruthy(r.ok, 'produção deve iniciar mesmo sem orcRef');
    var os = await getOS(osId3);
    assertEq(os.status, 'producao', 'OS.status mesmo sem orçamento vinculado');
  });

  var osId4;
  await test('9. OS com orcRef ÓRFÃO (orçamento não existe mais) — produção inicia normalmente, sem erro', async () => {
    osId4 = novoOsId(); criados.os.push(osId4);
    var orcOrfaoId = 'orc_inexistente_' + Date.now();
    await seedOsEStoque(osId4, { os: { status: 'iniciada', orcRef: orcOrfaoId }, stock: { [MAT]: { label: 'Acrílico E2E Sync', qty: 10 } } });
    var r = await producaoIniciarOuEditar.run({ osId: osId4, editMode: false, tipo: 'chapa', matKey: MAT, qty: 1, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertTruthy(r.ok, 'produção deve iniciar mesmo com orcRef órfão — sincronizar rótulo nunca pode bloquear produção');
    var os = await getOS(osId4);
    assertEq(os.status, 'producao', 'OS.status mesmo com orçamento órfão');
  });

  // ── Limpeza — o Firestore Emulator é compartilhado entre suítes na mesma sessão; nunca deixar resíduo. ──
  for (var i = 0; i < criados.os.length; i++) await limparOS(criados.os[i]);
  for (var j = 0; j < criados.orc.length; j++) await limparOrc(criados.orc[j]);
  await limparMaterial(MAT);
  console.log('  (limpeza: ' + criados.os.length + ' OS + ' + criados.orc.length + ' orçamento(s) + 1 material removidos do emulador)');

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})();
