/**
 * test_orcamento_pdf_whatsapp.js
 * Testa as funções REAIS de PDF/WhatsApp/número do orçamento (extraídas de
 * index.html via contagem de chaves — mesma técnica de
 * test_inactivity_lock.js — não reimplementadas) com um fixture único de
 * homologação, para provar que ERP, PDF e WhatsApp usam a mesma fonte de
 * itens/prazo/responsável/validade/número e nunca divergem, e que a reserva
 * do número é atômica (sem colisão entre dois orçamentos concorrentes).
 *
 * Funções sob teste: orcSaudacaoPorHora, orcNormalizarTelefoneBR,
 * orcGetPrazoTexto, orcGetResponsavel, orcColetarItensDistribuidos,
 * orcProximoNumeroAtomico, orcObterNumeroOficial, orcLimparNumeroOficial,
 * orcGetValidadeDias, orcCalcCondicoesPagamento, orcEnviarOrcamentoWA.
 *
 * Uso: node scripts/test_orcamento_pdf_whatsapp.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
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
  // "async function X(" também bate com o marker "function X(" mais adiante
  // na mesma linha — recua até achar o início real da declaração.
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
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
  'msgResolverTemplate', 'msgTemplatesDefault',
  'orcProdutoNomeResolvido',
  'orcSaudacaoPorHora', 'orcSaudacaoHorario', 'orcNormalizarTelefoneBR',
  'orcGetPrazoTexto', 'orcGetResponsavel', 'orcItemDescricaoComercial', 'orcColetarItensDistribuidos',
  'orcProximoNumeroAtomico', 'orcObterNumeroOficial', 'orcLimparNumeroOficial',
  'orcGetValidadeDias', 'orcMotorPagamento',
  // SPRINT PRÉ-GO-LIVE, Bloco E — orcCalcCondicoesPagamento() agora usa o
  // motor comercial central (orcMotorComercial/orcDistribuirParcelas) em
  // vez do motor legado orcMotorPagamento — sem extrair as duas, qualquer
  // chamada real (inclusive dentro de orcEnviarOrcamentoWA) quebra com
  // ReferenceError.
  'orcDistribuirParcelas', 'orcMotorComercial',
  'orcLerCondicoesPagamentoDOM', 'orcCalcCondicoesPagamento',
  // HOTFIX pós-homologação (2026-08-10) — orcEnviarOrcamentoWA() não lê
  // mais o texto morto de orcFormaPgto; usa orcCondicaoPagamentoAtual()
  // (que por sua vez chama orcCondicaoLabelPorTipo()).
  'orcCondicaoLabelPorTipo', 'orcCondicaoPagamentoAtual',
  'orcEnviarOrcamentoWA'
];
var _msgPlaceholdersSrc = (function(){
  var marker = 'var MSG_TEMPLATES_PLACEHOLDERS = {';
  var start = html.indexOf(marker);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
})();
var src = _msgPlaceholdersSrc + FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
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
global._openedWins = [];
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
  global._openedWins.push(w);
  if (url && url !== 'about:blank' && url !== '') global._openedUrls.push(url);
  return w;
};
global.location = { origin: 'http://127.0.0.1:5050' };

// ── cfgLoad()/CFG_DEFAULT — usados por orcLerCondicoesPagamentoDOM() para
// ler a tabela de taxas de parcelamento (RODADA 6, seção 2, motor central
// de Cartão/PIX). Mesma forma real usada em produção (percentuais, não
// frações — 3x sem juros, 6x com 8% embutido, para exercitar as duas
// situações nos testes).
global.CFG_DEFAULT = { parcelamento: [
  { parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 0 }, { parcelas: 3, taxa: 0 },
  { parcelas: 6, taxa: 8 }, { parcelas: 12, taxa: 15 }
] };
global.cfgLoad = function () { return JSON.parse(JSON.stringify(global.CFG_DEFAULT)); };

// ── Mock do Firestore para orcProximoNumeroAtomico() — simula runTransaction
// com a MESMA semântica de atomicidade real: transações concorrentes contra
// o mesmo documento são serializadas (uma aplica, a próxima lê o valor já
// incrementado), nunca duas leem o mesmo "atual" e escrevem o mesmo
// "próximo" — é exatamente essa serialização que o Firestore real garante
// e que este mock existe para provar do lado do código-fonte extraído.
var _firestoreCounterDocs = {};
var _transactionQueue = Promise.resolve();
global._COL = 'erp_vr';
global._db = {
  collection: function (col) {
    return {
      doc: function (id) { return { _col: col, _id: id }; }
    };
  },
  runTransaction: function (fn) {
    // Enfileira — cada chamada só começa depois que a anterior terminou,
    // reproduzindo a serialização real de transações no mesmo documento.
    var result = _transactionQueue.then(function () {
      var ref = arguments; // não usado — closure já capturou "ref" via fn
      var txn = {
        get: function (r) {
          var key = r._col + '/' + r._id;
          var val = _firestoreCounterDocs[key];
          return Promise.resolve({
            exists: val !== undefined,
            data: function () { return val; }
          });
        },
        set: function (r, data) {
          var key = r._col + '/' + r._id;
          _firestoreCounterDocs[key] = data;
        }
      };
      return fn(txn);
    });
    _transactionQueue = result.catch(function () {}); // não trava a fila em erro
    return result;
  }
};
function resetFirestoreCounter() { _firestoreCounterDocs = {}; _transactionQueue = Promise.resolve(); }

// ── Fixture único de homologação — reaproveitado pela prévia obrigatória ──
function resetFixture() {
  _bodyClasses.length = 0;
  global.window._orcNumeroOficial = null;
  global.window._orcNumeroOficialPromise = null;
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
    orcDescCond: makeEl({ value: '0' }),
    orcPixDiscToggle: makeEl({ checked: false }),
    orcPixDiscPct: makeEl({ value: '0' }),
    orcParcToggle: makeEl({ checked: false }),
    orcParcSel: { value: '1' },
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
  global._openedWins = [];
  global._lastToast = null;
}

var mod = require(modPath);

// Rodada 2.1 (2026-08-08) — teste desatualizado: orcEnviarOrcamentoWA()
// (index.html) passou a exigir "await orcSalvarOrcamento()" (autosave
// obrigatório antes de qualquer envio — commit fba7ef5, já em master
// antes desta rodada) e esta suíte nunca extraiu/stubou essa função,
// então toda chamada real de WhatsApp falhava silenciosamente (try/catch
// engolia o ReferenceError) e a suíte quebrava tentando ler a URL nunca
// gerada. Não é um bug de produção — é a proteção real de autosave
// funcionando como projetado (nunca envia WhatsApp de um orçamento não
// persistido). Stub aqui reaproveita o número REAL já reservado por
// orcObterNumeroOficial() (extraída e testada nos testes 20-26), em vez
// de inventar um valor solto, para as asserções de número/mensagem
// continuarem validando o comportamento de verdade.
global.orcSalvarOrcamento = async function () {
  var num = await mod.orcObterNumeroOficial();
  return { num: num, id: 'ORC-' + num };
};

async function main() {
console.log('\n' + '='.repeat(64));
console.log(' test_orcamento_pdf_whatsapp.js');
console.log('='.repeat(64) + '\n');

console.log('── Saudação por horário (America/Sao_Paulo) ──────────────────\n');
await test('1. hora 8 -> Bom dia', function () { assertEq(mod.orcSaudacaoPorHora(8), 'Bom dia'); });
await test('2. hora 5 (limite inferior) -> Bom dia', function () { assertEq(mod.orcSaudacaoPorHora(5), 'Bom dia'); });
await test('3. hora 11 (limite superior) -> Bom dia', function () { assertEq(mod.orcSaudacaoPorHora(11), 'Bom dia'); });
await test('4. hora 12 (limite) -> Boa tarde', function () { assertEq(mod.orcSaudacaoPorHora(12), 'Boa tarde'); });
await test('5. hora 17 -> Boa tarde', function () { assertEq(mod.orcSaudacaoPorHora(17), 'Boa tarde'); });
await test('6. hora 18 (limite) -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(18), 'Boa noite'); });
await test('7. hora 23 -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(23), 'Boa noite'); });
await test('8. hora 0 (meia-noite) -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(0), 'Boa noite'); });
await test('9. hora 4 (antes das 5) -> Boa noite', function () { assertEq(mod.orcSaudacaoPorHora(4), 'Boa noite'); });
await test('10. orcSaudacaoHorario() usa o relógio real e retorna uma das 3 opções válidas', function () {
  var s = mod.orcSaudacaoHorario();
  assertTrue(['Bom dia', 'Boa tarde', 'Boa noite'].indexOf(s) >= 0, 'saudação inesperada: ' + s);
});

console.log('\n── Normalização de telefone BR (wa.me) ────────────────────────\n');
await test('11. DDD+número (11 dígitos) recebe DDI 55', function () { assertEq(mod.orcNormalizarTelefoneBR('16999123456'), '5516999123456'); });
await test('12. DDD+número (10 dígitos) recebe DDI 55', function () { assertEq(mod.orcNormalizarTelefoneBR('1633334444'), '551633334444'); });
await test('13. já com DDI 55 não duplica', function () { assertEq(mod.orcNormalizarTelefoneBR('5516999123456'), '5516999123456'); });
await test('14. formatado com máscara é normalizado corretamente', function () { assertEq(mod.orcNormalizarTelefoneBR('(16) 99912-3456'), '5516999123456'); });
await test('15. vazio retorna null (nunca abre wa.me sem destinatário)', function () { assertEq(mod.orcNormalizarTelefoneBR(''), null); });
await test('16. muito curto (inválido) retorna null', function () { assertEq(mod.orcNormalizarTelefoneBR('12345'), null); });
await test('17. muito longo (inválido) retorna null', function () { assertEq(mod.orcNormalizarTelefoneBR('551699912345678'), null); });
await test('18. null/undefined não derruba a função', function () { assertEq(mod.orcNormalizarTelefoneBR(null), null); assertEq(mod.orcNormalizarTelefoneBR(undefined), null); });

console.log('\n── Prazo / responsável / validade — fonte única ────────────────\n');
resetFixture(); resetFirestoreCounter();
await test('19. orcGetPrazoTexto() usa faixa min/max quando ambos preenchidos', function () {
  assertEq(mod.orcGetPrazoTexto(), 'De 5 a 7 dias úteis após aprovação e comprovante de pagamento');
});
await test('20. orcGetResponsavel() usa o vendedor cadastrado quando existe', function () {
  assertEq(mod.orcGetResponsavel('VR Marcas'), 'Marcos Andrade');
});
await test('21. orcGetResponsavel() cai para "Equipe {marca}" quando não há vendedor', function () {
  _elements.orcClientVendedor.value = '';
  assertEq(mod.orcGetResponsavel('VR Marcas'), 'Equipe VR Marcas');
  _elements.orcClientVendedor.value = 'Marcos Andrade';
});
await test('22. orcGetValidadeDias() lê o select (antes desconectado, agora com id)', function () {
  assertEq(mod.orcGetValidadeDias(), 10);
});

console.log('\n── Número oficial — reserva atômica, sem colisão ───────────────\n');
resetFixture(); resetFirestoreCounter();
await test('23. orcObterNumeroOficial() memoiza — chamadas repetidas no mesmo rascunho retornam o mesmo número', async function () {
  var n1 = await mod.orcObterNumeroOficial();
  var n2 = await mod.orcObterNumeroOficial();
  assertEq(n1, n2);
});
await test('24. número é sequencial via transação (não é mais baseado em Date.now()/Math.random())', async function () {
  resetFixture();
  var n1 = await mod.orcObterNumeroOficial();
  mod.orcLimparNumeroOficial();
  var n2 = await mod.orcObterNumeroOficial();
  assertTrue(/^\d{6}$/.test(n1), 'formato inesperado: ' + n1);
  assertEq(parseInt(n2, 10), parseInt(n1, 10) + 1, 'n1=' + n1 + ' n2=' + n2);
});
await test('25. CONCORRÊNCIA: duas reservas quase simultâneas (duas abas/usuários) nunca recebem o mesmo número', async function () {
  resetFixture(); resetFirestoreCounter();
  // Duas "sessões" independentes (cada uma com seu próprio estado de janela,
  // como duas abas do navegador) disparando orcObterNumeroOficial() ao
  // mesmo tempo — dispara as duas promises ANTES de dar await em qualquer
  // uma, para forçar a sobreposição real.
  window._orcNumeroOficial = null; window._orcNumeroOficialPromise = null;
  var p1 = mod.orcObterNumeroOficial();
  window._orcNumeroOficial = null; window._orcNumeroOficialPromise = null; // simula 2ª aba, memoização própria
  var p2 = mod.orcObterNumeroOficial();
  var results = await Promise.all([p1, p2]);
  assertTrue(results[0] !== results[1], 'COLISÃO: as duas reservas concorrentes receberam o mesmo número ' + results[0]);
});
await test('26. reserva falha (Firestore indisponível/permission-denied) propaga erro — NUNCA cai para um número local inseguro', async function () {
  resetFixture(); resetFirestoreCounter();
  var origDb = global._db;
  global._db = { collection: function () { return { doc: function () { return {}; } }; }, runTransaction: function () { return Promise.reject(new Error('permission-denied (simulado)')); } };
  var threw = false;
  try { await mod.orcObterNumeroOficial(); } catch (e) { threw = true; }
  global._db = origDb;
  assertTrue(threw, 'orcObterNumeroOficial() deveria ter rejeitado, não retornado um número de fallback');
});

console.log('\n── Itens redistribuídos — mesma fonte do PDF e do WhatsApp ────\n');
await test('27. 2 itens são coletados com descrição completa', function () {
  var itens = mod.orcColetarItensDistribuidos(3450.00);
  assertEq(itens.length, 2);
  assertEq(itens[0].desc, 'Painel ACM 200×100cm em ACM 4mm Prata — Corte a laser');
  assertEq(itens[1].desc, 'Letra Caixa em Acrílico 10mm Cristal');
});
await test('28. soma dos totais redistribuídos bate exatamente com o valor final (sem sobra/falta de centavos por arredondamento de exibição)', function () {
  var itens = mod.orcColetarItensDistribuidos(3450.00);
  var soma = itens.reduce(function (s, i) { return s + i.total; }, 0);
  assertTrue(approx(soma, 3450.00, 0.01), 'soma=' + soma);
});
await test('29. proporção respeita o peso bruto de cada item (item1 1500/4000, item2 2500/4000)', function () {
  var itens = mod.orcColetarItensDistribuidos(3450.00);
  assertTrue(approx(itens[0].total, 3450 * 1500 / 4000), 'item1.total=' + itens[0].total);
  assertTrue(approx(itens[1].total, 3450 * 2500 / 4000), 'item2.total=' + itens[1].total);
});

console.log('\n── RODADA 6, seção 2 — motor central de Cartão/PIX (centavos) ──\n');
await test('30. orcMotorPagamento() sem desconto/PIX/parcelamento devolve a base intacta', function () {
  var m = mod.orcMotorPagamento(1000, {});
  assertEq(m.afterPix, 1000);
  assertEq(m.totalComTaxa, 1000);
  assertEq(m.nParc, 1);
});
await test('31. orcMotorPagamento() aplica desconto condicional e depois PIX, em cima do já descontado (não do bruto)', function () {
  var m = mod.orcMotorPagamento(1000, { dcOn: true, dcPct: 10, pxOn: true, pxPct: 5 });
  assertEq(m.afterDescCond, 900);
  assertEq(m.afterPix, 855); // 900 * 0.95
});
await test('32. orcMotorPagamento() com parcelamento SEM taxa (3x) não altera o total, só divide', function () {
  var m = mod.orcMotorPagamento(900, { parcAtivo: true, nParc: 3, tabelaParcelamento: global.CFG_DEFAULT.parcelamento });
  assertEq(m.totalComTaxa, 900);
  assertEq(m.valorParcela, 300);
  assertTrue(m.semJuros);
});
await test('33. orcMotorPagamento() com parcelamento COM taxa (6x, 8%) soma a taxa ao total antes de dividir', function () {
  var m = mod.orcMotorPagamento(1000, { parcAtivo: true, nParc: 6, tabelaParcelamento: global.CFG_DEFAULT.parcelamento });
  assertEq(m.totalComTaxa, 1080); // 1000 * 1.08
  assertEq(m.valorParcela, 180); // 1080 / 6
  assertFalse(m.semJuros);
});
await test('34. orcMotorPagamento() nunca usa ponto flutuante cru — resultado sempre com exatamente 2 casas (centavo-preciso)', function () {
  var m = mod.orcMotorPagamento(333.33, { dcOn: true, dcPct: 7, pxOn: true, pxPct: 3, parcAtivo: true, nParc: 12, tabelaParcelamento: global.CFG_DEFAULT.parcelamento });
  ['afterDescCond', 'afterPix', 'totalComTaxa', 'valorParcela'].forEach(function (k) {
    var centavos = Math.round(m[k] * 100);
    assertTrue(Math.abs(m[k] * 100 - centavos) < 1e-9, k + '=' + m[k] + ' não é centavo-exato');
  });
});
// SPRINT PRÉ-GO-LIVE, Bloco E — este teste testava a REGRA ANTIGA (cartão
// 6x com a taxa real de 8% repassada ao cliente). A nova regra comercial
// definitiva do usuário substitui isso por completo: cartão só até 3x,
// SEMPRE sem juros — orcCalcCondicoesPagamento() agora usa o motor
// comercial central (orcMotorComercial), não mais orcMotorPagamento.
await test('35. orcCalcCondicoesPagamento() com "6x" selecionado (valor legado/fora da faixa nova) é CLAMPADO para 3x — nunca repassa 6x nem qualquer taxa real ao cliente', function () {
  resetFixture(); resetFirestoreCounter();
  _elements.orcParcToggle.checked = true;
  _elements.orcParcSel.value = '6';
  var cond = mod.orcCalcCondicoesPagamento(1000);
  var direto = mod.orcMotorComercial(1000, { pix: 0 });
  assertEq(cond.parcela.nParc, 3, 'nParc deveria ser clampado para 3, obtido ' + cond.parcela.nParc);
  assertEq(cond.parcela.valorParcela, direto.cartao[3].valorParcela);
  assertEq(cond.parcela.totalCents, direto.baseCents, 'cartão 3x nunca pode custar mais que a base (sem juros)');
  assertTrue(cond.parcela.semJuros, 'nova regra: cartão em até 3x é SEMPRE sem juros');
});
await test('35b. orcCalcCondicoesPagamento() com 2x/3x reais (dentro da nova faixa) nunca aplica juros — total do cartão é sempre igual à base', function () {
  resetFixture(); resetFirestoreCounter();
  _elements.orcParcToggle.checked = true;
  _elements.orcParcSel.value = '3';
  var cond = mod.orcCalcCondicoesPagamento(1000);
  assertEq(cond.parcela.nParc, 3);
  assertEq(cond.parcela.totalCents, 100000); // 1000,00 em centavos — nunca mais que a base
  assertTrue(cond.parcela.semJuros, true);
});
await test('36. orcCalcCondicoesPagamento() sem cartão ativo não gera objeto parcela (nunca mostra parcelamento indevido)', function () {
  resetFixture(); resetFirestoreCounter();
  var cond = mod.orcCalcCondicoesPagamento(1000);
  assertEq(cond.parcela, null);
});

console.log('\n── orcEnviarOrcamentoWA() — mensagem completa, encoding e telefone ─\n');
var urlGerada, textParam;
{
  resetFixture(); resetFirestoreCounter();
  await mod.orcEnviarOrcamentoWA();
  urlGerada = global._openedUrls[global._openedUrls.length - 1];

  await test('37. telefone válido gera exatamente 1 janela/URL (wa.me)', function () {
    assertEq(global._openedWins.length, 1);
    assertEq(global._openedUrls.length, 1);
    assertTrue(urlGerada.indexOf('https://wa.me/5516999123456?text=') === 0, 'URL: ' + urlGerada);
  });

  textParam = decodeURIComponent(urlGerada.split('?text=')[1]);
  await test('38. texto decodificado não contém caractere de substituição (�) nem HTML <br>', function () {
    assertFalse(textParam.indexOf('�') >= 0, 'contém replacement character');
    assertFalse(/<br\s*\/?>/i.test(textParam), 'contém <br> em vez de quebra de linha real');
  });
  await test('39. texto decodificado contém saudação + primeiro nome (sem "undefined"/"null")', function () {
    assertFalse(/undefined|null/.test(textParam));
    assertTrue(/^(Bom dia|Boa tarde|Boa noite), \*Fernanda\*!/.test(textParam), textParam.slice(0, 60));
  });
  await test('40. texto contém a marca emissora (VR Marcas, corpo sem classe "vitre")', function () {
    assertTrue(textParam.indexOf('*VR Marcas*') >= 0);
  });
  await test('41. texto contém o número oficial reservado (6 dígitos, não mais Date.now())', function () {
    assertTrue(/\*ORÇAMENTO Nº \d{6}\*/.test(textParam), textParam.slice(0, 120));
  });
  await test('42. texto contém os 2 itens numerados 01./02. com quantidade/unitário/subtotal', function () {
    assertTrue(textParam.indexOf('01. Painel ACM 200×100cm em ACM 4mm Prata — Corte a laser') >= 0);
    assertTrue(textParam.indexOf('02. Letra Caixa em Acrílico 10mm Cristal') >= 0);
    assertTrue(/Quantidade: 2/.test(textParam));
    assertTrue(/Quantidade: 5/.test(textParam));
  });
  await test('43. texto contém VALOR TOTAL igual ao finalPrice do fixture (R$ 3.450,00)', function () {
    assertTrue(textParam.indexOf('*VALOR TOTAL: R$ 3.450,00*') >= 0, textParam);
  });
  // HOTFIX pós-homologação (2026-08-10), P0.1/P0.3 — a mensagem não lê
  // mais o texto morto de #orcFormaPgto (sempre "PIX (100%)" por padrão
  // de HTML nunca escrito por nenhuma tela); mostra "Condição de
  // pagamento" com o padrão comercial real (50/50) via
  // orcCondicaoPagamentoAtual(), já que este fixture não tem KB_OS/OS
  // gerada — condição ainda não confirmada.
  await test('44. texto contém prazo, validade e condição de pagamento (mesma fonte do PDF)', function () {
    assertTrue(textParam.indexOf('*Prazo de produção:* De 5 a 7 dias úteis após aprovação e comprovante de pagamento') >= 0);
    assertTrue(textParam.indexOf('*Validade do orçamento:* 10 dias') >= 0);
    assertTrue(textParam.indexOf('*Condição de pagamento:* 50% no pedido e 50% na retirada do material') >= 0, textParam);
  });
  await test('45. texto assina com responsável e marca, sem nome fixo hardcoded', function () {
    assertTrue(textParam.indexOf('*Marcos Andrade*\n*VR Marcas*') >= 0);
  });
  await test('46. mensagem inteira não tem emoji (template padrão é livre de emoji)', function () {
    var temEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(textParam);
    assertFalse(temEmoji, 'emoji encontrado na mensagem: ' + textParam);
  });
  await test('47. URL foi codificada exatamente 1 vez (decode único recupera o texto original sem sobra de %25)', function () {
    assertFalse(/%[0-9A-F]{2}/.test(textParam) && textParam.indexOf('%25') >= 0, 'indício de dupla codificação (%25 residual)');
  });
}

