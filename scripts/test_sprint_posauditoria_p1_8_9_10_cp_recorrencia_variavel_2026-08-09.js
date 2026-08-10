/**
 * test_sprint_posauditoria_p1_8_9_10_cp_recorrencia_variavel_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.8/P1.9/P1.10 — a auditoria
 * read-only encontrou três lacunas na recorrência variável de Contas a
 * Pagar: (1) nenhuma referência ao valor do mês anterior era mostrada ao
 * informar uma nova competência; (2) finCPEditarFuturas() existia como
 * função pura mas não tinha NENHUMA ação de UI que a acionasse — nem
 * "editar só esta" existia de fato, apesar do comentário afirmar que sim;
 * (3) não havia contador consolidado de "X despesas aguardando valor".
 *
 * Corrigido:
 * - finCPValorCompetenciaAnterior()/finCPInformarValorUI(): mostra
 *   "Último mês: R$X" no prompt (nunca pré-preenche o valor).
 * - finCPEditarUnicaUI(): edita descrição/fornecedor de UMA competência
 *   específica (nunca uma já paga, nunca toca a recorrência-mãe).
 * - finCPEditarFuturasUI(): UI real sobre finCPEditarFuturas() já
 *   existente — encerra a série antiga e cria uma nova a partir da
 *   competência de corte; pagas e histórico nunca são tocados.
 * - finCPContarPendentesMesAtual()/finCPToggleFiltroPendente(): contador
 *   no card "Aguardando Valor (mês)", clicável para filtrar a lista.
 *
 * T9 (obrigatório): Agosto R$997,34; Setembro nasce "a informar"; UI
 * mostra "Último mês R$997,34"; Editar esta não altera Outubro; Editar
 * esta e futuras altera Outubro em diante; Agosto pago não muda.
 *
 * Uso: node scripts/test_sprint_posauditoria_p1_8_9_10_cp_recorrencia_variavel_2026-08-09.js
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

var FN_NAMES = [
  'finCPCompetenciaStr', 'finCPParseISO', 'finCPProximasCompetencias', 'finCPVencimentoDaCompetencia', 'finCPGerarOcorrencias', 'finCPValorCompetenciaAnterior', 'finCPInformarValor',
  'finCPEditarFuturas', 'finCPCompetenciaAtualStr', 'finCPContarPendentesMesAtual',
];
var src = [
  'var FIN_CP = []; var FIN_CP_RECORRENCIAS = []; var _toasts = []; var _prompts = []; var _promptRespostas = [];',
  'function showToast(msg, tipo){ _toasts.push({msg:msg, tipo:tipo}); }',
  'function prompt(msg, def){ _prompts.push(msg); return _promptRespostas.length ? _promptRespostas.shift() : null; }',
  'function confirm(msg){ return true; }',
  "var _finEls = { finCPSumPendenteValorCard: { style: {} } };",
  "var document = { getElementById: function(id){ return _finEls[id]; } };",
  'function _finSaveCP(){ return Promise.resolve({ok:true}); }',
  'function _finSaveCPRecorrencias(){ return Promise.resolve({ok:true}); }',
  'function finCPRender(){}',
  'function finDashKPIs(){}',
  'function finDonutRender(){}',
  'function finFmt(v){ return "R$ "+(v||0).toFixed(2).replace(".", ","); }',
  FN_NAMES.map(extractFn).join('\n\n'),
  extractVarDecl('_finCPFiltroSoPendentes'),
  extractFn('finCPToggleFiltroPendente'),
  extractFn('finCPInformarValorUI'),
  extractFn('finCPEditarUnicaUI'),
  extractFn('finCPEditarFuturasUI'),
  'module.exports = {',
  '  valorAnterior: finCPValorCompetenciaAnterior, informarValor: finCPInformarValor, informarValorUI: finCPInformarValorUI,',
  '  editarUnicaUI: finCPEditarUnicaUI, editarFuturasUI: finCPEditarFuturasUI, editarFuturas: finCPEditarFuturas,',
  '  contarPendentesMesAtual: finCPContarPendentesMesAtual, competenciaAtual: finCPCompetenciaAtualStr,',
  '  toggleFiltro: finCPToggleFiltroPendente,',
  '  setCP: function(v){ FIN_CP = v; }, getCP: function(){ return FIN_CP; },',
  '  setRec: function(v){ FIN_CP_RECORRENCIAS = v; }, getRec: function(){ return FIN_CP_RECORRENCIAS; },',
  '  getPrompts: function(){ return _prompts; }, clearPrompts: function(){ _prompts = []; },',
  '  setPromptRespostas: function(v){ _promptRespostas = v.slice(); },',
  '  getFiltroAtivo: function(){ return _finCPFiltroSoPendentes; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_p1_8_9_10_cp_recorrencia_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P1.8/P1.9/P1.10 — Recorrência Variável de CP ===\n');

function fixtureSerie() {
  return {
    cp: [
      { id: 'cpAgo', descricao: 'Energia', fornecedor: 'Cia Elétrica', categoria: 'Operacional', recorrenciaId: 'recEnergia', competencia: '2026-06', vencimento: '10/06/2026', status: 'pago', valor: 997.34, valorPendente: false, dataPagamento: '10/06/2026' },
      { id: 'cpSet', descricao: 'Energia', fornecedor: 'Cia Elétrica', categoria: 'Operacional', recorrenciaId: 'recEnergia', competencia: '2026-07', vencimento: '10/07/2026', status: 'agendado', valor: null, valorPendente: true },
      { id: 'cpOut', descricao: 'Energia', fornecedor: 'Cia Elétrica', categoria: 'Operacional', recorrenciaId: 'recEnergia', competencia: '2026-08', vencimento: '10/08/2026', status: 'agendado', valor: null, valorPendente: true },
    ],
    rec: [
      { id: 'recEnergia', descricao: 'Energia', categoria: 'Operacional', fornecedor: 'Cia Elétrica', tipoRecorrencia: 'variavel', valor: null, diaVencimento: 10, marca: 'vr', ativa: true, competenciasCanceladas: [] },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1-3. T9 — Agosto (aqui "cpAgo", competência 2026-06 por simplicidade de
// data) R$997,34; Setembro ("cpSet") nasce "a informar"; referência ao
// mês anterior é exibida corretamente.
// ─────────────────────────────────────────────────────────────────────────
mod.setCP(fixtureSerie().cp); mod.setRec(fixtureSerie().rec);
test('1. finCPValorCompetenciaAnterior(cpSet) retorna R$997,34 (valor da competência anterior JÁ informada)',
  mod.valorAnterior('cpSet'), 997.34);
test('2. finCPValorCompetenciaAnterior(cpAgo) retorna null (não há competência anterior na série)',
  mod.valorAnterior('cpAgo'), null);

mod.clearPrompts(); mod.setPromptRespostas(['1050.00']);
mod.informarValorUI('cpSet');
{
  var msg = mod.getPrompts()[0];
  test('3. finCPInformarValorUI() mostra "Último mês: R$ 997,34" no texto do prompt (referência, nunca pré-preenchida)',
    /Último mês: R\$ 997,34/.test(msg), true);
  var cpSet = mod.getCP().find(function (x) { return x.id === 'cpSet'; });
  test('3b. ...o valor informado (R$1050,00) foi gravado corretamente, não o valor de referência', cpSet.valor, 1050);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Sem competência anterior informada — nenhuma referência aparece
// (nunca mostra "Último mês: R$0,00" nem confunde pendente com R$0).
// ─────────────────────────────────────────────────────────────────────────
mod.setCP(fixtureSerie().cp); mod.setRec(fixtureSerie().rec);
mod.clearPrompts(); mod.setPromptRespostas(['500']);
mod.informarValorUI('cpAgo'); // cpAgo já está 'pago' no fixture — vamos usar um cenário limpo:
{
  var soloFixture = [{ id: 'cpSolo', descricao: 'Água', recorrenciaId: 'recAgua', competencia: '2026-06', vencimento: '05/06/2026', status: 'agendado', valor: null, valorPendente: true }];
  mod.setCP(soloFixture); mod.clearPrompts(); mod.setPromptRespostas(['150']);
  mod.informarValorUI('cpSolo');
  test('4. primeira competência da série (sem histórico anterior) — prompt SEM "Último mês" (nunca inventa referência)',
    /Último mês/.test(mod.getPrompts()[0]), false);
}

// ─────────────────────────────────────────────────────────────────────────
// 5-6. P1.9 — "Editar só esta": não altera outras competências da série.
// ─────────────────────────────────────────────────────────────────────────
mod.setCP(fixtureSerie().cp); mod.setRec(fixtureSerie().rec);
mod.clearPrompts(); mod.setPromptRespostas(['Energia (nome atualizado)', 'Nova Distribuidora']);
mod.editarUnicaUI('cpSet');
{
  var cpSet = mod.getCP().find(function (x) { return x.id === 'cpSet'; });
  var cpOut = mod.getCP().find(function (x) { return x.id === 'cpOut'; });
  var cpAgo = mod.getCP().find(function (x) { return x.id === 'cpAgo'; });
  test('5. "Editar só esta" (cpSet) — descrição/fornecedor mudam SÓ nesta competência',
    [cpSet.descricao, cpSet.fornecedor], ['Energia (nome atualizado)', 'Nova Distribuidora']);
  test('6. ...Outubro (cpOut) e Agosto (cpAgo) continuam INTOCADOS',
    [cpOut.descricao, cpOut.fornecedor, cpAgo.descricao], ['Energia', 'Cia Elétrica', 'Energia']);
}

// ─────────────────────────────────────────────────────────────────────────
// 7. "Editar só esta" bloqueia competência já paga.
// ─────────────────────────────────────────────────────────────────────────
mod.setCP(fixtureSerie().cp); mod.setRec(fixtureSerie().rec);
mod.clearPrompts(); mod.setPromptRespostas(['Tentativa em paga']);
{
  var before = JSON.stringify(mod.getCP().find(function (x) { return x.id === 'cpAgo'; }));
  mod.editarUnicaUI('cpAgo');
  var after = JSON.stringify(mod.getCP().find(function (x) { return x.id === 'cpAgo'; }));
  test('7. "Editar só esta" em competência JÁ PAGA é bloqueado — nenhum campo muda', before, after);
}

// ─────────────────────────────────────────────────────────────────────────
// 8-9. T9 — "Editar esta e futuras" a partir de Outubro: altera Outubro
// em diante; Agosto (pago) e Setembro (competência anterior a Outubro)
// nunca são tocados.
// ─────────────────────────────────────────────────────────────────────────
mod.setCP(fixtureSerie().cp); mod.setRec(fixtureSerie().rec);
mod.clearPrompts(); mod.setPromptRespostas(['Energia Comercial', 'Nova Distribuidora', 'Operacional', '15']);
mod.editarFuturasUI('recEnergia', '2026-08'); // 2026-08 = competência de "cpOut" (Outubro no exemplo do enunciado)
{
  var recs = mod.getRec();
  var novaRec = recs.find(function (r) { return r.id !== 'recEnergia'; });
  test('8. "Editar esta e futuras" — nova recorrência criada com os campos atualizados (descrição/fornecedor/categoria/dia)',
    novaRec ? [novaRec.descricao, novaRec.fornecedor, novaRec.categoria, novaRec.diaVencimento] : null,
    ['Energia Comercial', 'Nova Distribuidora', 'Operacional', 15]);
  var cpAgoFinal = mod.getCP().find(function (x) { return x.id === 'cpAgo'; });
  test('9. Agosto (já pago) nunca é tocado — status/valor/descrição continuam exatamente como estavam',
    [cpAgoFinal.status, cpAgoFinal.valor, cpAgoFinal.descricao], ['pago', 997.34, 'Energia']);
}

// ─────────────────────────────────────────────────────────────────────────
// 10-12. P1.10 — contador de pendências do mês atual + toggle de filtro.
// ─────────────────────────────────────────────────────────────────────────
{
  var hoje = new Date();
  var compAtualReal = mod.competenciaAtual();
  var fixturePendentes = [
    { id: 'p1', valorPendente: true, competencia: compAtualReal },
    { id: 'p2', valorPendente: true, competencia: compAtualReal },
    { id: 'p3', valorPendente: false, competencia: compAtualReal }, // já informada, não conta
    { id: 'p4', valorPendente: true, competencia: '2020-01' }, // mês antigo, não conta
  ];
  mod.setCP(fixturePendentes);
  test('10. finCPContarPendentesMesAtual() conta só pendentes do mês corrente (2 de 4 registros)',
    mod.contarPendentesMesAtual(), 2);
}
{
  test('11. filtro de pendentes começa desligado', mod.getFiltroAtivo(), false);
  mod.toggleFiltro();
  test('12. finCPToggleFiltroPendente() liga o filtro (clique no card)', mod.getFiltroAtivo(), true);
  mod.toggleFiltro();
  test('12b. clicar de novo desliga (toggle real, não só liga)', mod.getFiltroAtivo(), false);
}

try { fs.unlinkSync(modPath); } catch (e) {}

// ─────────────────────────────────────────────────────────────────────────
// 13-15. Wiring estrutural.
// ─────────────────────────────────────────────────────────────────────────
var srcRenderCP = extractFn('finCPRender');
test('13. finCPRender() aplica o filtro _finCPFiltroSoPendentes na lista (pendOk)', /pendOk/.test(srcRenderCP), true);
test('14. finCPRender() chama finCPUpdateSummary() (contador sempre atualizado ao renderizar)', /finCPUpdateSummary\(\)/.test(srcRenderCP), true);
test('15. HTML tem o card clicável #finCPSumPendenteValorCard com onclick="finCPToggleFiltroPendente()"',
  html.indexOf('id="finCPSumPendenteValorCard"') >= 0 && /finCPSumPendenteValorCard[\s\S]{0,60}onclick="finCPToggleFiltroPendente\(\)"/.test(html), true);

var srcMenu = html.slice(html.indexOf("if(r.recorrenciaId){"), html.indexOf("if(r.recorrenciaId){") + 900);
test('16. menu de 3 pontos de uma ocorrência recorrente tem ações reais "Editar só esta" e "Editar esta e próximas"',
  /finCPEditarUnicaUI/.test(srcMenu) && /finCPEditarFuturasUI/.test(srcMenu), true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
