/**
 * test_receita_campos_dinamicos_2026-08-08.js
 *
 * RODADA 6, seção 1 — campos de entrada dinâmicos por produto (além de
 * L/A/P). Testa as funções REAIS extraídas de index.html:
 *   receitaCamposEfetivos / receitaCamposValidar / receitaCamposContexto
 *   planEvalFormulaCtx
 *
 * Prova: uma receita pode declarar campos extras (chave/label/tipo/
 * unidade/obrigatório/min/max/default) sem hardcode, e uma fórmula de
 * peça pode referenciá-los junto com L/A/P/e — nunca via eval()/Function().
 *
 * Uso: node scripts/test_receita_campos_dinamicos_2026-08-08.js
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

var FN_NAMES = [
  'receitaFormulaTokenizar', 'receitaFormulaParsear', 'receitaFormulaAvaliar', 'receitaFormulaValidar',
  'receitaCamposEfetivos', 'receitaCamposValidar', 'receitaCamposContexto',
  'planEvalFormulaCtx',
];
var src = [
  extractVar('RECEITA_CAMPOS_RESERVADOS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { camposEfetivos: receitaCamposEfetivos, camposValidar: receitaCamposValidar, camposContexto: receitaCamposContexto, evalCtx: planEvalFormulaCtx };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_campos_dinamicos_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Campos de entrada dinâmicos por receita (seção 1) ===\n');

// ── receitaCamposEfetivos ────────────────────────────────────────────
{
  var produtoPlano = { dim3d: false, campos: [] };
  var efetivosPlano = mod.camposEfetivos(produtoPlano);
  test('1. produto plano (dim3d=false) tem só L e A embutidos, nunca P', efetivosPlano.map(function(c){return c.chave;}), ['L', 'A']);

  var produto3d = { dim3d: true, campos: [] };
  var efetivos3d = mod.camposEfetivos(produto3d);
  test('2. produto 3D (dim3d=true) tem L, A e P embutidos', efetivos3d.map(function(c){return c.chave;}), ['L', 'A', 'P']);
  test('3. campos embutidos (L/A/P) são marcados builtin=true (não editáveis/removíveis pela UI de campos)', efetivos3d.every(function(c){return c.builtin===true;}), true);

  var produtoComExtra = { dim3d: true, campos: [{ chave: 'furos', label: 'Nº de furos', tipo: 'numero', unidade: 'un', obrigatorio: true, min: 0, max: 20, default: 4 }] };
  var efetivosExtra = mod.camposEfetivos(produtoComExtra);
  test('4. campo extra declarado aparece depois dos embutidos, na ordem cadastrada', efetivosExtra.map(function(c){return c.chave;}), ['L', 'A', 'P', 'furos']);
  test('5. campo extra NÃO é builtin (editável/removível pela UI)', efetivosExtra[3].builtin, false);
  test('6. campo extra preserva label/tipo/unidade/obrigatório/min/max/default', { label: efetivosExtra[3].label, tipo: efetivosExtra[3].tipo, unidade: efetivosExtra[3].unidade, obrigatorio: efetivosExtra[3].obrigatorio, min: efetivosExtra[3].min, max: efetivosExtra[3].max, default: efetivosExtra[3].default }, { label: 'Nº de furos', tipo: 'numero', unidade: 'un', obrigatorio: true, min: 0, max: 20, default: 4 });
}

// ── receitaCamposValidar ─────────────────────────────────────────────
{
  test('7. lista vazia é válida (produto sem campos extras)', mod.camposValidar([]).ok, true);
  test('8. campo sem chave é rejeitado', mod.camposValidar([{ chave: '', label: 'x' }]).ok, false);
  test('9. campo com chave reservada "L" é rejeitado (colidiria com a dimensão embutida)', mod.camposValidar([{ chave: 'L', label: 'x' }]).ok, false);
  test('9.1 campo com chave reservada "e" (espessura) é rejeitado', mod.camposValidar([{ chave: 'e', label: 'x' }]).ok, false);
  test('10. duas chaves iguais são rejeitadas (duplicata)', mod.camposValidar([{ chave: 'furos' }, { chave: 'furos' }]).ok, false);
  test('11. mínimo maior que máximo é rejeitado', mod.camposValidar([{ chave: 'furos', min: 10, max: 2 }]).ok, false);
  test('12. campo bem formado é aceito', mod.camposValidar([{ chave: 'furos', label: 'Furos', min: 0, max: 20 }]).ok, true);
  test('13. múltiplos campos válidos e distintos são aceitos', mod.camposValidar([{ chave: 'furos' }, { chave: 'cor' }]).ok, true);
}

// ── receitaCamposContexto ────────────────────────────────────────────
{
  var produto = { dim3d: true, campos: [
    { chave: 'furos', obrigatorio: true, default: 4 },
    { chave: 'cor', obrigatorio: false },
    { chave: 'reforco', obrigatorio: true },
  ] };
  var r1 = mod.camposContexto(produto, { furos: '6', cor: '2' });
  test('14. valores informados entram no contexto (parseados como número)', r1.ctx, { furos: 6, cor: 2 });
  test('15. L/A/P (builtin) NUNCA entram no contexto retornado — resolvidos separadamente pelo chamador', ('L' in r1.ctx) || ('A' in r1.ctx) || ('P' in r1.ctx), false);
  test('16. campo obrigatório sem valor e sem default (reforco) aparece em faltando', r1.faltando, ['reforco']);

  var r2 = mod.camposContexto(produto, { furos: '', reforco: '10' });
  test('17. campo obrigatório sem valor mas COM default (furos) usa o default, não falta', r2.faltando.indexOf('furos') >= 0, false);
  test('18. default é aplicado corretamente no contexto', r2.ctx.furos, 4);

  var r3 = mod.camposContexto(produto, { reforco: '5' });
  test('19. campo opcional sem valor e sem default vira 0 (nunca falta)', r3.ctx.cor, 0);
  test('20. camposContexto nunca lança com valores ausentes/undefined', function(){ try { mod.camposContexto(produto, undefined); return true; } catch(e){ return false; } }(), true);
}

// ── planEvalFormulaCtx — fórmula usando campo extra + L/A/P/e juntos ───
{
  test('21. fórmula referenciando campo extra junto com L funciona', mod.evalCtx('L - furos*2', { L: 100, furos: 5 }), 90);
  test('22. fórmula só com campo extra funciona', mod.evalCtx('furos * 3', { furos: 4 }), 12);
  test('23. fórmula vazia retorna 0 (mesmo contrato de planEvalFormula)', mod.evalCtx('', { L: 100 }), 0);
  test('24. campo malicioso não passa (mesmo motor seguro, nunca eval/Function)', mod.evalCtx('require("fs")', { L: 100 }), 0);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
