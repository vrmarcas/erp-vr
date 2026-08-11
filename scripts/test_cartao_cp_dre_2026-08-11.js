/**
 * test_cartao_cp_dre_2026-08-11.js
 *
 * GO-LIVE 2026-08-11, FASE D — seção 42-50 (CORREÇÃO PÓS-RELATÓRIO): Cartões
 * → Fatura → Contas a Pagar → Caixa → DRE, com a regra de negócio CORRETA
 * confirmada pelo usuário:
 *
 *   Para cada (cartão, competência) existe UMA ÚNICA obrigação em Contas a
 *   Pagar, representando o valor TOTAL da fatura. As categorias econômicas
 *   das compras individuais permanecem como COMPOSIÇÃO INTERNA dessa
 *   obrigação (usada só para classificar custo/despesa no DRE) — nunca como
 *   obrigações financeiras separadas. A dívida com o banco é UMA.
 *
 * (A versão anterior deste arquivo testava — incorretamente — 1 CP POR
 * CATEGORIA dentro da mesma fatura; foi substituída por completo por este
 * arquivo, que testa a arquitetura corrigida.)
 *
 * Este arquivo prova, com as funções REAIS extraídas de index.html, os 9
 * cenários explicitamente pedidos pelo usuário:
 *   1) Bradesco/agosto com 5 compras e 3 categorias → 1 CP no total da fatura.
 *   2) Abrir a fatura mostra as 5 compras e a decomposição por categoria.
 *   3) Soma da composição = total da fatura = valor da CP.
 *   4) Nova compra antes do fechamento atualiza a mesma fatura e a mesma CP.
 *   5) Nenhuma segunda CP por categoria.
 *   6) DRE preserva as categorias econômicas das compras.
 *   7) Pagamento da fatura não duplica despesa/custo no DRE.
 *   8) Pagamento gera a saída financeira exatamente uma vez.
 *   9) Retry/double-click não duplica saída.
 *
 * Uso: node scripts/test_cartao_cp_dre_2026-08-11.js
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
function testTrue(desc, condition) {
  if (condition) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + ' (condição falsa)'); failed++; }
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
  'finCPValorNum', 'finNormCat', 'finCPCompetenciaStr', 'finCPParseISO', 'finCPVencimentoDaCompetencia',
  'finCartaoCompetenciaFatura', 'finCartaoGerarParcelas', 'finCartaoRegistrarCompra',
  'finCartaoGarantirFaturas', 'finCartaoFaturaPorCategoria',
  'finCartaoSincronizarCPFatura', 'finCartaoValorFatura', 'finCartaoComprasDaFatura',
  'finCartaoPagarFatura', 'sumCents', 'centsToMoney', 'moneyToCents', 'finCalcularDRE',
  '_finCPPagarConfirmar', '_confirmarAposSalvar',
];
var src = [
  "var FIN_CARTOES=[], FIN_CARTAO_COMPRAS=[], FIN_FATURAS=[], FIN_CP=[];",
  "var FIN_CAT_ALIAS={'Matéria-prima':'Matéria-Prima','Pessoal':'Pessoal Admin'};",
  "var FIN_TAXA_IMPOSTO_DRE=0.085;",
  "var _cloudSaveCalls=[]; function _cloudSave(k,v){ _cloudSaveCalls.push(k); return Promise.resolve({ok:true}); }",
  "function _finSaveCP(){ return _cloudSave('fin_cp', FIN_CP); }",
  "function finCPRender(){} function finDashKPIs(){} function finDonutRender(){}",
  "var _toasts=[]; function showToast(msg,tipo){ _toasts.push({msg:msg,tipo:tipo}); }",
  FN_NAMES.map(extractFn).join('\n\n'),
  [
    'module.exports = {',
    '  registrarCompra: finCartaoRegistrarCompra,',
    '  garantirFaturas: finCartaoGarantirFaturas,',
    '  faturaPorCategoria: finCartaoFaturaPorCategoria,',
    '  sincronizarCPFatura: finCartaoSincronizarCPFatura,',
    '  valorFatura: finCartaoValorFatura,',
    '  comprasDaFatura: finCartaoComprasDaFatura,',
    '  pagarFatura: finCartaoPagarFatura,',
    '  calcularDRE: finCalcularDRE,',
    '  pagarConfirmar: _finCPPagarConfirmar,',
    '  state: function () { return { FIN_CARTOES: FIN_CARTOES, FIN_CARTAO_COMPRAS: FIN_CARTAO_COMPRAS, FIN_FATURAS: FIN_FATURAS, FIN_CP: FIN_CP }; },',
    '  setCartoes: function (arr) { FIN_CARTOES.length = 0; FIN_CARTOES.push.apply(FIN_CARTOES, arr); },',
    '  cpsDaFatura: function (faturaId) { return FIN_CP.filter(function(c){ return c.origemFaturaId===faturaId; }); },',
    '};',
  ].join('\n'),
].join('\n\n');
var modPath = path.join(__dirname, '_cartao_cp_dre_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== GO-LIVE FASE D (correção pós-relatório) — Cartões → 1 CP por fatura → Caixa → DRE ===\n');

function novoAmbiente() {
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);
  mod.setCartoes([{ id: 'fcartao_bradesco', nome: 'Bradesco', emissor: 'Bradesco', diaFechamento: 10, diaVencimento: 20, contaBancaria: 'banco_principal', ativo: true }]);
  return mod;
}

// ── 1/2/3. Bradesco/agosto, 5 compras, 3 categorias → 1 CP no total ────────
// (cenários 1, 2 e 3 do usuário, no mesmo bloco por compartilharem a fixture)
var mod1, faturaId1;
{
  var mod = novoAmbiente();
  mod.registrarCompra({ cartaoId: 'fcartao_bradesco', data: '2026-08-03', fornecedor: 'Loja A', descricao: 'Papel', categoria: 'Operacional', valorTotal: 100, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'fcartao_bradesco', data: '2026-08-04', fornecedor: 'Loja B', descricao: 'Toner', categoria: 'Operacional', valorTotal: 50, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'fcartao_bradesco', data: '2026-08-05', fornecedor: 'Fornecedor Chapas', descricao: 'Acrílico', categoria: 'Matéria-Prima', valorTotal: 220, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'fcartao_bradesco', data: '2026-08-06', fornecedor: 'Contador', descricao: 'Honorários', categoria: 'Impostos', valorTotal: 60, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'fcartao_bradesco', data: '2026-08-07', fornecedor: 'Ferragista', descricao: 'Parafusos', categoria: 'Matéria-Prima', valorTotal: 7000, parcelas: 1, marca: 'vr' });
  var st = mod.state();
  faturaId1 = st.FIN_FATURAS[0].id;
  mod1 = mod;

  test('1. Bradesco/agosto: 5 compras em 3 categorias diferentes viram EXATAMENTE 1 lançamento em FIN_CP (a dívida com o banco é UMA)', st.FIN_CP.length, 1);
  test('1b. o valor da ÚNICA CP é o total da fatura (100+50+220+60+7000=7430,00)', st.FIN_CP[0].valor, 7430);
  testTrue('1c. o id da CP é determinístico por (cartão, competência) — nunca por categoria', st.FIN_CP[0].id === 'cpcartao_' + faturaId1);

  var compras = mod.comprasDaFatura(faturaId1);
  test('2. abrir a fatura mostra as 5 compras vinculadas', compras.length, 5);
  var porCat = mod.faturaPorCategoria(faturaId1);
  test('2b. abrir a fatura mostra a decomposição em exatamente as 3 categorias usadas', Object.keys(porCat).sort(), ['Impostos', 'Matéria-Prima', 'Operacional']);
  test('2c. a composição de Operacional soma as 2 compras dessa categoria (100+50=150)', porCat['Operacional'].valor, 150);
  test('2d. a composição de Matéria-Prima soma as 2 compras dessa categoria (220+7000=7220)', porCat['Matéria-Prima'].valor, 7220);
  test('2e. a composição de Impostos reflete a única compra dessa categoria (60)', porCat['Impostos'].valor, 60);

  var somaComposicao = Object.keys(porCat).reduce(function (s, cat) { return s + porCat[cat].valor; }, 0);
  var totalFatura = mod.valorFatura(faturaId1);
  var valorCP = st.FIN_CP[0].valor;
  test('3. soma da composição (150+7220+60=7430) = total da fatura = valor da CP — os 3 números batem exatos', [Math.round(somaComposicao * 100), Math.round(totalFatura * 100), Math.round(valorCP * 100)], [743000, 743000, 743000]);
}

// ── 4. Nova compra antes do fechamento atualiza a MESMA fatura e a MESMA CP ─
{
  var stAntes = mod1.state();
  var cpIdAntes = stAntes.FIN_CP[0].id;
  mod1.registrarCompra({ cartaoId: 'fcartao_bradesco', data: '2026-08-08', fornecedor: 'Loja C', descricao: 'Canetas', categoria: 'Operacional', valorTotal: 70, parcelas: 1, marca: 'vr' });
  var stDepois = mod1.state();
  test('4. nova compra ANTES do fechamento (dia 8, fecha dia 10) atualiza a MESMA CP (mesmo id) — nunca cria uma 2ª', stDepois.FIN_CP.map(function (c) { return c.id; }), [cpIdAntes]);
  test('4b. o valor da CP atualizada reflete a nova compra (7430+70=7500)', stDepois.FIN_CP[0].valor, 7500);
  var porCatDepois = mod1.faturaPorCategoria(faturaId1);
  test('4c. a composição de Operacional também foi atualizada (150+70=220)', porCatDepois['Operacional'].valor, 220);
}

// ── 5. Nenhuma segunda CP por categoria, mesmo reexecutando a sincronização ─
{
  mod1.sincronizarCPFatura(faturaId1);
  mod1.sincronizarCPFatura(faturaId1);
  mod1.sincronizarCPFatura(faturaId1);
  var st = mod1.state();
  test('5. reexecutar a sincronização 3x NUNCA cria uma 2ª CP (nem por categoria, nem por fatura) — continua exatamente 1', st.FIN_CP.length, 1);
}

// ── 6/7/8. DRE preserva categorias das compras; pagamento não duplica ──────
{
  var stAntes = mod1.state();
  var dreAntesPagar = mod1.calcularDRE([], stAntes.FIN_CP.filter(function (c) { return c.status === 'pago'; }));
  test('7a. ANTES de pagar a fatura, DRE em regime de caixa (só status=pago) não vê nenhuma das compras do cartão', [dreAntesPagar.cpOp, dreAntesPagar.cmvMat, dreAntesPagar.cpImp], [0, 0, 0]);

  var pag = mod1.pagarFatura(faturaId1, '2026-08-20', 'banco_principal');
  testTrue('8. pagar a fatura retorna ok=true com o valor total pago (7500,00)', pag.ok === true && pag.valorPago === 7500);

  var stDepois = mod1.state();
  testTrue('8b. pagar a fatura marca a ÚNICA CP como paga (não sobra nenhuma CP pendente vinculada a esta fatura)', stDepois.FIN_CP.filter(function (c) { return c.origemFaturaId === faturaId1; }).every(function (c) { return c.status === 'pago'; }));
  test('8c. continua existindo exatamente 1 CP vinculado a esta fatura depois de paga (pagamento não cria uma 2ª obrigação)', mod1.cpsDaFatura(faturaId1).length, 1);

  var dreDepoisPagar = mod1.calcularDRE([], stDepois.FIN_CP.filter(function (c) { return c.status === 'pago'; }));
  test('6. DRE preserva as categorias econômicas das compras que formaram a fatura: Operacional=220, Matéria-Prima(CMV)=7220, Impostos=60 — cada uma na sua classificação, mesmo vindo de 1 único CP', [dreDepoisPagar.cpOp, dreDepoisPagar.cmvMat, dreDepoisPagar.cpImp], [220, 7220, 60]);
  test('6b. nenhuma das categorias reais caiu em cpOutros por engano', dreDepoisPagar.cpOutros, 0);
  test('7. pagamento da fatura NÃO duplica: comparando com o DRE que seria obtido somando as compras originais direto (150+70=220 Op / 7220 MatPrima / 60 Impostos) — bate exato, cada valor aparece 1x', [dreDepoisPagar.cpOp, dreDepoisPagar.cmvMat, dreDepoisPagar.cpImp], [220, 7220, 60]);
}

// ── 9. Retry / duplo clique no pagamento não duplica a saída financeira ────
{
  var stAntes = mod1.state();
  var cpAntes = mod1.cpsDaFatura(faturaId1)[0];
  var dataPagamentoAntes = cpAntes.dataPagamento;

  // Retry 1: chamar pagarFatura de novo na fatura já paga (ex.: duplo clique no botão "Pagar")
  var retry1 = mod1.pagarFatura(faturaId1, '2026-08-21', 'banco_principal');
  testTrue('9a. reexecutar pagarFatura numa fatura já paga é bloqueado (fatura já paga)', retry1.ok === false);

  // Retry 2: chamar a rotina canônica de pagamento direto no mesmo id de CP (defesa na camada mais baixa)
  mod1.pagarConfirmar(cpAntes.id, '2026-08-22');
  var stDepois = mod1.state();
  var cpDepois = stDepois.FIN_CP.find(function (c) { return c.id === cpAntes.id; });
  test('9b. retry direto em _finCPPagarConfirmar no mesmo id nunca reabre nem reprocessa um pagamento já confirmado — data de pagamento não muda', cpDepois.dataPagamento, dataPagamentoAntes);
  test('9c. continua existindo exatamente 1 CP para esta fatura depois dos retries — nenhuma saída duplicada', mod1.cpsDaFatura(faturaId1).length, 1);
  var dreFinal = mod1.calcularDRE([], stDepois.FIN_CP.filter(function (c) { return c.status === 'pago'; }));
  test('9d. o DRE depois dos retries continua idêntico ao original (220/7220/60) — nenhum valor foi somado 2x', [dreFinal.cpOp, dreFinal.cmvMat, dreFinal.cpImp], [220, 7220, 60]);
}

// ── Cenário adicional — parcelamento continua íntegro sob o novo modelo ────
{
  var mod = novoAmbiente();
  mod.registrarCompra({ cartaoId: 'fcartao_bradesco', data: '2026-08-05', fornecedor: 'Loja X', descricao: 'Equipamento', categoria: 'Operacional', valorTotal: 300, parcelas: 3, marca: 'vr' });
  var st = mod.state();
  test('10. compra parcelada em 3x gera faturas em 3 competências distintas (ago/set/out)', st.FIN_FATURAS.map(function (f) { return f.competencia; }).sort(), ['2026-08', '2026-09', '2026-10']);
  test('11. cada fatura do parcelamento tem exatamente 1 CP de 100 (300/3, centavo-exato) — 1 por fatura, não 1 por categoria', st.FIN_CP.map(function (c) { return c.valor; }).sort(function (a, b) { return a - b; }), [100, 100, 100]);
  testTrue('12. cada CP de parcela também é única por fatura', st.FIN_CP.length === 3 && st.FIN_FATURAS.every(function (f) { return st.FIN_CP.filter(function (c) { return c.origemFaturaId === f.id; }).length === 1; }));
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
