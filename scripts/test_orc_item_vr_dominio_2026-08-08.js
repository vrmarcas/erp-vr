/**
 * test_orc_item_vr_dominio_2026-08-08.js
 *
 * RODADA 6 — seções 8/9/10/11/13: modelo de domínio do item de orçamento
 * VR. Testa as funções REAIS extraídas de index.html:
 *   orcItemVRConstruir / orcItemVRRestaurarDados / osProjecaoOperacionalItem
 *
 * Estas são as funções que fecham a lacuna encontrada na investigação da
 * Rodada 6: receitaSnapshotParaItem()/receitaResolverParaCalculo() (da
 * Rodada 5) existiam mas nunca eram chamadas pelo pipeline real do
 * orçamento — este arquivo prova o contrato ANTES de conectar ao DOM.
 *
 * Uso: node scripts/test_orc_item_vr_dominio_2026-08-08.js
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

var FN_NAMES = [
  'receitaSnapshotParaItem', 'receitaResolverParaCalculo',
  'orcItemVRConstruir', 'orcItemVRRestaurarDados', 'osProjecaoOperacionalItem',
];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { construir: orcItemVRConstruir, restaurar: orcItemVRRestaurarDados, projecaoOS: osProjecaoOperacionalItem, resolverCalculo: receitaResolverParaCalculo };'
].join('\n\n');
var modPath = path.join(__dirname, '_orc_item_vr_dominio_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Item de orçamento VR: modelo de domínio (recipeSnapshot real) ===\n');

// ── construir item COM produto/receita ──────────────────────────────────
var caixaV1 = {
  id: 'pp_caixa', nome: 'Caixa', desc: 'Caixa simples', dim3d: true,
  pecas: [{ nome: 'Lateral', qty: 2, larg: 'P-2*e', alt: 'A-e' }],
  planificacoes: [], recipeVersion: 1,
};
var dadosLinha1 = {
  prod: 'Caixa', qty: '2', larg: '500', alt: '300', matKey: 'cfg_0', mat: 'Acrílico Cristal 3mm',
  det: '', unit: 'R$ 50,00', total: 'R$ 100,00', planArea: 1500, planManualMatCost: 0, planManualAreaM2: 0.15,
  planPecas: [{ qty: 2, nome: 'Lateral', larg: 200, alt: 300, esp: '3', origem: 'AUTOMATICA' }], extras: null,
};
var itemA = mod.construir(dadosLinha1, caixaV1);

test('1. item construído tem tipoItem=personalizado_vr', itemA.tipoItem, 'personalizado_vr');
test('2. item grava productId', itemA.productId, 'pp_caixa');
test('3. item grava recipeVersion vigente no momento (1)', itemA.recipeVersion, 1);
test('4. item congela recipeSnapshot com as peças da receita', itemA.recipeSnapshot.pecas, caixaV1.pecas);
test('5. item preserva os dados brutos da linha (prod/larg/alt/mat)', { prod: itemA.prod, larg: itemA.larg, alt: itemA.alt, mat: itemA.mat }, { prod: 'Caixa', larg: '500', alt: '300', mat: 'Acrílico Cristal 3mm' });
test('6. item grava pieces (peças efetivamente planificadas, não só a área)', itemA.pieces, dadosLinha1.planPecas);
test('7. item sem produto resolvido (Vitre/legado) não quebra e não grava recipeSnapshot', mod.construir({ prod: 'Item sem receita' }, null).recipeSnapshot, undefined);

// ── restaurar item salvo (reabertura) ───────────────────────────────────
{
  var restaurado = mod.restaurar(itemA);
  test('8. restaurar devolve prod/larg/alt/mat originais', { prod: restaurado.prod, larg: restaurado.larg, alt: restaurado.alt }, { prod: 'Caixa', larg: '500', alt: '300' });
  test('9. restaurar devolve planArea e pieces (fecha o bug de perda de planificação ao reabrir)', { planArea: restaurado.planArea, planPecas: restaurado.planPecas }, { planArea: 1500, planPecas: dadosLinha1.planPecas });
  test('10. restaurar sinaliza temPlanificacao=true quando há área e peças', restaurado.temPlanificacao, true);
  test('11. restaurar devolve o recipeSnapshot INTACTO (para reabertura fiel)', restaurado.recipeSnapshot, itemA.recipeSnapshot);
  test('12. restaurar de um item sem planificação sinaliza temPlanificacao=false', mod.restaurar({ prod: 'Simples', larg: '10', alt: '10' }).temPlanificacao, false);
  test('13. restaurar de undefined/null nunca quebra', mod.restaurar(undefined).prod, '');
}

// ── CENÁRIO OBRIGATÓRIO seção 11 — reabertura fiel end-to-end ─────────
{
  // 1. Receita Caixa v1. 2. Criar orçamento (item A usa v1).
  var itemOrcamentoA = mod.construir(dadosLinha1, caixaV1);
  // 3. Salvar (simulado: o item "salvo" é exatamente o que construir() devolveu)
  var itemASalvo = JSON.parse(JSON.stringify(itemOrcamentoA));

  // 4. Alterar Caixa para v2 (peças diferentes)
  var caixaV2 = Object.assign({}, caixaV1, { recipeVersion: 2, pecas: [{ nome: 'Lateral', qty: 2, larg: 'P-2*e-1', alt: 'A-e-1' }] });

  // 5. Reabrir orçamento antigo — restaurar o item A salvo
  var restauradoA = mod.restaurar(itemASalvo);
  test('14. reabrir o orçamento antigo restaura recipeVersion=1 (nunca a v2 vigente)', restauradoA.recipeVersion, 1);
  test('15. reabrir o orçamento antigo restaura as PEÇAS EXATAS da v1', restauradoA.recipeSnapshot.pecas, caixaV1.pecas);

  // O cálculo, ao reabrir, deve usar o snapshot — nunca a receita atual (v2)
  var calculoParaA = mod.resolverCalculo(itemASalvo, caixaV2);
  test('16. o cálculo do item A usa o snapshot (origem="snapshot"), não a receita v2 vigente', calculoParaA.origem, 'snapshot');
  test('17. as fórmulas usadas para recalcular A são as da v1, não da v2', calculoParaA.pecasFormulas, caixaV1.pecas);
  test('18. medidas/peças históricas de A não mudam mesmo com v2 existindo', JSON.stringify(calculoParaA.pecasFormulas) !== JSON.stringify(caixaV2.pecas), true);
}

// ── projeção operacional para OS (seção 13 — Produção sem financeiro) ──
{
  var itemComFinanceiro = mod.construir(dadosLinha1, caixaV1);
  var projecao = mod.projecaoOS(itemComFinanceiro);
  test('19. projeção da OS NUNCA inclui unit/total (preço)', { unit: projecao.unit, total: projecao.total }, { unit: undefined, total: undefined });
  test('20. projeção da OS mantém os campos operacionais (prod/mat/pieces/recipeSnapshot.pecas)', { prod: projecao.prod, mat: projecao.mat, pieces: projecao.pieces }, { prod: 'Caixa', mat: 'Acrílico Cristal 3mm', pieces: dadosLinha1.planPecas });
  test('21. projeção da OS mantém recipeSnapshot só com dados operacionais (nome/dim3d/peças/campos)', Object.keys(projecao.recipeSnapshot).sort(), ['campos', 'dim3d', 'nome', 'pecas']);
  test('22. projeção da OS nunca vaza planManualMatCost (custo de material manual)', 'planManualMatCost' in projecao, false);
  test('23. projeção da OS lida com item nulo sem quebrar', mod.projecaoOS(null), null);
  test('24. projeção da OS inclui camposExtras (dado operacional, ex: nº de furos) quando presente', mod.projecaoOS(Object.assign({}, itemComFinanceiro, {camposExtras:{furos:6}})).camposExtras, {furos:6});
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
