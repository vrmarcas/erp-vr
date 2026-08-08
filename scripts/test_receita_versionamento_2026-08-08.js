/**
 * test_receita_versionamento_2026-08-08.js
 *
 * RODADA 5 — seções 12/13/14: versionamento de receita. Testa as funções
 * REAIS extraídas de index.html:
 *   receitaMudancaRelevante / receitaCriarNovaVersao /
 *   receitaSnapshotParaItem / receitaResolverParaCalculo
 *
 * Cobre o cenário EXATO exigido pela seção 13 (teste de imutabilidade
 * histórica):
 *   1. Produto Caixa versão 1.
 *   2. Gerar orçamento A (snapshot v1).
 *   3. Alterar receita para versão 2.
 *   4. Gerar orçamento B (snapshot v2).
 *   5. Abrir orçamento A → permanece exatamente com a receita/snapshot v1.
 *      Peças e medidas históricas de A não mudam mesmo após v2 existir.
 *
 * Uso: node scripts/test_receita_versionamento_2026-08-08.js
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

var FN_NAMES = ['receitaMudancaRelevante', 'receitaCriarNovaVersao', 'receitaSnapshotParaItem', 'receitaResolverParaCalculo'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { mudancaRelevante: receitaMudancaRelevante, criarNovaVersao: receitaCriarNovaVersao, snapshotParaItem: receitaSnapshotParaItem, resolverParaCalculo: receitaResolverParaCalculo };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_versionamento_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 5 — Receita: versionamento e imutabilidade histórica (seção 13) ===\n');

// ── mudança relevante vs irrelevante ────────────────────────────────────
{
  var produto = { id: 'pp1', nome: 'Caixa', desc: 'v1', dim3d: true, pecas: [{ nome: 'Lateral', larg: 'L', alt: 'A' }], recipeVersion: 1 };
  test('1. mudar só a descrição NÃO é relevante (não gera nova versão)', mod.mudancaRelevante(produto, { desc: 'nova descrição' }), false);
  test('2. mudar as peças/fórmulas É relevante (gera nova versão)', mod.mudancaRelevante(produto, { pecas: [{ nome: 'Lateral', larg: 'L-2', alt: 'A' }] }), true);
  test('3. mudar dim3d É relevante', mod.mudancaRelevante(produto, { dim3d: false }), true);
  test('4. produto novo (sem produtoAtual) é sempre "relevante" (é a v1)', mod.mudancaRelevante(null, {}), true);
}

// ── criar nova versão preserva a antiga em recipeHistory ────────────────
{
  var v1 = { id: 'pp1', nome: 'Caixa', desc: 'v1', dim3d: true, pecas: [{ nome: 'Lateral', larg: 'L', alt: 'A' }], recipeVersion: 1, recipeHistory: [] };
  var v2 = mod.criarNovaVersao(v1, { pecas: [{ nome: 'Lateral', larg: 'L-2*e', alt: 'A-e' }] });
  test('5. nova versão incrementa recipeVersion (1 → 2)', v2.recipeVersion, 2);
  test('6. nova versão aplica as peças novas', v2.pecas, [{ nome: 'Lateral', larg: 'L-2*e', alt: 'A-e' }]);
  test('7. recipeHistory preserva a v1 completa (peças antigas)', v2.recipeHistory[0].pecas, [{ nome: 'Lateral', larg: 'L', alt: 'A' }]);
  test('8. recipeHistory marca a versão correta do snapshot antigo', v2.recipeHistory[0].version, 1);

  var v3 = mod.criarNovaVersao(v2, { pecas: [{ nome: 'Lateral', larg: 'L-4', alt: 'A' }] });
  test('9. versionar de novo acumula histórico (v1 E v2 preservadas, nunca sobrescreve)', v3.recipeHistory.map(function (h) { return h.version; }), [1, 2]);
}

// ── CENÁRIO OBRIGATÓRIO DA SEÇÃO 13 ────────────────────────────────────
{
  // 1. Produto Caixa versão 1
  var caixaV1 = {
    id: 'pp_caixa', nome: 'Caixa', desc: 'Caixa simples', dim3d: true,
    pecas: [{ nome: 'Lateral', qty: 2, larg: 'P-2*e', alt: 'A-e' }, { nome: 'Base', qty: 1, larg: 'L', alt: 'P' }],
    planificacoes: [], recipeVersion: 1, recipeHistory: [],
  };

  // 2. Gerar orçamento A — item pega o snapshot vigente (v1)
  var itemA = Object.assign({ prod: 'Caixa' }, mod.snapshotParaItem(caixaV1));
  test('10. item A grava recipeVersion=1', itemA.recipeVersion, 1);
  test('11. item A grava productId apontando para o produto', itemA.productId, 'pp_caixa');
  test('12. item A congela as peças da v1 no snapshot', itemA.recipeSnapshot.pecas, caixaV1.pecas);

  // 3. Alterar receita para versão 2 (peças diferentes — ex.: nova fórmula de folga)
  var caixaV2 = mod.criarNovaVersao(caixaV1, {
    pecas: [{ nome: 'Lateral', qty: 2, larg: 'P-2*e-1', alt: 'A-e-1' }, { nome: 'Base', qty: 1, larg: 'L-1', alt: 'P-1' }],
  });
  test('13. a receita evoluiu para v2', caixaV2.recipeVersion, 2);

  // 4. Gerar orçamento B — usa a receita VIGENTE (agora v2)
  var itemB = Object.assign({ prod: 'Caixa' }, mod.snapshotParaItem(caixaV2));
  test('14. item B grava recipeVersion=2', itemB.recipeVersion, 2);
  test('15. item B congela as peças da v2 (diferentes das de A)', itemB.recipeSnapshot.pecas, caixaV2.pecas);

  // 5. Abrir orçamento A — DEVE permanecer exatamente na v1, mesmo com v2 existindo
  var resolvidoA = mod.resolverParaCalculo(itemA, caixaV2); // produtoAtual já é v2, mas item A tem snapshot
  test('16. reabrir o item A usa o SNAPSHOT (v1), nunca a receita atual (v2)', resolvidoA.recipeVersion, 1);
  test('17. as peças resolvidas para A são EXATAMENTE as da v1 original', resolvidoA.pecasFormulas, caixaV1.pecas);
  test('18. resolverParaCalculo sinaliza a origem como "snapshot" (não "atual")', resolvidoA.origem, 'snapshot');

  var resolvidoB = mod.resolverParaCalculo(itemB, caixaV2);
  test('19. o item B (criado já na v2) resolve para as peças da v2', resolvidoB.pecasFormulas, caixaV2.pecas);

  // Nunca recalcular histórico usando a receita atual
  test('20. peças de A (v1) e B (v2) são DIFERENTES entre si — nunca a mesma receita retroativamente', resolvidoA.pecasFormulas === resolvidoB.pecasFormulas, false);
  test('21. mesmo comparando profundamente, A não "virou" B (larguras diferentes)', resolvidoA.pecasFormulas[0].larg, 'P-2*e');
  test('22. e B mantém sua própria fórmula, sem contaminar A', resolvidoB.pecasFormulas[0].larg, 'P-2*e-1');
}

// ── item legado sem recipeSnapshot cai para a receita vigente ──────────
{
  var produtoAtual = { nome: 'Expositor', dim3d: true, pecas: [{ nome: 'Base' }], recipeVersion: 3 };
  var itemLegado = { prod: 'Expositor' }; // criado antes do versionamento existir — sem recipeSnapshot
  var r = mod.resolverParaCalculo(itemLegado, produtoAtual);
  test('23. item legado (sem snapshot) usa a receita vigente como fallback', r.origem, 'atual');
  test('24. item legado sem produto correspondente e sem snapshot retorna null (nunca quebra)', mod.resolverParaCalculo({}, null), null);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
