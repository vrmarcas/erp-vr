/**
 * test_compras_v2_server.js
 *
 * FASE 11 (checkpoint FASE 2-15, 2026-08-05): testa as Cloud Functions
 * REAIS de Compras v2 (functions/src/compras.ts, compiladas em
 * functions/lib/compras.js — NÃO reimplementadas) contra o Firestore
 * Emulator real, via .run(data, context) — mesmo padrão de
 * test_producao_autorizacao_server.js / test_estoque_autorizacao_server.js.
 *
 * NOTA HONESTA DE ESCOPO: isto é E2E no nível de Function (Auth Emulator +
 * Firestore Emulator + código real compilado), não E2E de UI via browser
 * (clique real em comprasReceberModal() etc. no index.html). A suíte
 * existente scripts/test_compras.js é um mirror-test de lógica pura sem
 * Firestore — não valida as Functions reais. Esta suíte fecha essa lacuna
 * no nível de Function, que é o nível onde a autorização/transação/
 * idempotência realmente vive (a UI só monta o payload). A verificação de
 * clique real na tela (duplo-clique de botão, duas abas de navegador)
 * NÃO foi executada nesta rodada — ver relatório final, pendências.
 *
 * Uso: node scripts/test_compras_v2_server.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080 (demo-erp-homolog).
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const {
  comprasCriarSolicitacao, comprasAprovar, comprasRegistrarRecebimento,
  comprasAdicionarDocumento, comprasRegistrarPagamento, comprasCancelar,
} = require('../functions/lib/compras.js');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
async function assertThrows(fn, trecho, msg) {
  try { await fn(); throw new Error((msg || 'esperava erro') + ' — nenhum erro lançado'); }
  catch (e) {
    if (e.message && e.message.indexOf((msg || 'esperava erro')) === 0) throw e;
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(trecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + trecho + '", obtido: ' + texto);
  }
}
function reqId() { return 'req_cv2_' + Date.now() + '_' + Math.random().toString(36).slice(2); }

// Identidades fixas do ambiente limpo (node scripts/e2e_clean_env.js reset).
const { UID, ctx } = require('./e2e_shared_fixtures');

async function auditFind(action, compraId) {
  var snap = await db.collection('compras_audit_log').where('action', '==', action).where('detail.compraId', '==', compraId).limit(5).get();
  return snap.docs.map(function (d) { return d.data(); });
}

console.log('\n=== FASE 11 (checkpoint) — Compras v2: Cloud Functions reais (nível Function, não UI) ===\n');

(async function main() {
  // Usuários já semeados pelo reset do ambiente limpo — nada a fazer aqui.
  var compraId;

  await test('1. Produção cria solicitação de compra (sem preço/fornecedor)', async function () {
    var r = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_Chapa ACM', qtyNecessaria: 5, requestId: reqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.jaExistia, false);
    assertTruthy(r.id); assertTruthy(r.numero);
    compraId = r.id;
    var doc = await db.collection('erp_vr_compras').doc(compraId).get();
    assertEq(doc.data().status, 'solicitada');
    assertEq(doc.data().criadoPorRole, 'producao');
  });

  await test('2. Comercial também pode criar solicitação', async function () {
    var r = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_Item Comercial', qtyNecessaria: 1, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.jaExistia, false);
  });

  await test('3. Duplo clique (mesmo requestId) ao criar → idempotente, não duplica', async function () {
    var rid = reqId();
    var r1 = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_DupClick', qtyNecessaria: 1, requestId: rid }, ctx(UID.producao, 'producao'));
    var r2 = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_DupClick', qtyNecessaria: 1, requestId: rid }, ctx(UID.producao, 'producao'));
    assertEq(r1.jaExistia, false);
    assertEq(r2.jaExistia, true);
    assertEq(r1.id, r2.id, 'deve devolver o MESMO registro, não criar um segundo');
  });

  await test('4. Produção tentando aprovar a própria solicitação → negado', async function () {
    await assertThrows(function () {
      return comprasAprovar.run({ compraId: compraId, fornecedorEscolhido: 'Fornecedor X', precoUnit: 10 }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
    var doc = await db.collection('erp_vr_compras').doc(compraId).get();
    assertEq(doc.data().status, 'solicitada', 'não deve ter avançado');
  });

  await test('5. Comercial tentando aprovar → negado', async function () {
    await assertThrows(function () {
      return comprasAprovar.run({ compraId: compraId, fornecedorEscolhido: 'X', precoUnit: 10 }, ctx(UID.comercial, 'comercial'));
    }, 'permission-denied');
  });

  await test('6. Master aprova — define fornecedor/preço, avança status', async function () {
    var r = await comprasAprovar.run({ compraId: compraId, fornecedorEscolhido: 'Fornecedor E2E', precoUnit: 25.5 }, ctx(UID.master, 'master'));
    assertEq(r.ok, true);
    var doc = await db.collection('erp_vr_compras').doc(compraId).get();
    assertEq(doc.data().status, 'aprovada');
    assertEq(doc.data().fornecedorEscolhido, 'Fornecedor E2E');
    var aud = await auditFind('compra_aprovada', compraId);
    assertTruthy(aud.length >= 1, 'deve ter auditoria de aprovação');
  });

  await test('7. Recebimento antes de "pedida" ainda é aceito pela function (aprovada já é elegível) — confirma transição real, não hard-coded', async function () {
    // A function aceita status !== cancelada/solicitada/cotacao — 'aprovada' passa.
    var r = await comprasRegistrarRecebimento.run({ compraId: compraId, qtyRecebida: 2, requestId: reqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.novoStatus, 'recebida_parcial');
    assertEq(r.totalRecebidoDepois, 2);
  });

  await test('8. Comercial tentando registrar recebimento → negado (só Produção/Master)', async function () {
    await assertThrows(function () {
      return comprasRegistrarRecebimento.run({ compraId: compraId, qtyRecebida: 1, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'permission-denied');
  });

  await test('9. Recebimento final completa a quantidade necessária → status "recebida"', async function () {
    var r = await comprasRegistrarRecebimento.run({ compraId: compraId, qtyRecebida: 3, requestId: reqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.novoStatus, 'recebida');
    assertEq(r.totalRecebidoDepois, 5);
  });

  await test('10. Mesmo requestId em recebimento (retry/timeout simulado) → idempotente, não soma de novo', async function () {
    var rid = reqId();
    var r1 = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_RetryRecebimento', qtyNecessaria: 4, requestId: reqId() }, ctx(UID.producao, 'producao'));
    await comprasAprovar.run({ compraId: r1.id, fornecedorEscolhido: 'F', precoUnit: 1 }, ctx(UID.master, 'master'));
    await comprasRegistrarRecebimento.run({ compraId: r1.id, qtyRecebida: 2, requestId: rid }, ctx(UID.producao, 'producao'));
    var r2 = await comprasRegistrarRecebimento.run({ compraId: r1.id, qtyRecebida: 2, requestId: rid }, ctx(UID.producao, 'producao'));
    assertEq(r2.jaProcessado, true);
    var doc = await db.collection('erp_vr_compras').doc(r1.id).get();
    assertEq(doc.data().qtyRecebidaTotal, 2, 'só um recebimento aplicado, apesar do retry');
  });

  await test('11. RequestIds DIFERENTES para a mesma intenção de recebimento → cada um é um recebimento físico real e distinto (soma corretamente, não é bug)', async function () {
    var r1 = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_DoisRecebimentos', qtyNecessaria: 10, requestId: reqId() }, ctx(UID.producao, 'producao'));
    await comprasAprovar.run({ compraId: r1.id, fornecedorEscolhido: 'F', precoUnit: 1 }, ctx(UID.master, 'master'));
    await comprasRegistrarRecebimento.run({ compraId: r1.id, qtyRecebida: 4, requestId: reqId() }, ctx(UID.producao, 'producao'));
    await comprasRegistrarRecebimento.run({ compraId: r1.id, qtyRecebida: 6, requestId: reqId() }, ctx(UID.producao, 'producao'));
    var doc = await db.collection('erp_vr_compras').doc(r1.id).get();
    assertEq(doc.data().qtyRecebidaTotal, 10, 'dois recebimentos parciais legítimos somam corretamente');
    assertEq(doc.data().status, 'recebida');
  });

  await test('12. Duas chamadas de recebimento CONCORRENTES (requestIds diferentes, "duas abas") na mesma compra — nenhuma perde a outra', async function () {
    var r1 = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_Concorrente', qtyNecessaria: 20, requestId: reqId() }, ctx(UID.producao, 'producao'));
    await comprasAprovar.run({ compraId: r1.id, fornecedorEscolhido: 'F', precoUnit: 1 }, ctx(UID.master, 'master'));
    await Promise.all([
      comprasRegistrarRecebimento.run({ compraId: r1.id, qtyRecebida: 8, requestId: reqId() }, ctx(UID.producao, 'producao')),
      comprasRegistrarRecebimento.run({ compraId: r1.id, qtyRecebida: 5, requestId: reqId() }, ctx(UID.producao2, 'producao')),
    ]);
    var doc = await db.collection('erp_vr_compras').doc(r1.id).get();
    assertEq(doc.data().qtyRecebidaTotal, 13, 'transação serializa — nenhum dos dois recebimentos concorrentes se perde');
  });

  await test('13. Financeiro adiciona documento fiscal — cria parcelas e Conta a Pagar', async function () {
    var r = await comprasAdicionarDocumento.run({ compraId: compraId, numero: 'NF-E2E-001', valorTotal: 300, nParcelas: 2 }, ctx(UID.financeiro, 'financeiro'));
    assertEq(r.ok, true);
    var parcelas = await db.collection('erp_vr_compras_parcelas').where('documentoId', '==', r.documentoId).get();
    assertEq(parcelas.size, 2);
    var cps = await db.collection('erp_vr_fin_cp').where('documentoId', '==', r.documentoId).get();
    assertEq(cps.size, 2);
    parcelas.docs.forEach(function (d) { assertEq(d.data().valor, 150); });
  });

  await test('14. Produção tentando adicionar documento fiscal → negado (só Financeiro/Master)', async function () {
    await assertThrows(function () {
      return comprasAdicionarDocumento.run({ compraId: compraId, numero: 'NF-X', valorTotal: 10, nParcelas: 1 }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('15. Financeiro registra pagamento de uma parcela (Conta a Pagar) → quita', async function () {
    var cps = await db.collection('erp_vr_fin_cp').where('compraId', '==', compraId).limit(1).get();
    var cpId = cps.docs[0].id;
    var r = await comprasRegistrarPagamento.run({ cpId: cpId, valor: 150, requestId: reqId() }, ctx(UID.financeiro, 'financeiro'));
    assertEq(r.ok, true);
    var doc = await db.collection('erp_vr_fin_cp').doc(cpId).get();
    assertEq(doc.data().status, 'pago');
  });

  await test('16. Pagar de novo a mesma Conta a Pagar já quitada → negado (sem duplicar pagamento)', async function () {
    var cps = await db.collection('erp_vr_fin_cp').where('compraId', '==', compraId).limit(1).get();
    var cpId = cps.docs[0].id;
    await assertThrows(function () {
      return comprasRegistrarPagamento.run({ cpId: cpId, valor: 150, requestId: reqId() }, ctx(UID.financeiro, 'financeiro'));
    }, 'failed-precondition');
  });

  await test('17. Master cancela uma solicitação em status inicial — preserva histórico', async function () {
    var r1 = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_ParaCancelar', qtyNecessaria: 1, requestId: reqId() }, ctx(UID.producao, 'producao'));
    var r = await comprasCancelar.run({ compraId: r1.id, motivo: 'E2E teste — item não é mais necessário' }, ctx(UID.master, 'master'));
    assertEq(r.ok, true);
    var doc = await db.collection('erp_vr_compras').doc(r1.id).get();
    assertEq(doc.data().status, 'cancelada');
    assertEq(doc.data().motivoCancelamento, 'E2E teste — item não é mais necessário');
  });

  await test('18. Produção tentando cancelar → negado (só Master)', async function () {
    var r1 = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_NaoCancelavel', qtyNecessaria: 1, requestId: reqId() }, ctx(UID.producao, 'producao'));
    await assertThrows(function () {
      return comprasCancelar.run({ compraId: r1.id, motivo: 'tentativa indevida' }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('19. Cancelar uma compra já recebida → negado (transição inválida — TRANSICOES["recebida"] é vazio)', async function () {
    await assertThrows(function () {
      return comprasCancelar.run({ compraId: compraId, motivo: 'tentativa' }, ctx(UID.master, 'master'));
    }, 'failed-precondition');
  });

  await test('20. Vínculo com origem (falta de material/OS) é preservado quando informado', async function () {
    var r = await comprasCriarSolicitacao.run({ label: 'E2E_FASEF_20260805_ComOrigem', qtyNecessaria: 3, material: 'ac3', origem: { osId: 'e2e_os_teste', tipo: 'falta_material' }, requestId: reqId() }, ctx(UID.producao, 'producao'));
    var doc = await db.collection('erp_vr_compras').doc(r.id).get();
    assertEq(doc.data().origem.osId, 'e2e_os_teste');
    assertEq(doc.data().itens[0].material, 'ac3');
  });

  await test('21. Não autenticado → negado em qualquer function de compras (verificado em comprasCriarSolicitacao)', async function () {
    await assertThrows(function () { return comprasCriarSolicitacao.run({ label: 'x', requestId: reqId() }, ctx(null)); }, 'unauthenticated');
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
