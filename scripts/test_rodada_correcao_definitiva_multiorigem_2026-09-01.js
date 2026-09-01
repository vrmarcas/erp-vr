/**
 * test_rodada_correcao_definitiva_multiorigem_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA, Bloco 6 (MVP, sem sugestão automática de
 * retalho) — testa a Cloud Function REAL producaoIniciarOuEditar
 * (functions/src/producao.ts, compilada em functions/lib/producao.js —
 * NÃO reimplementada aqui) contra o Firestore Emulator real, cobrindo o
 * novo suporte a múltiplas origens (chapa+chapa, chapa+retalho,
 * retalho+retalho, múltiplos materiais) por OS, cada uma com baixa
 * independente e idempotente.
 *
 * Formato novo: `data.origens = [{tipo, matKey|retalhoCodigo, qty?, obs?}, ...]`.
 * Formato legado (`data.tipo/matKey/qty/retalhoCodigo` direto, sem
 * `origens`) continua funcionando IDÊNTICO a antes — ver
 * test_producao_autorizacao_server.js (29/29 revalidado, mesma chave de
 * idempotência exata para o caso de 1 origem só).
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_multiorigem_2026-09-01.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080
 * (demo-erp-homolog) + `node scripts/e2e_clean_env.js reset` já ter rodado.
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
  try { await fn(); throw new Error((msg || 'esperava erro') + ' — nenhum erro lançado'); }
  catch (e) {
    if (e.message && e.message.indexOf((msg || 'esperava erro')) === 0) throw e;
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(codeOuTrecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + codeOuTrecho + '", obtido: ' + texto);
  }
}

const { UID, ctx } = require('./e2e_shared_fixtures');

async function seedOsEstoqueRetalhos(osId, opts) {
  opts = opts || {};
  var kbRef = db.collection('erp_vr').doc('kb_os');
  var stockRef = db.collection('erp_vr').doc('stock');
  var retRef = db.collection('erp_vr').doc('retalhos');
  var kb = await kbRef.get();
  var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
  kbData[osId] = Object.assign({ id: osId, num: 'E2E-MULTI-' + osId.slice(-4), status: 'iniciada', titulo: 'E2E_MULTIORIGEM_20260901' }, opts.os || {});
  await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });

  var stock = await stockRef.get();
  var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
  Object.assign(stockData, opts.stock || {});
  await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });

  var ret = await retRef.get();
  var retList = ret.exists ? JSON.parse(ret.data().data) : [];
  (opts.retalhos || []).forEach(function (r) {
    var idx = retList.findIndex(function (x) { return x.codigo === r.codigo; });
    if (idx >= 0) retList[idx] = r; else retList.push(r);
  });
  await retRef.set({ data: JSON.stringify(retList), ts: Date.now() });
}
async function limparOS(osId) {
  var kbRef = db.collection('erp_vr').doc('kb_os');
  var kb = await kbRef.get();
  var kbData = kb.exists ? JSON.parse(kb.data().data) : {};
  delete kbData[osId];
  await kbRef.set({ data: JSON.stringify(kbData), ts: Date.now() });
}
async function limparMateriais(matKeys) {
  var stockRef = db.collection('erp_vr').doc('stock');
  var stock = await stockRef.get();
  var stockData = stock.exists ? JSON.parse(stock.data().data) : {};
  matKeys.forEach(function (k) { delete stockData[k]; });
  await stockRef.set({ data: JSON.stringify(stockData), ts: Date.now() });
}
async function limparRetalhos(codigos) {
  var retRef = db.collection('erp_vr').doc('retalhos');
  var ret = await retRef.get();
  var retList = ret.exists ? JSON.parse(ret.data().data) : [];
  retList = retList.filter(function (r) { return codigos.indexOf(r.codigo) < 0; });
  await retRef.set({ data: JSON.stringify(retList), ts: Date.now() });
}
async function getOS(osId) { var kb = await db.collection('erp_vr').doc('kb_os').get(); return JSON.parse(kb.data().data)[osId]; }
async function getMaterial(matKey) { var s = await db.collection('erp_vr').doc('stock').get(); return JSON.parse(s.data().data)[matKey]; }
async function getRetalho(codigo) { var r = await db.collection('erp_vr').doc('retalhos').get(); return JSON.parse(r.data().data).find(function (x) { return x.codigo === codigo; }); }
async function getLogEntries(idemKeyPrefix) {
  var log = await db.collection('erp_vr').doc('erp_stock_log').get();
  var arr = JSON.parse(log.data().data);
  return arr.filter(function (l) { return l.idempotencyKey && l.idempotencyKey.indexOf(idemKeyPrefix) === 0; });
}
var _c = 0;
function novoOsId() { return 'e2e_multi_os_' + Date.now() + '_' + (++_c); }
function novoReqId() { return 'req_multi_' + Date.now() + '_' + Math.random().toString(36).slice(2); }

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log(' RODADA DE CORREÇÃO DEFINITIVA, Bloco 6 — Multi-origem (Cloud Function real)');
  console.log('='.repeat(70) + '\n');

  await test('1. TESTE OBRIGATÓRIO — 2 espessuras usando chapa + retalho: duas origens, duas baixas independentes, matProdOrigens com as duas', async function () {
    var osId = novoOsId(), mat2mm = 'e2e_multi_2mm', mat4mm = 'e2e_multi_4mm', codRet = 'RET_MULTI_' + Date.now();
    await seedOsEstoqueRetalhos(osId, {
      stock: { [mat2mm]: { label: 'Cristal 2mm', qty: 10 } },
      retalhos: [{ codigo: codRet, mat: 'Cristal 4mm', dims: '30x40', label: 'Retalho', qty: 1 }],
    });
    var r = await producaoIniciarOuEditar.run({
      osId: osId, editMode: false, requestId: novoReqId(),
      origens: [
        { tipo: 'chapa', matKey: mat2mm, qty: 2, obs: 'Laterais' },
        { tipo: 'retalho', retalhoCodigo: codRet, obs: 'Base' },
      ],
    }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    assertEq(r.matProdOrigens.length, 2, 'matProdOrigens tem as 2 origens');
    var mat = await getMaterial(mat2mm);
    assertEq(mat.qty, 8, 'chapa 2mm baixada corretamente (10-2)');
    var ret = await getRetalho(codRet);
    assertEq(ret.qty, 0, 'retalho baixado corretamente (1-1)');
    var os = await getOS(osId);
    assertEq(os.status, 'producao', 'OS avança para produção');
    assertEq(os.matProd.matKey, mat2mm, 'matProd (legado, compat) preserva a 1ª origem');
    assertEq(os.matProdOrigens.length, 2, 'matProdOrigens persistido na OS com as 2 origens');
    await limparOS(osId); await limparMateriais([mat2mm]); await limparRetalhos([codRet]);
  });

  await test('2. chapa + chapa (mesmo material, duas retiradas) — duas movimentações de log, não uma só combinada', async function () {
    var osId = novoOsId(), matKey = 'e2e_multi_chapa2x';
    await seedOsEstoqueRetalhos(osId, { stock: { [matKey]: { label: 'Acrílico 3mm', qty: 10 } } });
    var r = await producaoIniciarOuEditar.run({
      osId: osId, editMode: false, requestId: novoReqId(),
      origens: [{ tipo: 'chapa', matKey: matKey, qty: 1 }, { tipo: 'chapa', matKey: matKey, qty: 2 }],
    }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    var mat = await getMaterial(matKey);
    assertEq(mat.qty, 7, 'as duas retiradas (1+2=3) descontam cumulativamente do mesmo material (10-3)');
    var entradas = await getLogEntries('producao_inicio:' + osId);
    assertEq(entradas.length, 2, 'TESTE OBRIGATÓRIO — cada origem gera sua PRÓPRIA movimentação em erp_stock_log, nunca uma baixa combinada ilegível');
    await limparOS(osId); await limparMateriais([matKey]);
  });

  await test('3. retalho + retalho (dois códigos diferentes) — os dois baixam, cada um sua movimentação', async function () {
    var osId = novoOsId(), cod1 = 'RET_A_' + Date.now(), cod2 = 'RET_B_' + Date.now();
    await seedOsEstoqueRetalhos(osId, {
      retalhos: [
        { codigo: cod1, mat: 'Cristal 3mm', dims: '20x20', label: 'Retalho A', qty: 1 },
        { codigo: cod2, mat: 'Cristal 3mm', dims: '25x25', label: 'Retalho B', qty: 1 },
      ],
    });
    var r = await producaoIniciarOuEditar.run({
      osId: osId, editMode: false, requestId: novoReqId(),
      origens: [{ tipo: 'retalho', retalhoCodigo: cod1 }, { tipo: 'retalho', retalhoCodigo: cod2 }],
    }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    assertEq((await getRetalho(cod1)).qty, 0, 'retalho A baixado');
    assertEq((await getRetalho(cod2)).qty, 0, 'retalho B baixado');
    await limparOS(osId); await limparRetalhos([cod1, cod2]);
  });

  await test('4. IDEMPOTÊNCIA — duplo clique (mesmo requestId) com multi-origem: 1 baixa só, nunca duas', async function () {
    var osId = novoOsId(), matKey = 'e2e_multi_idem', codRet = 'RET_IDEM_' + Date.now();
    await seedOsEstoqueRetalhos(osId, {
      stock: { [matKey]: { label: 'Mat', qty: 10 } },
      retalhos: [{ codigo: codRet, mat: 'Mat', dims: '10x10', label: 'R', qty: 1 }],
    });
    var reqId = novoReqId();
    var payload = { osId: osId, editMode: false, requestId: reqId, origens: [{ tipo: 'chapa', matKey: matKey, qty: 3 }, { tipo: 'retalho', retalhoCodigo: codRet }] };
    var r1 = await producaoIniciarOuEditar.run(payload, ctx(UID.producao, 'producao'));
    var r2 = await producaoIniciarOuEditar.run(payload, ctx(UID.producao, 'producao'));
    assertEq(r1.ok, true); assertEq(r1.jaProcessado, false, '1ª chamada processa de verdade');
    assertEq(r2.jaProcessado, true, 'TESTE OBRIGATÓRIO — 2ª chamada (duplo clique, mesmo requestId) é idempotente: jaProcessado=true, nenhum efeito extra');
    assertEq((await getMaterial(matKey)).qty, 7, 'chapa baixada UMA vez só (10-3=7, nunca 10-6)');
    assertEq((await getRetalho(codRet)).qty, 0, 'retalho baixado UMA vez só (nunca "baixado 2x")');
    await limparOS(osId); await limparMateriais([matKey]); await limparRetalhos([codRet]);
  });

  await test('4b. IDEMPOTÊNCIA — duas chamadas CONCORRENTES de verdade (Promise.all) com o mesmo requestId multi-origem: só uma vence, mesmo resultado final', async function () {
    var osId = novoOsId(), matKey = 'e2e_multi_concorrente';
    await seedOsEstoqueRetalhos(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var reqId = novoReqId();
    var payload = { osId: osId, editMode: false, requestId: reqId, origens: [{ tipo: 'chapa', matKey: matKey, qty: 2 }, { tipo: 'chapa', matKey: matKey, qty: 3 }] };
    var results = await Promise.all([
      producaoIniciarOuEditar.run(payload, ctx(UID.producao, 'producao')).catch(function (e) { return { erro: e }; }),
      producaoIniciarOuEditar.run(payload, ctx(UID.producao, 'producao')).catch(function (e) { return { erro: e }; }),
    ]);
    var okCount = results.filter(function (r) { return r.ok === true && r.jaProcessado === false; }).length;
    assertEq(okCount, 1, 'exatamente uma das duas chamadas concorrentes processa de verdade, a outra é idempotente ou barrada');
    assertEq((await getMaterial(matKey)).qty, 5, 'baixa aplicada UMA vez só, mesmo sob corrida real (10-2-3=5, nunca duplicado)');
    await limparOS(osId); await limparMateriais([matKey]);
  });

  await test('5. Estoque insuficiente em UMA das origens (Produção, sem justificativa) → toda a transação é negada, NENHUMA origem baixa (nunca baixa parcial)', async function () {
    var osId = novoOsId(), matOk = 'e2e_multi_ok', matPouco = 'e2e_multi_pouco';
    await seedOsEstoqueRetalhos(osId, { stock: { [matOk]: { label: 'Mat OK', qty: 10 }, [matPouco]: { label: 'Mat Pouco', qty: 1 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({
        osId: osId, editMode: false, requestId: novoReqId(),
        origens: [{ tipo: 'chapa', matKey: matOk, qty: 2 }, { tipo: 'chapa', matKey: matPouco, qty: 5 }],
      }, ctx(UID.producao, 'producao'));
    }, 'ESTOQUE_INSUFICIENTE');
    assertEq((await getMaterial(matOk)).qty, 10, 'TESTE OBRIGATÓRIO — a origem com estoque OK NÃO foi baixada: transação é atômica, tudo ou nada');
    assertEq((await getMaterial(matPouco)).qty, 1, 'a origem com estoque insuficiente também não foi tocada');
    var os = await getOS(osId);
    assertTruthy(!os.matProd && !os.matProdOrigens, 'OS não ganhou nenhuma produção parcial');
    await limparOS(osId); await limparMateriais([matOk, matPouco]);
  });

  await test('6. Estoque insuficiente em uma origem, Master COM justificativa → autoriza a EXCEÇÃO, todas as origens processam (mesma justificativa cobre a chamada inteira)', async function () {
    var osId = novoOsId(), matOk = 'e2e_multi_ok2', matPouco = 'e2e_multi_pouco2';
    await seedOsEstoqueRetalhos(osId, { stock: { [matOk]: { label: 'Mat OK', qty: 10 }, [matPouco]: { label: 'Mat Pouco', qty: 1 } } });
    var r = await producaoIniciarOuEditar.run({
      osId: osId, editMode: false, requestId: novoReqId(), justificativa: 'Cliente aguardando, reposição prevista em 2 dias',
      origens: [{ tipo: 'chapa', matKey: matOk, qty: 2 }, { tipo: 'chapa', matKey: matPouco, qty: 5 }],
    }, ctx(UID.master, 'master'));
    assertEq(r.ok, true);
    assertEq((await getMaterial(matOk)).qty, 8, 'origem com estoque suficiente processa normalmente');
    assertEq((await getMaterial(matPouco)).qty, -4, 'origem com estoque insuficiente processa com saldo negativo explícito (exceção Master)');
    var audit = await db.collection('erp_vr_audit_log_producao').where('action', '==', 'producao_autorizada_estoque_insuficiente').where('detail.osId', '==', osId).get();
    assertEq(audit.empty, false, 'auditoria da exceção registrada');
    await limparOS(osId); await limparMateriais([matOk, matPouco]);
  });

  await test('7. Retalho indisponível em UMA das origens → toda a transação é negada, origem chapa (processada antes na mesma chamada) não fica pendurada', async function () {
    var osId = novoOsId(), matKey = 'e2e_multi_ret_falha';
    await seedOsEstoqueRetalhos(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({
        osId: osId, editMode: false, requestId: novoReqId(),
        origens: [{ tipo: 'chapa', matKey: matKey, qty: 2 }, { tipo: 'retalho', retalhoCodigo: 'CODIGO_QUE_NAO_EXISTE_' + Date.now() }],
      }, ctx(UID.producao, 'producao'));
    }, 'RETALHO_INDISPONIVEL');
    assertEq((await getMaterial(matKey)).qty, 10, 'TESTE OBRIGATÓRIO — chapa da 1ª origem (processada antes da falha na 2ª) é revertida pela transação atômica — nunca fica com baixa "meio feita"');
    var os = await getOS(osId);
    assertTruthy(!os.matProd, 'OS não ganhou produção parcial');
    await limparOS(osId); await limparMateriais([matKey]);
  });

  await test('8. Edição — trocar de multi-origem (2) para uma única nova origem: as DUAS antigas são estornadas corretamente', async function () {
    var osId = novoOsId(), matA = 'e2e_multi_edit_a', matB = 'e2e_multi_edit_b', matNovo = 'e2e_multi_edit_novo';
    await seedOsEstoqueRetalhos(osId, { stock: { [matA]: { label: 'A', qty: 10 }, [matB]: { label: 'B', qty: 10 }, [matNovo]: { label: 'Novo', qty: 10 } } });
    await producaoIniciarOuEditar.run({
      osId: osId, editMode: false, requestId: novoReqId(),
      origens: [{ tipo: 'chapa', matKey: matA, qty: 2 }, { tipo: 'chapa', matKey: matB, qty: 3 }],
    }, ctx(UID.producao, 'producao'));
    assertEq((await getMaterial(matA)).qty, 8, 'sanity: A baixado');
    assertEq((await getMaterial(matB)).qty, 7, 'sanity: B baixado');

    var r2 = await producaoIniciarOuEditar.run({
      osId: osId, editMode: true, requestId: novoReqId(),
      origens: [{ tipo: 'chapa', matKey: matNovo, qty: 4 }],
    }, ctx(UID.producao, 'producao'));
    assertEq(r2.ok, true);
    assertEq((await getMaterial(matA)).qty, 10, 'TESTE OBRIGATÓRIO — origem A (uma das 2 antigas) foi INTEIRAMENTE estornada na edição');
    assertEq((await getMaterial(matB)).qty, 10, 'TESTE OBRIGATÓRIO — origem B (a outra antiga) também foi INTEIRAMENTE estornada');
    assertEq((await getMaterial(matNovo)).qty, 6, 'novo material baixado corretamente (10-4)');
    var os = await getOS(osId);
    assertEq(os.matProdOrigens.length, 1, 'matProdOrigens reflete só a nova origem única após a edição');
    await limparOS(osId); await limparMateriais([matA, matB, matNovo]);
  });

  await test('9. Compatibilidade retroativa — chamada no formato LEGADO (sem `origens`, campos diretos) continua funcionando idêntico a antes, com a MESMA chave de idempotência exata', async function () {
    var osId = novoOsId(), matKey = 'e2e_multi_legado';
    await seedOsEstoqueRetalhos(osId, { stock: { [matKey]: { label: 'Mat', qty: 10 } } });
    var r = await producaoIniciarOuEditar.run({ osId: osId, editMode: false, tipo: 'chapa', matKey: matKey, qty: 3, requestId: novoReqId() }, ctx(UID.producao, 'producao'));
    assertEq(r.ok, true);
    assertEq((await getMaterial(matKey)).qty, 7, 'baixa legada funciona igual a antes');
    var log = await db.collection('erp_vr').doc('erp_stock_log').get();
    var arr = JSON.parse(log.data().data);
    var entry = arr.find(function (l) { return l.idempotencyKey === 'producao_inicio:' + osId; });
    assertTruthy(entry, 'REGRESSÃO — a chamada de 1 origem só preserva a chave de idempotência EXATA de antes desta rodada (sem sufixo ":0"), nunca quebra compatibilidade com auditoria/relatórios existentes');
    var os = await getOS(osId);
    assertEq(os.matProdOrigens.length, 1, 'matProdOrigens (novo) também é populado mesmo no caminho legado, com 1 entrada');
    await limparOS(osId); await limparMateriais([matKey]);
  });

  await test('10. Máximo de 20 origens — 21ª é rejeitada explicitamente (nunca aceita payload absurdo em silêncio)', async function () {
    var osId = novoOsId();
    await seedOsEstoqueRetalhos(osId, {});
    var origens = [];
    for (var i = 0; i < 21; i++) origens.push({ tipo: 'chapa', matKey: 'x', qty: 1 });
    await assertThrows(function () {
      return producaoIniciarOuEditar.run({ osId: osId, editMode: false, requestId: novoReqId(), origens: origens }, ctx(UID.producao, 'producao'));
    }, 'invalid-argument');
    await limparOS(osId);
  });

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(function (e) { console.error(e); process.exitCode = 1; });
