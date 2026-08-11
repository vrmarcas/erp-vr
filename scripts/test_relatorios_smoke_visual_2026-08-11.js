/**
 * test_relatorios_smoke_visual_2026-08-11.js
 *
 * Item 4 da correção pós-smoke GO-LIVE: smoke visual dos 8 relatórios
 * financeiros encontrou 2 bugs reais em produção, ambos ligados à mesma
 * causa raiz (CP de fatura de cartão não tem `categoria` própria — a
 * composição real vive em `composicaoCategorias`):
 *
 * 1. Dashboard Financeiro → "Despesas por Categoria" (finDonutRender):
 *    toda fatura de cartão paga caía inteira em "Sem categoria", porque a
 *    função só olhava `c.categoria` (sempre null para CP de cartão) e
 *    nunca decompunha `composicaoCategorias` — diferente de
 *    relContasPagas/finCalcularDRE, que já faziam essa decomposição
 *    corretamente. Corrigido para decompor `composicaoCategorias` também
 *    aqui, mesmo padrão das outras duas funções.
 *
 * 2. DRE (aba Central de Relatórios → DRE): quando o período fecha em
 *    prejuízo, a linha continuava rotulada "LUCRO LÍQUIDO DO PERÍODO" com
 *    o valor absoluto em vermelho — sem sinal negativo nem troca de
 *    rótulo, só a cor sinalizava a perda (ambíguo/inacessível, e a outra
 *    tela de DRE do sistema já usa "Prejuízo do Período" corretamente).
 *    Corrigido para trocar o rótulo para "PREJUÍZO DO PERÍODO" quando
 *    lucroLiq<0, igual ao padrão já usado alhures no sistema.
 *
 * Uso: node scripts/test_relatorios_smoke_visual_2026-08-11.js
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

console.log('\n=== Relatórios — smoke visual final (2 bugs reais encontrados e corrigidos) ===\n');

// ── 1. finDonutRender decompõe composicaoCategorias ──────────────────────
(function () {
  var src = [
    "function finNormCat(c){ return c; }",
    extractFn('finCPValorNum'),
    extractFn('finDonutRender'),
    "module.exports = { render: finDonutRender };",
  ].join('\n\n');
  var modPath = path.join(__dirname, '_dre_donut_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  global.FIN_CP = [
    { status: 'pago', categoria: null, composicaoCategorias: { 'Operacional': 500 } },
  ];
  var svgEl = { innerHTML: '' }, legEl = { innerHTML: '' };
  global.document = { getElementById: function (id) { return id === 'finDonut' ? svgEl : (id === 'finDonutLegend' ? legEl : null); } };
  var mod = require(modPath);
  mod.render();
  test('1a. CP de fatura de cartão (categoria=null, composicaoCategorias={Operacional:500}) NÃO cai em "Sem categoria"', /Sem categoria/.test(legEl.innerHTML), false);
  test('1b. decompõe corretamente para "Operacional" — 100%', /Operacional/.test(legEl.innerHTML) && /100%/.test(legEl.innerHTML), true);

  global.FIN_CP = [
    { status: 'pago', categoria: null, composicaoCategorias: { 'Matéria-Prima': 300, 'Impostos': 200 } },
  ];
  legEl.innerHTML = '';
  mod.render();
  test('1c. multi-categoria (Matéria-Prima 300 + Impostos 200) decompõe as duas, nenhuma vira "Sem categoria"', /Sem categoria/.test(legEl.innerHTML), false);
  test('1d. multi-categoria mostra Matéria-Prima', /Matéria-Prima/.test(legEl.innerHTML), true);
  test('1e. multi-categoria mostra Impostos', /Impostos/.test(legEl.innerHTML), true);

  global.FIN_CP = [
    { status: 'pago', categoria: null, composicaoCategorias: null, valor: 150 },
  ];
  legEl.innerHTML = '';
  mod.render();
  test('1f. CP legado sem composicaoCategorias E sem categoria própria (nunca existiu no sistema) continua caindo em "Sem categoria" — comportamento legado preservado', /Sem categoria/.test(legEl.innerHTML), true);

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── 2. DRE mostra "PREJUÍZO DO PERÍODO" quando lucroLiq<0 ─────────────────
(function () {
  // A linha do array dreRows decide o rótulo dinamicamente — replicamos só
  // essa decisão (não a função inteira de render, que depende de ~15
  // variáveis de contexto da tela) para provar a correção real do código.
  var marker = "{lbl:lucroLiq>=0?'LUCRO LÍQUIDO DO PERÍODO':'PREJUÍZO DO PERÍODO', val:lucroLiq, bold:true,tipo:lucroLiq>=0?'positivo':'negativo'}";
  test('2a. código-fonte usa rótulo dinâmico (LUCRO LÍQUIDO vs PREJUÍZO) na linha final do DRE da Central de Relatórios', html.indexOf(marker) >= 0, true);

  function lbl(lucroLiq) { return lucroLiq >= 0 ? 'LUCRO LÍQUIDO DO PERÍODO' : 'PREJUÍZO DO PERÍODO'; }
  test('2b. período com lucro positivo → rótulo "LUCRO LÍQUIDO DO PERÍODO"', lbl(500), 'LUCRO LÍQUIDO DO PERÍODO');
  test('2c. período com prejuízo (-500) → rótulo "PREJUÍZO DO PERÍODO", nunca "LUCRO" sem sinal', lbl(-500), 'PREJUÍZO DO PERÍODO');
  test('2d. período exatamente zero → rótulo "LUCRO LÍQUIDO DO PERÍODO" (empate tratado como não-prejuízo)', lbl(0), 'LUCRO LÍQUIDO DO PERÍODO');
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
