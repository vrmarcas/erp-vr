/**
 * test_sprint_pregolive_blocoEI_pdf_whatsapp_semjuros_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Blocos E + I — nova regra comercial definitiva do
 * usuário: o preço principal mostrado ao cliente é o pagamento no CARTÃO
 * em até 3x SEM JUROS (nunca a taxa real da operadora, 2,99%/3,99%,
 * repassada ao cliente) e o PIX é SEMPRE mostrado como alternativa, nunca
 * mais atrás de um toggle "Sim/Não" (removido da UI — ver bloco
 * "PARCELAMENTO NO CARTÃO"/"DESCONTO PIX" no HTML, ~linha 3235).
 *
 * Este arquivo prova, com execução REAL das funções extraídas de
 * index.html (nunca reimplementadas), que:
 *   1. orcLerCondicoesPagamentoDOM()/orcCalcCondicoesPagamento() agora
 *      usam o motor comercial central (orcMotorComercial) — cartão
 *      1x/2x/3x sempre igual à base (sem juros), nunca mais a taxa real.
 *   2. Um valor de parcelas fora da nova faixa (ex.: "6x", possível em
 *      registros salvos ANTES desta rodada) é CLAMPADO para 3x — nunca
 *      quebra nem repassa taxa.
 *   3. PIX nunca é aplicado duas vezes (a base já com desconto condicional
 *      é usada uma única vez para calcular o valor com PIX).
 *   4. O texto do WhatsApp NUNCA mais contém "acréscimo", "taxa" ou
 *      "juros embutido" — e a linha de PIX aparece SEMPRE que há um
 *      percentual configurado, mesmo sem nenhum elemento de toggle no DOM
 *      (prova de que o código não lê mais orcPixDiscToggle para decidir
 *      se mostra o PIX).
 *   5. O PDF A4 (VR e Vitre) segue a mesma regra: "Total Geral" = preço
 *      no cartão (sem PIX embutido), PIX sempre listado como alternativa
 *      quando configurado, nunca o texto "parcelas com acréscimo", e o
 *      logo de cada marca é maior que antes desta rodada.
 *   6. orcToggleParc() pré-seleciona 3x por padrão no novo seletor
 *      sempre-visível.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoEI_pdf_whatsapp_semjuros_2026-08-09.js
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
function assertTrue(desc, v) {
  if (v) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + ' — esperado valor truthy'); failed++; }
}
function assertFalse(desc, v) {
  if (!v) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + ' — esperado valor falsy'); failed++; }
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

console.log('\n' + '='.repeat(72));
console.log(' SPRINT PRÉ-GO-LIVE, Blocos E+I — cartão sem juros + PIX sempre (PDF/WA)');
console.log('='.repeat(72) + '\n');

// ── 1-2. Regressão estrutural: motor comercial central conectado ────────
{
  var srcCond = extractFn('orcCalcCondicoesPagamento');
  assertTrue('1. orcCalcCondicoesPagamento() usa orcMotorComercial (motor central único), não mais orcMotorPagamento (legado, taxa real)',
    /orcMotorComercial\(/.test(srcCond));
  assertFalse('2. orcCalcCondicoesPagamento() não chama mais orcMotorPagamento (motor legado removido deste caminho)',
    /orcMotorPagamento\(/.test(srcCond));

  var srcWA = extractFn('orcEnviarOrcamentoWA');
  assertFalse('3. orcEnviarOrcamentoWA() nunca mais escreve o texto "(parcelas com acréscimo)"',
    /parcelas com acr[eé]scimo/i.test(srcWA));
  assertFalse('4. orcEnviarOrcamentoWA() nunca condiciona a linha de PIX a "!dcOn" escondendo-a (PIX é sempre alternativa)',
    /pxOnWA[\s\S]{0,40}!dcOnWA/.test(srcWA));

  var srcPDF = extractFn('orcImprimirOrcamentoPDF');
  assertFalse('5. orcImprimirOrcamentoPDF() nunca mais escreve o texto "(parcelas com acréscimo)"',
    /parcelas com acr[eé]scimo/i.test(srcPDF));
  assertTrue('6. orcImprimirOrcamentoPDF() logo VR Marcas está maior (height >= 70px, era 52px)',
    /vr-marcas-logo\.png[\s\S]{0,100}height:(7[0-9]|[8-9][0-9])px/.test(srcPDF));
  assertTrue('7. orcImprimirOrcamentoPDF() logo Vitre está maior (height >= 55px, era 40px)',
    /vitre-logo\.png[\s\S]{0,100}height:(5[5-9]|[6-9][0-9])px/.test(srcPDF));
}

// ── 8-9. orcToggleParc() pré-seleciona 3x por padrão ─────────────────────
{
  var src = [extractFn('orcToggleParc'), extractFn('orcRefreshFinalPrice'),
    'module.exports = { orcToggleParc: orcToggleParc };'].join('\n\n');
  var modPath = path.join(__dirname, '_blocoEI_toggleparc_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  var _els = {
    orcParcToggle: { checked: true },
    orcParcFields: { style: {} },
    orcParcSel: { options: [], innerHTML: '', value: '' }
  };
  // simula document.createElement/appendChild reais o bastante para o
  // populate do <select>
  var _optStore = [];
  _els.orcParcSel = {
    get options() { return _optStore; },
    set innerHTML(v) { if (v === '') _optStore = []; },
    get innerHTML() { return _optStore.length ? 'x' : ''; },
    appendChild: function (opt) { _optStore.push(opt); },
    value: ''
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    createElement: function () { var o = {}; return o; }
  };
  global.window = { _orcCalc: {} }; // orcRefreshFinalPrice sai cedo (sem finalPrice) — não precisamos do motor aqui
  global.orcLerCondicoesPagamentoDOM = function () { return {}; };

  var mod = require(modPath);
  mod.orcToggleParc();
  // orcParcSel.value é setado por atribuição direta no código real
  // (sel.value='3') — nosso stub de elemento aceita e reflete essa
  // atribuição normalmente (propriedade comum, não getter/setter).
  test('8. orcToggleParc() popula o select com exatamente 3 opções (1x/2x/3x — nunca mais até 12x)', _optStore.length, 3);
  test('9. orcToggleParc() pré-seleciona "3" (3x sem juros) por padrão, conforme a nova regra comercial', _els.orcParcSel.value, '3');
  try { fs.unlinkSync(modPath); } catch (e) {}
}

// ── 10-16. Execução real: orcCalcCondicoesPagamento sem juros/clamp/PIX único ──
{
  var FN = ['orcDistribuirParcelas', 'orcMotorComercial', 'orcLerCondicoesPagamentoDOM', 'orcCalcCondicoesPagamento'];
  var src = FN.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN.join(',') + '};';
  var modPath = path.join(__dirname, '_blocoEI_condicoes_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  function makeEl(props) { return Object.assign({ value: '', checked: false }, props || {}); }
  var _els = {};
  global.document = { getElementById: function (id) { return _els[id]; } };
  global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 3.99 }] };
  global.cfgLoad = function () { return {}; };

  function reset(opts) {
    opts = opts || {};
    _els = {
      orcDescCondToggle: makeEl({ checked: !!opts.dcOn }),
      orcDescCond: makeEl({ value: String(opts.dcPct || 0) }),
      orcPixDiscToggle: makeEl({ checked: true }),
      orcPixDiscPct: makeEl({ value: String(opts.pxPct || 0) }),
      orcParcToggle: makeEl({ checked: true }),
      orcParcSel: makeEl({ value: String(opts.nParc || 3) })
    };
  }
  var mod = require(modPath);

  // GO-LIVE FINAL 2026-08-12, seção 4 — mudança de regra deliberada,
  // confirmada em produção: o Bloco E fazia a VR absorver a taxa da
  // maquininha silenciosamente (cartão sempre = base, em qualquer
  // parcela). A regra nova é o oposto — "sem juros" = sem juros
  // VISÍVEIS, mas a taxa real É embutida no preço mostrado ao cliente.
  reset({ nParc: 1 });
  var m1 = mod.orcCalcCondicoesPagamento(1000);
  test('10. cartão 1x = MESMA base (taxa de 1x é 0% no fixture — nunca há o que embutir)', m1.cartao[1].totalCents, 100000);
  test('11. GO-LIVE FINAL — cartão 2x EMBUTE a taxa real (2,99%): 100000/(1-0,0299) = 103082', m1.cartao[2].totalCents, 103082);
  test('12. GO-LIVE FINAL — cartão 3x EMBUTE a taxa real (3,99%): 100000/(1-0,0399) = 104156', m1.cartao[3].totalCents, 104156);

  reset({ nParc: 6 });
  var m2 = mod.orcCalcCondicoesPagamento(1000);
  test('13. achado real: nParc=6 (legado/fora da nova faixa) é CLAMPADO para 3 — nunca quebra, nunca repassa taxa de 6x',
    m2.parcela.nParc, 3);
  assertTrue('14. parcela sempre semJuros:true com a nova regra', m2.parcela.semJuros === true);

  reset({ dcOn: true, dcPct: 10, pxPct: 5 });
  var m3 = mod.orcCalcCondicoesPagamento(1000); // baseEfetiva já reduzida pelo chamador em produção — aqui simulamos exatamente essa base
  // GO-LIVE FINAL 2026-08-12, seção 5 — PIX (override manual de 5%, já
  // que a sugestão em 3x seria 3,99%) aplica UMA única vez, mas agora
  // sobre o preço do CARTÃO (com taxa embutida — 104156 cents), não mais
  // sobre a base crua: 104156×(1-0,05) = 98948 cents = R$989,48. Ainda
  // aplicado uma única vez (nunca dc dobrado nem pix dobrado).
  test('15. PIX aplicado UMA única vez, sobre o preço do cartão (taxa embutida): 104156×(1-0,05) = R$989,48',
    m3.pixTotal, 989.48);
  // GO-LIVE FINAL 2026-08-12, seção 5 — "sem percentual PIX configurado"
  // (pxPct=0 explícito) é tratado como override para 0% de desconto —
  // resultado é o preço do cartão sem desconto adicional (R$1.041,56 em
  // 3x com taxa de 3,99%), não mais a base crua. Na UI real, o campo
  // nunca fica "0 sem configurar" — orcPixSincronizarSugestao sempre
  // pré-preenche com a sugestão (ver test_orc_pix_sugestao_override).
  test('16. GO-LIVE FINAL — pxPct=0 explícito = cartão sem desconto adicional (R$1.041,56 em 3x, taxa 3,99%), nunca mais a base crua',
    (function () { reset({ nParc: 3 }); return mod.orcCalcCondicoesPagamento(1000).pixTotal; })(), 1041.56);

  try { fs.unlinkSync(modPath); } catch (e) {}
}

// ── 17-27. orcEnviarOrcamentoWA() — texto real, sem "acréscimo"/"taxa", PIX sempre ──
{
  var FN_NAMES = [
    'orcSaudacaoPorHora', 'orcSaudacaoHorario', 'orcNormalizarTelefoneBR',
    'orcGetPrazoTexto', 'orcGetResponsavel', 'orcColetarItensDistribuidos',
    'orcGetValidadeDias', 'orcDistribuirParcelas', 'orcMotorComercial',
    'orcLerCondicoesPagamentoDOM', 'orcCalcCondicoesPagamento',
    // HOTFIX pós-homologação (2026-08-10) — orcEnviarOrcamentoWA() usa
    // orcCondicaoPagamentoAtual() em vez do texto morto de orcFormaPgto.
    'orcCondicaoLabelPorTipo', 'orcCondicaoPagamentoAtual',
    'orcEnviarOrcamentoWA'
  ];
  var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
  var modPath = path.join(__dirname, '_blocoEI_wa_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false }, props || {}); }
  var _elements = {};
  var _orcRows = [];
  var _bodyClasses = [];
  global.window = global;
  global.document = {
    body: { classList: { contains: function (c) { return _bodyClasses.indexOf(c) >= 0; } } },
    getElementById: function (id) { return _elements[id]; },
    querySelectorAll: function (sel) { return sel === '#orcItemBody tr' ? _orcRows : []; }
  };
  global.showToast = function () {};
  global._openedUrls = [];
  function makeFakeWin() {
    var w = { closed: false, location: {}, close: function () { w.closed = true; } };
    Object.defineProperty(w.location, 'href', {
      set: function (v) { global._openedUrls.push(v); },
      get: function () { return global._openedUrls[global._openedUrls.length - 1]; }
    });
    return w;
  }
  global.window.open = function (url) {
    var w = makeFakeWin();
    if (url && url !== 'about:blank' && url !== '') global._openedUrls.push(url);
    return w;
  };
  global.location = { origin: 'http://127.0.0.1:5050' };
  global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 3.99 }] };
  global.cfgLoad = function () { return JSON.parse(JSON.stringify(global.CFG_DEFAULT)); };

  var mod = require(modPath);
  global.orcSalvarOrcamento = async function () { return { num: '000123', id: 'ORC-000123' }; };

  function resetFixture(opts) {
    opts = opts || {};
    _bodyClasses.length = 0;
    global.window._orcCalc = { finalPrice: 1000.00 };
    _elements = {
      orcClientNome: makeEl({ value: 'Carlos Lima' }),
      orcClientTel: makeEl({ value: '16999123456' }),
      orcClientVendedor: makeEl({ value: 'Juliana Prado' }),
      orcPrazoDias: makeEl({ value: '3' }),
      orcPrazoDiasMax: makeEl({ value: '5' }),
      orcPrazoEntrega: makeEl({ value: '' }),
      orcValidadeDias: makeEl({ value: '7' }),
      orcFormaPgto: { selectedIndex: 0, options: [{ text: '50% de entrada, 50% na retirada do material' }] },
      orcDescCondToggle: makeEl({ checked: false }),
      orcDescCond: makeEl({ value: '0' }),
      orcPixDiscPct: makeEl({ value: String(opts.pxPct != null ? opts.pxPct : 0) }),
      orcParcSel: { value: String(opts.nParc || 3) },
      oi_prod_0: makeEl({ value: 'Placa ACM' }),
      oi_qty_0: makeEl({ value: '1' }),
      oi_larg_0: makeEl({ value: '' }), oi_alt_0: makeEl({ value: '' }), oi_det_0: makeEl({ value: '' }),
      oi_mat_0: { selectedIndex: 0, options: [{ text: 'ACM 3mm' }] },
      oi_tot_0: makeEl({ textContent: 'R$ 1.000,00' })
    };
    // achado investigado pelo usuário: NÃO existe mais nenhum elemento
    // orcPixDiscToggle/orcParcToggle no DOM — prova de que o código NÃO
    // depende mais deles para decidir se mostra PIX/parcelamento.
    _orcRows = [{ dataset: { idx: '0' } }];
    global._openedUrls = [];
  }

  resetFixture({ pxPct: 4, nParc: 3 });
  var textParam;
  (async function () {
    await mod.orcEnviarOrcamentoWA();
    var url = global._openedUrls[global._openedUrls.length - 1];
    textParam = decodeURIComponent(url.split('?text=')[1]);

    assertFalse('17. texto NUNCA contém "acréscimo" (achado: código antigo dizia "(parcelas com acréscimo)" quando a taxa real do cartão era usada)',
      /acr[eé]scimo/i.test(textParam));
    assertFalse('18. texto NUNCA contém a palavra "taxa" (custo interno do cartão, nunca exposto ao cliente)',
      /taxa/i.test(textParam));
    assertFalse('19. texto NUNCA contém "juros embutido"', /juros embutido/i.test(textParam));
    assertTrue('20. texto contém a linha de PIX SEMPRE que há percentual configurado — mesmo sem nenhum elemento orcPixDiscToggle no DOM (prova real de que não há mais toggle gate)',
      textParam.indexOf('*Desconto PIX:*') >= 0);
    assertTrue('21. linha de PIX mostra o percentual configurado (4%) e o valor com desconto',
      /\*Desconto PIX:\* 4% de desconto/.test(textParam));
    assertTrue('22. linha de parcelamento (3x) diz "sem juros", nunca "com acréscimo"',
      /\*Parcelamento:\* em até 3x de R\$ [\d.,]+ sem juros/.test(textParam));
    assertTrue('23. VALOR TOTAL é o preço no cartão (R$ 1.000,00) — não o valor já reduzido pelo PIX (R$960,00)',
      textParam.indexOf('*VALOR TOTAL: R$ 1.000,00*') >= 0);

    // Cenário 1x — a linha de "Parcelamento" não deve aparecer (1x é só o
    // Total, não uma oferta de parcelamento à parte), mas o PIX continua sempre.
    resetFixture({ pxPct: 2, nParc: 1 });
    await mod.orcEnviarOrcamentoWA();
    var url2 = global._openedUrls[global._openedUrls.length - 1];
    var txt2 = decodeURIComponent(url2.split('?text=')[1]);
    assertFalse('24. com 1x selecionado, a linha "*Parcelamento:*" não aparece (nada a parcelar)', /\*Parcelamento:\*/.test(txt2));
    assertTrue('25. mesmo com 1x selecionado, o PIX continua SEMPRE aparecendo como alternativa', /\*Desconto PIX:\*/.test(txt2));

    // Cenário sem PIX configurado (percentual 0) — linha de PIX não aparece
    // (nada a oferecer), mas nunca por causa de um toggle desligado.
    resetFixture({ pxPct: 0, nParc: 3 });
    await mod.orcEnviarOrcamentoWA();
    var url3 = global._openedUrls[global._openedUrls.length - 1];
    var txt3 = decodeURIComponent(url3.split('?text=')[1]);
    assertFalse('26. sem percentual PIX configurado (0%), a linha de PIX não aparece (nada configurado, não porque foi "desligada")', /\*Desconto PIX:\*/.test(txt3));
    assertTrue('27. mesmo sem PIX, o parcelamento em 3x sem juros continua aparecendo normalmente', /\*Parcelamento:\* em até 3x[\s\S]*sem juros/.test(txt3));

    try { fs.unlinkSync(modPath); } catch (e) {}

    console.log('\n' + '='.repeat(72));
    console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
    console.log('='.repeat(72) + '\n');
    if (failed > 0) process.exitCode = 1;
  })();
}
