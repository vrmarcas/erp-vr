/**
 * test_hotfix_pdf_ocultar_pecas_adicionais_2026-10-09.js
 *
 * HOTFIX CIRÚRGICO 2026-10-09 — P0. Bug real: o vendedor configurou (em
 * Config → Mensagens Automáticas, template 'orcamentoItemLinha') para NÃO
 * mostrar a composição técnica ("Peças adicionais": nome/medida/material
 * de cada peça planificada) removendo o placeholder {pecas_adicionais} do
 * texto — isso já funcionava para o WhatsApp (msgResolverTemplate ignora
 * um placeholder que não existe mais no texto configurado), mas o PDF
 * comercial continuava mostrando a lista técnica de peças de qualquer
 * jeito, porque orcColetarItensDistribuidos()/orcItensDistribuidosDeOrc()
 * nunca liam NENHUM template/config — só verificavam
 * `item.pecasPlan.length > 1`, incondicionalmente.
 *
 * Corrigido: nova função canônica orcMostrarPecasAdicionais() (mesmo
 * padrão de orcOrdemBlocosPagamento() já usado para Pix/Cartão/Oferta
 * especial) deriva a decisão da presença literal de {pecas_adicionais} no
 * MESMO template 'orcamentoItemLinha' que o WhatsApp já usa — nenhuma
 * config nova, nenhuma segunda fonte de verdade — e os dois pontos do PDF
 * passam a checá-la antes de montar a lista técnica. A planificação
 * continua existindo por trás (cálculo/produção/OS) — só a exibição no
 * comercial muda.
 *
 * Uso: node scripts/test_hotfix_pdf_ocultar_pecas_adicionais_2026-10-09.js
 */
'use strict';
require(require('path').join(__dirname, '_comparativo_shim.js'));
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
  extractFn('msgResolverTemplate'),
  extractFn('orcPecasAdicionaisTexto'),
  extractFn('orcMostrarPecasAdicionais'),
  'module.exports = { msgResolverTemplate: msgResolverTemplate, orcPecasAdicionaisTexto: orcPecasAdicionaisTexto, orcMostrarPecasAdicionais: orcMostrarPecasAdicionais, msgTemplatesDefault: msgTemplatesDefault };'
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_pdf_ocultar_pecas_adicionais_extracted.tmp.js');
fs.writeFileSync(modPath, src);

global.window = global;
global.__cfg = { mensagensAutomaticas: {} };
global.cfgLoad = function () { return global.__cfg; };
var mod = require(modPath);

console.log('\n=== HOTFIX 2026-10-09 (P0) — PDF deve respeitar a config de ocultar "Peças adicionais" ===\n');

test('1. default do template (quem nunca editou) → orcMostrarPecasAdicionais() = true (comportamento de sempre preservado)', function () {
  delete global.__cfg.mensagensAutomaticas.orcamentoItemLinha;
  assertTrue(mod.orcMostrarPecasAdicionais() === true, 'default deve manter {pecas_adicionais} presente → mostrar');
});

test('2. P0 — vendedor remove {pecas_adicionais} do template (ação real de "ocultar") → orcMostrarPecasAdicionais() = false', function () {
  global.__cfg.mensagensAutomaticas.orcamentoItemLinha = {
    texto: '{numero}. {descricao}\nQuantidade: {quantidade}\nValor unitário: {valor_unitario}\nSubtotal: {subtotal}'
  };
  assertTrue(mod.orcMostrarPecasAdicionais() === false, 'BUG: PDF continuaria mostrando mesmo com o placeholder removido do template');
  delete global.__cfg.mensagensAutomaticas.orcamentoItemLinha;
});

test('3. vendedor restaura {pecas_adicionais} no template → orcMostrarPecasAdicionais() = true de novo', function () {
  global.__cfg.mensagensAutomaticas.orcamentoItemLinha = {
    texto: '{numero}. {descricao}\nQuantidade: {quantidade}\nValor unitário: {valor_unitario}\nSubtotal: {subtotal}{pecas_adicionais}'
  };
  assertTrue(mod.orcMostrarPecasAdicionais() === true);
  delete global.__cfg.mensagensAutomaticas.orcamentoItemLinha;
});

test('4. WhatsApp (msgResolverTemplate) já respeitava a mesma config — continua idêntico (nenhuma regressão)', function () {
  global.__cfg.mensagensAutomaticas.orcamentoItemLinha = {
    texto: '{numero}. {descricao}\nQuantidade: {quantidade}\nValor unitário: {valor_unitario}\nSubtotal: {subtotal}'
  };
  var out = mod.msgResolverTemplate('orcamentoItemLinha', {
    numero: '01', descricao: 'Caixa Acrílica', quantidade: 2, valor_unitario: 'R$ 175,00', subtotal: 'R$ 350,00',
    pecas_adicionais: mod.orcPecasAdicionaisTexto([{ nome: 'Lateral', larg: 20, alt: 5 }, { nome: 'Tampa', larg: 20, alt: 20 }], 'Acrílico')
  });
  assertTrue(out.indexOf('Peças adicionais') === -1, 'WhatsApp não deve mostrar peças adicionais quando o placeholder foi removido do template');
  delete global.__cfg.mensagensAutomaticas.orcamentoItemLinha;
});

// ── Guarda estrutural: os dois pontos de montagem do HTML do PDF (fonte
// DOM e fonte "do orc" persistido — duplicados de propósito, ver
// feedback_erp_vr_test_extraction_pattern) precisam chamar o gate ANTES
// de montar pecasAdicionaisHtml. Não extraímos as funções inteiras (são
// grandes e fortemente acopladas ao DOM/orçamento) — verificamos a fonte
// diretamente, mesmo padrão de "guarda estrutural" já usado em outras
// rodadas deste projeto para blocos não triviais de extrair isoladamente.
test('5. orcColetarItensDistribuidos() (fonte DOM) consulta orcMostrarPecasAdicionais() antes de montar pecasAdicionaisHtml', function () {
  var marker = "if (item.pecasPlan && item.pecasPlan.length > 1 && typeof cfgEsc === 'function' && orcMostrarPecasAdicionais())";
  var ocorrencias = html.split(marker).length - 1;
  assertEq(ocorrencias, 2, 'esperava exatamente 2 ocorrências do gate (orcColetarItensDistribuidos + orcItensDistribuidosDeOrc) — achou ' + ocorrencias);
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
fs.unlinkSync(modPath);
if (failed > 0) process.exitCode = 1;
