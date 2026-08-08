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

// ── CSV parser mínimo (sem dependência externa) — trata campos entre aspas
// com vírgulas internas (ex.: despesas_custos_extraidos.csv "531.987,00") ──
function parseCsv(text) {
  text = text.replace(/^﻿/, ''); // remove BOM (movimentacoes_bancarias.csv)
  var lines = text.split(/\r\n|\n/).filter(function (l) { return l.length > 0; });
  if (!lines.length) return { header: [], rows: [] };
  var header = splitCsvLine(lines[0]);
  var rows = lines.slice(1).map(function (line) {
    var cols = splitCsvLine(line);
    var obj = {};
    header.forEach(function (h, i) { obj[h] = cols[i] !== undefined ? cols[i] : ''; });
    return obj;
  });
  return { header: header, rows: rows };
}
function splitCsvLine(line) {
  var out = [], cur = '', inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; } }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function num(v) { if (v === undefined || v === '' || v === null) return null; var n = parseFloat(v); return isNaN(n) ? null : n; }
function bool(v) { return String(v).trim().toLowerCase() === 'true'; }
function fileHash(fp) { return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex').slice(0, 16); }

function readSource(filename) {
  var fp = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  var parsed = parseCsv(fs.readFileSync(fp, 'utf8'));
  return { filename: filename, hash: fileHash(fp), rows: parsed.rows };
}

// ── Checksums de sanidade (seção 6 da instrução) — NUNCA usados como
// substituto dos CSVs, só para detectar parser/conversão quebrados ──
var CHECKSUMS_ANUAIS = {
  2018: { vendas: 460244.83, entradas: 516239.53 },
  2019: { vendas: 644007.73, entradas: 675202.42 },
  2020: { vendas: 953949.21, entradas: 933485.96 },
  2021: { vendas: 1133964.79, entradas: 1133098.93 },
  2022: { vendas: 1073136.70, entradas: 1052218.83 },
  2023: { vendas: 1040754.73, entradas: 1052494.42 },
  2024: { vendas: 1235148.56, entradas: 1222228.40 },
  2025: { vendas: 1479857.40, entradas: 1648248.50 },
  2026: { vendas: 901873.53, entradas: 902454.15 }, // jan-jul apenas
};
var CHECKSUM_TOLERANCIA = 1.0; // R$ — soma de floats de 103 linhas, tolera arredondamento de centavos

function validarHistoricoMensal(rows) {
  var problemas = [];
  if (rows.length !== 103) problemas.push('esperado 103 linhas, encontrado ' + rows.length);

  var vistos = {};
  rows.forEach(function (r) {
    var chave = r.ano + '-' + r.mes;
    if (vistos[chave]) problemas.push('duplicata ano+mes: ' + chave);
    vistos[chave] = true;
    if (num(r.vendas_total) === null) problemas.push('vendas_total vazio em ' + r.id_importacao);
    if (num(r.entradas_total) === null) problemas.push('entradas_total vazio em ' + r.id_importacao);
    if (num(r.total_gasto_consolidado) === null) problemas.push('total_gasto_consolidado vazio em ' + r.id_importacao);
  });

  // cobertura jan/2018 a jul/2026, sem buracos
  var esperados = [];
  for (var ano = 2018; ano <= 2026; ano++) {
    var ultimoMes = ano === 2026 ? 7 : 12;
    for (var mes = 1; mes <= ultimoMes; mes++) esperados.push(ano + '-' + mes);
  }
  esperados.forEach(function (chave) { if (!vistos[chave]) problemas.push('mês faltando: ' + chave); });

  var porAno = {};
  rows.forEach(function (r) {
    var ano = parseInt(r.ano, 10);
    if (!porAno[ano]) porAno[ano] = { vendas: 0, entradas: 0 };
    porAno[ano].vendas += num(r.vendas_total) || 0;
    porAno[ano].entradas += num(r.entradas_total) || 0;
  });
  Object.keys(CHECKSUMS_ANUAIS).forEach(function (ano) {
    var esperado = CHECKSUMS_ANUAIS[ano];
    var real = porAno[ano];
    if (!real) { problemas.push('checksum ' + ano + ': nenhum dado encontrado'); return; }
    if (Math.abs(real.vendas - esperado.vendas) > CHECKSUM_TOLERANCIA) {
      problemas.push('checksum ' + ano + ' VENDAS diverge — esperado ' + esperado.vendas.toFixed(2) + ', calculado ' + real.vendas.toFixed(2));
    }
    if (Math.abs(real.entradas - esperado.entradas) > CHECKSUM_TOLERANCIA) {
      problemas.push('checksum ' + ano + ' ENTRADAS diverge — esperado ' + esperado.entradas.toFixed(2) + ', calculado ' + real.entradas.toFixed(2));
    }
  });

  return { ok: problemas.length === 0, problemas: problemas, porAno: porAno };
}

// ── Normalização por fonte — cada linha vira { id, doc } pronto pra staging ──
function normalizarMensal(row, runId, source) {
  return Object.assign({}, row, {
    vendas_vr: num(row.vendas_vr), entradas_vr: num(row.entradas_vr),
    despesas_administrativas_vr: num(row.despesas_administrativas_vr), custos_vr: num(row.custos_vr),
    investimentos_vr: num(row.investimentos_vr), total_gasto_vr: num(row.total_gasto_vr), lucro: num(row.lucro),
    vendas_vitre: num(row.vendas_vitre), entradas_vitre: num(row.entradas_vitre), despesas_vitre: num(row.despesas_vitre),
    vendas_total: num(row.vendas_total), entradas_total: num(row.entradas_total),
    total_gasto_consolidado: num(row.total_gasto_consolidado), valor_nf: num(row.valor_nf),
    ano: parseInt(row.ano, 10), mes: parseInt(row.mes, 10),
    importRunId: runId, sourceFile: source, status: 'confirmado',
  });
}
function normalizarNF(row, runId, source) {
  return Object.assign({}, row, {
    valor_nf: num(row.valor_nf), ano: parseInt(row.ano, 10), mes: parseInt(row.mes, 10),
    importRunId: runId, sourceFile: source, status: 'confirmado',
  });
}
function normalizarCaixa(row, runId, source) {
  return Object.assign({}, row, {
    vendas: num(row.vendas), dinheiro: num(row.dinheiro), boleto: num(row.boleto), cheque: num(row.cheque),
    cartao: num(row.cartao), crediario: num(row.crediario), deposito: num(row.deposito), vitre: num(row.vitre),
    saidas: num(row.saidas), ano: parseInt(row.ano, 10), mes: parseInt(row.mes, 10), dia: parseInt(row.dia, 10),
    revisao_mes: bool(row.revisao_mes),
    importRunId: runId, sourceFile: source,
    status: 'auxiliar', // NUNCA 'confirmado' — granularidade auxiliar, nunca substitui hist_mensal (seção 5/23)
  });
}
function normalizarMovimentacoes(row, runId, source) {
  var dia = parseInt(row.dia, 10), mes = parseInt(row.mes, 10);
  var dataImpossivel = dia > 31 || dia < 1 || mes > 12 || mes < 1;
  return Object.assign({}, row, {
    valor: num(row.valor), ano: parseInt(row.ano, 10), mes: mes, dia: dia,
    importRunId: runId, sourceFile: source,
    // seção 22: as duas linhas '2025-07-34' (BRADESCO e ITAU) NUNCA aplicadas
    // como confirmadas — status=revisao, sem correção de data por inferência.
    status: dataImpossivel ? 'revisao' : 'confirmado',
    motivoRevisao: dataImpossivel ? 'data impossível na origem (dia/mês fora do calendário) — não corrigida por inferência' : null,
  });
}
function normalizarDespesas(row, runId, source) {
  var revisao = bool(row.revisao_manual);
  return Object.assign({}, row, {
    valor: num(row.valor), ano: parseInt(row.ano, 10), mes: parseInt(row.mes, 10),
    importRunId: runId, sourceFile: source,
    // seção 24: revisao_manual=true NUNCA vira despesa/CP efetiva automaticamente.
    status: revisao ? 'revisao' : 'confirmado',
  });
}

var FONTES = [
  { arquivo: 'historico_mensal.csv', doc: 'hist_mensal', normalizar: normalizarMensal, validar: validarHistoricoMensal },
  { arquivo: 'notas_fiscais_historicas.csv', doc: 'hist_nf', normalizar: normalizarNF, validar: null },
  { arquivo: 'caixa_diario.csv', doc: 'hist_caixa_diario', normalizar: normalizarCaixa, validar: null },
  { arquivo: 'movimentacoes_bancarias.csv', doc: 'hist_movimentacoes', normalizar: normalizarMovimentacoes, validar: null },
  { arquivo: 'despesas_custos_extraidos.csv', doc: 'hist_despesas', normalizar: normalizarDespesas, validar: null },
];

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
