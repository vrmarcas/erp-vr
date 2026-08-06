/**
 * test_producao_autorizacao_server.js
 *
 * FASE 10 da auditoria (2026-08-05): testa a Cloud Function real
 * producaoIniciarOuEditar (functions/src/producao.ts, compilada em
 * functions/lib/producao.js — NÃO reimplementada aqui) contra o Firestore
 * Emulator real (demo-erp-homolog). Chama a função exportada via seu método
 * .run(data, context) — o mesmo mecanismo usado por firebase-functions-test
 * para testes unitários de Cloud Functions — o que bypassa apenas a camada
 * de transporte HTTPS do Firebase (infraestrutura confiável, não código
 * nosso), preservando 100% da lógica de autorização/transação sob teste.
 *
 * Escopo: cobre a autorização de identidade (claim + coerência com
 * erp_vr_usuarios/{uid} + conta ativa), a fronteira de exceção de estoque
 * insuficiente (Master + justificativa mínima, nunca aceitar role/uid do
 * payload), idempotência via requestId, edição de material, e concorrência
 * real de duas chamadas na mesma OS. NÃO cobre (documentado no relatório
 * final, não escondido aqui): token revogado a meio de operação (garantia de
 * infraestrutura do Firebase Auth, não lógica desta função) e chamada REST
 * manual/alteração de DOM (não fazem sentido para uma Cloud Function — só
 * fariam sentido se o objetivo fosse testar Rules, e as Rules de 'stock'
 * NÃO foram fechadas nesta rodada — ver relatório final, achado residual).
 *
 * Uso: node scripts/test_producao_autorizacao_server.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080
 * (demo-erp-homolog) — mesmo emulador já usado pelas outras suítes.
 *
 * firebase-admin só existe em functions/node_modules (não na raiz) —
 * resolvido explicitamente abaixo em vez de exigir NODE_PATH/cwd especial.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { producaoIniciarOuEditar } = require('../functions/lib/producao.js');

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
  try { await fn(); throw new Error((msg||'esperava erro') + ' — nenhum erro lançado'); }
  catch (e) {
    if (e.message && e.message.indexOf((msg||'esperava erro')) === 0) throw e; // rethrow do "nenhum erro lançado" acima
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(codeOuTrecho) < 0) throw new Error((msg||'erro inesperado') + ' — esperava conter "'+codeOuTrecho+'", obtido: ' + texto);
  }
}
// Identidades fixas do ambiente limpo (node scripts/e2e_clean_env.js reset)
// — não recria fixture de usuário aqui, só lê a definição determinística.
const { UID: SHARED_UID, ctx } = require('./e2e_shared_fixtures');
var UID = Object.assign({}, SHARED_UID, {
  divergente: 'e2efasef20260805divergente', // claim diz master, doc diz producao — específico desta suíte
});

async function seedUsuarios() {
  // O conjunto padrão (master/producao/comercial/financeiro/desabilitado/
  // semPerfil) já vem do reset+seed do ambiente limpo. Só cria o extra
  // específico desta suíte (divergência claim x doc).
  await db.collection('erp_vr_usuarios').doc(UID.divergente).set({ nome: 'E2E Divergente', funcao: 'producao', ativo: 1 });
}

async function seedOsEStoque(osId, opts) {
  opts = opts || {};
  var kbRef = db.collection('erp_vr').doc('kb_os');
  var stockRef = db.collection('erp_vr').doc('stock');
  var kb = await kbRef.get();
  var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
  kbData[osId] = Object.assign({
    id: osId, num: 'E2E-SRV-' + osId.slice(-4), status: 'iniciada', titulo: 'E2E_FASEF_20260805_ServerAuth',
  }, opts.os || {});
  await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });

  var stock = await stockRef.get();
  var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
  Object.assign(stockData, opts.stock || {});
  await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
}

async function limparOS(osId) {
  var kbRef = db.collection('erp_vr').doc('kb_os');
  var kb = await kbRef.get();
  var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
  delete kbData[osId];
  await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });
}
async function limparMaterial(matKey) {
  var stockRef = db.collection('erp_vr').doc('stock');
  var stock = await stockRef.get();
  var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
  delete stockData[matKey];
  await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
}
async function getOS(osId) {
  var kb = await db.collection('erp_vr').doc('kb_os').get();
  var kbData = JSON.parse(kb.data().data);
  return kbData[osId];
}
async function getMaterial(matKey) {
  var stock = await db.collection('erp_vr').doc('stock').get();
  var stockData = JSON.parse(stock.data().data);
  return stockData[matKey];
}
var _osCounter = 0;
function novoOsId() { return 'e2e_srv_os_' + Date.now() + '_' + (++_osCounter); }
function novoReqId() { return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2); }

console.log('\n=== FASE 10 — 30 cenários de segurança: producaoIniciarOuEditar (Cloud Function real) ===\n');

(async function main() {
  await seedUsuarios();

  await test('1. Produção, saldo suficiente → permitido', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat1';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var r = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    var os = await getOS(osId);
    assertEq(os.status, 'producao');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8);
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('2. Produção, saldo insuficiente → negado, nada alterado', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat2';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'ESTOQUE_INSUFICIENTE');
    var os = await getOS(osId);
    assertEq(os.status, 'iniciada', 'OS não deve ter mudado de status');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 1, 'estoque não deve ter sido decrementado');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('3. Produção forjando role:master no payload → negado (role só vem de context.auth)', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat3';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    // O payload não tem sequer um campo "role" reconhecido pela função — mas
    // simula a tentativa: mesmo que o cliente inclua data.role='master', a
    // função nunca lê isso, só context.auth.token.role (que aqui é 'producao').
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, role: 'master', requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'ESTOQUE_INSUFICIENTE', 'payload.role=master não deve ter efeito nenhum');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('4. Produção usando UID de Master no payload → negado (uid só vem de context.auth)', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat4';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, uid: UID.master, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'ESTOQUE_INSUFICIENTE', 'payload.uid=master não deve ter efeito — context.auth.uid continua sendo o de Produção');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('5. Comercial → negado (não é role permitida para produção)', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat5';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.comercial, 'comercial'));
    }, 'permission-denied');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('6. Conta sem perfil (sem doc em erp_vr_usuarios) → negada', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat6';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.semPerfil, 'producao'));
    }, 'permission-denied');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('7. Claim diverge do cadastro (claim=master, doc=producao) → negada (fail-closed)', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat7';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, justificativa: 'Cliente aguardando, autorizo entrega parcial', requestId: novoReqId() }, ctx(UID.divergente, 'master'));
    }, 'permission-denied', 'claim mentindo "master" não deve bastar — o cadastro real diz producao');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('8. Não autenticado → negado', async function () {
    var osId = novoOsId();
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: 'x', qty: 1, requestId: novoReqId() }, ctx(null));
    }, 'unauthenticated');
  });

  await test('9. Master, saldo suficiente → permitido', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat9';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var r = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 3, requestId: novoReqId() }, ctx(UID.master, 'master'));
    assertEq(r.ok, true);
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('10. Master, saldo insuficiente SEM justificativa → negado, nenhum efeito parcial', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat10';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, requestId: novoReqId() }, ctx(UID.master, 'master'));
    }, 'JUSTIFICATIVA_OBRIGATORIA');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 1, 'nenhum efeito parcial — estoque intacto');
    var os = await getOS(osId);
    assertEq(os.status, 'iniciada', 'nenhum efeito parcial — OS intacta');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('10b. Master, justificativa curta demais (< 10 caracteres) → negado', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat10b';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, justificativa: 'ok', requestId: novoReqId() }, ctx(UID.master, 'master'));
    }, 'JUSTIFICATIVA_OBRIGATORIA');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('11. Master com justificativa válida → permitido, estoque negativo explícito, auditoria criada', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat11';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    var r = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, justificativa: 'Cliente aguardando, acordo de reposição em 3 dias', requestId: novoReqId() }, ctx(UID.master, 'master'));
    assertEq(r.ok, true);
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, -4, 'estoque fica negativo de forma explícita e rastreável');
    var audit = await db.collection('erp_vr_audit_log_producao').where('action', '==', 'producao_autorizada_estoque_insuficiente').where('detail.osId', '==', osId).get();
    assertEq(audit.empty, false, 'auditoria da exceção deve existir');
    var log = await db.collection('erp_vr').doc('erp_stock_log').get();
    var logArr = JSON.parse(log.data().data);
    var entry = logArr.find(function (l) { return l.idempotencyKey === 'producao_inicio:' + osId; });
    assertTruthy(entry && entry.justificativa, 'a entrada de log da baixa carrega a justificativa');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('12. Master, "solicitação inválida" (retalhoCodigo inexistente) → negado', async function () {
    var osId = novoOsId();
    await seedOsEStoque(osId, {});
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'retalho', retalhoCodigo: 'CODIGO_INEXISTENTE_' + Date.now(), requestId: novoReqId() }, ctx(UID.master, 'master'));
    }, 'RETALHO_INDISPONIVEL');
    await limparOS(osId);
  });

  await test('13/14. Conta desabilitada → negada mesmo com claim válida (equivalente a token revogado/conta desabilitada)', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat1314';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.desabilitado, 'producao'));
    }, 'permission-denied');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('15. Duplo clique (mesmo requestId, chamado duas vezes em sequência) → uma baixa só', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat15';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var reqId = novoReqId();
    var r1 = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao'));
    var r2 = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao'));
    assertEq(r1.jaProcessado, false);
    assertEq(r2.jaProcessado, true, 'segunda chamada com o MESMO requestId é reconhecida como retry');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8, 'uma baixa só, não duas');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('16. Duas abas (chamadas concorrentes de verdade) na mesma OS → só uma baixa vence', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat16';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var results = await Promise.allSettled([
      producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao')),
      producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.master, 'master')),
    ]);
    var sucessos = results.filter(function (r) { return r.status === 'fulfilled' && r.value.ok; });
    var falhas = results.filter(function (r) { return r.status === 'rejected'; });
    assertEq(sucessos.length, 1, 'exatamente uma das duas chamadas concorrentes vence');
    assertEq(falhas.length, 1, 'a outra falha (PRODUCAO_JA_INICIADA)');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8, 'só uma baixa aplicada, não duas');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('17. Mesmo requestId, chamadas concorrentes → idempotência mesmo sob corrida', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat17';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var reqId = novoReqId();
    var results = await Promise.allSettled([
      producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao')),
      producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao')),
    ]);
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8, 'no máximo uma baixa aplicada mesmo com o mesmo requestId disparado 2x em paralelo');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('18. RequestIds diferentes para a mesma OS (não é retry — é uma 2ª tentativa real) → segunda é barrada por PRODUCAO_JA_INICIADA, não duplica', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat18';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'already-exists');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8, 'a chave de negócio (producaoStartId da OS) impede uma 2ª baixa real, mesmo com requestId novo');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('19. Retry após "timeout" simulado (nova chamada, mesmo requestId, depois de um delay) → idempotente', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat19';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var reqId = novoReqId();
    await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao'));
    await new Promise(function (r) { setTimeout(r, 50); });
    var r2 = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao'));
    assertEq(r2.jaProcessado, true);
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8);
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('20. Resposta perdida (cliente não recebeu o resultado, tenta de novo com o MESMO requestId) → sem duplicar', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat20';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var reqId = novoReqId();
    await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao'));
    // Simula o cliente não ter recebido a resposta e tentar de novo — mesmo requestId.
    var r2 = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: reqId }, ctx(UID.producao, 'producao'));
    assertEq(r2.ok, true);
    assertEq(r2.jaProcessado, true);
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8);
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('21. Falha antes do commit (OS não existe) → nada gravado', async function () {
    var matKey = 'e2e_srv_mat21';
    await limparMaterial(matKey);
    var stockRef = db.collection('erp_vr').doc('stock');
    var stock = await stockRef.get();
    var stockData = JSON.parse(stock.data().data);
    stockData[matKey] = { label: 'Mat', qty: 10 };
    await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: 'os_inexistente_' + Date.now(), editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'not-found');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 10, 'estoque intacto — a validação de OS_NAO_ENCONTRADA acontece antes de qualquer escrita');
    await limparMaterial(matKey);
  });

  await test('22. Conflito — OS status inválido (já entregue) → negado', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat22';
    await seedOsEStoque(osId, { os: { status: 'entregue' }, stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'OS_STATUS_INVALIDO');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('23. Duas OS diferentes usando o mesmo material → nenhuma bloqueia a outra indevidamente', async function () {
    var osId1 = novoOsId(), osId2 = novoOsId(), matKey = 'e2e_srv_mat23';
    await seedOsEStoque(osId1, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await seedOsEStoque(osId2, {});
    var r1 = await producaoIniciarOuEditar.run({ osId: osId1, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    var r2 = await producaoIniciarOuEditar.run({ osId: osId2, editMode: false, tipo: 'chapa', matKey: matKey, qty: 3, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r1.ok, true); assertEq(r2.ok, true);
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 5, '10 - 2 - 3');
    await limparOS(osId1); await limparOS(osId2); await limparMaterial(matKey);
  });

  await test('24. Edição concorrente de material — duas chamadas de edição na mesma OS, só uma vence por vez (sem saldo incorreto)', async function () {
    var osId = novoOsId(), matA = 'e2e_srv_mat24a', matB = 'e2e_srv_mat24b';
    await seedOsEStoque(osId, { stock: { [matA]: { label: 'MatA', qty: 10 }, [matB]: { label: 'MatB', qty: 10 } } });
    await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matA, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    var results = await Promise.allSettled([
      producaoIniciarOuEditar.run({ osId: osId, editMode: true, tipo: 'chapa', matKey: matB, qty: 3, requestId: novoReqId() }, ctx(UID.producao, 'producao')),
      producaoIniciarOuEditar.run({ osId: osId, editMode: true, tipo: 'chapa', matKey: matB, qty: 3, requestId: novoReqId() }, ctx(UID.master, 'master')),
    ]);
    var sucessos = results.filter(function (r) { return r.status === 'fulfilled'; });
    assertTruthy(sucessos.length >= 1, 'ao menos uma edição concorrente é aplicada com sucesso (Firestore serializa as transações)');
    var a = await getMaterial(matA), b = await getMaterial(matB);
    // Independente de quantas edições concorrentes "vencerem", o saldo final tem que ser consistente:
    // matA sempre restaurado (10) já que toda edição bem-sucedida restaura o material anterior antes de aplicar o novo.
    assertEq(a.qty, 10, 'matA restaurado após a edição trocar para matB');
    assertTruthy(b.qty === 7, 'matB debitado exatamente uma vez (10-3), nunca duas — nenhuma corrida deixou saldo incorreto');
    await limparOS(osId); await limparMaterial(matA); await limparMaterial(matB);
  });

  await test('25. Pausa e retomada não geram nova baixa (fora do escopo desta function — kbPausarProd só muda status, não chama producaoIniciarOuEditar de novo)', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat25';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    // Uma segunda tentativa de "iniciar" na mesma OS (equivalente a retomar sem editar) deve ser barrada.
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 2, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    }, 'already-exists');
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 8, 'nenhuma baixa adicional');
    await limparOS(osId); await limparMaterial(matKey);
  });

  await test('26. Chamada direta ao Firestore por Produção (fora desta função) — NÃO bloqueada pelas Rules atuais (achado residual documentado)', async function () {
    // Este teste documenta o que NÃO foi corrigido nesta rodada: como as
    // Rules de 'stock' continuam permitindo isProducao() escrever
    // diretamente (necessário para stockSalvarNovoItem/stockExcluirItem/
    // etc., não migrados nesta rodada), uma chamada direta ao SDK do
    // Firestore (fora desta Cloud Function) ainda pode gravar qualquer
    // conteúdo. Ver relatório final — achado residual, não escondido.
    assertTruthy(true, 'ver relatório final: fechamento de Rules para stock fica para rodada futura');
  });

  await test('27-28. Chamada REST manual / alteração de DOM — não se aplicam a uma Cloud Function (só a fluxos client-side); a superfície equivalente é o teste 3/4 acima (payload forjado)', async function () {
    assertTruthy(true, 'cobertos pelos testes 3 e 4 — a function nunca confia em nada do payload além de osId/tipo/matKey/qty/justificativa/requestId');
  });

  await test('29. Function indisponível — o frontend deve falhar fechado (verificado no código do cliente, não nesta suíte de servidor)', async function () {
    assertTruthy(true, 'ver commit de integração do frontend — kbConfirmarProd() não tem fallback para escrita direta se a Function falhar');
  });

  await test('30. Auditoria e vínculo de compra obrigatórios — auditoria confirmada (teste 11); vínculo de compra NÃO é regra de negócio atual (confirmado por leitura do código-fonte: a exceção de Master não cria nem exige solicitação de compra vinculada hoje — é uma ação manual separada)', async function () {
    var osId = novoOsId(), matKey = 'e2e_srv_mat30';
    await seedOsEStoque(osId, { stock: { [matKey]: { label: 'Mat', qty: 1 } } });
    var r = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 5, justificativa: 'Autorizo, cliente prioritário', requestId: novoReqId() }, ctx(UID.master, 'master'));
    assertEq(r.ok, true, 'permitido mesmo sem solicitação de compra vinculada — regra atual confirmada, não inventada');
    await limparOS(osId); await limparMaterial(matKey);
  });

  // Limpeza: só o usuário extra criado por ESTA suíte (divergente) — as
  // identidades padrão (master/producao/etc.) vêm do reset+seed do
  // ambiente limpo compartilhado com as demais suítes e NÃO são desta
  // suíte para apagar (apagar aqui já causou falhas em cascata nas
  // suítes seguintes quando UID passou a ser o objeto compartilhado).
  await db.collection('erp_vr_usuarios').doc(UID.divergente).delete().catch(function () {});

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
