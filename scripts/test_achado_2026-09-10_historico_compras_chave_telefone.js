/**
 * test_achado_2026-09-10_historico_compras_chave_telefone.js
 *
 * ACHADO ADICIONAL (auditoria read-only, RODADA DE CORREÇÃO 2026-09-10) —
 * durante o smoke do Bloco 6, um lead novo de teste (telefone reservado
 * "11900000000") mostrou no card do CRM um "📋 Histórico de Compras" com
 * uma compra que não era dele ("1× Carrinho de Make Patrícia R$ 771,65").
 *
 * Investigação por leitura de código (index.html) confirma a causa:
 * `clientHistGetKey(tel, email)` (linha ~26973) usa APENAS o telefone
 * normalizado (dígitos) OU o e-mail como chave — nenhuma verificação de
 * nome. `clientHistExibir(tel, email)` (linha ~27020) então mostra
 * QUALQUER histórico já registrado sob essa chave, de qualquer cliente.
 *
 * Isso significa: dois cadastros diferentes que em algum momento
 * compartilharam o mesmo número de telefone (por exemplo, números de
 * teste reutilizados entre rodadas de homologação/smoke, ou um número
 * real reciclado/portado) exibem o histórico de compra um do outro no
 * card do CRM — mesmo sendo pessoas diferentes.
 *
 * NÃO CORRIGIDO NESTA RODADA — fora do escopo autorizado (Blocos 4/5/6).
 * Reportado como achado novo, com teste que comprova o comportamento
 * reproduzível nas funções reais clientHistGetKey/clientHistExibir
 * (extraídas ao vivo de index.html).
 *
 * Uso: node scripts/test_achado_2026-09-10_historico_compras_chave_telefone.js
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

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== ACHADO 2026-09-10 — Histórico de Compras usa só telefone/e-mail como chave (sem checar nome) ===\n');
console.log('(NÃO CORRIGIDO — fora do escopo desta rodada; teste documenta o comportamento para uma rodada futura)\n');

var src = [
  'var _CLIENT_HIST = global.__CLIENT_HIST__;',
  extractFn('clientHistLoad'),
  extractFn('clientHistGetKey'),
  extractFn('clientHistExibir'),
  'module.exports = { clientHistGetKey: clientHistGetKey, clientHistExibir: clientHistExibir };'
].join('\n\n');
var modPath = path.join(__dirname, '_achado_2026-09-10_hist_extracted.tmp.js');
fs.writeFileSync(modPath, src);

global.__CLIENT_HIST__ = {
  '11900000000': {
    historico: [{ data: '2026-08-09', valor: 771.65, itens: ['1× Carrinho de Make Patrícia'], marca: 'VR Marcas' }]
  }
};
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

test('ACHADO — clientHistGetKey() ignora completamente o nome; só telefone/e-mail', function () {
  var fnSrc = extractFn('clientHistGetKey');
  assertTrue(!/nome/i.test(fnSrc), 'BUG confirmado: a função nem recebe nem usa "nome" como parte da chave — dois clientes com nomes diferentes e o MESMO telefone colidem');
});

test('ACHADO CONFIRMADO — um cliente novo/diferente com o mesmo telefone de um cliente antigo vê o histórico de compra do OUTRO cliente', function () {
  // Mesmo telefone reservado de teste usado em duas "pessoas" diferentes
  // (cenário real observado: fixture de smoke reutilizando um número já
  // associado a um histórico de outro cliente/teste anterior).
  var htmlClienteNovo = mod.clientHistExibir('11900000000', '');
  assertTrue(htmlClienteNovo.indexOf('Carrinho de Make Patrícia') >= 0,
    'ACHADO CONFIRMADO: um cliente "AUDITORIA TESTE WHATSAPP TELEFONE" (nome completamente diferente) com o telefone 11900000000 exibe a compra "Carrinho de Make Patrícia" de outro cliente/registro — nenhuma checagem de nome existe na função.');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
console.log('\nEste teste documenta um achado, não uma correção. Ambas as asserções PASSANDO');
console.log('confirmam que o comportamento (chave só por telefone/e-mail, sem checar nome) existe hoje.\n');
process.exitCode = failed > 0 ? 1 : 0;
