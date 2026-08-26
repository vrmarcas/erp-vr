/**
 * test_dashboard_central_acao_2026-08-08.js
 *
 * RODADA 5 — seção 3: Dashboard como Central de Ação. Testa
 * dashCentralDeAcao() extraída de index.html, cobrindo os três blocos
 * exigidos (HOJE / PRÓXIMOS / COMERCIAL), cada um com fonte canônica já
 * auditada nas seções 1/2 desta rodada.
 *
 * Uso: node scripts/test_dashboard_central_acao_2026-08-08.js
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
  'dashCalcularEstoqueCritico', 'dashCalcularKPIsComerciais', 'dashOrcMesDoFiltro',
  'dashCalcularVendasRecebimentos', 'dashCalcularOSBreakdown', 'dashCentralDeAcao',
  // HOTFIX BLOCO G/H (Rodada de Hardening, Fase 2, 2026-08-26) — dashOrcMesDoFiltro/
  // dashCalcularKPIsComerciais passaram a normalizar cada orçamento via
  // orcEnvNormalizar() (schema legado × ValerIA), nunca reimplementada.
  'orcEnvNormalizar',
];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { centralDeAcao: dashCentralDeAcao };'
].join('\n\n');
var modPath = path.join(__dirname, '_dashboard_central_acao_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 5 — Dashboard: Central de Ação (HOJE / PRÓXIMOS / COMERCIAL) ===\n');

var HOJE = '2026-08-08'; // sexta-feira fixa de referência

var kbOS = {
  o1: { mk: 'vr', num: '101', cliente: 'Cliente A', status: 'iniciada', entrega: '08/08/2026' },   // entrega hoje
  o2: { mk: 'vr', num: '102', cliente: 'Cliente B', status: 'producao', entrega: '01/08/2026' },   // atrasada + gargalo
  o3: { mk: 'vr', num: '103', cliente: 'Cliente C', status: 'pronta', entrega: '10/08/2026' },     // pronta
  o4: { mk: 'vr', num: '104', cliente: 'Cliente D', status: 'entregue', entrega: '01/08/2026' },   // entregue — nunca conta como atrasada
  o5: { mk: 'vr', num: '105', cliente: 'Cliente E', status: 'iniciada', entrega: '09/08/2026' },   // próxima entrega (amanhã)
};
var finCR = [
  { marca: 'vr', valor: 500, status: 'pendente', vencimento: '01/08/2026' },  // vencida
  { marca: 'vr', valor: 300, status: 'pendente', vencimento: '08/08/2026' },  // vence hoje
  { marca: 'vr', valor: 200, status: 'recebido', vencimento: '05/08/2026', dataCriacao: '05/08/2026', dataRecebimento: '05/08/2026' },
];
var finCP = [
  { marca: 'vr', valor: 150, status: 'agendado', vencimento: '08/08/2026' }, // vence hoje
  { marca: 'vr', valor: 400, status: 'agendado', vencimento: '20/08/2026' },
];
var stock = { m1: { label: 'Acrílico 3mm', qty: 1, min: 10 } };
var orcamentos = [
  { status: 'aguardando', valorFinal: 100, dataSalvo: '05/08/2026 10:00' },
  { status: 'aguardando', valorFinal: 200, dataSalvo: '06/08/2026 10:00' },
  { status: 'aprovado', valorFinal: 300, dataSalvo: '07/08/2026 10:00' },
];

var r = mod.centralDeAcao(kbOS, finCR, finCP, stock, orcamentos, 'vr', HOJE);

// ── HOJE ──────────────────────────────────────────────────────────────
test('1. Entregas de hoje = 1 (o1)', r.hoje.entregasHoje, 1);
test('2. OS atrasadas = 1 (o2 — entregue nunca conta mesmo com data passada)', r.hoje.osAtrasadas, 1);
test('3. OS prontas = 1 (o3)', r.hoje.osProntas, 1);
test('4. CR vencidas = 1 (a de 01/08, não a de hoje 08/08)', r.hoje.crVencidas, 1);
test('5. CR vencendo hoje = 1 (a de 08/08 — vence hoje não é "vencida")', r.hoje.crHoje, 1);
test('6. CP vencendo hoje = 1', r.hoje.cpHoje, 1);
test('7. materiais críticos = 1', r.hoje.materiaisCriticos, 1);

// ── PRÓXIMOS ──────────────────────────────────────────────────────────
test('8. próxima entrega é a mais próxima a partir de hoje inclusive (o1, entrega hoje 08/08 — mais cedo que o5 em 09/08), nunca uma já atrasada (o2, 01/08)', r.proximos.proximaEntrega.num, '101');
test('9. gargalos = 1 (o2, em produção)', r.proximos.gargalos, 1);
test('10. próximas contas conta CR+CP com vencimento a partir de hoje (inclusive)', r.proximos.proximasContas > 0, true);

// ── COMERCIAL ─────────────────────────────────────────────────────────
test('11. orçamentos aguardando = 2', r.comercial.orcamentosAguardando, 2);
test('12. vendas (canônica, FIN_CR) = soma de TODO FIN_CR criado (500+300+200=1000)', r.comercial.vendas, 1000);
test('13. conversão = OS entregues ÷ total (1 de 5 = 20%)', r.comercial.conversao, 20);

// ── filtro de marca isola corretamente ───────────────────────────────
var rVitre = mod.centralDeAcao(kbOS, finCR, finCP, stock, orcamentos, 'vitre', HOJE);
test('14. filtro "vitre" não vê nenhuma OS/CR/CP VR (tudo zerado)', { entregas: rVitre.hoje.entregasHoje, atrasadas: rVitre.hoje.osAtrasadas, crVenc: rVitre.hoje.crVencidas }, { entregas: 0, atrasadas: 0, crVenc: 0 });

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
