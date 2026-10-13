/**
 * test_hotfix_cp_editor_completo_2026-10-13.js
 *
 * RODADA CIRÚRGICA 2026-10-13, BLOCO B — "Contas a Pagar não permite
 * editar vencimento". finCPEditarUnicaUI()/finCPEditarFuturasUI() usavam
 * só prompt() para descrição/fornecedor (e categoria/dia, no caso da
 * série) — o Vencimento de uma ocorrência individual nunca era editável
 * em lugar nenhum da UI. Upgrade para um modal real (#finCPEditOverlay)
 * expondo Fornecedor/Descrição/Categoria/Valor/Vencimento/Observação
 * (campo novo) em "Editar só esta", e Fornecedor/Descrição/Categoria/Dia
 * de vencimento em "Editar esta e próximas" (reaproveitando a função pura
 * já existente finCPEditarFuturas — nunca duplicada).
 *
 * Gates FIN-EDIT-01 a 07 do pedido, com uma CONTA AVULSA simples (não
 * recorrente) — ver também test_sprint_posauditoria_p1_8_9_10_cp_recorrencia_variavel_2026-08-09.js
 * para a cobertura completa de série/recorrência (editar só esta vs esta
 * e próximas, valor "a informar", auditoria).
 *
 * Uso: node scripts/test_hotfix_cp_editor_completo_2026-10-13.js
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
function extractVarDecl(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

var FN_NAMES = ['finCPBloqueadaPorPagamento', 'finCPEditModoAplicar', 'finCPEditOverlayClose', 'finCPEditarUnicaUI', 'finCPEditSalvar'];
function _mkEl(v) { return { value: v || '', textContent: '', style: {}, classList: { add: function () {}, remove: function () {} } }; }
var _elsSrc = "var _els = { finCPEditOverlay:{classList:{add:function(){},remove:function(){}}}," +
  "finCPEditTitulo:_mkEl(),finCPEditForn:_mkEl(),finCPEditDesc:_mkEl(),finCPEditCat:_mkEl()," +
  "finCPEditValor:_mkEl(),finCPEditVenc:_mkEl(),finCPEditComp:_mkEl(),finCPEditObs:_mkEl(),finCPEditDia:_mkEl()," +
  "finCPEditAvisoSerie:_mkEl(),finCPEditValorWrap:_mkEl(),finCPEditVencWrap:_mkEl(),finCPEditDiaWrap:_mkEl(),finCPEditCompWrap:_mkEl(),finCPEditObsWrap:_mkEl() };";

var src = [
  'var FIN_CP = []; var _auditLogs = []; var _toasts = []; var _savedCP = 0;',
  'function _mkEl(v){ return { value: v||"", textContent:"", style:{}, classList:{ add:function(){}, remove:function(){} } }; }',
  _elsSrc,
  'var document = { getElementById: function(id){ return _els[id]; } };',
  'function showToast(msg, tipo){ _toasts.push({msg:msg, tipo:tipo}); }',
  'function secAuditLog(action, detail){ _auditLogs.push({action:action, detail:detail}); }',
  'function _btnBusy(){ return function(){}; }',
  'function _finSaveCP(){ _savedCP++; return Promise.resolve({ok:true}); }',
  'function finCPRender(){}',
  'function finDashKPIs(){}',
  'function finDonutRender(){}',
  FN_NAMES.map(extractFn).join('\n\n'),
  extractVarDecl('_finCPEditState'),
  extractVarDecl('_finCPEditSalvando'),
  'module.exports = {',
  '  setCP: function(v){ FIN_CP = v; }, getCP: function(){ return FIN_CP; },',
  '  editarUnicaUI: finCPEditarUnicaUI,',
  '  editSalvar: function(){ return finCPEditSalvar({}); },',
  '  setField: function(id, v){ _els[id].value = v; },',
  '  getField: function(id){ return _els[id].value; },',
  '  getAuditLogs: function(){ return _auditLogs; },',
  '  getSavedCPCalls: function(){ return _savedCP; }, resetSavedCPCalls: function(){ _savedCP = 0; },',
  '  resetSalvando: function(){ _finCPEditSalvando = false; },',
  '  isEditando: function(){ return !!_finCPEditState; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_cp_editor_completo_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== HOTFIX 2026-10-13 (Bloco B) — editor completo de Conta a Pagar (conta avulsa) ===\n');

function fixtureAvulsa() {
  return [{ id: 'cpX', descricao: 'Aluguel do galpão', categoria: 'Operacional', valor: 100, valorPendente: null, vencimento: '10/10/2026', status: 'agendado', fornecedor: 'Imobiliária Lima', marca: 'vr', tipo: 'avulsa', dataCriacao: '01/10/2026', dataPagamento: null }];
}

// FIN-EDIT-01 — vencimento 10/10 → 15/10, persiste.
mod.setCP(fixtureAvulsa());
mod.editarUnicaUI('cpX');
mod.setField('finCPEditVenc', '2026-10-15');
mod.editSalvar();
{
  var cp1 = mod.getCP().find(function (x) { return x.id === 'cpX'; });
  test('FIN-EDIT-01: vencimento 10/10/2026 → 15/10/2026', cp1.vencimento, '15/10/2026');
  test('FIN-EDIT-01b: _finSaveCP() foi chamado (persistiu de verdade)', mod.getSavedCPCalls() >= 1, true);
}

// FIN-EDIT-02 — valor R$100 → R$150, persiste.
mod.setCP(fixtureAvulsa()); mod.resetSalvando();
mod.editarUnicaUI('cpX');
mod.setField('finCPEditValor', '150');
mod.editSalvar();
{
  var cp2 = mod.getCP().find(function (x) { return x.id === 'cpX'; });
  test('FIN-EDIT-02: valor R$100 → R$150', cp2.valor, 150);
}

// FIN-EDIT-03 — fornecedor/categoria/descrição.
mod.setCP(fixtureAvulsa()); mod.resetSalvando();
mod.editarUnicaUI('cpX');
mod.setField('finCPEditForn', 'Imobiliária Costa e Silva');
mod.setField('finCPEditCat', 'Pessoal Admin');
mod.setField('finCPEditDesc', 'Aluguel do galpão novo');
mod.editSalvar();
{
  var cp3 = mod.getCP().find(function (x) { return x.id === 'cpX'; });
  test('FIN-EDIT-03: fornecedor/categoria/descrição persistem corretamente',
    [cp3.fornecedor, cp3.categoria, cp3.descricao],
    ['Imobiliária Costa e Silva', 'Pessoal Admin', 'Aluguel do galpão novo']);
}
// (FIN-EDIT-04/05 — "editar só esta" vs "esta e próximas" em série real —
// cobertos em test_sprint_posauditoria_p1_8_9_10_cp_recorrencia_variavel_2026-08-09.js,
// testes 5/6/8/9, que já validam ambos os modos lado a lado.)

// FIN-EDIT-06 — duplo clique em Salvar não duplica/reprocessa a conta.
mod.setCP(fixtureAvulsa()); mod.resetSalvando(); mod.resetSavedCPCalls();
mod.editarUnicaUI('cpX');
mod.setField('finCPEditValor', '200');
mod.editSalvar(); // 1º clique — processa e marca _finCPEditSalvando=true até a Promise resolver
mod.editSalvar(); // 2º clique "no mesmo instante" (Promise ainda não resolveu) — tem que ser NO-OP
{
  test('FIN-EDIT-06: duplo clique síncrono em Salvar só processa UMA vez (_finSaveCP chamado 1x)', mod.getSavedCPCalls(), 1);
  test('FIN-EDIT-06b: a conta não duplicou — continua 1 registro', mod.getCP().length, 1);
}

// FIN-EDIT-07 — conta paga não permite mutação financeira silenciosa.
mod.setCP([Object.assign({}, fixtureAvulsa()[0], { status: 'pago', dataPagamento: '10/10/2026' })]); mod.resetSalvando();
{
  var antesPaga = JSON.stringify(mod.getCP()[0]);
  mod.editarUnicaUI('cpX'); // deve bloquear e NUNCA abrir o estado de edição
  test('FIN-EDIT-07: conta já PAGA — editarUnicaUI nunca entra em modo de edição', mod.isEditando(), false);
  mod.setField('finCPEditValor', '9999'); // mesmo tentando mexer no campo...
  mod.editSalvar(); // ...editSalvar não tem estado ativo — no-op garantido
  var depoisPaga = JSON.stringify(mod.getCP()[0]);
  test('FIN-EDIT-07b: nenhum campo da conta paga mudou (histórico imutável)', depoisPaga, antesPaga);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
fs.unlinkSync(modPath);
if (failed > 0) process.exitCode = 1;
