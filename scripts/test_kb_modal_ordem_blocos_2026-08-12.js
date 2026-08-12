/**
 * test_kb_modal_ordem_blocos_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 21-29 — bug real reproduzido em produção
 * (OS #8, print real do modal): o Checklist de Produção era o PRIMEIRO
 * bloco da aba "Produção", antes de qualquer sugestão de prazo, do
 * material selecionado, ou do próprio botão "Iniciar Produção" — o
 * funcionário via o checklist antes de a produção sequer ter começado.
 *
 * Corrigido: reordenado o HTML estático do modal (kbTabProd) para a
 * sequência operacional pedida — Prazo → Material → Iniciar Produção →
 * Checklist → Arquivos da Produção → ações finais (Receber Saldo/Avisar
 * Cliente). Nenhum bloco foi alterado por dentro (mesmos ids, mesmos
 * handlers onclick) — só a ORDEM dos blocos-irmãos mudou.
 *
 * Uso: node scripts/test_kb_modal_ordem_blocos_2026-08-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) {
  if (cond) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc); failed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('\n=== Modal da OS — ordem dos blocos operacionais (Prazo → Material → Iniciar → Checklist → Arquivos) ===\n');

var tabStart = html.indexOf('<div id="kbTabProd">');
var tabEnd = html.indexOf('<!-- RODAPÉ FIXO', tabStart);
if (tabStart < 0 || tabEnd < 0) throw new Error('Estrutura do modal (kbTabProd / RODAPÉ FIXO) não encontrada — teste desatualizado?');
var chunk = html.slice(tabStart, tabEnd);

function posOf(marker, label) {
  var i = chunk.indexOf(marker);
  ok('marcador presente: ' + label, i >= 0);
  return i;
}

var posPrazo      = posOf('id="kbPrazoSugBox"', 'Sugestão de Prazo (kbPrazoSugBox)');
var posProdPrazo  = posOf('Produção &amp; Prazo', 'Produção & Prazo (tempo/data)');
var posMaterial   = posOf('id="kbMatProdBox"', 'Material em Produção (kbMatProdBox)');
var posIniciar    = posOf('id="kbIniciarProdBox"', 'Botão Iniciar Produção (kbIniciarProdBox)');
var posChecklist  = posOf('Checklist de Produção', 'Checklist de Produção');
var posArquivos   = posOf('id="kbPlanImgBox"', 'Arquivos da Produção (kbPlanImgBox)');
var posLink       = posOf('🔗 Link do Arquivo', 'Link do Arquivo');
var posReceber    = posOf('id="kbReceberSaldoBox"', 'Receber Saldo / Pagamento (kbReceberSaldoBox)');
var posAvisar     = posOf('id="kbAvisarClienteBox"', 'Avisar Cliente (kbAvisarClienteBox)');

ok('1. Prazo Sugerido vem antes de Produção & Prazo', posPrazo < posProdPrazo);
ok('2. Produção & Prazo vem antes de Material em Produção', posProdPrazo < posMaterial);
ok('3. Material em Produção vem antes de Iniciar Produção', posMaterial < posIniciar);
ok('4. Iniciar Produção vem antes do Checklist — BUG REAL corrigido (antes o checklist era o primeiro bloco de todos)', posIniciar < posChecklist);
ok('5. Checklist vem antes de Arquivos da Produção', posChecklist < posArquivos);
ok('6. Arquivos da Produção vem antes do Link do Arquivo (mesmo grupo "Arquivos")', posArquivos < posLink);
ok('7. Link do Arquivo vem antes de Receber Saldo (ações finais)', posLink < posReceber);
ok('8. Receber Saldo vem antes de Avisar Cliente (última ação final)', posReceber < posAvisar);

// ── Regressão estrutural: nenhum handler/id foi alterado pela reordenação ──
var HANDLERS_ESPERADOS = ['kbIniciarProd()', 'kbEditarMatProd()', 'kbCheckAddItem()', 'kbSalvarTempo()', 'kbSalvarPrazo()', 'kbSaveLink()', 'kbOpenLink()', 'osAbrirPagamentoSaldoModal(_kbOsId)', 'kbEnviarMsgCliente()'];
HANDLERS_ESPERADOS.forEach(function (h) {
  ok('handler preservado: ' + h, chunk.indexOf(h) >= 0);
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
