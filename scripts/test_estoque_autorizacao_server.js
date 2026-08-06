/**
 * test_estoque_autorizacao_server.js
 *
 * FASE 2-8 (checkpoint, 2026-08-05): testa as 12 Cloud Functions reais de
 * functions/src/estoque.ts (compiladas em functions/lib/estoque.js — NÃO
 * reimplementadas aqui) contra o Firestore Emulator real
 * (demo-erp-homolog), via .run(data, context), o mesmo padrão usado em
 * test_producao_autorizacao_server.js.
 *
 * Cobre: identidade/role de cada uma das 12 functions (producao permitido,
 * comercial/sem-perfil/desabilitado/não-autenticado negados, exceto onde
 * documentado — estoqueConsumoAutoOrcamento aceita comercial também;
 * estoqueExcluirItemDefinitivo/estoqueLimparHistorico são master-only),
 * comportamento funcional de cada uma (entrada só soma; saída nunca fica
 * negativa; criar/editar item recusa qty negativo; exclusão/restauração são
 * idempotentes por estado; retalhos são identificados por código),
 * idempotência via requestId, e concorrência real em consumo de retalho
 * (a mesma classe de corrida que já causou 2 acidentes nesta auditoria).
 *
 * Uso: node scripts/test_estoque_autorizacao_server.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080 (demo-erp-homolog).
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const {
  estoqueRegistrarEntrada, estoqueRegistrarSaidaManual, estoqueConsumoAutoOrcamento,
  estoqueCriarOuEditarItem, estoqueExcluirItem, estoqueRestaurarItem, estoqueExcluirItemDefinitivo,
  estoqueLimparHistorico, estoqueCriarRetalho, estoqueEditarRetalho, estoqueConsumirRetalho, estoqueExcluirRetalho,
} = require('../functions/lib/estoque.js');

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
// Identidades fixas do ambiente limpo (node scripts/e2e_clean_env.js reset).
const { UID, ctx } = require('./e2e_shared_fixtures');

async function seedUsuarios() {
  // Já semeado pelo reset do ambiente limpo — nada a fazer aqui.
}

async function seedStock(matKey, item) {
  var ref = db.collection('erp_vr').doc('stock');
  var snap = await ref.get();
  var data = snap.exists ? JSON.parse(snap.data().data) : {};
  data[matKey] = item;
  await ref.set({ data: JSON.stringify(data), ts: Date.now() });
}
async function getStock(matKey) {
  var snap = await db.collection('erp_vr').doc('stock').get();
  var data = snap.exists ? JSON.parse(snap.data().data) : {};
  return data[matKey];
}
async function limparStock(matKey) {
  var ref = db.collection('erp_vr').doc('stock');
  var snap = await ref.get();
  var data = snap.exists ? JSON.parse(snap.data().data) : {};
  delete data[matKey];
  await ref.set({ data: JSON.stringify(data), ts: Date.now() });
}
async function getTomb(matKey) {
  var snap = await db.collection('erp_vr').doc('stock_deleted').get();
  var data = snap.exists ? JSON.parse(snap.data().data) : {};
  return data[matKey];
}
async function getLog() {
  var snap = await db.collection('erp_vr').doc('erp_stock_log').get();
  return snap.exists ? JSON.parse(snap.data().data) : [];
}
async function getRetalhos() {
  var snap = await db.collection('erp_vr').doc('retalhos').get();
  return snap.exists ? JSON.parse(snap.data().data) : [];
}
function novoReqId() { return 'req_est_' + Date.now() + '_' + Math.random().toString(36).slice(2); }

console.log('\n=== FASE 2-8 (checkpoint) — Cloud Functions de estoque restantes (12 functions) ===\n');

(async function main() {
  await seedUsuarios();

  // ── estoqueRegistrarEntrada ──────────────────────────────────────────
  await test('1. estoqueRegistrarEntrada — Produção, material existente → soma qty', async function () {
    var mk = 'e2e_est_mat_entrada1';
    await seedStock(mk, { label: 'Mat Entrada', qty: 5 });
    var r = await estoqueRegistrarEntrada.run({ matKey: mk, qty: 3, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    assertEq((await getStock(mk)).qty, 8);
    await limparStock(mk);
  });

  await test('2. estoqueRegistrarEntrada — Comercial → negado (não é role permitida)', async function () {
    var mk = 'e2e_est_mat_entrada2';
    await seedStock(mk, { label: 'Mat', qty: 1 });
    await assertThrows(function () {
      return estoqueRegistrarEntrada.run({ matKey: mk, qty: 1, requestId: novoReqId() }, ctx(UID.comercial, 'comercial'));
    }, 'permission-denied');
    assertEq((await getStock(mk)).qty, 1, 'não deve ter alterado');
    await limparStock(mk);
  });

  await test('3. estoqueRegistrarEntrada — Master também pode (master sempre passa)', async function () {
    var mk = 'e2e_est_mat_entrada3';
    await seedStock(mk, { label: 'Mat', qty: 0 });
    await estoqueRegistrarEntrada.run({ matKey: mk, qty: 10, requestId: novoReqId() }, ctx(UID.master, 'master'));
    assertEq((await getStock(mk)).qty, 10);
    await limparStock(mk);
  });

  await test('4. estoqueRegistrarEntrada — qty<1 → recusado, nada alterado', async function () {
    var mk = 'e2e_est_mat_entrada4';
    await seedStock(mk, { label: 'Mat', qty: 2 });
    await assertThrows(function () {
      return estoqueRegistrarEntrada.run({ matKey: mk, qty: 0, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'invalid-argument');
    assertEq((await getStock(mk)).qty, 2);
    await limparStock(mk);
  });

  await test('5. estoqueRegistrarEntrada — não autenticado → negado', async function () {
    await assertThrows(function () {
      return estoqueRegistrarEntrada.run({ matKey: 'x', qty: 1, requestId: novoReqId() }, ctx(null));
    }, 'unauthenticated');
  });

  // ── estoqueRegistrarSaidaManual ──────────────────────────────────────
  await test('6. estoqueRegistrarSaidaManual — saldo suficiente → decrementa', async function () {
    var mk = 'e2e_est_mat_saida1';
    await seedStock(mk, { label: 'Mat', qty: 10 });
    var r = await estoqueRegistrarSaidaManual.run({ matKey: mk, qty: 4, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    assertEq((await getStock(mk)).qty, 6);
    var log = await getLog();
    assertTruthy(log.some(function (l) { return l.tipo === 'saida' && l.matKey === mk; }), 'deve ter registrado log de saída');
    await limparStock(mk);
  });

  await test('7. estoqueRegistrarSaidaManual — saldo insuficiente → negado, NUNCA fica negativo (sem exceção Master aqui)', async function () {
    var mk = 'e2e_est_mat_saida2';
    await seedStock(mk, { label: 'Mat', qty: 2 });
    await assertThrows(function () {
      return estoqueRegistrarSaidaManual.run({ matKey: mk, qty: 5, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'ESTOQUE_INSUFICIENTE');
    assertEq((await getStock(mk)).qty, 2, 'não deve ter decrementado');
    await limparStock(mk);
  });

  await test('7b. estoqueRegistrarSaidaManual — MESMO Master não tem exceção de saldo negativo aqui (confirma que a exceção só existe em produção)', async function () {
    var mk = 'e2e_est_mat_saida2b';
    await seedStock(mk, { label: 'Mat', qty: 1 });
    await assertThrows(function () {
      return estoqueRegistrarSaidaManual.run({ matKey: mk, qty: 5, requestId: novoReqId() }, ctx(UID.master, 'master'));
    }, 'ESTOQUE_INSUFICIENTE');
    assertEq((await getStock(mk)).qty, 1);
    await limparStock(mk);
  });

  await test('8. estoqueRegistrarSaidaManual — retry com mesmo requestId → idempotente (uma baixa só)', async function () {
    var mk = 'e2e_est_mat_saida3';
    await seedStock(mk, { label: 'Mat', qty: 10 });
    var reqId = novoReqId();
    await estoqueRegistrarSaidaManual.run({ matKey: mk, qty: 3, requestId: reqId }, ctx(UID.producao, 'producao'));
    var r2 = await estoqueRegistrarSaidaManual.run({ matKey: mk, qty: 3, requestId: reqId }, ctx(UID.producao, 'producao'));
    assertEq(r2.jaProcessado, true);
    assertEq((await getStock(mk)).qty, 7, 'só uma baixa deve ter sido aplicada');
    await limparStock(mk);
  });

  // ── estoqueConsumoAutoOrcamento ───────────────────────────────────────
  // 'ac3' é a chave REAL do material de baseline (hard-coded dentro da própria
  // Function sob teste, legado de orcGerarOS) — NUNCA usar seedStock/limparStock
  // (overwrite-then-delete) nela. Sempre snapshot-and-restore do valor real.
  async function comAc3Preservado(qtyTemporaria, fn) {
    var stockRef = db.collection('erp_vr').doc('stock');
    var antes = await stockRef.get();
    var dataAntes = JSON.parse(antes.data().data);
    var ac3Original = dataAntes.ac3 ? Object.assign({}, dataAntes.ac3) : null;
    var dataTemp = Object.assign({}, dataAntes, { ac3: Object.assign({}, ac3Original || { label: 'Acrílico Cristal 3mm', min: 10, max: 50, esp: 3, cor: 'Cristal' }, { qty: qtyTemporaria }) });
    await stockRef.set({ data: JSON.stringify(dataTemp), ts: Date.now() });
    try {
      await fn();
    } finally {
      var depois = await stockRef.get();
      var dataDepois = JSON.parse(depois.data().data);
      if (ac3Original) dataDepois.ac3 = ac3Original; else delete dataDepois.ac3;
      await stockRef.set({ data: JSON.stringify(dataDepois), ts: Date.now() });
    }
  }

  await test('9. estoqueConsumoAutoOrcamento — Comercial pode chamar (é quem fecha orçamento), decrementa ac3', async function () {
    await comAc3Preservado(5, async function () {
      var r = await estoqueConsumoAutoOrcamento.run({ osRef: 'OS-teste', requestId: novoReqId() }, ctx(UID.comercial, 'comercial'));
      assertEq(r.ok, true); assertEq(r.aplicado, true);
      assertEq((await getStock('ac3')).qty, 4);
    });
  });

  await test('10. estoqueConsumoAutoOrcamento — ac3 com saldo 0 → pula silenciosamente (comportamento legado preservado, não bloqueia OS)', async function () {
    await comAc3Preservado(0, async function () {
      var r = await estoqueConsumoAutoOrcamento.run({ osRef: 'OS-teste2', requestId: novoReqId() }, ctx(UID.comercial, 'comercial'));
      assertEq(r.ok, true); assertEq(r.aplicado, false, 'deve pular sem erro');
      assertEq((await getStock('ac3')).qty, 0);
    });
  });

  await test('11. estoqueConsumoAutoOrcamento — Financeiro → negado (não está entre as roles permitidas nem é master)', async function () {
    await comAc3Preservado(5, async function () {
      await assertThrows(function () {
        return estoqueConsumoAutoOrcamento.run({ osRef: 'x', requestId: novoReqId() }, ctx(UID.financeiro, 'financeiro'));
      }, 'permission-denied');
      assertEq((await getStock('ac3')).qty, 5);
    });
  });

  // ── estoqueCriarOuEditarItem ──────────────────────────────────────────
  await test('12. estoqueCriarOuEditarItem — cria item novo', async function () {
    var mk = 'e2e_est_mat_criar1';
    var r = await estoqueCriarOuEditarItem.run({ matKey: mk, label: 'Novo Mat', qty: 20, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true); assertEq(r.existia, false);
    assertEq((await getStock(mk)).qty, 20);
    await limparStock(mk);
  });

  await test('13. estoqueCriarOuEditarItem — edita item existente, registra log de ajuste', async function () {
    var mk = 'e2e_est_mat_criar2';
    await seedStock(mk, { label: 'Mat', qty: 10 });
    await estoqueCriarOuEditarItem.run({ matKey: mk, label: 'Mat', qty: 15, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq((await getStock(mk)).qty, 15);
    var log = await getLog();
    assertTruthy(log.some(function (l) { return l.tipo === 'ajuste_entrada' && l.matKey === mk; }));
    await limparStock(mk);
  });

  await test('14. estoqueCriarOuEditarItem — qty negativo é RECUSADO (endurecimento deliberado — original não validava)', async function () {
    var mk = 'e2e_est_mat_criar3';
    await seedStock(mk, { label: 'Mat', qty: 5 });
    await assertThrows(function () {
      return estoqueCriarOuEditarItem.run({ matKey: mk, label: 'Mat', qty: -3, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'invalid-argument');
    assertEq((await getStock(mk)).qty, 5, 'não deve ter aplicado o valor negativo');
    await limparStock(mk);
  });

  await test('15. estoqueCriarOuEditarItem — retry mesmo requestId → idempotente', async function () {
    var mk = 'e2e_est_mat_criar4';
    var reqId = novoReqId();
    await estoqueCriarOuEditarItem.run({ matKey: mk, label: 'Mat', qty: 7, requestId: reqId }, ctx(UID.producao, 'producao'));
    var r2 = await estoqueCriarOuEditarItem.run({ matKey: mk, label: 'Mat', qty: 7, requestId: reqId }, ctx(UID.producao, 'producao'));
    assertEq(r2.jaProcessado, true);
    await limparStock(mk);
  });

  // ── estoqueExcluirItem / estoqueRestaurarItem / estoqueExcluirItemDefinitivo ──
  await test('16. estoqueExcluirItem — move para stock_deleted, some de stock', async function () {
    var mk = 'e2e_est_mat_excl1';
    await seedStock(mk, { label: 'Mat', qty: 3 });
    await estoqueExcluirItem.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(await getStock(mk), undefined);
    assertTruthy(await getTomb(mk), 'deve estar na lixeira');
    var tombRef = db.collection('erp_vr').doc('stock_deleted');
    var snap = await tombRef.get(); var data = JSON.parse(snap.data().data); delete data[mk];
    await tombRef.set({ data: JSON.stringify(data), ts: Date.now() });
  });

  await test('17. estoqueExcluirItem — excluir de novo (já excluído) → idempotente, não erro', async function () {
    var mk = 'e2e_est_mat_excl2';
    await seedStock(mk, { label: 'Mat', qty: 1 });
    await estoqueExcluirItem.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    var r2 = await estoqueExcluirItem.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r2.jaExcluido, true);
    var tombRef = db.collection('erp_vr').doc('stock_deleted');
    var snap = await tombRef.get(); var data = JSON.parse(snap.data().data); delete data[mk];
    await tombRef.set({ data: JSON.stringify(data), ts: Date.now() });
  });

  await test('18. estoqueRestaurarItem — restaura item da lixeira de volta a stock', async function () {
    var mk = 'e2e_est_mat_rest1';
    await seedStock(mk, { label: 'Mat Restaurar', qty: 9 });
    await estoqueExcluirItem.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    await estoqueRestaurarItem.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    var item = await getStock(mk);
    assertTruthy(item, 'deve ter voltado a stock');
    assertEq(item.qty, 9);
    await limparStock(mk);
  });

  await test('19. estoqueExcluirItemDefinitivo — Produção → negado (master-only, descarte irreversível)', async function () {
    var mk = 'e2e_est_mat_def1';
    await seedStock(mk, { label: 'Mat', qty: 1 });
    await estoqueExcluirItem.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    await assertThrows(function () {
      return estoqueExcluirItemDefinitivo.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
    assertTruthy(await getTomb(mk), 'ainda deve estar na lixeira');
    var tombRef = db.collection('erp_vr').doc('stock_deleted');
    var snap = await tombRef.get(); var data = JSON.parse(snap.data().data); delete data[mk];
    await tombRef.set({ data: JSON.stringify(data), ts: Date.now() });
  });

  await test('20. estoqueExcluirItemDefinitivo — Master → permitido, some da lixeira', async function () {
    var mk = 'e2e_est_mat_def2';
    await seedStock(mk, { label: 'Mat', qty: 1 });
    await estoqueExcluirItem.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    await estoqueExcluirItemDefinitivo.run({ matKey: mk, requestId: novoReqId() }, ctx(UID.master, 'master'));
    assertEq(await getTomb(mk), undefined);
  });

  // ── estoqueLimparHistorico ────────────────────────────────────────────
  await test('21. estoqueLimparHistorico — Produção → negado (endurecido para master-only nesta rodada)', async function () {
    await assertThrows(function () {
      return estoqueLimparHistorico.run({ requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('22. estoqueLimparHistorico — Master → permitido, zera erp_stock_log', async function () {
    var mk = 'e2e_est_mat_hist1';
    await seedStock(mk, { label: 'Mat', qty: 10 });
    await estoqueRegistrarSaidaManual.run({ matKey: mk, qty: 1, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    var antes = await getLog();
    assertTruthy(antes.length > 0, 'precisa ter pelo menos 1 entrada antes de limpar');
    await estoqueLimparHistorico.run({ requestId: novoReqId() }, ctx(UID.master, 'master'));
    var depois = await getLog();
    assertEq(depois.length, 0);
    await limparStock(mk);
  });

  // ── Retalhos ───────────────────────────────────────────────────────────
  await test('23. estoqueCriarRetalho — cria com código gerado no servidor, atômico', async function () {
    await seedStock('e2e_est_mat_ret', { label: 'Mat Retalho', qty: 5 });
    var r = await estoqueCriarRetalho.run({ mat: 'e2e_est_mat_ret', dims: '30x40', requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    assertTruthy(r.codigo, 'deve retornar código gerado');
    var lista = await getRetalhos();
    var criado = lista.find(function (x) { return x.codigo === r.codigo; });
    assertTruthy(criado, 'deve existir na lista de retalhos');
    await limparStock('e2e_est_mat_ret');
    // limpeza do retalho criado
    var retRef = db.collection('erp_vr').doc('retalhos');
    var snap = await retRef.get(); var data = JSON.parse(snap.data().data);
    data = data.filter(function (x) { return x.codigo !== r.codigo; });
    await retRef.set({ data: JSON.stringify(data), ts: Date.now() });
  });

  await test('24. estoqueCriarRetalho — Comercial → negado', async function () {
    await assertThrows(function () {
      return estoqueCriarRetalho.run({ mat: 'x', dims: '1x1', requestId: novoReqId() }, ctx(UID.comercial, 'comercial'));
    }, 'permission-denied');
  });

  async function criarRetalhoDireto(mat, dims) {
    var r = await estoqueCriarRetalho.run({ mat: mat, dims: dims, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    return r.codigo;
  }
  async function limparRetalho(codigo) {
    var retRef = db.collection('erp_vr').doc('retalhos');
    var snap = await retRef.get(); var data = snap.exists ? JSON.parse(snap.data().data) : [];
    data = data.filter(function (x) { return x.codigo !== codigo; });
    await retRef.set({ data: JSON.stringify(data), ts: Date.now() });
  }

  await test('25. estoqueEditarRetalho — edita dims/qty por código', async function () {
    await seedStock('e2e_est_mat_ret2', { label: 'Mat', qty: 5 });
    var cod = await criarRetalhoDireto('e2e_est_mat_ret2', '10x10');
    await estoqueEditarRetalho.run({ codigo: cod, mat: 'e2e_est_mat_ret2', dims: '20x20', qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    var lista = await getRetalhos();
    var r = lista.find(function (x) { return x.codigo === cod; });
    assertEq(r.dims, '20x20'); assertEq(r.qty, 2);
    await limparStock('e2e_est_mat_ret2'); await limparRetalho(cod);
  });

  await test('26. estoqueEditarRetalho — qty negativo recusado', async function () {
    await seedStock('e2e_est_mat_ret3', { label: 'Mat', qty: 5 });
    var cod = await criarRetalhoDireto('e2e_est_mat_ret3', '5x5');
    await assertThrows(function () {
      return estoqueEditarRetalho.run({ codigo: cod, dims: '5x5', qty: -1, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'invalid-argument');
    await limparStock('e2e_est_mat_ret3'); await limparRetalho(cod);
  });

  await test('27. estoqueConsumirRetalho — qty 1→0 remove da lista', async function () {
    await seedStock('e2e_est_mat_ret4', { label: 'Mat', qty: 5 });
    var cod = await criarRetalhoDireto('e2e_est_mat_ret4', '15x15');
    var r = await estoqueConsumirRetalho.run({ codigo: cod, osRef: 'OS-x', requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.removido, true);
    var lista = await getRetalhos();
    assertEq(lista.some(function (x) { return x.codigo === cod; }), false, 'deve ter sumido da lista');
    var log = await getLog();
    assertTruthy(log.some(function (l) { return l.tipo === 'retalho-saida'; }));
    await limparStock('e2e_est_mat_ret4');
  });

  await test('28. estoqueConsumirRetalho — código inexistente → RETALHO_INDISPONIVEL', async function () {
    await assertThrows(function () {
      return estoqueConsumirRetalho.run({ codigo: 'RT9999NOPE', requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'RETALHO_INDISPONIVEL');
  });

  await test('29. Duas chamadas concorrentes de estoqueConsumirRetalho no MESMO código — exatamente uma vence (mesma classe de corrida dos 2 acidentes desta auditoria)', async function () {
    await seedStock('e2e_est_mat_ret5', { label: 'Mat', qty: 5 });
    var cod = await criarRetalhoDireto('e2e_est_mat_ret5', '25x25'); // qty=1
    var resultados = await Promise.allSettled([
      estoqueConsumirRetalho.run({ codigo: cod, requestId: novoReqId() }, ctx(UID.producao, 'producao')),
      estoqueConsumirRetalho.run({ codigo: cod, requestId: novoReqId() }, ctx(UID.master, 'master')),
    ]);
    var sucessos = resultados.filter(function (r) { return r.status === 'fulfilled'; });
    var falhas = resultados.filter(function (r) { return r.status === 'rejected'; });
    assertEq(sucessos.length, 1, 'exatamente uma das duas deve ter consumido o retalho');
    assertEq(falhas.length, 1, 'a outra deve ter sido negada (RETALHO_INDISPONIVEL)');
    var lista = await getRetalhos();
    assertEq(lista.some(function (x) { return x.codigo === cod; }), false);
    await limparStock('e2e_est_mat_ret5');
  });

  await test('30. estoqueExcluirRetalho — remove por código, idempotente em retry', async function () {
    await seedStock('e2e_est_mat_ret6', { label: 'Mat', qty: 5 });
    var cod = await criarRetalhoDireto('e2e_est_mat_ret6', '9x9');
    await estoqueExcluirRetalho.run({ codigo: cod, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    var lista = await getRetalhos();
    assertEq(lista.some(function (x) { return x.codigo === cod; }), false);
    var r2 = await estoqueExcluirRetalho.run({ codigo: cod, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r2.jaExcluido, true, 'excluir de novo não deve dar erro');
    await limparStock('e2e_est_mat_ret6');
  });

  // ── Conta desabilitada e sem perfil (representativo, não repetido em toda function) ──
  await test('31. Conta desabilitada → negada em qualquer function de estoque (verificado em estoqueRegistrarEntrada)', async function () {
    await assertThrows(function () {
      return estoqueRegistrarEntrada.run({ matKey: 'x', qty: 1, requestId: novoReqId() }, ctx(UID.desabilitado, 'producao'));
    }, 'permission-denied');
  });

  await test('32. Conta sem cadastro em erp_vr_usuarios → negada', async function () {
    await assertThrows(function () {
      return estoqueRegistrarSaidaManual.run({ matKey: 'x', qty: 1, requestId: novoReqId() }, ctx(UID.semPerfil, 'producao'));
    }, 'permission-denied');
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
