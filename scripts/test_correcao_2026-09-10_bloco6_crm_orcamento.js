/**
 * test_correcao_2026-09-10_bloco6_crm_orcamento.js
 *
 * RODADA DE CORREÇÃO 2026-09-10, Bloco 6 — causa raiz confirmada na
 * auditoria funcional em produção: o botão "💰 Criar Orçamento" no card
 * do lead do CRM fazia só `crmCloseModal();nav('orcamento',null)` — nunca
 * passava nome/telefone/id do lead para o Novo Orçamento, que abria
 * totalmente vazio mesmo quando a Valéria já tinha capturado o telefone
 * do WhatsApp (CRM_LEADS[id].tel preenchido).
 *
 * Corrigido: crmAbrirOrcamentoDoLead(id) monta uma seed
 * (_orcPendingClienteSeed) a partir do lead; _orcAplicarClienteSeedPendente()
 * (chamada por orcResetFormularioVR()) consome essa seed e preenche
 * orcClientNome/orcClientTel/orcClientEmail/orcClientCidade uma única vez.
 *
 * Extrai as funções reais AO VIVO de index.html (nunca reimplementadas
 * aqui) — falha no código anterior, passa depois da correção.
 *
 * Uso: node scripts/test_correcao_2026-09-10_bloco6_crm_orcamento.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
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

console.log('\n=== Bloco 6 — CRM/Lead → Criar Orçamento → Novo Orçamento hidratado ===\n');

var FN_NAMES = ['crmAbrirOrcamentoDoLead', '_orcAplicarClienteSeedPendente'];
var modSrc = [
  'var CRM_LEADS = global.__CRM_LEADS__;',
  'var _orcPendingClienteSeed = null;',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  criarOrcamentoDoLead: crmAbrirOrcamentoDoLead,',
  '  aplicarSeedPendente: _orcAplicarClienteSeedPendente,',
  '  getSeed: function(){ return _orcPendingClienteSeed; }',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_correcao_2026-09-10_bloco6_extracted.tmp.js');
fs.writeFileSync(modPath, modSrc);

function makeInput() { return { value: '' }; }
var FIELDS = ['orcClientNome', 'orcClientTel', 'orcClientEmail', 'orcClientDoc', 'orcClientCidade', 'orcEmpresaSel', 'orcTipoClienteSel'];
var _elements = {};
function resetDom() {
  _elements = {};
  FIELDS.forEach(function (id) { _elements[id] = makeInput(); });
}
global.window = global;
global.document = { getElementById: function (id) { return _elements[id]; } };
global.showToast = function () {};
global.orcAtualizarResumo = function () {};
global.orcEmpresaChange = function () {};
global.nav = function () {};
global.crmCloseModal = function () {};

function loadModule(leads) {
  resetDom();
  global.__CRM_LEADS__ = leads;
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

// ── Teste 1+2: fluxo completo lead com telefone → seed → campos do DOM ──
(function () {
  var mod = loadModule({
    lead_wa: { contato: 'Auditoria Teste Whatsapp Telefone', tel: '11900000000', email: '', cidade: '', marca: 'vr' }
  });
  mod.criarOrcamentoDoLead('lead_wa');

  test('BLOCO 6.1 — crmAbrirOrcamentoDoLead() monta a seed com nome+telefone do lead (antes: nada era passado)', function () {
    var seed = mod.getSeed();
    assertEq(!!seed, true, 'BUG: nenhuma seed foi criada — Criar Orçamento continua sem contexto');
    assertEq(seed.nome, 'Auditoria Teste Whatsapp Telefone', 'seed.nome deve vir do lead');
    assertEq(seed.tel, '11900000000', 'seed.tel deve vir do lead');
  });

  mod.aplicarSeedPendente();
  test('BLOCO 6.2 — Novo Orçamento abre com orcClientNome/orcClientTel preenchidos (BUG original: ficavam "")', function () {
    assertEq(_elements.orcClientNome.value, 'Auditoria Teste Whatsapp Telefone', 'BUG: orcClientNome continua vazio');
    assertEq(_elements.orcClientTel.value, '11900000000', 'BUG: orcClientTel continua vazio — era exatamente o achado da auditoria');
  });

  test('BLOCO 6.3 — seed é consumida uma única vez (reset seguinte sem novo lead não reaplica nada)', function () {
    assertEq(mod.getSeed(), null, 'seed deveria ter sido zerada após o consumo em aplicarSeedPendente()');
    _elements.orcClientNome.value = ''; // simula o reset real limpando o campo de novo
    mod.aplicarSeedPendente(); // sem seed pendente — não deve reescrever nada
    assertEq(_elements.orcClientNome.value, '', 'sem seed pendente, o campo deve continuar vazio (não reaplica dado antigo)');
  });
})();

// ── Teste 4: telefone placeholder/inválido não é propagado ──
(function () {
  var mod = loadModule({
    lead_placeholder: { contato: 'Cliente Sem Tel Real', tel: '{user-phone-number}', email: '—', cidade: '—', marca: 'vr' }
  });
  mod.criarOrcamentoDoLead('lead_placeholder');
  test('BLOCO 6.4 — telefone placeholder/inválido do lead não é propagado como se fosse um telefone real', function () {
    assertEq(mod.getSeed().tel, '', 'BUG: placeholder "{user-phone-number}" foi tratado como telefone válido');
  });
})();

// ── Teste 5: lead sem qualquer dado (id inexistente) não quebra a navegação ──
(function () {
  var mod = loadModule({});
  test('BLOCO 6.5 — lead inexistente não lança exceção; apenas navega sem seed', function () {
    mod.criarOrcamentoDoLead('id_que_nao_existe');
    assertEq(mod.getSeed(), null, 'sem lead encontrado, nenhuma seed deve ser criada');
  });
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
