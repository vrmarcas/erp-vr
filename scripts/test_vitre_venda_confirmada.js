/**
 * test_vitre_venda_confirmada.js
 *
 * Complemento do hotfix orcamento-vitre-wizard (2026-08-06) — fecha o
 * fluxo Envio → Pagamento → Confirmação da Venda → OS. Testa
 * vitreAtualizarOrcamento (marcarEnviado/edição de itens em rascunho),
 * vitreIniciarNovaVersao, vitreRegistrarAprovacaoCliente e
 * vitreConfirmarVenda (functions/src/vitre.ts) contra o Firestore
 * Emulator real, via .run().
 *
 * Uso: node scripts/test_vitre_venda_confirmada.js
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { UID, ctx } = require('./e2e_shared_fixtures');
const {
  vitreCriarOuEditarProduto, vitreCriarOrcamento, vitreAtualizarOrcamento,
  vitreIniciarNovaVersao, vitreRegistrarAprovacaoCliente, vitreConfirmarVenda,
  vitreConverterOrcamentoParaOS,
} = require('../functions/lib/vitre.js');

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
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(trecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + trecho + '", obtido: ' + texto);
  }
}
function reqId() { return 'req_venda_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
async function limparProduto(sku) { await db.collection('vitre_produtos').doc(sku).delete().catch(function () {}); }
async function lerFinCR() {
  var doc = await db.collection('erp_vr').doc('fin_cr').get();
  if (!doc.exists || typeof doc.data().data !== 'string') return [];
  return JSON.parse(doc.data().data);
}

async function seedProduto(sku, precoVenda) {
  await vitreCriarOuEditarProduto.run({ sku: sku, nome: sku, status: 'ativo', custo: precoVenda / 2, precoVenda: precoVenda, requestId: reqId() }, ctx(UID.master, 'master'));
}
async function criarOrcamento(itens, clienteNome) {
  var r = await vitreCriarOrcamento.run({ clienteNome: clienteNome || ('E2E Venda ' + Date.now()), itens: itens, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
  return r;
}
async function enviarEAprovar(id) {
  await vitreAtualizarOrcamento.run({ id: id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
  await vitreRegistrarAprovacaoCliente.run({ id: id, status: 'aprovado' }, ctx(UID.comercial, 'comercial'));
}

console.log('\n=== Complemento — Envio → Pagamento → Confirmação da Venda → OS ===\n');

(async function main() {
  await test('1. Fluxo feliz completo: enviar → aprovar → pagamento entrada+saldo → confirmar venda → CR criado', async function () {
    var sku = 'E2E_VENDA_FELIZ_' + Date.now();
    await seedProduto(sku, 100);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'entrada_saldo', formaPagamento: 'PIX', parcelas: [{ valor: 40 }, { valor: 60 }] } }, ctx(UID.comercial, 'comercial'));
    var r = await vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.entradaCentavos, 4000);
    assertEq(r.saldoCentavos, 6000);
    assertEq(r.statusPagamento, 'pagamento_parcial');
    var doc = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    assertEq(doc.status, 'venda_confirmada');
    assertEq(doc.crIds.length, 2, 'deve criar 2 lançamentos de CR: entrada recebida + saldo pendente');
    var cr = await lerFinCR();
    var entradasCR = cr.filter(function (c) { return doc.crIds.indexOf(c.id) >= 0 && c.status === 'recebido'; });
    var saldosCR = cr.filter(function (c) { return doc.crIds.indexOf(c.id) >= 0 && c.status === 'pendente'; });
    assertEq(entradasCR.length, 1); assertEq(entradasCR[0].valor, 40); assertEq(entradasCR[0].marca, 'vitre');
    assertEq(saldosCR.length, 1); assertEq(saldosCR[0].valor, 60);
    await limparProduto(sku);
  });

  await test('2. Cenário de aceite: total R$448,50, entrada R$200,00, saldo R$248,50 — nenhum centavo perdido', async function () {
    var skuA = 'E2E_ACEITE_A_' + Date.now();
    var skuB = 'E2E_ACEITE_B_' + Date.now();
    await seedProduto(skuA, 125);
    await seedProduto(skuB, 195);
    var orc = await criarOrcamento([
      { sku: skuA, qtd: 2, acrescimo: { tipo: 'fixo', valor: 20, motivo: 'gravação' } },
      { sku: skuB, qtd: 1 },
    ]);
    // subtotal 445 + acréscimo 20 = 465; desconto 10% = 46.50; frete 30 → total 448.50
    await vitreAtualizarOrcamento.run({
      id: orc.id, itens: [{ sku: skuA, qtd: 2, acrescimo: { tipo: 'fixo', valor: 20, motivo: 'gravação' } }, { sku: skuB, qtd: 1 }],
      descontoPct: 10, frete: 30,
    }, ctx(UID.comercial, 'comercial'));
    var atualizado = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    assertEq(atualizado.total, 448.5, 'total do cenário de aceite após editar em rascunho');
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'entrada_saldo', formaPagamento: 'PIX', parcelas: [{ valor: 200 }, { valor: 248.5 }] } }, ctx(UID.comercial, 'comercial'));
    var r = await vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.entradaCentavos, 20000);
    assertEq(r.saldoCentavos, 24850);
    assertEq(r.entradaCentavos + r.saldoCentavos, r.totalCentavos, 'entrada + saldo = total, sem perder centavo');
    assertEq(r.totalCentavos, 44850);
    await limparProduto(skuA); await limparProduto(skuB);
  });

  await test('3. Gerar OS depois de confirmar a venda — CR recebe osRef', async function () {
    var sku = 'E2E_VENDA_OS_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: sku, status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'integral', formaPagamento: 'Dinheiro', parcelas: [{ valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    await vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.bloqueado, false);
    var os = (await db.collection('vitre_os').doc(r.id).get()).data();
    assertEq(os.statusPagamento, 'pago');
    var docFinal = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    var cr = await lerFinCR();
    var crDoOrc = cr.filter(function (c) { return docFinal.crIds.indexOf(c.id) >= 0; });
    crDoOrc.forEach(function (c) { assertTruthy(c.osRef, 'CR deve ter osRef preenchido depois da OS existir'); });
    await limparProduto(sku);
  });

  await test('4. Gerar OS ANTES de confirmar a venda → bloqueado (VENDA_NAO_CONFIRMADA)', async function () {
    var sku = 'E2E_VENDA_SEM_CONF_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await assertThrows(function () { return vitreConverterOrcamentoParaOS.run({ orcamentoId: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'VENDA_NAO_CONFIRMADA');
    await limparProduto(sku);
  });

  await test('5. Confirmar venda sem aprovação do cliente → ORCAMENTO_NAO_APROVADO', async function () {
    var sku = 'E2E_VENDA_SEM_APROV_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'integral', formaPagamento: 'PIX', parcelas: [{ valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'ORCAMENTO_NAO_APROVADO');
    await limparProduto(sku);
  });

  await test('6. Confirmar venda sem pagamento registrado → PAGAMENTO_NAO_REGISTRADO', async function () {
    var sku = 'E2E_VENDA_SEM_PGTO_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await assertThrows(function () { return vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'PAGAMENTO_NAO_REGISTRADO');
    await limparProduto(sku);
  });

  await test('7. Registrar recusa do cliente → status continua "enviado", aprovacao.status="recusado"', async function () {
    var sku = 'E2E_VENDA_RECUSA_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
    await vitreRegistrarAprovacaoCliente.run({ id: orc.id, status: 'recusado', observacao: 'preço alto' }, ctx(UID.comercial, 'comercial'));
    var doc = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    assertEq(doc.status, 'enviado');
    assertEq(doc.aprovacao.status, 'recusado');
    await limparProduto(sku);
  });

  await test('8. Nova versão depois de enviado — arquiva versão 1, volta para rascunho versão 2, permite editar itens de novo', async function () {
    var sku = 'E2E_VENDA_VERSAO_' + Date.now();
    await seedProduto(sku, 100);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
    var r = await vitreIniciarNovaVersao.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.versaoNova, 2);
    var doc = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    assertEq(doc.status, 'rascunho');
    assertEq(doc.versao, 2);
    var versaoArquivada = (await db.collection('vitre_orcamentos').doc(orc.id).collection('versoes').doc('1').get()).data();
    assertTruthy(versaoArquivada, 'versão 1 deve estar arquivada');
    assertEq(versaoArquivada.status, 'enviado');
    // agora dá para editar itens de novo (só é permitido em rascunho)
    await vitreAtualizarOrcamento.run({ id: orc.id, itens: [{ sku: sku, qtd: 3 }], descontoPct: 0, frete: 0 }, ctx(UID.comercial, 'comercial'));
    var doc2 = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    assertEq(doc2.total, 300);
    await limparProduto(sku);
  });

  await test('9. Nova versão bloqueada depois que a venda já foi confirmada', async function () {
    var sku = 'E2E_VENDA_VERSAO_BLOQ_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'integral', formaPagamento: 'PIX', parcelas: [{ valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    await vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreIniciarNovaVersao.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'ORCAMENTO_JA_AVANCOU_DEMAIS');
    await limparProduto(sku);
  });

  await test('10. Editar itens só é permitido em rascunho — bloqueado depois de enviado', async function () {
    var sku = 'E2E_VENDA_EDIT_BLOQ_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreAtualizarOrcamento.run({ id: orc.id, itens: [{ sku: sku, qtd: 2 }] }, ctx(UID.comercial, 'comercial')); }, 'SO_PODE_EDITAR_ITENS_EM_RASCUNHO');
    await limparProduto(sku);
  });

  await test('11. Marcar como enviado duas vezes sem nova versão → bloqueado', async function () {
    var sku = 'E2E_VENDA_REENVIO_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial')); }, 'SO_PODE_ENVIAR_A_PARTIR_DE_RASCUNHO');
    await limparProduto(sku);
  });

  await test('12. Versão aprovada divergente da versão atual — confirmar venda sem reaprovar depois de nova versão → bloqueado', async function () {
    var sku = 'E2E_VENDA_VERSAO_DIVERGE_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id); // aprova a versão 1
    await vitreIniciarNovaVersao.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')); // vira versão 2, aprovacao é zerada
    await vitreAtualizarOrcamento.run({ id: orc.id, itens: [{ sku: sku, qtd: 1 }] }, ctx(UID.comercial, 'comercial'));
    await vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
    // reaprova a versão 2 dessa vez (fluxo correto) — só para provar que SEM isso falharia, tentamos confirmar antes:
    var docSemAprov = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    assertEq(docSemAprov.aprovacao, null, 'nova versão deve ter zerado a aprovação anterior');
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'integral', formaPagamento: 'PIX', parcelas: [{ valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'ORCAMENTO_NAO_APROVADO');
    await limparProduto(sku);
  });

  await test('13. Pagamento tipo "futuro" é aceito (nada recebido agora)', async function () {
    var sku = 'E2E_VENDA_FUTURO_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'futuro', formaPagamento: 'Boleto', parcelas: [{ valor: 50, vencimento: '30/09/2026' }] } }, ctx(UID.comercial, 'comercial'));
    var r = await vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.entradaCentavos, 0);
    assertEq(r.saldoCentavos, 5000);
    assertEq(r.statusPagamento, 'pagamento_pendente');
    await limparProduto(sku);
  });

  await test('14. Confirmar a mesma venda duas vezes, requestIds DIFERENTES → chave de negócio (status) impede a segunda', async function () {
    var sku = 'E2E_VENDA_DUPLA_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'integral', formaPagamento: 'PIX', parcelas: [{ valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    await vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'VENDA_JA_CONFIRMADA');
    var cr = await lerFinCR();
    var doc = (await db.collection('vitre_orcamentos').doc(orc.id).get()).data();
    var crDoOrc = cr.filter(function (c) { return c.orcamentoId === orc.id; });
    assertEq(crDoOrc.length, 1, 'só 1 lançamento de CR — a segunda tentativa não deve duplicar nada');
    await limparProduto(sku);
  });

  await test('15. Duplo clique — mesmo requestId em vitreConfirmarVenda → idempotente, não duplica CR', async function () {
    var sku = 'E2E_VENDA_IDEM_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'integral', formaPagamento: 'PIX', parcelas: [{ valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    var rid = reqId();
    var r1 = await vitreConfirmarVenda.run({ id: orc.id, requestId: rid }, ctx(UID.comercial, 'comercial'));
    var r2 = await vitreConfirmarVenda.run({ id: orc.id, requestId: rid }, ctx(UID.comercial, 'comercial'));
    assertEq(r2.jaProcessado, true);
    var cr = await lerFinCR();
    var crDoOrc = cr.filter(function (c) { return c.orcamentoId === orc.id; });
    assertEq(crDoOrc.length, 1, 'retry com o MESMO requestId não deve duplicar o lançamento');
    await limparProduto(sku);
  });

  await test('16. Concorrência — duas confirmações de venda simultâneas, requestIds diferentes → exatamente uma sucede', async function () {
    var sku = 'E2E_VENDA_CONC_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await enviarEAprovar(orc.id);
    await vitreAtualizarOrcamento.run({ id: orc.id, pagamento: { tipo: 'integral', formaPagamento: 'PIX', parcelas: [{ valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    var resultados = await Promise.allSettled([
      vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')),
      vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.comercial, 'comercial')),
    ]);
    var sucessos = resultados.filter(function (r) { return r.status === 'fulfilled'; });
    var falhas = resultados.filter(function (r) { return r.status === 'rejected'; });
    assertEq(sucessos.length, 1, 'exatamente uma confirmação deve suceder');
    assertEq(falhas.length, 1);
    var cr = await lerFinCR();
    var crDoOrc = cr.filter(function (c) { return c.orcamentoId === orc.id; });
    assertEq(crDoOrc.length, 1, 'nunca duplica o lançamento financeiro por concorrência');
    await limparProduto(sku);
  });

  await test('17. Produção não pode registrar aprovação do cliente nem confirmar venda', async function () {
    var sku = 'E2E_VENDA_ROLE_' + Date.now();
    await seedProduto(sku, 50);
    var orc = await criarOrcamento([{ sku: sku, qtd: 1 }]);
    await vitreAtualizarOrcamento.run({ id: orc.id, marcarEnviado: true }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreRegistrarAprovacaoCliente.run({ id: orc.id, status: 'aprovado' }, ctx(UID.producao, 'producao')); }, 'permission-denied');
    await assertThrows(function () { return vitreConfirmarVenda.run({ id: orc.id, requestId: reqId() }, ctx(UID.producao, 'producao')); }, 'permission-denied');
    await limparProduto(sku);
  });

  console.log('\n=== Resultado: ' + passed + ' passou(aram), ' + failed + ' falhou(aram) ===\n');
  if (failed > 0) process.exit(1);
})();
