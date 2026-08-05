/**
 * test_financeiro.js
 * Testes automatizados para as fórmulas financeiras do ERP (DRE 8,5%, categorização
 * de despesas, agrupamento semanal por data real, ponto de equilíbrio, idempotência
 * de baixas e o gate de entrega com saldo pendente).
 *
 * Espelha (não importa) a lógica equivalente em index.html:
 *   finCalcularDRE, finDonutRender (bucket de categorias), finSemanaDoDia,
 *   finBarChartRender (ponto de equilíbrio), _finCRBaixaConfirmar/_finCPPagarConfirmar
 *   (guarda de idempotência), kbMarcarPronto/osLiberar (gate de saldo pendente).
 *
 * Uso: node scripts/test_financeiro.js
 * Retorna exit code 0 se todos passarem, 1 se houver falhas.
 */

'use strict';

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }

// ── Espelho: finNormCat / FIN_CAT_ALIAS ────────────────────────────────────────
var FIN_CAT_ALIAS = { 'Matéria-prima': 'Matéria-Prima', 'Pessoal': 'Pessoal Admin' };
function finNormCat(c) { return FIN_CAT_ALIAS[c] || c; }

// ── Espelho: finCalcularDRE (index.html) ───────────────────────────────────────
var FIN_TAXA_IMPOSTO_DRE = 0.085;
function finCalcularDRE(txFiltro, cpFiltro) {
  var receitaBruta = txFiltro.reduce(function (s, t) { return s + t.valor; }, 0);
  var impostos = receitaBruta * FIN_TAXA_IMPOSTO_DRE;
  var receitaLiq = receitaBruta - impostos;
  var cpNorm = cpFiltro.map(function (c) { return Object.assign({}, c, { _cat: finNormCat(c.categoria) }); });
  var cmvMat = cpNorm.filter(function (c) { return c._cat === 'Matéria-Prima'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var cmvMod = cpNorm.filter(function (c) { return c._cat === 'Mão de Obra Direta'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var cmv = cmvMat + cmvMod;
  var lucroBruto = receitaLiq - cmv;
  var cpPessoal = cpNorm.filter(function (c) { return c._cat === 'Pessoal Admin'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var cpOp = cpNorm.filter(function (c) { return c._cat === 'Operacional'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var cpEmp = cpNorm.filter(function (c) { return c._cat === 'Empréstimos'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var cpImp = cpNorm.filter(function (c) { return c._cat === 'Impostos'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var desp = cpPessoal + cpOp + cpEmp + cpImp;
  var lucroLiq = lucroBruto - desp;
  return { receitaBruta: receitaBruta, impostos: impostos, receitaLiq: receitaLiq, cmv: cmv, lucroBruto: lucroBruto, desp: desp, lucroLiq: lucroLiq };
}

// ── Espelho: bucket de categorias do donut (finDonutRender corrigido) ──────────
function donutBucket(categoria) {
  var CANON = ['Pessoal Admin', 'Operacional', 'Matéria-Prima', 'Mão de Obra Direta', 'Impostos', 'Empréstimos'];
  if (!categoria) return 'Sem categoria';
  var cat = finNormCat(categoria);
  return CANON.indexOf(cat) >= 0 ? cat : 'Outros';
}

// ── Espelho: finSemanaDoDia ─────────────────────────────────────────────────────
function finSemanaDoDia(dataStr) {
  var d = parseInt((dataStr || '').split('/')[0], 10);
  if (!d || d < 1) return 3;
  if (d <= 7) return 0; if (d <= 14) return 1; if (d <= 21) return 2; return 3;
}

// ── Espelho: ponto de equilíbrio real (finBarChartRender) ──────────────────────
function pontoEquilibrio(dre) {
  var margem = dre.receitaBruta > 0 ? (dre.lucroBruto / dre.receitaBruta) : 0;
  var valido = dre.receitaBruta > 0 && margem > 0;
  return { valido: valido, receita: valido ? (dre.desp / margem) : null };
}

// ── Espelho: guarda de idempotência de baixa (CR/CP) ────────────────────────────
function confirmarBaixaCR(registro) {
  if (registro.status === 'recebido') return { alterou: false, motivo: 'já confirmado' };
  registro.status = 'recebido';
  return { alterou: true };
}

// ── Espelho: gate de entrega com saldo pendente (osLiberar) ────────────────────
function tentarEntregar(os, justificativa) {
  var saldoPendente = (os.restante || 0) > 0;
  if (saldoPendente) {
    if (!justificativa || !justificativa.trim()) return { entregue: false, motivo: 'saldo pendente sem justificativa' };
    return { entregue: true, excecao: true, restanteMantido: os.restante };
  }
  return { entregue: true, excecao: false };
}

// ── Espelho: kbMarcarPronto não bloqueia mais por saldo pendente ───────────────
function marcarPronto(os) {
  if (os.status === 'pronta' || os.status === 'master' || os.status === 'entregue') return { status: os.status, alterou: false };
  var saldoPendente = (os.restante || 0) > 0;
  return { status: 'pronta', alterou: true, saldoPendente: saldoPendente };
}

console.log('\n' + '='.repeat(64));
console.log(' test_financeiro.js');
console.log('='.repeat(64) + '\n');

console.log('── DRE — imposto 8,5% ──────────────────────────────────────\n');

// 1. Venda integral, sem custos: imposto = 8,5% da receita bruta
{
  var dre = finCalcularDRE([{ valor: 1000 }], []);
  test('1. venda integral R$1000 -> impostos R$85,00', approx(dre.impostos, 85), true);
  test('1b. receita líquida R$915,00', approx(dre.receitaLiq, 915), true);
}

// 2. Pagamento 50/50: duas transações somando o mesmo total da venda integral
{
  var dreParcial = finCalcularDRE([{ valor: 500 }, { valor: 500 }], []);
  var dreIntegral = finCalcularDRE([{ valor: 1000 }], []);
  test('2. 50/50 (duas tx de 500) = mesmo imposto que venda integral de 1000', approx(dreParcial.impostos, dreIntegral.impostos), true);
}

// 3. Cancelamento/estorno: transação não confirmada (status != recebido) não deve
//    ser incluída no array filtrado — o filtro é responsabilidade de quem monta
//    txFiltro (index.html já filtra status==='recebido' antes de chamar finCalcularDRE).
{
  var todas = [{ valor: 1000, status: 'recebido' }, { valor: 300, status: 'estornado' }];
  var filtradas = todas.filter(function (t) { return t.status === 'recebido'; });
  var dre = finCalcularDRE(filtradas, []);
  test('3. estorno excluído do filtro -> receita bruta ignora o valor estornado', dre.receitaBruta, 1000);
}

// 4. Venda sem nota fiscal ainda entra no DRE (regra gerencial: 100% das vendas)
{
  var dre = finCalcularDRE([{ valor: 1000, nfSolicitada: false }], []);
  test('4. venda sem NF ainda gera imposto gerencial de 8,5%', approx(dre.impostos, 85), true);
}

// 5. Impostos automáticos (sobre receita) não se somam às "Impostos e Tributos"
//    operacionais (FIN_CP categoria Impostos) — são grandezas independentes.
{
  var dre = finCalcularDRE([{ valor: 1000 }], [{ categoria: 'Impostos', valor: 50 }]);
  test('5. imposto automático (85) e imposto operacional manual (50) não se somam', approx(dre.impostos, 85) && approx(dre.desp, 50), true);
}

// 6. CMV e despesas seguem categorizados corretamente (regressão do cálculo em si)
{
  var dre = finCalcularDRE(
    [{ valor: 2000 }],
    [{ categoria: 'Matéria-Prima', valor: 300 }, { categoria: 'Mão de Obra Direta', valor: 100 }, { categoria: 'Operacional', valor: 150 }]
  );
  var impostos = 2000 * 0.085, receitaLiq = 2000 - impostos, cmv = 400, lucroBruto = receitaLiq - cmv, lucroLiq = lucroBruto - 150;
  test('6. lucro líquido bate com cálculo manual', approx(dre.lucroLiq, lucroLiq), true);
}

console.log('\n── Categorização de despesas (gráfico de categorias) ───────\n');
test('7. "Matéria-Prima" (canônico) cai no bucket correto', donutBucket('Matéria-Prima'), 'Matéria-Prima');
test('8. "Matéria-prima" (legado, p minúsculo) normaliza para o bucket correto', donutBucket('Matéria-prima'), 'Matéria-Prima');
test('9. "Pessoal Admin" cai no bucket correto', donutBucket('Pessoal Admin'), 'Pessoal Admin');
test('10. "Pessoal" (legado) normaliza para o bucket correto', donutBucket('Pessoal'), 'Pessoal Admin');
test('11. categoria ausente -> "Sem categoria" (não fica oculta)', donutBucket(undefined), 'Sem categoria');
test('12. categoria desconhecida -> "Outros"', donutBucket('Xyz Aleatório'), 'Outros');
test('13. "Mão de Obra Direta" tem bucket próprio (antes caía em Outros)', donutBucket('Mão de Obra Direta'), 'Mão de Obra Direta');

console.log('\n── Agrupamento semanal por data real ────────────────────────\n');
test('14. dia 1 -> semana 1 (índice 0)', finSemanaDoDia('01/08'), 0);
test('15. dia 7 -> semana 1 (índice 0)', finSemanaDoDia('07/08/2026'), 0);
test('16. dia 8 -> semana 2 (índice 1)', finSemanaDoDia('08/08'), 1);
test('17. dia 15 -> semana 3 (índice 2)', finSemanaDoDia('15/08'), 2);
test('18. dia 22 -> semana 4 (índice 3)', finSemanaDoDia('22/08'), 3);
test('19. dia 31 -> semana 4 (índice 3)', finSemanaDoDia('31/08'), 3);
test('20. data vazia/inválida -> semana 4 (não desaparece do gráfico)', finSemanaDoDia(''), 3);

console.log('\n── Ponto de equilíbrio real ─────────────────────────────────\n');
{
  var dreOk = finCalcularDRE([{ valor: 10000 }], [{ categoria: 'Matéria-Prima', valor: 2000 }, { categoria: 'Operacional', valor: 3000 }]);
  var pe = pontoEquilibrio(dreOk);
  test('21. com receita e margem positiva -> ponto de equilíbrio calculável', pe.valido, true);

  var dreVazio = finCalcularDRE([], []);
  var peVazio = pontoEquilibrio(dreVazio);
  test('22. sem receita no mês -> "dados insuficientes" (não divide por zero)', peVazio.valido, false);

  var dreNeg = finCalcularDRE([{ valor: 100 }], [{ categoria: 'Matéria-Prima', valor: 500 }]);
  var peNeg = pontoEquilibrio(dreNeg);
  test('23. margem de contribuição negativa -> "dados insuficientes"', peNeg.valido, false);
}

console.log('\n── Idempotência de baixas (CR/CP) ───────────────────────────\n');
{
  var cr = { status: 'pendente' };
  var r1 = confirmarBaixaCR(cr);
  var r2 = confirmarBaixaCR(cr);
  test('24. primeira confirmação altera o registro', r1.alterou, true);
  test('25. segunda confirmação (duplo clique) NÃO altera de novo', r2.alterou, false);
}

console.log('\n── OS "Pronta" não bloqueia mais por saldo pendente ─────────\n');
{
  var os1 = { status: 'aguardando_saldo', restante: 500 };
  var r = marcarPronto(os1);
  test('26. OS com saldo pendente pode ser marcada Pronta (antes bloqueava)', r.status, 'pronta');
  test('27. ...mas o alerta de saldo pendente é sinalizado', r.saldoPendente, true);

  var os2 = { status: 'iniciada', restante: 0 };
  var r2b = marcarPronto(os2);
  test('28. OS sem saldo pendente vira Pronta sem alerta', r2b.saldoPendente, false);
}

console.log('\n── Entrega final bloqueada por saldo, exceto com justificativa ─\n');
{
  var osComSaldo = { num: 99, restante: 300 };
  test('29. entrega sem justificativa é bloqueada', tentarEntregar(osComSaldo, '').entregue, false);
  test('30. entrega com justificativa é permitida como exceção', tentarEntregar(osComSaldo, 'cliente pagará por boleto em 5 dias').entregue, true);
  test('31. exceção mantém a dívida em aberto (restante não é zerado)', tentarEntregar(osComSaldo, 'ok').restanteMantido, 300);

  var osSemSaldo = { num: 100, restante: 0 };
  test('32. entrega sem saldo pendente não exige justificativa', tentarEntregar(osSemSaldo, '').entregue, true);
}

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
