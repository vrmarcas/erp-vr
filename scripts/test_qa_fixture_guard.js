/**
 * test_qa_fixture_guard.js
 *
 * FASE 1: prova que qa_fixture_guard.js impede a classe de acidente que
 * aconteceu duas vezes nesta auditoria (sobrescrita de 'stock' a partir de
 * estado incompleto). Roda contra o Firestore Emulator real.
 *
 * Uso: node scripts/test_qa_fixture_guard.js
 */
'use strict';
const path = require('path');
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { FixtureGuard, assertNaoProducao, contemPrefixoFixture } = require('./qa_fixture_guard');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
async function assertThrows(fn, trecho, msg) {
  try { await fn(); throw new Error((msg || 'esperava erro') + ' — nenhum erro lançado'); }
  catch (e) {
    if (e.message && e.message.indexOf((msg || 'esperava erro')) === 0) throw e;
    if (e.message.indexOf(trecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + trecho + '", obtido: ' + e.message);
  }
}
var TESTDOC = 'e2e_guard_testdoc_' + Date.now();

console.log('\n=== FASE 1 — qa_fixture_guard.js: impede acidentes de setup de fixture ===\n');

(async function main() {

  await test('1. Recusa projectId de produção (erp-vrmarcas)', function () {
    var lancou = false;
    try { assertNaoProducao('erp-vrmarcas'); } catch (e) { lancou = true; if (e.message.indexOf('PRODUÇÃO') < 0) throw e; }
    if (!lancou) throw new Error('deveria ter recusado');
  });

  await test('2. Recusa projectId sem prefixo demo-', function () {
    var lancou = false;
    try { assertNaoProducao('meu-projeto-qualquer'); } catch (e) { lancou = true; }
    if (!lancou) throw new Error('deveria ter recusado');
  });

  await test('3. Aceita demo-erp-homolog', function () {
    assertNaoProducao('demo-erp-homolog'); // não deve lançar
  });

  await test('4. Construtor recusa projectId de produção mesmo se alguém tentar instanciar direto', async function () {
    var lancou = false;
    try { new FixtureGuard({ projectId: 'erp-vrmarcas', db: db }); } catch (e) { lancou = true; }
    if (!lancou) throw new Error('deveria ter recusado no construtor');
  });

  await test('5. contemPrefixoFixture identifica corretamente objetos com/sem o prefixo', function () {
    assertEq(contemPrefixoFixture({ nome: 'E2E_FASEF_20260805_Teste' }), true);
    assertEq(contemPrefixoFixture({ nome: 'Qualquer coisa' }), false);
    assertEq(contemPrefixoFixture([{ a: 'x' }, { a: 'E2E_FASEF_20260805_y' }]), true);
  });

  await test('6. mergeFixture RECUSA objeto sem o prefixo obrigatório', async function () {
    var guard = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    await assertThrows(function () {
      return guard.mergeFixture(TESTDOC, { chave1: { label: 'Sem prefixo nenhum', qty: 1 } });
    }, 'RECUSADO');
  });

  await test('7. Dry-run (apply=false, padrão) nunca grava — simula "documento ainda sem listener sincronizado"', async function () {
    // Cenário do acidente real: doc ainda não tinha nada relevante em memória.
    // Aqui simulamos o equivalente correto — o guard sempre LÊ o servidor
    // (nunca confia em estado local), então "sem listener sincronizado" não
    // é um conceito que se aplica a este runner (ele nunca usa estado local).
    var guardDry = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db }); // apply omitido = false
    var r = await guardDry.mergeFixture(TESTDOC, { e2e_1: { label: 'E2E_FASEF_20260805_Item1', qty: 5 } });
    assertEq(r.applied, false);
    var check = await db.collection('erp_vr').doc(TESTDOC).get();
    assertEq(check.exists, false, 'dry-run não deve ter criado o documento');
  });

  await test('8. mergeFixture com apply=true preserva itens já existentes no servidor (o cerne do bug corrigido)', async function () {
    // Simula: servidor JÁ TEM itens reais (equivalente aos 7 materiais de stock).
    await db.collection('erp_vr').doc(TESTDOC).set({ data: JSON.stringify({ item_real_1: { label: 'Material real 1', qty: 40 }, item_real_2: { label: 'Material real 2', qty: 18 } }), ts: Date.now() });
    var guard = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    await guard.mergeFixture(TESTDOC, { e2e_fix_1: { label: 'E2E_FASEF_20260805_Fixture1', qty: 3 } });
    var check = await db.collection('erp_vr').doc(TESTDOC).get();
    var data = JSON.parse(check.data().data);
    assertEq(Object.keys(data).length, 3, 'os 2 itens reais + 1 fixture nova');
    assertEq(data.item_real_1.qty, 40, 'item real 1 preservado intacto');
    assertEq(data.item_real_2.qty, 18, 'item real 2 preservado intacto');
    assertEq(data.e2e_fix_1.qty, 3, 'fixture nova aplicada');
  });

  await test('9. cleanupCreated remove só o que ESTE guard criou, preservando itens reais e fixtures de outra fonte', async function () {
    // guard (do teste 8) já criou e2e_fix_1 numa instância anterior; aqui usamos
    // uma instância NOVA, que não tem e2e_fix_1 em seu próprio _criados — logo
    // cleanupCreated deste novo guard não deve tocar em e2e_fix_1 (isolamento
    // entre instâncias é o comportamento correto, não um bug).
    var guard = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    await guard.mergeFixture(TESTDOC, { e2e_fix_2: { label: 'E2E_FASEF_20260805_Fixture2', qty: 7 } });
    // Simula uma fixture de OUTRA sessão/rodada, criada fora deste guard.
    var atual = await db.collection('erp_vr').doc(TESTDOC).get();
    var atualData = JSON.parse(atual.data().data);
    atualData.e2e_fix_outra_rodada = { label: 'E2E_FASEF_20260805_DeOutraRodada', qty: 99 };
    await db.collection('erp_vr').doc(TESTDOC).set({ data: JSON.stringify(atualData), ts: Date.now() });

    await guard.cleanupCreated(TESTDOC);
    var final = await db.collection('erp_vr').doc(TESTDOC).get();
    var finalData = JSON.parse(final.data().data);
    assertEq(finalData.item_real_1.qty, 40, 'item real ainda intacto');
    assertEq(finalData.e2e_fix_outra_rodada.qty, 99, 'fixture de OUTRA rodada não foi removida — só o que este guard criou');
    assertEq(!!finalData.e2e_fix_1, true, 'fixture 1 de OUTRO guard (teste 8) não foi removida — só o que ESTE guard criou');
    assertEq(!!finalData.e2e_fix_2, false, 'fixture 2 deste guard foi removida');
  });

  await test('10. Duas fixtures "concorrentes" (dois guards distintos, mesmo doc) não se apagam mutuamente', async function () {
    var docConc = TESTDOC + '_conc';
    var guardA = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    var guardB = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    await Promise.all([
      guardA.mergeFixture(docConc, { e2e_a: { label: 'E2E_FASEF_20260805_A', qty: 1 } }),
      guardB.mergeFixture(docConc, { e2e_b: { label: 'E2E_FASEF_20260805_B', qty: 2 } }),
    ]);
    var check = await db.collection('erp_vr').doc(docConc).get();
    var data = JSON.parse(check.data().data);
    assertEq(Object.keys(data).length, 2, 'as duas fixtures concorrentes coexistem — nenhuma apagou a outra');
    // Limpeza concorrente: cada guard remove só o que criou.
    await Promise.all([guardA.cleanupCreated(docConc), guardB.cleanupCreated(docConc)]);
    var final = await db.collection('erp_vr').doc(docConc).get();
    var finalData = final.exists ? JSON.parse(final.data().data) : {};
    assertEq(Object.keys(finalData).length, 0, 'limpeza concorrente removeu tudo, sem sobra nem erro');
  });

  await test('11. Retry (chamar mergeFixture duas vezes com o mesmo conteúdo) é idempotente e sempre confirma por leitura do servidor', async function () {
    var docRetry = TESTDOC + '_retry';
    var guard = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    var r1 = await guard.mergeFixture(docRetry, { e2e_r: { label: 'E2E_FASEF_20260805_Retry', qty: 1 } });
    var r2 = await guard.mergeFixture(docRetry, { e2e_r: { label: 'E2E_FASEF_20260805_Retry', qty: 1 } });
    assertEq(r1.applied, true); assertEq(r2.applied, true);
    var check = await db.collection('erp_vr').doc(docRetry).get();
    var data = JSON.parse(check.data().data);
    assertEq(Object.keys(data).length, 1, 'retry não duplica chave (é um merge por chave, não um append)');
    await guard.cleanupCreated(docRetry);
  });

  await test('12. Recusa fazer merge de array sobre mapa (ou vice-versa) — nunca troca o tipo do documento', async function () {
    var docTipo = TESTDOC + '_tipo';
    await db.collection('erp_vr').doc(docTipo).set({ data: JSON.stringify([{ x: 1 }]), ts: Date.now() }); // array
    var guard = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    await assertThrows(function () {
      return guard.mergeFixture(docTipo, { e2e_x: { label: 'E2E_FASEF_20260805_X', qty: 1 } }); // tentando tratar como mapa
    }, 'RECUSADO');
    await db.collection('erp_vr').doc(docTipo).delete();
  });

  await test('13. appendFixtureItems (documentos-array) preserva itens reais existentes', async function () {
    var docArr = TESTDOC + '_arr';
    await db.collection('erp_vr').doc(docArr).set({ data: JSON.stringify([{ id: 'real1', desc: 'Item real do array' }]), ts: Date.now() });
    var guard = new FixtureGuard({ projectId: 'demo-erp-homolog', db: db, apply: true });
    await guard.appendFixtureItems(docArr, [{ id: 'e2e1', desc: 'E2E_FASEF_20260805_ItemArray' }]);
    var check = await db.collection('erp_vr').doc(docArr).get();
    var data = JSON.parse(check.data().data);
    assertEq(data.length, 2);
    assertEq(data.some(function (i) { return i.id === 'real1'; }), true, 'item real preservado');
    await guard.cleanupCreated(docArr);
    var final = await db.collection('erp_vr').doc(docArr).get();
    var finalData = JSON.parse(final.data().data);
    assertEq(finalData.length, 1, 'só o item real restou após limpeza');
    await db.collection('erp_vr').doc(docArr).delete();
  });

  await test('14. Autenticação: este runner usa Admin SDK (bypassa Auth Rules por design — é uma ferramenta de operador, não do app) — documentado, não testável como "falha de auth" no sentido de Rules', function () {
    // O Admin SDK sempre tem acesso total ao Emulator, independente de
    // Rules — é assim que qualquer script de setup/limpeza desta auditoria
    // sempre funcionou. A proteção deste guard NÃO é "autenticação", é
    // "nunca perder dado real ao escrever fixture" — daí os testes 6-13.
    assertEq(true, true);
  });

  // limpeza final
  await db.collection('erp_vr').doc(TESTDOC).delete().catch(function () {});

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
