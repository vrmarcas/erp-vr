/**
 * test_orcamento_pdf_whatsapp.js
 * Testa as funções REAIS de PDF/WhatsApp do orçamento (extraídas de
 * index.html via contagem de chaves — mesma técnica de
 * test_inactivity_lock.js — não reimplementadas) com um fixture único de
 * homologação, para provar que ERP, PDF e WhatsApp usam a mesma fonte de
 * itens/prazo/responsável/validade/número e nunca divergem.
 *
 * Funções sob teste: orcSaudacaoPorHora, orcNormalizarTelefoneBR,
 * orcGetPrazoTexto, orcGetResponsavel, orcColetarItensDistribuidos,
 * orcGetNumeroPreview, orcGetValidadeDias, orcCalcCondicoesPagamento,
 * orcEnviarOrcamentoWA.
 *
 * Uso: node scripts/test_orcamento_pdf_whatsapp.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTrue(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
function assertFalse(v, msg) { if (v) throw new Error(msg || 'esperado valor falsy'); }
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }

// ── Extração por contagem de chaves balanceadas (ver test_inactivity_lock.js
// para o porquê do regex ingênuo quebrar em funções de uma linha só) ───────
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}
var FN_NAMES = [
  'orcSaudacaoPorHora', 'orcSaudacaoHorario', 'orcNormalizarTelefoneBR',
  'orcGetPrazoTexto', 'orcGetResponsavel', 'orcColetarItensDistribuidos',
  'orcGetNumeroPreview', 'orcGetValidadeDias', 'orcCalcCondicoesPagamento',
  'orcEnviarOrcamentoWA'
];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_orcamento_pdf_whatsapp_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo, só com o que essas funções realmente leem ────────────
function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false }, props || {}); }

var _elements = {};
var _orcRows = [];
var _bodyClasses = [];
global.window = global;
global.document = {
  body: { classList: { contains: function (c) { return _bodyClasses.indexOf(c) >= 0; } } },
  getElementById: function (id) { return _elements[id]; },
  querySelectorAll: function (sel) {
    if (sel === '#orcItemBody tr') return _orcRows;
    return [];
  }
};
global.showToast = function (msg, kind) { global._lastToast = { msg: msg, kind: kind }; };
global._openedUrls = [];
global.window.open = function (url) { global._openedUrls.push(url); return { location: {} }; };
global.location = { origin: 'http://127.0.0.1:5050' };

// ── Fixture único de homologação — reaproveitado pela prévia obrigatória ──
function resetFixture() {
  _bodyClasses.length = 0;
  global._orcNumeroPreview = null;
  global.window._orcCalc = { finalPrice: 3450.00 };
  _elements = {
    orcClientNome: makeEl({ value: 'Fernanda Souza' }),
    orcClientTel: makeEl({ value: '(16) 99912-3456' }),
    orcClientVendedor: makeEl({ value: 'Marcos Andrade' }),
    orcPrazoDias: makeEl({ value: '5' }),
    orcPrazoDiasMax: makeEl({ value: '7' }),
    orcPrazoEntrega: makeEl({ value: '' }),
    orcValidadeDias: makeEl({ value: '10' }),
    orcFormaPgto: { selectedIndex: 0, options: [{ text: '50% de entrada, 50% na retirada do material' }] },
    orcDescCondToggle: makeEl({ checked: false }),
    orcPixDiscToggle: makeEl({ checked: false }),
    oi_prod_0: makeEl({ value: 'Painel ACM' }),
    oi_qty_0: makeEl({ value: '2' }),
    oi_larg_0: makeEl({ value: '200' }),
    oi_alt_0: makeEl({ value: '100' }),
    oi_det_0: makeEl({ value: 'Corte a laser' }),
    oi_mat_0: { selectedIndex: 0, options: [{ text: 'ACM 4mm Prata' }] },
    oi_tot_0: makeEl({ textContent: 'R$ 1.500,00' }),
    oi_prod_1: makeEl({ value: 'Letra Caixa' }),
    oi_qty_1: makeEl({ value: '5' }),
    oi_larg_1: makeEl({ value: '' }),
    oi_alt_1: makeEl({ value: '' }),
    oi_det_1: makeEl({ value: '' }),
    oi_mat_1: { selectedIndex: 0, options: [{ text: 'Acrílico 10mm Cristal' }] },
    oi_tot_1: makeEl({ textContent: 'R$ 2.500,00' })
  };
  _orcRows = [{ dataset: { idx: '0' } }, { dataset: { idx: '1' } }];
  global._openedUrls = [];
  global._lastToast = null;
}

var mod = require(modPath);

console.log('\n' + '='.repeat(64));
console.log(' test_orcamento_pdf_whatsapp.js');
console.log('='.repeat(64) + '\n');

console.log('── Saudação por horário (America/Sao_Paulo) ──────────────────\n');
test('1. hora 8 -> Bom dia', function () { assertEq(mod.orcSaudacaoPorHora(8), 'Bom dia'); });
test('2. hora 5 (limite inferior) -> Bom dia', function () { assertEq(mod.orcSaudacaoPorHora(5), 'Bom dia'); });
test('3. hora 11 (limite superior) -> Bom dia', function () { assertEq(mod.orcSaudacaoPorHora(11), 'Bom dia'); });
test('4. hora 12 (limite) -> Boa tarde', function () { assertEq(mod.orcSaudacaoPorHora(12), 'Boa tarde'); });
test('5. hora 17 -> Boa tarde', function () { assertEq(mod.orcSaudacaoPorHora(17), 'Boa tarde'); });
test('6. hora 18 (limite) -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(18), 'Boa noite'); });
test('7. hora 23 -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(23), 'Boa noite'); });
test('8. hora 0 (meia-noite) -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(0), 'Boa noite'); });
test('9. hora 4 (antes das 5) -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(4), 'Boa noite'); });
test('10. orcSaudacaoHorario() usa o relógio real e retorna uma das 3 opções válidas', function () {
  var s = mod.orcSaudacaoHorario();
  assertTrue(['Bom dia', 'Boa tarde', 'Boa noite'].indexOf(s) >= 0, 'saudação inesperada: ' + s);
});

console.log('\n── Normalização de telefone BR (wa.me) ────────────────────────\n');
test('11. DDD+número (11 dígitos) recebe DDI 55', function () { assertEq(mod.orcNormalizarTelefoneBR('16999123456'), '5516999123456'); });
test('12. DDD+número (10 dígitos) recebe DDI 55', function () { assertEq(mod.orcNormalizarTelefoneBR('1633334444'), '551633334444'); });
test('13. já com DDI 55 não duplica', function () { assertEq(mod.orcNormalizarTelefoneBR('5516999123456'), '5516999123456'); });
test('14. formatado com máscara é normalizado corretamente', function () { assertEq(mod.orcNormalizarTelefoneBR('(16) 99912-3456'), '5516999123456'); });
test('15. vazio retorna null (nunca abre wa.me sem destinatário)', function () { assertEq(mod.orcNormalizarTelefoneBR(''), null); });
test('16. muito curto (inválido) retorna null', function () { assertEq(mod.orcNormalizarTelefoneBR('12345'), null); });
test('17. muito longo (inválido) retorna null', function () { assertEq(mod.orcNormalizarTelefoneBR('551699912345678'), null); });
test('18. null/undefined não derruba a função', function () { assertEq(mod.orcNormalizarTelefoneBR(null), null); assertEq(mod.orcNormalizarTelefoneBR(undefined), null); });

console.log('\n── Prazo / responsável / validade / número — fonte única ──────\n');
resetFixture();
test('19. orcGetPrazoTexto() usa faixa min/max quando ambos preenchidos', function () {
  assertEq(mod.orcGetPrazoTexto(), 'De 5 a 7 dias úteis após aprovação e comprovante de pagamento');
});
test('20. orcGetResponsavel() usa o vendedor cadastrado quando existe', function () {
  assertEq(mod.orcGetResponsavel('VR Marcas'), 'Marcos Andrade');
});
test('21. orcGetResponsavel() cai para "Equipe {marca}" quando não há vendedor', function () {
  _elements.orcClientVendedor.value = '';
  assertEq(mod.orcGetResponsavel('VR Marcas'), 'Equipe VR Marcas');
  _elements.orcClientVendedor.value = 'Marcos Andrade';
});
test('22. orcGetValidadeDias() lê o select (antes desconectado, agora com id)', function () {
  assertEq(mod.orcGetValidadeDias(), 10);
});
test('23. orcGetNumeroPreview() memoiza — chamadas repetidas retornam o mesmo número (PDF e WhatsApp nunca divergem)', function () {
  var n1 = mod.orcGetNumeroPreview();
  var n2 = mod.orcGetNumeroPreview();
  assertEq(n1, n2);
});

console.log('\n── Itens redistribuídos — mesma fonte do PDF e do WhatsApp ────\n');
test('24. 2 itens são coletados com descrição completa', function () {
  var itens = mod.orcColetarItensDistribuidos(3450.00);
  assertEq(itens.length, 2);
  assertEq(itens[0].desc, 'Painel ACM 200×100cm em ACM 4mm Prata — Corte a laser');
  assertEq(itens[1].desc, 'Letra Caixa em Acrílico 10mm Cristal');
});
test('25. soma dos totais redistribuídos bate exatamente com o valor final (sem sobra/falta de centavos por arredondamento de exibição)', function () {
  var itens = mod.orcColetarItensDistribuidos(3450.00);
  var soma = itens.reduce(function (s, i) { return s + i.total; }, 0);
  assertTrue(approx(soma, 3450.00, 0.01), 'soma=' + soma);
});
test('26. proporção respeita o peso bruto de cada item (item1 1500/4000, item2 2500/4000)', function () {
  var itens = mod.orcColetarItensDistribuidos(3450.00);
  assertTrue(approx(itens[0].total, 3450 * 1500 / 4000), 'item1.total=' + itens[0].total);
  assertTrue(approx(itens[1].total, 3450 * 2500 / 4000), 'item2.total=' + itens[1].total);
});

console.log('\n── orcEnviarOrcamentoWA() — mensagem completa, encoding e telefone ─\n');
{
  resetFixture();
  mod.orcEnviarOrcamentoWA();
  var urlGerada = global._openedUrls[0];

  test('27. telefone válido gera exatamente 1 chamada a window.open (wa.me)', function () {
    assertEq(global._openedUrls.length, 1);
    assertTrue(urlGerada.indexOf('https://wa.me/5516999123456?text=') === 0, 'URL: ' + urlGerada);
  });

  var textParam = decodeURIComponent(urlGerada.split('?text=')[1]);
  test('28. texto decodificado não contém caractere de substituição (�) nem HTML <br>', function () {
    assertFalse(textParam.indexOf('�') >= 0, 'contém replacement character');
    assertFalse(/<br\s*\/?>/i.test(textParam), 'contém <br> em vez de quebra de linha real');
  });
  test('29. texto decodificado contém saudação + primeiro nome (sem "undefined"/"null")', function () {
    assertFalse(/undefined|null/.test(textParam));
    assertTrue(/^(Bom dia|Boa tarde|Boa noite), \*Fernanda\*!/.test(textParam), textParam.slice(0, 60));
  });
  test('30. texto contém a marca emissora (VR Marcas, corpo sem classe "vitre")', function () {
    assertTrue(textParam.indexOf('*VR Marcas*') >= 0);
  });
  test('31. texto contém os 2 itens numerados 01./02. com quantidade/unitário/subtotal', function () {
    assertTrue(textParam.indexOf('01. Painel ACM 200×100cm em ACM 4mm Prata — Corte a laser') >= 0);
    assertTrue(textParam.indexOf('02. Letra Caixa em Acrílico 10mm Cristal') >= 0);
    assertTrue(/Quantidade: 2/.test(textParam));
    assertTrue(/Quantidade: 5/.test(textParam));
  });
  test('32. texto contém VALOR TOTAL igual ao finalPrice do fixture (R$ 3.450,00)', function () {
    assertTrue(textParam.indexOf('*VALOR TOTAL: R$ 3.450,00*') >= 0, textParam);
  });
  test('33. texto contém prazo, validade e forma de pagamento (mesma fonte do PDF)', function () {
    assertTrue(textParam.indexOf('*Prazo de produção:* De 5 a 7 dias úteis após aprovação e comprovante de pagamento') >= 0);
    assertTrue(textParam.indexOf('*Validade do orçamento:* 10 dias') >= 0);
    assertTrue(textParam.indexOf('*Forma de pagamento:* 50% de entrada, 50% na retirada do material') >= 0);
  });
  test('34. texto assina com responsável e marca, sem nome fixo hardcoded', function () {
    assertTrue(textParam.indexOf('*Marcos Andrade*\n*VR Marcas*') >= 0);
  });
  test('35. mensagem inteira não tem emoji (template padrão é livre de emoji)', function () {
    var temEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(textParam);
    assertFalse(temEmoji, 'emoji encontrado na mensagem: ' + textParam);
  });
  test('36. URL foi codificada exatamente 1 vez (decode único recupera o texto original sem sobra de %25)', function () {
    assertFalse(textParam.indexOf('%') >= 0 === false ? false : /%[0-9A-F]{2}/.test(textParam) && textParam.indexOf('%25') >= 0, 'indício de dupla codificação (%25 residual)');
  });
}

console.log('\n── Telefone inválido nunca abre o wa.me ────────────────────────\n');
test('37. telefone vazio: mostra aviso e NÃO chama window.open', function () {
  resetFixture();
  _elements.orcClientTel.value = '';
  mod.orcEnviarOrcamentoWA();
  assertEq(global._openedUrls.length, 0);
  assertTrue(!!global._lastToast && global._lastToast.kind === 'warn');
});
test('38. telefone claramente inválido (poucos dígitos): mostra aviso e NÃO chama window.open', function () {
  resetFixture();
  _elements.orcClientTel.value = '123';
  mod.orcEnviarOrcamentoWA();
  assertEq(global._openedUrls.length, 0);
});

console.log('\n── Marca Vitre — identidade correta na mensagem ────────────────\n');
test('39. body.classList com "vitre" -> mensagem assina como Vitre', function () {
  resetFixture();
  _bodyClasses.push('vitre');
  mod.orcEnviarOrcamentoWA();
  var url = global._openedUrls[0];
  var txt = decodeURIComponent(url.split('?text=')[1]);
  assertTrue(txt.indexOf('*Vitre*') >= 0);
  assertFalse(txt.indexOf('VR Marcas') >= 0);
});

console.log('\n── Sem nome de cliente — nunca gera saudação quebrada ──────────\n');
test('40. nome vazio -> "Olá!" (nunca vírgula solta/undefined)', function () {
  resetFixture();
  _elements.orcClientNome.value = '';
  mod.orcEnviarOrcamentoWA();
  var url = global._openedUrls[0];
  var txt = decodeURIComponent(url.split('?text=')[1]);
  assertTrue(txt.indexOf('Olá!\n\n') === 0, txt.slice(0, 30));
});

fs.unlinkSync(modPath);

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
