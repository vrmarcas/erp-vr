/**
 * test_caixa_diario_2026-08-08.js
 *
 * RODADA 4 — seção 5: Caixa Diário fechado. Testa as funções REAIS
 * extraídas de index.html que fecham o modelo: Caixa Anterior deixa de ser
 * digitado (é sempre o Saldo Final calculado do dia anterior, encadeado) e
 * qualquer correção manual vira um "ajuste extraordinário" auditado
 * (motivo/usuário/data), nunca uma sobrescrita silenciosa.
 *
 * Cobre o exemplo obrigatório do enunciado:
 *   Dia1: Venda=200, Entrada=100 (50/50) → Vendas=200, Entradas=100
 *   Dia2: recebe o saldo=100        → Vendas=0 (daquela venda), Entradas=100
 *         (nunca Vendas=200 de novo no Dia2)
 *
 * Uso: node scripts/test_caixa_diario_2026-08-08.js
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
  // SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.2 — finCaixaTotaisDoDia/
  // finCaixaSaldoFinal agora somam via helpers cent-safe.
  'moneyToCents', 'centsToMoney', 'sumCents',
  'finCPValorNum',
  'finCaixaBRtoISO', 'finCaixaISOtoBR', 'finCaixaAddDiaISO', 'finCaixaTotaisDoDia',
  'finCaixaAjustesDoDia', 'finCaixaAjusteTotalDoDia', 'finCaixaGenesisISO',
  'finCaixaSaldoFinal', 'finCaixaAnteriorAuto', 'finCaixaRegistrarAjuste',
];
var src = [
  'var FIN_CR = []; var FIN_CP = []; var FIN_CAIXA_AJUSTES = [];',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  brToIso: finCaixaBRtoISO, isoToBr: finCaixaISOtoBR, addDia: finCaixaAddDiaISO,',
  '  totaisDoDia: finCaixaTotaisDoDia, ajustesDoDia: finCaixaAjustesDoDia, ajusteTotalDoDia: finCaixaAjusteTotalDoDia,',
  '  genesisISO: finCaixaGenesisISO, saldoFinal: finCaixaSaldoFinal, anteriorAuto: finCaixaAnteriorAuto,',
  '  registrarAjuste: finCaixaRegistrarAjuste,',
  '  setCR: function(v){ FIN_CR = v; }, setCP: function(v){ FIN_CP = v; }, setAjustes: function(v){ FIN_CAIXA_AJUSTES = v; },',
  '  getAjustes: function(){ return FIN_CAIXA_AJUSTES; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_caixa_diario_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 4 — Caixa Diário fechado: Caixa Anterior automático + ajuste extraordinário auditado ===\n');

function reset() { mod.setCR([]); mod.setCP([]); mod.setAjustes([]); }

// ── conversões de data (base de tudo) ──────────────────────────────────────
test('1. finCaixaBRtoISO converte dd/mm/yyyy → yyyy-mm-dd', mod.brToIso('08/08/2026'), '2026-08-08');
test('2. finCaixaISOtoBR converte yyyy-mm-dd → dd/mm/yyyy', mod.isoToBr('2026-08-08'), '08/08/2026');
test('3. finCaixaAddDiaISO soma 1 dia respeitando virada de mês', mod.addDia('2026-08-31', 1), '2026-09-01');
test('4. finCaixaAddDiaISO soma 1 dia em ano bissexto (29/fev)', mod.addDia('2028-02-28', 1), '2028-02-29');
test('5. finCaixaAddDiaISO com n negativo volta 1 dia', mod.addDia('2026-08-01', -1), '2026-07-31');

// ── genesis / saldo sem nenhum dado ────────────────────────────────────────
reset();
test('6. finCaixaGenesisISO retorna null quando não há nenhuma atividade financeira', mod.genesisISO(), null);
test('7. finCaixaSaldoFinal retorna 0 quando não há genesis (sem dados)', mod.saldoFinal('08/08/2026'), 0);
test('8. finCaixaAnteriorAuto retorna 0 quando não há histórico algum', mod.anteriorAuto('08/08/2026'), 0);

// ── EXEMPLO OBRIGATÓRIO DO ENUNCIADO ───────────────────────────────────────
// Dia1 (08/08): Venda de R$200 no modelo 50/50 → 1 registro recebido (100)
// + 1 registro pendente (100), ambos com dataCriacao=Dia1 (mesma venda).
reset();
mod.setCR([
  { id: 'cr1', valor: 100, status: 'recebido', dataCriacao: '08/08/2026', dataRecebimento: '08/08/2026' },
  { id: 'cr2', valor: 100, status: 'pendente', dataCriacao: '08/08/2026', dataRecebimento: null },
]);
{
  var dia1 = mod.totaisDoDia('08/08/2026');
  test('9. Dia1 — Vendas do dia = R$200 (soma dos 2 registros da mesma venda)', dia1.totVendas, 200);
  test('10. Dia1 — Entradas = R$100 (só o que foi efetivamente recebido)', dia1.totEnt, 100);
  test('11. Caixa Anterior do Dia1 = 0 (genesis é o próprio Dia1, nada antes)', mod.anteriorAuto('08/08/2026'), 0);
  test('12. Saldo Final do Dia1 = 0 (caixa ant.) + 100 (entrada) − 0 (saída) = 100', mod.saldoFinal('08/08/2026'), 100);
}
// Dia2 (09/08): recebe o saldo de R$100 da MESMA venda — cr2 muda de
// pendente para recebido, com dataRecebimento=Dia2 (dataCriacao continua Dia1).
mod.setCR([
  { id: 'cr1', valor: 100, status: 'recebido', dataCriacao: '08/08/2026', dataRecebimento: '08/08/2026' },
  { id: 'cr2', valor: 100, status: 'recebido', dataCriacao: '08/08/2026', dataRecebimento: '09/08/2026' },
]);
{
  var dia2 = mod.totaisDoDia('09/08/2026');
  test('13. Dia2 — Vendas do dia = R$0 (a venda já foi contada no Dia1, nunca duplica)', dia2.totVendas, 0);
  test('14. Dia2 — Entradas = R$100 (o saldo recebido hoje)', dia2.totEnt, 100);
  test('15. Caixa Anterior do Dia2 = Saldo Final do Dia1 = R$100 (automático, nunca digitado)', mod.anteriorAuto('09/08/2026'), 100);
  test('16. Saldo Final do Dia2 = 100 (caixa ant.) + 100 (entrada) = R$200', mod.saldoFinal('09/08/2026'), 200);
}

// ── saídas entram na conta ──────────────────────────────────────────────
reset();
mod.setCR([{ id: 'cr1', valor: 500, status: 'recebido', dataCriacao: '01/08/2026', dataRecebimento: '01/08/2026' }]);
mod.setCP([{ id: 'cp1', valor: 200, status: 'pago', dataPagamento: '02/08/2026' }]);
test('17. Saldo Final considera saídas de dias seguintes (500 − 200 = 300)', mod.saldoFinal('02/08/2026'), 300);
test('18. Caixa Anterior de um dia sem nenhuma movimentação própria repete o Saldo Final anterior', mod.anteriorAuto('05/08/2026'), 300);

// ── ajuste extraordinário — validações ────────────────────────────────────
reset();
{
  var r1 = mod.registrarAjuste({ data: '08/08/2026', valor: 100, motivo: '', usuario: 'financeiro@vr.com' });
  test('19. ajuste sem motivo é rejeitado (auditoria obrigatória)', r1.ok, false);
  test('20. erro correto para motivo ausente', r1.erro, 'MOTIVO_OBRIGATORIO');

  var r2 = mod.registrarAjuste({ data: '08/08/2026', valor: 0, motivo: 'teste', usuario: 'financeiro@vr.com' });
  test('21. ajuste com valor zero é rejeitado', r2.ok, false);

  var r3 = mod.registrarAjuste({ data: '', valor: 100, motivo: 'teste', usuario: 'financeiro@vr.com' });
  test('22. ajuste sem data válida é rejeitado', r3.ok, false);

  var r4 = mod.registrarAjuste({ data: '08/08/2026', valor: 100, motivo: 'diferença de troco', usuario: '' });
  test('23. ajuste sem usuário é rejeitado (auditoria exige quem fez)', r4.ok, false);

  var r5 = mod.registrarAjuste({ data: '08/08/2026', valor: 150, motivo: 'diferença de troco na conferência', usuario: 'financeiro@vr.com' });
  test('24. ajuste válido é aceito e retorna o registro criado', r5.ok, true);
  test('25. o registro grava data/valor/motivo/usuário — auditoria completa', { data: r5.ajuste.data, valor: r5.ajuste.valor, motivo: r5.ajuste.motivo, usuario: r5.ajuste.usuario }, { data: '08/08/2026', valor: 150, motivo: 'diferença de troco na conferência', usuario: 'financeiro@vr.com' });
}

// ── ajuste extraordinário — nunca sobrescreve, sempre SOMA e propaga ──────
reset();
mod.setCR([{ id: 'cr1', valor: 100, status: 'recebido', dataCriacao: '08/08/2026', dataRecebimento: '08/08/2026' }]);
test('26. antes do ajuste, Saldo Final do Dia1 = R$100 (só a entrada normal)', mod.saldoFinal('08/08/2026'), 100);
mod.registrarAjuste({ data: '08/08/2026', valor: -30, motivo: 'quebra de caixa identificada', usuario: 'master@vr.com' });
test('27. depois do ajuste (-30), Saldo Final do Dia1 = R$70 — SOMA, não sobrescreve', mod.saldoFinal('08/08/2026'), 70);
test('28. Caixa Anterior do Dia2 herda o ajuste automaticamente (propagação em cadeia)', mod.anteriorAuto('09/08/2026'), 70);
test('29. entradas/saídas brutas do dia continuam intactas — ajuste não altera o histórico de movimentos', mod.totaisDoDia('08/08/2026').totEnt, 100);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
