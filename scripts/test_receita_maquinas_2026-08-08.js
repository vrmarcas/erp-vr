/**
 * test_receita_maquinas_2026-08-08.js
 *
 * RODADA 6, seção 6 — máquinas relacionadas à receita, por ID real do
 * cadastro de máquinas (cfgLoad().maquinas, matKey "maq_N"). Puramente
 * informativo para a OS/Produção — nunca duplica custo/hora. Testa as
 * funções REAIS extraídas de index.html:
 *   receitaMaquinasEfetivas / osMaquinasNecessarias
 *
 * O cálculo automático de tempo de laser a partir da planificação real
 * (com preservação do ajuste manual do vendedor) já existe desde a
 * RODADA MESTRE (orcAutoLaser) — não é reimplementado aqui, só reafirmado
 * como pré-condição já satisfeita (ver comentário no index.html).
 *
 * Uso: node scripts/test_receita_maquinas_2026-08-08.js
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

var FN_NAMES = ['receitaMaquinasEfetivas', 'osMaquinasNecessarias'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { efetivas: receitaMaquinasEfetivas, necessarias: osMaquinasNecessarias };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_maquinas_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Máquinas relacionadas à receita (seção 6) ===\n');

var disponiveis = [
  { chave: 'maq_0', nome: 'Plotter de Recorte' },
  { chave: 'maq_1', nome: 'Impressora UV' },
  { chave: 'maq_2', nome: 'Router CNC' },
  { chave: 'maq_3', nome: 'Laminadora' },
];

// ── receitaMaquinasEfetivas ──────────────────────────────────────────
{
  test('1. produto sem maquinasRelacionadas devolve lista vazia', mod.efetivas({}, disponiveis), []);
  test('2. produto null não quebra', mod.efetivas(null, disponiveis), []);

  var comSelecao = { maquinasRelacionadas: ['maq_1', 'maq_2'] };
  test('3. produto com máquinas selecionadas devolve os objetos correspondentes', mod.efetivas(comSelecao, disponiveis), [disponiveis[1], disponiveis[2]]);
  test('4. ordem segue o cadastro disponível, não a ordem salva no produto', mod.efetivas({ maquinasRelacionadas: ['maq_2', 'maq_1'] }, disponiveis), [disponiveis[1], disponiveis[2]]);

  var comReferenciaOrfa = { maquinasRelacionadas: ['maq_1', 'maq_9'] };
  test('5. referência a máquina removida do cadastro (maq_9) é ignorada, não quebra', mod.efetivas(comReferenciaOrfa, disponiveis), [disponiveis[1]]);

  test('6. lista de disponíveis vazia nunca quebra', mod.efetivas(comSelecao, []), []);
  test('7. lista de disponíveis undefined nunca quebra', mod.efetivas(comSelecao, undefined), []);
}

// ── osMaquinasNecessarias ────────────────────────────────────────────
{
  test('8. devolve só os nomes (para exibição direta na OS)', mod.necessarias({ maquinasRelacionadas: ['maq_0', 'maq_3'] }, disponiveis), ['Plotter de Recorte', 'Laminadora']);
  test('9. produto sem seleção devolve lista vazia (nunca inventa máquina)', mod.necessarias({}, disponiveis), []);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
