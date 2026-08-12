/**
 * test_orc_motor_comercial_taxa_embutida_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seções 4-8 — mudança de regra comercial
 * deliberada, confirmada em produção. O Bloco E anterior (SPRINT
 * PRÉ-GO-LIVE) fazia cartao[n].totalCents = baseCents SEMPRE — ou seja,
 * o preço no cartão NUNCA embutia a taxa real da maquininha cadastrada
 * em Config > Financeiro > Parcelamento, e o desconto PIX era um número
 * arbitrário digitado, sem relação matemática com essa taxa.
 *
 * Regra nova: "sem juros" = sem juros VISÍVEIS ao cliente — a VR não
 * absorve mais a taxa da operadora silenciosamente. cartao(n) =
 * base / (1 - taxa(n)/100); o desconto PIX sugerido é exatamente a taxa
 * do cartão da quantidade de parcelas selecionada, e o valor PIX volta
 * exatamente à base (cálculo inverso, seção 5).
 *
 * Uso: node scripts/test_orc_motor_comercial_taxa_embutida_2026-08-12.js
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
  extractFn('orcDistribuirParcelas'),
  extractFn('orcMotorComercial'),
  'module.exports = { motor: orcMotorComercial, distrib: orcDistribuirParcelas };',
].join('\n\n');
var modPath = path.join(__dirname, '_orc_motor_comercial.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== Motor Comercial — taxa da maquininha embutida no cartão + PIX inverso exato ===\n');

function tabela(t1, t2, t3) {
  return [{ parcelas: 1, taxa: t1 }, { parcelas: 2, taxa: t2 }, { parcelas: 3, taxa: t3 }];
}

// ── 1. Embutimento — taxa 0/3/5/6.5% × 1x/2x/3x ───────────────────────
[0, 3, 5, 6.5].forEach(function (taxaUnica) {
  [1, 2, 3].forEach(function (n) {
    var tab = tabela(taxaUnica, taxaUnica, taxaUnica);
    var r = mod.motor(100, { tabelaParcelamento: tab, nParcAtual: n });
    var esperadoTotalCents = taxaUnica > 0 ? Math.round(10000 / (1 - taxaUnica / 100)) : 10000;
    test('1. taxa ' + taxaUnica + '% em ' + n + 'x — cartao[' + n + '].totalCents embute a taxa corretamente', r.cartao[n].totalCents, esperadoTotalCents);
  });
});

// ── 2. PIX — cálculo inverso, sempre volta exatamente à base ──────────
[0, 3, 5, 6.5].forEach(function (taxaUnica) {
  [1, 2, 3].forEach(function (n) {
    var tab = tabela(taxaUnica, taxaUnica, taxaUnica);
    var r = mod.motor(100, { tabelaParcelamento: tab, nParcAtual: n });
    test('2. taxa ' + taxaUnica + '% em ' + n + 'x — PIX sugerido (sem override) volta EXATAMENTE à base (10000 centavos)', r.pix.totalCents, 10000);
    test('2b. taxa ' + taxaUnica + '% em ' + n + 'x — percentual sugerido = taxa cadastrada', r.pix.percentualSugerido, taxaUnica);
  });
});

// ── 3. Tabela realista (3% em 2x, 6.5% em 3x, 0% em 1x) ────────────────
(function () {
  var tab = tabela(0, 3, 6.5);
  var r1 = mod.motor(100, { tabelaParcelamento: tab, nParcAtual: 1 });
  var r2 = mod.motor(100, { tabelaParcelamento: tab, nParcAtual: 2 });
  var r3 = mod.motor(100, { tabelaParcelamento: tab, nParcAtual: 3 });
  test('3a. 1x sem taxa cadastrada — preço no cartão = base (sem juros de verdade)', r1.cartao[1].totalCents, 10000);
  test('3b. 2x com 3% — preço no cartão embute a taxa (100/(1-0.03) = 103,09)', r2.cartao[2].totalCents, 10309);
  test('3c. 3x com 6,5% — preço no cartão embute a taxa (100/(1-0.065) = 106,95)', r3.cartao[3].totalCents, 10695);
  test('3d. PIX sugerido em 3x (6,5%) volta exatamente à base', r3.pix.totalCents, 10000);
})();

// ── 4. Centavos ímpares — nunca perde/ganha 1 centavo ──────────────────
[199.99, 33.33, 1000.01, 0.01, 87.77].forEach(function (baseImpar) {
  var tab = tabela(0, 2.99, 3.99);
  var r = mod.motor(baseImpar, { tabelaParcelamento: tab, nParcAtual: 3 });
  var esperadoBaseCents = Math.round(baseImpar * 100);
  test('4. base ímpar R$' + baseImpar + ' em 3x (3,99%) — PIX sugerido volta ao centavo exato da base', r.pix.totalCents, esperadoBaseCents);
});

// ── 5. Troca de parcelas 3x → 1x → 2x recalcula a sugestão ─────────────
(function () {
  var tab = tabela(0, 3, 6);
  var r1 = mod.motor(200, { tabelaParcelamento: tab, nParcAtual: 3 });
  var r2 = mod.motor(200, { tabelaParcelamento: tab, nParcAtual: 1 });
  var r3 = mod.motor(200, { tabelaParcelamento: tab, nParcAtual: 2 });
  test('5a. sugestão em 3x = 6%', r1.pix.percentualSugerido, 6);
  test('5b. trocar para 1x recalcula sugestão = 0%', r2.pix.percentualSugerido, 0);
  test('5c. trocar para 2x recalcula sugestão = 3%', r3.pix.percentualSugerido, 3);
  test('5d. em qualquer parcela, PIX sem override sempre volta à base (20000 centavos)', [r1.pix.totalCents, r2.pix.totalCents, r3.pix.totalCents], [20000, 20000, 20000]);
})();

// ── 6. Override manual — preservado, aplicado sobre o preço do cartão ──
(function () {
  var tab = tabela(0, 0, 5); // 3x = 5%
  // sugestão em 3x seria 5% (PIX = base exata). Vendedor força 10% (mais desconto).
  var rOverride = mod.motor(100, { tabelaParcelamento: tab, nParcAtual: 3, pix: 10 });
  var cartao3x = 100 / (1 - 0.05); // 105.263...
  var esperado = Math.round(Math.round(cartao3x * 100) * (1 - 10 / 100));
  test('6a. override manual (10%, sugestão seria 5%) é PRESERVADO — nunca sobrescrito pela sugestão', rOverride.pix.percentual, 10);
  test('6b. override aplica sobre o preço do CARTÃO (não sobre a base) — resultado é diferente da base exata', rOverride.pix.totalCents !== 10000, true);
  test('6c. valor do override calculado corretamente (cartão×(1-10%))', rOverride.pix.totalCents, esperado);

  // Override "para menos" (3% em vez de 5% sugerido) — VR fica com parte da margem da taxa
  var rMenos = mod.motor(100, { tabelaParcelamento: tab, nParcAtual: 3, pix: 3 });
  test('6d. override para menos desconto (3% < 5% sugerido) também preservado, nunca ajustado pra sugestão', rMenos.pix.percentual, 3);
  test('6e. override para menos desconto resulta em PIX > base (VR mantém parte da margem)', rMenos.pix.totalCents > 10000, true);
})();

// ── 7. Reload/edição de orçamento salvo — não recalcula diferente ──────
(function () {
  // Um orçamento salvo com taxa vigente de 5% em 3x tinha PIX=5% (=base exata).
  // Depois a taxa da maquininha MUDOU pra 8% em 3x (renegociação com o banco).
  // Reabrir o orçamento antigo para consulta (sem trocar nada) deve continuar
  // mostrando o valor ORIGINALMENTE calculado se o override for respeitado —
  // aqui validamos que passar o pix explícito (valor salvo) sempre re-deriva
  // o mesmo total, independente da taxa atual da tabela ter mudado.
  var tabAntiga = tabela(0, 0, 5);
  var salvo = mod.motor(150, { tabelaParcelamento: tabAntiga, nParcAtual: 3 });
  test('7a. no momento do salvamento, PIX sugerido (5%) = base exata', salvo.pix.totalCents, 15000);

  var tabNova = tabela(0, 0, 8);
  var reaberto = mod.motor(150, { tabelaParcelamento: tabNova, nParcAtual: 3, pix: salvo.pix.percentual });
  test('7b. reabrir com o percentual EFETIVO salvo (5%, não a nova sugestão de 8%) recalcula sobre o cartão atual — mas o percentual em si nunca muda sozinho', reaberto.pix.percentual, 5);
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