console.log('\n── Telefone inválido nunca abre o wa.me (e nunca gasta uma reserva) ─\n');
await test('48. telefone vazio: mostra aviso e NÃO abre nenhuma janela', async function () {
  resetFixture(); resetFirestoreCounter();
  _elements.orcClientTel.value = '';
  await mod.orcEnviarOrcamentoWA();
  assertEq(global._openedWins.length, 0);
  assertTrue(!!global._lastToast && global._lastToast.kind === 'warn');
});
await test('49. telefone claramente inválido (poucos dígitos): mostra aviso e NÃO abre nenhuma janela', async function () {
  resetFixture(); resetFirestoreCounter();
  _elements.orcClientTel.value = '123';
  await mod.orcEnviarOrcamentoWA();
  assertEq(global._openedWins.length, 0);
});

console.log('\n── Marca Vitre — identidade correta na mensagem ────────────────\n');
await test('50. body.classList com "vitre" -> mensagem assina como Vitre', async function () {
  resetFixture(); resetFirestoreCounter();
  _bodyClasses.push('vitre');
  await mod.orcEnviarOrcamentoWA();
  var url = global._openedUrls[global._openedUrls.length - 1];
  var txt = decodeURIComponent(url.split('?text=')[1]);
  assertTrue(txt.indexOf('*Vitre*') >= 0);
  assertFalse(txt.indexOf('VR Marcas') >= 0);
});

console.log('\n── Sem nome de cliente — nunca gera saudação quebrada ──────────\n');
await test('51. nome vazio -> "Olá!" (nunca vírgula solta/undefined)', async function () {
  resetFixture(); resetFirestoreCounter();
  _elements.orcClientNome.value = '';
  await mod.orcEnviarOrcamentoWA();
  var url = global._openedUrls[global._openedUrls.length - 1];
  var txt = decodeURIComponent(url.split('?text=')[1]);
  assertTrue(txt.indexOf('Olá!\n\n') === 0, txt.slice(0, 30));
});

console.log('\n── Número igual entre chamadas WA/PDF no mesmo rascunho ────────\n');
await test('52. duas chamadas de orcObterNumeroOficial() dentro do mesmo rascunho (ex.: PDF depois WhatsApp) retornam o MESMO número', async function () {
  resetFixture(); resetFirestoreCounter();
  var nWA = await mod.orcObterNumeroOficial();
  var nPDF = await mod.orcObterNumeroOficial(); // 2ª "renderização" do mesmo rascunho
  assertEq(nWA, nPDF);
});

fs.unlinkSync(modPath);

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
}

main();
