/**
 * test_rodada_funcional_bloco1_2_editor_mensagens_2026-09-17.js
 *
 * RODADA FUNCIONAL 2026-09-17, Blocos 1+2 — editor modular de mensagens +
 * peças adicionais nomeadas.
 *
 * Bloco 1: a estrutura interna de cada item numerado e cada opção
 * comparativa (antes hardcoded dentro de orcEnviarOrcamentoWA — sempre
 * "Quantidade: X | Valor unitário: Y | Subtotal: Z") agora tem template
 * próprio e editável (orcamentoItemLinha/orcamentoOpcaoItem/
 * orcamentoSeparadorOpcoes), com os defaults reproduzindo BYTE A BYTE o
 * texto anterior — nenhuma mensagem já configurada muda de aparência sem
 * o admin editar o template.
 *
 * Bloco 2: peças planificadas com nome próprio (ex. "Base Caixa", "Peça
 * interna") agora aparecem no texto via {pecas_adicionais}
 * (orcPecasAdicionaisTexto), usando o template orcamentoPecaAdicionalLinha
 * por peça — só quando há MAIS DE UMA peça (item de peça única não repete
 * a mesma informação que já aparece em {material}/{medidas}).
 *
 * Uso: node scripts/test_rodada_funcional_bloco1_2_editor_mensagens_2026-09-17.js
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
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
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
function extractVar(name, kind) {
  var marker = 'var ' + name + ' = ' + kind;
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf(kind === '{' ? '{' : '[', start);
  var openCh = kind, closeCh = kind === '{' ? '}' : ']';
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === openCh) depth++; else if (html[i] === closeCh) { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Desbalanceado extraindo ' + name);
  return html.slice(start, i + 1) + ';';
}

var src = [
  extractVar('MSG_TEMPLATES_PLACEHOLDERS', '{'),
  extractVar('MSG_TEMPLATES_NOMES', '{'),
  extractFn('msgTemplatesDefault'),
  extractFn('msgValidarPlaceholders'),
  extractFn('msgResolverTemplate'),
  extractFn('orcPecasAdicionaisTexto'),
  'module.exports = { msgResolverTemplate: msgResolverTemplate, msgValidarPlaceholders: msgValidarPlaceholders, orcPecasAdicionaisTexto: orcPecasAdicionaisTexto, MSG_TEMPLATES_PLACEHOLDERS: MSG_TEMPLATES_PLACEHOLDERS, MSG_TEMPLATES_NOMES: MSG_TEMPLATES_NOMES, msgTemplatesDefault: msgTemplatesDefault };'
].join('\n\n');
var modPath = path.join(__dirname, '_rodada_funcional_bloco1_2_extracted.tmp.js');
fs.writeFileSync(modPath, src);

global.window = global;
global.__cfg = { mensagensAutomaticas: {} };
global.cfgLoad = function () { return global.__cfg; };
var mod = require(modPath);

console.log('\n=== RODADA FUNCIONAL 2026-09-17 — Blocos 1+2: editor modular + peças adicionais ===\n');

// ── Bloco 1 — templates registrados ─────────────────────────────────────
['orcamentoItemLinha', 'orcamentoOpcaoItem', 'orcamentoSeparadorOpcoes', 'orcamentoPecaAdicionalLinha'].forEach(function (chave) {
  test('1.1 — template "' + chave + '" registrado em MSG_TEMPLATES_NOMES (aparece em Config → Mensagens Automáticas)', function () {
    assertTrue(!!mod.MSG_TEMPLATES_NOMES[chave], 'BUG: template não registrado no catálogo exibido em Configurações');
  });
  test('1.2 — "' + chave + '" tem default não-vazio (preview nunca quebra)', function () {
    assertTrue(typeof mod.msgTemplatesDefault()[chave] === 'string' && mod.msgTemplatesDefault()[chave].length > 0);
  });
});

test('1.3 — whitelist de placeholders de orcamentoItemLinha cobre numero/produto/descricao/quantidade/valor_unitario/subtotal/material/medidas/pecas_adicionais', function () {
  assertEq(mod.MSG_TEMPLATES_PLACEHOLDERS.orcamentoItemLinha.slice().sort(), ['descricao', 'material', 'medidas', 'numero', 'pecas_adicionais', 'produto', 'quantidade', 'subtotal', 'valor_unitario'].sort());
});

test('1.4 — default de orcamentoItemLinha reproduz BYTE A BYTE o texto hardcoded anterior (retrocompat)', function () {
  var out = mod.msgResolverTemplate('orcamentoItemLinha', {
    numero: '01', descricao: 'Caixa Acrílica', quantidade: 2, valor_unitario: 'R$ 175,00', subtotal: 'R$ 350,00', pecas_adicionais: ''
  });
  var legado = '01. Caixa Acrílica\nQuantidade: 2\nValor unitário: R$ 175,00\nSubtotal: R$ 350,00';
  assertEq(out, legado, 'default não reproduz exatamente o formato antigo — mensagens já configuradas mudariam de aparência');
});

test('1.5 — default de orcamentoOpcaoItem + orcamentoSeparadorOpcoes reproduz o formato comparativo anterior', function () {
  var op1 = mod.msgResolverTemplate('orcamentoOpcaoItem', { letra: 'a', descricao: 'Caixa Cristal 2mm', quantidade: 1, valor_unitario: 'R$ 180,00', subtotal: 'R$ 180,00' });
  var op2 = mod.msgResolverTemplate('orcamentoOpcaoItem', { letra: 'b', descricao: 'Caixa Cristal 3mm', quantidade: 1, valor_unitario: 'R$ 220,00', subtotal: 'R$ 220,00' });
  var bloco = [op1, op2].join('\n' + mod.msgResolverTemplate('orcamentoSeparadorOpcoes', {}) + '\n');
  var legado = '   a) Caixa Cristal 2mm\n      Quantidade: 1 | Valor unitário: R$ 180,00 | Subtotal: R$ 180,00\n   ── OU ──\n   b) Caixa Cristal 3mm\n      Quantidade: 1 | Valor unitário: R$ 220,00 | Subtotal: R$ 220,00';
  assertEq(bloco, legado, 'default do comparativo não reproduz exatamente o formato antigo');
});

test('1.6 — admin consegue REESTRUTURAR o item (exemplo do pedido: Quantidade/Valor/Subtotal em linhas separadas com espaçamento)', function () {
  global.__cfg.mensagensAutomaticas.orcamentoItemLinha = { texto: '{numero}) {produto}\n\nQuantidade: {quantidade}\nValor unitário: {valor_unitario}\nSubtotal: {subtotal}\n\n{descricao}' };
  var out = mod.msgResolverTemplate('orcamentoItemLinha', { numero: '1', produto: 'Caixa Acrílica Cristal 2mm', descricao: 'obs livre', quantidade: 1, valor_unitario: 'R$ 180,00', subtotal: 'R$ 180,00', pecas_adicionais: '' });
  assertTrue(out.indexOf('1) Caixa Acrílica Cristal 2mm\n\nQuantidade: 1') >= 0, 'template customizado não foi aplicado — editor não é de fato estrutural');
  delete global.__cfg.mensagensAutomaticas.orcamentoItemLinha;
});

test('1.7 — Pix/Cartão continuam reordenáveis/omitíveis SEM código (placeholders já livres no template principal)', function () {
  assertTrue(mod.MSG_TEMPLATES_PLACEHOLDERS.orcamentoEnviado.indexOf('pix') >= 0 && mod.MSG_TEMPLATES_PLACEHOLDERS.orcamentoEnviado.indexOf('cartao') >= 0);
});

test('1.8 — placeholder inválido em orcamentoItemLinha é rejeitado (whitelist fechada, nunca inventa)', function () {
  var invalidos = mod.msgValidarPlaceholders('orcamentoItemLinha', 'Texto com {numero} e {preco_custo}');
  assertEq(invalidos, ['preco_custo']);
});

// ── Bloco 2 — peças adicionais nomeadas ─────────────────────────────────
test('2.1 — item de peça ÚNICA não gera bloco de peças adicionais (evita redundância com {material}/{medidas})', function () {
  var out = mod.orcPecasAdicionaisTexto([{ nome: 'Peça', larg: 26, alt: 19, esp: 3 }], 'Acrílico Colorido');
  assertEq(out, '', 'item com 1 peça só não deveria gerar bloco de peças adicionais');
});

test('2.2 — item SEM peças planificadas não gera bloco (nem lança exceção)', function () {
  assertEq(mod.orcPecasAdicionaisTexto([], 'Acrílico Colorido'), '');
  assertEq(mod.orcPecasAdicionaisTexto(null, 'Acrílico Colorido'), '');
  assertEq(mod.orcPecasAdicionaisTexto(undefined, 'Acrílico Colorido'), '');
});

test('2.3 — item com MAIS de uma peça nomeada gera o bloco, com os NOMES reais (achado do bug: antes nunca apareciam)', function () {
  var out = mod.orcPecasAdicionaisTexto([
    { nome: 'Base Caixa', larg: 36, alt: 48, esp: 2 },
    { nome: 'Peça interna', larg: 26, alt: 19, esp: 4 }
  ], 'Acrílico Colorido');
  assertTrue(out.indexOf('Base Caixa') >= 0, 'BUG: nome da peça "Base Caixa" não aparece no texto');
  assertTrue(out.indexOf('Peça interna') >= 0, 'BUG: nome da peça "Peça interna" não aparece no texto');
});

test('2.4 — cada peça usa o MATERIAL do item (matLbl) + a ESPESSURA própria da peça — nunca "Peça" genérico sem material', function () {
  var out = mod.orcPecasAdicionaisTexto([
    { nome: 'Base Caixa', larg: 36, alt: 48, esp: 2 },
    { nome: 'Peça interna', larg: 26, alt: 19, esp: 4 }
  ], 'Acrílico Colorido');
  assertTrue(out.indexOf('Acrílico Colorido 2mm') >= 0, 'peça de 2mm deveria mostrar "Acrílico Colorido 2mm"');
  assertTrue(out.indexOf('Acrílico Colorido 4mm') >= 0, 'peça de 4mm deveria mostrar "Acrílico Colorido 4mm"');
  assertTrue(out.indexOf('Cristal') < 0, 'BUG Bloco 3: material saiu como Cristal em vez do material real do item (Colorido)');
});

test('2.5 — formato da linha por peça é o template editável orcamentoPecaAdicionalLinha (Config → Mensagens Automáticas)', function () {
  global.__cfg.mensagensAutomaticas.orcamentoPecaAdicionalLinha = { texto: '* {nome_peca} ({quantidade_peca}x) — {largura_peca}cm x {altura_peca}cm' };
  var out = mod.orcPecasAdicionaisTexto([
    { nome: 'Base Caixa', larg: 36, alt: 48, esp: 2, qty: 1 },
    { nome: 'Peça interna', larg: 26, alt: 19, esp: 4, qty: 1 }
  ], 'Acrílico Colorido');
  assertTrue(out.indexOf('* Base Caixa (1x) — 36cm x 48cm') >= 0, 'template customizado da peça não foi aplicado');
  delete global.__cfg.mensagensAutomaticas.orcamentoPecaAdicionalLinha;
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
