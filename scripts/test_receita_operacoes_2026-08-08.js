/**
 * test_receita_operacoes_2026-08-08.js
 *
 * RODADA 6, seção 5 — operações (Corte/Gravação/Montagem/Acabamento/
 * Embalagem) por receita, cada uma Obrigatória/Opcional/Não-aplicável,
 * alimentando o checklist da OS. Testa as funções REAIS extraídas de
 * index.html:
 *   receitaOperacoesEfetivas / receitaOperacoesValidar / osChecklistDeOperacoes
 *
 * Uso: node scripts/test_receita_operacoes_2026-08-08.js
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
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

var FN_NAMES = ['receitaOperacoesEfetivas', 'receitaOperacoesValidar', 'osChecklistDeOperacoes'];
var src = [
  extractVar('OPERACOES_PADRAO'),
  extractVar('OPERACAO_STATUS_VALIDOS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { efetivas: receitaOperacoesEfetivas, validar: receitaOperacoesValidar, checklist: osChecklistDeOperacoes };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_operacoes_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Operações por receita (seção 5) ===\n');

// ── receitaOperacoesEfetivas ─────────────────────────────────────────
{
  var semConfig = mod.efetivas({});
  test('1. produto sem operacoes tem as 5 chaves padrão, todas status=null', semConfig.map(function(o){return o.chave;}), ['corte','gravacao','montagem','acabamento','embalagem']);
  test('2. sem config, todo status é null (legado decide o comportamento)', semConfig.every(function(o){return o.status===null;}), true);

  var comConfig = mod.efetivas({ operacoes: { corte: 'obrigatoria', montagem: 'nao_aplicavel' } });
  test('3. operação configurada reflete o status salvo', comConfig.find(function(o){return o.chave==='corte';}).status, 'obrigatoria');
  test('4. outra operação configurada também reflete', comConfig.find(function(o){return o.chave==='montagem';}).status, 'nao_aplicavel');
  test('5. operação NÃO configurada permanece null mesmo com outras configuradas', comConfig.find(function(o){return o.chave==='gravacao';}).status, null);

  test('6. produto null/undefined não quebra', mod.efetivas(null).length, 5);
}

// ── receitaOperacoesValidar ──────────────────────────────────────────
{
  test('7. sem operacoes (undefined) é válido', mod.validar(undefined).ok, true);
  test('8. objeto vazio é válido', mod.validar({}).ok, true);
  test('9. status válido em chave válida é aceito', mod.validar({ corte: 'obrigatoria' }).ok, true);
  test('10. todos os 3 status são aceitos', ['obrigatoria','opcional','nao_aplicavel'].every(function(s){ return mod.validar({corte:s}).ok; }), true);
  test('11. chave desconhecida é rejeitada', mod.validar({ furar: 'obrigatoria' }).ok, false);
  test('12. status desconhecido é rejeitado', mod.validar({ corte: 'talvez' }).ok, false);
}

// ── osChecklistDeOperacoes ───────────────────────────────────────────
{
  test('13. sem receita (null) e sem montagem paga: comportamento legado (sem Montagem)', mod.checklist(null, false), ['Corte','Gravação','Acabamento','Embalagem']);
  test('14. sem receita (null) e COM montagem paga: comportamento legado inclui Montagem', mod.checklist(null, true), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);

  var receitaSemMontagem = { operacoes: { montagem: 'nao_aplicavel' } };
  test('15. receita marca montagem nao_aplicavel: nunca aparece, mesmo com montagem paga no orçamento', mod.checklist(receitaSemMontagem, true), ['Corte','Gravação','Acabamento','Embalagem']);

  var receitaComGravacaoOpcionalDesligada = { operacoes: { gravacao: 'nao_aplicavel' } };
  test('16. receita desliga uma operação sempre-ligada por padrão (gravação)', mod.checklist(receitaComGravacaoOpcionalDesligada, false), ['Corte','Acabamento','Embalagem']);

  var receitaForcaMontagem = { operacoes: { montagem: 'obrigatoria' } };
  test('17. receita força montagem mesmo SEM montagem paga no orçamento', mod.checklist(receitaForcaMontagem, false), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);

  var receitaOpcionalConta = { operacoes: { corte: 'opcional' } };
  test('18. status "opcional" ainda entra no checklist (só nao_aplicavel exclui)', mod.checklist(receitaOpcionalConta, false), ['Corte','Gravação','Acabamento','Embalagem']);

  var receitaTudoNaoAplicavel = { operacoes: { corte:'nao_aplicavel', gravacao:'nao_aplicavel', acabamento:'nao_aplicavel', embalagem:'nao_aplicavel' } };
  test('19. receita pode zerar o checklist inteiro (produto pronto-entrega, por exemplo)', mod.checklist(receitaTudoNaoAplicavel, false), []);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
