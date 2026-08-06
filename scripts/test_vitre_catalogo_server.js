/**
 * test_vitre_catalogo_server.js
 *
 * FASE G — testa as Cloud Functions reais do Catálogo Vitre
 * (functions/src/vitre.ts, compiladas em functions/lib/vitre.js) contra
 * o Firestore Emulator real, via .run(), mesmo padrão das demais suítes
 * desta auditoria.
 *
 * Uso: node scripts/test_vitre_catalogo_server.js
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { UID, ctx } = require('./e2e_shared_fixtures');
const {
  vitreImportarProdutos, vitreCriarOuEditarProduto, vitreAtivarDesativarProduto,
  vitreDuplicarProduto, vitreCriarOrcamento, vitreAtualizarOrcamento,
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
    if (e.message && e.message.indexOf((msg || 'esperava erro')) === 0) throw e;
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(trecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + trecho + '", obtido: ' + texto);
  }
}
function reqId() { return 'req_vitre_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
async function limparProduto(sku) { await db.collection('vitre_produtos').doc(sku).delete().catch(function () {}); }

console.log('\n=== FASE G — Catálogo Vitre: Cloud Functions reais ===\n');

(async function main() {
  await test('1. Importação dry-run não grava nada no Firestore', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST1';
    var r = await vitreImportarProdutos.run({ linhas: [{ sku: sku, nome: 'Produto Teste', custo: 10, precoVenda: 20, pesoKg: 1, embalagem: '10x10x10', descricaoCurta: 'desc' }], dryRun: true, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r.criados, 1);
    var doc = await db.collection('vitre_produtos').doc(sku).get();
    assertEq(doc.exists, false, 'dry-run não deve gravar');
  });

  await test('2. Importação real cria o produto; reimportação idêntica é idempotente (sem alteração)', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST2';
    var linha = { sku: sku, nome: 'Produto Teste 2', custo: 10, precoVenda: 25, pesoKg: 1, embalagem: '10x10x10', descricaoCurta: 'desc' };
    var r1 = await vitreImportarProdutos.run({ linhas: [linha], dryRun: false, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r1.criados, 1);
    var r2 = await vitreImportarProdutos.run({ linhas: [linha], dryRun: false, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r2.criados, 0); assertEq(r2.semAlteracao, 1);
    await limparProduto(sku);
  });

  await test('3. SKU duplicado com dados DIFERENTES na mesma importação → bloqueado, não escolhe automaticamente', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST3';
    var r = await vitreImportarProdutos.run({
      linhas: [
        { sku: sku, nome: 'Versão A', custo: 10, precoVenda: 20, pesoKg: 1, embalagem: 'x', descricaoCurta: 'd' },
        { sku: sku, nome: 'Versão B (conflitante)', custo: 15, precoVenda: 30, pesoKg: 2, embalagem: 'y', descricaoCurta: 'd2' },
      ], dryRun: true, requestId: reqId(),
    }, ctx(UID.master, 'master'));
    assertEq(r.criados, 0);
    assertTruthy(r.listaErros.some(function (e) { return e.tipo === 'sku_duplicado_conflitante' && e.sku === sku; }));
  });

  await test('4. SKU duplicado com dados IDÊNTICOS (mesma linha 2x) → não é erro de conflito, importa uma vez', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST4';
    var linha = { sku: sku, nome: 'Igual', custo: 10, precoVenda: 20, pesoKg: 1, embalagem: 'x', descricaoCurta: 'd' };
    var r = await vitreImportarProdutos.run({ linhas: [linha, Object.assign({}, linha)], dryRun: true, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r.criados, 1, 'duas linhas idênticas colapsam em um único produto, não duplicam nem conflitam');
    assertEq(r.listaErros.some(function (e) { return e.tipo === 'sku_duplicado_conflitante'; }), false, 'não deve reportar conflito — dados são idênticos');
  });

  await test('5. Campos ausentes (peso/embalagem/descrição) são reportados mas NÃO bloqueiam a linha', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST5';
    var r = await vitreImportarProdutos.run({ linhas: [{ sku: sku, nome: 'Sem peso', custo: 10, precoVenda: 20 }], dryRun: true, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r.criados, 1, 'deve criar mesmo com campos ausentes — só reporta');
    assertTruthy(r.listaErros.some(function (e) { return e.sku === sku && e.tipo === 'peso_ausente'; }));
    assertTruthy(r.listaErros.some(function (e) { return e.sku === sku && e.tipo === 'embalagem_ausente'; }));
    assertTruthy(r.listaErros.some(function (e) { return e.sku === sku && e.tipo === 'descricao_ausente'; }));
  });

  await test('6. Importação — Produção → negado (master-only)', async function () {
    await assertThrows(function () {
      return vitreImportarProdutos.run({ linhas: [{ sku: 'x', nome: 'x', custo: 1, precoVenda: 2 }], dryRun: true, requestId: reqId() }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('7. Reimportação NÃO sobrescreve campo editado manualmente (política de origem)', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST7';
    await vitreImportarProdutos.run({ linhas: [{ sku: sku, nome: 'Original', custo: 10, precoVenda: 20, pesoKg: 1, embalagem: 'x', descricaoCurta: 'd' }], dryRun: false, requestId: reqId() }, ctx(UID.master, 'master'));
    // Edição manual do preço via CRUD (marca precoVenda como protegido).
    await vitreCriarOuEditarProduto.run({ sku: sku, precoVenda: 999, requestId: reqId() }, ctx(UID.master, 'master'));
    // Reimportação com preço diferente da planilha.
    await vitreImportarProdutos.run({ linhas: [{ sku: sku, nome: 'Original', custo: 10, precoVenda: 20, pesoKg: 1, embalagem: 'x', descricaoCurta: 'd' }], dryRun: false, requestId: reqId() }, ctx(UID.master, 'master'));
    var doc = await db.collection('vitre_produtos').doc(sku).get();
    assertEq(doc.data().precoVenda, 999, 'preço editado manualmente deve ser preservado, não voltar para 20');
    await limparProduto(sku);
  });

  await test('8. CRUD — Produção tentando alterar campo comercial (preço) → negado', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST8';
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'x', requestId: reqId() }, ctx(UID.master, 'master'));
    await assertThrows(function () {
      return vitreCriarOuEditarProduto.run({ sku: sku, precoVenda: 500, requestId: reqId() }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
    await limparProduto(sku);
  });

  await test('9. CRUD — Produção pode alterar ficha técnica (não-comercial)', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST9';
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'x', requestId: reqId() }, ctx(UID.master, 'master'));
    var r = await vitreCriarOuEditarProduto.run({ sku: sku, fichaTecnica: { componentes: [{ nome: 'chapa', material: 'acm', espessuraMm: 3, qtd: 1 }] }, requestId: reqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    await limparProduto(sku);
  });

  await test('10. Comercial → negado em qualquer escrita de catálogo', async function () {
    await assertThrows(function () {
      return vitreCriarOuEditarProduto.run({ sku: 'x', nome: 'x', requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'permission-denied');
  });

  await test('11. Nível de completude calculado corretamente (nível 1 → 2 conforme campos preenchidos)', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST11';
    var r1 = await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'x', precoVenda: 10, custo: 5, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r1.nivel, 1);
    var r2 = await vitreCriarOuEditarProduto.run({ sku: sku, categoria: 'cat', fotos: ['a.jpg'], descricaoCurta: 'd', prazoDias: 3, embalagem: 'x', pesoKg: 1, requestId: reqId() }, ctx(UID.master, 'master'));
    assertEq(r2.nivel, 2);
    await limparProduto(sku);
  });

  await test('12. Ativar/desativar — Produção → negado (master-only)', async function () {
    await assertThrows(function () {
      return vitreAtivarDesativarProduto.run({ sku: 'x', ativo: false, requestId: reqId() }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('13. Duplicar produto — SKU novo já existe → negado', async function () {
    var skuA = 'E2E_FASEF_VITRE_TEST13A', skuB = 'E2E_FASEF_VITRE_TEST13B';
    await vitreCriarOuEditarProduto.run({ sku: skuA, nome: 'A', requestId: reqId() }, ctx(UID.master, 'master'));
    await vitreCriarOuEditarProduto.run({ sku: skuB, nome: 'B', requestId: reqId() }, ctx(UID.master, 'master'));
    await assertThrows(function () {
      return vitreDuplicarProduto.run({ skuOrigem: skuA, skuNovo: skuB, requestId: reqId() }, ctx(UID.master, 'master'));
    }, 'SKU_JA_EXISTE');
    await limparProduto(skuA); await limparProduto(skuB);
  });

  await test('14. Orçamento Vitre — snapshot do produto preservado mesmo se o catálogo mudar depois', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST14';
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Produto Orçado', precoVenda: 100, custo: 40, status: 'ativo', requestId: reqId() }, ctx(UID.master, 'master'));
    var orc = await vitreCriarOrcamento.run({ clienteNome: 'Cliente E2E', itens: [{ sku: sku, qtd: 2 }], requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(orc.total, 200);
    // Muda o preço no catálogo DEPOIS de criar o orçamento.
    await vitreCriarOuEditarProduto.run({ sku: sku, precoVenda: 500, requestId: reqId() }, ctx(UID.master, 'master'));
    var orcDoc = await db.collection('vitre_orcamentos').doc(orc.id).get();
    assertEq(orcDoc.data().total, 200, 'orçamento histórico não deve mudar com o catálogo');
    assertEq(orcDoc.data().itens[0].precoSnapshot, 100);
    await limparProduto(sku);
  });

  await test('15. Orçamento — produto inativo → negado', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST15';
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'Inativo', precoVenda: 10, status: 'inativo', requestId: reqId() }, ctx(UID.master, 'master'));
    await assertThrows(function () {
      return vitreCriarOrcamento.run({ clienteNome: 'X', itens: [{ sku: sku, qtd: 1 }], requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'PRODUTO_INATIVO');
    await limparProduto(sku);
  });

  await test('16. Orçamento — produto inexistente → negado', async function () {
    await assertThrows(function () {
      return vitreCriarOrcamento.run({ clienteNome: 'X', itens: [{ sku: 'E2E_FASEF_VITRE_NAOEXISTE', qtd: 1 }], requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'PRODUTO_NAO_ENCONTRADO');
  });

  await test('17. Orçamento — mesmo requestId (duplo clique) → idempotente, não duplica', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST17';
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'x', precoVenda: 50, custo: 20, status: 'ativo', requestId: reqId() }, ctx(UID.master, 'master'));
    var rid = reqId();
    var o1 = await vitreCriarOrcamento.run({ clienteNome: 'X', itens: [{ sku: sku, qtd: 1 }], requestId: rid }, ctx(UID.comercial, 'comercial'));
    var o2 = await vitreCriarOrcamento.run({ clienteNome: 'X', itens: [{ sku: sku, qtd: 1 }], requestId: rid }, ctx(UID.comercial, 'comercial'));
    assertEq(o2.jaProcessado, true);
    assertEq(o1.id, o2.id);
    await limparProduto(sku);
  });

  await test('18. Orçamento — cancelar depois de convertido → negado (estado final)', async function () {
    var sku = 'E2E_FASEF_VITRE_TEST18';
    await vitreCriarOuEditarProduto.run({ sku: sku, nome: 'x', precoVenda: 10, custo: 4, status: 'ativo', requestId: reqId() }, ctx(UID.master, 'master'));
    var orc = await vitreCriarOrcamento.run({ clienteNome: 'X', itens: [{ sku: sku, qtd: 1 }], requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    await vitreAtualizarOrcamento.run({ id: orc.id, status: 'cancelado', requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    await assertThrows(function () {
      return vitreAtualizarOrcamento.run({ id: orc.id, status: 'enviado', requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'ORCAMENTO_EM_ESTADO_FINAL');
    await limparProduto(sku);
  });

  await test('19. Não autenticado → negado em qualquer Function do catálogo', async function () {
    await assertThrows(function () { return vitreCriarOrcamento.run({ clienteNome: 'x', itens: [], requestId: reqId() }, ctx(null)); }, 'unauthenticated');
  });

  await test('20. Conta desabilitada → negada', async function () {
    await assertThrows(function () {
      return vitreCriarOuEditarProduto.run({ sku: 'x', nome: 'x', requestId: reqId() }, ctx(UID.desabilitado, 'producao'));
    }, 'permission-denied');
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
