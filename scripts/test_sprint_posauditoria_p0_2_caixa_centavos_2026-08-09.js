/**
 * test_sprint_posauditoria_p0_2_caixa_centavos_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.2 — a auditoria read-only anterior
 * encontrou que finCaixaSaldoFinal() acumulava entradas/saídas/ajustes em
 * ponto flutuante (float), dia após dia, por todo o histórico do Caixa
 * (loop de até 20.000 dias), SEM NENHUM arredondamento — exatamente o
 * padrão onde erro de arredondamento binário se acumula de forma visível
 * ao longo do tempo.
 *
 * Corrigido: moneyToCents()/centsToMoney()/sumCents() (helpers puros,
 * reutilizados também no P0.3/DRE e no P2) — toda soma financeira do
 * Caixa agora acontece em CENTAVOS INTEIROS; a conversão para R$ só
 * acontece na saída de cada função. Nenhum documento persistido mudou de
 * schema (compatibilidade total — dados antigos continuam Number em
 * reais, só a SOMA passou a ser cent-safe).
 *
 * T2 (stress test obrigatório): milhares de movimentos com os valores
 * classicamente problemáticos em float (0,10 / 0,20 / 0,30 / 10,01 /
 * 99,99 / 333,33) — soma final deve bater EXATAMENTE (diferença R$0,00)
 * contra uma soma de referência calculada em centavos inteiros de forma
 * totalmente independente da implementação testada.
 *
 * Uso: node scripts/test_sprint_posauditoria_p0_2_caixa_centavos_2026-08-09.js
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
  'moneyToCents', 'centsToMoney', 'sumCents', 'finCPValorNum',
  'finCaixaBRtoISO', 'finCaixaISOtoBR', 'finCaixaAddDiaISO', 'finCaixaTotaisDoDia',
  'finCaixaAjustesDoDia', 'finCaixaAjusteTotalDoDia', 'finCaixaGenesisISO',
  'finCaixaSaldoFinal', 'finCaixaAnteriorAuto'
];
var src = [
  'var FIN_CR = []; var FIN_CP = []; var FIN_CAIXA_AJUSTES = [];',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  moneyToCents: moneyToCents, centsToMoney: centsToMoney, sumCents: sumCents,',
  '  brToIso: finCaixaBRtoISO, isoToBr: finCaixaISOtoBR, addDia: finCaixaAddDiaISO,',
  '  totaisDoDia: finCaixaTotaisDoDia, ajusteTotalDoDia: finCaixaAjusteTotalDoDia,',
  '  genesisISO: finCaixaGenesisISO, saldoFinal: finCaixaSaldoFinal, anteriorAuto: finCaixaAnteriorAuto,',
  '  setCR: function(v){ FIN_CR = v; }, setCP: function(v){ FIN_CP = v; }, setAjustes: function(v){ FIN_CAIXA_AJUSTES = v; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_p0_2_caixa_centavos_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.2 — Caixa cent-safe ===\n');

// ─────────────────────────────────────────────────────────────────────────
// 1-5. Helpers puros
// ─────────────────────────────────────────────────────────────────────────
test('1. moneyToCents(10.01) = 1001 (nunca 1000 por truncamento de float)', mod.moneyToCents(10.01), 1001);
test('2. moneyToCents(99.99) = 9999', mod.moneyToCents(99.99), 9999);
test('3. moneyToCents(333.33) = 33333', mod.moneyToCents(333.33), 33333);
test('4. centsToMoney(33333) = 333.33', mod.centsToMoney(33333), 333.33);
test('5. sumCents soma uma lista de reais direto em centavos, sem acumular float', mod.sumCents([{v:0.10},{v:0.20},{v:0.30}], function(x){return x.v;}), 60);

// ─────────────────────────────────────────────────────────────────────────
// 6. Prova rápida do problema original: soma float direta de 0.10+0.20
//    (o clássico 0.30000000000000004) NÃO seria exatamente 0.3 — os
//    helpers cent-safe eliminam isso.
// ─────────────────────────────────────────────────────────────────────────
test('6. 0.10 + 0.20 em float puro NÃO é exatamente 0.30 (prova do problema que este sprint corrige)',
  (0.10 + 0.20) === 0.30, false);
test('6b. ...mas via moneyToCents/centsToMoney o resultado É exatamente 0.30',
  mod.centsToMoney(mod.moneyToCents(0.10) + mod.moneyToCents(0.20)), 0.30);

// ─────────────────────────────────────────────────────────────────────────
// 7-9. T2 — STRESS TEST OBRIGATÓRIO: milhares de movimentos com valores
// classicamente problemáticos em float, diferença final deve ser R$0,00.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  var VALORES_CENTS = [10, 20, 30, 1001, 9999, 33333]; // 0,10 / 0,20 / 0,30 / 10,01 / 99,99 / 333,33
  var NUM_DIAS = 60;
  var MOV_POR_DIA = 40; // 60*40*2(entrada+saida) = 4.800 movimentos + ajustes — "milhares", conforme T2

  var cr = [], cp = [], ajustes = [];
  var refEntCents = 0, refSaiCents = 0, refAjusteCents = 0;
  var dataInicioISO = '2024-01-01';
  var ultimaDataBR = null;

  for (var d = 0; d < NUM_DIAS; d++) {
    var iso = mod.addDia(dataInicioISO, d);
    var dtBR = mod.isoToBr(iso);
    ultimaDataBR = dtBR;
    for (var m = 0; m < MOV_POR_DIA; m++) {
      var centsEnt = VALORES_CENTS[(d + m) % VALORES_CENTS.length];
      cr.push({ dataCriacao: dtBR, status: 'recebido', dataRecebimento: dtBR, valor: centsEnt / 100 });
      refEntCents += centsEnt;
      var centsSai = VALORES_CENTS[(d + m + 1) % VALORES_CENTS.length];
      cp.push({ dataPagamento: dtBR, status: 'pago', valor: centsSai / 100 });
      refSaiCents += centsSai;
    }
    // 1 ajuste por dia, alternando sinal, também com valores "difíceis".
    var centsAj = VALORES_CENTS[d % VALORES_CENTS.length] * (d % 2 === 0 ? 1 : -1);
    ajustes.push({ data: dtBR, valor: centsAj / 100, motivo: 'ajuste stress test', usuario: 'test@vr.com' });
    refAjusteCents += centsAj;
  }

  mod.setCR(cr); mod.setCP(cp); mod.setAjustes(ajustes);

  var refSaldoCents = refEntCents - refSaiCents + refAjusteCents;
  var saldoFinalReais = mod.saldoFinal(ultimaDataBR);
  var saldoFinalCentsObtido = Math.round(saldoFinalReais * 100);

  console.log('  → ' + (NUM_DIAS * MOV_POR_DIA * 2 + NUM_DIAS) + ' movimentos gerados (' + NUM_DIAS + ' dias × ' + MOV_POR_DIA + ' entradas+saídas + ' + NUM_DIAS + ' ajustes)');
  test('7. STRESS T2 — saldo final em centavos bate EXATAMENTE com a soma de referência independente (diferença = R$0,00)',
    saldoFinalCentsObtido, refSaldoCents);
  test('7b. ...diferença absoluta em reais é exatamente 0 (não "~0", não "0.000000001")',
    Math.abs(saldoFinalReais - mod.centsToMoney(refSaldoCents)), 0);

  // D-1 → D: Caixa Anterior de um dia = Saldo Final do dia anterior, sem
  // digitação manual e sem gerar divergência de arredondamento entre os dois.
  var isoUltimo = mod.brToIso(ultimaDataBR);
  var isoPenultimo = mod.addDia(isoUltimo, -1);
  var brPenultimo = mod.isoToBr(isoPenultimo);
  test('8. finCaixaAnteriorAuto(D) === finCaixaSaldoFinal(D-1) — encadeamento sem digitação, sem divergência de centavos',
    mod.anteriorAuto(ultimaDataBR), mod.saldoFinal(brPenultimo));

  // Histórico longo (T2 "testar histórico longo"): estende a fixture por
  // mais ~2 anos de movimento esparso (1 entrada "difícil" a cada 3 dias)
  // e confere que o saldo acumulado continua batendo com a referência.
  var refLongoCents = refSaldoCents;
  var diasExtra = 700;
  for (var e = 0; e < diasExtra; e++) {
    if (e % 3 !== 0) continue;
    var isoE = mod.addDia(isoUltimo, e + 1);
    var brE = mod.isoToBr(isoE);
    var centsE = VALORES_CENTS[e % VALORES_CENTS.length];
    cr.push({ dataCriacao: brE, status: 'recebido', dataRecebimento: brE, valor: centsE / 100 });
    refLongoCents += centsE;
    ultimaDataBR = brE;
  }
  mod.setCR(cr);
  var saldoLongoCentsObtido = Math.round(mod.saldoFinal(ultimaDataBR) * 100);
  test('9. histórico longo (~2 anos, milhares de movimentos acumulados) — saldo ainda bate exatamente com a referência',
    saldoLongoCentsObtido, refLongoCents);
})();

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
