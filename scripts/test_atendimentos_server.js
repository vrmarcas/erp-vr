/**
 * test_atendimentos_server.js
 *
 * Testa as Cloud Functions reais do módulo Atendimentos
 * (functions/src/atendimentos.ts, compiladas em functions/lib/atendimentos.js)
 * contra o Firestore Emulator real, via .run() — mesmo padrão das demais
 * suítes desta auditoria (ver test_vitre_catalogo_server.js).
 *
 * CHATVOLT_API_KEY não é configurada no ambiente de teste — isso é
 * proposital: os cenários que dependem do provider verificam o caminho de
 * falha graciosa (deliveryStatus:failed, erro normalizado, mensagem do
 * cliente preservada), que é exatamente o comportamento exigido em
 * produção quando a integração externa ainda não está disponível.
 *
 * Uso: node scripts/test_atendimentos_server.js
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
delete process.env.CHATVOLT_API_KEY; // garante o caminho de falha determinística do provider
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { UID, ctx } = require('./e2e_shared_fixtures');
const {
  atdCriarConversaTeste, atdSimularMensagemCliente, atdEnviarMensagemHumano,
  atdAssumirAtendimento, atdDevolverParaValeria, atdResolverAtendimento, atdLimparConversaTeste,
} = require('../functions/lib/atendimentos.js');

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
function reqId() { return 'req_atd_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
async function limparAtendimento(id) {
  var msgs = await db.collection('atendimentos').doc(id).collection('mensagens').get();
  var batch = db.batch();
  msgs.docs.forEach(function (d) { batch.delete(d.ref); });
  batch.delete(db.collection('atendimentos').doc(id));
  await batch.commit().catch(function () {});
}

console.log('\n=== Atendimentos — Cloud Functions reais (Emulator) ===\n');

(async function main() {
  var atdId;

  await test('1. atdCriarConversaTeste: master cria com campos canônicos corretos', async function () {
    var r = await atdCriarConversaTeste.run({ nomeClienteSimulado: 'Cliente E2E' }, ctx(UID.master, 'master'));
    assertTruthy(r.ok);
    assertTruthy(r.id);
    atdId = r.id;
    var doc = await db.collection('atendimentos').doc(atdId).get();
    assertTruthy(doc.exists);
    var d = doc.data();
    assertEq(d.channel, 'erp_web');
    assertEq(d.isTeste, true);
    assertEq(d.modoAtendimento, 'valeria');
    assertEq(d.status, 'aberto');
    assertEq(d.naoLidas, 0);
    assertEq(d.nome, 'Cliente E2E');
  });

  await test('2. atdCriarConversaTeste: comercial é negado (master-only)', async function () {
    await assertThrows(function () {
      return atdCriarConversaTeste.run({ nomeClienteSimulado: 'X' }, ctx(UID.comercial, 'comercial'));
    }, 'permission-denied');
  });

  await test('3. atdCriarConversaTeste: sem auth é negado', async function () {
    await assertThrows(function () {
      return atdCriarConversaTeste.run({}, ctx(null));
    }, 'unauthenticated');
  });

  await test('4. atdSimularMensagemCliente: persiste mensagem do cliente e falha graciosamente sem CHATVOLT_API_KEY', async function () {
    var r = await atdSimularMensagemCliente.run(
      { atendimentoId: atdId, texto: 'Oi, vocês fazem bandeja?', requestId: reqId() },
      ctx(UID.master, 'master')
    );
    assertEq(r.ok, false);
    assertEq(r.erro, 'CHATVOLT_API_KEY_NAO_CONFIGURADA');
    var msgs = await db.collection('atendimentos').doc(atdId).collection('mensagens').orderBy('createdAt', 'asc').get();
    var lista = msgs.docs.map(function (d) { return d.data(); });
    assertEq(lista.length, 2, 'deve ter a mensagem do cliente + a de sistema (falha)');
    assertEq(lista[0].actorType, 'customer');
    assertEq(lista[0].text, 'Oi, vocês fazem bandeja?');
    assertEq(lista[1].actorType, 'system');
    assertEq(lista[1].deliveryStatus, 'failed');
  });

  await test('5. atdSimularMensagemCliente: idempotente por requestId (replay não duplica)', async function () {
    var rid = reqId();
    var r1 = await atdSimularMensagemCliente.run({ atendimentoId: atdId, texto: 'Quero 2 unidades', requestId: rid }, ctx(UID.master, 'master'));
    assertEq(r1.ok, false, 'sem CHATVOLT_API_KEY a 1a chamada falha no provider (mensagem do cliente já foi persistida)');
    var msgsAntes = await db.collection('atendimentos').doc(atdId).collection('mensagens').where('idempotencyKey', '==', rid).get();
    assertEq(msgsAntes.size, 1, 'a mensagem do cliente foi persistida uma única vez');
    var r2 = await atdSimularMensagemCliente.run({ atendimentoId: atdId, texto: 'Quero 2 unidades', requestId: rid }, ctx(UID.master, 'master'));
    assertEq(r2.jaProcessado, true, 'replay com o mesmo requestId nunca reprocessa nem duplica');
    var msgsDepois = await db.collection('atendimentos').doc(atdId).collection('mensagens').where('idempotencyKey', '==', rid).get();
    assertEq(msgsDepois.size, 1, 'ainda uma única mensagem do cliente com este requestId — replay não duplicou');
  });

  await test('6. atdSimularMensagemCliente: rejeita em conversa não-teste (failed-precondition)', async function () {
    var ref = db.collection('atendimentos').doc();
    await ref.set({ id: ref.id, isTeste: false, modoAtendimento: 'valeria', nome: 'Real' });
    await assertThrows(function () {
      return atdSimularMensagemCliente.run({ atendimentoId: ref.id, texto: 'oi', requestId: reqId() }, ctx(UID.master, 'master'));
    }, 'failed-precondition');
    await limparAtendimento(ref.id);
  });

  await test('7. atdEnviarMensagemHumano: rejeita se modoAtendimento !== humano', async function () {
    await assertThrows(function () {
      return atdEnviarMensagemHumano.run({ atendimentoId: atdId, texto: 'oi', requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    }, 'failed-precondition');
  });

  await test('8. atdAssumirAtendimento: comercial assume, grava responsavelUid/Nome', async function () {
    var r = await atdAssumirAtendimento.run({ atendimentoId: atdId }, ctx(UID.comercial, 'comercial'));
    assertTruthy(r.ok);
    var doc = await db.collection('atendimentos').doc(atdId).get();
    var d = doc.data();
    assertEq(d.modoAtendimento, 'humano');
    assertEq(d.responsavelUid, UID.comercial);
  });

  await test('9. atdEnviarMensagemHumano: funciona após assumir, nunca aciona a Valéria', async function () {
    var r = await atdEnviarMensagemHumano.run({ atendimentoId: atdId, texto: 'Vou te ajudar!', requestId: reqId() }, ctx(UID.comercial, 'comercial'));
    assertEq(r.jaProcessado, false);
    var msgs = await db.collection('atendimentos').doc(atdId).collection('mensagens').where('actorType', '==', 'human').get();
    assertEq(msgs.size, 1);
    assertEq(msgs.docs[0].data().actorId, UID.comercial);
  });

  await test('10. atdDevolverParaValeria: volta modoAtendimento e limpa responsável', async function () {
    var r = await atdDevolverParaValeria.run({ atendimentoId: atdId }, ctx(UID.comercial, 'comercial'));
    assertTruthy(r.ok);
    var doc = await db.collection('atendimentos').doc(atdId).get();
    var d = doc.data();
    assertEq(d.modoAtendimento, 'valeria');
    assertEq(d.responsavelUid, null);
  });

  await test('11. atdResolverAtendimento: marca status resolvido', async function () {
    var r = await atdResolverAtendimento.run({ atendimentoId: atdId }, ctx(UID.comercial, 'comercial'));
    assertTruthy(r.ok);
    var doc = await db.collection('atendimentos').doc(atdId).get();
    assertEq(doc.data().status, 'resolvido');
  });

  await test('12. atdLimparConversaTeste: produção é negado (não é comercial nem master)', async function () {
    await assertThrows(function () {
      return atdLimparConversaTeste.run({ atendimentoId: atdId }, ctx(UID.producao, 'producao'));
    }, 'permission-denied');
  });

  await test('13. atdLimparConversaTeste: master apaga atendimento + mensagens', async function () {
    var r = await atdLimparConversaTeste.run({ atendimentoId: atdId }, ctx(UID.master, 'master'));
    assertTruthy(r.ok);
    var doc = await db.collection('atendimentos').doc(atdId).get();
    assertEq(doc.exists, false);
    var msgs = await db.collection('atendimentos').doc(atdId).collection('mensagens').get();
    assertEq(msgs.size, 0);
  });

  await test('14. atdLimparConversaTeste: recusa apagar atendimento real (isTeste=false)', async function () {
    var ref = db.collection('atendimentos').doc();
    await ref.set({ id: ref.id, isTeste: false, nome: 'Real' });
    await assertThrows(function () {
      return atdLimparConversaTeste.run({ atendimentoId: ref.id }, ctx(UID.master, 'master'));
    }, 'failed-precondition');
    await limparAtendimento(ref.id);
  });

  console.log('\n' + '='.repeat(60));
  console.log('Resultado: ' + passed + ' passou(aram), ' + failed + ' falhou(aram)');
  console.log('='.repeat(60) + '\n');
  process.exitCode = failed > 0 ? 1 : 0;
})();
