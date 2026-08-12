/**
 * test_kb_privacidade_sem_valor_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 43-48 — bug real reproduzido em
 * produção (OS #8): o modal operacional do Kanban mostrava
 * "Restante: R$83,07" e um botão "Confirmar Recebimento do Saldo" que
 * disparava a transação financeira direto ali — violando a separação
 * financeiro×operacional (a visão Kanban NUNCA pode conter valor, nem
 * para Master — é uma visão operacional, não financeira).
 *
 * HOTFIX OPERACIONAL 2026-08-12, P0.6 — o achado do usuário foi mais
 * profundo do que a sanitização de valores: mesmo sem R$, as PALAVRAS
 * "Pagamento"/"Registrar Pagamento"/"Saldo pendente" ainda apareciam na
 * visão Kanban, que deve ser 100% operacional para QUALQUER perfil. A
 * caixa "Receber Saldo" foi REMOVIDA por completo do HTML do Kanban —
 * registrar pagamento continua funcionando normalmente, só que
 * exclusivamente em "Todas as OS" (ver
 * test_hotfix_p0_6_kanban_sem_financeiro_2026-08-12.js para a cobertura
 * completa desta remoção). Este arquivo mantém as checagens de "nenhum
 * R$ solto no código do Kanban" que continuam válidas e úteis.
 *
 * Uso: node scripts/test_kb_privacidade_sem_valor_2026-08-12.js
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

console.log('\n=== Kanban de OS — zero valor financeiro na visão operacional ===\n');

// ── 1. Caixa "Receber Saldo" foi removida por completo do Kanban (P0.6) ──
(function () {
  test('1a. id="kbReceberSaldoBox" não existe mais no HTML (removido, não apenas sanitizado)', /id="kbReceberSaldoBox"/.test(html), false);
  test('1b. id="kbReceberSaldoBtn" não existe mais no HTML', /id="kbReceberSaldoBtn"/.test(html), false);
  test('1c. registrar pagamento continua disponível, só que em "Todas as OS" (osAbrirPagamentoSaldoModal ainda existe no arquivo)', /osAbrirPagamentoSaldoModal/.test(html), true);
})();

// ── 2. Status "aguardando_saldo" no Kanban não expõe mais vocabulário financeiro ──
(function () {
  var marker = 'const _kbStatusMap';
  var start = html.indexOf(marker);
  var chunk = html.slice(start, start + 1600);
  test('2a. _kbStatusMap.aguardando_saldo não contém mais "Saldo" nem 💰', !/aguardando_saldo:\s*\{[^}]*(Saldo|💰)/.test(chunk), true);
  test('2b. id="kbSaldoValor" não existe mais no HTML (elemento removido junto com a caixa)', /id="kbSaldoValor"/.test(html), false);
})();

// ── 3. Nenhum "R$" solto na faixa de código do modal/render do Kanban (kbOpen + render) ──
(function () {
  var kbOpenStart = html.indexOf('function kbOpen(');
  var kbOpenChunk = html.slice(kbOpenStart, kbOpenStart + 12000); // cobre kbOpen + o render logo em seguida
  var rMoneyMatches = kbOpenChunk.match(/R\$\s*['"+]/g) || [];
  test('3. nenhuma ocorrência de template de valor monetário ("R$" seguido de aspas/concat) na função kbOpen e vizinhança', rMoneyMatches.length, 0);
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
