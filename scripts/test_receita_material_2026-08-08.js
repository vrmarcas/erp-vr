/**
 * test_receita_material_2026-08-08.js
 *
 * RODADA 6, seção 4 — material/espessura ligado à receita, por ID real do
 * Estoque (matKey "cfg_N"), nunca duplicando preço. Testa as funções REAIS
 * extraídas de index.html:
 *   receitaMaterialValidar / orcMaterialSelecaoResolver
 *
 * Uso: node scripts/test_receita_material_2026-08-08.js
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

var FN_NAMES = ['receitaMaterialValidar', 'orcMaterialSelecaoResolver'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { materialValidar: receitaMaterialValidar, selecaoResolver: orcMaterialSelecaoResolver };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_material_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Material/espessura ligado à receita (seção 4) ===\n');

// ── receitaMaterialValidar ───────────────────────────────────────────
{
  test('1. sem padrão e sem permitidos é válido', mod.materialValidar(null, []).ok, true);
  test('2. padrão sem lista de permitidos é válido (nenhuma restrição)', mod.materialValidar('cfg_2', []).ok, true);
  test('3. padrão dentro da lista de permitidos é válido', mod.materialValidar('cfg_2', ['cfg_1', 'cfg_2']).ok, true);
  test('4. padrão FORA da lista de permitidos é inválido', mod.materialValidar('cfg_9', ['cfg_1', 'cfg_2']).ok, false);
  test('5. lista de permitidos sem padrão é válida', mod.materialValidar(null, ['cfg_1', 'cfg_2']).ok, true);
}

// ── orcMaterialSelecaoResolver ───────────────────────────────────────
{
  var disponiveis = ['cfg_0', 'cfg_1', 'cfg_2', 'cfg_3'];

  var semRestricao = mod.selecaoResolver({}, 'cfg_3', disponiveis);
  test('6. receita sem materialPadrao/materiaisPermitidos não mexe na seleção do vendedor', semRestricao, { opcoes: null, valor: 'cfg_3', mudou: false });

  var comPadraoSemAnterior = mod.selecaoResolver({ materialPadrao: 'cfg_1' }, null, disponiveis);
  test('7. receita com materialPadrao e sem seleção anterior aplica o padrão', comPadraoSemAnterior.valor, 'cfg_1');
  test('8. aplicar o padrão sinaliza mudou=true', comPadraoSemAnterior.mudou, true);

  var comPadraoComAnteriorValido = mod.selecaoResolver({ materialPadrao: 'cfg_1' }, 'cfg_2', disponiveis);
  test('9. seleção manual anterior válida NUNCA é sobrescrita pelo padrão (não atropela o vendedor)', comPadraoComAnteriorValido, { opcoes: disponiveis, valor: 'cfg_2', mudou: false });

  var comRestricao = mod.selecaoResolver({ materiaisPermitidos: ['cfg_0', 'cfg_2'] }, 'cfg_1', disponiveis);
  test('10. materiaisPermitidos filtra a lista de opções', comRestricao.opcoes, ['cfg_0', 'cfg_2']);
  test('11. seleção anterior fora da lista permitida é substituída', comRestricao.valor !== 'cfg_1', true);
  test('12. sem padrão, a substituição cai na primeira opção permitida', comRestricao.valor, 'cfg_0');

  var comRestricaoEPadrao = mod.selecaoResolver({ materiaisPermitidos: ['cfg_0', 'cfg_2'], materialPadrao: 'cfg_2' }, 'cfg_1', disponiveis);
  test('13. seleção anterior inválida + padrão definido usa o padrão (não a primeira opção)', comRestricaoEPadrao.valor, 'cfg_2');

  var comRestricaoAnteriorValida = mod.selecaoResolver({ materiaisPermitidos: ['cfg_0', 'cfg_2'] }, 'cfg_2', disponiveis);
  test('14. seleção anterior já dentro da lista permitida é preservada', comRestricaoAnteriorValida.valor, 'cfg_2');
  test('15. preservar seleção válida sinaliza mudou=false', comRestricaoAnteriorValida.mudou, false);

  var semDisponiveis = mod.selecaoResolver({ materialPadrao: 'cfg_1' }, 'cfg_0', []);
  test('16. lista de disponíveis vazia nunca quebra (fallback para o valor anterior)', semDisponiveis.valor, 'cfg_0');

  var padraoNaoExisteMaisNoEstoque = mod.selecaoResolver({ materialPadrao: 'cfg_99' }, 'cfg_0', disponiveis);
  test('17. materialPadrao apontando para um matKey que não existe mais no estoque não quebra e mantém a seleção anterior', padraoNaoExisteMaisNoEstoque.valor, 'cfg_0');
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
