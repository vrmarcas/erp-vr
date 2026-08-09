/**
 * test_relatorios_impressao_por_aba_2026-08-09.js
 *
 * RODADA 6, seção 4 — impressão-por-aba: achado real — o CSS de impressão
 * de #pg-relatorios forçava TODAS as 6 abas (Caixa/Mensal/DRE/Contas/
 * Fiscal/Histórico) a display:block!important, mesmo estando escondidas
 * em tela (relTab() só mostra a aba ativa). O botão "Imprimir" único
 * imprimia as 6 abas concatenadas, nunca só a que o usuário via na tela.
 *
 * Regressão estrutural: garante que a regra @media print de
 * #pg-relatorios não volta a forçar display:block em [id^="relPg"] —
 * sem essa regra, a impressão respeita o mesmo display:none/block
 * inline que relTab() já mantém em tela.
 *
 * Uso: node scripts/test_relatorios_impressao_por_aba_2026-08-09.js
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

console.log('\n=== RODADA 6, seção 4 — Relatórios: impressão-por-aba ===\n');

var printBlockMatch = html.match(/@media print \{[\s\S]{0,4000}?\n\}/);
if (!printBlockMatch) throw new Error('Bloco @media print de #pg-relatorios não encontrado — teste desatualizado?');
var printBlock = printBlockMatch[0];

test('1. achado real corrigido: @media print não força mais TODAS as abas de relatório a display:block (nunca imprime as 6 juntas)',
  /#pg-relatorios\s*\[id\^="relPg"\]\s*\{[^}]*display:\s*block\s*!important/.test(printBlock), false);

test('2. #pg-relatorios em si continua visível na impressão (a página certa aparece, só as sub-abas não são todas forçadas)',
  /#pg-relatorios\s*\{\s*display:\s*block\s*!important/.test(printBlock), true);

test('3. a barra de abas (rel-tab-bar) continua escondida na impressão (nunca aparece no papel)',
  /\.rel-tab-bar[^{]*\{display:none!important\}|\.rel-tab-bar,[\s\S]{0,200}\{display:none!important\}/.test(printBlock), true);

// ── relTab() continua sendo a única fonte de verdade de qual aba está
//    visível — a impressão depende inteiramente dela funcionar certo.
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
var srcRelTab = extractFn('relTab');
test('4. relTab() continua sendo o único lugar que decide qual aba fica display:block (garante exatamente 1 aba visível por vez)',
  /pg\.style\.display\s*=\s*\(k\.toLowerCase\(\)===t\)\s*\?\s*'block'\s*:\s*'none'/.test(srcRelTab), true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
