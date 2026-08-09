/**
 * test_sprint_pregolive_blocoG_recibo_entrada_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco G — "Gerar Recibo de Entrada" nunca pode
 * emitir um comprovante para dinheiro ainda não recebido, e o recibo
 * precisa conter os dados mínimos (logo, empresa, cliente, orçamento,
 * vendedor, data, valor total, valor recebido, forma de pagamento,
 * saldo).
 *
 * Investigação: a checagem em si (orcObterConfirmacaoEntrada — só libera
 * o recibo depois de "Confirmar Pagamento e Gerar OS" gravar
 * valorEntrada>0 em kb_os_fin) já existia (Rodada 2, P0.3), incluindo o
 * botão condicional em Orçamentos Enviados que só aparece quando
 * orcObterConfirmacaoEntrada(...).pode é true. Reimpressão é seguro: só
 * lê os.valorEntrada/os.restante já gravados, nunca recalcula nem
 * confirma pagamento de novo.
 *
 * Achado real (gap confirmado lendo o HTML do recibo): a "Forma de
 * Pagamento" (Cartão/PIX/Dinheiro) NÃO aparecia no comprovante — exigida
 * explicitamente pelo Bloco G e presente nos outros documentos do
 * orçamento (detalhe da OS). Corrigido adicionando a linha usando
 * os.formaPgto, a mesma fonte já usada em outros lugares do sistema.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoG_recibo_entrada_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco G — Recibo de Entrada: gating + conteúdo mínimo ===\n');

// ── 1-4. Regressão estrutural: gating já existente continua correto ──
{
  var srcGate = extractFn('orcObterConfirmacaoEntrada');
  test('1. o recibo continua recusado sem orc.osRef (nenhum pagamento confirmado ainda)',
    /!orc\.osRef/.test(srcGate), true);
  test('2. o recibo continua recusado sem valorEntrada>0 gravado na OS real (kb_os_fin, via KB_OS merge)',
    /os\.valorEntrada\|\|0\)\s*>\s*0/.test(srcGate), true);

  var srcBtn = extractFn('orcEnvAbrir');
  // botão condicional vive fora de orcEnvAbrir; checa a string de renderização diretamente no HTML
  var temBtnCondicional = /orcObterConfirmacaoEntrada\(o\.id\)\.pode\s*\?\s*'<button[^']*onclick="orcGerarReciboEntrada/.test(html);
  test('3. em "Orçamentos Enviados", o botão "Recibo de Entrada" só é renderizado quando orcObterConfirmacaoEntrada(...).pode é true',
    temBtnCondicional, true);

  var srcGerar = extractFn('orcGerarReciboEntrada');
  test('4. orcGerarReciboEntrada() nunca recalcula/reconfirma pagamento — só lê os.valorEntrada/os.restante já gravados (reimpressão nunca cria um novo pagamento)',
    /os\.valorEntrada\|\|0/.test(srcGerar) && !/orcEnvConfirmarPgto|_cloudSave/.test(srcGerar), true);
}

// ── 5-11. Achado real corrigido: conteúdo mínimo do recibo, incluindo a
// "Forma de Pagamento" que faltava. ──
{
  var srcGerar = extractFn('orcGerarReciboEntrada');
  test('5. logo da empresa (img com o logo de marca correto)', /logoSrcRec/.test(srcGerar), true);
  test('6. nome da empresa (VR Marcas / Vitre)', /empresa/.test(srcGerar), true);
  test('7. cliente', /class="lbl">Cliente</.test(srcGerar), true);
  test('8. orçamento (número)', /class="lbl">Orçamento</.test(srcGerar), true);
  test('9. vendedor', /class="lbl">Vendedor</.test(srcGerar), true);
  test('10. data de emissão', /\bhoje\b/.test(srcGerar), true);
  test('11. valor total do orçamento', /class="lbl">Valor total do orçamento</.test(srcGerar), true);
  test('12. valor recebido (entrada)', /Valor Recebido como Entrada/.test(srcGerar), true);
  test('13. achado real corrigido: "Forma de Pagamento" agora aparece no recibo (antes, ausente)',
    /class="lbl">Forma de Pagamento<\/span><span class="val">'\+\(os\.formaPgto\|\|'—'\)/.test(srcGerar), true);
  test('14. saldo restante (quando houver)', /Saldo Restante a Pagar na Retirada/.test(srcGerar), true);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
