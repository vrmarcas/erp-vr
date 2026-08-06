/**
 * test_vitre_orcamento_hotfix.js
 *
 * hotfix orcamento-vitre-wizard (2026-08-06) — testa as Cloud Functions
 * reais do orçamento de Catálogo Vitre após a reescrita do cálculo em
 * centavos, acréscimos por item/global, plano de pagamento e o
 * fechamento de permissão (Produção não cria/atualiza orçamento
 * comercial), contra o Firestore/Functions Emulator real.
 *
 * Uso: node scripts/test_vitre_orcamento_hotfix.js
 * Pré-requisito: emulators (auth,firestore,functions) rodando para
 * demo-erp-homolog e node scripts/e2e_clean_env.js reset já executado.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { UID, ctx } = require('./e2e_shared_fixtures');
const { vitreCriarOrcamento, vitreAtualizarOrcamento } = require('../functions/lib/vitre.js');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
async function assertThrows(fn, trecho, msg) {
  try { await fn(); throw new Error((msg || 'esperava erro') + ' — nenhum erro lançado'); }
  catch (e) {
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(trecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + trecho + '", obtido: ' + texto);
  }
}
function reqId() { return 'req_hotfix_' + Date.now() + '_' + Math.random().toString(36).slice(2); }

async function seedProduto(sku, overrides) {
  await db.collection('vitre_produtos').doc(sku).set(Object.assign({
    sku: sku, nome: sku, marca: 'vitre', status: 'ativo', custo: 10, precoVenda: 100,
    descricaoCurta: 'x', embalagem: 'x', pesoKg: 1, comprimentoCm: 10,
    ativoErp: true, ativoValeria: false, origem: 'manual', criadoEm: Date.now(), atualizadoEm: Date.now(),
  }, overrides || {}));
}

console.log('\n=== hotfix orcamento-vitre-wizard — Cloud Functions reais (centavos, acréscimos, pagamento, permissão) ===\n');

(async function main() {
  await test('1. Item único R$125,00 x1 sem extras → total 125.00 (bug do subtotal R$0,00 corrigido no servidor)', async function () {
    await seedProduto('HOTFIX_BC002', { nome: 'Bandeja Cannes', custo: 60, precoVenda: 125 });
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Cliente 1', itens: [{ sku: 'HOTFIX_BC002', qtd: 1 }], requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 125);
    assertEq(r.totalCentavos, 12500);
  });

  await test('2. Cenário matemático de aceite: 2x R$125+acréscimo fixo R$20/item + 1x R$195 + desconto 10% + frete R$30 = R$448,50', async function () {
    await seedProduto('HOTFIX_BC002', { nome: 'Bandeja Cannes', custo: 60, precoVenda: 125 });
    await seedProduto('HOTFIX_APT001', { nome: 'Aparador Pequeno Trevo', custo: 100, precoVenda: 195 });
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Cliente Aceite',
      itens: [
        { sku: 'HOTFIX_BC002', qtd: 2, acrescimo: { tipo: 'fixo', valor: 20, motivo: 'gravação' } },
        { sku: 'HOTFIX_APT001', qtd: 1 },
      ],
      descontoPct: 10, frete: 30, requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 448.5, 'total do cenário de aceite');
    assertEq(r.totalCentavos, 44850);
  });

  await test('3. Acréscimo percentual aplicado sobre a base do item (não sobre o total do orçamento)', async function () {
    await seedProduto('HOTFIX_PCT', { nome: 'Produto Pct', custo: 10, precoVenda: 100 });
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Cliente Pct',
      itens: [{ sku: 'HOTFIX_PCT', qtd: 2, acrescimo: { tipo: 'pct', valor: 10, motivo: 'urgência' } }],
      requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    // base do item = 100*2 = 200; acréscimo 10% = 20; total = 220
    assertEq(r.totalCentavos, 22000);
  });

  await test('4. Acréscimo sem motivo é rejeitado para perfil Comercial', async function () {
    await seedProduto('HOTFIX_MOTIVO', { nome: 'Produto Motivo', precoVenda: 50 });
    await assertThrows(function () {
      return vitreCriarOrcamento.run({
        clienteNome: 'Cliente X', itens: [{ sku: 'HOTFIX_MOTIVO', qtd: 1, acrescimo: { tipo: 'fixo', valor: 10 } }], requestId: reqId(),
      }, ctx(UID.comercial, 'comercial'));
    }, 'motivo');
  });

  await test('5. Acréscimo sem motivo é PERMITIDO para Master', async function () {
    await seedProduto('HOTFIX_MOTIVO2', { nome: 'Produto Motivo 2', precoVenda: 50 });
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Cliente Y', itens: [{ sku: 'HOTFIX_MOTIVO2', qtd: 1, acrescimo: { tipo: 'fixo', valor: 10 } }], requestId: reqId(),
    }, ctx(UID.master, 'master'));
    assertEq(r.totalCentavos, 6000);
  });

  await test('6. Perfil Produção NÃO pode criar orçamento de catálogo (FASE 13 — fechamento de permissão)', async function () {
    await seedProduto('HOTFIX_PERM', { nome: 'Produto Perm', precoVenda: 50 });
    await assertThrows(function () {
      return vitreCriarOrcamento.run({
        clienteNome: 'Cliente Z', itens: [{ sku: 'HOTFIX_PERM', qtd: 1 }], requestId: reqId(),
      }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('7. Quantidade inválida (0, negativa, fracionária) é rejeitada', async function () {
    await seedProduto('HOTFIX_QTD', { nome: 'Produto Qtd', precoVenda: 50 });
    await assertThrows(function () {
      return vitreCriarOrcamento.run({ clienteNome: 'C', itens: [{ sku: 'HOTFIX_QTD', qtd: 0 }], requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'QTD_INVALIDA');
  });

  await test('8. Frete negativo é rejeitado', async function () {
    await seedProduto('HOTFIX_FRETE', { nome: 'Produto Frete', precoVenda: 50 });
    await assertThrows(function () {
      return vitreCriarOrcamento.run({ clienteNome: 'C', itens: [{ sku: 'HOTFIX_FRETE', qtd: 1 }], frete: -5, requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'invalid-argument');
  });

  var orcamentoParaPagamentoId = null;
  await test('9. Plano de pagamento: soma das parcelas diferente do total é rejeitada', async function () {
    await seedProduto('HOTFIX_PGTO', { nome: 'Produto Pgto', precoVenda: 100 });
    var r = await vitreCriarOrcamento.run({ clienteNome: 'Cliente Pgto', itens: [{ sku: 'HOTFIX_PGTO', qtd: 1 }], requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    orcamentoParaPagamentoId = r.id;
    await assertThrows(function () {
      return vitreAtualizarOrcamento.run({ id: orcamentoParaPagamentoId, pagamento: { tipo: 'entrada_saldo', parcelas: [{ valor: 40 }, { valor: 50 }] } }, ctx(UID.comercial, 'comercial'));
    }, 'SOMA_PARCELAS_DIFERENTE_DO_TOTAL');
  });

  await test('10. Plano de pagamento: soma correta é aceita e persistida', async function () {
    await vitreAtualizarOrcamento.run({ id: orcamentoParaPagamentoId, pagamento: { tipo: 'entrada_saldo', parcelas: [{ valor: 40 }, { valor: 60 }] } }, ctx(UID.comercial, 'comercial'));
    var doc = await db.collection('vitre_orcamentos').doc(orcamentoParaPagamentoId).get();
    assertEq(doc.data().pagamento.tipo, 'entrada_saldo');
    assertEq(doc.data().pagamento.parcelas.length, 2);
  });

  await test('11. Perfil Produção NÃO pode atualizar orçamento (pagamento/status) — FASE 13', async function () {
    await assertThrows(function () {
      return vitreAtualizarOrcamento.run({ id: orcamentoParaPagamentoId, status: 'cancelado' }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('12. Idempotência: mesmo requestId em vitreCriarOrcamento não duplica documento', async function () {
    await seedProduto('HOTFIX_IDEM', { nome: 'Produto Idem', precoVenda: 77 });
    var rid = reqId();
    var r1 = await vitreCriarOrcamento.run({ clienteNome: 'Cliente Idem', itens: [{ sku: 'HOTFIX_IDEM', qtd: 1 }], requestId: rid }, ctx(UID.comercial, 'comercial'));
    var r2 = await vitreCriarOrcamento.run({ clienteNome: 'Cliente Idem', itens: [{ sku: 'HOTFIX_IDEM', qtd: 1 }], requestId: rid }, ctx(UID.comercial, 'comercial'));
    assertEq(r2.jaProcessado, true);
    assertEq(r2.id, r1.id);
  });

  console.log('\n=== Resultado: ' + passed + ' passou(aram), ' + failed + ' falhou(aram) ===\n');
  if (failed > 0) process.exit(1);
})();
