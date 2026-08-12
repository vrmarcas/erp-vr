/**
 * test_sprint_pregolive_gate_pagamento_semjuros_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE — gate de preview local pré-deploy (achado real,
 * reproduzido no ERP local via Emulator, não só em teste isolado):
 *
 * Na tela "Confirmação de Pagamento" (opg5), ao selecionar Cartão 3x sobre
 * um orçamento de R$192,58, o "Valor a Receber" mostrava R$200,25 e a
 * linha de parcelamento mostrava "3× de R$66,75 (total: R$200,25)" — a
 * taxa REAL da operadora (3,99% em 3x) estava sendo somada, embora
 * "Envio ao Cliente" (Bloco E, orcMotorComercial) já mostrasse
 * corretamente "3x de R$64,19 sem juros" (total R$192,58) para o MESMO
 * orçamento. As duas telas divergiam em R$7,67 — exatamente o tipo de
 * "diferença de R$0,01" (ou mais) que o Sprint proíbe passar sem correção.
 *
 * Causa raiz: orcCalcParcelaDisplay() e orcPgtoAtualizarValorReceber()
 * (ambas em opg5) ainda chamavam o motor legado orcMotorPagamento (taxa
 * real embutida) em vez do motor central orcMotorComercial (sempre sem
 * juros em até 3x) — o Bloco E+I anterior migrou outros consumidores
 * (PDF/WhatsApp/resumo do wizard) mas não estes dois.
 *
 * Corrigido: as duas funções agora usam orcMotorComercial. O <select
 * id="orcSimParcelas"> também foi capado a 1-3x (era 1/2/3/4/5/6/10/12),
 * alinhado com a regra "até 3x sempre sem juros" e com o <select
 * id="orcParcSel"> de "Envio ao Cliente".
 *
 * Uso: node scripts/test_sprint_pregolive_gate_pagamento_semjuros_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE — gate de preview local: Cartão 3x na Confirmação de Pagamento SEM juros ===\n');

// ── 1. Regressão estrutural: nenhuma das duas funções chama mais o motor legado ──
var srcCalcParc = extractFn('orcCalcParcelaDisplay');
var srcValorReceber = extractFn('orcPgtoAtualizarValorReceber');
test('1. orcCalcParcelaDisplay() não CHAMA mais orcMotorPagamento(...) (só pode citar o nome em comentário explicativo)',
  /orcMotorPagamento\(/.test(srcCalcParc), false);
test('2. orcCalcParcelaDisplay() usa orcMotorComercial (sem juros)',
  /orcMotorComercial\(/.test(srcCalcParc), true);
test('3. orcPgtoAtualizarValorReceber() não CHAMA mais orcMotorPagamento(...)',
  /orcMotorPagamento\(/.test(srcValorReceber), false);
test('4. orcPgtoAtualizarValorReceber() usa orcMotorComercial',
  /orcMotorComercial\(/.test(srcValorReceber), true);

test('5. HTML: <select id="orcSimParcelas"> capado a 1-3x (nunca mais oferece 4x-12x, que sugeriam juros)',
  /id="orcSimParcelas"[\s\S]{0,300}value="12"/.test(html), false);
test('6. HTML: opção 3x de orcSimParcelas vem marcada "selected" (mesmo padrão sem-juros do orcParcSel)',
  /id="orcSimParcelas"[\s\S]{0,300}value="3" selected/.test(html), true);

// ── 7+. Execução real: DOM fake completo, reproduzindo o achado real ──
var FN_NAMES = ['orcFmt', 'orcDistribuirParcelas', 'orcMotorComercial', 'orcMotorPagamento', 'orcLerCondicoesPagamentoDOM', 'orcCalcParcelaDisplay', 'orcPgtoAtualizarValorReceber'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = { orcCalcParcelaDisplay: orcCalcParcelaDisplay, orcPgtoAtualizarValorReceber: orcPgtoAtualizarValorReceber };"
].join('\n\n');
var modPath = path.join(__dirname, '_gate_pagamento_semjuros_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

function makeEl(props) { return Object.assign({ value: '', textContent: '', style: {} }, props || {}); }

function montarAmbiente(finalPrice, metodo, nParc) {
  var _els = {
    orcSimMetodo: makeEl({ value: metodo || 'cartao' }),
    orcSimParcelas: makeEl({ value: String(nParc || 3) }),
    orcSimParcelaDisplay: makeEl({ style: {} }),
    orcPgtoValorDisplay: makeEl(),
    orcSimValor: makeEl(),
    orcDescCondToggle: makeEl(), orcDescCond: makeEl(), orcDescCondData: makeEl(),
    orcPixDiscPct: makeEl({ value: '0.99' }),
    orcParcSel: makeEl({ value: '3' }),
  };
  global.document = { getElementById: function (id) { return _els[id]; } };
  global.window = { _orcCalc: { finalPrice: finalPrice } };
  global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 3.99 }] };
  global.cfgLoad = function () { return {}; };
  var mod = require(modPath);
  return { els: _els, mod: mod };
}

{
  // Achado real exato reproduzido no preview local: orçamento de R$192,58.
  // GO-LIVE FINAL 2026-08-12, seção 4 — mudança de regra deliberada,
  // confirmada em produção: a taxa real da maquininha volta a ser
  // embutida no preço do cartão (o Bloco E fazia a VR absorvê-la
  // silenciosamente). Para R$192,58 em 3x (taxa 3,99%):
  // 19258/(1-0,0399) = 20058 centavos = R$200,58.
  var amb = montarAmbiente(192.58, 'cartao', 3);
  amb.mod.orcCalcParcelaDisplay();
  test('7. GO-LIVE FINAL — Cartão 3x sobre R$192,58 embute a taxa real (3,99%): "3× de R$66,86 (total: R$200,58)"',
    amb.els.orcSimParcelaDisplay.textContent, '3× de R$ 66,86 (total: R$ 200,58)');
  test('8. "Valor a Receber" bate exatamente com o total da linha de parcelamento (R$200,58, com a taxa embutida)',
    amb.els.orcPgtoValorDisplay.textContent, 'R$ 200,58');
}

{
  // 2x também embute a taxa real (2,99%): 19258/(1-0,0299) = 19852 centavos.
  var amb2 = montarAmbiente(192.58, 'cartao', 2);
  amb2.mod.orcCalcParcelaDisplay();
  test('9. GO-LIVE FINAL — Cartão 2x sobre R$192,58 embute a taxa real (2,99%): total R$198,52',
    amb2.els.orcPgtoValorDisplay.textContent, 'R$ 198,52');
}

{
  // 1x (à vista) sempre foi sem juros — regressão de guarda.
  var amb3 = montarAmbiente(100, 'cartao', 1);
  amb3.mod.orcPgtoAtualizarValorReceber();
  test('10. Cartão 1x nunca muda (sempre igual à base, regressão de guarda)',
    amb3.els.orcPgtoValorDisplay.textContent, 'R$ 100,00');
}

{
  // PIX continua aplicando desconto normalmente — só o cartão parou de somar taxa.
  var amb4 = montarAmbiente(100, 'pix', 1);
  amb4.mod.orcPgtoAtualizarValorReceber();
  test('11. PIX continua aplicando o desconto configurado (0,99%) — R$99,01, nunca R$100,00 nem afetado pela correção do cartão',
    amb4.els.orcPgtoValorDisplay.textContent, 'R$ 99,01');
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
