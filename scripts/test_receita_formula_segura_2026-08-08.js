/**
 * test_receita_formula_segura_2026-08-08.js
 *
 * RODADA 5 — seção 9: motor de fórmulas seguro para peças de receita.
 * Prova matemática (aritmética correta) E prova de segurança (nenhuma
 * forma de execução arbitrária de JavaScript passa pelo parser).
 *
 * Testa as funções REAIS extraídas de index.html:
 *   receitaFormulaTokenizar / receitaFormulaParsear /
 *   receitaFormulaAvaliar / receitaFormulaValidar
 *
 * Uso: node scripts/test_receita_formula_segura_2026-08-08.js
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

var FN_NAMES = ['receitaFormulaTokenizar', 'receitaFormulaParsear', 'receitaFormulaAvaliar', 'receitaFormulaValidar'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { avaliar: receitaFormulaAvaliar, validar: receitaFormulaValidar };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_formula_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ── prova estrutural: nenhuma chamada a eval/new Function no motor ────────
var motorSrc = FN_NAMES.map(extractFn).join('\n');
var usaEval = /\beval\s*\(/.test(motorSrc) || /new\s+Function\s*\(/.test(motorSrc);

console.log('\n=== RODADA 5 — Motor de fórmulas seguro (aritmética + segurança) ===\n');

test('1. o motor de fórmulas NUNCA usa eval() nem new Function() em nenhuma das 4 funções', usaEval, false);

// ── aritmética correta ────────────────────────────────────────────────
test('2. subtração simples: largura - 2*espessura (500 - 2*3 = 494)', mod.avaliar('largura - 2 * espessura', { largura: 500, espessura: 3 }), { ok: true, valor: 494 });
test('3. precedência: soma e multiplicação (10 + 2*5 = 20, não 60)', mod.avaliar('10 + 2 * 5', {}), { ok: true, valor: 20 });
test('4. parênteses mudam a precedência ((10+2)*5 = 60)', mod.avaliar('(10 + 2) * 5', {}), { ok: true, valor: 60 });
test('5. divisão decimal (100/3 com casas decimais)', mod.avaliar('100 / 3', {}).valor.toFixed(4), (100 / 3).toFixed(4));
test('6. números decimais literais (1.5 * 2 = 3)', mod.avaliar('1.5 * 2', {}), { ok: true, valor: 3 });
test('7. unário negativo (largura - -5 = largura+5)', mod.avaliar('largura - -5', { largura: 100 }), { ok: true, valor: 105 });
test('8. múltiplos parâmetros (altura + largura - folga)', mod.avaliar('altura + largura - folga', { altura: 200, largura: 300, folga: 10 }), { ok: true, valor: 490 });
test('9. parênteses aninhados ((largura - (2*espessura)) / 2)', mod.avaliar('(largura - (2 * espessura)) / 2', { largura: 500, espessura: 3 }), { ok: true, valor: 247 });

// ── validação ao salvar (parâmetro desconhecido é rejeitado) ───────────
test('10. fórmula referenciando parâmetro NÃO declarado é rejeitada ao salvar', mod.validar('largura - alturaSecreta', ['largura', 'espessura']).ok, false);
test('11. fórmula só com parâmetros declarados é aceita', mod.validar('largura - 2 * espessura', ['largura', 'espessura']).ok, true);
test('12. erro de validação identifica qual token falhou', mod.validar('largura + xyz', ['largura']).trecho, 'xyz');

// ── expressões malformadas ──────────────────────────────────────────────
test('13. expressão vazia é rejeitada', mod.avaliar('', {}).ok, false);
test('14. parêntese não fechado é rejeitado', mod.avaliar('(largura - 2', { largura: 100 }).ok, false);
test('15. operador duplo inválido é rejeitado (2 + * 3)', mod.avaliar('2 + * 3', {}).ok, false);
test('16. token sobrando no final é rejeitado (2 + 3 4)', mod.avaliar('2 + 3 4', {}).ok, false);
test('17. parâmetro ausente do contexto de avaliação é rejeitado', mod.avaliar('larguraTotal', {}).ok, false);
test('18. parâmetro com valor não-numérico (string) é rejeitado', mod.avaliar('x', { x: 'abc' }).ok, false);

// ── PROVA DE SEGURANÇA: nenhuma forma de execução arbitrária passa ──────
var TENTATIVAS_MALICIOSAS = [
  'require("fs").readFileSync("/etc/passwd")',
  'process.exit(1)',
  'this.constructor.constructor("return process")()',
  '(() => { while(true){} })()',
  'window.location = "http://evil.com"',
  'largura; alert(1)',
  'largura + eval("1+1")',
  '[].constructor.constructor("return 1")()',
  'largura.constructor',
  '__proto__',
  'largura = 999',            // atribuição não é aritmética permitida
  'largura++',
  'largura ** 2',              // exponenciação não está na lista de operadores permitidos
  'largura % 2',                // módulo não está na lista de operadores permitidos
  '`${largura}`',
  'function(){}()',
];
TENTATIVAS_MALICIOSAS.forEach(function (payload, i) {
  test('19.' + (i + 1) + '. payload malicioso rejeitado: ' + JSON.stringify(payload).slice(0, 50), mod.avaliar(payload, { largura: 100 }).ok, false);
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
