/**
 * test_cloud_load_all_counter_2026-08-08.js
 *
 * RODADA 4 — achado real: _cloudLoadAll() tinha `total=11` enquanto o corpo
 * real da função já continha 42 chamadas de done() — desatualizado ao longo
 * de várias rodadas que adicionaram _cloudLoad(...) sem atualizar o número.
 * Como done() só marca _cloudReady=true quando loaded>=total, um total
 * baixo demais dispara o "pronto"/refresh inicial ANTES de todo o estado da
 * nuvem ter chegado (silencioso — nunca lança erro, só corrompe timing).
 *
 * Guarda de regressão: reconta programaticamente as chamadas de done()
 * dentro do corpo real de _cloudLoadAll() e falha se o `total` declarado
 * divergir — nunca deixa esse número voltar a apodrecer sem ser notado.
 *
 * Uso: node scripts/test_cloud_load_all_counter_2026-08-08.js
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

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var marker = 'function _cloudLoadAll(';
var start = html.indexOf(marker);
if (start < 0) throw new Error('_cloudLoadAll não encontrada — teste desatualizado?');
var braceOpen = html.indexOf('{', start);
var depth = 0, i = braceOpen;
for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
var body = html.slice(start, i + 1);

var mTotal = body.match(/var loaded = 0, total = (\d+);/);
if (!mTotal) throw new Error('declaração de `total` não encontrada no formato esperado — teste desatualizado?');
var totalDeclarado = parseInt(mTotal[1], 10);
// RODADA 6 — achado real: `/done\(\)/g` também batia na PRÓPRIA declaração
// `function done() {`, inflando a contagem em +1 sempre — mascarando
// exatamente o tipo de off-by-one que este teste existe para pegar (ver
// achado do total=43 nesta mesma rodada). Chamadas reais sempre terminam
// em `done();` (ponto e vírgula logo após); a declaração termina em `{`.
var chamadasReaisDeDone = (body.match(/done\(\);/g) || []).length;

console.log('\n=== RODADA 4 — _cloudLoadAll(): total declarado deve bater com as chamadas reais de done() ===\n');

test('1. `total` declarado bate exatamente com o número real de chamadas de done() no corpo da função', totalDeclarado, chamadasReaisDeDone);
test('2. as 4 novas coleções financeiras desta rodada (fin_cp_recorrencias/fin_cartoes/fin_cartao_compras/fin_faturas) têm _cloudLoad no boot', ['fin_cp_recorrencias', 'fin_cartoes', 'fin_cartao_compras', 'fin_faturas'].every(function (doc) { return body.indexOf('_cloudLoad("' + doc + '"') >= 0; }), true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
