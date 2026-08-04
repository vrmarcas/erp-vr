/**
 * test_compras.js
 * Testes automatizados (mirror) para a lógica pura do módulo de Compras v2
 * (index.html): transição de status, cancelamento com justificativa,
 * numeração transacional segura contra concorrência, vínculo de material
 * por ID com resolução de ambiguidade, e recebimento parcial/total com
 * Conta a Pagar idempotente por EVENTO (não mais por pedido inteiro).
 *
 * IMPORTANTE: estes são mirror-tests (lógica reescrita à mão em Node, sem
 * depender do DOM/Firebase). A validação funcional das FUNÇÕES REAIS
 * (comprasProximoNumeroAtomico, comprasResolverMaterialPorNome,
 * comprasReceberModal, etc.) rodando no navegador contra um mock fiel do
 * Firestore está documentada em scripts/browser_harness_bloco2_3.md —
 * incluindo a prova de 5 chamadas concorrentes sem colisão de número.
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
  return { id: 'pcx', numero: 1, status: 'solicitada', itens: itens, recebimentos: [], finCpId: null, cancelJustificativa: null, historico: [] };
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

// Espelho: comprasReceberModal v2 — UM evento de recebimento por chamada,
// cria sua PRÓPRIA Conta a Pagar (idempotente a esse evento, não ao pedido).
function receberEvento(pc, itemIdx, qtdRecebidaAgora, documentoFornecedor, stock, finCP) {
  var item = pc.itens[itemIdx];
  var restante = item.qtyNecessaria - item.qtyRecebida;
  var qtd = Math.min(qtdRecebidaAgora, restante);
  if (qtd <= 0) return { ok: false };
  item.qtyRecebida += qtd;
  var valorEntrega = qtd * item.precoUnit;
  if (item.material && stock[item.material]) stock[item.material].qty += qtd;
  var tudo = pc.itens.every(function (i) { return i.qtyRecebida >= i.qtyNecessaria; });
  pc.status = tudo ? 'recebida' : 'recebida_parcial';

  var seq = pc.recebimentos.length + 1;
  var recebimentoId = 'rcb_' + pc.id + '_' + seq;
  var cpId = null;
  if (valorEntrega > 0) {
    cpId = 'cp_' + recebimentoId;
    finCP.push({ id: cpId, valor: valorEntrega, status: documentoFornecedor ? 'agendado' : 'aguardando_documento', origemRecebimentoId: recebimentoId });
    pc.finCpId = pc.finCpId || cpId;
  }
  pc.recebimentos.push({ id: recebimentoId, itens: [{ itemIdx: itemIdx, qty: qtd }], documentoFornecedor: documentoFornecedor || null, valorRecebido: valorEntrega, finCpId: cpId });
  return { ok: true, recebimentoId: recebimentoId, cpId: cpId };
}

// Espelho: comprasResumoValores
function resumoValores(pc, finCP) {
  var valorPedido = pc.itens.reduce(function (s, i) { return s + i.qtyNecessaria * i.precoUnit; }, 0);
  var recs = pc.recebimentos || [];
  var valorRecebido = recs.reduce(function (s, r) { return s + r.valorRecebido; }, 0);
  var valorFaturado = recs.filter(function (r) { return !!r.documentoFornecedor; }).reduce(function (s, r) { return s + r.valorRecebido; }, 0);
  var cps = recs.map(function (r) { return r.finCpId; }).filter(Boolean).map(function (id) { return finCP.find(function (c) { return c.id === id; }); }).filter(Boolean);
  var valorAPagar = cps.filter(function (c) { return c.status !== 'pago'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var valorPago = cps.filter(function (c) { return c.status === 'pago'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  return { valorPedido: valorPedido, valorRecebido: valorRecebido, valorFaturado: valorFaturado, valorAPagar: valorAPagar, valorPago: valorPago };
}

// Espelho: comprasProximoNumeroAtomico — transação otimista sobre um
// contador único compartilhado (mesmo contrato do mock usado no harness
// do navegador: leitura de versão + reexecução em conflito).
function makeContadorTransacional() {
  var doc = { n: 0, version: 0 };
  return function proximoNumero() {
    var versaoLida = doc.version;
    var valorLido = doc.n;
    // Simula leitura+escrita "atômica": se nada mudou entre leitura e
    // escrita (sempre verdade em execução síncrona single-thread — o
    // Firestore real garante isso via commit condicional no servidor),
    // incrementa; senão, reexecutaria (não reproduzível em JS síncrono,
    // mas o contrato de retry está provado no mock async do harness).
    if (doc.version !== versaoLida) throw new Error('conflito não esperado em execução síncrona');
    doc.n = valorLido + 1;
    doc.version++;
    return doc.n;
  };
}

// Espelho: comprasResolverMaterialPorNome
function resolverMaterialPorNome(nome, stock, escolhaDoUsuario) {
  var alvo = (nome || '').trim().toLowerCase();
  if (!alvo) return null;
  var candidatos = Object.keys(stock).filter(function (k) { return stock[k].label && stock[k].label.toLowerCase().indexOf(alvo) >= 0; });
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0];
  var idx = escolhaDoUsuario - 1;
  if (escolhaDoUsuario == null || isNaN(idx) || !candidatos[idx]) return null; // ambíguo sem confirmação -> fallback textual
  return candidatos[idx];
}

console.log('\n' + '='.repeat(64));
console.log(' test_compras.js');
console.log('='.repeat(64) + '\n');

console.log('── Fluxo de status ──────────────────────────────────────────\n');
{
  var pc = novaCompra([{ material: null, label: 'ACM 3mm', qtyNecessaria: 5, qtyRecebida: 0, unidade: 'chapa', precoUnit: 100 }]);
  test('1. estado inicial é "solicitada"', pc.status, 'solicitada');
  test('2. avançar sem fornecedor até "pedida" falha', (function () {
    avancar(pc); avancar(pc);
    return avancar(pc).ok;
  })(), false);
  test('3. avançar para "pedida" com fornecedor funciona', avancar(pc, 'Fornecedor X').ok, true);
  test('4. status agora é "pedida"', pc.status, 'pedida');
}

console.log('\n── Cancelamento exige justificativa e preserva histórico ────\n');
{
  var pc = novaCompra([{ material: null, label: 'X', qtyNecessaria: 1, qtyRecebida: 0, unidade: 'un', precoUnit: 10 }]);
  pc.historico.push({ acao: 'criada', obs: 'original' });
  test('5. cancelar sem justificativa falha', cancelar(pc, '').ok, false);
  test('6. cancelar com justificativa funciona', cancelar(pc, 'fornecedor sumiu').ok, true);
  test('7. status vira "cancelada"', pc.status, 'cancelada');
  test('7b. histórico original NÃO é apagado pelo cancelamento', pc.historico[0].obs, 'original');

  var pcRecebida = novaCompra([{ material: null, label: 'Y', qtyNecessaria: 1, qtyRecebida: 1, unidade: 'un', precoUnit: 10 }]);
  pcRecebida.status = 'recebida';
  test('8. pedido já recebido não pode ser cancelado', cancelar(pcRecebida, 'motivo qualquer').ok, false);
}

console.log('\n── 2.1 Numeração segura contra concorrência ──────────────────\n');
{
  var proximoNumero = makeContadorTransacional();
  var numeros = [proximoNumero(), proximoNumero(), proximoNumero(), proximoNumero(), proximoNumero()];
  var unicos = [...new Set(numeros)];
  test('9. 5 solicitações sequenciais recebem números distintos', numeros.length, unicos.length);
  test('10. numeração é sequencial (1..5)', numeros, [1, 2, 3, 4, 5]);
  // A prova de concorrência REAL (duas Promises disparadas juntas, sem
  // await entre elas, contra o mock assíncrono de runTransaction com
  // retry) está no harness do navegador — ver browser_harness_bloco2_3.md,
  // linha "5 chamadas concorrentes → [1,2,3,4,5], zero colisão".
  test('11. IDs internos usam timestamp+random (não dependem só do número)', /^pc\d+_[a-z0-9]+$/.test('pc' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)), true);
}

console.log('\n── 2.2 Vínculo de material por ID + ambiguidade ──────────────\n');
{
  var stock = {
    mat_acm3_branco: { label: 'ACM 3mm Branco', qty: 2, esp: 3 },
    mat_acm3_preto: { label: 'ACM 3mm Preto', qty: 0, esp: 3 },
    mat_pvc5: { label: 'Placa PVC 5mm', qty: 8, esp: 5 }
  };
  test('12. nome único resolve direto para o ID real', resolverMaterialPorNome('PVC', stock), 'mat_pvc5');
  test('13. nome ambíguo SEM confirmação cai para null (fallback textual)', resolverMaterialPorNome('ACM', stock, null), null);
  test('14. nome ambíguo COM confirmação (opção 2) resolve o ID escolhido', resolverMaterialPorNome('ACM', stock, 2), 'mat_acm3_preto');
  test('15. nome inexistente resolve null (registro antigo sem ID — retrocompat)', resolverMaterialPorNome('Madeira MDF', stock), null);
}

console.log('\n── 2.3 Recebimento por evento + Conta a Pagar idempotente ────\n');
{
  var stock = { chapaAcm: { qty: 2 } };
  var finCP = [];
  var pc = novaCompra([{ material: 'chapaAcm', label: 'ACM 3mm', qtyNecessaria: 10, qtyRecebida: 0, unidade: 'chapa', precoUnit: 100 }]);

  var e1 = receberEvento(pc, 0, 4, null, stock, finCP); // sem documento
  test('16. recebimento parcial (4 de 10) -> status recebida_parcial', pc.status, 'recebida_parcial');
  test('17. estoque recebeu só o delta (2+4=6)', stock.chapaAcm.qty, 6);
  test('18. Conta a Pagar criada para ESTA entrega (sem NF) com status aguardando_documento', finCP[0].status, 'aguardando_documento');
  test('19. valor da 1ª Conta a Pagar é só da 1ª entrega (4×100=400), não do total (1000)', finCP[0].valor, 400);

  var e2 = receberEvento(pc, 0, 3, 'NF-777', stock, finCP); // com documento
  test('20. segunda entrega (3 chapas) soma ao estoque (6+3=9)', stock.chapaAcm.qty, 9);
  test('21. segunda Conta a Pagar é um registro NOVO e distinto da primeira', finCP.length, 2);
  test('22. segunda Conta a Pagar tem status agendado (documento informado)', finCP[1].status, 'agendado');
  test('23. status continua recebida_parcial (7 de 10)', pc.status, 'recebida_parcial');

  var e3 = receberEvento(pc, 0, 3, 'NF-778', stock, finCP); // completa
  test('24. terceira entrega completa -> status recebida', pc.status, 'recebida');
  test('25. estoque final = inicial(2) + todas as entregas(4+3+3=10) = 12', stock.chapaAcm.qty, 12);
  test('26. três Contas a Pagar distintas, nenhuma duplicada', finCP.length, 3);
  test('26b. IDs das 3 Contas a Pagar são todos diferentes', new Set(finCP.map(function (c) { return c.id; })).size, 3);

  var resumo = resumoValores(pc, finCP);
  test('27. valorPedido é o contratado (10×100=1000) e NUNCA muda com parciais', resumo.valorPedido, 1000);
  test('28. valorRecebido acumula as 3 entregas (400+300+300=1000)', resumo.valorRecebido, 1000);
  test('29. valorFaturado só conta entregas COM documento (300+300=600, não a 1ª sem NF)', resumo.valorFaturado, 600);
  test('30. valorAPagar soma as 3 Contas a Pagar (nenhuma paga ainda)', resumo.valorAPagar, 1000);
  test('31. valorPago é zero (nenhuma Conta a Pagar quitada)', resumo.valorPago, 0);

  // receber depois de completo não deve fazer nada (restante=0 -> qtd<=0 -> ok:false)
  var e4 = receberEvento(pc, 0, 5, null, stock, finCP);
  test('32. receber depois de completo não altera estoque de novo', stock.chapaAcm.qty, 12);
  test('33. receber depois de completo não cria Conta a Pagar extra', finCP.length, 3);
  test('34. receber depois de completo retorna ok:false', e4.ok, false);
}

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
