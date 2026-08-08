/**
 * test_dashboard_crcp_os_estoque_2026-08-08.js
 *
 * RODADA 5 — seções 1/2: conclui a auditoria matemática do Dashboard
 * (CR, CP, OS abertas/em produção/prontas/entregues/atrasadas, estoque
 * crítico) e prova os filtros de marca (VR isola VR, Vitre isola Vitre,
 * Todos consolida sem duplicar).
 *
 * Testa as funções REAIS extraídas de index.html:
 *   dashCalcularCRCP / dashCalcularOSBreakdown / dashCalcularEstoqueCritico
 *
 * Uso: node scripts/test_dashboard_crcp_os_estoque_2026-08-08.js
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

var FN_NAMES = ['dashCalcularCRCP', 'dashCalcularOSBreakdown', 'dashCalcularEstoqueCritico'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { crcp: dashCalcularCRCP, osBreakdown: dashCalcularOSBreakdown, estoque: dashCalcularEstoqueCritico };'
].join('\n\n');
var modPath = path.join(__dirname, '_dashboard_crcp_os_estoque_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 5 — Dashboard: CR/CP, OS breakdown, estoque crítico, filtros de marca ===\n');

// ── CR × CP ─────────────────────────────────────────────────────────────
var HOJE = '2026-08-08'; // referência fixa para o teste (não usa Date.now())
{
  var finCR = [
    { marca: 'vr', valor: 300, status: 'pendente', vencimento: '01/08/2026' },  // vencida (antes de 08/08)
    { marca: 'vr', valor: 200, status: 'pendente', vencimento: '20/08/2026' },  // não vencida
    { marca: 'vr', valor: 999, status: 'recebido', vencimento: '01/08/2026' },  // já recebida — não conta
    { marca: 'vitre', valor: 100, status: 'pendente', vencimento: '01/08/2026' }, // outra marca
  ];
  var finCP = [
    { marca: 'vr', valor: 150, status: 'agendado', vencimento: '05/08/2026' }, // vencida
    { marca: 'vr', valor: 400, status: 'agendado', vencimento: '15/08/2026' }, // não vencida
    { marca: 'vr', valor: 777, status: 'pago', vencimento: '01/08/2026' },     // paga — não conta como vencida
  ];
  var r = mod.crcp(finCR, finCP, 'vr', HOJE);
  test('1. CR pendente (VR) soma 300+200=500, ignora recebido e outra marca', r.crTotal, 500);
  test('2. CR vencido (VR) é só a de 01/08 (300), a de 20/08 não venceu ainda', r.crVencidoTotal, 300);
  test('3. CR vencido count = 1', r.crVencidoCount, 1);
  test('4. CP pendente (VR) soma 150+400=550, ignora a paga', r.cpTotal, 550);
  test('5. CP vencido (VR) é só a de 05/08 (150) — a paga nunca conta como vencida mesmo com data passada', r.cpVencidoTotal, 150);
  test('6. filtro de marca "vr" nunca soma o CR da Vitre (100 fica de fora)', r.crTotal, 500);

  var rVitre = mod.crcp(finCR, finCP, 'vitre', HOJE);
  test('7. filtro "vitre" isola só o CR da Vitre (100)', rVitre.crTotal, 100);

  var rAll = mod.crcp(finCR, finCP, 'all', HOJE);
  test('8. filtro "all" consolida VR+Vitre sem duplicar (500+100=600)', rAll.crTotal, 600);
}

// ── OS breakdown ────────────────────────────────────────────────────────
{
  var kbOS = {
    o1: { mk: 'vr', status: 'iniciada', entrega: '20/08/2026' },
    o2: { mk: 'vr', status: 'aguardando_saldo', entrega: '20/08/2026' },
    o3: { mk: 'vr', status: 'producao', entrega: '20/08/2026' },
    o4: { mk: 'vr', status: 'pronta', entrega: '20/08/2026' },
    o5: { mk: 'vr', status: 'entregue', entrega: '01/08/2026' },
    o6: { mk: 'vr', status: 'producao', entrega: '01/08/2026' }, // atrasada (01/08 < 08/08)
    o7: { mk: 'vitre', status: 'producao', entrega: '20/08/2026' },
    o8: { mk: 'vr', status: 'cancelado', entrega: '01/08/2026' }, // cancelada nunca conta como atrasada
  };
  var r = mod.osBreakdown(kbOS, 'vr', HOJE);
  test('9. OS abertas (VR) = 2 (iniciada + aguardando_saldo)', r.abertas, 2);
  test('10. OS em produção (VR) = 2 (o3 + o6, mesmo o6 estando atrasada também)', r.emProducao, 2);
  test('11. OS prontas (VR) = 1', r.prontas, 1);
  test('12. OS entregues (VR) = 1', r.entregues, 1);
  test('13. OS atrasadas (VR) = 1 (só o6 — entregue e cancelada nunca contam como atrasada)', r.atrasadas, 1);
  test('14. filtro de marca "vr" nunca conta a OS Vitre (o7)', r.total, 7);

  var rVitre = mod.osBreakdown(kbOS, 'vitre', HOJE);
  test('15. filtro "vitre" isola só a OS Vitre (o7 — em produção)', rVitre.emProducao, 1);
  test('16. filtro "vitre" não vê nenhuma OS VR', rVitre.total, 1);

  var rAll = mod.osBreakdown(kbOS, 'all', HOJE);
  test('17. filtro "all" consolida VR+Vitre sem duplicar (8 OS no total)', rAll.total, 8);
}

// ── estoque crítico ─────────────────────────────────────────────────────
{
  var stock = {
    m1: { label: 'Acrílico 3mm', qty: 2, min: 10 },
    m2: { label: 'MDF 6mm', qty: 50, min: 10 },
    m3: { label: 'Chapa PS', qty: 0, min: 5 },
  };
  var r = mod.estoque(stock);
  test('18. estoque crítico conta só os itens com qty < min (2 dos 3)', r.count, 2);
  test('19. estoque crítico retorna os itens reais (não só a contagem)', r.itens.map(function (i) { return i.label; }).sort(), ['Acrílico 3mm', 'Chapa PS']);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
