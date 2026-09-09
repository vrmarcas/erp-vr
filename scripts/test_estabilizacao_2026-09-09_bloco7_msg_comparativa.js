/**
 * test_estabilizacao_2026-09-09_bloco7_msg_comparativa.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-09, BLOCO 7 — o texto "Escolha uma das
 * opções abaixo..." do orçamento comparativo (WhatsApp) era hardcoded
 * dentro de orcEnviarOrcamentoWA(), fora do sistema de Mensagens
 * Automáticas (msgResolverTemplate) — não aparecia em Configurações, não
 * era editável, sem preview. Corrigido: novo template `orcamentoComparativo`
 * registrado em MSG_TEMPLATES_PLACEHOLDERS/MSG_TEMPLATES_NOMES/
 * msgTemplatesDefault(), com um único placeholder {opcoes} — o bloco de
 * alternativas continua gerado dinamicamente a partir dos dados reais
 * (nunca hardcode paralelo), injetado como valor desse placeholder.
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_bloco7_msg_comparativa.js
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
  var marker = 'var ' + name + ' = ' + kind + ';';
  marker = 'var ' + name + ' = ' + kind;
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf(kind==='{'?'{':'[', start);
  var openCh = kind, closeCh = kind==='{'?'}':']';
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
  'module.exports = { msgResolverTemplate: msgResolverTemplate, msgValidarPlaceholders: msgValidarPlaceholders, MSG_TEMPLATES_PLACEHOLDERS: MSG_TEMPLATES_PLACEHOLDERS, MSG_TEMPLATES_NOMES: MSG_TEMPLATES_NOMES, msgTemplatesDefault: msgTemplatesDefault };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_2026-09-09_bloco7_extracted.tmp.js');
fs.writeFileSync(modPath, src);

global.window = global;
global.__cfg = { mensagensAutomaticas: {} };
global.cfgLoad = function () { return global.__cfg; };
var mod = require(modPath);

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-09 — Bloco 7: template do orçamento comparativo ===\n');

test('BLOCO 7.1 — template "orcamentoComparativo" existe e aparece em Config → Mensagens Automáticas (MSG_TEMPLATES_NOMES)', function () {
  assertTrue(!!mod.MSG_TEMPLATES_NOMES.orcamentoComparativo, 'BUG: template não registrado no catálogo exibido em Configurações');
});

test('BLOCO 7.2 — placeholder {opcoes} é o único suportado, whitelist fechada', function () {
  assertEq(mod.MSG_TEMPLATES_PLACEHOLDERS.orcamentoComparativo, ['opcoes']);
});

test('BLOCO 7.3 — msgResolverTemplate("orcamentoComparativo", {opcoes:...}) monta o bloco dinâmico dentro do texto default', function () {
  var out = mod.msgResolverTemplate('orcamentoComparativo', { opcoes: 'a) Opção A\nb) Opção B' });
  assertTrue(out.indexOf('a) Opção A\nb) Opção B') >= 0, 'bloco dinâmico de opções não foi injetado no texto');
  assertTrue(/escolha/i.test(out), 'texto default deve conter a introdução esperada');
});

test('BLOCO 7.4 — introdução/CTA/fechamento são editáveis: template customizado do usuário substitui o default', function () {
  global.__cfg.mensagensAutomaticas.orcamentoComparativo = { texto: 'Selecione a alternativa preferida:\n\n{opcoes}\n\nQualquer dúvida, chame!' };
  var out = mod.msgResolverTemplate('orcamentoComparativo', { opcoes: 'X) opção única' });
  assertTrue(out.indexOf('Selecione a alternativa preferida') >= 0, 'texto customizado pelo usuário deve substituir o default');
  assertTrue(out.indexOf('X) opção única') >= 0, 'placeholder {opcoes} continua funcionando no texto customizado');
  assertTrue(out.indexOf('Qualquer dúvida, chame!') >= 0, 'fechamento/CTA customizado deve aparecer');
  delete global.__cfg.mensagensAutomaticas.orcamentoComparativo;
});

test('BLOCO 7.5 — placeholder inválido (fora da whitelist) é rejeitado por msgValidarPlaceholders', function () {
  var invalidos = mod.msgValidarPlaceholders('orcamentoComparativo', 'Texto com {opcoes} e {inventado}');
  assertEq(invalidos, ['inventado']);
});

test('BLOCO 7.6 — preview: msgTemplatesDefault() tem entrada para orcamentoComparativo (nunca undefined em runtime)', function () {
  assertTrue(typeof mod.msgTemplatesDefault().orcamentoComparativo === 'string' && mod.msgTemplatesDefault().orcamentoComparativo.length > 0);
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
