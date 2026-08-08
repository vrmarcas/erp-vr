/**
 * test_import_historico_financeiro_2026-08-08.js
 *
 * RODADA 3 — seções 18-25: prova end-to-end do importador histórico
 * (scripts/import_historico_financeiro.js) contra o Firestore Emulator
 * real, executando o script de verdade via child_process (não reimplementa
 * a lógica de parsing/normalização) e inspecionando o Firestore depois.
 *
 * Pré-requisito: pacote real em data-import/vr-historico-2018-2026/
 * (gitignored — dados privados). Se não existir neste ambiente, o teste
 * pula com aviso em vez de falhar (não é um bug de código, é ausência
 * do pacote de dados privados, que nunca é commitado).
 *
 * Uso: node scripts/test_import_historico_financeiro_2026-08-08.js
 * Pré-requisito: Firestore Emulator rodando (demo-erp-homolog) :8080.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }

var IMPORTER = path.join(__dirname, 'import_historico_financeiro.js');
var DATA_DIR = path.join(__dirname, '..', 'data-import', 'vr-historico-2018-2026');

function runCli(args) {
  try {
    return { ok: true, out: execFileSync('node', [IMPORTER].concat(args), { encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}
async function lerDoc(docId) {
  var snap = await db.collection('erp_vr').doc(docId).get();
  return (snap.exists && snap.data() && snap.data().data) ? JSON.parse(snap.data().data) : {};
}
async function limparDoc(docId) { await db.collection('erp_vr').doc(docId).set({ data: JSON.stringify({}), ts: Date.now() }); }

console.log('\n=== RODADA 3 — Importador histórico financeiro (dry-run/apply/idempotência/rollback reais) ===\n');

(async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('  ⏭️  pacote data-import/vr-historico-2018-2026/ ausente neste ambiente (dados privados, gitignored) — suíte pulada, não é falha de código.');
    console.log('\n=== resultado ===');
    console.log('passed=0 failed=0 (pulado)');
    return;
  }

  // Limpa qualquer estado hist_* residente de execuções anteriores para não
  // acumular importRunIds antigos entre execuções desta suíte.
  var HIST_DOCS = ['hist_mensal', 'hist_nf', 'hist_caixa_diario', 'hist_movimentacoes', 'hist_despesas', 'hist_import_runs'];
  for (var i = 0; i < HIST_DOCS.length; i++) await limparDoc(HIST_DOCS[i]);

  await test('1. dry-run (--mock) não grava nada e reporta os checksums de sanidade batendo', async function () {
    var r = runCli(['--mock']);
    assertTruthy(r.ok, 'dry-run não deve falhar — saída: ' + r.out);
    assertTruthy(r.out.indexOf('DRY-RUN OK') >= 0, 'esperava "DRY-RUN OK" — saída: ' + r.out.slice(-500));
    var mensal = await lerDoc('hist_mensal');
    assertEq(Object.keys(mensal).length, 0, 'dry-run não deve gravar nada em hist_mensal');
  });

  await test('2. apply (--mock --apply) grava as 103 competências de hist_mensal, todas confirmadas', async function () {
    var r = runCli(['--mock', '--apply']);
    assertTruthy(r.ok, 'apply não deve falhar — saída: ' + r.out);
    var mensal = await lerDoc('hist_mensal');
    assertEq(Object.keys(mensal).length, 103, '103 competências (jan/2018 a jul/2026)');
    var confirmadas = Object.values(mensal).filter(function (r) { return r.status === 'confirmado'; });
    assertEq(confirmadas.length, 103, 'todas confirmadas — histórico mensal é a fonte canônica, sem staging');
  });

  await test('3. caixa_diario é sempre status="auxiliar", nunca "confirmado" (nunca substitui hist_mensal)', async function () {
    var caixa = await lerDoc('hist_caixa_diario');
    assertTruthy(Object.keys(caixa).length > 0, 'deveria ter registros de caixa diário');
    var naoAuxiliar = Object.values(caixa).filter(function (r) { return r.status !== 'auxiliar'; });
    assertEq(naoAuxiliar.length, 0, 'todo registro de caixa_diario deve ser auxiliar');
  });

  await test('4. as duas linhas de data impossível (2025-07-34) em movimentações ficam status="revisao", não confirmadas', async function () {
    var mov = await lerDoc('hist_movimentacoes');
    var doDia34 = Object.values(mov).filter(function (r) { return r.dia === 34; });
    assertEq(doDia34.length, 2, 'exatamente as 2 linhas conhecidas (BRADESCO e ITAU)');
    doDia34.forEach(function (r) { assertEq(r.status, 'revisao', 'data impossível nunca é confirmada automaticamente'); });
    var confirmadasComDataValida = Object.values(mov).filter(function (r) { return r.status === 'confirmado'; });
    assertEq(confirmadasComDataValida.length, Object.keys(mov).length - 2, 'todas as outras (data válida) ficam confirmadas');
  });

  await test('5. despesas com revisao_manual=true na origem ficam status="revisao", nunca viram CP automaticamente', async function () {
    var desp = await lerDoc('hist_despesas');
    var emRevisao = Object.values(desp).filter(function (r) { return r.status === 'revisao'; });
    var confirmadas = Object.values(desp).filter(function (r) { return r.status === 'confirmado'; });
    assertEq(emRevisao.length, 317, 'as 317 linhas revisao_manual=true do pacote');
    assertEq(confirmadas.length, 211, 'as 211 linhas sem flag');
  });

  await test('6. reaplicar (--mock --apply de novo) não duplica nenhuma linha — idempotência real por id_importacao', async function () {
    var antesMensal = Object.keys(await lerDoc('hist_mensal')).length;
    var antesDesp = Object.keys(await lerDoc('hist_despesas')).length;
    var r = runCli(['--mock', '--apply']);
    assertTruthy(r.ok, 'segundo apply não deve falhar');
    assertTruthy(r.out.indexOf('0 novo(s), 103 já existiam') >= 0, 'hist_mensal: 0 novos na segunda rodada — saída: ' + r.out);
    var depoisMensal = Object.keys(await lerDoc('hist_mensal')).length;
    var depoisDesp = Object.keys(await lerDoc('hist_despesas')).length;
    assertEq(depoisMensal, antesMensal, 'hist_mensal não cresce ao reaplicar');
    assertEq(depoisDesp, antesDesp, 'hist_despesas não cresce ao reaplicar');
  });

  await test('7. rollback por importRunId remove só os registros daquele lote (nada residual)', async function () {
    var runs = (await lerDoc('hist_import_runs')).runs || [];
    var primeiroRunId = runs[0] && runs[0].importRunId;
    assertTruthy(primeiroRunId, 'precisa haver ao menos um importRunId registrado');
    var r = runCli(['--mock', '--rollback=' + primeiroRunId]);
    assertTruthy(r.ok, 'rollback não deve falhar — saída: ' + r.out);
    var mensalDepois = await lerDoc('hist_mensal');
    var residual = Object.values(mensalDepois).filter(function (row) { return row.importRunId === primeiroRunId; });
    assertEq(residual.length, 0, 'nenhum registro do importRunId revertido deve sobrar em hist_mensal');
  });

  // limpeza final — não deixa dado de teste residente no Emulator compartilhado
  for (var j = 0; j < HIST_DOCS.length; j++) await limparDoc(HIST_DOCS[j]);

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
