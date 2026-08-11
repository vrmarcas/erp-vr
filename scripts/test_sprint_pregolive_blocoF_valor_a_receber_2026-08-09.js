/**
 * test_sprint_pregolive_blocoF_valor_a_receber_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco F (gap remanescente da homologação) — achado
 * real relatado pelo usuário: na etapa "Confirmação de Pagamento" do
 * wizard, trocar a "Forma de Pagamento" de PIX para Cartão atualizava
 * corretamente a linha "3x de R$X (total: R$117,98)" logo abaixo, mas o
 * "Valor a Receber" em destaque (orcPgtoValorDisplay) continuava travado
 * no valor calculado quando a etapa foi aberta pela primeira vez —
 * sempre o valor de PIX (ex.: R$112,21), mesmo depois de trocar para
 * Cartão (que deveria mostrar R$117,98).
 *
 * Causa raiz: o valor só era calculado UMA VEZ, dentro de orcStep(5),
 * nunca recalculado quando o vendedor trocava orcSimMetodo/orcSimParcelas
 * depois.
 *
 * Corrigido: orcPgtoAtualizarValorReceber() — fonte única, chamada tanto
 * na entrada da etapa (orcStep) quanto em toda troca de método/parcela
 * (orcAtualizarIconePgto → orcCalcParcelaDisplay → aqui).
 *
 * Uso: node scripts/test_sprint_pregolive_blocoF_valor_a_receber_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco F — "Valor a Receber" atualiza ao trocar Forma de Pagamento ===\n');

// ── 1-2. Regressão estrutural: wiring correto ──
var srcOrcStep = extractFn('orcStep');
test('1. orcStep(5) agora usa a fonte única orcPgtoAtualizarValorReceber() em vez de calcular sozinho',
  /if \(n===5\)[\s\S]{0,600}orcPgtoAtualizarValorReceber\(\)/.test(srcOrcStep), true);

var srcIcone = extractFn('orcAtualizarIconePgto');
test('2. orcAtualizarIconePgto() (disparado ao trocar a Forma de Pagamento) continua chamando orcCalcParcelaDisplay(), que agora também atualiza o Valor a Receber',
  /orcCalcParcelaDisplay\(\)/.test(srcIcone), true);

// ── 3-8. Execução real: DOM fake completo, reproduzindo a troca PIX→Cartão ──
var FN_NAMES = ['orcFmt', 'orcMotorPagamento', 'orcDistribuirParcelas', 'orcMotorComercial', 'orcLerCondicoesPagamentoDOM', 'orcCalcParcelaDisplay', 'orcPgtoAtualizarValorReceber'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = { orcCalcParcelaDisplay: orcCalcParcelaDisplay, orcPgtoAtualizarValorReceber: orcPgtoAtualizarValorReceber };"
].join('\n\n');
var modPath = path.join(__dirname, '_blocoF_valorareceber_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

function makeEl(props) { return Object.assign({ value: '', textContent: '', style: {} }, props || {}); }

function montarAmbiente(finalPrice) {
  var _els = {
    orcSimMetodo: makeEl({ value: 'pix' }),
    orcSimParcelas: makeEl({ value: '1' }),
    orcSimParcelaDisplay: makeEl({ style: {} }),
    orcPgtoValorDisplay: makeEl(),
    orcSimValor: makeEl(),
    orcDescCondToggle: makeEl(), orcDescCond: makeEl(), orcDescCondData: makeEl(),
    orcPixDiscToggle: makeEl(), orcPixDiscPct: makeEl(),
    orcParcToggle: makeEl(), orcParcSel: makeEl(),
    cfgParcelamento: null
  };
  global.document = { getElementById: function (id) { return _els[id]; } };
  global.window = { _orcCalc: { finalPrice: finalPrice } };
  global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 3.99 }] };
  global.cfgLoad = function () { return {}; };
  var mod = require(modPath);
  return { els: _els, mod: mod };
}

{
  var amb = montarAmbiente(117.98);
  amb.mod.orcPgtoAtualizarValorReceber(); // simula entrada na etapa 5, método padrão PIX
  var valorPix = amb.els.orcPgtoValorDisplay.textContent;
  test('3. ao entrar na etapa com método PIX (sem desconto configurado), Valor a Receber = valor à vista (R$117,98)', valorPix, 'R$ 117,98');
}

{
  // Reproduz o achado real: PIX com desconto configurado (achado real do
  // usuário usava um valor menor de PIX, ex. R$112,21) — aqui simulado
  // com um desconto PIX de 4,89% sobre R$117,98 pra chegar perto do
  // exemplo do usuário, e depois trocando para Cartão 3x.
  var amb2 = montarAmbiente(117.98);
  amb2.els.orcPixDiscToggle.checked = true;
  amb2.els.orcPixDiscPct.value = '4.89';
  amb2.mod.orcPgtoAtualizarValorReceber(); // método ainda PIX
  var valorComPix = amb2.els.orcPgtoValorDisplay.textContent;
  test('4. com desconto PIX configurado e método PIX selecionado, Valor a Receber reflete o desconto (menor que o total)',
    valorComPix !== 'R$ 117,98', true);

  // Troca para Cartão 3x — acionando o mesmo fluxo real (orcCalcParcelaDisplay,
  // chamado por orcAtualizarIconePgto ao trocar orcSimMetodo).
  amb2.els.orcSimMetodo.value = 'cartao';
  amb2.els.orcSimParcelas.value = '3';
  amb2.mod.orcCalcParcelaDisplay();

  test('5. achado real corrigido: depois de trocar para Cartão 3x, Valor a Receber deixa de mostrar o valor de PIX — agora reflete o cartão (nunca mais travado no valor antigo)',
    amb2.els.orcPgtoValorDisplay.textContent !== valorComPix, true);

  // O valor do cartão deve bater com o motor de pagamento direto (mesma fonte).
  var totalMatch = amb2.els.orcSimParcelaDisplay.textContent.match(/total: (R\$ [\d.,]+)/);
  test('6. o "Valor a Receber" agora bate com o total mostrado na linha de parcelamento logo abaixo (nunca duas contas divergentes na mesma tela)',
    amb2.els.orcPgtoValorDisplay.textContent, totalMatch && totalMatch[1]);
}

{
  // Cenário sem nenhum desconto: PIX e Cartão 1x devem coincidir (nenhuma
  // taxa/desconto configurado) — troca de método não deveria mudar nada.
  var amb3 = montarAmbiente(100);
  amb3.mod.orcPgtoAtualizarValorReceber();
  var valorPix100 = amb3.els.orcPgtoValorDisplay.textContent;
  amb3.els.orcSimMetodo.value = 'cartao';
  amb3.els.orcSimParcelas.value = '1';
  amb3.mod.orcCalcParcelaDisplay();
  test('7. sem nenhum desconto/taxa configurado, PIX e Cartão 1x mostram o MESMO valor (R$100,00 nos dois)',
    [valorPix100, amb3.els.orcPgtoValorDisplay.textContent], ['R$ 100,00', 'R$ 100,00']);
}

{
  // GO-LIVE 2026-08-11, P0 seção 7 — regra de negócio invertida: PREÇO À
  // VISTA = PIX = DINHEIRO. Dinheiro agora precisa aplicar o MESMO
  // desconto à vista configurado para PIX (antes desta rodada, Dinheiro
  // caía no mesmo ramo de Cartão/Link e mostrava o valor cheio — bug real
  // reproduzido em produção: Cartão R$131,82, PIX R$123,25, Dinheiro
  // R$131,82 — corrigido para Dinheiro = R$123,25).
  var amb4 = montarAmbiente(117.98);
  amb4.els.orcPixDiscToggle.checked = true;
  amb4.els.orcPixDiscPct.value = '10';
  amb4.els.orcSimMetodo.value = 'dinheiro';
  amb4.mod.orcPgtoAtualizarValorReceber();
  test('8. PREÇO À VISTA = PIX = DINHEIRO: selecionar "Dinheiro" aplica o MESMO desconto à vista configurado para PIX',
    amb4.els.orcPgtoValorDisplay.textContent, 'R$ 106,18');
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
