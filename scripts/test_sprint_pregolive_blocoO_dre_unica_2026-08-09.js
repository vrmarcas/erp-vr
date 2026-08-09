/**
 * test_sprint_pregolive_blocoO_dre_unica_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco O — manter acesso oficial à DRE SOMENTE via
 * Relatórios → DRE. Antes desta rodada, dois atalhos paralelos ainda
 * existiam na UI (sidebar "DRE" dentro de Financeiro, e o botão "DRE ↗"
 * na barra de abas do Dashboard Financeiro) — ambos já redirecionavam
 * para Relatórios→DRE em vez de renderizar uma segunda DRE (dedup de
 * LÓGICA feita na Rodada Mestre, seção 33), mas o Bloco O pede acesso
 * único, sem atalhos paralelos.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoO_dre_unica_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco O — DRE: acesso único via Relatórios ===\n');

test('1. o item de sidebar "sbFinDRE" (atalho DRE dentro de Financeiro) foi removido',
  html.indexOf('id="sbFinDRE"') >= 0, false);
test('2. o botão "finTabBtnDRE" (atalho "DRE ↗" no Dashboard Financeiro) foi removido',
  html.indexOf('id="finTabBtnDRE"') >= 0, false);
test('3. o único botão de aba com id="relTabBtnDRE" (dentro de Relatórios) continua existindo — acesso oficial preservado',
  (html.match(/id="relTabBtnDRE"/g) || []).length, 1);
test('4. regressão — os demais itens da sidebar Financeiro continuam presentes (CR/CP/Relatórios)',
  html.indexOf('id="sbFinCR"') >= 0 && html.indexOf('id="sbFinCP"') >= 0 && html.indexOf('id="sbFinRel"') >= 0, true);
test('5. regressão — as demais abas do Dashboard Financeiro continuam presentes (Dashboard/CR/CP/Agenda/Cartões)',
  html.indexOf('id="finTabBtnDash"') >= 0 && html.indexOf('id="finTabBtnCR"') >= 0
  && html.indexOf('id="finTabBtnCP"') >= 0 && html.indexOf('id="finTabBtnCal"') >= 0
  && html.indexOf('id="finTabBtnCartoes"') >= 0, true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
