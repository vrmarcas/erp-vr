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
  // SPRINT PRÉ-GO-LIVE, Bloco F (gap remanescente da homologação) —
  // achado real MAIS PROFUNDO encontrado ao corrigir o "Valor a Receber"
  // não atualizar ao trocar de Forma de Pagamento: esta linha de
  // parcelamento só é mostrada quando o método selecionado é Cartão/Link
  // (nunca PIX), mas continuava aplicando o desconto de "Desconto no
  // PIX" (cond.pxOn) mesmo assim — um desconto cujo próprio rótulo diz
  // "Aplica desconto se pagamento for feito via PIX", sendo aplicado a
  // uma simulação de pagamento NO CARTÃO. Corrigido para nunca aplicar
  // PIX aqui (pxOn forçado false) — 1000/3, sem nenhum desconto, dá
  // R$333,33 × 3 = R$999,99 (o total reconciliado com a parcela já
  // arredondada, nunca duas contas que divergem entre si).
  test('4. achado real corrigido: desconto de "PIX" NUNCA se aplica na simulação de parcelamento no CARTÃO (são condições mutuamente exclusivas) — 1000/3 sem desconto = 3x de R$333,33 (total: R$999,99)',
    _elements.orcSimParcelaDisplay.textContent, '3× de R$ 333,33 (total: R$ 999,99)');
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
// SPRINT PRÉ-GO-LIVE, Bloco E — nova regra comercial definitiva: o motor
// LEGADO (orcMotorPagamento, que aplicava a taxa real do cartão e o
// desconto PIX condicionado ao toggle) foi substituído pelo motor
// comercial central único (orcMotorComercial) para o valorFinal
// persistido — cartão em até 3x é SEMPRE sem juros, e o PIX NUNCA mais é
// subtraído automaticamente daqui (é uma alternativa, só vira desconto
// real se o cliente de fato escolher pagar via PIX).
{
  var srcSalvar = extractFn('_orcSalvarOrcamentoImpl');
  test('7. valorFinal é calculado via orcMotorComercial (Bloco E), não mais orcMotorPagamento (motor legado com taxa real) nem uma 4ª fórmula duplicada em ponto flutuante',
    /afterDisc\s*=\s*orcMotorComercial\(/.test(srcSalvar), true);
  test('8. valorFinal só é reduzido pelo desconto condicional (dcOn) quando ativo — PIX nunca mais é subtraído automaticamente (não existe mais gate pxOn/pxPct dentro do cálculo de afterDisc)',
    /baseAposCondSalvar\s*=\s*dcOn\s*\?\s*c\.finalPrice\*\(1-dcPct\/100\)/.test(srcSalvar), true);
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
// SPRINT PRÉ-GO-LIVE, Bloco F (gap remanescente) — a conta em si saiu de
// orcStep() e virou orcPgtoAtualizarValorReceber(), uma fonte única
// também reusada ao trocar Forma de Pagamento/parcelas (achado real
// mais recente: trocar de PIX para Cartão não atualizava mais nada,
// porque o cálculo só rodava uma vez, na entrada da etapa).
{
  var srcStep = extractFn('orcStep');
  test('12. orcStep() (n===5) delega o cálculo do "Valor a Receber" para a fonte única orcPgtoAtualizarValorReceber() — nunca mais uma conta própria e travada no momento de abrir a etapa',
    /if \(n===5\)[\s\S]{0,600}orcPgtoAtualizarValorReceber\(\)/.test(srcStep), true);

  var srcRecv = extractFn('orcPgtoAtualizarValorReceber');
  test('13. orcPgtoAtualizarValorReceber() usa o motor central (orcMotorPagamento), não v.finalPrice bruto',
    /orcMotorPagamento\(v\.finalPrice\|\|0,\s*motorCond\)/.test(srcRecv), true);
  test('14. nunca o prefixo duplicado "R$ "+orcFmt(...) (orcFmt já inclui "R$ ")',
    /orcPgtoValorDisplay[^\n]*=\s*'R\$ '\s*\+\s*orcFmt/.test(srcRecv), false);
}

// ── 6. orcPagtoTipoSel() — execução real, achado do smoke de produção
// (2026-08-09): metade=(valorTotal/2) em ponto flutuante direto, com
// `.toFixed(2)` (campo real gravado no CR/OS) e `.toLocaleString(...)`
// (texto ao lado) arredondando o MESMO número de forma diferente no
// caso-limite ",xx5" — campo mostrava R$385,82, texto mostrava R$385,83,
// para o mesmo orçamento de R$771,65.
{
  var FN6 = ['orcPagtoTipoSel'];
  var src6 = FN6.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN6.join(',') + '};';
  var modPath6 = path.join(__dirname, '_cartao_pix_5050_extracted.tmp.js');
  fs.writeFileSync(modPath6, src6);
  delete require.cache[require.resolve(modPath6)];

  function makeEl6(props) { return Object.assign({ value: '', textContent: '', style: {}, dataset: {} }, props || {}); }
  var _elements6 = {};
  global.document = {
    getElementById: function (id) { return _elements6[id]; },
    querySelectorAll: function () { return { forEach: function () {} }; }
  };
  global._orcPagtoId = 'orc1';
  global.orcGetEnviados = function () { return [{ id: 'orc1', valorFinal: 771.65 }]; };

  _elements6 = {
    pgtoEntradaBox: makeEl6({}),
    pgtoEntradaVal: makeEl6({}),
    pgtoEntradaPct: makeEl6({})
  };
  var btn6 = { style: {}, dataset: { tipo: '50-50' } };

  var mod6 = require(modPath6);
  mod6.orcPagtoTipoSel(btn6);

  test('15. achado real (smoke de produção): campo de entrada 50/50 (valor de fato gravado no CR/OS) mostra R$385,83, NUNCA R$385,82 (ponto flutuante direto de 771.65/2)',
    _elements6.pgtoEntradaVal.value, '385.83');
  test('16. o texto de apoio ao lado nunca diverge do campo — ambos vêm do mesmo cálculo em centavos',
    _elements6.pgtoEntradaPct.textContent, '= 50% do total — corresponde a R$ 385,83');
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
