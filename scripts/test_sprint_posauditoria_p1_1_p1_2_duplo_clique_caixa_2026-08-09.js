/**
 * test_sprint_posauditoria_p1_1_p1_2_duplo_clique_caixa_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.1/P1.2 — a auditoria read-only
 * encontrou que finCaixaAjusteSalvar()/finCaixaRegistrarAjuste() e
 * finBaixaManual() não tinham guard síncrono de reentrância — só
 * confiavam em _btnBusy()/Date.now(), que não bloqueiam de forma
 * confiável um duplo clique real (o guard síncrono é sempre a primeira
 * linha de defesa; _btnBusy é só a camada visual).
 *
 * Corrigido: ambas as funções agora seguem o mesmo padrão já usado no
 * resto do app (_orcSalvarEmVoo, os._marcandoPronto, os._liberando) —
 * uma flag booleana em memória, checada SINCRONAMENTE antes de qualquer
 * outra coisa, que só é liberada depois que a gravação (ou falha) já foi
 * confirmada.
 *
 * T5 (obrigatório): 10 chamadas simultâneas → exatamente 1 movimento
 * financeiro real, para as duas ações.
 *
 * Uso: node scripts/test_sprint_posauditoria_p1_1_p1_2_duplo_clique_caixa_2026-08-09.js
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

var src = [
  'var FIN_CAIXA_AJUSTES = []; var FIN_TX = []; var _toasts = [];',
  'function showToast(msg, tipo){ _toasts.push({msg:msg, tipo:tipo}); }',
  "var _finBtns = {};",
  "function _mkEl(id, props){ var e = Object.assign({id:id}, props||{}); _finBtns[id]=e; return e; }",
  "var _finEls = {",
  "  finCaixaAjusteData: {value:'2026-08-09'}, finCaixaAjusteValor: {value:'100'}, finCaixaAjusteMotivo: {value:'ajuste de teste'},",
  "  finCaixaAjusteOverlay: {classList:{remove:function(){}}},",
  "};",
  "var document = { getElementById: function(id){ return _finEls[id]; } };",
  extractFn('_btnBusy'),
  'function relCaixaDiario(){}',
  "function finFmt(v){ return 'R$ '+(v||0).toFixed(2); }",
  'function _finSaveCaixaAjustes(){ return Promise.resolve({ok:true}); }',
  'function _cloudSave(key, data){ return Promise.resolve({ok:true}); }',
  extractFn('_confirmarAposSalvar'),
  extractFn('finCaixaBRtoISO'),
  extractFn('finCaixaRegistrarAjuste'),
  extractVarDecl('_finCaixaAjustandoEmVoo'),
  extractFn('finCaixaAjusteSalvar'),
  'function finRender(){} function finDashKPIs(){}',
  extractVarDecl('_finBaixaManualEmVoo'),
  extractFn('finBaixaManual'),
  'module.exports = {',
  '  ajusteSalvar: finCaixaAjusteSalvar, baixaManual: finBaixaManual,',
  '  getAjustes: function(){ return FIN_CAIXA_AJUSTES; }, getTx: function(){ return FIN_TX; },',
  '  resetAjustes: function(){ FIN_CAIXA_AJUSTES = []; }, resetTx: function(){ FIN_TX = []; },',
  '  mkBtn: function(){ return {disabled:false, innerHTML:""}; },',
  '  getToasts: function(){ return _toasts; }, clearToasts: function(){ _toasts = []; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_p1_1_2_duplo_clique_caixa_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.1/P1.2 — Duplo clique: Ajuste de Caixa / Baixa Manual ===\n');

function espera(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

// ─────────────────────────────────────────────────────────────────────────
// T5.1 — Ajuste de Caixa: 10 chamadas síncronas (mesmo padrão de um
// usuário clicando o botão 10x rapidamente) → exatamente 1 ajuste real.
// Encadeado numa única cadeia de promises (nunca disparado solto) para
// que o in-flight de uma etapa nunca vaze para a próxima etapa do teste.
// ─────────────────────────────────────────────────────────────────────────
Promise.resolve().then(function () {
  mod.resetAjustes(); mod.clearToasts();
  var btn = mod.mkBtn();
  for (var i = 0; i < 10; i++) { mod.ajusteSalvar(btn); }
  test('1. Ajuste de Caixa — 10 chamadas síncronas → exatamente 1 ajuste criado em FIN_CAIXA_AJUSTES', mod.getAjustes().length, 1);
  test('2. ...as 9 chamadas extras foram recusadas com aviso claro ("já em andamento")',
    mod.getToasts().filter(function (t) { return /já em andamento/.test(t.msg); }).length, 9);
  return espera(20); // deixa a 1ª operação (a única que passou) concluir de verdade antes do próximo bloco
})
// ─────────────────────────────────────────────────────────────────────────
// T5.1b — depois que a primeira operação termina (promise resolvida), a
// flag é liberada e uma NOVA chamada volta a funcionar normalmente
// (não fica travado para sempre).
// ─────────────────────────────────────────────────────────────────────────
.then(function () {
  mod.resetAjustes(); mod.clearToasts();
  mod.ajusteSalvar(mod.mkBtn());
  return espera(20).then(function () {
    mod.ajusteSalvar(mod.mkBtn());
    return espera(20).then(function () {
      test('3. depois que a 1ª operação conclui, a flag libera e uma 2ª chamada (legítima, não duplo clique) funciona normalmente',
        mod.getAjustes().length, 2);
    });
  });
})
// ─────────────────────────────────────────────────────────────────────────
// T5.2 — Baixa Manual: 10 chamadas síncronas → exatamente 1 movimento em
// FIN_TX. prompt()/confirm() não estão definidos no Node — stub inline
// simulando o vendedor digitando "50" e confirmando "VR".
// ─────────────────────────────────────────────────────────────────────────
.then(function () { return espera(20); })
.then(function () {
  global.prompt = function () { return '50'; };
  global.confirm = function () { return true; };
  mod.resetTx(); mod.clearToasts();
  for (var i = 0; i < 10; i++) { mod.baixaManual('vr'); }
  test('4. Baixa Manual — 10 chamadas síncronas → exatamente 1 movimento criado em FIN_TX', mod.getTx().length, 1);
  test('5. ...as 9 chamadas extras foram recusadas com aviso claro ("já em andamento")',
    mod.getToasts().filter(function (t) { return /já em andamento/.test(t.msg); }).length, 9);
  test('6. o único movimento gravado tem o valor correto (nunca duplicado nem perdido)', mod.getTx()[0].valor, 50);
})
.then(function () {
  try { fs.unlinkSync(modPath); } catch (e) {}
  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})
.catch(function (e) {
  console.error('ERRO INESPERADO NO TESTE:', e);
  try { fs.unlinkSync(modPath); } catch (e2) {}
  process.exitCode = 1;
});
