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
 * Corrigido: a caixa "Receber Saldo" do Kanban mostra apenas um status
 * sanitizado ("Saldo pendente na entrada", sem R$) e o botão abre o modal
 * financeiro dedicado (osAbrirPagamentoSaldoModal, o mesmo já usado em
 * "Todas as OS"), que continua cobrindo o caminho legado
 * aguardando_saldo→iniciada — nenhuma capacidade perdida.
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

// ── 1. HTML estático da caixa "Receber Saldo" nunca contém template de R$ ──
(function () {
  var boxStart = html.indexOf('id="kbReceberSaldoBox"');
  var boxEnd = html.indexOf('</div>', html.indexOf('kbReceberSaldoBtn'));
  var boxHtml = html.slice(boxStart, boxEnd);
  test('1a. a caixa de saldo do Kanban não contém "R$" no HTML estático', /R\$/.test(boxHtml), false);
  test('1b. o botão nunca chama kbReceberSaldo() diretamente (fluxo antigo que expunha o valor inline)', /onclick="kbReceberSaldo\(\)"/.test(boxHtml), false);
  test('1c. o botão abre o modal financeiro dedicado (osAbrirPagamentoSaldoModal) — mesma fonte usada em "Todas as OS"', /osAbrirPagamentoSaldoModal\(_kbOsId\)/.test(boxHtml), true);
})();

// ── 2. Render dinâmico (kbRender) nunca escreve valor no elemento kbSaldoValor ──
(function () {
  var marker = "if (os.status === 'aguardando_saldo') {";
  var start = html.indexOf(marker);
  var chunk = html.slice(start, start + 400);
  test('2a. o trecho que popula kbSaldoValor nunca formata os.restante como moeda', /toLocaleString\(.pt-BR.,\{minimumFractionDigits/.test(chunk) && /kbSaldoValor/.test(chunk), false);
  test('2b. kbSaldoValor recebe um texto fixo sanitizado, não um valor calculado', /kbSaldoValor'\);\s*\n\s*if \(_svEl\) _svEl\.textContent = 'Saldo pendente na entrada';/.test(chunk), true);
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
