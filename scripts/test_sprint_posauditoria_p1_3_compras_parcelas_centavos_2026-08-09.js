/**
 * test_sprint_posauditoria_p1_3_compras_parcelas_centavos_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.3 — a auditoria read-only
 * encontrou que comprasAdicionarDocumento() (functions/src/compras.ts)
 * arredondava cada parcela de forma INDEPENDENTE
 * (Math.round((valorTotal/nParcelas)*100)/100), sem garantir que a soma
 * das parcelas batesse com o total — ex.: R$100,00 / 3 podia virar
 * 3×R$33,33 = R$99,99, faltando R$0,01 sem absorção do resto (o motor de
 * orçamento, index.html/orcDistribuirParcelas, já resolvia isso, mas a
 * correção nunca tinha sido propagada para Compras/CP).
 *
 * Corrigido: distribuirParcelasCentavos(totalCents, n), exportado de
 * functions/src/compras.ts, replica exatamente o algoritmo já usado e
 * testado no motor de orçamento (base = floor(total/n), resto vai
 * inteiro para a PRIMEIRA parcela) — agora reutilizado por
 * comprasAdicionarDocumento() em vez do arredondamento isolado antigo.
 *
 * T6 (obrigatório): para totais divisíveis e não divisíveis, com 2/3/4/
 * 5/12 parcelas, soma(parcelas) === total EXATO, nunca "quase".
 *
 * Uso: node scripts/test_sprint_posauditoria_p1_3_compras_parcelas_centavos_2026-08-09.js
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

var comprasLib = require(path.join(__dirname, '..', 'functions', 'lib', 'compras.js'));
var distribuir = comprasLib.distribuirParcelasCentavos;
if (typeof distribuir !== 'function') {
  console.error('ERRO: distribuirParcelasCentavos não exportado de functions/lib/compras.js — rode `npm run build` em functions/ primeiro.');
  process.exitCode = 1;
  return;
}

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.3 — Compras: parcelas centavo-exatas ===\n');

// ─────────────────────────────────────────────────────────────────────────
// 1-2. Casos básicos de regressão de guarda.
// ─────────────────────────────────────────────────────────────────────────
test('1. R$100,00 (10000 cents) em 1 parcela → [10000]', distribuir(10000, 1), [10000]);
test('2. R$0 em 3 parcelas → [0,0,0] (nunca NaN/undefined)', distribuir(0, 3), [0, 0, 0]);

// ─────────────────────────────────────────────────────────────────────────
// 3-7. T6 — totais divisíveis e não divisíveis, com 2/3/4/5/12 parcelas.
// Prova em CADA caso: soma(parcelas) === total EXATO.
// ─────────────────────────────────────────────────────────────────────────
var TOTAIS_REAIS = [100.00, 100.01, 999.99, 1234.56, 333.33, 0.10, 10000.00];
var NPARCELAS = [2, 3, 4, 5, 12];

TOTAIS_REAIS.forEach(function (totalReais) {
  var totalCents = Math.round(totalReais * 100);
  NPARCELAS.forEach(function (n) {
    var parcelas = distribuir(totalCents, n);
    var soma = parcelas.reduce(function (s, c) { return s + c; }, 0);
    test('T6 — R$' + totalReais.toFixed(2) + ' em ' + n + 'x — soma(parcelas) = total EXATO (' + totalCents + ' cents)', soma, totalCents);
    test('T6 — R$' + totalReais.toFixed(2) + ' em ' + n + 'x — sempre ' + n + ' parcelas geradas', parcelas.length, n);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. Caso literal do enunciado: R$100 / 3 → nunca 3×R$33,33=R$99,99.
// ─────────────────────────────────────────────────────────────────────────
{
  var p = distribuir(10000, 3).map(function (c) { return c / 100; });
  test('8. R$100 em 3x — NUNCA 3×R$33,33 (R$99,99) — resto absorvido, soma exata R$100,00',
    p[0] + p[1] + p[2], 100);
  test('8b. distribuição determinística: primeira parcela absorve o resto (33,34/33,33/33,33)', p, [33.34, 33.33, 33.33]);
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Paridade com o motor de orçamento (orcDistribuirParcelas, index.html)
// — mesmo algoritmo, mesmo resultado, para o mesmo input.
// ─────────────────────────────────────────────────────────────────────────
{
  var fs = require('fs');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var marker = 'function orcDistribuirParcelas(';
  var start = html.indexOf(marker);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  var srcOrc = html.slice(start, i + 1) + '\nmodule.exports = { orcDistribuirParcelas: orcDistribuirParcelas };';
  var tmpPath = path.join(__dirname, '_p1_3_orc_distribuir_extracted.tmp.js');
  fs.writeFileSync(tmpPath, srcOrc);
  delete require.cache[require.resolve(tmpPath)];
  var orcDistribuirParcelas = require(tmpPath).orcDistribuirParcelas;
  test('9. paridade com orcDistribuirParcelas (motor de orçamento) — mesmo resultado para R$1234,56 em 5x',
    distribuir(123456, 5), orcDistribuirParcelas(123456, 5));
  try { fs.unlinkSync(tmpPath); } catch (e) {}
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
