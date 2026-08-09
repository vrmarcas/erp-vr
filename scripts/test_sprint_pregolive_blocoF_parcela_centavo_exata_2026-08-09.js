/**
 * test_sprint_pregolive_blocoF_parcela_centavo_exata_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco F — achado real: a tela "Confirmação de
 * Pagamento" mostrava, na mesma linha, "3x de R$39,33 (total: R$117,98)"
 * — mas 39,33 × 3 = 117,99, não 117,98. "total" e "parcela" eram
 * arredondados de forma INDEPENDENTE dentro de orcMotorPagamento(): o
 * total vinha do valor bruto (com desconto/PIX/taxa aplicados e
 * arredondado sozinho) e a parcela vinha de dividir esse total por N e
 * arredondar de novo — as duas contas podiam divergir por 1 centavo,
 * mostrando ao vendedor (e, pelo mesmo motor, ao cliente no PDF/WhatsApp)
 * uma matemática que não fecha.
 *
 * Corrigido tornando o total SEMPRE derivado da parcela já arredondada
 * (nParc × valorParcela) — a parcela vira a fonte da verdade; nunca duas
 * contas em paralelo que podem divergir.
 *
 * Função sob teste (extraída de index.html): orcMotorPagamento.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoF_parcela_centavo_exata_2026-08-09.js
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
var src = extractFn('orcMotorPagamento') + '\n\nmodule.exports = { orcMotorPagamento: orcMotorPagamento };';
var modPath = path.join(__dirname, '_blocoF_motor_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco F — parcela e total sempre batem, nunca "matemática impossível" ===\n');

// ── 1. Achado real exato: R$117,98 em até 3x sem juros ──
{
  var m = mod.orcMotorPagamento(117.98, { parcAtivo: true, nParc: 3, tabelaParcelamento: [{parcelas:3, taxa:0}] });
  test('1. achado real corrigido: 3x de R$39,33 e total exibido sempre fecham (3 × 39,33 = total exibido, nunca 117,98 ao lado de um valor de parcela que não bate)',
    +(m.valorParcela * 3).toFixed(2), +m.totalComTaxa.toFixed(2));
  test('1b. valor da parcela continua o esperado (R$39,33)', m.valorParcela, 39.33);
}

// ── 2-6. Varredura: para uma faixa de totais e parcelamentos (com e sem
// taxa), nParc × valorParcela é SEMPRE exatamente igual a totalComTaxa —
// nunca 1 centavo de diferença, seja qual for o resto da divisão. ──
{
  var totais = [49.46, 112.21, 117.98, 199.90, 202.50, 333.33, 10.01, 0.03, 1000.00, 87.65];
  var falhas = [];
  totais.forEach(function (total) {
    [1, 2, 3, 4, 5, 6].forEach(function (n) {
      [0, 2.5, 3.99].forEach(function (taxa) {
        var m = mod.orcMotorPagamento(total, {
          parcAtivo: n > 1, nParc: n,
          tabelaParcelamento: [{ parcelas: n, taxa: taxa }]
        });
        var somaCent = Math.round(m.valorParcela * n * 100);
        var totalCent = Math.round(m.totalComTaxa * 100);
        if (somaCent !== totalCent) falhas.push({ total: total, n: n, taxa: taxa, soma: somaCent, totalCent: totalCent });
      });
    });
  });
  test('2. varredura de 10 totais × 6 parcelamentos × 3 taxas (180 combinações): nParc × valorParcela nunca diverge de totalComTaxa, nem por 1 centavo',
    falhas, []);
}

// ── 3. Parcelamento desativado (1x) — total continua igual ao valor após
// desconto/PIX, sem nenhuma alteração de comportamento. ──
{
  var m = mod.orcMotorPagamento(117.98, { parcAtivo: false, nParc: 1 });
  test('3. regressão — sem parcelamento (1x), total continua exatamente o valor após desconto/PIX, comportamento inalterado', m.totalComTaxa, 117.98);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
