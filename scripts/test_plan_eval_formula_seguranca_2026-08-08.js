/**
 * test_plan_eval_formula_seguranca_2026-08-08.js
 *
 * RODADA 5 — seção 9: achado de segurança corrigido. planEvalFormula()
 * (usada pelas receitas de _PLAN_PROD_DATA para calcular largura/altura
 * de cada peça a partir de L/A/P/e) usava `Function()` — execução
 * arbitrária de JS protegida só por um regex — exatamente o padrão que
 * este enunciado proíbe. Prova aqui que:
 *   1. a função REAL em produção não usa mais eval()/new Function();
 *   2. o comportamento matemático para receitas reais (PLAN_RECIPES-like)
 *      continua idêntico ao de antes (mesmo arredondamento/clamp);
 *   3. formulas maliciosas continuam retornando 0 (mesmo contrato de
 *      antes: nunca lança, sempre 0 em erro) — nunca executam.
 *
 * Uso: node scripts/test_plan_eval_formula_seguranca_2026-08-08.js
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
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

var FN_NAMES = [
  'receitaFormulaTokenizar', 'receitaFormulaParsear', 'receitaFormulaAvaliar', 'receitaFormulaValidar',
  'planEvalFormula',
];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { planEvalFormula: planEvalFormula };'
].join('\n\n');
var modPath = path.join(__dirname, '_plan_eval_formula_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 5 — planEvalFormula(): eval()/Function() eliminado, matemática preservada ===\n');

// ── prova estrutural: a função real não contém mais Function()/eval() ────
var planEvalSrc = extractFn('planEvalFormula');
var usaExecArbitraria = /\beval\s*\(/.test(planEvalSrc) || /\bFunction\s*\(/.test(planEvalSrc) || /new\s+Function/.test(planEvalSrc);
test('1. planEvalFormula() não contém mais eval()/Function()/new Function()', usaExecArbitraria, false);

// ── matemática idêntica ao comportamento anterior (fórmulas reais de receita) ──
test('2. "L-2*e" com L=500,e=3 → 494 (mesma fórmula usada em Armário/Caixa/Expositor)', mod.planEvalFormula('L-2*e', 500, 300, 200, 3), 494);
test('3. "(L-2*e)/2" com L=500,e=3 → 247 (Porta do Armário)', mod.planEvalFormula('(L-2*e)/2', 500, 300, 200, 3), 247);
test('4. usa os 4 parâmetros L/A/P/e simultaneamente', mod.planEvalFormula('L+A+P-e', 100, 200, 300, 10), 590);
test('5. resultado é arredondado a 2 casas decimais', mod.planEvalFormula('L/3', 100, 0, 0, 0), 33.33);
test('6. resultado nunca fica negativo (clamp a 0)', mod.planEvalFormula('L-A', 10, 100, 0, 0), 0);
test('7. fórmula vazia retorna 0 (mesmo contrato de antes)', mod.planEvalFormula('', 100, 100, 100, 1), 0);

// ── fórmulas maliciosas continuam seguras (mesmo contrato: 0, nunca lança) ──
var MALICIOSAS = [
  'require("fs").readFileSync("/etc/passwd")',
  'process.exit(1)',
  'this.constructor.constructor("return process")()',
  'window.location="http://evil.com"',
  'L; alert(1)',
  '(()=>{while(true){}})()',
];
MALICIOSAS.forEach(function (payload, i) {
  test('8.' + (i + 1) + '. fórmula maliciosa retorna 0 com segurança, nunca executa: ' + JSON.stringify(payload).slice(0, 40), mod.planEvalFormula(payload, 100, 100, 100, 1), 0);
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
