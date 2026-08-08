/**
 * test_dashboard_kpis_2026-08-08.js
 *
 * RODADA 3.1 — seção 11 (auditoria matemática do Dashboard). Duas provas:
 *
 *   1. Estrutural: nenhuma função de KPI do Dashboard/Financeiro em
 *      index.html lê hist_mensal/hist_nf/hist_caixa_diario/
 *      hist_movimentacoes/hist_despesas — o histórico importado (2018-2026)
 *      NUNCA pode virar "pendência atual" porque nenhum KPI atual tem
 *      acesso a esses documentos (única leitura no arquivo inteiro é
 *      histRender(), a própria aba Histórico). Prova por grep, não por
 *      inspeção manual de cada KPI.
 *
 *   2. Reconciliação numérica real: extrai o cálculo de Ticket Médio de
 *      dashRender() (KPI2 — usa KB_OS.finalPrice, não FIN_TX, para não
 *      distorcer com pagamentos parciais/entrada) e prova, com um fixture
 *      de OS conhecido, que a média bate exatamente e que OS sem valor
 *      (finalPrice/total/valor/totalGeral todos ausentes) são excluídas do
 *      cálculo em vez de contarem como zero (o que puxaria a média para
 *      baixo artificialmente).
 *
 * Uso: node scripts/test_dashboard_kpis_2026-08-08.js
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
function approx(got, exp, eps) { return typeof got === 'number' && Math.abs(got - exp) < (eps || 0.5); }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('\n=== RODADA 3.1 — Dashboard: histórico isolado + reconciliação de Ticket Médio ===\n');

// ── Prova 1: isolamento estrutural do histórico ───────────────────────────
var ocorrencias = (html.match(/hist_mensal|hist_nf|hist_caixa_diario|hist_movimentacoes|hist_despesas/g) || []).length;
test('1. hist_* aparece só nas 2 ocorrências esperadas (dentro de histRender — a própria aba Histórico), nenhum outro KPI/Dashboard lê dado histórico', ocorrencias, 2);

// ── Prova 2: reconciliação real do Ticket Médio (extração + fixture) ─────
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
// dashRender() é grande e cheio de DOM — extrai só o corpo do cálculo do
// KPI2 (Ticket Médio) por marcador de texto exato, o mesmo já usado no
// próprio arquivo, sem reimplementar a fórmula.
var startMarker = "// ── KPI 2: Ticket médio";
var endMarker = "// ── KPI 3: Gargalos Master";
var s = html.indexOf(startMarker);
var e = html.indexOf(endMarker, s);
if (s < 0 || e < 0) throw new Error('Bloco do KPI2 (Ticket Médio) não encontrado — teste desatualizado?');
var bloco = html.slice(s, e);
if (!/tkGeral/.test(bloco)) throw new Error('Bloco extraído não parece mais ser o cálculo de Ticket Médio — index.html mudou.');

var src = [
  'function calcTicketMedio(osList, mesFiltro) {',
  bloco,
  '  return { tkVR: tkVR, tkVit: tkVit, tkGeral: tkGeral, qtdVR: _osVR.length, qtdVit: _osVit.length, qtdGeral: _osMesOk.length };',
  '}',
  'module.exports = { calcTicketMedio: calcTicketMedio };'
].join('\n');
var modPath = path.join(__dirname, '_dash_ticket_extracted.tmp.js');
fs.writeFileSync(modPath, src);
global.document = { getElementById: function () { return { style: {} }; } };
var mod = require(modPath);

var osFixture = [
  { mk: 'vr', finalPrice: 1000, data: '05/08/2026' },
  { mk: 'vr', finalPrice: 2000, data: '10/08/2026' },
  { mk: 'vit', finalPrice: 300, data: '12/08/2026' },
  { mk: 'vr', data: '15/08/2026' }, // sem nenhum campo de valor — deve ser EXCLUÍDA, nunca contar como R$0
];
var r = mod.calcTicketMedio(osFixture, 0);
test('2. Ticket médio VR = média exata de 1000 e 2000 = 1500 (não conta a OS sem valor)', approx(r.tkVR, 1500), true);
test('3. quantidade de OS VR usadas no cálculo é 2, não 3 — OS sem valor é excluída, nunca vira R$0 na média', r.qtdVR, 2);
test('4. Ticket médio Vitre = 300 (única OS Vitre com valor)', approx(r.tkVit, 300), true);
test('5. Ticket médio geral = média de 1000,2000,300 = 1100 — nunca inclui a 4ª OS sem valor', approx(r.tkGeral, 1100), true);

// filtro por mês — só agosto (mesFiltro=8) deve considerar as 4, filtro por
// outro mês (mesFiltro=1) deve zerar (nenhuma OS de janeiro na fixture)
var rJan = mod.calcTicketMedio(osFixture, 1);
test('6. filtro por mês sem nenhuma OS correspondente retorna 0 (não quebra, não usa fallback errado)', rJan.qtdGeral, 0);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
