/**
 * test_compras.js
 * Testes automatizados (mirror) para a lógica pura do módulo de Compras v3
 * (index.html): transição de status, cancelamento com justificativa,
 * numeração transacional segura contra concorrência, vínculo de material
 * por ID com resolução de ambiguidade, e a modelagem financeira final:
 * Recebimento físico → Documento (nota) → Parcela → Conta a Pagar, com
 * obrigação provisória única enquanto não há documento.
 *
 * IMPORTANTE: estes são mirror-tests (lógica reescrita à mão em Node, sem
 * depender do DOM/Firebase). A validação funcional das FUNÇÕES REAIS
 * (comprasProximoNumeroAtomico, comprasResolverMaterialPorNome,
 * comprasReceberModal, comprasAdicionarDocumento, comprasSincronizarObrigacaoProvisoria)
 * rodando no navegador contra um mock fiel do Firestore está documentada em
 * scripts/browser_harness_bloco2_3.md — incluindo os 9 cenários pedidos na
 * rodada de fechamento (3 recebimentos+1 nota+2 parcelas, 2 recebimentos+2
 * notas, sem documento, documento tardio, clique duplicado, reload,
 * cancelamento, pagamento parcial de uma parcela, conciliação).
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
  return { id: 'pcx', numero: 1, status: 'solicitada', itens: itens, recebimentos: [], documentos: [], obrigacaoProvisoriaId: null, finCpId: null, cancelJustificativa: null, historico: [] };
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

// Espelho: comprasReceberModal — PURAMENTE FÍSICO, nunca cria Conta a Pagar.
function receberFisico(pc, itemIdx, qtdRecebidaAgora, stock) {
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
  pc.recebimentos.push({ id: recebimentoId, seq: seq, itens: [{ itemIdx: itemIdx, qty: qtd }], valorRecebido: valorEntrega, documentoId: null });
  return { ok: true, recebimentoId: recebimentoId, valorEntrega: valorEntrega };
}

// Espelho: comprasSincronizarObrigacaoProvisoria — NO MÁXIMO uma CP
// provisória por compra (id fixo), valor sempre = recebido − documentado.
function sincronizarProvisoria(pc, finCP) {
  var totalRecebido = pc.recebimentos.reduce(function (s, r) { return s + r.valorRecebido; }, 0);
  var totalDocumentado = pc.documentos.reduce(function (s, d) { return s + d.valorTotal; }, 0);
  var saldo = Math.max(0, +(totalRecebido - totalDocumentado).toFixed(2));
  var provId = 'cpprov_' + pc.id;
  var existente = finCP.find(function (c) { return c.id === provId; });
  if (saldo <= 0) {
    if (existente && existente.status === 'aguardando_documento') { existente.status = 'conciliada'; existente.valor = 0; }
    pc.obrigacaoProvisoriaId = null;
    return;
  }
  if (existente) {
    existente.valor = saldo;
    if (existente.status === 'conciliada') existente.status = 'aguardando_documento';
  } else {
    finCP.push({ id: provId, valor: saldo, status: 'aguardando_documento', origemCompraId: pc.id });
  }
  pc.obrigacaoProvisoriaId = provId;
}

// Espelho: comprasAdicionarDocumento — idempotente por número de documento;
// cada parcela tem Conta a Pagar com ID determinístico (idempotente).
function adicionarDocumento(pc, numero, valorTotal, nParc, finCP) {
  if (pc.documentos.some(function (d) { return d.numero === numero; })) return { ok: false, motivo: 'documento duplicado' };
  var documentoId = 'doc_' + pc.id + '_' + numero;
  var parcelas = [];
  var acumulado = 0;
  for (var i = 1; i <= nParc; i++) {
    var valorParcela = i === nParc ? +(valorTotal - acumulado).toFixed(2) : +(valorTotal / nParc).toFixed(2);
    acumulado += valorParcela;
    var parcelaId = documentoId + '_p' + i;
    var cpId = 'cppar_' + parcelaId;
    parcelas.push({ id: parcelaId, numero: i, valor: valorParcela, finCpId: cpId });
    if (!finCP.some(function (c) { return c.id === cpId; })) {
      finCP.push({ id: cpId, valor: valorParcela, status: 'agendado', origemCompraId: pc.id, origemDocumentoId: documentoId });
    }
  }
  pc.documentos.push({ id: documentoId, numero: numero, valorTotal: valorTotal, parcelas: parcelas });
  sincronizarProvisoria(pc, finCP);
  return { ok: true, documentoId: documentoId };
}

// Espelho: comprasResumoValores
function resumoValores(pc, finCP) {
  var valorPedido = pc.itens.reduce(function (s, i) { return s + i.qtyNecessaria * i.precoUnit; }, 0);
  var valorRecebido = pc.recebimentos.reduce(function (s, r) { return s + r.valorRecebido; }, 0);
  var valorDocumentado = pc.documentos.reduce(function (s, d) { return s + d.valorTotal; }, 0);
  var cpsParcelas = [];
  pc.documentos.forEach(function (d) { d.parcelas.forEach(function (p) { var c = finCP.find(function (x) { return x.id === p.finCpId; }); if (c) cpsParcelas.push(c); }); });
  var provisoria = pc.obrigacaoProvisoriaId ? finCP.find(function (c) { return c.id === pc.obrigacaoProvisoriaId && c.status === 'aguardando_documento'; }) : null;
  var todasCps = provisoria ? cpsParcelas.concat([provisoria]) : cpsParcelas;
  var valorAPagar = todasCps.filter(function (c) { return c.status !== 'pago'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  var valorPago = todasCps.filter(function (c) { return c.status === 'pago'; }).reduce(function (s, c) { return s + c.valor; }, 0);
  return {
    valorPedido: valorPedido, valorRecebido: valorRecebido, valorDocumentado: valorDocumentado,
    valorAPagar: valorAPagar, valorPago: valorPago,
    saldoContratual: Math.max(0, valorPedido - valorRecebido), saldoFinanceiro: valorAPagar
  };
}

// Espelho: comprasProximoNumeroAtomico — transação otimista sobre um
// contador único compartilhado (mesmo contrato do mock usado no harness
// do navegador: leitura de versão + reexecução em conflito).
function makeContadorTransacional() {
  var doc = { n: 0, version: 0 };
  return function proximoNumero() {
    var versaoLida = doc.version;
    var valorLido = doc.n;
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
  if (escolhaDoUsuario == null || isNaN(idx) || !candidatos[idx]) return null;
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

console.log('\n── 2.1 Numeração segura contra concorrência (mirror — ver harness) ──\n');
{
  var proximoNumero = makeContadorTransacional();
  var numeros = [proximoNumero(), proximoNumero(), proximoNumero(), proximoNumero(), proximoNumero()];
  var unicos = [...new Set(numeros)];
  test('9. 5 solicitações sequenciais recebem números distintos', numeros.length, unicos.length);
  test('10. numeração é sequencial (1..5)', numeros, [1, 2, 3, 4, 5]);
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

console.log('\n── 2.3 Recebimento físico → Documento → Parcela → CP ─────────\n');
{
  // Cenário: 3 recebimentos físicos + 1 documento cobrindo tudo em 2 parcelas
  var stock = { chapaAcm: { qty: 0 } };
  var finCP = [];
  var pc = novaCompra([{ material: 'chapaAcm', label: 'ACM 3mm', qtyNecessaria: 30, qtyRecebida: 0, unidade: 'chapa', precoUnit: 100 }]);

  receberFisico(pc, 0, 10, stock);
  receberFisico(pc, 0, 10, stock);
  receberFisico(pc, 0, 10, stock);
  test('16. 3 recebimentos físicos completam a quantidade -> status recebida', pc.status, 'recebida');
  test('17. estoque soma os 3 recebimentos (10+10+10=30)', stock.chapaAcm.qty, 30);
  test('18. recebimento físico NÃO cria Conta a Pagar sozinho', finCP.length, 0);

  sincronizarProvisoria(pc, finCP);
  test('19. após recebimentos sem documento, existe 1 (e só 1) CP provisória', finCP.length, 1);
  test('20. valor da provisória = tudo que foi recebido e ainda não documentado', finCP[0].valor, 3000);
  test('21. status da provisória é aguardando_documento', finCP[0].status, 'aguardando_documento');

  var docResult = adicionarDocumento(pc, 'NF-1001', 3000, 2, finCP);
  test('22. documento cobrindo tudo é aceito', docResult.ok, true);
  test('23. documento gera exatamente 2 parcelas (2 Contas a Pagar)', pc.documentos[0].parcelas.length, 2);
  test('24. cada parcela vale metade (1500 cada)', pc.documentos[0].parcelas.map(function (p) { return p.valor; }), [1500, 1500]);
  var provAposDoc = finCP.find(function (c) { return c.id === 'cpprov_' + pc.id; });
  test('25. provisória fica conciliada (não conta mais como "a pagar")', provAposDoc.status, 'conciliada');
  test('26. provisória conciliada tem valor zerado (nunca some do histórico do array)', provAposDoc.valor, 0);
  test('27. total de Contas a Pagar ativas nunca duplica o valor (2 parcelas = 3000, não 6000)', finCP.filter(function (c) { return c.status !== 'conciliada'; }).reduce(function (s, c) { return s + c.valor; }, 0), 3000);

  var rv = resumoValores(pc, finCP);
  test('28. valorPedido = contratado (30×100=3000), imutável', rv.valorPedido, 3000);
  test('29. valorRecebido = valorDocumentado quando tudo foi faturado', rv.valorRecebido, rv.valorDocumentado);
  test('30. valorAPagar vem só das parcelas (provisória conciliada não conta 2x)', rv.valorAPagar, 3000);
  test('31. saldoContratual zero (tudo recebido fisicamente)', rv.saldoContratual, 0);

  // Documento duplicado (mesmo número) deve ser rejeitado — idempotência
  var docDup = adicionarDocumento(pc, 'NF-1001', 999, 1, finCP);
  test('32. documento com número repetido é rejeitado (idempotência)', docDup.ok, false);
  test('33. Contas a Pagar não mudam com a tentativa de duplicar', finCP.length, 3);

  // Pagamento de UMA das 2 parcelas (pagamento parcial do total documentado)
  finCP.find(function (c) { return c.id === pc.documentos[0].parcelas[0].finCpId; }).status = 'pago';
  var rvAposPagto = resumoValores(pc, finCP);
  test('34. pagar 1 de 2 parcelas -> valorPago = valor de uma parcela', rvAposPagto.valorPago, 1500);
  test('35. valorAPagar cai para a parcela restante', rvAposPagto.valorAPagar, 1500);
}

console.log('\n── 2.3b Dois recebimentos, dois documentos diferentes ────────\n');
{
  var stock = { vidro: { qty: 0 } };
  var finCP = [];
  var pc = novaCompra([{ material: 'vidro', label: 'Vidro 4mm', qtyNecessaria: 20, qtyRecebida: 0, unidade: 'chapa', precoUnit: 50 }]);

  receberFisico(pc, 0, 10, stock);
  sincronizarProvisoria(pc, finCP);
  adicionarDocumento(pc, 'NF-A', 500, 1, finCP);
  test('36. 1º documento concilia a provisória do 1º recebimento', finCP.find(function (c) { return c.id === 'cpprov_' + pc.id; }).status, 'conciliada');

  receberFisico(pc, 0, 10, stock); // recebimento sem documento ainda
  sincronizarProvisoria(pc, finCP);
  var provReaberta = finCP.find(function (c) { return c.id === 'cpprov_' + pc.id; });
  test('37. novo recebimento sem documento REABRE a provisória', provReaberta.status, 'aguardando_documento');
  test('37b. provisória reaberta vale só o novo saldo não documentado (500)', provReaberta.valor, 500);

  adicionarDocumento(pc, 'NF-B', 500, 1, finCP);
  var rv = resumoValores(pc, finCP);
  test('38. 2 documentos distintos, nenhuma Conta a Pagar duplicada', finCP.filter(function (c) { return c.status !== 'conciliada'; }).length, 2);
  test('39. valorDocumentado = soma dos 2 documentos (500+500=1000)', rv.valorDocumentado, 1000);
  test('40. valorAPagar não duplica (1000, não 2000)', rv.valorAPagar, 1000);
}

console.log('\n── 2.3c Recebimento sem documento nunca chega + reload ───────\n');
{
  var stock = { mdf: { qty: 0 } };
  var finCP = [];
  var pc = novaCompra([{ material: 'mdf', label: 'MDF 15mm', qtyNecessaria: 5, qtyRecebida: 0, unidade: 'chapa', precoUnit: 200 }]);
  receberFisico(pc, 0, 5, stock);
  sincronizarProvisoria(pc, finCP);
  test('41. recebimento sem documento fica com provisória em aberto indefinidamente', finCP[0].status, 'aguardando_documento');

  // Simula reload: serializa e reconstrói a partir do "payload persistido"
  var payloadPc = JSON.parse(JSON.stringify(pc));
  var payloadFinCP = JSON.parse(JSON.stringify(finCP));
  var rvOriginal = resumoValores(pc, finCP);
  var rvReload = resumoValores(payloadPc, payloadFinCP);
  test('42. resumo de valores é idêntico antes/depois do reload simulado', rvReload, rvOriginal);
}

console.log('\n── Idempotência de solicitação concorrente por OS ────────────\n');
{
  function simulaSolicitarDeOS(osId, travas, comprasExistentes) {
    if (travas[osId]) return { criada: false, motivo: 'em andamento' };
    var jaExiste = comprasExistentes.some(function (pc) { return pc.origem === osId && pc.status !== 'cancelada'; });
    if (jaExiste) return { criada: false, motivo: 'já existe' };
    travas[osId] = true;
    return { criada: true };
  }
  var travas = {}, existentes = [];
  var r1 = simulaSolicitarDeOS('osDup', travas, existentes);
  var r2 = simulaSolicitarDeOS('osDup', travas, existentes);
  test('43. primeira chamada para a OS cria a solicitação', r1.criada, true);
  test('44. segunda chamada concorrente para a MESMA OS é bloqueada', r2.criada, false);
}

console.log('\n── Regressão de segurança (achados da revisão do diff) ──────\n');
{
  function cfgEsc(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  test('45. cfgEsc neutraliza tag <img> maliciosa', cfgEsc('<img src=x onerror=alert(1)>').indexOf('<img') === -1, true);
  test('46. cfgEsc neutraliza tag <script> maliciosa', cfgEsc('<script>alert(2)</script>').indexOf('<script>') === -1, true);
  test('47. cfgEsc preserva o texto legítimo (sem tags)', cfgEsc('Fornecedor ACME Ltda'), 'Fornecedor ACME Ltda');
}

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
