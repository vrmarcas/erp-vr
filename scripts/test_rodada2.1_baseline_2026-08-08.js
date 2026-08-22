/**
 * test_rodada2.1_baseline_2026-08-08.js
 * Testes de regressão para a "RODADA 2.1 — FECHAMENTO DE REGRESSÃO +
 * VALIDAÇÃO REAL PÓS-DEPLOY" (2026-08-08).
 *
 * Uso: node scripts/test_rodada2.1_baseline_2026-08-08.js
 */

'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}

console.log('\n' + '='.repeat(70));
console.log(' test_rodada2.1_baseline_2026-08-08.js');
console.log('='.repeat(70) + '\n');

// ────────────────────────────────────────────────────────────────────────
// Guarda estática — achado real da Rodada 2.1: 6 chamadores de kb_os
// (kbDrop, kbSalvarTempo, kbSalvarPrazo, kbPausarProd, kbNormalizarDatas,
// kbToggleEtapa) gravavam o KB_OS BRUTO direto em 'kb_os' via _cloudSave(),
// ignorando o split kb_os/kb_os_fin do P0.6 — para sessões com campos
// financeiros mesclados em memória (Master/Financeiro/Comercial), isso
// reintroduzia valor/entrada/restante/etc no documento operacional que a
// Produção lê. Corrigido trocando todos por kbSaveKbos() (nunca escreve
// financeiro em 'kb_os'). Esta guarda nunca deixa esse padrão voltar.
// ────────────────────────────────────────────────────────────────────────
console.log('── Guarda: nenhum caller grava KB_OS bruto em kb_os (P0.6) ────\n');
{
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var padraoBruto = /_cloudSave\(\s*['"]kb_os['"]\s*,\s*KB_OS\s*\)/g;
  var achados = html.match(padraoBruto) || [];
  test('1. nenhum _cloudSave(\'kb_os\', KB_OS) bruto restante no arquivo', achados.length, 0);

  // kbSaveKbos() continua sendo o único ponto que escreve em 'kb_os_fin'
  // a partir do fluxo do Kanban (fora das transações atômicas de
  // orcEnvGerarOS()/kbReceberSaldo(), que gravam os dois documentos
  // dentro da mesma transação por outro caminho).
  var temKbSaveKbos = /function kbSaveKbos\(/.test(html);
  test('2. kbSaveKbos() ainda existe como funil central', temKbSaveKbos, true);

  // As 6 funções afetadas agora chamam kbSaveKbos() (não _cloudSave direto).
  ['kbDrop', 'kbSalvarTempo', 'kbSalvarPrazo', 'kbPausarProd', 'kbNormalizarDatas', 'kbToggleEtapa'].forEach(function (fnName, i) {
    var marker = 'function ' + fnName + '(';
    var start = html.indexOf(marker);
    if (start < 0) { test((3 + i) + '. ' + fnName + ' encontrada', false, true); return; }
    var braceOpen = html.indexOf('{', start);
    var depth = 0, end = braceOpen;
    for (; end < html.length; end++) {
      if (html[end] === '{') depth++;
      else if (html[end] === '}') { depth--; if (depth === 0) break; }
    }
    var body = html.slice(start, end + 1);
    test((3 + i) + '. ' + fnName + '() chama kbSaveKbos(), nunca _cloudSave(\'kb_os\',...) bruto', /kbSaveKbos\s*\(\s*\)/.test(body) && !/_cloudSave\(\s*['"]kb_os['"]\s*,\s*KB_OS\s*\)/.test(body), true);
  });
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');

if (failed > 0) process.exitCode = 1;
