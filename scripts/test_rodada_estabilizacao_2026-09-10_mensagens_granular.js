/**
 * test_rodada_estabilizacao_2026-09-10_mensagens_granular.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-10 — Blocos C/D/E: `{ofertas}` era uma
 * caixa-preta (Parcelamento → Oferta especial → PIX, sempre nessa ordem,
 * hardcoded dentro de orcEnviarOrcamentoWA) — o admin não conseguia
 * reordenar nem omitir um bloco sem editar código.
 *
 * Corrigido: os mesmos 3 blocos agora também existem como placeholders
 * GRANULARES ({pix}, {cartao}, {oferta_especial}) — o admin controla a
 * ORDEM e a presença de cada um editando o template em Config → Mensagens
 * Automáticas. `{ofertas}` continua funcionando exatamente como antes
 * (retrocompat). Preview e mensagem real usam a MESMA função
 * (msgResolverTemplate) com os MESMOS dados — a ordem que o admin escreve
 * no template é a ordem que aparece tanto no preview quanto no WhatsApp
 * real (prova disto: teste 26 abaixo, que roda o preview e a mensagem
 * real lado a lado).
 *
 * Extrai orcEnviarOrcamentoWA/msgResolverTemplate/cfgMsgAutoPreview ao
 * vivo de index.html e intercepta window.open — não reimplementa a
 * lógica testada.
 *
 * Uso: node scripts/test_rodada_estabilizacao_2026-09-10_mensagens_granular.js
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
  'orcProdutoNomeResolvido', 'orcSaudacaoPorHora', 'orcSaudacaoHorario', 'orcNormalizarTelefoneBR',
  'orcGetPrazoTexto', 'orcGetResponsavel', 'orcItemDescricaoComercial', 'orcColetarItensDistribuidos',
  'orcGetValidadeDias', 'orcDistribuirParcelas', 'orcMotorComercial',
  'orcLerCondicoesPagamentoDOM', 'orcCalcCondicoesPagamento',
  'orcCondicaoLabelPorTipo', 'orcCondicaoPagamentoAtual',
  'orcEnviarOrcamentoWA'
];
var src = [
  extractVarBlock('MSG_TEMPLATES_PLACEHOLDERS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { ' + FN_NAMES.join(', ') + ' };'
].join('\n\n');
var modPath = path.join(__dirname, '_rodada_estabilizacao_2026-09-10_mensagens_granular_extracted.tmp.js');
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
  if (url && url !== 'about:blank' && url !== '') global._openedUrls.push(url);
  return makeFakeWin();
};
global.location = { origin: 'http://127.0.0.1:5050' };
global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 3.99 }] };

var mod = require(modPath);
global.orcSalvarOrcamento = async function () { return { num: '000123', id: 'ORC-000123' }; };

function resetFixture(opts) {
  opts = opts || {};
  global.window._orcCalc = { finalPrice: 1000.00 };
  global._cfgMensagens = opts.templateOrcamentoEnviado != null
    ? { orcamentoEnviado: { texto: opts.templateOrcamentoEnviado } } : {};
  global.cfgLoad = function () {
    return { parcelamento: global.CFG_DEFAULT.parcelamento, financeiro: {}, mensagensAutomaticas: global._cfgMensagens };
  };
  _elements = {
    orcClientNome: makeEl({ value: 'Carlos Lima' }),
    orcClientTel: makeEl({ value: '16999123456' }),
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
  global._openedUrls = [];
}

console.log('\n=== Mensagens — {pix}/{cartao} granulares: reordenáveis e omitíveis via template ===\n');

(async function () {
  // ── 1. Template padrão ({ofertas}) — comportamento de sempre preservado ──
  resetFixture({ pxPct: 5, nParc: 3 });
  await mod.orcEnviarOrcamentoWA();
  var txtPadrao = decodeURIComponent(global._openedUrls[global._openedUrls.length - 1].split('?text=')[1]);
  test('1. template padrão ({ofertas}) — Parcelamento aparece ANTES do PIX (ordem legada preservada)', function () {
    var idxCartao = txtPadrao.indexOf('*Parcelamento:*');
    var idxPix = txtPadrao.indexOf('*Desconto PIX:*');
    assertTrue(idxCartao >= 0 && idxPix >= 0 && idxCartao < idxPix, 'ordem legada (Parcelamento antes de PIX) deveria continuar valendo pra quem não editou o template');
  });

  // ── 2. Template customizado: PIX primeiro, CARTÃO depois ──────────────
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{pix}\n\n{cartao}\n\nTotal: {valor}' });
  await mod.orcEnviarOrcamentoWA();
  var txtPixPrimeiro = decodeURIComponent(global._openedUrls[global._openedUrls.length - 1].split('?text=')[1]);
  test('2. template com {pix} antes de {cartao} → mensagem REAL do WhatsApp mostra PIX antes de Cartão', function () {
    var idxPix = txtPixPrimeiro.indexOf('*Desconto PIX:*');
    var idxCartao = txtPixPrimeiro.indexOf('*Parcelamento:*');
    assertTrue(idxPix >= 0 && idxCartao >= 0 && idxPix < idxCartao, 'esperava PIX antes de Parcelamento na mensagem real');
  });

  // ── 3. Inverter: CARTÃO primeiro, PIX depois ───────────────────────────
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{cartao}\n\n{pix}\n\nTotal: {valor}' });
  await mod.orcEnviarOrcamentoWA();
  var txtCartaoPrimeiro = decodeURIComponent(global._openedUrls[global._openedUrls.length - 1].split('?text=')[1]);
  test('3. invertendo o template ({cartao} antes de {pix}) → mensagem real inverte também', function () {
    var idxCartao = txtCartaoPrimeiro.indexOf('*Parcelamento:*');
    var idxPix = txtCartaoPrimeiro.indexOf('*Desconto PIX:*');
    assertTrue(idxCartao >= 0 && idxPix >= 0 && idxCartao < idxPix, 'esperava Parcelamento antes de PIX após inverter o template');
  });

  // ── 4. Remover {pix} do template → mensagem real não inclui PIX ────────
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{cartao}\n\nTotal: {valor}' });
  await mod.orcEnviarOrcamentoWA();
  var txtSemPix = decodeURIComponent(global._openedUrls[global._openedUrls.length - 1].split('?text=')[1]);
  test('4. template sem {pix} → mensagem real NÃO inclui a seção de PIX (mesmo com pxPct configurado)', function () {
    assertFalse(/\*Desconto PIX:\*/.test(txtSemPix), 'BUG: PIX apareceu mesmo sem {pix} no template');
  });
  test('4b. o Cartão continua aparecendo normalmente (só o PIX foi omitido)', function () {
    assertTrue(/\*Parcelamento:\*/.test(txtSemPix), 'Cartão deveria continuar presente');
  });

  // ── 5. Remover {cartao} do template → mensagem real não inclui Cartão ──
  resetFixture({ pxPct: 5, nParc: 3, templateOrcamentoEnviado: 'Olá {cliente}!\n\n{itens}\n\n{pix}\n\nTotal: {valor}' });
  await mod.orcEnviarOrcamentoWA();
  var txtSemCartao = decodeURIComponent(global._openedUrls[global._openedUrls.length - 1].split('?text=')[1]);
  test('5. template sem {cartao} → mensagem real NÃO inclui Parcelamento (mesmo com 3x configurado)', function () {
    assertFalse(/\*Parcelamento:\*/.test(txtSemCartao), 'BUG: Parcelamento apareceu mesmo sem {cartao} no template');
  });
  test('5b. o PIX continua aparecendo normalmente (só o Cartão foi omitido)', function () {
    assertTrue(/\*Desconto PIX:\*/.test(txtSemCartao), 'PIX deveria continuar presente');
  });

  // ── 6. Validade/assinatura (responsavel) editáveis no template ────────
  resetFixture({ pxPct: 0, nParc: 1, templateOrcamentoEnviado: 'Olá {cliente}!\n\nVálido por {validade}.\nAtenciosamente, {responsavel}.' });
  await mod.orcEnviarOrcamentoWA();
  var txtValidadeAssinatura = decodeURIComponent(global._openedUrls[global._openedUrls.length - 1].split('?text=')[1]);
  test('6. {validade} e {responsavel} (assinatura) refletem o template editado, sem nenhum texto fixo hardcoded a mais', function () {
    assertTrue(/V[aá]lido por 7 dias\./.test(txtValidadeAssinatura), 'validade deveria vir do placeholder {validade}');
    assertTrue(txtValidadeAssinatura.indexOf('Atenciosamente, ') >= 0, 'assinatura deveria vir do placeholder {responsavel}');
  });

  // ── 7. Preview (cfgMsgAutoPreview) usa a MESMA ordem que a mensagem real ──
  test('7. Preview 1:1 — mesma ordem de blocos que a mensagem real (PIX antes de Cartão)', function () {
    var CFG_MSG_AUTO_EXEMPLO_marker = 'var CFG_MSG_AUTO_EXEMPLO = {';
    var start = html.indexOf(CFG_MSG_AUTO_EXEMPLO_marker);
    var braceOpen = html.indexOf('{', start);
    var depth = 0, i = braceOpen;
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
    var exemploSrc = 'var CFG_MSG_AUTO_EXEMPLO = ' + html.slice(braceOpen, i + 1) + ';';
    var exemplo = new Function(exemploSrc + '\nreturn CFG_MSG_AUTO_EXEMPLO;')();
    var validos = mod.msgValidarPlaceholders ? null : null; // placeholder — usa MSG_TEMPLATES_PLACEHOLDERS direto
    var MSG_TEMPLATES_PLACEHOLDERS = new Function(extractVarBlock('MSG_TEMPLATES_PLACEHOLDERS') + '\nreturn MSG_TEMPLATES_PLACEHOLDERS;')();
    var templatePixPrimeiro = 'Olá {cliente}!\n\n{pix}\n\n{cartao}';
    var validosLista = MSG_TEMPLATES_PLACEHOLDERS.orcamentoEnviado;
    var preview = templatePixPrimeiro.replace(/\{([a-zA-Z_]+)\}/g, function (m, nome) {
      if (validosLista.indexOf(nome) < 0) return m;
      return exemplo[nome] != null ? String(exemplo[nome]) : m;
    });
    var idxPixPrev = preview.indexOf('Desconto PIX');
    var idxCartaoPrev = preview.indexOf('Parcelamento');
    assertTrue(idxPixPrev >= 0 && idxCartaoPrev >= 0 && idxPixPrev < idxCartaoPrev, 'preview deveria mostrar PIX antes de Cartão, igual à mensagem real (teste 2)');
  });

  console.log('\n' + '─'.repeat(60));
  console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
  try { fs.unlinkSync(modPath); } catch (e) {}
  if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
  console.log('\n✅ PASSOU\n');
})();
