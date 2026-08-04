/**
 * test_compras.js
 * Testes automatizados para a lógica pura do módulo de Compras (index.html):
 * transição de status, cancelamento com justificativa, recebimento
 * parcial/total, idempotência da conta a pagar e baixa de estoque por delta.
 *
 * Espelha (não importa) a lógica equivalente em index.html: comprasAvancarStatus,
 * comprasCancelar, comprasReceberModal.
 *
 * Uso: node scripts/test_compras.js
 */

'use strict';

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}

var PC_FLUXO = ['solicitada', 'cotacao', 'aprovada', 'pedida', 'recebida_parcial', 'recebida'];

function novaCompra(itens) {
  return { id: 'pcx', numero: 1, status: 'solicitada', itens: itens, finCpId: null, cancelJustificativa: null, historico: [] };
}

// Espelho: comprasAvancarStatus (sem prompts — fornecedor já preenchido)
function avancar(pc, fornecedorSePedida) {
  if (pc.status === 'cancelada' || pc.status === 'recebida') return { ok: false, motivo: 'estado final' };
  var idx = PC_FLUXO.indexOf(pc.status);
  var proximo = PC_FLUXO[idx + 1];
  if (proximo === 'pedida' && !fornecedorSePedida) return { ok: false, motivo: 'fornecedor obrigatório' };
  pc.status = proximo;
  return { ok: true };
}

// Espelho: comprasCancelar
function cancelar(pc, justificativa) {
  if (pc.status === 'recebida') return { ok: false, motivo: 'já recebido' };
  if (!justificativa || !justificativa.trim()) return { ok: false, motivo: 'sem justificativa' };
  pc.status = 'cancelada';
  pc.cancelJustificativa = justificativa.trim();
  return { ok: true };
}

// Espelho: comprasReceberModal (recebimento de UM item, quantidade informada)
function receber(pc, itemIdx, qtdRecebidaAgora, stock) {
  var item = pc.itens[itemIdx];
  var restante = item.qtyNecessaria - item.qtyRecebida;
  var qtd = Math.min(qtdRecebidaAgora, restante);
  if (qtd <= 0) return { ok: false };
  item.qtyRecebida += qtd;
  if (item.material && stock[item.material]) stock[item.material].qty += qtd;
  var tudo = pc.itens.every(function (i) { return i.qtyRecebida >= i.qtyNecessaria; });
  pc.status = tudo ? 'recebida' : 'recebida_parcial';
  if (!pc.finCpId) {
    var valorTotal = pc.itens.reduce(function (s, i) { return s + i.qtyNecessaria * i.precoUnit; }, 0);
    if (valorTotal > 0) pc.finCpId = 'cp_compra_' + pc.id;
  }
  return { ok: true };
}

console.log('\n' + '='.repeat(64));
console.log(' test_compras.js');
console.log('='.repeat(64) + '\n');

console.log('── Fluxo de status ──────────────────────────────────────────\n');
{
  var pc = novaCompra([{ material: null, label: 'ACM 3mm', qtyNecessaria: 5, qtyRecebida: 0, unidade: 'chapa', precoUnit: 100 }]);
  test('1. estado inicial é "solicitada"', pc.status, 'solicitada');
  test('2. avançar sem fornecedor até "pedida" falha', (function () {
    avancar(pc); avancar(pc); // solicitada->cotacao->aprovada
    return avancar(pc).ok; // aprovada->pedida sem fornecedor
  })(), false);
  test('3. avançar para "pedida" com fornecedor funciona', avancar(pc, 'Fornecedor X').ok, true);
  test('4. status agora é "pedida"', pc.status, 'pedida');
}

console.log('\n── Cancelamento exige justificativa ─────────────────────────\n');
{
  var pc = novaCompra([{ material: null, label: 'X', qtyNecessaria: 1, qtyRecebida: 0, unidade: 'un', precoUnit: 10 }]);
  test('5. cancelar sem justificativa falha', cancelar(pc, '').ok, false);
  test('6. cancelar com justificativa funciona', cancelar(pc, 'fornecedor sumiu').ok, true);
  test('7. status vira "cancelada"', pc.status, 'cancelada');

  var pcRecebida = novaCompra([{ material: null, label: 'Y', qtyNecessaria: 1, qtyRecebida: 1, unidade: 'un', precoUnit: 10 }]);
  pcRecebida.status = 'recebida';
  test('8. pedido já recebido não pode ser cancelado', cancelar(pcRecebida, 'motivo qualquer').ok, false);
}

console.log('\n── Recebimento parcial/total e estoque por delta ────────────\n');
{
  var stock = { chapaAcm: { qty: 2 } };
  var pc = novaCompra([{ material: 'chapaAcm', label: 'ACM 3mm', qtyNecessaria: 10, qtyRecebida: 0, unidade: 'chapa', precoUnit: 100 }]);
  receber(pc, 0, 4, stock);
  test('9. recebimento parcial (4 de 10) -> status recebida_parcial', pc.status, 'recebida_parcial');
  test('10. estoque recebeu só o delta (2+4=6)', stock.chapaAcm.qty, 6);
  test('11. conta a pagar criada no primeiro recebimento (mesmo parcial)', !!pc.finCpId, true);
  var finCpIdOriginal = pc.finCpId;

  receber(pc, 0, 6, stock); // completa os 10
  test('12. segundo recebimento completa -> status recebida', pc.status, 'recebida');
  test('13. estoque recebeu só o delta restante (6+6=12)', stock.chapaAcm.qty, 12);
  test('14. finCpId NÃO muda no segundo recebimento (idempotente)', pc.finCpId, finCpIdOriginal);

  receber(pc, 0, 5, stock); // já está tudo recebido, não deveria fazer nada
  test('15. receber depois de completo não altera estoque de novo', stock.chapaAcm.qty, 12);
}

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
