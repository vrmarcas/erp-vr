/**
 * test_receita_snapshot_imutabilidade_2026-08-08.js
 *
 * RODADA 6, seção 8/9 — GAP CRÍTICO fechado a pedido explícito do usuário:
 * receitaResolverParaCalculo() existia e era testada desde a Rodada 5, mas
 * NUNCA era chamada pelo pipeline real de planificação (planGetRecipe/
 * planCalc sempre resolviam a receita pela versão VIGENTE em
 * planProdLoad(), nunca pelo recipeSnapshot congelado do item). Ou seja,
 * reabrir um orçamento antigo e recalcular a planificação (mudar L/A,
 * editar peça) silenciosamente passava a usar a fórmula da receita ATUAL,
 * não a da versão salva — quebrando a imutabilidade histórica que vários
 * comentários no código já afirmavam existir.
 *
 * Corrigido: planGetRecipe(produto, recipeSnapshot) agora aceita um 2º
 * parâmetro opcional — quando presente E com o mesmo nome do produto
 * selecionado, a receita usada é SEMPRE a do snapshot (delegando a decisão
 * a receitaResolverParaCalculo(), nunca reimplementada aqui). planAbrir()
 * e planCalc() (chamadores reais) agora leem row.dataset.recipeSnapshot e
 * passam para planGetRecipe() — este teste prova o contrato de
 * planGetRecipe() e, via regex estrutural, que os dois chamadores reais
 * de fato passam o snapshot (para nunca mais regredir silenciosamente).
 *
 * Uso: node scripts/test_receita_snapshot_imutabilidade_2026-08-08.js
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

// ── 1. Contrato puro de planGetRecipe/receitaResolverParaCalculo ───────
var FN_NAMES = [
  'orcProdutoNomeResolvido',
  'receitaFormulaTokenizar', 'receitaFormulaParsear', 'receitaFormulaAvaliar', 'receitaFormulaValidar',
  'receitaResolverParaCalculo', 'planEvalFormulaCtx', 'planGetRecipe',
];
var src = [
  'var PLAN_RECIPES = {};', // stub — sem receitas built-in nestes cenários
  'function planProdLoad(){ return global.__PLAN_PROD_LOAD_FIXTURE || []; }',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { getRecipe: planGetRecipe, resolverCalculo: receitaResolverParaCalculo, setFixture: function(f){ global.__PLAN_PROD_LOAD_FIXTURE = f; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_snapshot_imutabilidade_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Imutabilidade real da receita no recálculo (seção 8/9) ===\n');

var caixaV1 = { nome: 'Caixa', dim3d: false, campos: [], pecas: [{ nome: 'Lateral', qty: 2, larg: 'L', alt: 'A' }] };
var caixaV2 = { nome: 'Caixa', dim3d: false, campos: [], pecas: [{ nome: 'Lateral', qty: 2, larg: 'L/2', alt: 'A/2' }] };
var snapshotV1 = { nome: 'Caixa', dim3d: false, campos: [], pecas: caixaV1.pecas };

// ── NOVO ITEM (sem snapshot) → usa a receita VIGENTE ────────────────────
{
  mod.setFixture([caixaV2]); // produto já foi editado para v2
  var recNovo = mod.getRecipe('Caixa', null);
  var pecasNovo = recNovo.pieces(100, 60, 0, 0.3, {});
  test('1. item novo (sem recipeSnapshot) usa a receita VIGENTE do produto (v2: L/2)', pecasNovo[0].larg, 50);
}

// ── ITEM JÁ SALVO com recipeSnapshot v1 → NUNCA usa a v2 vigente ───────
{
  mod.setFixture([caixaV2]); // produto AINDA está em v2 no cadastro
  var recSalvo = mod.getRecipe('Caixa', snapshotV1);
  var pecasSalvo = recSalvo.pieces(100, 60, 0, 0.3, {});
  test('2. item já salvo com recipeSnapshot usa a fórmula da v1 (L inteiro), mesmo com v2 vigente no cadastro', pecasSalvo[0].larg, 100);
  test('3. NÃO usa a fórmula da v2 (L/2 daria 50 — não pode ser o resultado)', pecasSalvo[0].larg !== 50, true);
}

// ── GUARDA: snapshot de um produto DIFERENTE do selecionado é ignorado ──
{
  mod.setFixture([caixaV2]);
  var snapshotOutroProduto = { nome: 'Placa', dim3d: false, campos: [], pecas: [{ nome: 'Unica', qty: 1, larg: 'L*2', alt: 'A*2' }] };
  var recTrocaProduto = mod.getRecipe('Caixa', snapshotOutroProduto);
  var pecasTroca = recTrocaProduto.pieces(100, 60, 0, 0.3, {});
  test('4. snapshot de outro produto (nome diferente) é ignorado — troca de produto sempre usa a receita vigente do NOVO produto', pecasTroca[0].larg, 50);
}

// ── Fallback sem receita nenhuma (comportamento legado intacto) ────────
{
  mod.setFixture([]);
  var recFallback = mod.getRecipe('ProdutoInexistente', null);
  var pecasFallback = recFallback.pieces(100, 60, 0, 0.3);
  test('5. produto sem receita cadastrada cai no fallback "peça plana" (comportamento legado, sem mudança)', { larg: pecasFallback[0].larg, alt: pecasFallback[0].alt }, { larg: 100, alt: 60 });
}

// ── receitaResolverParaCalculo devolve campos também (não só pecasFormulas) ──
{
  var itemComCampos = { recipeSnapshot: { nome: 'Caixa', dim3d: false, pecas: [], campos: [{ chave: 'furos', obrigatorio: true }] } };
  var resolvido = mod.resolverCalculo(itemComCampos, null);
  test('6. receitaResolverParaCalculo devolve campos do snapshot (necessário para planGetRecipe expor rec.campos)', resolvido.campos, itemComCampos.recipeSnapshot.campos);
}

// ── 2. Regressão estrutural — os chamadores REAIS passam o snapshot ────
// (garante que planAbrir/planCalc nunca voltem a chamar planGetRecipe(produto)
// sem o 2º argumento, silenciando de novo a imutabilidade)
console.log('\n--- Regressão estrutural: planAbrir/planCalc passam recipeSnapshot ---\n');
var planAbrirBody = extractFn('planAbrir');
var planCalcBody = extractFn('planCalc');
test('7. planAbrir() lê row.dataset.recipeSnapshot antes de chamar planGetRecipe', /row\.dataset\.recipeSnapshot/.test(planAbrirBody), true);
test('8. planAbrir() chama planGetRecipe com 2 argumentos (produto, snapshot) — nunca só (produto)', /planGetRecipe\(produto,\s*_savedSnapshot\)/.test(planAbrirBody), true);
test('9. planCalc() lê o recipeSnapshot da linha do item antes de chamar planGetRecipe', /dataset\.recipeSnapshot/.test(planCalcBody), true);
test('10. planCalc() chama planGetRecipe com 2 argumentos (produto, snapshot)', /planGetRecipe\(produto,\s*_savedSnapshotCalc\)/.test(planCalcBody), true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
