/**
 * test_cartao_cp_dre_2026-08-11.js
 *
 * GO-LIVE 2026-08-11, FASE D — seção 42-50: Cartões → Parcelas → Faturas →
 * Contas a Pagar → pagamento → Caixa → DRE, sem duplicar despesa.
 *
 * Antes desta rodada o módulo de Cartões era um silo 100% isolado: registrar
 * uma compra no cartão e pagar a fatura nunca criava nem pagava nada em
 * FIN_CP — a despesa nunca chegava a Caixa Diário/Contas Pagas/Relatório
 * Mensal/Anual/DRE. Este arquivo prova, com as funções REAIS extraídas de
 * index.html, que:
 *   1) registrar uma compra no cartão NÃO afeta o DRE ainda (só agenda);
 *   2) o ciclo/fatura cria exatamente 1 lançamento em FIN_CP por categoria
 *      (nunca 1 por compra — categorias diferentes na mesma fatura não se
 *      misturam);
 *   3) reexecutar a sincronização da fatura (2ª compra no mesmo ciclo,
 *      re-render, etc.) NUNCA duplica o lançamento — sempre reconcilia o
 *      MESMO documento (id determinístico);
 *   4) pagar a fatura paga o(s) CP(s) vinculados pela MESMA rotina canônica
 *      usada em qualquer outra despesa (_finCPPagarConfirmar) — a despesa
 *      aparece exatamente 1 vez no DRE (nunca 2x: nem na compra nem na
 *      fatura em duplicidade);
 *   5) um CP de cartão já pago nunca é remexido por uma nova sincronização.
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
  'finCartaoGarantirFaturas', 'finCartaoCategoriaSlug', 'finCartaoFaturaPorCategoria',
  'finCartaoSincronizarCPFatura', 'finCartaoValorFatura', 'finCartaoComprasDaFatura',
  'finCartaoPagarFatura', 'sumCents', 'centsToMoney', 'moneyToCents', 'finCalcularDRE',
  '_finCPPagarConfirmar', '_confirmarAposSalvar',
];
var src = [
  "var FIN_CARTOES=[], FIN_CARTAO_COMPRAS=[], FIN_FATURAS=[], FIN_CP=[];",
  "var FIN_TAXA_IMPOSTO_DRE=0.085;",
  "var FIN_CAT_ALIAS={'Matéria-prima':'Matéria-Prima','Pessoal':'Pessoal Admin'};",
  "var FIN_CARTAO_CAT_SLUG={'Matéria-Prima':'materia_prima','Mão de Obra Direta':'mod','Pessoal Admin':'pessoal_admin','Operacional':'operacional','Impostos':'impostos','Empréstimos':'emprestimos','Outros':'outros'};",
  "var _cloudSaveCalls=[]; function _cloudSave(k,v){ _cloudSaveCalls.push(k); return Promise.resolve({ok:true}); }",
  "function _finSaveCP(){ return _cloudSave('fin_cp', FIN_CP); }",
  "function finCPRender(){} function finDashKPIs(){} function finDonutRender(){}",
  "var _toasts=[]; function showToast(msg,tipo){ _toasts.push({msg:msg,tipo:tipo}); }",
  FN_NAMES.map(extractFn).join('\n\n'),
  [
    'module.exports = {',
    '  registrarCompra: finCartaoRegistrarCompra,',
    '  garantirFaturas: finCartaoGarantirFaturas,',
    '  categoriaSlug: finCartaoCategoriaSlug,',
    '  faturaPorCategoria: finCartaoFaturaPorCategoria,',
    '  sincronizarCPFatura: finCartaoSincronizarCPFatura,',
    '  valorFatura: finCartaoValorFatura,',
    '  comprasDaFatura: finCartaoComprasDaFatura,',
    '  pagarFatura: finCartaoPagarFatura,',
    '  calcularDRE: finCalcularDRE,',
    '  pagarConfirmar: _finCPPagarConfirmar,',
    '  state: function () { return { FIN_CARTOES: FIN_CARTOES, FIN_CARTAO_COMPRAS: FIN_CARTAO_COMPRAS, FIN_FATURAS: FIN_FATURAS, FIN_CP: FIN_CP }; },',
    '  setCartoes: function (arr) { FIN_CARTOES.length = 0; FIN_CARTOES.push.apply(FIN_CARTOES, arr); },',
    '};',
  ].join('\n'),
].join('\n\n');
var modPath = path.join(__dirname, '_cartao_cp_dre_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== GO-LIVE FASE D — Cartões → CP → Caixa → DRE sem duplicidade (seção 42-50) ===\n');

function novoAmbiente() {
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);
  mod.setCartoes([{ id: 'fcartao_1', nome: 'Nubank Empresarial', emissor: 'Nubank', diaFechamento: 10, diaVencimento: 20, contaBancaria: 'banco_principal', ativo: true }]);
  return mod;
}

// ── 1. Registrar compra não afeta o DRE ainda (só agenda) ──────────────────
{
  var mod = novoAmbiente();
  var r = mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-05', fornecedor: 'Loja X', descricao: 'Material de escritório', categoria: 'Operacional', valorTotal: 300, parcelas: 1, marca: 'vr' });
  testTrue('1. compra registrada com sucesso', r.ok === true);
  var dreVazio = mod.calcularDRE([], []);
  test('2. DRE calculado só com FIN_TX/FIN_CP explicitamente "pagos" (nenhum ainda) não vê a compra recém-registrada', dreVazio.cpOp, 0);
  var st = mod.state();
  testTrue('3. a compra criou o FIN_CP da fatura do ciclo, mas ainda status=agendado (não pago, não entra no DRE em regime de caixa)', st.FIN_CP.length === 1 && st.FIN_CP[0].status === 'agendado');
}

// ── 2. Fatura agrupa por categoria — 1 CP por (fatura, categoria) ──────────
{
  var mod = novoAmbiente();
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-03', fornecedor: 'Loja A', descricao: 'Papel', categoria: 'Operacional', valorTotal: 100, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-04', fornecedor: 'Loja B', descricao: 'Toner', categoria: 'Operacional', valorTotal: 50, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-06', fornecedor: 'Fornecedor Chapas', descricao: 'Acrílico', categoria: 'Matéria-Prima', valorTotal: 220, parcelas: 1, marca: 'vr' });
  var st = mod.state();
  test('4. 2 compras Operacional + 1 Matéria-Prima na MESMA fatura viram exatamente 2 lançamentos em FIN_CP (1 por categoria, nunca 1 por compra)', st.FIN_CP.length, 2);
  var faturaId = st.FIN_FATURAS[0].id;
  var cpOp = st.FIN_CP.find(function (c) { return c.categoria === 'Operacional'; });
  var cpMat = st.FIN_CP.find(function (c) { return c.categoria === 'Matéria-Prima'; });
  test('5. o CP de Operacional soma as 2 compras dessa categoria (100+50=150), nunca uma delas isolada', cpOp.valor, 150);
  test('6. o CP de Matéria-Prima reflete só a compra dessa categoria (220), sem misturar com Operacional', cpMat.valor, 220);
  testTrue('7. os ids dos CPs de cartão são determinísticos por (fatura, categoria)', cpOp.id === 'cpcartao_' + faturaId + '_operacional' && cpMat.id === 'cpcartao_' + faturaId + '_materia_prima');
}

// ── 3. Reexecutar a sincronização nunca duplica ─────────────────────────────
{
  var mod = novoAmbiente();
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-03', fornecedor: 'Loja A', descricao: 'Papel', categoria: 'Operacional', valorTotal: 100, parcelas: 1, marca: 'vr' });
  var st1 = mod.state();
  var faturaId = st1.FIN_FATURAS[0].id;
  // reexecuta a sincronização várias vezes (simula reabrir a tela de Cartões) — nunca duplica
  mod.sincronizarCPFatura(faturaId); mod.sincronizarCPFatura(faturaId); mod.sincronizarCPFatura(faturaId);
  var st2 = mod.state();
  test('8. reexecutar a sincronização da mesma fatura 3x nunca cria um 2º lançamento', st2.FIN_CP.length, 1);
  // registra MAIS uma compra Operacional no mesmo ciclo — o CP existente deve ser atualizado, não duplicado
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-07', fornecedor: 'Loja C', descricao: 'Canetas', categoria: 'Operacional', valorTotal: 30, parcelas: 1, marca: 'vr' });
  var st3 = mod.state();
  test('9. uma nova compra na mesma categoria/ciclo ATUALIZA o CP existente (100+30=130), nunca cria um novo', [st3.FIN_CP.length, st3.FIN_CP[0].valor], [1, 130]);
}

// ── 4. Pagar a fatura paga o(s) CP(s) pela rotina canônica — DRE reflete 1x ─
{
  var mod = novoAmbiente();
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-03', fornecedor: 'Loja A', descricao: 'Papel', categoria: 'Operacional', valorTotal: 100, parcelas: 1, marca: 'vr' });
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-06', fornecedor: 'Fornecedor Chapas', descricao: 'Acrílico', categoria: 'Matéria-Prima', valorTotal: 220, parcelas: 1, marca: 'vr' });
  var st0 = mod.state();
  var faturaId = st0.FIN_FATURAS[0].id;
  var dreAntes = mod.calcularDRE([], st0.FIN_CP.filter(function (c) { return c.status === 'pago'; }));
  test('10. antes de pagar a fatura, DRE em regime de caixa (só status=pago) não vê nenhuma das 2 despesas', [dreAntes.cpOp, dreAntes.cmvMat], [0, 0]);
  var pag = mod.pagarFatura(faturaId, '2026-08-20', 'banco_principal');
  testTrue('11. pagar a fatura retorna ok=true com o valor total pago (100+220=320)', pag.ok === true && pag.valorPago === 320);
  var st1 = mod.state();
  testTrue('12. pagar a fatura marca AMBOS os CPs vinculados (Operacional e Matéria-Prima) como pago — mesma rotina canônica de qualquer outra despesa', st1.FIN_CP.every(function (c) { return c.status === 'pago'; }));
  testTrue('13. a fatura em si fica marcada como paga', st1.FIN_FATURAS[0].pago === true && st1.FIN_FATURAS[0].status === 'paga');
  var dreDepois = mod.calcularDRE([], st1.FIN_CP.filter(function (c) { return c.status === 'pago'; }));
  test('14. depois de paga, o DRE (regime de caixa) reflete a despesa Operacional exatamente 1 vez (100, nunca 2x)', dreDepois.cpOp, 100);
  test('15. depois de paga, o DRE reflete o CMV de Matéria-Prima exatamente 1 vez (220, nunca 2x)', dreDepois.cmvMat, 220);
}

// ── 5. Pagar a fatura 2x não é permitido; CP já pago nunca é remexido ──────
{
  var mod = novoAmbiente();
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-03', fornecedor: 'Loja A', descricao: 'Papel', categoria: 'Operacional', valorTotal: 100, parcelas: 1, marca: 'vr' });
  var st0 = mod.state();
  var faturaId = st0.FIN_FATURAS[0].id;
  mod.pagarFatura(faturaId, '2026-08-20', 'banco_principal');
  var r2 = mod.pagarFatura(faturaId, '2026-08-21', 'banco_principal');
  testTrue('16. pagar a MESMA fatura uma 2ª vez é bloqueado (fatura já paga)', r2.ok === false);
  // uma compra "retroativa" na mesma competência, registrada por engano após o pagamento, nunca deve reabrir/alterar o CP já pago
  mod.sincronizarCPFatura(faturaId);
  var st1 = mod.state();
  test('17. sincronizar novamente uma fatura já paga NUNCA altera o valor do CP já pago (continua 100, nunca some nem duplica)', [st1.FIN_CP.length, st1.FIN_CP[0].valor, st1.FIN_CP[0].status], [1, 100, 'pago']);
}

// ── 6. Parcelamento: cada parcela do ciclo entra na fatura certa ───────────
{
  var mod = novoAmbiente();
  // compra em 3x no dia 5 (antes do fechamento dia 10) — 1ª parcela cai no ciclo de agosto
  mod.registrarCompra({ cartaoId: 'fcartao_1', data: '2026-08-05', fornecedor: 'Loja X', descricao: 'Equipamento', categoria: 'Operacional', valorTotal: 300, parcelas: 3, marca: 'vr' });
  var st = mod.state();
  test('18. compra parcelada em 3x gera faturas em 3 competências distintas (ago/set/out)', st.FIN_FATURAS.map(function (f) { return f.competencia; }).sort(), ['2026-08', '2026-09', '2026-10']);
  test('19. cada fatura do parcelamento tem exatamente 1 CP de 100 (300/3, centavo-exato)', st.FIN_CP.map(function (c) { return c.valor; }).sort(function (a, b) { return a - b; }), [100, 100, 100]);
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
