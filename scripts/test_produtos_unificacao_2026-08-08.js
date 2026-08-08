/**
 * test_produtos_unificacao_2026-08-08.js
 *
 * RODADA 5 — seções 5/6/41: Produtos & Planificação (_PLAN_PROD_DATA)
 * vira a fonte canônica dos produtos personalizados VR. Testa as funções
 * reais extraídas de index.html:
 *   orcProdutosCanonicos()   — merge que alimenta o <select> do orçamento
 *   orcProdutosReconciliar() — relatório de migração (dry-run, idempotente)
 *
 * Prova: um produto cadastrado em Produtos & Planificação aparece no
 * seletor do orçamento sem precisar cadastrar de novo em Config. Orçamento
 * → Produtos; nomes legados continuam funcionando; nada é apagado.
 *
 * Uso: node scripts/test_produtos_unificacao_2026-08-08.js
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

var FN_NAMES = ['orcProdutosCanonicos', 'orcProdutosReconciliar'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { canonicos: orcProdutosCanonicos, reconciliar: orcProdutosReconciliar };'
].join('\n\n');
var modPath = path.join(__dirname, '_produtos_unificacao_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 5 — Produtos & Planificação como fonte canônica (seletor do orçamento) ===\n');

// ── merge básico ──────────────────────────────────────────────────────
{
  var planProdList = [{ id: 'pp1', nome: 'Caixa Presente' }, { id: 'pp2', nome: 'Expositor Premium' }];
  var orcLegado = ['Armário', 'Caixa', 'Bandeja'];
  var r = mod.canonicos(planProdList, orcLegado);
  test('1. produtos de Produtos & Planificação aparecem no seletor sem recadastro', r.indexOf('Caixa Presente') >= 0, true);
  test('2. produtos legados de ORC_PRODUTOS continuam aparecendo (retrocompat)', r.indexOf('Armário') >= 0, true);
  test('3. nenhum nome duplicado no resultado final', r.length, new Set(r.map(function (x) { return x.toLowerCase(); })).size);
  test('4. total = soma dos dois sem sobreposição (2 + 3 = 5)', r.length, 5);
}

// ── dedup case/trim-insensível: mesmo produto não aparece 2x ──────────
{
  var planProdList = [{ id: 'pp1', nome: 'Caixa' }];
  var orcLegado = ['  caixa  ', 'Armário']; // mesma "Caixa" com espaços/caixa diferente
  var r = mod.canonicos(planProdList, orcLegado);
  test('5. "Caixa" (canônico) e " caixa " (legado) são o MESMO produto — nunca duplica no dropdown', r.filter(function (x) { return x.toLowerCase() === 'caixa'; }).length, 1);
  test('6. a versão canônica (de Produtos & Planificação) é a que prevalece no texto exibido', r.indexOf('Caixa') >= 0, true);
}

// ── sem nenhum produto em Produtos & Planificação ainda — só legado funciona ──
test('7. lista vazia em _PLAN_PROD_DATA não quebra — legado continua funcionando', mod.canonicos([], ['Armário', 'Bandeja']), ['Armário', 'Bandeja']);

// ── sem nenhum produto legado — só canônico ──────────────────────────
test('8. sem nada em ORC_PRODUTOS, mostra só os produtos canônicos', mod.canonicos([{ nome: 'Chaveiro Novo' }], []), ['Chaveiro Novo']);

// ── nomes vazios/inválidos são ignorados, nunca quebram ──────────────
test('9. registro sem nome (string vazia) é ignorado', mod.canonicos([{ nome: '' }, { nome: 'Válido' }], []), ['Válido']);
test('10. entrada nula/undefined na lista legada não quebra', mod.canonicos([], ['Válido', null, undefined, '']), ['Válido']);

// ── reconciliação (migração dry-run, seção 41) ────────────────────────
{
  var planProdList = [{ nome: 'Caixa' }, { nome: 'Expositor' }];
  var orcLegado = ['Armário', 'Caixa', 'Bandeja', 'Expositor', 'Totem'];
  var rel = mod.reconciliar(planProdList, orcLegado);
  test('11. relatório identifica os que JÁ têm receita (Caixa, Expositor)', rel.jaExistem.sort(), ['Caixa', 'Expositor']);
  test('12. relatório identifica os que ainda FALTAM ganhar uma receita (Armário, Bandeja, Totem)', rel.faltamReceita.sort(), ['Armário', 'Bandeja', 'Totem']);
  test('13. relatório conta o total legado corretamente (5)', rel.totalLegado, 5);
  test('14. reconciliação é só leitura — não modifica os arrays originais recebidos', orcLegado, ['Armário', 'Caixa', 'Bandeja', 'Expositor', 'Totem']);
}

// ── idempotência: rodar 2x dá o mesmo resultado (seção 41) ────────────
{
  var planProdList = [{ nome: 'Caixa' }];
  var orcLegado = ['Armário', 'Caixa'];
  var r1 = mod.reconciliar(planProdList, orcLegado);
  var r2 = mod.reconciliar(planProdList, orcLegado);
  test('15. reconciliação é idempotente — rodar 2x dá exatamente o mesmo relatório', r1, r2);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
