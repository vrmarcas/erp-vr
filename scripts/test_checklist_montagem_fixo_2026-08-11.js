/**
 * test_checklist_montagem_fixo_2026-08-11.js
 *
 * Correção pós-smoke GO-LIVE: o checklist operacional padrão da OS deve
 * SEMPRE ter os 5 itens fixos (Corte/Gravação/Montagem/Acabamento/
 * Embalagem), independentemente de Montagem ter sido cobrada
 * comercialmente no orçamento (orcMontagem) ou da configuração de
 * `operacoes` da receita. Antes desta correção, Montagem só aparecia
 * quando orcMontagem>0 — achado real do smoke visual final.
 *
 * Uso: node scripts/test_checklist_montagem_fixo_2026-08-11.js
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
function extractVar(name) {
  var marker = 'var ' + name + ' = [';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Var ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf('];', start) + 2;
  return html.slice(start, end);
}

var src = [
  extractVar('OPERACOES_PADRAO'),
  "var OPERACAO_STATUS_VALIDOS = ['obrigatoria', 'opcional', 'nao_aplicavel'];",
  extractFn('receitaOperacoesEfetivas'),
  extractFn('osChecklistDeOperacoes'),
  "module.exports = { checklist: osChecklistDeOperacoes, OPERACOES_PADRAO: OPERACOES_PADRAO };",
].join('\n\n');
var modPath = path.join(__dirname, '_checklist_montagem_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== Checklist operacional padrão — Montagem sempre presente ===\n');

test('1. produto sem receita cadastrada, orçamento SEM montagem cobrada (orcMontagem=0) → ainda assim os 5 itens', mod.checklist(null, false), ['Corte', 'Gravação', 'Montagem', 'Acabamento', 'Embalagem']);
test('2. produto sem receita cadastrada, orçamento COM montagem cobrada → os 5 itens (comportamento preservado)', mod.checklist(null, true), ['Corte', 'Gravação', 'Montagem', 'Acabamento', 'Embalagem']);

var receitaComOperacoesConfiguradas = {
  operacoes: { corte: 'obrigatoria', gravacao: 'opcional', montagem: 'nao_aplicavel', acabamento: 'obrigatoria', embalagem: 'obrigatoria' },
};
test('3. receita que marca Montagem como "não-aplicável" (config técnica antiga) → checklist da OS AINDA mostra os 5 (config de receita não remove item do checklist operacional)', mod.checklist(receitaComOperacoesConfiguradas, false), ['Corte', 'Gravação', 'Montagem', 'Acabamento', 'Embalagem']);

test('4. ordem correta: Montagem entre Gravação e Acabamento', mod.checklist(null, false).indexOf('Montagem'), 2);
test('5. lista sempre com exatamente 5 itens', mod.checklist(null, false).length, 5);

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
