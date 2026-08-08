/**
 * test_contas_bancarias_2026-08-08.js
 *
 * RODADA 3 — seção 8: prova, com as funções REAIS extraídas de index.html
 * (não reimplementadas), que:
 *   1. bankListFor() é a fonte canônica única — Bradesco/Itaú cadastrados
 *      (via seed_contas_bancarias_bradesco_itau_2026-08-08.js) aparecem
 *      automaticamente nela.
 *   2. finPopularContas() (já usado por Contas a Receber E Contas a Pagar)
 *      lista as duas marcas a partir da MESMA fonte, sem array hardcoded.
 *   3. orcGetBancoPrincipal('vitre')/orcPopularBancos('vitre') — achado real
 *      corrigido nesta rodada: usavam a chave 'vit', mas a fonte canônica
 *      sempre gravou Vitre sob 'vt'. Sem a correção, uma conta cadastrada
 *      para Vitre em Config→Banco NUNCA aparecia no gateway PIX do
 *      orçamento Vitre. Este teste falha se a regressão voltar.
 *
 * Uso: node scripts/test_contas_bancarias_2026-08-08.js
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
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(start, i + 1);
}

var FN_NAMES = ['bankListFor', 'bankLoad', 'finPopularContas', 'orcGetBancoPrincipal', 'orcPopularBancos'];
var src = [
  'var _BANK_DATA = {};',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { bankListFor: bankListFor, finPopularContas: finPopularContas, orcGetBancoPrincipal: orcGetBancoPrincipal, orcPopularBancos: orcPopularBancos, setBankData: function(d){ _BANK_DATA = d; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_contas_bancarias_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo para os selects consumidos por finPopularContas/orcPopularBancos ──
var _elements = {};
function makeSelect() {
  return { innerHTML: '', options: [], appendChild: function (opt) { this.options.push(opt); } };
}
global.document = {
  getElementById: function (id) { return _elements[id]; },
  createElement: function () { return { dataset: {}, value: '', textContent: '', selected: false }; },
};
global.orcAtualizarIconePgto = function () {};

var mod = require(modPath);

// Bradesco/Itaú cadastrados para VR (como o seed real grava — agência/conta/titular vazios, "não informado")
mod.setBankData({
  vr: [
    { id: 'b1', nome: 'Bradesco', tipo: 'corrente', agencia: '', conta: '', titular: '', pix: '', principal: false },
    { id: 'b2', nome: 'Itaú', tipo: 'corrente', agencia: '', conta: '', titular: '', pix: '', principal: true },
  ],
  vt: [
    { id: 'v1', nome: 'Nubank Vitre', tipo: 'pj', agencia: '', conta: '', titular: '', pix: 'vitre@pix.com', principal: true },
  ],
});

console.log('\n=== RODADA 3 — Contas bancárias: fonte canônica única (Bradesco/Itaú) ===\n');

test('1. bankListFor("vr") retorna as 2 contas VR cadastradas', mod.bankListFor('vr').map(function (b) { return b.nome; }), ['Bradesco', 'Itaú']);
test('2. Itaú está marcado como principal (seed não força um default sem necessidade)', mod.bankListFor('vr').find(function (b) { return b.nome === 'Itaú'; }).principal, true);
test('3. Bradesco não é principal (não inventamos qual é a conta principal real)', mod.bankListFor('vr').find(function (b) { return b.nome === 'Bradesco'; }).principal, false);

_elements['finCPConta'] = makeSelect();
mod.finPopularContas('finCPConta');
var optsCP = _elements['finCPConta'].innerHTML;
test('4. finPopularContas (usado por Contas a Pagar) lista Bradesco a partir da MESMA fonte canônica', optsCP.indexOf('Bradesco') >= 0, true);
test('5. finPopularContas lista Itaú também', optsCP.indexOf('Itaú') >= 0, true);
test('6. finPopularContas lista a conta Vitre cadastrada em Config→Banco (marca "vt")', optsCP.indexOf('Nubank Vitre') >= 0, true);

// Regressão do bug real: orcGetBancoPrincipal('vitre') precisa achar a conta 'vt', não retornar null por procurar em 'vit'
test('7. orcGetBancoPrincipal("vitre") encontra a conta Vitre cadastrada (bug real da chave "vit" corrigido)', mod.orcGetBancoPrincipal('vitre') && mod.orcGetBancoPrincipal('vitre').nome, 'Nubank Vitre');
test('8. orcGetBancoPrincipal("vr") continua encontrando o principal VR (Itaú)', mod.orcGetBancoPrincipal('vr') && mod.orcGetBancoPrincipal('vr').nome, 'Itaú');

_elements['orcSimGtw'] = makeSelect();
mod.orcPopularBancos('vitre');
test('9. orcPopularBancos("vitre") popula o gateway PIX do orçamento com a conta Vitre real (mesma correção)', _elements['orcSimGtw'].options.map(function (o) { return o.dataset.nome; }), ['Nubank Vitre']);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
