/**
 * test_cr_drilldown_2026-08-08.js
 *
 * RODADA 4 — seção 3: Contas a Receber navegável. Testa as funções REAIS
 * extraídas de index.html (finResolveClienteId/finCRLinkedOS/finCRLinkedOrc)
 * que resolvem os vínculos clienteId/orçamentoId/osId de um lançamento de
 * CR — tanto para lançamentos novos (que já gravam o id real) quanto para
 * lançamentos antigos (fallback por nome/telefone/padrão textual "OS #N"
 * e "ORC-N").
 *
 * Uso: node scripts/test_cr_drilldown_2026-08-08.js
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
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

var FN_NAMES = ['finResolveClienteId', 'finCRLinkedOS', 'finCRLinkedOrc'];
var src = [
  'var KB_OS = {};',
  'var CLIENTES_DATA = [];',
  'var _ORC_LIST = [];',
  'function orcGetEnviados(){ return _ORC_LIST; }',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  resolveClienteId: finResolveClienteId, linkedOS: finCRLinkedOS, linkedOrc: finCRLinkedOrc,',
  '  setKbOs: function(v){ KB_OS = v; }, setClientes: function(v){ CLIENTES_DATA = v; }, setOrcamentos: function(v){ _ORC_LIST = v; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_cr_drilldown_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 4 — CR navegável: resolução de clienteId/orcamentoId/osId (funções reais extraídas) ===\n');

// ── finResolveClienteId ────────────────────────────────────────────────
mod.setClientes([
  { id: 'cli1', nome: 'João da Silva', tel: '(11) 98888-7777' },
  { id: 'cli2', nome: 'Maria Souza', tel: '11977776666' },
]);
test('1. resolve clienteId por telefone (normalizando pontuação dos dois lados)', mod.resolveClienteId('Nome Divergente', '11988887777'), 'cli1');
test('2. resolve clienteId por nome exato (case-insensitive) quando não há telefone', mod.resolveClienteId('maria souza', ''), 'cli2');
test('3. retorna vazio quando não há nenhum match', mod.resolveClienteId('Cliente Inexistente', '00000000000'), '');
mod.setClientes([]);
test('4. retorna vazio quando CLIENTES_DATA está vazio', mod.resolveClienteId('João da Silva', '11988887777'), '');

// ── finCRLinkedOS ───────────────────────────────────────────────────────
mod.setKbOs({ os1: { id: 'os1', num: '42', status: 'pronta', clientTel: '11999998888' } });
test('5. finCRLinkedOS encontra pelo osId gravado diretamente', mod.linkedOS({ osId: 'os1' }).id, 'os1');
test('6. finCRLinkedOS faz fallback pelo padrão textual "OS #N" quando não há osId', mod.linkedOS({ osRef: 'OS #42' }).id, 'os1');
test('7. finCRLinkedOS retorna null quando a OS referenciada não existe mais', mod.linkedOS({ osRef: 'OS #999' }), null);
test('8. finCRLinkedOS retorna null para lançamento manual sem osRef', mod.linkedOS({ descricao: 'Manual' }), null);

// ── finCRLinkedOrc ────────────────────────────────────────────────────
mod.setOrcamentos([{ id: 'orcA', num: '10' }, { id: 'orcB', num: '11' }]);
mod.setKbOs({ os1: { id: 'os1', num: '42', status: 'iniciada', orcRef: 'orcB' } });
test('9. finCRLinkedOrc encontra pelo orcamentoId gravado diretamente', mod.linkedOrc({ orcamentoId: 'orcA' }).id, 'orcA');
test('10. finCRLinkedOrc faz fallback via orcRef da OS vinculada', mod.linkedOrc({ osId: 'os1' }).id, 'orcB');
test('11. finCRLinkedOrc faz fallback pelo padrão textual "ORC-N"', mod.linkedOrc({ osRef: 'ORC-10' }).id, 'orcA');
test('12. finCRLinkedOrc retorna null quando nada bate', mod.linkedOrc({ osRef: 'ORC-999' }), null);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
