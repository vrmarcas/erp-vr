/**
 * import_historico_financeiro.js
 *
 * RODADA 3 — seções 18-25: importador do pacote histórico financeiro
 * 2018-2026 (data-import/vr-historico-2018-2026/, gitignored — dados
 * privados de negócio, nunca versionados).
 *
 * Arquitetura: staging por importRunId, idempotente por id_importacao,
 * rollback lógico por importRunId. Cinco fontes, cada uma num documento
 * separado (erp_vr/hist_*), NUNCA um array-agregado único misturando tudo:
 *
 *   historico_mensal.csv         -> hist_mensal          (FONTE CANÔNICA dos agregados mensais)
 *   notas_fiscais_historicas.csv -> hist_nf               (camada histórica fiscal, não gera NF nova)
 *   caixa_diario.csv             -> hist_caixa_diario     (granularidade AUXILIAR — nunca substitui hist_mensal)
 *   movimentacoes_bancarias.csv  -> hist_movimentacoes    (histórico bancário — nunca infere saldo atual)
 *   despesas_custos_extraidos.csv-> hist_despesas         (linhas revisao_manual=true ficam status=revisao)
 *
 * Cada registro grava: { ...campos originais, importRunId, sourceFile, status }.
 * status é 'confirmado' por padrão, exceto:
 *   - caixa_diario: sempre 'auxiliar' (nunca confirmado como total canônico)
 *   - movimentacoes: 'revisao' se dia>31/mes>12 (datas impossíveis, ex. 2025-07-34)
 *   - despesas: 'revisao' se revisao_manual=true na origem
 *
 * NENHUMA linha em staging/revisão vira CP/despesa/movimentação operacional
 * automaticamente — outro fluxo humano decide isso depois, lendo status.
 *
 * Uso:
 *   node scripts/import_historico_financeiro.js --dry-run                                          → valida tudo, não grava nada (padrão se nenhuma flag)
 *   node scripts/import_historico_financeiro.js --dry-run --mock                                    → dry-run contra o Emulator
 *   node scripts/import_historico_financeiro.js --apply --mock                                      → aplica no Emulator
 *   node scripts/import_historico_financeiro.js --apply --confirm-project=erp-vrmarcas              → aplica em produção
 *   node scripts/import_historico_financeiro.js --rollback=<importRunId> --mock                     → desfaz um lote no Emulator
 *   node scripts/import_historico_financeiro.js --rollback=<importRunId> --confirm-project=erp-vrmarcas → desfaz em produção
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data-import', 'vr-historico-2018-2026');
const APPLY = process.argv.includes('--apply');
const MOCK = process.argv.includes('--mock');
const CONFIRM_PROJECT = process.argv.includes('--confirm-project=erp-vrmarcas');
const ROLLBACK_ARG = process.argv.find(function (a) { return a.indexOf('--rollback=') === 0; });
const ROLLBACK_ID = ROLLBACK_ARG ? ROLLBACK_ARG.split('=')[1] : null;
const EXPECTED_PROJECT = 'erp-vrmarcas';

if (MOCK) process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: MOCK ? 'demo-erp-homolog' : EXPECTED_PROJECT });
const db = admin.firestore();

// RODADA 3.1 — parsing/normalização/validação movidos para hist_lib.js
// (módulo puro, sem dependência de firebase-admin) para serem reutilizados
// também pelo caminho remoto via Cloud Function administrativa
// (scripts/apply_via_admin_function.js) sem duplicar a lógica em dois
// lugares — fonte única, mesmo comportamento testado.
const histLib = require('./hist_lib');
var CHECKSUMS_ANUAIS = histLib.CHECKSUMS_ANUAIS;
var validarHistoricoMensal = histLib.validarHistoricoMensal;
var FONTES = histLib.FONTES;
function readSource(filename) { return histLib.readSource(DATA_DIR, filename); }

async function lerDocAtual(docId) {
  var snap = await db.collection('erp_vr').doc(docId).get();
  return (snap.exists && snap.data() && snap.data().data) ? JSON.parse(snap.data().data) : {};
}
async function gravarDoc(docId, obj) {
  await db.collection('erp_vr').doc(docId).set({ data: JSON.stringify(obj), ts: Date.now() });
}

async function dryRun() {
  console.log('\n=== IMPORTADOR HISTÓRICO — DRY-RUN ===\n');
  var runId = 'dryrun_' + Date.now();
  var relatorio = {};
  var algumProblema = false;

  for (var i = 0; i < FONTES.length; i++) {
    var f = FONTES[i];
    var src = readSource(f.arquivo);
    if (!src) { console.log('  ⚠️  ' + f.arquivo + ' não encontrado em ' + DATA_DIR + ' — pulado'); continue; }
    var normalizadas = src.rows.map(function (r) { return f.normalizar(r, runId, f.arquivo); });
    var confirmadas = normalizadas.filter(function (r) { return r.status === 'confirmado'; }).length;
    var revisao = normalizadas.filter(function (r) { return r.status === 'revisao'; }).length;
    var auxiliar = normalizadas.filter(function (r) { return r.status === 'auxiliar'; }).length;
    relatorio[f.doc] = { arquivo: f.arquivo, hash: src.hash, total: src.rows.length, confirmadas: confirmadas, revisao: revisao, auxiliar: auxiliar };
    console.log('  📄 ' + f.arquivo + ' (hash ' + src.hash + '): ' + src.rows.length + ' linhas — confirmadas=' + confirmadas + ' revisao=' + revisao + ' auxiliar=' + auxiliar);

    if (f.validar) {
      var v = f.validar(src.rows);
      relatorio[f.doc].checksums = v.ok ? 'OK' : 'DIVERGENTE';
      if (!v.ok) {
        algumProblema = true;
        console.log('  ❌ VALIDAÇÃO DE ' + f.arquivo + ' FALHOU:');
        v.problemas.forEach(function (p) { console.log('       - ' + p); });
      } else {
        console.log('  ✅ checksums de sanidade batem para todos os anos (2018-2026 jan-jul)');
      }
    }
  }

  console.log('\n' + (algumProblema
    ? '❌ DRY-RUN COM DIVERGÊNCIA — NÃO aplicar em produção até corrigir.'
    : '✅ DRY-RUN OK — seguro para --apply.'));
  return { ok: !algumProblema, relatorio: relatorio };
}

async function apply() {
  if (!MOCK && !CONFIRM_PROJECT) {
    console.error('[import_historico] --apply em produção exige --confirm-project=erp-vrmarcas.');
    process.exitCode = 1; return;
  }
  var dr = await dryRun();
  if (!dr.ok) {
    console.error('\n❌ APPLY ABORTADO — dry-run encontrou divergência. Corrija antes de aplicar.');
    process.exitCode = 1;
    return;
  }

  var runId = 'hist_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  console.log('\n=== APLICANDO — importRunId=' + runId + ' ===\n');

  var runRecord = {
    importRunId: runId, dataImportacao: Date.now(), status: 'concluido',
    usuario: process.env.USER || 'desconhecido', fontes: {},
  };

  for (var i = 0; i < FONTES.length; i++) {
    var f = FONTES[i];
    var src = readSource(f.arquivo);
    if (!src) continue;
    var atual = await lerDocAtual(f.doc);
    var novos = 0, jaExistiam = 0;
    src.rows.forEach(function (r) {
      var norm = f.normalizar(r, runId, f.arquivo);
      var chave = norm.id_importacao;
      if (!chave) return;
      if (atual[chave]) { jaExistiam++; return; } // idempotente — id_importacao já presente, não sobrescreve
      atual[chave] = norm;
      novos++;
    });
    await gravarDoc(f.doc, atual);
    runRecord.fontes[f.doc] = { arquivo: f.arquivo, hash: src.hash, novos: novos, jaExistiam: jaExistiam, totalNaFonte: src.rows.length };
    console.log('  ✅ ' + f.doc + ': ' + novos + ' novo(s), ' + jaExistiam + ' já existiam (idempotente)');
  }

  var runsAtual = await lerDocAtual('hist_import_runs');
  if (!runsAtual.runs) runsAtual.runs = [];
  runsAtual.runs.push(runRecord);
  await gravarDoc('hist_import_runs', runsAtual);

  console.log('\n✅ APLICADO — importRunId=' + runId);
  console.log(JSON.stringify(runRecord, null, 2));
  return runRecord;
}

async function rollback(runId) {
  if (!MOCK && !CONFIRM_PROJECT) {
    console.error('[import_historico] --rollback em produção exige --confirm-project=erp-vrmarcas.');
    process.exitCode = 1; return;
  }
  console.log('\n=== ROLLBACK — importRunId=' + runId + ' ===\n');
  var totalRemovido = 0;
  for (var i = 0; i < FONTES.length; i++) {
    var f = FONTES[i];
    var atual = await lerDocAtual(f.doc);
    var removidos = 0;
    Object.keys(atual).forEach(function (chave) {
      if (atual[chave] && atual[chave].importRunId === runId) { delete atual[chave]; removidos++; }
    });
    if (removidos) { await gravarDoc(f.doc, atual); console.log('  🗑️  ' + f.doc + ': ' + removidos + ' registro(s) removido(s)'); }
    totalRemovido += removidos;
  }
  var runsAtual = await lerDocAtual('hist_import_runs');
  if (runsAtual.runs) {
    var run = runsAtual.runs.find(function (r) { return r.importRunId === runId; });
    if (run) run.status = 'revertido';
    await gravarDoc('hist_import_runs', runsAtual);
  }
  console.log('\n✅ ROLLBACK CONCLUÍDO — ' + totalRemovido + ' registro(s) removido(s) no total. Nenhuma OS/orçamento/estoque/counter foi tocado (rollback é escopado só aos hist_* deste importRunId).');
}

(async function main() {
  if (ROLLBACK_ID) { await rollback(ROLLBACK_ID); return; }
  if (APPLY) { await apply(); return; }
  await dryRun();
})().catch(function (e) { console.error('[import_historico] ERRO:', e); process.exitCode = 1; });
