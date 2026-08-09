/**
 * test_sprint_pregolive_blocoD_ajuste_item_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco D — modelo de domínio do ajuste comercial por
 * item (R$/% acréscimo/desconto), isolado da UI. Toda matemática em
 * centavos (nunca ponto flutuante direto).
 *
 * Funções sob teste (extraídas de index.html): orcItemAplicarAjuste,
 * orcItemCalcularTotal.
 *
 * Cenários exigidos explicitamente pelo usuário: preço R$100,00 com
 * +R$10 → R$110,00; +10% → R$110,00; -R$10 → R$90,00; -10% → R$90,00.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoD_ajuste_item_2026-08-09.js
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
var src = [
  extractFn('orcItemAplicarAjuste'),
  extractFn('orcItemCalcularTotal'),
  "module.exports = { orcItemAplicarAjuste: orcItemAplicarAjuste, orcItemCalcularTotal: orcItemCalcularTotal };"
].join('\n\n');
var modPath = path.join(__dirname, '_blocoD_ajuste_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco D — ajuste de preço por item (modelo de domínio) ===\n');

// ── 1-4. Cenários exatos pedidos: R$100,00 base ──
test('1. R$100,00 + R$10,00 (acréscimo fixo) = R$110,00',
  mod.orcItemAplicarAjuste(10000, 'acrescimo', 'fixo', 10).precoFinalItemCents, 11000);
test('2. R$100,00 + 10% (acréscimo percentual) = R$110,00',
  mod.orcItemAplicarAjuste(10000, 'acrescimo', 'percentual', 10).precoFinalItemCents, 11000);
test('3. R$100,00 - R$10,00 (desconto fixo) = R$90,00',
  mod.orcItemAplicarAjuste(10000, 'desconto', 'fixo', 10).precoFinalItemCents, 9000);
test('4. R$100,00 - 10% (desconto percentual) = R$90,00',
  mod.orcItemAplicarAjuste(10000, 'desconto', 'percentual', 10).precoFinalItemCents, 9000);

// ── 5-7. Sem ajuste (operação nula/inválida) — preço original intacto ──
test('5. operação null: preço final = preço original, ajuste = 0', mod.orcItemAplicarAjuste(10000, null, 'fixo', 10), { ajusteCents: 0, precoFinalItemCents: 10000 });
test('6. operação undefined: mesmo comportamento (nunca lança erro)', mod.orcItemAplicarAjuste(10000, undefined, 'percentual', 5), { ajusteCents: 0, precoFinalItemCents: 10000 });
test('7. operação com string inválida: tratada como "sem ajuste", nunca como acréscimo silencioso', mod.orcItemAplicarAjuste(10000, 'qualquer-coisa', 'fixo', 10), { ajusteCents: 0, precoFinalItemCents: 10000 });

// ── 8. Nunca fica negativo — desconto maior que o preço zera, não vira dívida ──
test('8. desconto fixo maior que o preço original nunca deixa o item com preço negativo (zera em vez disso)',
  mod.orcItemAplicarAjuste(1000, 'desconto', 'fixo', 50).precoFinalItemCents, 0);

// ── 9-10. Centavo-exato: percentuais que não dividem redondo ──
test('9. R$49,46 + 3,7% (percentual) — arredonda em centavos, nunca ponto flutuante bruto',
  mod.orcItemAplicarAjuste(4946, 'acrescimo', 'percentual', 3.7).precoFinalItemCents, Math.round(4946 * 1.037));
test('10. R$0,01 - 1% não gera resultado fracionário de centavo (sempre inteiro)',
  Number.isInteger(mod.orcItemAplicarAjuste(1, 'desconto', 'percentual', 1).precoFinalItemCents), true);

// ── 11-14. orcItemCalcularTotal — registro completo com quantidade ──
{
  var r = mod.orcItemCalcularTotal({ precoOriginalCents: 10000, ajusteOperacao: 'acrescimo', ajusteTipo: 'fixo', ajusteValor: 10, qty: 3 });
  test('11. totalItemCents = precoFinalItemCents × qty (3 unidades a R$110,00 = R$330,00)', r.totalItemCents, 33000);
  test('12. o registro devolvido tem todos os campos exigidos para persistência no snapshot', Object.keys(r).sort(), ['ajusteCents', 'ajusteOperacao', 'ajusteTipo', 'ajusteValor', 'precoFinalItemCents', 'precoOriginalCents', 'totalItemCents'].sort());
}
{
  var r2 = mod.orcItemCalcularTotal({ precoOriginalCents: 5000, qty: 2 }); // sem nenhum campo de ajuste — item "normal"
  test('13. item sem nenhum ajuste (campos ausentes): ajusteOperacao vira null, preço final = original, total = original × qty',
    [r2.ajusteOperacao, r2.precoFinalItemCents, r2.totalItemCents], [null, 5000, 10000]);
}
{
  var r3 = mod.orcItemCalcularTotal({ precoOriginalCents: 10000, ajusteOperacao: 'desconto', ajusteTipo: 'percentual', ajusteValor: 10 }); // qty ausente
  test('14. qty ausente/zero é tratada como 1 (nunca zera o total do item por acidente)', r3.totalItemCents, 9000);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
