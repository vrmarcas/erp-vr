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
// GO-LIVE 2026-08-11 — mudança de regra de negócio DELIBERADA, decidida
// pelo usuário após o smoke visual final encontrar Montagem ausente do
// checklist de uma OS real: o checklist operacional da OS passou a ser
// SEMPRE os 5 itens fixos (Corte/Gravação/Montagem/Acabamento/Embalagem),
// independentemente da composição comercial/custo do orçamento OU da
// configuração de `operacoes` da receita. A configuração de operações da
// receita segue existindo (testada acima) para uso técnico futuro
// (máquinas/consumíveis), mas não filtra mais o checklist da OS — os
// cenários 13/15/16/18/19 abaixo, que testavam a filtragem antiga, foram
// atualizados para provar que ela não filtra mais nada.
{
  test('13. sem receita (null) e sem montagem paga: checklist SEMPRE os 5 fixos (regra nova, decidida pelo usuário)', mod.checklist(null, false), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);
  test('14. sem receita (null) e COM montagem paga: os 5 fixos (comportamento preservado)', mod.checklist(null, true), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);

  var receitaSemMontagem = { operacoes: { montagem: 'nao_aplicavel' } };
  test('15. receita marca montagem nao_aplicavel: NÃO remove mais Montagem do checklist (config de receita não filtra mais o checklist da OS)', mod.checklist(receitaSemMontagem, true), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);

  var receitaComGravacaoOpcionalDesligada = { operacoes: { gravacao: 'nao_aplicavel' } };
  test('16. receita "desliga" gravação: checklist da OS continua com os 5 fixos mesmo assim', mod.checklist(receitaComGravacaoOpcionalDesligada, false), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);

  var receitaForcaMontagem = { operacoes: { montagem: 'obrigatoria' } };
  test('17. receita força montagem mesmo SEM montagem paga no orçamento (continua presente, como sempre)', mod.checklist(receitaForcaMontagem, false), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);

  var receitaOpcionalConta = { operacoes: { corte: 'opcional' } };
  test('18. status "opcional" na receita: checklist da OS continua com os 5 fixos', mod.checklist(receitaOpcionalConta, false), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);

  var receitaTudoNaoAplicavel = { operacoes: { corte:'nao_aplicavel', gravacao:'nao_aplicavel', acabamento:'nao_aplicavel', embalagem:'nao_aplicavel' } };
  test('19. receita marca tudo como nao_aplicavel: checklist da OS NÃO pode mais ser zerado — sempre os 5 fixos', mod.checklist(receitaTudoNaoAplicavel, false), ['Corte','Gravação','Montagem','Acabamento','Embalagem']);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
