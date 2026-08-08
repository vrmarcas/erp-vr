/**
 * hist_lib.js
 *
 * RODADA 3.1 — extraído de import_historico_financeiro.js para ser
 * reutilizado tanto pelo CLI local (dry-run/apply/rollback direto no
 * Firestore) quanto pelo caminho remoto via Cloud Function administrativa
 * (scripts/apply_via_admin_function.js), sem duplicar a lógica de parsing/
 * normalização/validação em dois lugares — fonte única.
 *
 * Este módulo é puro: não toca em Firestore, não depende de firebase-admin.
 * Só lê arquivos locais (fs) e transforma dados em memória.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function readSource(dataDir, filename) {
  var fp = path.join(dataDir, filename);
  if (!fs.existsSync(fp)) return null;
  var parsed = parseCsv(fs.readFileSync(fp, 'utf8'));
  return { filename: filename, hash: fileHash(fp), rows: parsed.rows };
}

// ── Checksums de sanidade (seção 6 da instrução original) — NUNCA usados
// como substituto dos CSVs, só para detectar parser/conversão quebrados ──
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

// ── Normalização por fonte ───────────────────────────────────────────────
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

module.exports = {
  parseCsv: parseCsv, splitCsvLine: splitCsvLine, num: num, bool: bool, fileHash: fileHash, readSource: readSource,
  CHECKSUMS_ANUAIS: CHECKSUMS_ANUAIS, CHECKSUM_TOLERANCIA: CHECKSUM_TOLERANCIA, validarHistoricoMensal: validarHistoricoMensal,
  normalizarMensal: normalizarMensal, normalizarNF: normalizarNF, normalizarCaixa: normalizarCaixa,
  normalizarMovimentacoes: normalizarMovimentacoes, normalizarDespesas: normalizarDespesas, FONTES: FONTES,
};
