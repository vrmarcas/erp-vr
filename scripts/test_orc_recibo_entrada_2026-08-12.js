/**
 * test_orc_recibo_entrada_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 14-16 — auditoria do Recibo de
 * Entrada/Sinal (orcGerarReciboEntrada). A maior parte do redesign A4 já
 * existia de rodada anterior (2026-08-07, Rodada 2 P0.3): logo oficial
 * real (assets/brand/*.png), cabeçalho com hierarquia, corpo com
 * Cliente/Produto/Vendedor/Orçamento/OS/Forma de pagamento/Valor total/
 * Entrada, destaque primário "Valor Recebido como Entrada", destaque
 * secundário "Saldo Restante", rodapé com assinatura empresa+cliente —
 * confirmado por leitura, sem regressão.
 *
 * Bug real encontrado e corrigido nesta rodada: o número do recibo
 * ("Nº REC-xxxxxx") era gerado a partir de Date.now(), então reimprimir
 * o MESMO recibo (mesmo orçamento, nenhuma transação nova) mostrava um
 * número DIFERENTE a cada impressão — inconsistente para um documento
 * financeiro. Corrigido para derivar do número oficial e estável do
 * orçamento (orc.num), com a OS como fallback.
 *
 * Uso: node scripts/test_orc_recibo_entrada_2026-08-12.js
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
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

console.log('\n=== Recibo de Entrada/Sinal — número estável, dado canônico, zero efeito colateral ===\n');

var fnRecibo = extractFn('orcGerarReciboEntrada');
var fnGate = extractFn('orcObterConfirmacaoEntrada');

// ── 1. Número do recibo é determinístico (nunca Date.now()/Math.random()) ──
ok('1a. numRec NÃO usa mais Date.now() (bug real: reimpressão mudava o número)', !/numRec\s*=\s*['"]REC-['"]\s*\+\s*Date\.now/.test(fnRecibo));
ok('1b. numRec deriva do número oficial e estável do orçamento (orc.num)', /numRec\s*=\s*['"]REC-['"]\s*\+\s*String\(orc\.num/.test(fnRecibo));

// ── 2. Logo oficial real (nunca texto inventado no lugar do logo) ──
ok('2a. Usa o logo real da VR Marcas (assets/brand/vr-marcas-logo.png)', /vr-marcas-logo\.png/.test(fnRecibo));
ok('2b. Usa o logo real da Vitre (assets/brand/vitre-logo.png)', /vitre-logo\.png/.test(fnRecibo));
(function () {
  ok('2c. Os dois arquivos de logo realmente existem no projeto (não é um caminho quebrado)',
    fs.existsSync(path.join(__dirname, '..', 'assets', 'brand', 'vr-marcas-logo.png')) &&
    fs.existsSync(path.join(__dirname, '..', 'assets', 'brand', 'vitre-logo.png')));
})();

// ── 3. Hierarquia A4 profissional (título, destaque primário/secundário, rodapé) ──
ok('3a. Cabeçalho com número e data do recibo', /Nº ['"]\+numRec/.test(fnRecibo) || /Nº '\+numRec/.test(fnRecibo));
ok('3b. Corpo mostra Cliente/Produto/Vendedor/Orçamento/Forma de Pagamento/Valor total', /Cliente<\/span>/.test(fnRecibo) && /Produto \/ Serviço/.test(fnRecibo) && /Vendedor<\/span>/.test(fnRecibo) && /Orçamento<\/span>/.test(fnRecibo) && /Forma de Pagamento/.test(fnRecibo) && /Valor total do orçamento/.test(fnRecibo));
ok('3c. Destaque primário "Valor Recebido como Entrada" (ok-box)', /Valor Recebido como Entrada/.test(fnRecibo) && /ok-box/.test(fnRecibo));
ok('3d. Destaque secundário "Saldo Restante" só aparece quando há saldo pendente (warn-box condicional)', /resto>0\?'<div class="warn-box">/.test(fnRecibo) && /Saldo Restante a Pagar/.test(fnRecibo));
ok('3e. Rodapé com assinatura da empresa E do cliente', /Assinatura \/ Carimbo/.test(fnRecibo) && /Assinatura do Cliente/.test(fnRecibo));

// ── 4. Dado canônico — nunca substitui dado real por "(não informado)" ──
ok('4a. Cliente vem direto de orc.cliente (nunca um placeholder fixo sobrescrevendo dado real)', /cliente\s*=\s*orc\.cliente\|\|'Cliente'/.test(fnRecibo));
ok('4b. Vendedor vem direto de orc.vendedor (fallback só quando genuinely vazio)', /vend\s*=\s*orc\.vendedor\|\|/.test(fnRecibo));
ok('4c. Valores (total/entrada/resto) vêm de os.* / orc.valorFinal — nunca hardcoded/zerados por engano', /total\s*=\s*os\.totalGeral\|\|os\.valor\|\|orc\.valorFinal/.test(fnRecibo));

// ── 5. Reimpressão sem efeito colateral — a função NUNCA grava no Firestore ──
(function () {
  var writeCalls = (fnRecibo.match(/_cloudSave\s*\(/g) || []).length
    + (fnRecibo.match(/httpsCallable\s*\(/g) || []).length
    + (fnRecibo.match(/\.set\s*\(/g) || []).length
    + (fnRecibo.match(/\.add\s*\(/g) || []).length;
  ok('5a. orcGerarReciboEntrada nunca chama gravação (_cloudSave/httpsCallable/.set/.add) — reimprimir nunca cria OS/transação nova', writeCalls === 0);
})();
ok('5b. O gate (orcObterConfirmacaoEntrada) só LÊ dados já persistidos (orcGetEnviados/KB_OS) — nunca gera/confirma pagamento por conta própria', /orcGetEnviados\(\)/.test(fnGate) && !/_cloudSave|httpsCallable|\.set\(|\.add\(/.test(fnGate));
ok('5c. O gate exige uma OS real já gerada por pagamento confirmado (orc.osRef) antes de liberar o recibo — nunca a partir de um campo de texto livre', /orc\.osRef/.test(fnGate));

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
