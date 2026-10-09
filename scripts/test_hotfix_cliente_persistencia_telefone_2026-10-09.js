/**
 * test_hotfix_cliente_persistencia_telefone_2026-10-09.js
 *
 * HOTFIX CIRÚRGICO 2026-10-09 — P0. Bug real relatado: um cliente que já
 * tinha orçamentos anteriores (ex.: "Maria Helena"/"Camila Stival") não
 * tinha o telefone/WhatsApp preenchido automaticamente ao abrir um NOVO
 * orçamento, mesmo selecionando o cliente certo no autocomplete.
 *
 * Causa raiz (achada por auditoria estática de index.html, não suposição):
 * orcAutoSalvarCliente()/orcLinkClienteOrcamento() — chamadas no fluxo de
 * salvar um orçamento — atualizavam tel/email/orcamentos/ultimoPedido de
 * um cliente JÁ EXISTENTE só em memória (CLIENTES_DATA, mutado no lugar),
 * mas nunca chamavam _cloudSave('clientes', CLIENTES_DATA) nesse ramo —
 * só o ramo de CRIAÇÃO de cliente novo persistia. Numa sessão/aba
 * diferente (ou após recarregar), CLIENTES_DATA volta do Firestore ainda
 * com o campo vazio: o autocomplete seleciona o cliente certo (por nome),
 * mas o telefone nunca tinha sido de fato salvo para ele preencher.
 *
 * Corrigido: as duas funções agora persistem via _cloudSave sempre que
 * mutam um cliente existente. Adicionalmente: (1) telefone é comparado
 * normalizado tolerando DDI "+55" (_clienteTelNormalizado), e (2) CPF/CNPJ
 * (orc.clienteDoc) entra como critério de matching de maior prioridade,
 * sem remover nenhum critério existente (nome continua funcionando como
 * apoio quando não há outro identificador).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas).
 *
 * Uso: node scripts/test_hotfix_cliente_persistencia_telefone_2026-10-09.js
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

var FN_NAMES = ['_clienteTelNormalizado', 'orcAutoSalvarCliente', 'orcLinkClienteOrcamento'];
var src = [
  'var CLIENTES_DATA = [];',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  getClientesData: function(){ return CLIENTES_DATA; },',
  '  setClientesData: function(v){ CLIENTES_DATA = v; },',
  '  orcAutoSalvarCliente: orcAutoSalvarCliente,',
  '  orcLinkClienteOrcamento: orcLinkClienteOrcamento,',
  '  _clienteTelNormalizado: _clienteTelNormalizado',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_cliente_persistencia_telefone_extracted.tmp.js');
fs.writeFileSync(modPath, src);

global.window = global;
global.document = { getElementById: function () { return null; } };
global._cloudSaveCalls = 0;
global._cloudSave = function (chave, dados) {
  if (chave === 'clientes') { global._cloudSaveCalls++; global._cloudSaveSnapshot = JSON.parse(JSON.stringify(dados)); }
};
global.renderClientes = function () {};

var mod = require(modPath);

console.log('\n=== HOTFIX 2026-10-09 (P0) — cliente existente deve ter telefone PERSISTIDO, não só em memória ===\n');

test('1. _clienteTelNormalizado tolera DDI "+55" sem confundir com um telefone realmente diferente', function () {
  assertEq(mod._clienteTelNormalizado('+55 11 98765-4321'), mod._clienteTelNormalizado('11987654321'), 'mesmo telefone com/sem +55 deve normalizar igual');
  assertTrue(mod._clienteTelNormalizado('11987654321') !== mod._clienteTelNormalizado('11987654322'), 'telefones de fato diferentes não podem normalizar igual');
});

test('2. P0 — cliente novo sem telefone; 1º orçamento chega com telefone → salva E PERSISTE (cloudSave chamado)', function () {
  mod.setClientesData([{ id: 'c1', nome: 'Maria Helena', tel: '', email: '', doc: '' }]);
  global._cloudSaveCalls = 0;

  mod.orcAutoSalvarCliente({ cliente: 'Maria Helena', tel: '(11) 98765-4321', email: '', clienteDoc: '' });

  var cli = mod.getClientesData()[0];
  assertEq(cli.tel, '(11) 98765-4321', 'telefone deve ser gravado no cadastro existente');
  assertTrue(global._cloudSaveCalls >= 1, 'BUG: atualização de telefone em cliente existente não pode ficar só em memória — precisa persistir (_cloudSave)');
});

test('3. P0 — "recarregar" (nova instância de CLIENTES_DATA vinda do snapshot persistido) mantém o telefone', function () {
  mod.setClientesData([{ id: 'c1', nome: 'Maria Helena', tel: '', email: '', doc: '' }]);
  global._cloudSaveCalls = 0;
  mod.orcAutoSalvarCliente({ cliente: 'Maria Helena', tel: '(11) 98765-4321', email: '', clienteDoc: '' });

  // simula reabrir em outra aba/sessão: CLIENTES_DATA é reconstruído a
  // partir do que foi de fato persistido (_cloudSaveSnapshot), não do que
  // ainda está na memória desta aba
  mod.setClientesData(JSON.parse(JSON.stringify(global._cloudSaveSnapshot)));

  var cli = mod.getClientesData().find(function (c) { return c.nome === 'Maria Helena'; });
  assertEq(cli.tel, '(11) 98765-4321', 'novo orçamento em outra sessão deve encontrar o telefone já persistido');
});

test('4. 2º orçamento do MESMO cliente (já com telefone) não duplica cadastro', function () {
  mod.setClientesData([{ id: 'c1', nome: 'Camila Stival', tel: '(11) 98765-4321', email: '', doc: '' }]);

  mod.orcAutoSalvarCliente({ cliente: 'Camila Stival', tel: '(11) 98765-4321', email: '', clienteDoc: '' });

  assertEq(mod.getClientesData().length, 1, 'não pode criar um segundo cadastro para o mesmo cliente');
});

test('5. telefone com "+55" bate com cadastro sem "+55" (tolerância de DDI evita duplicata)', function () {
  mod.setClientesData([{ id: 'c1', nome: 'Camila Stival', tel: '11987654321', email: '', doc: '' }]);
  global._cloudSaveCalls = 0;

  mod.orcAutoSalvarCliente({ cliente: 'Camila Stival', tel: '+55 11 98765-4321', email: '', clienteDoc: '' });

  assertEq(mod.getClientesData().length, 1, 'variação de formatação do mesmo telefone (+55) não pode criar duplicata');
});

test('6. CPF/CNPJ (clienteDoc) tem prioridade de matching — reconhece o mesmo cliente mesmo com nome digitado diferente', function () {
  mod.setClientesData([{ id: 'c1', nome: 'Camila Stival', tel: '', email: '', doc: '12345678900' }]);
  global._cloudSaveCalls = 0;

  mod.orcAutoSalvarCliente({ cliente: 'Camila S.', tel: '(11) 91111-1111', email: '', clienteDoc: '123.456.789-00' });

  assertEq(mod.getClientesData().length, 1, 'mesmo CPF (mesmo cliente) não pode criar duplicata só por nome digitado diferente');
  assertEq(mod.getClientesData()[0].tel, '(11) 91111-1111', 'telefone deve ser completado no cadastro encontrado via CPF');
});

test('7. orcLinkClienteOrcamento: histórico de orçamentos do cliente existente também persiste (_cloudSave chamado)', function () {
  mod.setClientesData([{ id: 'c1', nome: 'Maria Helena', tel: '(11) 98765-4321', email: '', doc: '', orcamentos: [] }]);
  global._cloudSaveCalls = 0;

  mod.orcLinkClienteOrcamento({ id: 'orc1', num: '001', cliente: 'Maria Helena', tel: '(11) 98765-4321', email: '', dataSalvo: '09/10/2026', valorFinal: 500, produto: 'Caixa' });

  var cli = mod.getClientesData()[0];
  assertEq(cli.orcamentos.length, 1, 'orçamento deve ser vinculado ao histórico do cliente');
  assertTrue(global._cloudSaveCalls >= 1, 'BUG: vínculo de orçamento ao histórico do cliente não pode ficar só em memória');
});

test('8. cliente "(não informado)"/"Cliente" (placeholder) nunca gera cadastro', function () {
  mod.setClientesData([]);
  mod.orcAutoSalvarCliente({ cliente: '(não informado)', tel: '', email: '' });
  mod.orcAutoSalvarCliente({ cliente: 'Cliente', tel: '', email: '' });
  assertEq(mod.getClientesData().length, 0, 'placeholders de "sem cliente" não podem virar cadastro real');
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
fs.unlinkSync(modPath);
if (failed > 0) process.exitCode = 1;
