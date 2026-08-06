/**
 * test_vitre_os_server.js
 *
 * FASE G — Parte 9 da homologação guiada (2026-08-06): testa
 * vitreConverterOrcamentoParaOS (functions/src/vitre.ts) contra o
 * Firestore Emulator real, via .run(). Cobre os 3 caminhos exigidos
 * pela instrução (pronta entrega / produzido após o pedido / ficha
 * incompleta), o comportamento fail-closed quando os itens de um
 * mesmo orçamento caem em caminhos diferentes, idempotência e
 * concorrência na conversão do MESMO orçamento.
 *
 * Uso: node scripts/test_vitre_os_server.js
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { UID, ctx } = require('./e2e_shared_fixtures');
const {
  vitreCriarOuEditarProduto, vitreCriarOrcamento, vitreConverterOrcamentoParaOS,
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
function reqId() { return 'req_osfix_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
async function limparProduto(sku) { await db.collection('vitre_produtos').doc(sku).delete().catch(function () {}); }

var FICHA_COMPLETA = { componentes: [{ nome: 'Tampo', material: 'Acrílico Cristal', espessuraMm: 10, qtd: 1 }], tempoCorteMin: 12, tempoMontagemMin: 20 };
var ARQUIVO_CORTE = { caminho: 'cortes/E2E_OS_teste.dxf', versao: 1, checksum: 'abc123' };

async function criarOrcamento(sku, qtd) {
  var r = await vitreCriarOrcamento.run({ clienteNome: 'E2E OS Cliente ' + Date.now(), itens: [{ sku: sku, qtd: qtd }], requestId: reqId() }, ctx(UID.comercial, 'comercial'));
  return r.id;
}
async function criarOrcamentoMultiItem(itens) {
  var r = await vitreCriarOrcamento.run({ clienteNome: 'E2E OS Multi ' + Date.now(), itens: itens, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
  return r.id;
}

console.log('\n=== FASE G — Parte 9: conversão de orçamento Vitre em OS ===\n');

(async function main() {
  await test('1. Item com estoqueProntoUnidades suficiente → classificado pronta_entrega, estoque baixado, OS pronta_expedicao', async function () {
    var sku = 'E2E_OS_PRONTA_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Teste Pronta Entrega', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 3, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 2);
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.bloqueado, false, 'não deveria bloquear');
    assertEq(r.itens[0].tipo, 'pronta_entrega');
    var prod = (await db.collection('vitre_produtos').doc(sku).get()).data();
    assertEq(prod.estoqueProntoUnidades, 1, 'deveria ter baixado 2 de 3');
    var os = (await db.collection('vitre_os').doc(r.id).get()).data();
    assertEq(os.status, 'pronta_expedicao');
    await limparProduto(sku);
  });

  await test('2. Item sem estoque mas com ficha técnica completa → produzido_apos_pedido, ficha copiada, OS aguardando_producao', async function () {
    var sku = 'E2E_OS_PRODUZIDO_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Teste Produzido', status: 'ativo', custo: 10, precoVenda: 50, prazoDias: 7, fichaTecnica: FICHA_COMPLETA, arquivoCorte: ARQUIVO_CORTE, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.bloqueado, false);
    assertEq(r.itens[0].tipo, 'produzido_apos_pedido');
    assertEq(r.itens[0].fichaTecnicaSnapshot.componentes[0].material, 'Acrílico Cristal', 'ficha técnica deve ser copiada por snapshot');
    assertEq(r.itens[0].arquivoCorteRef.caminho, ARQUIVO_CORTE.caminho, 'arquivo de corte é referenciado, não executado');
    var os = (await db.collection('vitre_os').doc(r.id).get()).data();
    assertEq(os.status, 'aguardando_producao');
    await limparProduto(sku);
  });

  await test('3. Item sem estoque e sem ficha técnica completa → ficha_incompleta, conversão bloqueada, nenhuma OS criada', async function () {
    var sku = 'E2E_OS_INCOMPLETA_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Teste Incompleto', status: 'ativo', custo: 10, precoVenda: 50, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.bloqueado, true);
    assertEq(r.itens[0].tipo, 'ficha_incompleta');
    assertTruthy(r.itens[0].motivoBloqueio, 'deve explicar o motivo, nunca inventar dado');
    var orc = (await db.collection('vitre_orcamentos').doc(orcId).get()).data();
    assertEq(orc.status, 'rascunho', 'orçamento não deve mudar de status quando bloqueado');
    assertEq(orc.osId, undefined, 'nenhuma OS deve ser vinculada');
    await limparProduto(sku);
  });

  await test('4. Fail-closed misto — um item pronta_entrega + um item ficha_incompleta → conversão BLOQUEADA inteira, estoque do item bom NÃO é baixado', async function () {
    var skuBom = 'E2E_OS_MISTO_BOM_' + Date.now();
    var skuRuim = 'E2E_OS_MISTO_RUIM_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: skuBom, nome: 'Bom', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    await vitreCriarOuEditarProduto.run({ sku: skuRuim, nome: 'Ruim', status: 'ativo', custo: 10, precoVenda: 50, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamentoMultiItem([{ sku: skuBom, qtd: 1 }, { sku: skuRuim, qtd: 1 }]);
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.bloqueado, true, 'um item ruim deve bloquear TUDO — nunca conversão parcial');
    var prodBom = (await db.collection('vitre_produtos').doc(skuBom).get()).data();
    assertEq(prodBom.estoqueProntoUnidades, 5, 'estoque do item bom não pode ser tocado se a conversão como um todo foi bloqueada');
    await limparProduto(skuBom); await limparProduto(skuRuim);
  });

  await test('5. Item misto automatizável (pronta_entrega + produzido_apos_pedido) → OS status mista_aguardando_producao', async function () {
    var skuPronto = 'E2E_OS_MISTA2_PRONTO_' + Date.now();
    var skuProd = 'E2E_OS_MISTA2_PROD_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: skuPronto, nome: 'Pronto', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 2, requestId: reqId() }, ctx(UID.master, 'master'));
    await vitreCriarOuEditarProduto.run({ sku: skuProd, nome: 'Produzir', status: 'ativo', custo: 10, precoVenda: 50, fichaTecnica: FICHA_COMPLETA, arquivoCorte: ARQUIVO_CORTE, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamentoMultiItem([{ sku: skuPronto, qtd: 1 }, { sku: skuProd, qtd: 1 }]);
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.bloqueado, false);
    var os = (await db.collection('vitre_os').doc(r.id).get()).data();
    assertEq(os.status, 'mista_aguardando_producao');
    await limparProduto(skuPronto); await limparProduto(skuProd);
  });

  await test('6. Produto removido do catálogo depois do orçamento → bloqueado, tipo produto_removido', async function () {
    var sku = 'E2E_OS_REMOVIDO_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Será removido', status: 'ativo', custo: 10, precoVenda: 50, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    await db.collection('vitre_produtos').doc(sku).delete();
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.bloqueado, true);
    assertEq(r.itens[0].tipo, 'produto_removido');
  });

  await test('7. Orçamento já convertido → segunda tentativa de conversão negada (ORCAMENTO_EM_ESTADO_FINAL)', async function () {
    var sku = 'E2E_OS_DUPLA_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Dupla', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'ORCAMENTO_EM_ESTADO_FINAL');
    await limparProduto(sku);
  });

  await test('8. Orçamento cancelado → conversão negada', async function () {
    var sku = 'E2E_OS_CANCEL_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Cancelado', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    var { vitreAtualizarOrcamento } = require('../functions/lib/vitre.js');
    await vitreAtualizarOrcamento.run({ id: orcId, status: 'cancelado' }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () { return vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial')); }, 'ORCAMENTO_EM_ESTADO_FINAL');
    await limparProduto(sku);
  });

  await test('9. Produção → negado (não converte; só Comercial/Master, mesma fronteira de leitura de vitre_orcamentos)', async function () {
    var sku = 'E2E_OS_ROLE_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Role', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    await assertThrows(function () { return vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.producao, 'producao')); }, 'permission-denied');
    await limparProduto(sku);
  });

  await test('10. Master → permitido (bypass universal)', async function () {
    var sku = 'E2E_OS_MASTER_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'MasterConv', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    var r = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r.bloqueado, false);
    await limparProduto(sku);
  });

  await test('11. Mesmo requestId duas vezes (duplo clique) → idempotente, não gera segunda OS nem baixa estoque duas vezes', async function () {
    var sku = 'E2E_OS_IDEM_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Idem', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    var rid = reqId();
    var r1 = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: rid }, ctx(UID.comercial, 'comercial'));
    var r2 = await vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: rid }, ctx(UID.comercial, 'comercial'));
    assertEq(r2.jaProcessado, true);
    assertEq(r2.id, r1.id, 'mesma OS, não duplicada');
    var prod = (await db.collection('vitre_produtos').doc(sku).get()).data();
    assertEq(prod.estoqueProntoUnidades, 4, 'estoque baixado só UMA vez (5-1=4), não duas');
    await limparProduto(sku);
  });

  await test('12. Concorrência — duas conversões do MESMO orçamento simultâneas, sem requestId compartilhado → exatamente uma sucede, a outra falha (transação serializa)', async function () {
    var sku = 'E2E_OS_CONC_' + Date.now();
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Conc', status: 'ativo', custo: 10, precoVenda: 50, estoqueProntoUnidades: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcId = await criarOrcamento(sku, 1);
    var resultados = await Promise.allSettled([
      vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial')),
      vitreConverterOrcamentoParaOS.run({ orcamentoId: orcId, requestId: reqId() }, ctx(UID.comercial, 'comercial')),
    ]);
    var sucessos = resultados.filter(function (r) { return r.status === 'fulfilled'; });
    var falhas = resultados.filter(function (r) { return r.status === 'rejected'; });
    assertEq(sucessos.length, 1, 'exatamente uma conversão deve suceder');
    assertEq(falhas.length, 1, 'a outra deve falhar (orçamento já em estado final)');
    var prod = (await db.collection('vitre_produtos').doc(sku).get()).data();
    assertEq(prod.estoqueProntoUnidades, 4, 'estoque baixado só uma vez, nunca duas (nunca fica negativo/duplicado)');
    await limparProduto(sku);
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
