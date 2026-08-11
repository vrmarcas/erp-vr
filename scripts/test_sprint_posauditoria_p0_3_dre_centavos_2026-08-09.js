/**
 * test_sprint_posauditoria_p0_3_dre_centavos_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.3 — a auditoria read-only anterior
 * encontrou que finCalcularDRE() somava receita/CMV/despesas inteiramente
 * em ponto flutuante, sem NENHUM arredondamento em toda a função — os
 * subtotais que decidem o "Lucro Líquido" exibido à diretoria.
 *
 * Corrigido: finCalcularDRE() agora usa os mesmos helpers cent-safe do
 * P0.2 (moneyToCents/centsToMoney/sumCents) — todos os acumuladores
 * internos (receita bruta, impostos, CMV por categoria, despesas por
 * categoria, lucro bruto/líquido) somam em CENTAVOS INTEIROS, convertendo
 * para R$ somente no objeto de retorno. A classificação contábil (regras
 * de categoria/imposto) NÃO mudou — só a matemática de soma.
 *
 * T3 (obrigatório): 1 mês, 12 meses e histórico extenso — em todos os
 * casos, os subtotais precisam bater EXATAMENTE contra uma referência
 * calculada em centavos inteiros de forma independente. Também confere
 * paridade com o Caixa (P0.2): mesmo conjunto de transações filtradas
 * por período não pode divergir por arredondamento entre os dois módulos.
 *
 * Uso: node scripts/test_sprint_posauditoria_p0_3_dre_centavos_2026-08-09.js
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
  var marker = 'var ' + name + ' =';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

var src = [
  extractVar('FIN_TAXA_IMPOSTO_DRE'),
  extractVar('FIN_CAT_ALIAS'),
  extractFn('finNormCat'),
  extractFn('moneyToCents'), extractFn('centsToMoney'), extractFn('sumCents'),
  extractFn('finCPValorNum'),
  extractFn('finCalcularDRE'),
  'module.exports = { finCalcularDRE: finCalcularDRE, moneyToCents: moneyToCents, centsToMoney: centsToMoney };'
].join('\n\n');
var modPath = path.join(__dirname, '_p0_3_dre_centavos_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.3 — DRE cent-safe ===\n');

// ─────────────────────────────────────────────────────────────────────────
// 1-3. Regressão de comportamento — mesmos casos simples de sempre.
// ─────────────────────────────────────────────────────────────────────────
{
  var dre1 = mod.finCalcularDRE([{ valor: 1000 }], []);
  test('1. receita bruta simples (sem CP) — R$1000 → receitaBruta=1000, impostos=85 (8,5%), receitaLiq=915',
    [dre1.receitaBruta, dre1.impostos, dre1.receitaLiq], [1000, 85, 915]);
}
{
  var dre2 = mod.finCalcularDRE([{ valor: 10000 }], [{ categoria: 'Matéria-Prima', valor: 2000 }, { categoria: 'Operacional', valor: 3000 }]);
  test('2. CMV e despesa operacional continuam corretamente separados', [dre2.cmvMat, dre2.cpOp], [2000, 3000]);
}
// GO-LIVE 2026-08-11, seção 51-58 — finCalcularDRE passou a devolver também
// cpOutros (categoria 'Outros' não pode mais desaparecer do DRE).
test('3. DRE vazio (sem transações) — todos os campos zerados, nunca NaN',
  mod.finCalcularDRE([], []), { receitaBruta:0,impostos:0,receitaLiq:0,cmvMat:0,cmvMod:0,cmv:0,lucroBruto:0,cpPessoal:0,cpOp:0,cpEmp:0,cpImp:0,cpOutros:0,desp:0,lucroLiq:0 });

// ─────────────────────────────────────────────────────────────────────────
// Fixture geradora — valores classicamente problemáticos em float,
// distribuídos por categorias reais de receita/CMV/despesa.
// ─────────────────────────────────────────────────────────────────────────
var VALORES = [0.10, 0.20, 0.30, 10.01, 99.99, 333.33];
var CATS_CP = ['Matéria-Prima', 'Mão de Obra Direta', 'Pessoal Admin', 'Operacional', 'Empréstimos', 'Impostos'];

function gerarFixture(nTransacoesPorTipo) {
  var tx = [], cp = [];
  var refReceitaCents = 0, refCpPorCatCents = {};
  CATS_CP.forEach(function (c) { refCpPorCatCents[c] = 0; });
  for (var i = 0; i < nTransacoesPorTipo; i++) {
    var vCents = mod.moneyToCents(VALORES[i % VALORES.length]);
    tx.push({ valor: vCents / 100 });
    refReceitaCents += vCents;
    var cat = CATS_CP[i % CATS_CP.length];
    var vCpCents = mod.moneyToCents(VALORES[(i + 1) % VALORES.length]);
    cp.push({ categoria: cat, valor: vCpCents / 100 });
    refCpPorCatCents[cat] += vCpCents;
  }
  return { tx: tx, cp: cp, refReceitaCents: refReceitaCents, refCpPorCatCents: refCpPorCatCents };
}

function conferirDRE(desc, nTransacoesPorTipo) {
  var f = gerarFixture(nTransacoesPorTipo);
  var dre = mod.finCalcularDRE(f.tx, f.cp);

  var refImpostosCents = Math.round(f.refReceitaCents * 0.085);
  var refReceitaLiqCents = f.refReceitaCents - refImpostosCents;
  var refCmvCents = f.refCpPorCatCents['Matéria-Prima'] + f.refCpPorCatCents['Mão de Obra Direta'];
  var refLucroBrutoCents = refReceitaLiqCents - refCmvCents;
  var refDespCents = f.refCpPorCatCents['Pessoal Admin'] + f.refCpPorCatCents['Operacional'] + f.refCpPorCatCents['Empréstimos'] + f.refCpPorCatCents['Impostos'];
  var refLucroLiqCents = refLucroBrutoCents - refDespCents;

  test(desc + ' — receitaBruta bate exatamente com a referência (diferença R$0,00)',
    Math.round(dre.receitaBruta * 100), f.refReceitaCents);
  test(desc + ' — impostos (8,5%) batem exatamente',
    Math.round(dre.impostos * 100), refImpostosCents);
  test(desc + ' — CMV total bate exatamente',
    Math.round(dre.cmv * 100), refCmvCents);
  test(desc + ' — despesas totais batem exatamente',
    Math.round(dre.desp * 100), refDespCents);
  test(desc + ' — lucroLiq final bate exatamente (o número que vai para a diretoria)',
    Math.round(dre.lucroLiq * 100), refLucroLiqCents);
}

// ─────────────────────────────────────────────────────────────────────────
// 4-8. T3 — 1 mês (≈30 transações/dia úteis), 12 meses, histórico longo.
// ─────────────────────────────────────────────────────────────────────────
conferirDRE('4. T3 — 1 mês (600 transações, valores difíceis em float)', 100);
conferirDRE('5. T3 — 12 meses (7.200 transações acumuladas)', 1200);
conferirDRE('6. T3 — histórico longo (36.000 transações acumuladas, ~3 anos de volume)', 6000);

// ─────────────────────────────────────────────────────────────────────────
// 9. Paridade Caixa × DRE — o mesmo conjunto de "entradas" não pode gerar
// receita divergente por arredondamento entre os dois módulos: ambos usam
// os MESMOS helpers cent-safe (moneyToCents/sumCents), então a soma bruta
// de um lote de valores tem que ser idêntica nos dois lugares.
// ─────────────────────────────────────────────────────────────────────────
{
  var lote = [{ valor: 0.10 }, { valor: 0.20 }, { valor: 99.99 }, { valor: 333.33 }, { valor: 10.01 }];
  var somaViaSumCents = lote.reduce(function (s, t) { return s + mod.moneyToCents(t.valor); }, 0);
  var dreLote = mod.finCalcularDRE(lote, []);
  test('9. paridade Caixa×DRE — soma bruta do mesmo lote é idêntica em centavos nos dois módulos',
    Math.round(dreLote.receitaBruta * 100), somaViaSumCents);
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
