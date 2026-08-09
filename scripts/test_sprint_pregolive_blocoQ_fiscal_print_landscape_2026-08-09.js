/**
 * test_sprint_pregolive_blocoQ_fiscal_print_landscape_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco Q — achado real (confirmado lendo o CSS de
 * impressão): a impressão do Relatório Fiscal usava o mesmo @page
 * A4 RETRATO global de toda a Central de Relatórios, com uma tabela de 9
 * colunas — colunas comprimidas, muita margem em branco na página, texto
 * apertado. As outras abas (Caixa/Mensal/DRE/Contas/Histórico) já
 * funcionavam bem em retrato, então a correção não podia mudar o @page
 * global (afetaria todas elas).
 *
 * Corrigido: o botão "Imprimir" agora chama relImprimir(), que troca
 * dinamicamente para A4 PAISAGEM (injeta um <style> com @page override)
 * só quando a aba Fiscal (_relActiveTab==='nf') está ativa no momento do
 * clique, e remove o override no evento 'afterprint' — nunca deixa a
 * página presa em paisagem para as outras abas.
 *
 * Também corrigido: `.rel-table{break-inside:avoid}` tentava manter a
 * tabela INTEIRA numa única página (quebrava mal com dezenas de linhas);
 * trocado por quebra por LINHA + cabeçalho repetido em cada página
 * (padrão de relatório tabular multi-página), e a tabela do Fiscal ganhou
 * a classe rel-table/rel-fiscal-table (antes usava estilo solto,
 * inconsistente com as outras abas).
 *
 * Uso: node scripts/test_sprint_pregolive_blocoQ_fiscal_print_landscape_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco Q — Relatório Fiscal: impressão A4 paisagem ===\n');

// ── 1-2. Regressão estrutural: botão de impressão e classe da tabela ──
test('1. o botão "Imprimir" de Relatórios chama relImprimir(), não mais window.print() direto',
  /onclick="relImprimir\(\)">🖨️ Imprimir</.test(html), true);
test('2. a tabela do Relatório Fiscal ganhou class="rel-table rel-fiscal-table" (antes, estilo solto sem nenhuma classe)',
  /<table class="rel-table rel-fiscal-table"/.test(html), true);

// ── 3-4. Regras de impressão multi-página (cabeçalho repetido, quebra por linha) ──
test('3. achado real corrigido: cabeçalho da tabela repete em cada página impressa (thead com display:table-header-group)',
  /\.rel-table thead\{display:table-header-group\}/.test(html), true);
test('4. quebra de página agora acontece por LINHA (nunca corta uma linha ao meio), não mais a tabela inteira',
  /\.rel-table tbody tr\{break-inside:avoid;page-break-inside:avoid\}/.test(html), true);

// ── 5-8. Execução real de relImprimir(): landscape só na aba Fiscal, revertido depois ──
{
  var src = extractFn('relImprimir') + '\n\nmodule.exports = { relImprimir: relImprimir };';
  var modPath = path.join(__dirname, '_blocoQ_relimprimir_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  function makeEnv(activeTab) {
    var headChildren = [];
    var listeners = {};
    global._relActiveTab = activeTab;
    global.document = {
      getElementById: function (id) { return headChildren.find(function (e) { return e.id === id; }) || null; },
      createElement: function () { return { id: '', textContent: '', remove: function () { headChildren = headChildren.filter(function (e) { return e !== this; }.bind(this)); } }; },
      head: { appendChild: function (el) { headChildren.push(el); } }
    };
    global.window = {
      printCalls: 0,
      print: function () { this.printCalls++; },
      addEventListener: function (evt, fn) { listeners[evt] = fn; },
      removeEventListener: function (evt) { delete listeners[evt]; }
    };
    return { headChildren: function () { return headChildren; }, fireAfterPrint: function () { if (listeners['afterprint']) listeners['afterprint'](); } };
  }

  var mod = require(modPath);

  var envNF = makeEnv('nf');
  mod.relImprimir();
  test('5. achado real corrigido: imprimindo a aba Fiscal (nf), um <style> de @page paisagem é injetado antes de window.print()',
    envNF.headChildren().some(function (e) { return e.id === 'relPrintPageOverride' && /landscape/.test(e.textContent); }), true);
  test('6. window.print() é chamado normalmente', global.window.printCalls, 1);
  envNF.fireAfterPrint();
  test('7. o override de paisagem é removido no evento afterprint — nunca fica preso em paisagem',
    envNF.headChildren().some(function (e) { return e.id === 'relPrintPageOverride'; }), false);

  var envOutra = makeEnv('caixa');
  mod.relImprimir();
  test('8. regressão — imprimindo qualquer outra aba (ex.: Caixa), nenhum override de paisagem é injetado (continua em retrato, comportamento padrão)',
    envOutra.headChildren().some(function (e) { return e.id === 'relPrintPageOverride'; }), false);

  try { fs.unlinkSync(modPath); } catch (e) {}
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
