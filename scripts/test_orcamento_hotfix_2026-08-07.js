/**
 * test_orcamento_hotfix_2026-08-07.js
 * Testes de regressão para os bugs P0/P1 reproduzidos e corrigidos na rodada
 * "CORREÇÕES DE ORÇAMENTO, PAGAMENTO, DOCUMENTOS, OS E KANBAN" (2026-08-07).
 *
 * Segue a mesma disciplina de scripts/test_orcamento.js: espelha (não
 * importa) a lógica pura equivalente do index.html, já que o arquivo é um
 * monólito de front-end sem módulos exportáveis. Cobre só os bugs
 * efetivamente corrigidos nesta rodada — não repete a auditoria histórica
 * completa da Fase F (Parte 24 da instrução).
 *
 * Uso: node scripts/test_orcamento_hotfix_2026-08-07.js
 */

'use strict';

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }

console.log('\n' + '='.repeat(70));
console.log(' test_orcamento_hotfix_2026-08-07.js');
console.log('='.repeat(70) + '\n');

// ────────────────────────────────────────────────────────────────────────
// Cenário reproduzido: orçamento salvo a R$189,46 reabria a R$2,03 porque
// orcEnvEditar() recalculava a partir da config/preços ATUAIS em vez de
// restaurar o snapshotCompleto.breakdown gravado no momento do salvamento.
// Espelha a regra: reabertura NUNCA recalcula, sempre usa o snapshot.
// ────────────────────────────────────────────────────────────────────────
console.log('── Snapshot fiel no reopen (Partes 10/11) ────────────────────\n');
{
  function reabrirOrcamento(orcSalvo, configAtualDiferente) {
    // orcEnvAbrir() correto: breakdown vem SEMPRE do snapshot persistido,
    // nunca de uma nova chamada a orcRecalc() com a config atual.
    return orcSalvo.snapshotCompleto ? orcSalvo.snapshotCompleto.breakdown.finalPrice : null;
  }
  var orcSalvo = {
    valorFinal: 189.46,
    snapshotCompleto: { breakdown: { finalPrice: 189.46, totalCost: 150.00 }, versaoSnapshot: 2 }
  };
  var configDepoisMudada = { overhead: 0.99 }; // config mudou drasticamente após salvar
  test('1. reabertura retorna o valor salvo (189.46), não recalcula com config nova',
    reabrirOrcamento(orcSalvo, configDepoisMudada), 189.46);

  var orcLegado = { valorFinal: 300, snapshotCompleto: null };
  test('2. registro legado sem snapshotCompleto é sinalizado (null), nunca inventa valor',
    reabrirOrcamento(orcLegado, {}), null);
}

// ────────────────────────────────────────────────────────────────────────
// Fonte única de status: orcToggleClienteAprov() e a lista "Orçamentos
// Enviados" devem concordar sempre — o toggle do wizard grava no MESMO
// campo canônico (orc.status via orcEnvSetStatus), nunca um booleano local.
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Fonte única de status (Parte 12) ──────────────────────────\n');
{
  function orcEnvSetStatus(lista, id, status) {
    var o = lista.find(function (x) { return x.id === id; });
    if (o) o.status = status;
    return lista;
  }
  function toggleClienteAprov(lista, id, aprovadoAntes) {
    var novoStatus = !aprovadoAntes ? 'aprovado' : 'aguardando';
    orcEnvSetStatus(lista, id, novoStatus);
    return novoStatus;
  }
  var lista = [{ id: 'ORC-1', status: 'aguardando' }];
  toggleClienteAprov(lista, 'ORC-1', false);
  test('3. toggle "Cliente Aprovou" atualiza o status canônico usado pela listagem',
    lista[0].status, 'aprovado');
  toggleClienteAprov(lista, 'ORC-1', true);
  test('4. desfazer aprovação volta o mesmo campo canônico',
    lista[0].status, 'aguardando');
}

