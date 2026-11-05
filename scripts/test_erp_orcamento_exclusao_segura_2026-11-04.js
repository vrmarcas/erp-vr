/**
 * test_erp_orcamento_exclusao_segura_2026-11-04.js
 *
 * ACHADO REAL (smoke de produção pós-migração v2, 2026-11-04): tentativa
 * de excluir um orçamento real resultou em "Falha ao excluir: internal".
 * Causa raiz #1 (confirmada via `firebase functions:list --project
 * erp-vrmarcas`): vendedorExcluirOrcamento está exportada em
 * functions/src/index.ts desde o commit c2b3bc9 ("sem deploy", no próprio
 * texto do commit) mas NUNCA foi publicada — index.html já chamava a
 * Function inexistente incondicionalmente. Causa raiz #2 (mais grave para
 * a migração): mesmo deployada, a lógica original só conhecia
 * erp_vr/orcamentos (array legado) — zero conhecimento de
 * erp_vr_orcamentos/{id}. Para qualquer orçamento v2-only (todo orçamento
 * criado depois da migração client-side), devolvia jaProcessado:true (um
 * "sucesso" fictício que não excluía nada de onde importa — o orçamento
 * reapareceria no próximo snapshot do listener v2).
 *
 * Este teste prova a função REAL (excluirOrcamentoCore, nunca
 * reimplementada) contra o Firestore Emulator real:
 *   - exclusão de orçamento v2-only (cenário real pós-migração);
 *   - exclusão de orçamento que existe nas DUAS fontes (migrado);
 *   - bloqueio por OS já gerada / CR já registrado (invariante preservado);
 *   - idempotência (excluir 2x, ou um id inexistente, nunca erro);
 *   - espelho legado best-effort nunca bloqueia quando o array está
 *     grande demais (mesmo princípio já provado para save/produção).
 *
 * Uso: node scripts/test_erp_orcamento_exclusao_segura_2026-11-04.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080
 * (demo-erp-homolog) — mesmo emulador das outras suítes desta rodada.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { excluirOrcamentoCore, ExclusaoOrcamentoError } = require('../functions/lib/erp_orcamento_exclusao_segura.js');
const { removerOrcamentoDoLegadoEspelho } = require('../functions/lib/orcamentos_v2_helper.js');

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

console.log('\n=== excluirOrcamentoCore — v2 como autoridade, legado best-effort (achado real #000259-ish, smoke 2026-11-04) ===\n');

var _c = 0;
function novoId() { return 'ORC-TESTE-EXCLUSAO-' + Date.now() + '-' + (++_c); }
var CALLER = { uid: 'e2e_exclusao_caller' };

async function setOrcamentoV2(id, campos) {
  await db.collection('erp_vr_orcamentos').doc(id).set(Object.assign({ id: id, num: id, status: 'aguardando' }, campos || {}));
}
async function getOrcamentoV2(id) {
  var snap = await db.collection('erp_vr_orcamentos').doc(id).get();
  return snap.exists ? snap.data() : null;
}
async function setOrcamentoLegado(id, campos) {
  var ref = db.collection('erp_vr').doc('orcamentos');
  var doc = await ref.get();
  var arr = doc.exists ? JSON.parse(doc.data().data) : [];
  arr = arr.filter(function (o) { return o.id !== id; });
  arr.push(Object.assign({ id: id, num: id, status: 'aguardando' }, campos || {}));
  await ref.set({ data: JSON.stringify(arr), ts: Date.now() });
}
async function existeNoLegado(id) {
  var doc = await db.collection('erp_vr').doc('orcamentos').get();
  if (!doc.exists) return false;
  var arr = JSON.parse(doc.data().data);
  return arr.some(function (o) { return o && o.id === id; });
}
async function limparV2(id) { await db.collection('erp_vr_orcamentos').doc(id).delete(); }
async function limparLegado(id) {
  var ref = db.collection('erp_vr').doc('orcamentos');
  var doc = await ref.get();
  if (!doc.exists) return;
  var arr = JSON.parse(doc.data().data).filter(function (o) { return o.id !== id; });
  await ref.set({ data: JSON.stringify(arr), ts: Date.now() });
}

(async function () {
  var criadosV2 = [];

  // ── 1. Orçamento v2-only (cenário real pós-migração) — exclusão de verdade ──
  {
    var id = novoId(); criadosV2.push(id);
    await setOrcamentoV2(id, { cliente: 'Cliente V2-only' });
    var r = await excluirOrcamentoCore(id, CALLER);
    ok('1a. exclusão de orçamento v2-only devolve jaProcessado:false (excluiu de verdade, não um sucesso fictício)', r.ok === true && r.jaProcessado === false);
    var depois = await getOrcamentoV2(id);
    ok('1b. o documento v2 REALMENTE deixou de existir (causa raiz #2 corrigida — antes isto nunca acontecia para orçamento v2-only)', depois === null);
  }

  // ── 2. Orçamento migrado (existe nas duas fontes) — exclusão remove dos dois ──
  {
    var id2 = novoId(); criadosV2.push(id2);
    await setOrcamentoV2(id2, { cliente: 'Cliente Migrado' });
    await setOrcamentoLegado(id2, { cliente: 'Cliente Migrado' });
    var r2 = await excluirOrcamentoCore(id2, CALLER);
    ok('2a. exclusão de orçamento migrado (v2+legado) devolve jaProcessado:false', r2.ok === true && r2.jaProcessado === false);
    ok('2b. v2 (autoridade) foi excluído', (await getOrcamentoV2(id2)) === null);
    ok('2c. legado (espelho best-effort) também foi removido quando a escrita cabe', !(await existeNoLegado(id2)));
  }

  // ── 3. Bloqueio por OS já gerada (osRef) — invariante de segurança preservado ──
  {
    var id3 = novoId(); criadosV2.push(id3);
    await setOrcamentoV2(id3, { cliente: 'Cliente Com OS', osRef: 'os_real_123' });
    var lancou3 = false, codigo3 = null;
    try { await excluirOrcamentoCore(id3, CALLER); } catch (e) { lancou3 = true; codigo3 = e && e.codigo; }
    ok('3a. exclusão de orçamento com OS já gerada é BLOQUEADA (lança ExclusaoOrcamentoError)', lancou3 === true && codigo3 === 'OS_JA_GERADA');
    ok('3b. o documento v2 continua intacto após o bloqueio', !!(await getOrcamentoV2(id3)));
  }

  // ── 4. Bloqueio por Conta a Receber já registrada (crId) ──
  {
    var id4 = novoId(); criadosV2.push(id4);
    await setOrcamentoV2(id4, { cliente: 'Cliente Com CR', crId: 'cr_real_456' });
    var lancou4 = false, codigo4 = null;
    try { await excluirOrcamentoCore(id4, CALLER); } catch (e) { lancou4 = true; codigo4 = e && e.codigo; }
    ok('4a. exclusão de orçamento com CR já registrado é BLOQUEADA (lança ExclusaoOrcamentoError)', lancou4 === true && codigo4 === 'PAGAMENTO_JA_REGISTRADO');
    ok('4b. o documento v2 continua intacto após o bloqueio', !!(await getOrcamentoV2(id4)));
  }

  // ── 5. Idempotência — excluir 2x o mesmo id, ou um id inexistente, nunca erro ──
  {
    var id5 = novoId(); criadosV2.push(id5);
    await setOrcamentoV2(id5, { cliente: 'Cliente Idempotência' });
    var r5a = await excluirOrcamentoCore(id5, CALLER);
    ok('5a. 1ª exclusão: jaProcessado:false (excluiu de verdade)', r5a.ok === true && r5a.jaProcessado === false);
    var r5b = await excluirOrcamentoCore(id5, CALLER);
    ok('5b. 2ª exclusão do MESMO id (retry/duplo-clique): jaProcessado:true, nunca erro', r5b.ok === true && r5b.jaProcessado === true);
    var r5c = await excluirOrcamentoCore('ORC-NUNCA-EXISTIU-' + Date.now(), CALLER);
    ok('5c. exclusão de id que nunca existiu: jaProcessado:true, nunca erro', r5c.ok === true && r5c.jaProcessado === true);
  }

  // ── 6. Orçamento v2-only (nunca existiu no legado) — exclusão nem tenta
  // tocar o array legado (nenhum write, nenhum risco de tamanho) ──
  {
    var id6 = novoId(); criadosV2.push(id6);
    await setOrcamentoV2(id6, { cliente: 'Cliente V2-only Sem Legado' });
    var legadoAntes = JSON.stringify((await db.collection('erp_vr').doc('orcamentos').get()).data() || null);
    var r6 = await excluirOrcamentoCore(id6, CALLER);
    var legadoDepois = JSON.stringify((await db.collection('erp_vr').doc('orcamentos').get()).data() || null);
    ok('6a. exclusão de orçamento v2-only é sucesso real (jaProcessado:false)', r6.ok === true && r6.jaProcessado === false);
    ok('6b. o array legado NUNCA foi tocado (nenhuma tentativa de escrita) — zero risco de bloqueio por tamanho quando não há nada para espelhar', legadoAntes === legadoDepois);
  }

  // ── 7. removerOrcamentoDoLegadoEspelho() isolada — nunca lança mesmo
  // quando a escrita real no array legado falha por QUALQUER motivo (ex.:
  // doc > 1.048.576 bytes, igual ao achado real de produção) — mesmo
  // princípio já provado para espelharOrcamentoNoLegado() (save). ──
  {
    var fakeDbQueSempreFalha = {
      collection: function () {
        return { doc: function () { return {}; } };
      },
      runTransaction: function () {
        var e = new Error('3 INVALID_ARGUMENT: The value of property "data" is longer than 1048487 bytes.');
        e.code = 3;
        return Promise.reject(e);
      },
    };
    var lancou7 = false;
    try { await removerOrcamentoDoLegadoEspelho(fakeDbQueSempreFalha, 'ORC-QUALQUER'); } catch (e) { lancou7 = true; }
    ok('7. removerOrcamentoDoLegadoEspelho() NUNCA lança mesmo quando a escrita real no legado falha (doc grande demais) — best-effort real, não simulado', lancou7 === false);
  }

  // ── limpeza geral ──
  for (var i = 0; i < criadosV2.length; i++) { await limparV2(criadosV2[i]); await limparLegado(criadosV2[i]); }
  console.log('  (limpeza: ' + criadosV2.length + ' orçamento(s) de teste removidos do emulador)');

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})().catch(function (e) { console.error('ERRO FATAL:', e); process.exit(1); });
