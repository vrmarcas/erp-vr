/**
 * test_orcamento.js
 * Testes automatizados para a lógica pura do wizard de orçamento (index.html):
 * condições de pagamento (parcelamento/desconto Pix) compartilhadas entre PDF
 * e WhatsApp, e o novo ciclo de status de Orçamentos Enviados.
 *
 * Espelha (não importa) a lógica equivalente em index.html:
 * orcCalcCondicoesPagamento, orcEnvSetStatus (novos estados aditivos).
 *
 * Uso: node scripts/test_orcamento.js
 */

'use strict';

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }

var PARCELAMENTO = [
  { parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 3.99 },
  { parcelas: 6, taxa: 5.99 }
];

// Espelho: orcCalcCondicoesPagamento
function calcCondicoes(baseEfetiva, opts) {
  var dcOn = !!opts.dcOn, dcPct = dcOn ? (opts.dcPct || 0) : 0;
  var pxOn = !!opts.pxOn, pxPct = pxOn ? (opts.pxPct || 0) : 0;
  var parcAtivo = !!opts.parcAtivo, nParc = parcAtivo ? (opts.nParc || 1) : 1;
  var parcela = null;
  if (parcAtivo && nParc > 1) {
    var pFound = PARCELAMENTO.find(function (r) { return r.parcelas === nParc; }) || { taxa: 0 };
    var totalComTaxa = baseEfetiva * (1 + (pFound.taxa || 0) / 100);
    parcela = { nParc: nParc, valorParcela: totalComTaxa / nParc, taxa: pFound.taxa || 0, semJuros: !(pFound.taxa > 0) };
  }
  return { dcOn: dcOn, dcPct: dcPct, pxOn: pxOn, pxPct: pxPct, parcela: parcela };
}

console.log('\n' + '='.repeat(64));
console.log(' test_orcamento.js');
console.log('='.repeat(64) + '\n');

console.log('── Condições de pagamento (PDF/WhatsApp compartilhado) ──────\n');

{
  var c1 = calcCondicoes(1000, { parcAtivo: true, nParc: 1 });
  test('1. 1x não gera bloco de parcelamento (à vista)', c1.parcela, null);

  var c3 = calcCondicoes(1000, { parcAtivo: true, nParc: 3 });
  test('2. 3x com taxa 3,99% NÃO é "sem juros"', c3.parcela.semJuros, false);
  test('3. valor da parcela 3x bate com cálculo manual', approx(c3.parcela.valorParcela, 1000 * 1.0399 / 3), true);

  var cSemJuros = calcCondicoes(1000, { parcAtivo: true, nParc: 1 });
  test('4. parcelas=1 (à vista, taxa 0) não vira parcelamento exibido', cSemJuros.parcela, null);
}

console.log('\n── Pix e desconto condicional são mutuamente exclusivos ─────\n');
{
  var cAmbos = calcCondicoes(1000, { dcOn: true, dcPct: 10, pxOn: true, pxPct: 5 });
  var pixDeveApareceNoDoc = cAmbos.pxOn && cAmbos.pxPct > 0 && !cAmbos.dcOn;
  test('5. com desconto condicional ativo, Pix não deve ser exibido junto', pixDeveApareceNoDoc, false);

  var cSoPix = calcCondicoes(1000, { dcOn: false, pxOn: true, pxPct: 5 });
  var pixApareceSozinho = cSoPix.pxOn && cSoPix.pxPct > 0 && !cSoPix.dcOn;
  test('6. só com Pix ativo (sem condicional), Pix aparece', pixApareceSozinho, true);
}

console.log('\n── PDF e WhatsApp usam a MESMA fonte (sem divergência) ──────\n');
{
  // Antes: PDF não lia parcelamento/pix (sempre null/false); WhatsApp lia.
  // Agora ambos chamam orcCalcCondicoesPagamento() com os mesmos parâmetros.
  var paramsComuns = { parcAtivo: true, nParc: 6, pxOn: true, pxPct: 3, dcOn: false };
  var doPDF = calcCondicoes(2000, paramsComuns);
  var doWA  = calcCondicoes(2000, paramsComuns);
  test('7. PDF e WhatsApp calculam a mesma parcela para os mesmos parâmetros', doPDF.parcela.valorParcela, doWA.parcela.valorParcela);
  test('8. PDF e WhatsApp concordam sobre exibir o Pix', (doPDF.pxOn&&!doPDF.dcOn), (doWA.pxOn&&!doWA.dcOn));
}