// ────────────────────────────────────────────────────────────────────────
// Gatilho de OS / início de produção: depende do SALDO realmente pendente
// (restante), nunca do tipo de pagamento escolhido nem de "pagamento
// total". Cenário J do enunciado.
// ────────────────────────────────────────────────────────────────────────
console.log('\n── OS/produção não exige pagamento total (Partes 15/17) ──────\n');
{
  function statusInicialOS(valorTotal, valorEntrada) {
    var restante = Math.round((valorTotal - valorEntrada) * 100) / 100;
    return restante > 0 ? 'aguardando_saldo' : 'iniciada';
  }
  test('5. entrada 50% de R$400 (R$200) deixa R$200 de saldo → aguardando_saldo',
    statusInicialOS(400, 200), 'aguardando_saldo');
  test('6. entrada integral (R$400 de R$400) não deixa saldo → iniciada direto',
    statusInicialOS(400, 400), 'iniciada');
  test('7. tipo "parcial" com entrada parcial também vira aguardando_saldo (antes só 50-50 gerava isso)',
    statusInicialOS(400, 100), 'aguardando_saldo');

  function podeIniciarProducao(statusOS) {
    // kbOpen(): caixa "Iniciar Produção" visível para iniciada OU aguardando_saldo —
    // nunca exige status "pago".
    return statusOS === 'iniciada' || statusOS === 'aguardando_saldo';
  }
  test('8. produção pode iniciar com aguardando_saldo (entrada confirmada, saldo pendente)',
    podeIniciarProducao('aguardando_saldo'), true);
  test('9. produção pode iniciar com iniciada (pago 100%)',
    podeIniciarProducao('iniciada'), true);
}

// ────────────────────────────────────────────────────────────────────────
// Condição padrão 50/50 (Parte 5) — precisão de centavos.
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Condição padrão 50/50, precisão de centavos (Parte 5) ─────\n');
{
  function split5050(valorTotal) {
    var entrada = Math.round((valorTotal / 2) * 100) / 100;
    var saldo = Math.round((valorTotal - entrada) * 100) / 100;
    return { entrada: entrada, saldo: saldo, soma: Math.round((entrada + saldo) * 100) / 100 };
  }
  var r = split5050(400);
  test('10. R$400 → entrada R$200,00 + saldo R$200,00', r, { entrada: 200, saldo: 200, soma: 400 });

  var r2 = split5050(189.47); // valor ímpar em centavos
  test('11. valor ímpar em centavos não perde nem ganha 1 centavo na soma',
    r2.soma, 189.47);
}

// ────────────────────────────────────────────────────────────────────────
// Kanban: card só entra numa coluna de dia da semana se o prazo da OS cair
// DENTRO da semana exibida — caso contrário cai em "Novas" (nunca em um
// dia da semana errado, mesmo que o dia da semana "bata" numericamente).
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Kanban — card na coluna certa (Parte 16) ───────────────────\n');
{
  function colunaParaPrazo(prazoISO, segundaExibidaISO) {
    var seg = new Date(segundaExibidaISO + 'T00:00:00');
    var sab = new Date(seg); sab.setDate(sab.getDate() + 5);
    var prazo = new Date(prazoISO + 'T00:00:00');
    if (prazo < seg || prazo > sab) return 'novas';
    var dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
    return dias[prazo.getDay()];
  }
  test('12. prazo na terça da semana exibida cai na coluna de terça',
    colunaParaPrazo('2026-08-11', '2026-08-10'), 'ter');
  test('13. prazo de uma semana seguinte (mesmo dia da semana) NÃO cai na coluna desta semana',
    colunaParaPrazo('2026-08-18', '2026-08-10'), 'novas');
  test('14. prazo de uma semana anterior também cai em "novas", nunca numa coluna errada',
    colunaParaPrazo('2026-08-04', '2026-08-10'), 'novas');
}

// ────────────────────────────────────────────────────────────────────────
// Checklist de produção da OS — Montagem só aparece quando o orçamento de
// origem realmente cobrou montagem (Partes 18/19, "pular etapas que não
// se aplicam").
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Checklist de produção — etapas condicionais (Partes 18/19) ─\n');
{
  function checklistProducao(orcMontagemValor) {
    var checks = ['Corte', 'Gravação', 'Acabamento'];
    if (parseFloat(orcMontagemValor) > 0) checks.push('Montagem');
    checks.push('Embalagem');
    return checks;
  }
  test('15. sem montagem cobrada, checklist não inclui a etapa',
    checklistProducao(0), ['Corte', 'Gravação', 'Acabamento', 'Embalagem']);
  test('16. com montagem cobrada (R$50), checklist inclui a etapa antes de Embalagem',
    checklistProducao(50), ['Corte', 'Gravação', 'Acabamento', 'Montagem', 'Embalagem']);
}

