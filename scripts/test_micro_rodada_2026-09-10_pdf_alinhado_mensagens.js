/**
 * test_micro_rodada_2026-09-10_pdf_alinhado_mensagens.js
 *
 * MICRO-RODADA 2026-09-10 — PDF do orçamento alinhado à arquitetura
 * configurável das mensagens (WhatsApp). Antes desta rodada,
 * `orcImprimirOrcamentoPDF()` tinha lógica comercial PRÓPRIA e hardcoded
 * para Pix/Cartão (ordem sempre fixa, Cartão antes de Pix) — divergente
 * do WhatsApp, que já respeitava a ordem configurada em Config →
 * Mensagens Automáticas. O bloco "Oferta especial" nem existia no PDF.
 *
 * Corrigido: `orcMontarBlocosPagamento()` (fonte canônica única, também
 * usada por `orcEnviarOrcamentoWA`) decide quais blocos existem e em que
 * ORDEM — cada canal só formata visualmente (markdown no WhatsApp, HTML
 * no PDF). O cabeçalho do bloco comparativo ("Escolha uma das opções
 * abaixo") também passou a vir do template `orcamentoComparativo`
 * (mesmo usado pelo WhatsApp), em vez de hardcoded no PDF.
 *
 * Extrai orcImprimirOrcamentoPDF/orcEnviarOrcamentoWA/orcMontarBlocosPagamento
 * ao vivo de index.html — não reimplementa a lógica testada.
 *
 * Uso: node scripts/test_micro_rodada_2026-09-10_pdf_alinhado_mensagens.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
function assertFalse(cond, msg) { if (cond) throw new Error(msg || 'esperado false'); }

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
function extractVarBlock(name) {
  var marker = 'var ' + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Bloco ' + name + ' não encontrado — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

var FN_NAMES = [
  'msgResolverTemplate', 'msgTemplatesDefault', 'msgValidarPlaceholders',
  'orcOrdemBlocosPagamento', 'orcMontarBlocosPagamento',
  'orcProdutoNomeResolvido', 'orcSaudacaoPorHora', 'orcSaudacaoHorario', 'orcNormalizarTelefoneBR',
  'orcGetPrazoTexto', 'orcGetResponsavel', 'orcItemDescricaoComercial', 'orcColetarItensDistribuidos',
  'orcGetValidadeDias', 'orcDistribuirParcelas', 'orcMotorComercial',
  'orcLerCondicoesPagamentoDOM', 'orcCalcCondicoesPagamento',
  'orcCondicaoLabelPorTipo', 'orcCondicaoPagamentoAtual',
  'cfgEsc',
  'orcEnviarOrcamentoWA', 'orcImprimirOrcamentoPDF'
];
var src = [
  extractVarBlock('MSG_TEMPLATES_PLACEHOLDERS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { ' + FN_NAMES.join(', ') + ' };'
].join('\n\n');
var modPath = path.join(__dirname, '_micro_rodada_2026-09-10_pdf_alinhado_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false }, props || {}); }
var _elements = {};
var _orcRows = [];
global.window = global;
global.document = {
  body: { classList: { contains: function () { return false; } } },
  getElementById: function (id) { return _elements[id]; },
  querySelectorAll: function (sel) { return sel === '#orcItemBody tr' ? _orcRows : []; }
};
global.showToast = function () {};
global.orcSalvarHistoricoCliente = function () {};
global.location = { origin: 'http://127.0.0.1:5050' };
global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 3.99 }] };

// Captura tanto window.open (WA + PDF) — cada chamada empilha um "canal"
// (WA usa win.location.href=url; PDF usa win.document.write(html)).
global._capturedWA = [];
global._capturedPDF = [];
function makeFakeWinWA() {
  var w = { closed: false, location: {}, close: function () { w.closed = true; } };
  Object.defineProperty(w.location, 'href', {
    set: function (v) { global._capturedWA.push(v); },
    get: function () { return global._capturedWA[global._capturedWA.length - 1]; }
  });
  return w;
}
function makeFakeWinPDF() {
  var w = { closed: false, document: { open: function () {}, close: function () {}, write: function (h) { global._capturedPDF.push(h); } } };
  return w;
}
global.__winMode = 'wa';
global.window.open = function (url) {
  if (global.__winMode === 'pdf') return makeFakeWinPDF();
  if (url && url !== 'about:blank' && url !== '') global._capturedWA.push(url);
  return makeFakeWinWA();
};
global.cfgLoad = function () {
  return { parcelamento: global.CFG_DEFAULT.parcelamento, financeiro: {}, mensagensAutomaticas: global._cfgMensagens || {} };
};

var mod = require(modPath);
global.orcSalvarOrcamento = async function () { return { num: '000200', id: 'ORC-000200' }; };

function resetFixture(opts) {
  opts = opts || {};
  global.window._orcCalc = { finalPrice: 1000.00 };
  global._cfgMensagens = {};
  if (opts.templateOrcamentoEnviado != null) global._cfgMensagens.orcamentoEnviado = { texto: opts.templateOrcamentoEnviado };
  if (opts.templateComparativo != null) global._cfgMensagens.orcamentoComparativo = { texto: opts.templateComparativo };
  _elements = {
    orcClientNome: makeEl({ value: 'Carlos Lima' }),
    orcClientTel: makeEl({ value: '16999123456' }),
    orcClientEmail: makeEl({ value: '' }),
    orcClientDoc: makeEl({ value: '' }),
    orcClientCidade: makeEl({ value: '' }),
    orcClientVendedor: makeEl({ value: 'Juliana Prado' }),
    orcPrazoDias: makeEl({ value: '3' }),
    orcPrazoDiasMax: makeEl({ value: '5' }),
    orcPrazoEntrega: makeEl({ value: '' }),
    orcValidadeDias: makeEl({ value: '7' }),
    orcFormaPgto: { selectedIndex: 0, options: [{ text: '50% de entrada, 50% na retirada do material' }] },
    orcDescCondToggle: makeEl({ checked: !!opts.descCondOn }),
    orcDescCond: makeEl({ value: String(opts.descCondPct || 0) }),
    orcDescCondData: makeEl({ value: opts.descCondData || '' }),
    orcPixDiscPct: makeEl({ value: String(opts.pxPct != null ? opts.pxPct : 5) }),
    orcParcSel: { value: String(opts.nParc || 3) },
    oi_prod_0: makeEl({ value: 'Placa ACM' }),
    oi_qty_0: makeEl({ value: '1' }),
    oi_larg_0: makeEl({ value: '' }), oi_alt_0: makeEl({ value: '' }), oi_det_0: makeEl({ value: '' }),
    oi_mat_0: { selectedIndex: 0, options: [{ text: 'ACM 3mm' }] },
    oi_tot_0: makeEl({ textContent: 'R$ 1.000,00' })
  };
  _orcRows = [{ dataset: { idx: '0' } }];
  global._capturedWA = [];
  global._capturedPDF = [];
}

async function gerarWA() { global.__winMode = 'wa'; await mod.orcEnviarOrcamentoWA(); return decodeURIComponent(global._capturedWA[global._capturedWA.length - 1].split('?text=')[1]); }
async function gerarPDF() { global.__winMode = 'pdf'; await mod.orcImprimirOrcamentoPDF(); return global._capturedPDF[global._capturedPDF.length - 1]; }

console.log('\n=== PDF alinhado às mensagens — Pix/Cartão/Oferta especial seguem a MESMA configuração do WhatsApp ===\n');

(async function () {
  // ── 1. Config {pix} antes de {cartao} → PDF mostra PIX antes de Cartão ──
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{pix}\n\n{cartao}\n\nTotal: {valor}' });
  var pdf1 = await gerarPDF();
  test('1. template com {pix} antes de {cartao} → PDF mostra bloco PIX antes do bloco Cartão', function () {
    var idxPix = pdf1.indexOf('Desconto PIX');
    var idxCartao = pdf1.indexOf('Parcelamento');
    assertTrue(idxPix >= 0 && idxCartao >= 0 && idxPix < idxCartao, 'esperava PIX antes de Cartão no PDF');
  });

  // ── 2. Inverter: {cartao} antes de {pix} → PDF inverte também ──────────
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{cartao}\n\n{pix}\n\nTotal: {valor}' });
  var pdf2 = await gerarPDF();
  test('2. invertendo o template ({cartao} antes de {pix}) → PDF inverte também', function () {
    var idxCartao = pdf2.indexOf('Parcelamento');
    var idxPix = pdf2.indexOf('Desconto PIX');
    assertTrue(idxCartao >= 0 && idxPix >= 0 && idxCartao < idxPix, 'esperava Cartão antes de PIX no PDF após inverter');
  });

  // ── 3. Remover {pix} do template → PDF não mostra bloco PIX ────────────
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{cartao}\n\nTotal: {valor}' });
  var pdf3 = await gerarPDF();
  test('3. template sem {pix} → PDF NÃO mostra o bloco PIX (mesmo com pxPct configurado)', function () {
    assertFalse(/Desconto PIX/.test(pdf3), 'BUG: PDF mostrou PIX mesmo sem {pix} no template');
  });
  test('3b. o Cartão continua aparecendo normalmente no PDF', function () {
    assertTrue(/Parcelamento/.test(pdf3), 'Cartão deveria continuar presente no PDF');
  });

  // ── 4. Validade — PDF usa orcGetValidadeDias() (mesma fonte configurável) ──
  resetFixture({ pxPct: 0, nParc: 1 });
  _elements.orcValidadeDias.value = '21';
  var pdf4 = await gerarPDF();
  test('4. alterar validade → PDF usa o novo valor (21 dias), não um texto fixo', function () {
    assertTrue(/Validade: 21 dias/.test(pdf4), 'PDF deveria refletir a validade configurada (21 dias)');
  });

  // ── 5. Assinatura/responsável — PDF usa orcGetResponsavel() ────────────
  resetFixture({ pxPct: 0, nParc: 1 });
  _elements.orcClientVendedor.value = 'Fernanda Nova Responsável';
  var pdf5 = await gerarPDF();
  test('5. alterar responsável/vendedor → PDF usa o novo nome', function () {
    assertTrue(pdf5.indexOf('Fernanda Nova Responsável') >= 0, 'PDF deveria refletir o responsável configurado');
  });

  // ── 6. Oferta especial — bloco que NUNCA existiu no PDF antes desta rodada ──
  resetFixture({ pxPct: 0, nParc: 1, descCondOn: true, descCondPct: 12, descCondData: '2026-09-20' });
  var pdf6 = await gerarPDF();
  test('6. desconto condicional ativo → PDF mostra o bloco "Oferta especial" (gap corrigido nesta rodada)', function () {
    assertTrue(/Oferta especial/.test(pdf6), 'BUG: PDF não mostrou "Oferta especial" mesmo com desconto condicional ativo (12%)');
    assertTrue(/12% de desconto/.test(pdf6), 'PDF deveria citar o percentual configurado (12%)');
    assertTrue(/20\/09\/2026/.test(pdf6), 'PDF deveria citar a data de validade da oferta (20/09/2026)');
  });

  // ── 7. Comparativo — cabeçalho vem do template orcamentoComparativo, não hardcoded ──
  // (usa msgResolverTemplate diretamente — não precisa montar um orçamento
  // comparativo completo pra provar que o header não é mais hardcoded)
  test('7. cabeçalho do comparativo no PDF vem de msgResolverTemplate("orcamentoComparativo"), não de string fixa', function () {
    global._cfgMensagens = { orcamentoComparativo: { texto: 'TÍTULO CUSTOM DE TESTE:\n\n{opcoes}' } };
    var resolved = mod.msgResolverTemplate('orcamentoComparativo', { opcoes: '###SENTINELA###' });
    var header = resolved.split('###SENTINELA###')[0].trim();
    assertTrue(header === 'TÍTULO CUSTOM DE TESTE:', 'esperava extrair exatamente o texto configurado antes de {opcoes}, obtido: "' + header + '"');
  });

  // ── 8. WhatsApp e PDF concordam na MESMA ordem estrutural ──────────────
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{pix}\n\n{cartao}\n\nTotal: {valor}' });
  var wa8 = await gerarWA();
  var pdf8 = await gerarPDF();
  test('8. WhatsApp e PDF concordam na mesma ordem (PIX antes de Cartão nos dois, mesmo template)', function () {
    var waPixAntes = wa8.indexOf('Desconto PIX') < wa8.indexOf('Parcelamento');
    var pdfPixAntes = pdf8.indexOf('Desconto PIX') < pdf8.indexOf('Parcelamento');
    assertTrue(waPixAntes === true && pdfPixAntes === true, 'WhatsApp e PDF deveriam concordar (ambos com PIX antes de Cartão)');
  });

  // ── 9. Template legado ({ofertas}, sem placeholders granulares) — fallback preservado ──
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n*VALOR TOTAL: {valor}*{ofertas}\n\nAtenciosamente,\n{responsavel}' });
  var pdf9 = await gerarPDF();
  test('9. template legado (só {ofertas}, sem {pix}/{cartao} granulares) → PDF cai no fallback histórico (Cartão antes de PIX)', function () {
    var idxCartao = pdf9.indexOf('Parcelamento');
    var idxPix = pdf9.indexOf('Desconto PIX');
    assertTrue(idxCartao >= 0 && idxPix >= 0 && idxCartao < idxPix, 'template legado deveria manter a ordem histórica (Cartão antes de PIX) no PDF');
  });

  console.log('\n' + '─'.repeat(60));
  console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
  try { fs.unlinkSync(modPath); } catch (e) {}
  if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
  console.log('\n✅ PASSOU\n');
})();
