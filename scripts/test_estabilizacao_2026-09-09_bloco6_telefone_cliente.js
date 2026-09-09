/**
 * test_estabilizacao_2026-09-09_bloco6_telefone_cliente.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-09, BLOCO 6 — telefone/WhatsApp de
 * clientes reconhecidos ficava vazio/perdido em vários pontos:
 *
 * 1. _orcSalvarOrcamentoImpl() (index.html) lia orcClientTel só do DOM,
 *    sem fallback para orcExistente.tel quando o campo estava
 *    momentaneamente vazio — mesma classe de bug já corrigida antes para
 *    `vendedor` (padrão _vendedorDom || existente.vendedor). Verificado
 *    aqui por asserção estática (a função é grande demais, com muitas
 *    dependências assíncronas/Firestore, para extração isolada — mesmo
 *    padrão de correção já comprovado pelo fix idêntico de `vendedor`).
 *
 * 2. crmUpsertLeadPorOrcamento() sobrescrevia o card do CRM por completo
 *    a cada save do orçamento, sem preservar `tel` quando orc.tel vinha
 *    vazio (preservava temp/score/cor, mas não tel) — TESTADO ABAIXO.
 *
 * 3. _crmVincularCliente() encontrava cliente duplicado por nome mas
 *    nunca enriquecia um telefone vazio no cadastro já existente com o
 *    telefone do lead/atendimento que originou o vínculo — TESTADO ABAIXO.
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_bloco6_telefone_cliente.js
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

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-09 — Bloco 6: telefone/WhatsApp do cliente ===\n');

// ── Asserção estática 1: _orcSalvarOrcamentoImpl preserva tel existente ──
test('BLOCO 6.1 — _orcSalvarOrcamentoImpl() nunca apaga orcExistente.tel com uma leitura vazia do DOM', function () {
  var fnSrc = extractFn('_orcSalvarOrcamentoImpl');
  assertTrue(/var _tel\s*=\s*_telDom\s*\|\|\s*\(orcExistente\s*&&\s*orcExistente\.tel\)\s*\|\|\s*''/.test(fnSrc),
    'BUG: leitura de tel não tem fallback para orcExistente.tel (mesmo padrão já usado para vendedor)');
});

// ── crmUpsertLeadPorOrcamento: preserva tel do card existente ──
var FN_NAMES_CRM = ['_isTestRecord', 'crmUpsertLeadPorOrcamento'];
var srcCrm = [
  'var CRM_LEADS = global.__CRM_LEADS__;',
  'var crmLeadIdCounter = 0;',
  FN_NAMES_CRM.map(extractFn).join('\n\n'),
  'module.exports = { crmUpsertLeadPorOrcamento: crmUpsertLeadPorOrcamento, getLeads: function(){ return CRM_LEADS; } };'
].join('\n\n');
var modCrmPath = path.join(__dirname, '_estabilizacao_2026-09-09_bloco6_crm_extracted.tmp.js');
fs.writeFileSync(modCrmPath, srcCrm);

global.window = global;
global.document = { getElementById: function () { return null; }, querySelectorAll: function () { return []; } };
global.orcFmt = function (v) { return (v || 0).toFixed(2); };
global.crmSaveLeads = function () {};
global.__CRM_LEADS__ = { lead1: { etapa: 'orc_emitido', temp: 'morno', score: 40, cor: '#ABC', tel: '11988887777' } };
var modCrm = require(modCrmPath);

test('BLOCO 6.2 — crmUpsertLeadPorOrcamento() preserva o telefone já registrado no card quando orc.tel vem vazio', function () {
  var orc = { crmLeadId: 'lead1', cliente: 'Fulano de Tal', marca: 'vr', produto: 'Caixa', tel: '', email: '', valorFinal: 100 };
  modCrm.crmUpsertLeadPorOrcamento(orc, 42);
  var lead = modCrm.getLeads()['lead1'];
  assertEq(lead.tel, '11988887777', 'BUG: telefone do card do CRM foi apagado por um orc.tel vazio');
});

test('BLOCO 6.2b — REGRESSÃO: crmUpsertLeadPorOrcamento() ainda atualiza o telefone quando orc.tel vem preenchido', function () {
  var orc = { crmLeadId: 'lead1', cliente: 'Fulano de Tal', marca: 'vr', produto: 'Caixa', tel: '11999990000', email: '', valorFinal: 100 };
  modCrm.crmUpsertLeadPorOrcamento(orc, 43);
  var lead = modCrm.getLeads()['lead1'];
  assertEq(lead.tel, '11999990000', 'telefone novo informado deve continuar atualizando o card normalmente');
});

// ── _crmVincularCliente: enriquece telefone vazio de cliente já cadastrado ──
var FN_NAMES_VINC = ['_crmNormalizarNome', '_crmNormalizarTel', '_crmBuscarClienteDuplicado', '_crmAdicionarBadgeCliente', '_crmVincularCliente'];
var srcVinc = [
  'var CLIENTES_DATA = global.__CLIENTES_DATA__;',
  'var CRM_LEADS = global.__CRM_LEADS2__;',
  'var _cliIdCounter = 0;',
  FN_NAMES_VINC.map(extractFn).join('\n\n'),
  'module.exports = { _crmVincularCliente: _crmVincularCliente, getClientes: function(){ return CLIENTES_DATA; } };'
].join('\n\n');
var modVincPath = path.join(__dirname, '_estabilizacao_2026-09-09_bloco6_vinc_extracted.tmp.js');
fs.writeFileSync(modVincPath, srcVinc);

global._cloudSave = function () {};
global._cloudReady = false;
global.__CLIENTES_DATA__ = [{ id: 'c1', nome: 'Maria Souza', tel: '', email: '—' }];
global.__CRM_LEADS2__ = { leadX: {} };
var modVinc = require(modVincPath);

test('BLOCO 6.3 — _crmVincularCliente() enriquece o telefone de um cliente já cadastrado sem telefone (achado por nome)', function () {
  modVinc._crmVincularCliente('leadX', 'Maria Souza', '11977776666', '', 'vr');
  var cli = modVinc.getClientes().find(function (c) { return c.id === 'c1'; });
  assertTrue(cli.tel === '11977776666', 'BUG: cliente reconhecido por nome não ganhou o telefone do lead/atendimento');
});

test('BLOCO 6.3b — REGRESSÃO: _crmVincularCliente() nunca sobrescreve um telefone já válido', function () {
  global.__CLIENTES_DATA__.length = 0;
  global.__CLIENTES_DATA__.push({ id: 'c2', nome: 'Joao Pereira', tel: '11933334444', email: '—' });
  modVinc._crmVincularCliente('leadX', 'Joao Pereira', '11900001111', '', 'vr');
  var cli = modVinc.getClientes().find(function (c) { return c.id === 'c2'; });
  assertEq(cli.tel, '11933334444', 'telefone já válido do cliente nunca pode ser trocado só por casar o nome de novo lead');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
