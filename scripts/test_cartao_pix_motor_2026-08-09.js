/**
 * test_cartao_pix_motor_2026-08-09.js
 *
 * RODADA 6, seção 2 — motor central de Cartão/PIX: além da cobertura já
 * feita em test_orcamento_pdf_whatsapp.js (orcMotorPagamento/
 * orcLerCondicoesPagamentoDOM/orcCalcCondicoesPagamento, usadas por
 * PDF/WhatsApp), este arquivo cobre os outros 3 pontos que a auditoria
 * desta rodada encontrou como reimplementações independentes (ou, no
 * caso de orcCalcParcelaDisplay, uma reimplementação QUEBRADA — ignorava
 * desconto/PIX/taxa):
 *
 *   1. orcCalcParcelaDisplay() — tela "Confirmação de Pagamento" (#opg5,
 *      alcançável via "💳 Ir para Pagamento →"). Testado por execução
 *      real (DOM fake), não só por regex.
 *   2. finAntecipar() — achado real: cfg.financeiro.cartao é armazenado
 *      em pontos percentuais (3.49 = 3,49%) em todo o resto do arquivo,
 *      mas esta função tratava o valor como fração decimal — corrigido.
 *      Testado por execução real.
 *   3. _orcSalvarOrcamentoImpl() — regressão estrutural provando que
 *      valorFinal é calculado via o motor central (orcMotorPagamento),
 *      não mais por uma 4ª fórmula duplicada em ponto flutuante.
 *
 * Uso: node scripts/test_cartao_pix_motor_2026-08-09.js
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
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== RODADA 6, seção 2 — Cartão/PIX: telas restantes + regressão estrutural ===\n');

// ── 1. orcCalcParcelaDisplay() — execução real ──────────────────────────
{
  var FN1 = ['orcMotorPagamento', 'orcLerCondicoesPagamentoDOM', 'orcCalcParcelaDisplay'];
  var src1 = FN1.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN1.join(',') + '};';
  var modPath1 = path.join(__dirname, '_cartao_pix_display_extracted.tmp.js');
  fs.writeFileSync(modPath1, src1);
  delete require.cache[require.resolve(modPath1)];

  var _elements = {};
  function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {} }, props || {}); }
  global.document = { getElementById: function (id) { return _elements[id]; } };
  global.CFG_DEFAULT = { parcelamento: [
    { parcelas: 1, taxa: 0 }, { parcelas: 3, taxa: 0 }, { parcelas: 6, taxa: 8 }
  ] };
  global.cfgLoad = function () { return JSON.parse(JSON.stringify(global.CFG_DEFAULT)); };

  function resetEls(finalPrice, opts) {
    opts = opts || {};
    global.window = { _orcCalc: { finalPrice: finalPrice } };
    _elements = {
      orcSimParcelas: makeEl({ value: String(opts.n || 1) }),
      orcSimParcelaDisplay: makeEl({}),
      orcDescCondToggle: makeEl({ checked: !!opts.dcOn }),
      orcDescCond: makeEl({ value: String(opts.dcPct || 0) }),
      orcPixDiscToggle: makeEl({ checked: !!opts.pxOn }),
      orcPixDiscPct: makeEl({ value: String(opts.pxPct || 0) }),
      orcParcToggle: makeEl({ checked: true }),
      orcParcSel: { value: String(opts.n || 1) }
    };
  }

  var mod1 = require(modPath1);

  resetEls(1000, { n: 1 });
  mod1.orcCalcParcelaDisplay();
  test('1. n<=1 esconde o display (à vista, sem "parcela")', _elements.orcSimParcelaDisplay.style.display, 'none');

  resetEls(1000, { n: 6 });
  mod1.orcCalcParcelaDisplay();
  test('2. achado real corrigido: 6x com taxa de 8% mostra R$180,00 (1080/6), NUNCA R$166,67 (1000/6 ignorando a taxa)',
    _elements.orcSimParcelaDisplay.textContent, '6× de R$ 180,00 (total: R$ 1.080,00)');

  resetEls(1000, { n: 3, dcOn: true, dcPct: 10 });
  mod1.orcCalcParcelaDisplay();
  test('3. achado real corrigido: desconto condicional de 10% é aplicado ANTES de dividir (3x de R$300,00 = 900/3), nunca ignorado (1000/3)',
    _elements.orcSimParcelaDisplay.textContent, '3× de R$ 300,00 (total: R$ 900,00)');

  resetEls(1000, { n: 3, pxOn: true, pxPct: 5 });
  mod1.orcCalcParcelaDisplay();
  test('4. achado real corrigido: desconto PIX de 5% também é aplicado (3x de R$316,67 = 950/3), nunca ignorado',
    _elements.orcSimParcelaDisplay.textContent, '3× de R$ 316,67 (total: R$ 950,00)');
}

// ── 2. finAntecipar() — execução real, achado do unit-mismatch ─────────
{
  var FN2 = ['finAntecipar'];
  var src2 = FN2.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN2.join(',') + '};';
  var modPath2 = path.join(__dirname, '_cartao_pix_antecipar_extracted.tmp.js');
  fs.writeFileSync(modPath2, src2);
  delete require.cache[require.resolve(modPath2)];

  global.cfgLoad = function () { return { financeiro: { cartao: 3.49 } }; }; // forma REAL como é gravado (pontos percentuais)
  global.finFmt = function (v) { return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  global.confirm = function () { return true; };
  global.FIN_TX = [{ os: 'os1', status: 'pendente', valor: 1000 }];
  global._cloudSave = function () { return Promise.resolve({ ok: true }); };
  global._confirmarAposSalvar = function (promise, onErr, onOk) { return promise.then(onOk); };
  global.finRender = function () {};
  global.finDashKPIs = function () {};
  global.showToast = function () {};

  var mod2 = require(modPath2);
  mod2.finAntecipar('os1', 1000);
  test('5. achado real corrigido: cfg.financeiro.cartao=3.49 (pontos percentuais, forma real gravada) resulta em R$965,10 recebido, NUNCA um valor negativo',
    global.FIN_TX[0].valor, 965.10);
  test('6. status muda para "antecipado"', global.FIN_TX[0].status, 'antecipado');
}

// ── 3. Regressão estrutural: _orcSalvarOrcamentoImpl usa o motor central ─
{
  var srcSalvar = extractFn('_orcSalvarOrcamentoImpl');
  test('7. valorFinal é calculado via orcMotorPagamento (não mais uma 4ª fórmula duplicada em ponto flutuante)',
    /afterDisc\s*=\s*orcMotorPagamento\(/.test(srcSalvar), true);
  test('8. valorFinal nunca inclui a taxa de cartão (parcAtivo:false explícito) — é a base à vista, mesma que PDF/WhatsApp mostram como Total',
    /orcMotorPagamento\([^)]*parcAtivo\s*:\s*false/.test(srcSalvar), true);
}

// ── 4. orcCalcEntradaResto() — execução real, achado do smoke de produção
// (Rodada 6, 2026-08-09): usava c.finalPrice bruto (ignorando desconto
// condicional/PIX) e formatava sem maximumFractionDigits, o que exibia até
// 3 casas decimais quando finalPrice carregava resíduo de ponto flutuante.
{
  var FN4 = ['orcFmt', 'orcMotorPagamento', 'orcLerCondicoesPagamentoDOM', 'orcCalcEntradaResto'];
  var src4 = FN4.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN4.join(',') + '};';
  var modPath4 = path.join(__dirname, '_cartao_pix_entrada_resto_extracted.tmp.js');
  fs.writeFileSync(modPath4, src4);
  delete require.cache[require.resolve(modPath4)];

  global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }] };
  global.cfgLoad = function () { return JSON.parse(JSON.stringify(global.CFG_DEFAULT)); };

  var _elements4 = {};
  function makeEl4(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {} }, props || {}); }
  global.document = { getElementById: function (id) { return _elements4[id]; } };

  function resetEls4(finalPrice, entradaVal, opts) {
    opts = opts || {};
    global.window = { _orcCalc: { finalPrice: finalPrice } };
    _elements4 = {
      orcEntradaValor: makeEl4({ value: entradaVal == null ? '' : String(entradaVal) }),
      orcEntradaResto: makeEl4({}),
      orcDescCondToggle: makeEl4({ checked: !!opts.dcOn }),
      orcDescCond: makeEl4({ value: String(opts.dcPct || 0) }),
      orcPixDiscToggle: makeEl4({ checked: !!opts.pxOn }),
      orcPixDiscPct: makeEl4({ value: String(opts.pxPct || 0) }),
      orcParcToggle: makeEl4({ checked: false }),
      orcParcSel: { value: '1' }
    };
  }

  var mod4 = require(modPath4);

  resetEls4(779.37, 0, { pxOn: true, pxPct: 0.99 });
  mod4.orcCalcEntradaResto();
  test('9. achado real (smoke de produção): "Restante na retirada" aplica o desconto PIX de 0,99% já configurado no orçamento — R$771,65, NUNCA R$779,37 (valor bruto, ignorando o PIX)',
    _elements4.orcEntradaResto.textContent, 'R$ 771,65');

  resetEls4(779.37, 0, { pxOn: true, pxPct: 0.99 });
  mod4.orcCalcEntradaResto();
  test('10. achado real: nunca mostra 3 casas decimais (maximumFractionDigits ausente no bug original)',
    /,\d{2}$/.test(_elements4.orcEntradaResto.textContent), true);

  resetEls4(1000, 400, {});
  mod4.orcCalcEntradaResto();
  test('11. sem desconto/PIX ativo: entrada de R$400 sobre total de R$1000 deixa restante de R$600,00',
    _elements4.orcEntradaResto.textContent, 'R$ 600,00');
}

// ── 5. Regressão estrutural: bloco n===5 do orcStep() usa o motor central ─
// (Rodada 6, achado do smoke de produção 2026-08-09) — mesma classe de bug
// do item 4: "Valor a Receber" da tela "Confirmação de Pagamento" usava
// v.finalPrice bruto e tinha "R$ " duplicado (orcFmt já inclui o prefixo).
{
  var srcStep = extractFn('orcStep');
  test('12. "Valor a Receber" (orcPgtoValorDisplay) é calculado via orcMotorPagamento, não mais v.finalPrice bruto',
    /orcPgtoValorDisplay[\s\S]{0,80}=\s*orcFmt\(valorEfetivo\)/.test(srcStep) && /orcMotorPagamento\(v\.finalPrice\|\|0,\s*cond\)/.test(srcStep), true);
  test('13. nunca mais o prefixo duplicado "R$ "+orcFmt(...) (orcFmt já inclui "R$ ")',
    /orcPgtoValorDisplay[^\n]*=\s*'R\$ '\s*\+\s*orcFmt/.test(srcStep), false);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