// ────────────────────────────────────────────────────────────────────────
// Desconto/acréscimo comercial interno nunca aparece pro cliente — cliente
// só vê o preço final já incorporado (Cenário do enunciado: R$200 técnico +
// R$50 acréscimo interno → cliente vê R$250 só).
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Ajuste comercial interno nunca exposto ao cliente ──────────\n');
{
  function montarDocumentoCliente(precoTecnico, acrescimoRS) {
    var precoFinal = precoTecnico + acrescimoRS;
    // O documento (PDF/WhatsApp/recibo) só recebe o preço final — nunca o
    // objeto de auditoria (ajusteComercialAudit), que fica só na tela interna.
    return { precoExibido: precoFinal };
  }
  var doc = montarDocumentoCliente(200, 50);
  test('17. cliente vê só o preço final (R$250), nunca o técnico nem o acréscimo separados',
    doc, { precoExibido: 250 });
  test('18. documento do cliente não expõe nenhum campo de auditoria interna',
    Object.keys(doc).indexOf('ajusteComercialAudit'), -1);
}

// ────────────────────────────────────────────────────────────────────────
// Filtro de data em "Orçamentos Enviados" — parseia dataSalvo ("dd/mm/yyyy
// hh:mm"), único carimbo disponível mesmo em registros legados.
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Filtro de data/mês/ano em Orçamentos Enviados (Parte 13) ──\n');
{
  function parseDataSalvo(dataSalvo) {
    if (!dataSalvo) return null;
    var partes = dataSalvo.split(' ')[0].split('/');
    if (partes.length !== 3) return null;
    var dd = parseInt(partes[0], 10), mm = parseInt(partes[1], 10), yyyy = parseInt(partes[2], 10);
    if (!dd || !mm || !yyyy) return null;
    return new Date(yyyy, mm - 1, dd);
  }
  function dentroDoIntervalo(dataSalvo, deISO, ateISO) {
    var d = parseDataSalvo(dataSalvo);
    if (!d) return false;
    if (deISO && d < new Date(deISO + 'T00:00:00')) return false;
    if (ateISO && d > new Date(ateISO + 'T23:59:59')) return false;
    return true;
  }
  test('19. orçamento de 15/08/2026 está dentro do filtro 01/08 a 31/08',
    dentroDoIntervalo('15/08/2026 14:30', '2026-08-01', '2026-08-31'), true);
  test('20. orçamento de 02/09/2026 fica FORA do filtro de agosto',
    dentroDoIntervalo('02/09/2026 09:00', '2026-08-01', '2026-08-31'), false);
  test('21. registro sem dataSalvo (formato inesperado) nunca quebra o filtro — só é excluído',
    dentroDoIntervalo('', '2026-08-01', '2026-08-31'), false);
}

// ────────────────────────────────────────────────────────────────────────
// Recibo de entrada: bloco de saldo restante só aparece quando existe
// saldo (Parte 14 — nunca mostrar linha de saldo zerado como se fosse
// pendência real).
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Recibo de entrada — sem linha de saldo quando quitado ─────\n');
{
  function reciboTemBlocoSaldo(total, entrada) {
    var resto = Math.max(0, total - entrada);
    return resto > 0;
  }
  test('22. entrada igual ao total → recibo NÃO mostra bloco de saldo restante',
    reciboTemBlocoSaldo(300, 300), false);
  test('23. entrada parcial → recibo mostra bloco de saldo restante',
    reciboTemBlocoSaldo(300, 200), true);
}

// ────────────────────────────────────────────────────────────────────────
// Wizard → fluxo real: o botão final do wizard (Step 5) não pode concluir
// "pagamento confirmado" sem ter salvo o orçamento primeiro — autosave
// falho aborta ANTES de abrir o modal real de pagamento (nunca finge
// sucesso local).
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Wizard delega para o fluxo real (nunca simula localmente) ──\n');
{
  function confirmarPagtoWizard(resultadoAutosave) {
    if (!resultadoAutosave || !resultadoAutosave.id) {
      return { abriuModalReal: false, erro: true };
    }
    return { abriuModalReal: true, erro: false, idUsado: resultadoAutosave.id };
  }
  test('24. autosave falho (null) nunca abre o modal de pagamento nem finge sucesso',
    confirmarPagtoWizard(null), { abriuModalReal: false, erro: true });
  test('25. autosave OK abre o modal real com o id do orçamento salvo',
    confirmarPagtoWizard({ id: 'ORC-000123' }), { abriuModalReal: true, erro: false, idUsado: 'ORC-000123' });
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');

if (failed > 0) process.exit(1);