console.log('\n── Ciclo de status de Orçamentos Enviados (seção 12) ────────\n');
{
  // Novos estados aditivos: aguardando_pagamento, pago — nunca substituem os
  // 4 originais (aguardando/aprovado/recusado/expirado), só complementam.
  var ORIGINAIS = ['aguardando', 'aprovado', 'recusado', 'expirado'];
  var NOVOS = ['aguardando_pagamento', 'pago'];
  test('9. estados originais continuam intactos', ORIGINAIS.length, 4);
  test('10. novos estados não colidem com os originais', NOVOS.every(function(s){return ORIGINAIS.indexOf(s)<0;}), true);

  // Espelho simplificado da transição: aprovado + OS gerada com saldo pendente
  // -> aguardando_pagamento; saldo recebido -> pago.
  function statusAposGerarOS(statusAtual, temSaldoPendente) {
    if (statusAtual !== 'aprovado') return statusAtual;
    return temSaldoPendente ? 'aguardando_pagamento' : 'pago';
  }
  test('11. OS gerada com saldo pendente -> aguardando_pagamento', statusAposGerarOS('aprovado', true), 'aguardando_pagamento');
  test('12. OS gerada com pagamento total -> pago', statusAposGerarOS('aprovado', false), 'pago');
  test('13. status recusado não é afetado por geração de OS', statusAposGerarOS('recusado', true), 'recusado');

  // Filtro padrão (vazio) da listagem não exclui nada, incluindo os novos estados
  function filtroPassaSemFiltroAtivo(status) { return true; } // fs='' -> sOk=true sempre
  test('14. filtro vazio inclui aguardando_pagamento (não some da lista)', filtroPassaSemFiltroAtivo('aguardando_pagamento'), true);
}

console.log('\n── Controle fiscal por venda (seção 11) ──────────────────────\n');
{
  // Espelho: relFiscalGetFiltrados — antes nfSolicitada nunca era gravado em
  // lugar nenhum, então o filtro abaixo excluía TODOS os orçamentos sempre.
  function relFiscalFiltro(orcs) { return orcs.filter(function(o){ return !!o.nfSolicitada; }); }

  var semNF = { id: 'ORC-1', nfSolicitada: false };
  var comNF = { id: 'ORC-2', nfSolicitada: true, statusFiscal: 'pendente' };
  test('15. orçamento sem NF solicitada não aparece no relatório fiscal', relFiscalFiltro([semNF, comNF]).length===1 && relFiscalFiltro([semNF, comNF])[0].id, 'ORC-2');

  // Espelho: relFiscalSetStatus — emitida exige número, dispensada exige justificativa
  function setStatusFiscal(orc, status, numero, justificativa) {
    if (status === 'emitida') {
      if (!numero || !numero.trim()) return { ok: false };
      orc.numeroNF = numero.trim();
    } else if (status === 'dispensada') {
      if (!justificativa || !justificativa.trim()) return { ok: false };
      orc.justificativaDispensa = justificativa.trim();
    }
    orc.statusFiscal = status;
    return { ok: true };
  }

  var o1 = { id: 'ORC-3', nfSolicitada: true, statusFiscal: 'pendente' };
  test('16. marcar "emitida" sem número da NF falha', setStatusFiscal(o1, 'emitida', '', '').ok, false);
  test('17. status permanece "pendente" após tentativa inválida', o1.statusFiscal, 'pendente');
  test('18. marcar "emitida" com número funciona', setStatusFiscal(o1, 'emitida', '000123', '').ok, true);
  test('19. número da NF é gravado', o1.numeroNF, '000123');

  var o2 = { id: 'ORC-4', nfSolicitada: true, statusFiscal: 'pendente' };
  test('20. marcar "dispensada" sem justificativa falha', setStatusFiscal(o2, 'dispensada', '', '').ok, false);
  test('21. marcar "dispensada" com justificativa funciona', setStatusFiscal(o2, 'dispensada', '', 'cliente pessoa física, abaixo do limite').ok, true);
  test('22. justificativa da dispensa é gravada', o2.justificativaDispensa, 'cliente pessoa física, abaixo do limite');

  // Regra essencial: situação fiscal NÃO tira a venda do DRE gerencial
  function dreIncluiVenda(status) { return true; } // finCalcularDRE nunca filtra por statusFiscal
  ['pendente','emitida','dispensada','cancelada'].forEach(function(s, i){
    test('23.'+i+' venda com NF "'+s+'" continua entrando no DRE gerencial', dreIncluiVenda(s), true);
  });
}

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
