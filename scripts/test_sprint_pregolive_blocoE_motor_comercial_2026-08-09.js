/**
 * test_sprint_pregolive_blocoE_motor_comercial_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco E (parte 1/N) — motor central único da nova
 * regra comercial definitiva de Cartão/PIX:
 *   - PREÇO PRINCIPAL AO CLIENTE = preço para pagamento em até 3x SEM
 *     JUROS (o cliente nunca vê a taxa de processamento do cartão —
 *     achado real: o config atual (CFG_DEFAULT.parcelamento) tem taxas
 *     REAIS de 2,99%/3,99% em 2x/3x, então "sem juros" é uma mudança de
 *     regra comercial, não um bug — a taxa continua existindo como custo
 *     interno, só nunca é somada ao valor mostrado ao cliente em 1-3x).
 *   - PIX SEMPRE disponível como alternativa (nunca mais atrás de um
 *     toggle Sim/Não).
 *   - Parcelas somam EXATAMENTE o total, nunca uma "matemática
 *     impossível" (resto da divisão vai inteiro na 1ª parcela).
 *
 * Funções sob teste (extraídas de index.html): orcDistribuirParcelas,
 * orcMotorComercial.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoE_motor_comercial_2026-08-09.js
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
  "module.exports = { orcDistribuirParcelas: orcDistribuirParcelas, orcMotorComercial: orcMotorComercial };"
].join('\n\n');
var modPath = path.join(__dirname, '_blocoE_motor_comercial_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco E — motor comercial único: cartão 3x sem juros + PIX sempre ===\n');

// ── orcDistribuirParcelas — soma sempre exata, resto na 1ª parcela ──
{
  test('1. achado real do exemplo do usuário: R$117,98 em 3x → [R$39,34, R$39,32, R$39,32]',
    mod.orcDistribuirParcelas(11798, 3), [3934, 3932, 3932]);
  test('2. divisão exata (sem resto): R$300,00 em 3x → [R$100,00, R$100,00, R$100,00]',
    mod.orcDistribuirParcelas(30000, 3), [10000, 10000, 10000]);
  test('3. 1x devolve a própria parcela única, igual ao total',
    mod.orcDistribuirParcelas(11798, 1), [11798]);
  test('4. a soma das parcelas é SEMPRE exatamente o total, para uma varredura de totais/parcelamentos (nunca "matemática impossível")',
    (function () {
      var falhas = [];
      [4946, 11221, 11798, 19990, 20250, 33333, 100, 1, 999999].forEach(function (t) {
        [1, 2, 3, 4, 5, 6, 7, 10, 12].forEach(function (n) {
          var p = mod.orcDistribuirParcelas(t, n);
          var soma = p.reduce(function (s, v) { return s + v; }, 0);
          if (soma !== t) falhas.push({ t: t, n: n, soma: soma });
        });
      });
      return falhas;
    })(), []);
}

// ── orcMotorComercial — cartão 1/2/3x sem juros + PIX sempre disponível ──
{
  var cfg = { overhead: 15, vrml: 30, impostos: 0, comissao: 0, cartao: 3.49, pix: 0.99, link: 4.99, descMax: 10 };
  var m1 = mod.orcMotorComercial(117.98, cfg);
  test('5. baseCents = preço à vista em centavos', m1.baseCents, 11798);
  test('6. achado real corrigido: cartão 1x = MESMO valor da base (sem juros, nunca com taxa somada)', m1.cartao[1].totalCents, 11798);
  test('7. achado real corrigido: cartão 2x = MESMO valor da base (sem juros) — apesar do config ter taxa real de 2,99% em 2x, ela NUNCA aparece ao cliente em até 3x',
    m1.cartao[2].totalCents, 11798);
  test('8. achado real corrigido: cartão 3x = MESMO valor da base (sem juros) — apesar do config ter taxa real de 3,99% em 3x',
    m1.cartao[3].totalCents, 11798);
  test('9. cartao[3].parcelas soma exatamente o total (mesma garantia de orcDistribuirParcelas)',
    m1.cartao[3].parcelas.reduce(function (s, v) { return s + v; }, 0), 11798);
  test('10. valorParcela de 3x é o valor REPRESENTATIVO (a maioria das parcelas — R$39,32, que aparece 2x — não a exceção R$39,34)',
    m1.cartao[3].valorParcela, 39.32);
  test('11. cartao[1] (à vista) tem 1 única parcela, igual ao total', m1.cartao[1].parcelas, [11798]);

  test('12. PIX SEMPRE presente no resultado (nunca condicional a um toggle) — percentual vem do config (0,99%)', m1.pix.percentual, 0.99);
  test('13. PIX totalCents = base com o desconto aplicado: R$117,98 × (1-0,0099) = R$116,81 (achado real: nunca ignora o desconto configurado)',
    m1.pix.totalCents, Math.round(11798 * (1 - 0.0099)));
  test('14. PIX é estritamente menor que o preço no cartão (é sempre uma alternativa vantajosa, nunca mais caro)',
    m1.pix.totalCents < m1.cartao[1].totalCents, true);
}

// ── Sem config de PIX (cfgFinanceiro ausente/incompleto) — nunca quebra, nunca inventa desconto ──
{
  var m2 = mod.orcMotorComercial(100, {});
  test('15. sem "pix" no config: percentual vira 0 (nunca inventa um desconto que não foi configurado)', m2.pix.percentual, 0);
  test('16. sem desconto PIX configurado, PIX totalCents = mesmo valor da base (0% de desconto)', m2.pix.totalCents, m2.baseCents);
}

// ── Valores reais mencionados pelo usuário (Bloco E) ──
{
  [49.46, 112.21, 117.98, 199.90, 202.50, 333.33].forEach(function (valor, i) {
    var r = mod.orcMotorComercial(valor, { pix: 0.99 });
    var idx = i + 17;
    test(idx + '. R$' + valor.toFixed(2).replace('.', ',') + ' — cartão 1/2/3x sem juros são todos iguais à base (nunca embutem taxa)',
      [r.cartao[1].totalCents, r.cartao[2].totalCents, r.cartao[3].totalCents], [r.baseCents, r.baseCents, r.baseCents]);
  });
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
