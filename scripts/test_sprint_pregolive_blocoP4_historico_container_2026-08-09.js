/**
 * test_sprint_pregolive_blocoP4_historico_container_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco P4 — achado real (mesma classe de bug da
 * Rodada 6.1 com o Relatório Fiscal, confirmado lendo o HTML): a aba
 * "Histórico" de Relatórios abria sempre em branco, apesar dos dados de
 * 2018-2026 estarem importados. Causa raiz: o painel (#relPgHistorico /
 * #histBody) só existia dentro do container legado #pg-financeiro
 * (permanentemente display:none — nunca visível em tela nem impressão),
 * enquanto o botão da aba (#relTabBtnHistorico) vive no container atual
 * #pg-relatorios. relTab('historico') → histRender() populava o
 * #histBody órfão do container oculto — sem erro no console, nada
 * aparecia.
 *
 * Corrigido movendo o painel para dentro de #pg-relatorios (logo após
 * relPgNF — mesmo padrão usado na Rodada 6.1). Também renomeado o botão
 * da aba de "Histórico 2018-2026" para "Histórico", conforme pedido —
 * sem remover a informação do período coberto, que permanece no texto
 * explicativo dentro do próprio painel.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoP4_historico_container_2026-08-09.js
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

function findTagBlock(id) {
  var marker = new RegExp('<div id="' + id + '"');
  var m = marker.exec(html);
  if (!m) return null;
  var start = m.index;
  var i = html.indexOf('>', start) + 1;
  var depth = 1;
  var re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  var mm;
  while ((mm = re.exec(html))) {
    if (mm[0] === '<\/div>') { depth--; if (depth === 0) return { start: start, end: re.lastIndex }; }
    else depth++;
  }
  return null;
}

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco P4 — Histórico: container correto + rótulo da aba ===\n');

// ── 1-4. Estrutural: relPgHistorico pertence a #pg-relatorios, não a #pg-financeiro ──
{
  var pgRelatorios = findTagBlock('pg-relatorios');
  var pgFinanceiro = findTagBlock('pg-financeiro');
  if (!pgRelatorios) throw new Error('#pg-relatorios não encontrado — teste desatualizado?');
  if (!pgFinanceiro) throw new Error('#pg-financeiro não encontrado — teste desatualizado?');

  var relPgHistIdx = html.indexOf('<div id="relPgHistorico"');
  var histBodyIdx = html.indexOf('id="histBody"');

  test('1. achado real corrigido: #relPgHistorico agora está DENTRO de #pg-relatorios (container que a página realmente exibe)',
    relPgHistIdx > pgRelatorios.start && relPgHistIdx < pgRelatorios.end, true);

  test('2. #relPgHistorico não está mais dentro do container legado #pg-financeiro (que nunca é exibido em tela)',
    relPgHistIdx > pgFinanceiro.start && relPgHistIdx < pgFinanceiro.end, false);

  test('3. #histBody (onde histRender() escreve os dados) também está dentro de #pg-relatorios',
    histBodyIdx > pgRelatorios.start && histBodyIdx < pgRelatorios.end, true);

  test('4. nenhum ID duplicado (relPgHistorico/histBody aparecem exatamente uma vez cada)',
    [(html.match(/id="relPgHistorico"/g) || []).length, (html.match(/id="histBody"/g) || []).length], [1, 1]);
}

// ── 5-6. Rótulo da aba renomeado, sem perder a informação do período coberto ──
{
  test('5. o botão da aba foi renomeado de "Histórico 2018-2026" para "Histórico" (pedido explícito do bloco)',
    /id="relTabBtnHistorico"[^>]*>📈 Histórico<\/button>/.test(html), true);
  test('6. a informação do período coberto (2018–2026) continua disponível dentro do próprio painel — não foi apagada, só removida do rótulo da aba',
    /2018–2026/.test(html), true);
}

// ── 7-8. Regressão: relFiscalRender/relPgNF (Rodada 6.1) continuam intactos ──
{
  test('7. regressão — #relPgNF (Relatório Fiscal, corrigido na Rodada 6.1) continua dentro de #pg-relatorios',
    (function () {
      var pgRelatorios = findTagBlock('pg-relatorios');
      var idx = html.indexOf('<div id="relPgNF"');
      return idx > pgRelatorios.start && idx < pgRelatorios.end;
    })(), true);
  test('8. regressão — #relPgContas (Contas Pagas) continua dentro de #pg-relatorios',
    (function () {
      var pgRelatorios = findTagBlock('pg-relatorios');
      var idx = html.indexOf('<div id="relPgContas"');
      return idx > pgRelatorios.start && idx < pgRelatorios.end;
    })(), true);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
