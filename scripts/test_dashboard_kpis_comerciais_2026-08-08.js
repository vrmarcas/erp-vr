/**
 * test_dashboard_kpis_comerciais_2026-08-08.js
 *
 * RODADA 4 — seções 7/8: auditoria matemática do Dashboard. Testa as
 * funções REAIS extraídas de index.html (dashCalcularKPIsComerciais/
 * dashCalcularVendasRecebimentos), com o cenário EXATO exigido pelo
 * enunciado:
 *
 *   "5 orçamentos — 2 aprovados / 2 aguardando / 1 cancelado — o Dashboard
 *   deve mostrar exatamente isso."
 *   "vendas canônicas R$1000 → Dashboard = R$1000; recebidos R$600 →
 *   Recebimentos = R$600, nunca R$1600."
 *
 * Uso: node scripts/test_dashboard_kpis_comerciais_2026-08-08.js
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

// HOTFIX BLOCO G/H (Rodada de Hardening, Fase 2, 2026-08-26) — dashOrcMesDoFiltro/
// dashCalcularKPIsComerciais passaram a normalizar cada orçamento via
// orcEnvNormalizar() (schema legado × ValerIA), nunca reimplementada.
var FN_NAMES = ['dashOrcMesDoFiltro', 'dashCalcularKPIsComerciais', 'dashCalcularVendasRecebimentos', 'orcEnvNormalizar'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { comerciais: dashCalcularKPIsComerciais, vendasRecebimentos: dashCalcularVendasRecebimentos };'
].join('\n\n');
var modPath = path.join(__dirname, '_dashboard_kpis_comerciais_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 4 — Dashboard: KPIs comerciais e Vendas × Recebimentos (fixtures do enunciado) ===\n');

// ── EXEMPLO OBRIGATÓRIO: 5 orçamentos — 2 aprovados/2 aguardando/1 cancelado ──
var ORCAMENTOS_FIXTURE = [
  { id: 'o1', marca: 'vr', status: 'aprovado', valorFinal: 1000, dataSalvo: '05/08/2026 10:00' },
  { id: 'o2', marca: 'vr', status: 'aprovado', valorFinal: 2000, dataSalvo: '06/08/2026 11:00' },
  { id: 'o3', marca: 'vr', status: 'aguardando', valorFinal: 500, dataSalvo: '07/08/2026 09:00' },
  { id: 'o4', marca: 'vitre', status: 'aguardando', valorFinal: 300, dataSalvo: '07/08/2026 15:00' },
  { id: 'o5', marca: 'vr', status: 'recusado', valorFinal: 800, dataSalvo: '08/08/2026 08:00' }, // "cancelado" real deste ERP
];
{
  var r = mod.comerciais(ORCAMENTOS_FIXTURE, 0, 'all');
  test('1. Dashboard mostra exatamente 5 orçamentos no total', r.orcamentosDoMes, 5);
  test('2. Dashboard mostra exatamente 2 aprovados', r.aprovados, 2);
  test('3. Dashboard mostra exatamente 2 aguardando', r.aguardando, 2);
  test('4. Dashboard mostra exatamente 1 cancelado (recusado)', r.cancelados, 1);
  test('5. valor orçado soma os 5 orçamentos (1000+2000+500+300+800=4600)', r.valorOrcado, 4600);
  test('6. valor aprovado soma só os 2 aprovados (1000+2000=3000)', r.valorAprovado, 3000);
}

// ── alias 'cancelado' literal também é reconhecido ─────────────────────
test('7. status="cancelado" literal também conta como cancelado (alias)', mod.comerciais([{ status: 'cancelado', valorFinal: 100 }], 0, 'all').cancelados, 1);

// ── orçamento sem status é tratado como aguardando ─────────────────────
test('8. orçamento sem status é contado como aguardando (nunca some da contagem)', mod.comerciais([{ valorFinal: 100 }], 0, 'all').aguardando, 1);

// ── filtro por mês ───────────────────────────────────────────────────────
{
  var mistoMeses = [
    { status: 'aprovado', valorFinal: 100, dataSalvo: '10/07/2026 10:00' },
    { status: 'aprovado', valorFinal: 200, dataSalvo: '10/08/2026 10:00' },
  ];
  test('9. filtro de mês (8=agosto) mostra só o orçamento de agosto', mod.comerciais(mistoMeses, 8, 'all').orcamentosDoMes, 1);
  test('10. mesFiltro=0 mostra todos os meses', mod.comerciais(mistoMeses, 0, 'all').orcamentosDoMes, 2);
}

// ── filtro por marca ──────────────────────────────────────────────────────
test('11. filtro de marca "vitre" isola só os orçamentos Vitre (1 dos 5 do fixture)', mod.comerciais(ORCAMENTOS_FIXTURE, 0, 'vitre').orcamentosDoMes, 1);
test('12. filtro de marca "vr" isola só os orçamentos VR (4 dos 5 do fixture)', mod.comerciais(ORCAMENTOS_FIXTURE, 0, 'vr').orcamentosDoMes, 4);

// ── EXEMPLO OBRIGATÓRIO: vendas R$1000 → Dashboard=R$1000; recebido R$600 → Recebimentos=R$600, NUNCA R$1600 ──
{
  var FIN_CR_FIXTURE = [
    { marca: 'vr', valor: 600, status: 'recebido', dataCriacao: '05/08/2026', dataRecebimento: '05/08/2026' },
    { marca: 'vr', valor: 400, status: 'pendente', dataCriacao: '05/08/2026', dataRecebimento: null },
  ];
  var r = mod.vendasRecebimentos(FIN_CR_FIXTURE, 0, 'all');
  test('13. Vendas canônicas = R$1000 (600+400, soma de TODO FIN_CR criado, recebido ou não)', r.vendas, 1000);
  test('14. Recebimentos = R$600 (só o que tem status=recebido) — NUNCA R$1600 (nunca soma vendas+recebido)', r.recebimentos, 600);
}

// ── recebimento em dia posterior nunca duplica a venda ─────────────────
{
  var FIN_CR_2DIAS = [
    { marca: 'vr', valor: 100, status: 'recebido', dataCriacao: '08/08/2026', dataRecebimento: '08/08/2026' },
    { marca: 'vr', valor: 100, status: 'recebido', dataCriacao: '08/08/2026', dataRecebimento: '09/08/2026' },
  ];
  test('15. Vendas do mês somam 200 (as 2 ocorrências da mesma venda, criadas em agosto)', mod.vendasRecebimentos(FIN_CR_2DIAS, 8, 'all').vendas, 200);
  test('16. Recebimentos do mês também somam 200 (ambas recebidas em agosto) — nunca 400', mod.vendasRecebimentos(FIN_CR_2DIAS, 8, 'all').recebimentos, 200);
}

// ── filtro por marca em vendas/recebimentos ────────────────────────────
{
  var mix = [
    { marca: 'vr', valor: 500, status: 'recebido', dataCriacao: '01/08/2026', dataRecebimento: '01/08/2026' },
    { marca: 'vitre', valor: 700, status: 'recebido', dataCriacao: '01/08/2026', dataRecebimento: '01/08/2026' },
  ];
  test('17. filtro "vr" isola só a venda VR (R$500, ignora Vitre)', mod.vendasRecebimentos(mix, 0, 'vr').vendas, 500);
  test('18. filtro "vitre" isola só a venda Vitre (R$700)', mod.vendasRecebimentos(mix, 0, 'vitre').vendas, 700);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
