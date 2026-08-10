/**
 * test_sprint_posauditoria_p1_4_p1_5_vitre_desconto_global_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.4/P1.5 — a auditoria read-only
 * encontrou que o orçamento Vitre tinha Acréscimo Global com dualidade
 * R$ fixo/% mas o Desconto Global só aceitava percentual (frontend E
 * backend), e que o desconto/acréscimo aplicado (mesmo só percentual)
 * aparecia explicitamente no PDF/WhatsApp enviados ao cliente — ambos
 * contrariando o requisito aprovado.
 *
 * Corrigido:
 * - normalizarDescontoGlobal()/calcularDescontoCentavos() (functions/src/
 *   vitre.ts, exportados) — Desconto Global agora aceita {tipo:'fixo'|
 *   'pct', valor}, mesma dualidade do Acréscimo Global, sempre validado/
 *   recalculado no servidor (nunca confia no total calculado pelo
 *   browser). 0 <= descontoCentavos <= baseCentavos sempre (nunca um
 *   desconto fixo maior que a própria base).
 * - Compatibilidade retroativa: documentos/chamadas antigas que só
 *   mandam descontoPct escalar continuam funcionando, sempre
 *   interpretadas como percentual — nunca quebram, nunca viram R$.
 * - index.html: campo único "Desconto (%)" virou par tipo/valor
 *   (vitreOrcDescontoTipo/vitreOrcDescontoValor), mesma UI do Acréscimo
 *   Global. PDF/WhatsApp Vitre pararam de mostrar as linhas de desconto/
 *   acréscimo (ajustes comerciais internos, nunca expostos ao cliente).
 *
 * Uso: FIRESTORE_EMULATOR_HOST etc. já configurados por padrão para
 * localhost — requer Firestore Emulator rodando (demo-erp-homolog) e
 * scripts/e2e_shared_fixtures disponível.
 *   node scripts/test_sprint_posauditoria_p1_4_p1_5_vitre_desconto_global_2026-08-09.js
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const fs = require('fs');
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
function reqId() { return 'req_p14_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
async function seedProduto(sku, precoVenda) {
  await db.collection('vitre_produtos').doc(sku).set({
    sku: sku, nome: sku, marca: 'vitre', status: 'ativo', custo: 10, precoVenda: precoVenda,
    descricaoCurta: 'x', embalagem: 'x', pesoKg: 1, comprimentoCm: 10,
    ativoErp: true, ativoValeria: false, origem: 'manual', criadoEm: Date.now(), atualizadoEm: Date.now(),
  });
}

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.4/P1.5 — Vitre: Desconto Global R$/% ===\n');

(async function main() {
  // ─────────────────────────────────────────────────────────────────────
  // 1-2. T7 do enunciado: subtotal R$1000, desconto R$100 → R$900;
  // desconto 10% → R$900.
  // ─────────────────────────────────────────────────────────────────────
  await test('1. T7 — subtotal R$1000, desconto R$100 (fixo) → total R$900,00 (nunca R$999,99 nem R$0,01 de diferença)', async function () {
    await seedProduto('P14_A', 1000);
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'T7 Fixo', itens: [{ sku: 'P14_A', qtd: 1 }],
      descontoGlobal: { tipo: 'fixo', valor: 100 }, requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 900);
    assertEq(r.totalCentavos, 90000);
  });

  await test('2. T7 — subtotal R$1000, desconto 10% (pct) → total R$900,00', async function () {
    await seedProduto('P14_B', 1000);
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'T7 Pct', itens: [{ sku: 'P14_B', qtd: 1 }],
      descontoGlobal: { tipo: 'pct', valor: 10 }, requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 900);
    assertEq(r.totalCentavos, 90000);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3-4. Compatibilidade retroativa — descontoPct escalar isolado
  // continua funcionando exatamente como antes (nunca quebra documentos/
  // chamadas antigas).
  // ─────────────────────────────────────────────────────────────────────
  await test('3. compat: descontoPct escalar isolado (sem descontoGlobal) — interpretado como percentual, resultado idêntico ao novo formato', async function () {
    await seedProduto('P14_C', 1000);
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Legado', itens: [{ sku: 'P14_C', qtd: 1 }],
      descontoPct: 10, requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 900);
  });

  await test('4. sem desconto algum (nem descontoGlobal nem descontoPct) — total = subtotal, sem erro', async function () {
    await seedProduto('P14_D', 500);
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Sem desconto', itens: [{ sku: 'P14_D', qtd: 1 }], requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 500);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5-8. Validação server-side — nunca confia no cálculo do browser.
  // ─────────────────────────────────────────────────────────────────────
  await test('5. desconto fixo MAIOR que a base é bloqueado (DESCONTO_MAIOR_QUE_BASE) — nunca total negativo', async function () {
    await seedProduto('P14_E', 100);
    await assertThrows(function () {
      return vitreCriarOrcamento.run({
        clienteNome: 'Excesso', itens: [{ sku: 'P14_E', qtd: 1 }],
        descontoGlobal: { tipo: 'fixo', valor: 500 }, requestId: reqId(),
      }, ctx(UID.comercial, 'comercial'));
    }, 'DESCONTO_MAIOR_QUE_BASE');
  });

  await test('6. desconto percentual > 100% é rejeitado', async function () {
    await seedProduto('P14_F', 100);
    await assertThrows(function () {
      return vitreCriarOrcamento.run({
        clienteNome: 'Pct Inválido', itens: [{ sku: 'P14_F', qtd: 1 }],
        descontoGlobal: { tipo: 'pct', valor: 150 }, requestId: reqId(),
      }, ctx(UID.comercial, 'comercial'));
    }, 'invalid-argument');
  });

  await test('7. tipo de desconto inválido (nem fixo nem pct) é rejeitado', async function () {
    await seedProduto('P14_G', 100);
    await assertThrows(function () {
      return vitreCriarOrcamento.run({
        clienteNome: 'Tipo Inválido', itens: [{ sku: 'P14_G', qtd: 1 }],
        descontoGlobal: { tipo: 'porcento', valor: 10 }, requestId: reqId(),
      }, ctx(UID.comercial, 'comercial'));
    }, 'invalid-argument');
  });

  await test('8. valor de desconto negativo é rejeitado', async function () {
    await seedProduto('P14_H', 100);
    await assertThrows(function () {
      return vitreCriarOrcamento.run({
        clienteNome: 'Negativo', itens: [{ sku: 'P14_H', qtd: 1 }],
        descontoGlobal: { tipo: 'fixo', valor: -10 }, requestId: reqId(),
      }, ctx(UID.comercial, 'comercial'));
    }, 'invalid-argument');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 9-10. Salvar → Reabrir → mesmo resultado (T7 "Salvar. Reabrir.
  // Mesmo resultado.") — o documento persistido tem descontoGlobal
  // fielmente gravado, e uma atualização (equivalente a reabrir e
  // editar) preserva/recalcula corretamente.
  // ─────────────────────────────────────────────────────────────────────
  await test('9. salvar → reabrir: descontoGlobal persistido fielmente (tipo e valor exatos)', async function () {
    await seedProduto('P14_I', 1000);
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Persiste', itens: [{ sku: 'P14_I', qtd: 1 }],
      descontoGlobal: { tipo: 'fixo', valor: 250 }, requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    var doc = await db.collection('vitre_orcamentos').doc(r.id).get();
    assertEq(doc.data().descontoGlobal, { tipo: 'fixo', valor: 250 });
    assertEq(doc.data().total, 750);
    // compat: descontoPct derivado também gravado (0, já que é fixo — nunca confunde com %)
    assertEq(doc.data().descontoPct, 0);
  });

  await test('10. editar rascunho (equivalente a reabrir e trocar) — descontoGlobal atualizado corretamente, total recalculado', async function () {
    await seedProduto('P14_J', 1000);
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Editar', itens: [{ sku: 'P14_J', qtd: 1 }],
      descontoGlobal: { tipo: 'pct', valor: 10 }, requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 900);
    await vitreAtualizarOrcamento.run({
      id: r.id, itens: [{ sku: 'P14_J', qtd: 1 }], descontoGlobal: { tipo: 'fixo', valor: 200 },
    }, ctx(UID.comercial, 'comercial'));
    var doc = await db.collection('vitre_orcamentos').doc(r.id).get();
    assertEq(doc.data().descontoGlobal, { tipo: 'fixo', valor: 200 });
    assertEq(doc.data().total, 800);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 11. Paridade — acréscimo global e desconto global usam a mesma
  // matemática (só o sinal muda), confirmando que a dualidade é
  // simétrica entre os dois.
  // ─────────────────────────────────────────────────────────────────────
  await test('11. desconto fixo e acréscimo fixo de mesmo valor se anulam (R$1000 +100 -100 = R$1000)', async function () {
    await seedProduto('P14_K', 1000);
    var r = await vitreCriarOrcamento.run({
      clienteNome: 'Anula', itens: [{ sku: 'P14_K', qtd: 1 }],
      acrescimoGlobal: { tipo: 'fixo', valor: 100, motivo: 'teste' },
      descontoGlobal: { tipo: 'fixo', valor: 100 }, requestId: reqId(),
    }, ctx(UID.comercial, 'comercial'));
    assertEq(r.total, 1000);
  });

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');

  // ─────────────────────────────────────────────────────────────────────
  // 12-14. P1.5 — estrutural: PDF/WhatsApp Vitre não expõem mais
  // desconto/acréscimo ao cliente (verificação de código, sem depender
  // do emulator).
  // ─────────────────────────────────────────────────────────────────────
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  function extractFn(name) {
    var marker = 'function ' + name + '(';
    var start = html.indexOf(marker);
    if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
    var braceOpen = html.indexOf('{', start);
    var depth = 0, i = braceOpen;
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
    return html.slice(start, i + 1);
  }
  var srcPdf = extractFn('vitreOrcGerarPDF');
  var srcWA = extractFn('vitreOrcEnviarWhatsApp');
  var p5a = !/descLinhaVitre/.test(srcPdf) && !/acrescLinha/.test(srcPdf);
  var p5b = !/o\.descontoPct > 0.*Desconto/.test(srcWA);
  if (p5a) { console.log('  ✅  12. vitreOrcGerarPDF() não referencia mais descLinhaVitre/acrescLinha (desconto/acréscimo removidos do PDF do cliente)'); passed++; }
  else { console.log('  ❌  12. PDF ainda referencia desconto/acréscimo'); failed++; }
  var p5c = !/if \(o\.descontoPct > 0\) condLinhasVitre/.test(srcWA);
  if (p5c) { console.log('  ✅  13. vitreOrcEnviarWhatsApp() não adiciona mais linha de desconto à mensagem do cliente'); passed++; }
  else { console.log('  ❌  13. WhatsApp ainda adiciona linha de desconto'); failed++; }
  var srcHtml = html.slice(html.indexOf('id="vitreOrcDescontoTipo"') - 50, html.indexOf('id="vitreOrcDescontoTipo"') + 400);
  var p5d = /R\$ fixo/.test(srcHtml) && /value="pct"/.test(srcHtml);
  if (p5d) { console.log('  ✅  14. HTML do Desconto Global Vitre tem as opções R$ fixo e % (mesma dualidade do Acréscimo Global)'); passed++; }
  else { console.log('  ❌  14. HTML do Desconto Global não tem a dualidade R$/%'); failed++; }

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO FINAL: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})();
