/**
 * test_orc_dinheiro_sem_parcelas_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, gate 2 (smoke visual real em produção,
 * orçamento #000020) — bug real encontrado ao testar "Dinheiro" na tela
 * de Confirmação de Pagamento: trocar "Forma de Pagamento" para Dinheiro
 * escondia corretamente a LINHA do seletor de parcelas
 * (orcSimParcelasRow), mas a linha de resumo "3× de R$268,94 (total:
 * R$806,84)" (orcSimParcelaDisplay) continuava visível — um elemento
 * IRMÃO, não filho da row escondida. orcCalcParcelaDisplay() só checava
 * a quantidade de parcelas salva no <select> (que ficava em "3" por
 * inércia de quando Cartão estava selecionado), nunca o método atual.
 * Dinheiro/PIX nunca podem mostrar parcelamento de cartão.
 *
 * Corrigido: orcCalcParcelaDisplay() agora lê o método (orcSimMetodo) e
 * esconde a linha sempre que o método não é cartão/link, antes mesmo de
 * olhar a quantidade de parcelas.
 *
 * Uso: node scripts/test_orc_dinheiro_sem_parcelas_2026-08-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) {
  if (cond) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc); failed++; }
}
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

console.log('\n=== Confirmação de Pagamento — Dinheiro/PIX nunca mostram parcelamento de cartão ===\n');

// ── 1. Source: orcCalcParcelaDisplay agora checa o método antes de exibir a linha ──
var fnSrc = extractFn('orcCalcParcelaDisplay');
ok('1a. Lê orcSimMetodo antes de decidir exibir a linha de parcelas', /orcSimMetodo/.test(fnSrc));
ok('1b. Esconde a linha (display=none) quando método não é cartão/link', /metodo !== 'cartao' && metodo !== 'link'[\s\S]{0,60}display = 'none'/.test(fnSrc));

// ── 2. Execução real (DOM fake), reproduzindo o achado do smoke visual ──
var FN_NAMES = ['orcFmt', 'orcDistribuirParcelas', 'orcMotorComercial', 'orcLerCondicoesPagamentoDOM', 'orcCalcParcelaDisplay', 'orcPgtoAtualizarValorReceber'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = { orcCalcParcelaDisplay: orcCalcParcelaDisplay, orcPgtoAtualizarValorReceber: orcPgtoAtualizarValorReceber };"
].join('\n\n');
var modPath = path.join(__dirname, '_dinheiro_sem_parcelas_extracted.tmp.js');
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
    orcPixDiscPct: makeEl({ value: '5.14' }),
  };
  global.document = { getElementById: function (id) { return _els[id]; } };
  global.window = { _orcCalc: { finalPrice: finalPrice } };
  global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 5.14 }] };
  global.cfgLoad = function () { return {}; };
  var mod = require(modPath);
  return { els: _els, mod: mod };
}

{
  // Reprodução exata do achado: orçamento R$765,37, cartão 3x já tinha calculado a linha; troca para Dinheiro.
  var amb = montarAmbiente(765.37, 'dinheiro', 3);
  amb.mod.orcCalcParcelaDisplay();
  test('2. Dinheiro com 3 parcelas "presas" no select — a linha de parcelamento fica ESCONDIDA (display=none)', amb.els.orcSimParcelaDisplay.style.display, 'none');
  test('2b. A linha de parcelamento nunca é preenchida com texto de cartão para Dinheiro', amb.els.orcSimParcelaDisplay.textContent, '');
}
{
  var amb = montarAmbiente(765.37, 'pix', 3);
  amb.mod.orcCalcParcelaDisplay();
  test('3. PIX também nunca mostra a linha de parcelamento de cartão', amb.els.orcSimParcelaDisplay.style.display, 'none');
}
{
  // Regressão de guarda: Cartão real continua mostrando a linha corretamente.
  var amb = montarAmbiente(765.37, 'cartao', 3);
  amb.mod.orcCalcParcelaDisplay();
  ok('4. Cartão 3x continua mostrando a linha de parcelamento (regressão de guarda)', amb.els.orcSimParcelaDisplay.style.display === '' && /3× de R\$ 268,9/.test(amb.els.orcSimParcelaDisplay.textContent));
}
{
  // Link de Pagamento também é uma forma "parcelável" — deve continuar mostrando.
  var amb = montarAmbiente(765.37, 'link', 3);
  amb.mod.orcCalcParcelaDisplay();
  ok('5. Link de Pagamento continua mostrando a linha de parcelamento (mesma regra do cartão)', amb.els.orcSimParcelaDisplay.style.display === '');
}
{
  // Dinheiro com 1x (comum) já funcionava — confirma que não regrediu.
  var amb = montarAmbiente(765.37, 'dinheiro', 1);
  amb.mod.orcCalcParcelaDisplay();
  test('6. Dinheiro com parcelas=1 também esconde a linha (caminho pré-existente, sem regressão)', amb.els.orcSimParcelaDisplay.style.display, 'none');
}
{
  // "Valor a Receber" do Dinheiro continua igual ao PIX à vista — não afetado por esta correção.
  var amb = montarAmbiente(765.37, 'dinheiro', 3);
  amb.mod.orcPgtoAtualizarValorReceber();
  var ambPix = montarAmbiente(765.37, 'pix', 3);
  ambPix.mod.orcPgtoAtualizarValorReceber();
  test('7. Valor a Receber de Dinheiro continua idêntico ao de PIX (correção não mexeu no valor, só na exibição)', amb.els.orcPgtoValorDisplay.textContent, ambPix.els.orcPgtoValorDisplay.textContent);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
