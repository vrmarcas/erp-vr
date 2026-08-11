/**
 * test_cartoes_2026-08-08.js
 *
 * RODADA 4 — seção 2: Cartões de Crédito e Faturas. Testa as funções REAIS
 * extraídas de index.html, cobrindo exatamente os cenários pedidos: compra
 * antes/depois do fechamento, parcelamento 3x e 12x (com centavos), e
 * pagamento de fatura sem duplicar a despesa no resultado financeiro.
 *
 * Uso: node scripts/test_cartoes_2026-08-08.js
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
  // SPRINT DE CORREÇÃO PÓS-AUDITORIA, P2.2 — finCartaoValorFatura() agora
  // soma via helpers cent-safe.
  'moneyToCents', 'centsToMoney', 'sumCents',
  'finCPCompetenciaStr', 'finCPParseISO', 'finCPVencimentoDaCompetencia',
  'finCartaoCompetenciaFatura', 'finCartaoGerarParcelas', 'finCartaoRegistrarCompra',
  'finCartaoGarantirFaturas', 'finCartaoValorFatura', 'finCartaoComprasDaFatura',
  'finCartaoPagarFatura', 'finCartaoAtualizarStatusFaturas',
  // GO-LIVE 2026-08-11, seção 42-50 — Cartões passou a sincronizar/pagar via
  // Contas a Pagar (finCartaoSincronizarCPFatura/_finCPPagarConfirmar).
  'finNormCat', 'finCartaoCategoriaSlug', 'finCartaoFaturaPorCategoria',
  'finCartaoSincronizarCPFatura', '_finCPPagarConfirmar', '_confirmarAposSalvar',
];
var src = [
  'var FIN_CARTOES = []; var FIN_CARTAO_COMPRAS = []; var FIN_FATURAS = []; var FIN_CP = [];',
  "var FIN_CAT_ALIAS={'Matéria-prima':'Matéria-Prima','Pessoal':'Pessoal Admin'};",
  "var FIN_CARTAO_CAT_SLUG={'Matéria-Prima':'materia_prima','Mão de Obra Direta':'mod','Pessoal Admin':'pessoal_admin','Operacional':'operacional','Impostos':'impostos','Empréstimos':'emprestimos','Outros':'outros'};",
  "function _cloudSave(k,v){ return Promise.resolve({ok:true}); }",
  "function _finSaveCP(){ return _cloudSave('fin_cp', FIN_CP); }",
  "function finCPRender(){} function finDashKPIs(){} function finDonutRender(){}",
  "function showToast(){}",
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  registrarCompra: finCartaoRegistrarCompra, valorFatura: finCartaoValorFatura,',
  '  comprasDaFatura: finCartaoComprasDaFatura, pagarFatura: finCartaoPagarFatura,',
  '  competenciaFatura: finCartaoCompetenciaFatura, atualizarStatus: finCartaoAtualizarStatusFaturas,',
  '  getCartoes: function(){ return FIN_CARTOES; }, setCartoes: function(v){ FIN_CARTOES = v; },',
  '  getCompras: function(){ return FIN_CARTAO_COMPRAS; }, setCompras: function(v){ FIN_CARTAO_COMPRAS = v; },',
  '  getFaturas: function(){ return FIN_FATURAS; }, setFaturas: function(v){ FIN_FATURAS = v; },',
  '  getCP: function(){ return FIN_CP; }, setCP: function(v){ FIN_CP = v; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_cartoes_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 4 — Cartões de Crédito e Faturas (funções reais extraídas) ===\n');

var CARTAO = { id: 'cartao1', nome: 'Itaú Empresarial', emissor: 'Itaú', diaFechamento: 10, diaVencimento: 20, contaBancaria: 'itau', ativo: true };
function reset() { mod.setCartoes([CARTAO]); mod.setCompras([]); mod.setFaturas([]); mod.setCP([]); }

// ── compra ANTES do fechamento (dia 08, fechamento dia 10) ────────────────
reset();
{
  var r1 = mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-08', fornecedor: 'Posto X', descricao: 'Combustível', valorTotal: 300, parcelas: 1, marca: 'vr' });
  test('1. compra ANTES do fechamento (dia 08, fecha dia 10) entra na competência do MESMO mês', r1.parcelas[0].competencia, '2026-09');
}

// ── compra DEPOIS do fechamento (dia 11, fechamento dia 10) ───────────────
reset();
{
  var r2 = mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-11', fornecedor: 'Posto X', descricao: 'Combustível', valorTotal: 300, parcelas: 1, marca: 'vr' });
  test('2. compra DEPOIS do fechamento (dia 11, fecha dia 10) entra na competência do mês SEGUINTE', r2.parcelas[0].competencia, '2026-10');
}

// ── compra EXATAMENTE no dia de fechamento (limite — conta como "antes") ──
reset();
{
  var r3 = mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-10', fornecedor: 'Posto X', descricao: 'Combustível', valorTotal: 100, parcelas: 1, marca: 'vr' });
  test('3. compra NO PRÓPRIO dia do fechamento (dia 10) ainda entra no mês corrente (limite inclusivo)', r3.parcelas[0].competencia, '2026-09');
}

// ── parcelamento 3x — sem perder centavos ─────────────────────────────────
reset();
{
  var r4 = mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-05', fornecedor: 'Loja Y', descricao: 'Material de escritório', valorTotal: 100, parcelas: 3, marca: 'vr' });
  test('4. parcelamento 3x de R$100 gera exatamente 3 parcelas', r4.parcelas.length, 3);
  var somaP = r4.parcelas.reduce(function (s, p) { return s + p.valor; }, 0);
  test('5. soma das 3 parcelas bate exatamente R$100,00 (nunca perde centavos no arredondamento)', Math.round(somaP * 100) / 100, 100);
  test('6. cada parcela sabe seu número/total ("2/3" etc.)', r4.parcelas.map(function (p) { return p.numero + '/' + p.totalParcelas; }), ['1/3', '2/3', '3/3']);
  test('7. competências das 3 parcelas avançam mês a mês a partir da competência da compra', r4.parcelas.map(function (p) { return p.competencia; }), ['2026-09', '2026-10', '2026-11']);
}

// ── parcelamento 12x com valor que não divide exato (ex.: R$1.200 em 6x já é exato; testar 12x de R$1.000 = 83,333...) ──
reset();
{
  var r5 = mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-01-05', fornecedor: 'Fornecedor Z', descricao: 'Equipamento', valorTotal: 1000, parcelas: 12, marca: 'vr' });
  test('8. parcelamento 12x gera exatamente 12 parcelas', r5.parcelas.length, 12);
  var somaP12 = r5.parcelas.reduce(function (s, p) { return s + p.valor; }, 0);
  test('9. soma das 12 parcelas bate exatamente R$1000,00 mesmo sem divisão exata (a última absorve o resto)', Math.round(somaP12 * 100) / 100, 1000);
  test('10. a 12ª competência é dezembro do mesmo ano (jan + 11 meses)', r5.parcelas[11].competencia, '2026-12');
}

// ── exemplo literal do enunciado: R$1.200 em 6x ────────────────────────────
reset();
{
  var r6 = mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-03-05', fornecedor: 'Loja W', descricao: 'Móveis', valorTotal: 1200, parcelas: 6, marca: 'vr' });
  test('11. R$1.200 em 6x gera 6 parcelas de exatamente R$200,00 cada', r6.parcelas.map(function (p) { return p.valor; }), [200, 200, 200, 200, 200, 200]);
}

// ── faturas geradas automaticamente e agregadas corretamente ──────────────
reset();
{
  mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-08', fornecedor: 'A', descricao: 'X', valorTotal: 100, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-09', fornecedor: 'B', descricao: 'Y', valorTotal: 50, parcelas: 1, marca: 'vr' });
  var faturaSet = mod.getFaturas().filter(function (f) { return f.competencia === '2026-09'; });
  test('12. as duas compras do mesmo mês/cartão caem na MESMA fatura (agregação por cartão+competência)', faturaSet.length, 1);
  test('13. valor da fatura soma as duas compras corretamente', mod.valorFatura(faturaSet[0].id), 150);
  test('14. comprasDaFatura retorna as 2 compras vinculadas', mod.comprasDaFatura(faturaSet[0].id).length, 2);
}

// ── pagar fatura: gera saída real, NUNCA duplica a despesa ────────────────
reset();
{
  mod.registrarCompra({ cartaoId: 'cartao1', data: '2026-09-08', fornecedor: 'A', descricao: 'X', valorTotal: 500, parcelas: 1, marca: 'vr' });
  var fat = mod.getFaturas()[0];
  var rPag = mod.pagarFatura(fat.id, '2026-09-20', 'itau');
  test('15. pagar a fatura funciona e devolve o valor pago', rPag, { ok: true, valorPago: 500 });
  test('16. a fatura fica marcada como paga', mod.getFaturas()[0].pago, true);
  test('17. as parcelas daquela fatura ficam status="pago"', mod.getCompras()[0].parcelasDetalhe[0].status, 'pago');
  // NUNCA duplica: continua existindo exatamente 1 compra e 1 fatura (o pagamento não cria uma segunda "despesa")
  test('18. pagar a fatura NÃO cria uma segunda compra/despesa (só marca a existente como paga)', mod.getCompras().length, 1);
  test('19. pagar a fatura NÃO cria uma segunda fatura', mod.getFaturas().length, 1);
  var rPag2 = mod.pagarFatura(fat.id, '2026-09-21', 'itau');
  test('20. pagar uma fatura já paga é bloqueado (idempotência — nunca paga 2x)', rPag2.ok, false);
}

// ── status de fatura (aberta/fechada/vencida) — usa data real do ambiente ──
{
  reset();
  var hoje = new Date();
  var passadoISO = new Date(hoje.getFullYear() - 1, 0, 5).toISOString().slice(0, 10);
  mod.registrarCompra({ cartaoId: 'cartao1', data: passadoISO, fornecedor: 'A', descricao: 'X', valorTotal: 10, parcelas: 1, marca: 'vr' });
  mod.atualizarStatus();
  test('21. fatura de competência bem passada e não paga fica "vencida"', mod.getFaturas()[0].status, 'vencida');
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
