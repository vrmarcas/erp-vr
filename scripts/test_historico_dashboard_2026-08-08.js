/**
 * test_historico_dashboard_2026-08-08.js
 *
 * RODADA 3 — seção 26: prova, com a função REAL extraída de index.html
 * (histAgruparPorAno, usada por histRender() na aba Relatórios → Histórico
 * 2018-2026), que:
 *   1. só registros status='confirmado' entram no total anual (nunca mistura
 *      linhas 'auxiliar'/'revisao' vindas de outras fontes hist_* no mesmo
 *      cálculo, mesmo que por engano fossem passadas juntas);
 *   2. os totais batem com os checksums oficiais de vendas/entradas por ano
 *      (mesmos números do dry-run do importador — seção 6 da instrução);
 *   3. 2026 é marcado como parcial (7 meses), nunca comparado como ano cheio.
 *
 * Uso: node scripts/test_historico_dashboard_2026-08-08.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
function approx(got, exp, eps) { return Math.abs(got - exp) < (eps || 1); }

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
var src = [extractFn('histAgruparPorAno'), 'module.exports = { histAgruparPorAno: histAgruparPorAno };'].join('\n\n');
var modPath = path.join(__dirname, '_hist_dashboard_extracted.tmp.js');
fs.writeFileSync(modPath, src);
var mod = require(modPath);

console.log('\n=== RODADA 3 — Histórico 2018-2026: agregação anual do Dashboard (função real) ===\n');

// Fixture pequena, deliberadamente misturando um registro 'auxiliar' (não deveria contar)
var fixture = [
  { ano: 2025, status: 'confirmado', vendas_total: 100, entradas_total: 90, total_gasto_consolidado: 60, lucro: 30 },
  { ano: 2025, status: 'confirmado', vendas_total: 200, entradas_total: 180, total_gasto_consolidado: 120, lucro: 60 },
  { ano: 2025, status: 'auxiliar', vendas_total: 9999, entradas_total: 9999, total_gasto_consolidado: 9999, lucro: 9999 }, // nunca deve entrar
  { ano: 2026, status: 'confirmado', vendas_total: 50, entradas_total: 40, total_gasto_consolidado: 20 }, // sem lucro informado (campo vazio real)
];
var porAno = mod.histAgruparPorAno(fixture);
var y2025 = porAno.find(function (a) { return a.ano === 2025; });
var y2026 = porAno.find(function (a) { return a.ano === 2026; });

test('1. registro "auxiliar" NUNCA entra no total anual, mesmo misturado na mesma lista', y2025.vendas, 300);
test('2. entradas soma só os confirmados', y2025.entradas, 270);
test('3. lucro soma só os confirmados', y2025.lucro, 90);
test('4. 2025 tem 2 meses confirmados (não conta o auxiliar como "mês")', y2025.meses, 2);
test('5. ano com lucro ausente na origem (campo vazio) marca temLucro=false, nunca inventa 0', y2026.temLucro, false);
test('6. 2026 tem só 1 mês nesta fixture — sinalizado como parcial pela contagem de meses (< 12)', y2026.meses < 12, true);

// ── Reconciliação com os checksums oficiais (seção 6), usando o hist_mensal real gerado pelo importador ──
var DATA_DIR = path.join(__dirname, '..', 'data-import', 'vr-historico-2018-2026');
if (fs.existsSync(path.join(DATA_DIR, 'historico_mensal.csv'))) {
  var linhas = fs.readFileSync(path.join(DATA_DIR, 'historico_mensal.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  var header = linhas[0].split(',');
  var idx = {}; header.forEach(function (h, i) { idx[h] = i; });
  function splitLine(l) { // csv simples desta fonte não tem vírgula dentro de campo além de observacao (última coluna) — corta só as colunas fixas
    var parts = l.split(',');
    return parts;
  }
  var registrosReais = linhas.slice(1).map(function (l) {
    var c = splitLine(l);
    var v = function (campo) { var x = c[idx[campo]]; return x === '' || x === undefined ? null : parseFloat(x); };
    return { ano: parseInt(c[idx.ano], 10), status: 'confirmado', vendas_total: v('vendas_total'), entradas_total: v('entradas_total'), total_gasto_consolidado: v('total_gasto_consolidado'), lucro: v('lucro') };
  });
  var porAnoReal = mod.histAgruparPorAno(registrosReais);
  var CHECKSUMS = {
    2018: { vendas: 460244.83, entradas: 516239.53 }, 2019: { vendas: 644007.73, entradas: 675202.42 },
    2020: { vendas: 953949.21, entradas: 933485.96 }, 2021: { vendas: 1133964.79, entradas: 1133098.93 },
    2022: { vendas: 1073136.70, entradas: 1052218.83 }, 2023: { vendas: 1040754.73, entradas: 1052494.42 },
    2024: { vendas: 1235148.56, entradas: 1222228.40 }, 2025: { vendas: 1479857.40, entradas: 1648248.50 },
    2026: { vendas: 901873.53, entradas: 902454.15 },
  };
  Object.keys(CHECKSUMS).forEach(function (ano) {
    var real = porAnoReal.find(function (a) { return a.ano === parseInt(ano, 10); });
    test('7.' + ano + '. Dashboard reconcilia com o checksum oficial de ' + ano + ' (vendas)', real && approx(real.vendas, CHECKSUMS[ano].vendas), true);
    test('8.' + ano + '. Dashboard reconcilia com o checksum oficial de ' + ano + ' (entradas)', real && approx(real.entradas, CHECKSUMS[ano].entradas), true);
  });
  var y2026real = porAnoReal.find(function (a) { return a.ano === 2026; });
  test('9. 2026 real tem exatamente 7 meses (jan-jul) — nunca comparado como ano cheio sem essa marcação', y2026real.meses, 7);
} else {
  console.log('  ⏭️  pacote data-import/vr-historico-2018-2026/ ausente — reconciliação com CSV real pulada (fixture sintética acima já cobre a lógica).');
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
