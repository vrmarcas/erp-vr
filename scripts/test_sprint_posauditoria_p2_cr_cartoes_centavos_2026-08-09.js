/**
 * test_sprint_posauditoria_p2_cr_cartoes_centavos_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P2.1/P2.2 — hardening cent-safe
 * gradual do Dashboard (finDashKPIs) e de Cartões/Faturas
 * (finCartaoValorFatura), reaproveitando os helpers de P0.2
 * (moneyToCents/centsToMoney/sumCents). Nenhuma regra de negócio mudou —
 * só a soma deixou de acumular em float.
 *
 * Este arquivo é o stress test dedicado (mesmo padrão dos T2/T3 de
 * P0.2/P0.3): valores classicamente problemáticos em float, em volume,
 * comparados contra uma soma de referência calculada em centavos
 * inteiros de forma independente da implementação testada.
 *
 * Uso: node scripts/test_sprint_posauditoria_p2_cr_cartoes_centavos_2026-08-09.js
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

var VALORES_CENTS = [10, 20, 30, 1001, 9999, 33333]; // 0,10 / 0,20 / 0,30 / 10,01 / 99,99 / 333,33

// ═══════════════════════════════════════════════════════════════════════
// BLOCO A — finCartaoValorFatura: fatura com centenas de parcelas
// "difíceis" espalhadas por várias compras, soma tem que bater exato.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  var FN_NAMES = [
    'moneyToCents', 'centsToMoney', 'sumCents', 'finCPParseISO',
    'finCPCompetenciaStr', 'finCPVencimentoDaCompetencia', 'finCartaoCompetenciaFatura',
    'finCartaoGerarParcelas', 'finCartaoRegistrarCompra', 'finCartaoGarantirFaturas',
    'finCartaoValorFatura',
    // GO-LIVE 2026-08-11, seção 42-50 (correção pós-relatório) —
    // finCartaoGarantirFaturas agora também sincroniza a ÚNICA obrigação de
    // Contas a Pagar por (cartão, competência) a cada compra registrada.
    'finNormCat', 'finCartaoFaturaPorCategoria',
    'finCartaoSincronizarCPFatura', 'finCartaoComprasDaFatura',
  ];
  var src = [
    'var FIN_CARTOES = []; var FIN_CARTAO_COMPRAS = []; var FIN_FATURAS = []; var FIN_CP = [];',
    "var FIN_CAT_ALIAS={'Matéria-prima':'Matéria-Prima','Pessoal':'Pessoal Admin'};",
    FN_NAMES.map(extractFn).join('\n\n'),
    'module.exports = {',
    '  registrarCompra: finCartaoRegistrarCompra, valorFatura: finCartaoValorFatura,',
    '  getCompras: function(){ return FIN_CARTAO_COMPRAS; }, getFaturas: function(){ return FIN_FATURAS; },',
    '  setCartoes: function(v){ FIN_CARTOES = v; },',
    '};'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_p2_cartoes_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P2.2 — Cartões/Faturas cent-safe (stress) ===\n');

  var CARTAO = { id: 'cartao1', nome: 'Itaú Empresarial', emissor: 'Itaú', diaFechamento: 25, diaVencimento: 5, ativo: true };
  mod.setCartoes([CARTAO]);

  // 300 compras de parcela única, todas na MESMA competência (mesmo dia,
  // sempre antes do fechamento) → todas caem na mesma fatura.
  var NUM_COMPRAS = 300;
  var refCents = 0;
  for (var i = 0; i < NUM_COMPRAS; i++) {
    var cents = VALORES_CENTS[i % VALORES_CENTS.length];
    mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-05', fornecedor: 'F' + i, descricao: 'Item ' + i, valorTotal: cents / 100, parcelas: 1, marca: 'vr' });
    refCents += cents;
  }
  var faturaId = mod.getFaturas()[0].id;
  var valorObtido = mod.valorFatura(faturaId);
  console.log('  → ' + NUM_COMPRAS + ' compras de parcela única agregadas em 1 fatura');
  test('A1. STRESS — valor da fatura com 300 compras "difíceis" bate EXATAMENTE a soma de referência em centavos',
    Math.round(valorObtido * 100), refCents);

  // Agora um segundo cartão com compras parceladas em 2x/3x/5x/7x/11x
  // (parcelas "difíceis" que não dividem exato), caindo em faturas
  // diferentes por competência — soma de CADA fatura ainda bate exato.
  // Isolado do cartão1 acima (cartaoId diferente), sem precisar resetar
  // o estado do módulo.
  var CARTAO2 = { id: 'cartao2', nome: 'Bradesco', emissor: 'Bradesco', diaFechamento: 25, diaVencimento: 5, ativo: true };
  mod.setCartoes([CARTAO, CARTAO2]);
  var refPorCompetencia = {};
  var NPARC = [2, 3, 5, 7, 11];
  for (var j = 0; j < 60; j++) {
    var totalCents = VALORES_CENTS[j % VALORES_CENTS.length] * (1 + (j % 4));
    var n = NPARC[j % NPARC.length];
    var r = mod.registrarCompra({ cartaoId: 'cartao2', data: '2026-01-05', fornecedor: 'G' + j, descricao: 'Parcelado ' + j, valorTotal: totalCents / 100, parcelas: n, marca: 'vit' });
    r.parcelas.forEach(function (p) {
      refPorCompetencia[p.competencia] = (refPorCompetencia[p.competencia] || 0) + Math.round(p.valor * 100);
    });
  }
  var faturasCartao2 = mod.getFaturas().filter(function (f) { return f.cartaoId === 'cartao2'; });
  console.log('  → 60 compras parceladas (2x a 11x) no cartão2, gerando ' + faturasCartao2.length + ' faturas em competências diferentes');
  var todasBatem = faturasCartao2.every(function (f) {
    return Math.round(mod.valorFatura(f.id) * 100) === refPorCompetencia[f.competencia];
  });
  test('A2. STRESS — TODAS as faturas geradas por 60 compras parceladas (2x-11x) batem exato contra a soma de referência por competência',
    todasBatem, true);

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ═══════════════════════════════════════════════════════════════════════
// BLOCO B — finDashKPIs: acumuladores do Dashboard (saldoImediato,
// totalReceber, totalPagar, projetado) com milhares de lançamentos.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  var FN_NAMES = ['moneyToCents', 'centsToMoney', 'sumCents', 'finCPValorNum', 'finFmt', 'finDashKPIs'];
  // domStore vive em `global` porque require() não compartilha escopo
  // léxico com este arquivo — é o jeito simples de o módulo extraído
  // (que roda em seu próprio arquivo temporário) enxergar o mesmo objeto.
  global.domStore = {};
  var src = [
    'var FIN_TX = []; var FIN_CP = []; var FIN_CR = [];',
    'var document = { getElementById: function(id){',
    '  if(!global.domStore[id]) global.domStore[id] = { textContent: "", style: {} };',
    '  return global.domStore[id];',
    '} };',
    FN_NAMES.map(extractFn).join('\n\n'),
    'module.exports = {',
    '  dashKPIs: finDashKPIs,',
    '  setTX: function(v){ FIN_TX = v; }, setCP: function(v){ FIN_CP = v; }, setCR: function(v){ FIN_CR = v; },',
    '  dom: function(){ return global.domStore; },',
    '};'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_p2_dash_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P2.1 — Dashboard (finDashKPIs) cent-safe (stress) ===\n');

  var NUM = 800;
  var tx = [], cp = [], cr = [];
  var refRecebidoImediatoCents = 0, refPagoCents = 0, refCrPendCents = 0, refCpPendCents = 0;
  for (var i = 0; i < NUM; i++) {
    var cents = VALORES_CENTS[i % VALORES_CENTS.length];
    var metodo = (i % 2 === 0) ? 'PIX' : 'Cartão';
    tx.push({ status: 'recebido', metodo: metodo, valor: cents / 100 });
    if (metodo === 'PIX') refRecebidoImediatoCents += cents;

    var centsCp = VALORES_CENTS[(i + 1) % VALORES_CENTS.length];
    cp.push({ status: 'pago', valor: centsCp / 100 });
    refPagoCents += centsCp;

    var centsCpPend = VALORES_CENTS[(i + 2) % VALORES_CENTS.length];
    cp.push({ status: 'agendado', valor: centsCpPend / 100, vencimento: '01/01/2099' });
    refCpPendCents += centsCpPend;

    var centsCr = VALORES_CENTS[(i + 3) % VALORES_CENTS.length];
    cr.push({ status: 'pendente', metodo: 'PIX', valor: centsCr / 100 });
    refCrPendCents += centsCr;
  }
  mod.setTX(tx); mod.setCP(cp); mod.setCR(cr);
  mod.dashKPIs();

  var dom = mod.dom();
  var saldoImediatoObtido = Math.round(parseFloat(dom['finKpiCaixa'].textContent.replace('R$', '').replace(/\./g, '').replace(',', '.')) * 100);
  var totalReceberObtido = Math.round(parseFloat(dom['finKpiReceber'].textContent.replace('R$', '').replace(/\./g, '').replace(',', '.')) * 100);
  var totalPagarObtido = Math.round(parseFloat(dom['finKpiPagar'].textContent.replace('R$', '').replace(/\./g, '').replace(',', '.')) * 100);

  var refSaldoImediatoCents = refRecebidoImediatoCents - refPagoCents;
  var refProjetadoCents = refSaldoImediatoCents + refCrPendCents - refCpPendCents;

  console.log('  → ' + (NUM * 4) + ' lançamentos gerados (TX/CP pago/CP pendente/CR pendente)');
  test('B1. STRESS — Saldo Disponível Imediato bate EXATAMENTE a referência em centavos (recebidoPIX - pagoCP)',
    saldoImediatoObtido, refSaldoImediatoCents);
  test('B2. STRESS — Total a Receber (CR pendente) bate exato', totalReceberObtido, refCrPendCents);
  test('B3. STRESS — Total a Pagar (CP agendado) bate exato', totalPagarObtido, refCpPendCents);

  var projetadoObtido = Math.round(parseFloat(dom['finKpiProjetado'].textContent.replace('R$', '').replace(/\./g, '').replace(',', '.')) * 100);
  test('B4. STRESS — Projetado (saldoImediato + aReceber - aPagar) bate exato mesmo encadeando 3 somas cent-safe',
    projetadoObtido, refProjetadoCents);

  try { fs.unlinkSync(modPath); } catch (e) {}
  delete global.domStore;
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
