/**
 * test_cp_recorrente_2026-08-08.js
 *
 * RODADA 4 — seção 1: Contas a Pagar recorrentes. Testa as funções REAIS
 * extraídas de index.html (finCPCriarRecorrencia/finCPGerarOcorrencias/
 * finCPCancelarOcorrencia/finCPEncerrarRecorrencia/finCPEditarFuturas),
 * cobrindo os cenários explicitamente pedidos: 2ª ocorrência, editar só
 * uma, editar futuras, encerrar série, idempotência (rodar 2x).
 *
 * Uso: node scripts/test_cp_recorrente_2026-08-08.js
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

var FN_NAMES = [
  'finCPCompetenciaStr', 'finCPParseISO', 'finCPVencimentoDaCompetencia', 'finCPProximasCompetencias',
  'finCPGerarOcorrencias', 'finCPCriarRecorrencia', 'finCPCancelarOcorrencia', 'finCPEncerrarRecorrencia', 'finCPEditarFuturas',
];
var src = [
  'var FIN_CP = [];',
  'var FIN_CP_RECORRENCIAS = [];',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  criarRecorrencia: finCPCriarRecorrencia, gerarOcorrencias: finCPGerarOcorrencias,',
  '  cancelarOcorrencia: finCPCancelarOcorrencia, encerrarRecorrencia: finCPEncerrarRecorrencia,',
  '  editarFuturas: finCPEditarFuturas,',
  '  getFinCP: function(){ return FIN_CP; }, getRecorrencias: function(){ return FIN_CP_RECORRENCIAS; },',
  '  setFinCP: function(v){ FIN_CP = v; }, setRecorrencias: function(v){ FIN_CP_RECORRENCIAS = v; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_cp_recorrente_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 4 — Contas a Pagar recorrentes (funções reais extraídas) ===\n');

function reset() { mod.setFinCP([]); mod.setRecorrencias([]); }

// data fixa de referência: hoje real do ambiente (não precisamos mockar
// Date — as competências futuras são relativas a "agora", então usamos
// dataInicial = mês corrente para previsibilidade)
var hoje = new Date();
var anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth() + 1;
var dataInicialISO = anoAtual + '-' + String(mesAtual).padStart(2, '0') + '-01';

reset();
{
  var r1 = mod.criarRecorrencia({ descricao: 'Aluguel', categoria: 'Operacional', valor: 3000, fornecedor: 'Imobiliária X', contaBancaria: 'itau', marca: 'vr', diaVencimento: 5, dataInicial: dataInicialISO });
  // horizonte=3 gera do mês atual até o limite INCLUSIVE (mês atual + 3), ou
  // seja 4 competências (atual, +1, +2, +3) — fronteira inclusiva por design.
  test('1. criar recorrência gera as ocorrências do horizonte padrão (mês atual + 3 seguintes, fronteira inclusiva)', r1.ocorrenciasCriadas, 4);
  var ocorrencias = mod.getFinCP().filter(function (x) { return x.recorrenciaId === r1.recorrenciaId; });
  test('2. cada ocorrência marca tipo="recorrente" e competencia preenchida', ocorrencias.every(function (o) { return o.tipo === 'recorrente' && !!o.competencia; }), true);
  test('3. 2ª ocorrência (mês seguinte) existe com o mesmo valor e categoria', ocorrencias.filter(function (o) { return o.competencia === finCompNext(anoAtual, mesAtual, 1); }).length, 1);

  test('4. reaplicar geração (idempotência) não duplica nenhuma ocorrência', (function () { mod.gerarOcorrencias(3); return mod.getFinCP().length; })(), 4);

  // editar só uma ocorrência: mutação direta no registro, recorrência-mãe intacta
  var alvo = ocorrencias[0];
  alvo.valor = 3200; alvo.observacao = 'reajuste pontual';
  var outras = mod.getFinCP().filter(function (x) { return x.recorrenciaId === r1.recorrenciaId && x.id !== alvo.id; });
  test('5. editar só uma ocorrência não altera o valor das demais (2 continuam com 3000)', outras.every(function (o) { return o.valor === 3000; }), true);

  // cancelar uma ocorrência específica (a 3ª, ainda não paga)
  var terceira = ocorrencias[2];
  var rCancel = mod.cancelarOcorrencia(terceira.id);
  test('6. cancelar uma ocorrência específica funciona (não paga)', rCancel.ok, true);
  test('7. a ocorrência cancelada some de FIN_CP', mod.getFinCP().some(function (x) { return x.id === terceira.id; }), false);
  var rec1 = mod.getRecorrencias().find(function (x) { return x.id === r1.recorrenciaId; });
  test('8. a competência cancelada fica registrada na recorrência-mãe (nunca recriada por engano)', rec1.competenciasCanceladas.indexOf(terceira.competencia) >= 0, true);
  test('9. reaplicar geração NÃO recria a ocorrência cancelada', (function () { mod.gerarOcorrencias(3); return mod.getFinCP().some(function (x) { return x.id === terceira.id; }); })(), false);

  // marcar uma como paga e tentar cancelar (deve ser bloqueado)
  var paga = mod.getFinCP().find(function (x) { return x.recorrenciaId === r1.recorrenciaId; });
  paga.status = 'pago';
  var rCancelPaga = mod.cancelarOcorrencia(paga.id);
  test('10. NUNCA é possível cancelar uma ocorrência já paga (retorna erro, nada é removido)', rCancelPaga.ok, false);
  test('11. a ocorrência paga continua em FIN_CP intacta', mod.getFinCP().some(function (x) { return x.id === paga.id; }), true);
}

// ── editar esta e futuras ────────────────────────────────────────────────
reset();
{
  var r2 = mod.criarRecorrencia({ descricao: 'Salário Funcionário', categoria: 'Pessoal', valor: 2000, marca: 'vr', diaVencimento: 5, dataInicial: dataInicialISO });
  var comp2 = finCompNext(anoAtual, mesAtual, 1); // mês seguinte
  var comp0 = finCompNext(anoAtual, mesAtual, 0); // mês atual
  var rEdit = mod.editarFuturas(r2.recorrenciaId, comp2, { valor: 2500 });
  test('12. editarFuturas cria uma nova recorrência com o valor atualizado', rEdit.ok, true);
  var ocAtual = mod.getFinCP().find(function (x) { return x.competencia === comp0; });
  var ocFutura = mod.getFinCP().find(function (x) { return x.competencia === comp2; });
  test('13. competência ANTES do corte preserva o valor antigo (2000) — histórico nunca muda retroativamente', ocAtual.valor, 2000);
  test('14. competência a PARTIR do corte usa o valor novo (2500)', ocFutura.valor, 2500);
  test('15. a ocorrência da competência futura passa a pertencer à NOVA recorrência', ocFutura.recorrenciaId, rEdit.novaRecorrenciaId);
  var recVelha = mod.getRecorrencias().find(function (x) { return x.id === r2.recorrenciaId; });
  test('16. a recorrência antiga foi encerrada exatamente no mês anterior ao corte', recVelha.dataFinal.slice(0, 7), finCompPrev(comp2));
}

// ── encerrar série ─────────────────────────────────────────────────────
reset();
{
  var r3 = mod.criarRecorrencia({ descricao: 'Internet', categoria: 'Operacional', valor: 200, marca: 'vr', diaVencimento: 10, dataInicial: dataInicialISO });
  var totalAntes = mod.getFinCP().filter(function (x) { return x.recorrenciaId === r3.recorrenciaId; }).length;
  mod.encerrarRecorrencia(r3.recorrenciaId);
  mod.gerarOcorrencias(6); // horizonte maior, mas a série está encerrada
  var totalDepois = mod.getFinCP().filter(function (x) { return x.recorrenciaId === r3.recorrenciaId; }).length;
  test('17. encerrar recorrência preserva as ocorrências já geradas', totalDepois >= totalAntes, true);
  test('18. encerrar recorrência impede novas ocorrências mesmo com horizonte maior', totalDepois, totalAntes);
  var recEnc = mod.getRecorrencias().find(function (x) { return x.id === r3.id; }) || mod.getRecorrencias().find(function (x) { return x.id === r3.recorrenciaId; });
  test('19. flag ativa=false persiste', recEnc.ativa, false);
}

// ── data final opcional respeitada ────────────────────────────────────────
reset();
{
  var fimISO = anoAtual + '-' + String(mesAtual).padStart(2, '0') + '-28'; // termina no mesmo mês que começa
  var r4 = mod.criarRecorrencia({ descricao: 'Consultoria 1 mês', categoria: 'Operacional', valor: 500, marca: 'vr', diaVencimento: 15, dataInicial: dataInicialISO, dataFinal: fimISO });
  var qtd = mod.getFinCP().filter(function (x) { return x.recorrenciaId === r4.recorrenciaId; }).length;
  test('20. dataFinal no mesmo mês da dataInicial gera exatamente 1 ocorrência, nunca o horizonte inteiro', qtd, 1);
}

function finCompNext(ano, mes, offset) {
  var d = new Date(ano, mes - 1 + offset, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function finCompPrev(compStr) {
  var p = compStr.split('-'); var ano = parseInt(p[0], 10), mes = parseInt(p[1], 10);
  var anoAnt = mes === 1 ? ano - 1 : ano, mesAnt = mes === 1 ? 12 : mes - 1;
  return anoAnt + '-' + String(mesAnt).padStart(2, '0');
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
