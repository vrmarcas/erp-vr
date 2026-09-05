/**
 * test_estabilizacao_bloco5_produtos_configuraveis_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 5 — Produtos Padrão
 * configuráveis. Investigação encontrou que a maior parte do pedido já
 * existia (Produtos & Receitas de Planificação: criar/editar produto
 * customizado, peças/fórmulas seguras, snapshot histórico imutável,
 * versionamento) — os 2 gaps reais fechados nesta rodada:
 *
 * (1) Não havia como desativar/reativar um produto sem apagá-lo de vez
 * (só existia planProdDel(), exclusão definitiva). Adicionado
 * planProdToggleAtivo() + filtro em orcProdutosCanonicos() (produto
 * inativo nunca aparece pra um item NOVO; nunca afeta orçamento já
 * existente, que usa o recipeSnapshot congelado no item).
 *
 * (2) Os campos dimensionais do modal de Planificação eram SEMPRE
 * rotulados "Comprimento/Largura/Altura", hardcoded, para qualquer
 * produto (nunca por nome de produto — mas também nunca configurável).
 * Adicionado labelL/labelA/labelP configuráveis por produto (opcional;
 * vazio cai no padrão de sempre) — threaded por planGetRecipe(),
 * receitaResolverParaCalculo() (incluindo o snapshot histórico
 * congelado) e aplicado no modal via _planAtualizarLabelsDim().
 *
 * Uso: node scripts/test_estabilizacao_bloco5_produtos_configuraveis_2026-09-04.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 5 — Produtos Padrão configuráveis ===\n');

// ══════════════════════════════════════════════════════════════════════
// PROVA DE EXECUÇÃO — orcProdutosCanonicos() filtra produto inativo
// ══════════════════════════════════════════════════════════════════════
var src1 = [
  extractFn('orcProdutosCanonicos'),
  'module.exports = { orcProdutosCanonicos: orcProdutosCanonicos };'
].join('\n\n');
var modPath1 = path.join(__dirname, '_estabilizacao_bloco5_canonicos_extracted.tmp.js');
fs.writeFileSync(modPath1, src1);
delete require.cache[require.resolve(modPath1)];
var mod1 = require(modPath1);

test('1. Produto customizado ATIVO (padrão) aparece na lista de seleção', function () {
  var lista = mod1.orcProdutosCanonicos([{ nome: 'Caixa Especial' }], []);
  assertTrue(lista.indexOf('Caixa Especial') >= 0, 'produto sem ativo definido (undefined) deve contar como ativo');
});

test('2. Produto customizado com ativo:0 NUNCA aparece na lista de seleção de item NOVO', function () {
  var lista = mod1.orcProdutosCanonicos([{ nome: 'Produto Descontinuado', ativo: 0 }], []);
  assertTrue(lista.indexOf('Produto Descontinuado') < 0, 'produto desativado não pode ser oferecido para um item novo');
});

test('3. Produto explicitamente ativo:1 continua aparecendo normalmente', function () {
  var lista = mod1.orcProdutosCanonicos([{ nome: 'Caixa Normal', ativo: 1 }], []);
  assertTrue(lista.indexOf('Caixa Normal') >= 0, 'ativo:1 deve continuar visível');
});

test('4. Mistura de ativos/inativos: só os ativos aparecem, ordem preservada', function () {
  var lista = mod1.orcProdutosCanonicos([
    { nome: 'A', ativo: 1 }, { nome: 'B', ativo: 0 }, { nome: 'C' }
  ], []);
  assertEq(lista, ['A', 'C'], 'apenas A e C (ativos) devem aparecer, na ordem original');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — planProdToggleAtivo existe e nunca remove o produto
// (diferente de planProdDel — apenas alterna o campo `ativo`)
// ══════════════════════════════════════════════════════════════════════
test('5. planProdToggleAtivo() alterna o campo `ativo`, nunca remove o produto da lista (diferente de planProdDel)', function () {
  var src = extractFn('planProdToggleAtivo');
  assertTrue(/p\.ativo\s*=/.test(src), 'deve escrever em p.ativo');
  assertTrue(!/prods\.filter|prods\.splice/.test(src), 'nunca deve remover o produto do array — isso é papel exclusivo de planProdDel()');
  assertTrue(/planProdSaveList/.test(src), 'deve persistir a mudança');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA DE EXECUÇÃO — labels dimensionais configuráveis, threaded pelo
// motor de receita real (planGetRecipe / receitaResolverParaCalculo).
// ══════════════════════════════════════════════════════════════════════
var FN_LABELS = ['planGetRecipe', 'receitaResolverParaCalculo'];
var src2 = FN_LABELS.map(extractFn).join('\n\n') + '\n\nmodule.exports = { planGetRecipe: planGetRecipe };';
var modPath2 = path.join(__dirname, '_estabilizacao_bloco5_labels_extracted.tmp.js');
fs.writeFileSync(modPath2, src2);

function montarAmbienteLabels(customs, planRecipesVazio) {
  global.planProdLoad = function () { return customs; };
  global.PLAN_RECIPES = planRecipesVazio || {};
}

test('6. Produto customizado COM labelL/labelA configurados: planGetRecipe() propaga os labels reais', function () {
  montarAmbienteLabels([{ nome: 'Bola Decorativa', dim3d: false, pecas: [], labelL: 'Diâmetro', labelA: 'Altura da base' }]);
  delete require.cache[require.resolve(modPath2)];
  var mod = require(modPath2);
  var rec = mod.planGetRecipe('Bola Decorativa', null);
  assertEq(rec.labelL, 'Diâmetro', 'labelL customizado deve ser propagado');
  assertEq(rec.labelA, 'Altura da base', 'labelA customizado deve ser propagado');
});

test('7. Produto customizado SEM labels configurados: planGetRecipe() retorna string vazia (UI cai no padrão Comprimento/Largura/Altura)', function () {
  montarAmbienteLabels([{ nome: 'Caixa Simples', dim3d: false, pecas: [] }]);
  delete require.cache[require.resolve(modPath2)];
  var mod = require(modPath2);
  var rec = mod.planGetRecipe('Caixa Simples', null);
  assertEq(rec.labelL, '', 'sem customização, labelL deve ser vazio — nunca undefined/erro');
  assertEq(rec.labelA, '', 'sem customização, labelA deve ser vazio');
});

test('8. recipeSnapshot HISTÓRICO (item já salvo) preserva os labels congelados no momento da venda — nunca herda o label vigente do produto', function () {
  montarAmbienteLabels([{ nome: 'Bola Decorativa', dim3d: false, pecas: [], labelL: 'Diâmetro NOVO (mudou depois)' }]);
  delete require.cache[require.resolve(modPath2)];
  var mod = require(modPath2);
  var snapshotAntigo = { nome: 'Bola Decorativa', dim3d: false, pecas: [], labelL: 'Diâmetro ANTIGO (congelado na venda)' };
  var rec = mod.planGetRecipe('Bola Decorativa', snapshotAntigo);
  assertEq(rec.labelL, 'Diâmetro ANTIGO (congelado na venda)', 'reabrir item histórico deve usar o label CONGELADO no snapshot, nunca o vigente do cadastro');
});

test('9. Produto BUILT-IN (PLAN_RECIPES, sem customização) continua funcionando — sem labelL/labelA (undefined), UI usa o padrão', function () {
  montarAmbienteLabels([], { 'Caixa': { dim3d: true, desc: 'Caixa padrão', pieces: function () { return []; } } });
  delete require.cache[require.resolve(modPath2)];
  var mod = require(modPath2);
  var rec = mod.planGetRecipe('Caixa', null);
  assertTrue(rec.dim3d === true, 'produto built-in continua resolvendo normalmente');
  assertTrue(rec.labelL === undefined, 'built-in não declara labelL — _planAtualizarLabelsDim() trata como padrão');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — receitaSnapshotParaItem() persiste labelL/labelA/labelP
// no momento da venda (senão o teste 8 acima não teria o que congelar).
// ══════════════════════════════════════════════════════════════════════
test('10. receitaSnapshotParaItem() grava labelL/labelA/labelP no snapshot congelado', function () {
  var src = extractFn('receitaSnapshotParaItem');
  assertTrue(/labelL:\s*produto\.labelL/.test(src), 'snapshot deve incluir labelL do produto no momento da venda');
  assertTrue(/labelA:\s*produto\.labelA/.test(src), 'snapshot deve incluir labelA do produto no momento da venda');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
