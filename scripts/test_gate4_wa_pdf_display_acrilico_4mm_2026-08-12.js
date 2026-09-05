/**
 * test_gate4_wa_pdf_display_acrilico_4mm_2026-08-12.js
 *
 * HOTFIX OPERACIONAL 2026-08-12, Gate 4 — teste determinístico (fixture +
 * mocks, execução REAL das funções extraídas de index.html, nunca
 * reimplementadas) provando que orcEnviarOrcamentoWA()/orcImprimirOrcamentoPDF()
 * produzem exatamente os números do caso histórico real (equivalente a
 * orc #000025 em produção) sem depender do material "Acrílico Cristal
 * 4mm" continuar cadastrado em Configuração — ele não está mais (achado
 * documentado, fora de escopo desta rodada, catálogo não alterado):
 *   - descrição do item: "Display em Acrílico Cristal 4mm"
 *   - preço principal/cartão (3x): R$42,60
 *   - parcelamento: 3x de R$14,20 (fecha exatamente com o principal)
 *   - PIX (alternativa, nunca substitui o principal): R$40,41
 *   - prazo: De 5 a 6 dias úteis
 *   - nenhum R$/m² interno, nenhum custo/margem/markup exposto
 *
 * Matemática do fixture: base (window._orcCalc.finalPrice, sem taxa de
 * parcelamento) = R$40,41; taxa configurada para 3x = 5,14% (mesma % do
 * PIX sugerido) => cartão 3x = 4041/(1-0,0514) = 4260 centavos = R$42,60;
 * 3x de 4260/3 = 1420 centavos = R$14,20 exato; PIX com o percentual
 * sugerido (5,14%) = a própria base = R$40,41.
 *
 * Uso: node scripts/test_gate4_wa_pdf_display_acrilico_4mm_2026-08-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

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

console.log('\n=== GATE 4 — WhatsApp/PDF: fixture determinística Display Acrílico Cristal 4mm (R$42,60/3x R$14,20/PIX R$40,41) ===\n');

var FN_NAMES = [
  'msgResolverTemplate', 'msgTemplatesDefault',
  'orcProdutoNomeResolvido',
  'orcSaudacaoPorHora', 'orcSaudacaoHorario', 'orcNormalizarTelefoneBR',
  'orcGetPrazoTexto', 'orcGetResponsavel', 'orcItemDescricaoComercial', 'orcColetarItensDistribuidos',
  'orcGetValidadeDias', 'orcDistribuirParcelas', 'orcMotorComercial',
  'orcLerCondicoesPagamentoDOM', 'orcCalcCondicoesPagamento',
  'orcCondicaoLabelPorTipo', 'orcCondicaoPagamentoAtual',
  'orcEnviarOrcamentoWA', 'orcImprimirOrcamentoPDF'
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
var modPath = path.join(__dirname, '_gate4_wa_pdf_extracted.tmp.js');
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
  querySelectorAll: function (sel) { return (sel === '#orcItemBody tr' || sel === '#orcItemBody tr[data-idx]') ? _orcRows : []; }
};
global.showToast = function () {};
global._openedUrls = [];
global._pdfHtml = '';
function makeFakeWin() {
  var w = {
    closed: false, location: {}, close: function () { w.closed = true; },
    document: {
      open: function () { global._pdfHtml = ''; },
      write: function (s) { global._pdfHtml += s; },
      close: function () {},
    },
  };
  Object.defineProperty(w.location, 'href', {
    set: function (v) { global._openedUrls.push(v); },
    get: function () { return global._openedUrls[global._openedUrls.length - 1]; }
  });
  return w;
}
global.window.open = function () { return makeFakeWin(); };
global.location = { origin: 'http://127.0.0.1:5050' };
// taxa de 3x = 5,14% — mesma % usada como sugestão de desconto PIX (ver
// matemática do fixture no cabeçalho do arquivo).
global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 3.05 }, { parcelas: 3, taxa: 5.14 }] };
global.cfgLoad = function () { return JSON.parse(JSON.stringify(global.CFG_DEFAULT)); };

var mod = require(modPath);
global.orcSalvarOrcamento = async function () { return { num: '999999', id: 'ORC-TEST-GATE4' }; };
global.orcSalvarHistoricoCliente = function () {};

function resetFixture() {
  _bodyClasses.length = 0;
  global.window._orcCalc = { finalPrice: 40.41 }; // base sem taxa — ver matemática no cabeçalho
  var matOption = { text: 'Acrílico Cristal 4mm — R$151,17/m²', dataset: { nome: 'Acrílico Cristal 4mm' } };
  _elements = {
    orcClientNome: makeEl({ value: 'Cliente Gate4' }),
    orcClientTel: makeEl({ value: '11988887777' }),
    orcClientEmail: makeEl({ value: '' }),
    orcClientDoc: makeEl({ value: '' }),
    orcClientCidade: makeEl({ value: '' }),
    orcClientVendedor: makeEl({ value: 'Ronaldo Silva' }),
    orcPrazoDias: makeEl({ value: '5' }),
    orcPrazoDiasMax: makeEl({ value: '6' }),
    orcPrazoEntrega: makeEl({ value: '' }),
    orcValidadeDias: makeEl({ value: '10' }),
    orcFormaPgto: { selectedIndex: 0, options: [{ text: '50% de entrada, 50% na retirada do material' }] },
    orcDescCondToggle: makeEl({ checked: false }),
    orcDescCond: makeEl({ value: '0' }),
    orcDescCondData: makeEl({ value: '' }),
    orcPixDiscPct: makeEl({ value: '5.14' }),
    orcParcSel: { value: '3' },
    oi_prod_1: makeEl({ value: 'Display em Acrílico Cristal 4mm' }),
    oi_qty_1: makeEl({ value: '1' }),
    oi_larg_1: makeEl({ value: '' }), oi_alt_1: makeEl({ value: '' }), oi_det_1: makeEl({ value: '' }),
    oi_mat_1: { options: [matOption], selectedIndex: 0 },
    oi_tot_1: makeEl({ textContent: 'R$42,60' }),
  };
  _orcRows = [{ dataset: { idx: '1' } }];
  global._openedUrls = [];
  global._pdfHtml = '';
}

(async function () {

  // ── WhatsApp ──
  resetFixture();
  await mod.orcEnviarOrcamentoWA();
  var url = global._openedUrls[global._openedUrls.length - 1];
  var textParam = decodeURIComponent(url.split('?text=')[1]);

  ok('WA 1. descrição contém "Display em Acrílico Cristal 4mm"', textParam.indexOf('Display em Acrílico Cristal 4mm') >= 0);
  ok('WA 2. nenhum "R$/m²" ou "/m²" interno vazando', !/\/m[²2]/i.test(textParam));
  ok('WA 3. VALOR TOTAL = R$ 42,60 (preço principal/cartão)', textParam.indexOf('*VALOR TOTAL: R$ 42,60*') >= 0);
  ok('WA 4. valor unitário do item = R$ 42,60', /Valor unitário: R\$ 42,60/.test(textParam));
  ok('WA 5. subtotal do item = R$ 42,60', /Subtotal: R\$ 42,60/.test(textParam));
  ok('WA 6. parcelamento fecha exatamente com o total: 3x de R$ 14,20 sem juros', /\*Parcelamento:\* em até 3x de R\$ 14,20 sem juros/.test(textParam));
  ok('WA 7. PIX aparece como alternativa separada, R$ 40,41 (nunca substitui o VALOR TOTAL)', /\*Desconto PIX:\*.*R\$ 40,41/.test(textParam));
  ok('WA 8. prazo = "De 5 a 6 dias úteis" (vem do orçamento salvo, não hardcoded)', textParam.indexOf('De 5 a 6 dias úteis') >= 0);
  ok('WA 9. nenhum "custo"/"margem"/"markup" exposto ao cliente', !/custo|margem|markup/i.test(textParam));
  ok('WA 10. nenhum "undefined"/"null"/"NaN" no texto', !/\bundefined\b|\bnull\b|\bNaN\b/.test(textParam));

  // ── PDF ──
  resetFixture();
  await mod.orcImprimirOrcamentoPDF();
  var pdfHtml = global._pdfHtml;
  var pdfText = pdfHtml.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  ok('PDF 1. descrição contém "Display em Acrílico Cristal 4mm"', pdfText.indexOf('Display em Acrílico Cristal 4mm') >= 0);
  ok('PDF 2. nenhum "R$/m²" ou "/m²" interno vazando', !/\/m[²2]/i.test(pdfText));
  ok('PDF 3. Total Geral = R$ 42,60 (preço principal/cartão)', /Total Geral\s*R\$\s*42,60/.test(pdfText));
  ok('PDF 4. preço unitário do item = R$42,60 e total do item = R$42,60', (pdfText.match(/R\$42,60/g) || []).length >= 2);
  ok('PDF 5. parcelamento fecha exatamente com o total: 3x de R$ 14,20 sem juros', /Parcelável em até 3x de R\$ 14,20 sem juros/.test(pdfText));
  ok('PDF 6. PIX aparece como alternativa separada, R$ 40,41', /desconto pagando via PIX \(R\$ 40,41\)/.test(pdfText));
  ok('PDF 7. prazo = "De 5 a 6 dias úteis"', pdfText.indexOf('De 5 a 6 dias úteis') >= 0);
  ok('PDF 8. nenhum "custo"/"margem"/"markup" exposto ao cliente', !/custo|margem|markup/i.test(pdfText));
  ok('PDF 9. nenhum "undefined"/"null"/"NaN" no HTML', !/\bundefined\b|\bnull\b|\bNaN\b/.test(pdfText));

  try { fs.unlinkSync(modPath); } catch (e) {}

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})();
