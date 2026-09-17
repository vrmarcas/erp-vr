/**
 * test_rodada_funcional_bloco1b_editor_visual_orcamento_2026-09-17.js
 *
 * RODADA FUNCIONAL 2026-09-17, Bloco 1 (revisão pós-feedback) — a lista
 * genérica plana de templates (mesmo com os placeholders granulares dos
 * Blocos 1+2) não atendia o pedido real: o usuário quer uma tela
 * organizada em 10 blocos numerados e claros, cada um com campo editável,
 * placeholders, preview próprio e restaurar padrão, mais um PREVIEW FINAL
 * montando tudo junto — sem precisar entender onde cada placeholder está
 * "escondido" numa lista longa com CRM/fornecedor/OS pronta misturados.
 *
 * Este teste valida a existência e o comportamento do NOVO painel
 * dedicado "Estrutura da Mensagem de Orçamento" (cfgMsgAutoOrcamentoRender
 * e funções auxiliares) — smoke visual real já foi feito à parte via
 * browser (ver relatório da rodada), este teste cobre a lógica pura.
 *
 * Uso: node scripts/test_rodada_funcional_bloco1b_editor_visual_orcamento_2026-09-17.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('\n=== RODADA FUNCIONAL 2026-09-17 — Bloco 1 (revisão): editor visual dedicado ===\n');

test('1 — painel dedicado existe no HTML (container cfgMsgAutoOrcamento antes da lista genérica)', function () {
  var idxOrcamento = html.indexOf('id="cfgMsgAutoOrcamento"');
  var idxLista = html.indexOf('id="cfgMsgAutoLista"');
  assertTrue(idxOrcamento >= 0, 'container do painel dedicado não existe no HTML');
  assertTrue(idxOrcamento < idxLista, 'painel dedicado deveria vir ANTES da lista genérica na tela');
});

test('2 — as 6 chaves do fluxo de orçamento são excluídas da lista genérica (evita 2 editores pro mesmo campo)', function () {
  assertTrue(/CFG_MSG_AUTO_CHAVES_ORCAMENTO\s*=\s*\['orcamentoEnviado', 'orcamentoItemLinha', 'orcamentoOpcaoItem', 'orcamentoComparativo', 'orcamentoSeparadorOpcoes', 'orcamentoPecaAdicionalLinha'\]/.test(html));
  assertTrue(/CFG_MSG_AUTO_CHAVES_ORCAMENTO\.indexOf\(k\) < 0/.test(html), 'lista genérica não filtra as chaves dedicadas — risco de 2 textareas com o MESMO id');
});

test('3 — função cfgMsgAutoOrcamentoRender existe e é chamada por cfgMsgAutoRender (ponto de entrada da aba)', function () {
  assertTrue(/function cfgMsgAutoOrcamentoRender\(\)/.test(html));
  var corpoRender = html.slice(html.indexOf('function cfgMsgAutoRender()'), html.indexOf('function cfgMsgAutoRender()') + 800);
  assertTrue(corpoRender.indexOf('cfgMsgAutoOrcamentoRender();') >= 0, 'painel dedicado não é chamado ao abrir a aba de Mensagens Automáticas');
});

test('4 — os 10 blocos + extra de peça adicional estão todos presentes na função de render (numerados 1 a 10)', function () {
  var corpo = html.slice(html.indexOf('function cfgMsgAutoOrcamentoRender()'), html.indexOf('function cfgMsgAutoOrcamentoRender()') + 3000);
  [
    "_cfgMsgAutoBlocoCardHtml(1, 'Mensagem principal do orçamento', 'orcamentoEnviado'",
    "_cfgMsgAutoBlocoCardHtml(2, 'Estrutura de cada item', 'orcamentoItemLinha'",
    "_cfgMsgAutoBlocoCardHtml(3, 'Estrutura de cada opção comparativa', 'orcamentoOpcaoItem'",
    "_cfgMsgAutoBlocoCardHtml(4, 'Separador entre opções', 'orcamentoSeparadorOpcoes'",
    "_cfgMsgAutoBlocoPagamentoHtml(5, 'pix', 'Pix'",
    "_cfgMsgAutoBlocoPagamentoHtml(6, 'cartao', 'Cartão de crédito'",
    "_cfgMsgAutoBlocoPagamentoHtml(7, 'oferta_especial', 'Oferta especial'",
    "_cfgMsgAutoBlocoInfoHtml(8, 'Prazo'",
    "_cfgMsgAutoBlocoInfoHtml(9, 'Validade'",
    "_cfgMsgAutoBlocoInfoHtml(10, 'Assinatura'",
  ].forEach(function (trecho) {
    assertTrue(corpo.indexOf(trecho) >= 0, 'bloco ausente ou fora de ordem: ' + trecho);
  });
});

test('5 — Preview Final existe como elemento próprio, distinto dos previews por bloco', function () {
  assertTrue(/id="cfgMsgAutoPreviewFinal"/.test(html));
  assertTrue(/function cfgMsgAutoOrcamentoPreviewFinal\(\)/.test(html));
});

test('6 — cada textarea de bloco dispara cfgMsgAutoOrcamentoPreviewFinal no oninput (preview final é AO VIVO, não só por bloco)', function () {
  var corpoCard = html.slice(html.indexOf('function _cfgMsgAutoBlocoCardHtml'), html.indexOf('function _cfgMsgAutoBlocoCardHtml') + 2500);
  assertTrue(corpoCard.indexOf("oninput=\"cfgMsgAutoPreview(") >= 0 && corpoCard.indexOf('cfgMsgAutoOrcamentoPreviewFinal()') >= 0, 'edição de bloco não atualiza o preview final ao vivo');
});

test('7 — controle de reordenação existe para os 3 blocos de pagamento (Mover para cima/baixo)', function () {
  var corpoPag = html.slice(html.indexOf('function _cfgMsgAutoBlocoPagamentoHtml'), html.indexOf('function _cfgMsgAutoBlocoPagamentoHtml') + 4200);
  assertTrue(corpoPag.indexOf('Mover para cima') >= 0 && corpoPag.indexOf('Mover para baixo') >= 0);
  assertTrue(corpoPag.indexOf('cfgMsgAutoOrdemMover') >= 0);
});

test('8 — cfgMsgAutoOrdemMover re-renderiza IMEDIATAMENTE após cfgSave (não espera a Promise) — achado do smoke visual desta rodada (flash de posição desatualizada)', function () {
  var corpo = html.slice(html.indexOf('function cfgMsgAutoOrdemMover'), html.indexOf('function cfgMsgAutoOrdemMover') + 2200);
  var idxSave = corpo.indexOf('cfgSave(cfg)');
  var idxRenderSincrono = corpo.indexOf('cfgMsgAutoOrcamentoRender();');
  var idxThen = corpo.indexOf('.then(function(r)');
  assertTrue(idxSave >= 0 && idxRenderSincrono >= 0 && idxThen >= 0, 'estrutura esperada não encontrada');
  assertTrue(idxRenderSincrono < idxThen, 'REGRESSÃO: re-render deve acontecer ANTES do .then() (síncrono), não dentro dele — senão volta o flash de posição errada visto no smoke');
});

test('9 — blocos de Pix/Cartão/Oferta são claramente marcados como NÃO editáveis em texto livre (evita confundir com um template de texto)', function () {
  var corpoPag = html.slice(html.indexOf('function _cfgMsgAutoBlocoPagamentoHtml'), html.indexOf('function _cfgMsgAutoBlocoPagamentoHtml') + 2000);
  assertTrue(corpoPag.indexOf('NÃO é texto livre') >= 0, 'falta deixar explícito que o conteúdo é calculado, não editável ali');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
