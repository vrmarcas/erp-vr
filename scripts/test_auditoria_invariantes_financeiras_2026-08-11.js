/**
 * test_auditoria_invariantes_financeiras_2026-08-11.js
 *
 * GO-LIVE 2026-08-11, FASE F — seção 51-58: auditoria numérica completa dos
 * relatórios financeiros (Dashboard, Caixa Diário, Relatório Mensal,
 * Relatório Anual, DRE, Contas Pagas, Histórico, Relatório Fiscal), com
 * evidência EXECUTÁVEL (não narrativa) usando as funções REAIS extraídas de
 * index.html.
 *
 * O objetivo central desta rodada: provar que uma despesa que agora nasce no
 * módulo de Cartões (seção 42-50, finCartaoPagarFatura → FIN_CP via
 * _finCPPagarConfirmar) aparece EXATAMENTE UMA VEZ em cada relatório que lê
 * FIN_CP — nunca some, nunca duplica — e que os relatórios que devem ficar
 * fora dessa cadeia (Histórico, Relatório Fiscal) continuam estruturalmente
 * isolados.
 *
 * Fixture única e determinística: 1 venda recebida (FIN_CR), 1 despesa
 * manual paga (FIN_CP direto) e 1 despesa de cartão paga via
 * finCartaoPagarFatura (FIN_CP criado pela integração da seção 42-50), todas
 * na mesma data (15/06/2026) — permite comparar o MESMO número em todos os
 * relatórios.
 *
 * Uso: node scripts/test_auditoria_invariantes_financeiras_2026-08-11.js
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
// Extrai o CORPO da função (sem a assinatura) — usado para checar
// estruturalmente que Histórico/Fiscal nunca leem FIN_CP/Cartões.
function fnSource(name) { return extractFn(name); }

var FN_NAMES = [
  'moneyToCents', 'centsToMoney', 'sumCents', 'finFmt', 'finCPValorNum', 'finNormCat',
  'finCPCompetenciaStr', 'finCPParseISO', 'finCPVencimentoDaCompetencia',
  'relNormMetodo', 'relMetodoBadge', '_relFecRow',
  'relCaixaDiario', 'relMensal', 'relContasPagas', 'relAnual', 'finCalcularDRE',
  'finCartaoCompetenciaFatura', 'finCartaoGerarParcelas', 'finCartaoRegistrarCompra',
  'finCartaoGarantirFaturas', 'finCartaoCategoriaSlug', 'finCartaoFaturaPorCategoria',
  'finCartaoSincronizarCPFatura', 'finCartaoComprasDaFatura', 'finCartaoValorFatura',
  'finCartaoPagarFatura', '_finCPPagarConfirmar', '_confirmarAposSalvar',
];
var src = [
  "var FIN_CR=[], FIN_CP=[], FIN_TX=[], FIN_CARTOES=[], FIN_CARTAO_COMPRAS=[], FIN_FATURAS=[];",
  "var FIN_TAXA_IMPOSTO_DRE=0.085;",
  "var FIN_CAT_ALIAS={'Matéria-prima':'Matéria-Prima','Pessoal':'Pessoal Admin'};",
  "var FIN_TIPO_MAP={'Matéria-Prima':'custo','Mão de Obra Direta':'custo','Pessoal Admin':'despesa','Operacional':'despesa','Impostos':'despesa','Empréstimos':'despesa','Outros':'despesa'};",
  "var FIN_CARTAO_CAT_SLUG={'Matéria-Prima':'materia_prima','Mão de Obra Direta':'mod','Pessoal Admin':'pessoal_admin','Operacional':'operacional','Impostos':'impostos','Empréstimos':'emprestimos','Outros':'outros'};",
  "var _cloudSaveCalls=[]; function _cloudSave(k,v){ _cloudSaveCalls.push(k); return Promise.resolve({ok:true}); }",
  "function _finSaveCP(){ return _cloudSave('fin_cp', FIN_CP); }",
  "function finCPRender(){} function finDashKPIs(){} function finDonutRender(){}",
  "function showToast(){}",
  "var domStore = {};",
  "function document_getElementById(id){ if(!domStore[id]) domStore[id] = { value:'', textContent:'', innerHTML:'', style:{} }; return domStore[id]; }",
  "var document = { getElementById: document_getElementById };",
  FN_NAMES.map(extractFn).join('\n\n'),
  [
    'module.exports = {',
    '  dom: function(){ return domStore; },',
    '  getEl: document_getElementById,',
    '  setCR: function(v){ FIN_CR.length=0; FIN_CR.push.apply(FIN_CR,v); },',
    '  setCP: function(v){ FIN_CP.length=0; FIN_CP.push.apply(FIN_CP,v); },',
    '  getCP: function(){ return FIN_CP; },',
    '  setCartoes: function(v){ FIN_CARTOES.length=0; FIN_CARTOES.push.apply(FIN_CARTOES,v); },',
    '  registrarCompraCartao: finCartaoRegistrarCompra,',
    '  pagarFaturaCartao: finCartaoPagarFatura,',
    '  getFaturas: function(){ return FIN_FATURAS; },',
    '  caixaDiario: relCaixaDiario, mensal: relMensal, contasPagas: relContasPagas, anual: relAnual,',
    '  calcularDRE: finCalcularDRE,',
    '};',
  ].join('\n'),
].join('\n\n');
var modPath = path.join(__dirname, '_auditoria_invariantes_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== GO-LIVE FASE F — Auditoria numérica dos relatórios financeiros (seção 51-58) ===\n');

// ── Fixture única e determinística ─────────────────────────────────────────
// 1 venda recebida + 1 despesa manual paga + 1 despesa de CARTÃO paga (via
// a integração real da seção 42-50), todas em 15/06/2026.
mod.setCartoes([{ id: 'fcartao_aud', nome: 'Cartão Auditoria', emissor: 'Banco X', diaFechamento: 25, diaVencimento: 5, contaBancaria: 'banco_principal', ativo: true }]);
mod.setCR([{ cliente: 'Cliente Auditoria', valor: 1000, status: 'recebido', metodo: 'PIX', descricao: 'Venda #999', dataCriacao: '15/06/2026', dataRecebimento: '15/06/2026' }]);
mod.setCP([{
  id: 'cp_manual_aud', descricao: 'Aluguel', categoria: 'Operacional', valor: 500,
  vencimento: '15/06/2026', status: 'pago', dataPagamento: '15/06/2026', formaPgto: 'Banco', marca: 'vr',
}]);
var compraCartao = mod.registrarCompraCartao({ cartaoId: 'fcartao_aud', data: '2026-06-01', fornecedor: 'Fornecedor Cartão', descricao: 'Material via cartão', categoria: 'Operacional', valorTotal: 300, parcelas: 1, marca: 'vr' });
testTrue('0. fixture: compra no cartão registrada com sucesso', compraCartao.ok === true);
var faturaId = mod.getFaturas()[0].id;
// Paga a fatura na MESMA data das demais despesas — prova que a data de
// pagamento vem do parâmetro real da rotina, não da competência da fatura.
var pagCartao = mod.pagarFaturaCartao(faturaId, '2026-06-15', 'banco_principal');
testTrue('0.1. fixture: fatura do cartão paga com sucesso (integra à Contas a Pagar via _finCPPagarConfirmar)', pagCartao.ok === true && pagCartao.valorPago === 300);
testTrue('0.2. fixture: FIN_CP agora tem exatamente 2 lançamentos pagos (manual + cartão) — nenhum a mais, nenhum a menos', mod.getCP().filter(function (c) { return c.status === 'pago'; }).length === 2);

var TOTAL_SAIDAS_ESPERADO = 500 + 300; // 800 — manual + cartão, nunca duplicado, nunca ausente

// nth=1 pega o 1º valor "R$ ..." após o label; nth=2 o 2º etc. — necessário
// para linhas de tabela com várias colunas monetárias na mesma linha (ex.:
// "TOTAL MÊS" tem Entradas na 1ª coluna e Saídas na 2ª).
function extrairValorAposLabel(htmlStr, label, nth) {
  var idx = htmlStr.indexOf(label);
  if (idx < 0) return null;
  var re = /R\$\s?[\d.]*,\d{2}/g;
  var resto = htmlStr.slice(idx);
  var m, count = 0, target = nth || 1;
  while ((m = re.exec(resto))) {
    count++;
    if (count === target) return Math.round(parseFloat(m[0].replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) * 100);
  }
  return null;
}

// ── 1. Caixa Diário — Total Saídas do dia 15/06/2026 ───────────────────────
{
  mod.getEl('relCaixaData').value = '2026-06-15';
  mod.caixaDiario();
  var gridHtml = mod.getEl('relCaixaGrid').innerHTML;
  var totSaidasCents = extrairValorAposLabel(gridHtml, 'Total Saídas');
  test('1. Caixa Diário — "Total Saídas" do dia soma a despesa MANUAL + a despesa de CARTÃO exatamente 1x cada (500+300=800, nunca 500 nem 1100)', totSaidasCents, TOTAL_SAIDAS_ESPERADO * 100);
  var totEntCents = extrairValorAposLabel(gridHtml, 'Total Entradas');
  test('2. Caixa Diário — "Total Entradas" do dia reflete a venda recebida (1000), sem contaminação das saídas', totEntCents, 100000);
  var saidasTableHtml = mod.getEl('relCaixaSaidas').innerHTML;
  testTrue('3. Caixa Diário — a tabela de saídas lista as 2 despesas pagas (Aluguel e a descrição da fatura do cartão)', saidasTableHtml.indexOf('Aluguel') >= 0 && saidasTableHtml.indexOf('Fatura cartão') >= 0);
}

// ── 2. Relatório Mensal — TOTAL MÊS de junho/2026 ──────────────────────────
{
  mod.getEl('relMensalMes').value = '6'; mod.getEl('relMensalAno').value = '2026';
  mod.mensal();
  var mensalHtml = mod.getEl('relMensalConteudo').innerHTML;
  var totSaiMesCents = extrairValorAposLabel(mensalHtml, 'TOTAL MÊS', 2); // 1ª coluna=Entradas, 2ª=Saídas
  test('4. Relatório Mensal — saídas de junho/2026 batem com Caixa Diário (mesma fonte, mesmo total: 800)', totSaiMesCents, TOTAL_SAIDAS_ESPERADO * 100);
}

// ── 3. Contas Pagas — Total Pago em junho/2026 ─────────────────────────────
{
  mod.getEl('relContasMes').value = '6'; mod.getEl('relContasAno').value = '2026';
  mod.contasPagas();
  var contasHtml = mod.getEl('relContasConteudo').innerHTML;
  var totPagoCents = extrairValorAposLabel(contasHtml, 'Total Pago');
  test('5. Contas Pagas — Total Pago em junho/2026 bate com Caixa Diário e Relatório Mensal (mesma fonte FIN_CP, mesmo total: 800)', totPagoCents, TOTAL_SAIDAS_ESPERADO * 100);
  testTrue('6. Contas Pagas — a despesa de cartão aparece na listagem com sua descrição própria (rastreável até a fatura de origem)', contasHtml.indexOf('Fatura cartão') >= 0);
}

// ── 4. Relatório Anual — Total Saídas do ano de 2026 ───────────────────────
{
  mod.getEl('relAnualAno').value = '2026';
  mod.anual();
  var anualHtml = mod.getEl('relAnualConteudo').innerHTML;
  var totSaidasAnoCents = extrairValorAposLabel(anualHtml, 'Total Saídas');
  test('7. Relatório Anual — Total Saídas de 2026 inclui a mesma despesa de cartão exatamente 1x (bate com os demais relatórios: 800)', totSaidasAnoCents, TOTAL_SAIDAS_ESPERADO * 100);
}

// ── 5. DRE — paridade Caixa × DRE (regime de caixa) ────────────────────────
{
  var cpPagos = mod.getCP().filter(function (c) { return c.status === 'pago'; });
  var dre = mod.calcularDRE([], cpPagos);
  // As 2 despesas (manual + cartão) são categoria Operacional → tipo despesa
  // (nunca custo/CMV) — cpOp precisa refletir a MESMA soma que Caixa
  // Diário/Contas Pagas/Mensal/Anual já provaram bater (800), nunca uma
  // conta paralela divergente.
  test('8. DRE — cpOp (despesa Operacional) bate EXATAMENTE com o total de saídas provado em Caixa/Contas Pagas/Mensal/Anual (paridade Caixa×DRE, incluindo a despesa de cartão)', dre.cpOp, TOTAL_SAIDAS_ESPERADO);
  test('9. DRE — nenhuma das 2 despesas caiu em cpOutros (ambas são categoria Operacional real, não "Outros" por engano)', dre.cpOutros, 0);
}

// ── 6. Histórico e Relatório Fiscal — isolamento estrutural comprovado ─────
// Histórico lê um documento agregado separado (erp_vr/hist_mensal) e nunca
// deveria ler FIN_CP/FIN_TX/FIN_CR nem nada do módulo de Cartões — a prova
// aqui é ESTRUTURAL (o código-fonte da função nunca referencia essas
// variáveis), não um mock pesado do Firestore só para reconfirmar isolamento
// já garantido pela ausência total dessas referências.
{
  var srcHist = fnSource('histRender');
  testTrue('10. Histórico (histRender) nunca lê FIN_CP/FIN_TX/FIN_CR — fonte é só erp_vr/hist_mensal, isolado do fluxo de Cartões', !/FIN_CP|FIN_TX|FIN_CR/.test(srcHist));
  testTrue('11. Histórico (histRender) nunca referencia o módulo de Cartões (FIN_CARTAO/FIN_FATURAS)', !/FIN_CARTAO|FIN_FATURAS/.test(srcHist));

  var srcFiscal = fnSource('relFiscalGetFiltrados');
  testTrue('12. Relatório Fiscal (relFiscalGetFiltrados) nunca lê FIN_CP/FIN_TX/FIN_CR — fonte é só orcGetEnviados(), isolado do fluxo de Caixa/DRE/Cartões', !/FIN_CP|FIN_TX|FIN_CR/.test(srcFiscal));
  testTrue('13. Relatório Fiscal nunca referencia o módulo de Cartões', !/FIN_CARTAO|FIN_FATURAS/.test(srcFiscal));
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
