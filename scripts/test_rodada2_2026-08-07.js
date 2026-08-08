/**
 * test_rodada2_2026-08-07.js
 * Testes de regressão para a "RODADA 2 — FECHAR OS BLOCOS OPERACIONAIS
 * AINDA PENDENTES" (2026-08-07). Mesmo padrão dos scripts anteriores:
 * espelha a lógica pura equivalente do index.html.
 *
 * Uso: node scripts/test_rodada2_2026-08-07.js
 */

'use strict';

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}

console.log('\n' + '='.repeat(70));
console.log(' test_rodada2_2026-08-07.js');
console.log('='.repeat(70) + '\n');

// ────────────────────────────────────────────────────────────────────────
// P0.6 — Privacidade financeira real da Produção: kb_os_fin separado de
// kb_os. Espelha kbSaveKbos()'s split e _kbMergeFinCache()'s merge.
// ────────────────────────────────────────────────────────────────────────
console.log('── Split kb_os / kb_os_fin (P0.6) ─────────────────────────────\n');
{
  var FIN_FIELDS = ['valor','totalGeral','parcelas','formaPgto','pagtoTipo','valorEntrada','restante'];
  function splitKbOs(KB_OS) {
    var kbCopy = {}, finCopy = {};
    Object.keys(KB_OS).forEach(function(k) {
      var o = Object.assign({}, KB_OS[k]);
      var fin = {};
      FIN_FIELDS.forEach(function(f) { if (o[f] !== undefined) { fin[f] = o[f]; delete o[f]; } });
      if (Array.isArray(o.itens)) {
        var temValores = o.itens.some(function(it) { return it && (it.unit !== undefined || it.total !== undefined); });
        if (temValores) fin.itensValores = o.itens.map(function(it) { return { unit: it && it.unit, total: it && it.total }; });
        o.itens = o.itens.map(function(it) { if (!it) return it; var c = Object.assign({}, it); delete c.unit; delete c.total; return c; });
      }
      kbCopy[k] = o;
      if (Object.keys(fin).length) finCopy[k] = fin;
    });
    return { kbCopy: kbCopy, finCopy: finCopy };
  }
  function mergeFinCache(KB_OS, FIN_CACHE) {
    Object.keys(FIN_CACHE).forEach(function(id) {
      var os = KB_OS[id]; if (!os) return;
      var fin = FIN_CACHE[id]; if (!fin) return;
      FIN_FIELDS.forEach(function(f) { if (fin[f] !== undefined) os[f] = fin[f]; });
      if (fin.itensValores && Array.isArray(os.itens)) {
        os.itens.forEach(function(it, i) {
          if (!it || !fin.itensValores[i]) return;
          if (fin.itensValores[i].unit !== undefined) it.unit = fin.itensValores[i].unit;
          if (fin.itensValores[i].total !== undefined) it.total = fin.itensValores[i].total;
        });
      }
    });
  }

  var osOriginal = {
    os1: { id: 'os1', num: '1', cliente: 'Cliente A', status: 'iniciada', valor: 400, totalGeral: 400, valorEntrada: 200, restante: 200, formaPgto: 'PIX', pagtoTipo: '50-50', parcelas: 1, itens: [{ prod: 'Caixa', qty: 2, unit: 200, total: 400 }] }
  };
  var split = splitKbOs(osOriginal);
  test('1. kb_os (operacional) não contém nenhum campo financeiro', FIN_FIELDS.some(function(f){ return split.kbCopy.os1[f]!==undefined; }), false);
  test('2. kb_os mantém campos operacionais (status, cliente, num)', { status: split.kbCopy.os1.status, cliente: split.kbCopy.os1.cliente }, { status: 'iniciada', cliente: 'Cliente A' });
  test('3. kb_os.itens perde unit/total (não vaza preço unitário)', split.kbCopy.os1.itens[0].unit === undefined && split.kbCopy.os1.itens[0].total === undefined, true);
  test('4. kb_os_fin contém os campos financeiros', { valor: split.finCopy.os1.valor, restante: split.finCopy.os1.restante }, { valor: 400, restante: 200 });
  test('5. kb_os_fin.itensValores preserva unit/total por posição', split.finCopy.os1.itensValores[0], { unit: 200, total: 400 });

  // Produção: nunca consegue ler kb_os_fin (Rules negam) → KB_OS local
  // nunca ganha os campos financeiros de volta.
  var KB_OS_producao = JSON.parse(JSON.stringify(split.kbCopy));
  mergeFinCache(KB_OS_producao, {}); // cache vazio — simula leitura negada
  test('6. Produção: campos financeiros continuam ausentes após "merge" com cache vazio', FIN_FIELDS.some(function(f){ return KB_OS_producao.os1[f]!==undefined; }), false);

  // Master/Comercial/Financeiro: conseguem ler kb_os_fin → merge restaura tudo.
  var KB_OS_master = JSON.parse(JSON.stringify(split.kbCopy));
  mergeFinCache(KB_OS_master, split.finCopy);
  test('7. Master: valor/restante restaurados após merge com kb_os_fin real', { valor: KB_OS_master.os1.valor, restante: KB_OS_master.os1.restante }, { valor: 400, restante: 200 });
  test('8. Master: itens[].unit/total restaurados após merge', KB_OS_master.os1.itens[0], { prod: 'Caixa', qty: 2, unit: 200, total: 400 });

  // Guard: Produção nunca deveria conseguir escrever kb_os_fin mesmo se
  // tentasse — finCopy dela sempre sai vazio porque ela nunca teve os
  // campos financeiros carregados para começar.
  var splitProducao = splitKbOs(KB_OS_producao);
  test('9. Se Produção tentasse re-salvar, finCopy sai vazio (nada a sobrescrever)', Object.keys(splitProducao.finCopy).length, 0);
}

// ────────────────────────────────────────────────────────────────────────
// P0.1 — 50/50 com sugestão automática "R$ X"
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Sugestão 50/50 automática (P0.1) ───────────────────────────\n');
{
  function sugestao5050(total) {
    var entrada = Math.round((total / 2) * 100) / 100;
    var saldo = Math.round((total - entrada) * 100) / 100;
    return { entrada: entrada, saldo: saldo, texto: '50% corresponde a R$ ' + entrada.toFixed(2).replace('.', ',') };
  }
  var r = sugestao5050(202.50);
  test('10. R$202,50 → sugestão de entrada R$101,25', r.entrada, 101.25);
  test('11. R$202,50 → saldo R$101,25 (sem perder centavo)', r.saldo, 101.25);
  test('12. soma entrada+saldo bate exatamente com o total', Math.round((r.entrada + r.saldo) * 100) / 100, 202.50);
  test('13. texto de sugestão menciona o valor em reais', r.texto, '50% corresponde a R$ 101,25');
}

// ────────────────────────────────────────────────────────────────────────
// P0.3 — Recibo só após entrada confirmada (gate real, não só campo
// preenchido)
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Gate do recibo de entrada (P0.3) ───────────────────────────\n');
{
  function podeGerarRecibo(orcSalvo, entradaConfirmada) {
    if (!orcSalvo || !orcSalvo.id) return { pode: false, motivo: 'orcamento_nao_salvo' };
    if (!entradaConfirmada) return { pode: false, motivo: 'entrada_nao_confirmada' };
    return { pode: true };
  }
  test('14. sem orçamento salvo, recibo bloqueado mesmo com campo preenchido', podeGerarRecibo(null, true).pode, false);
  test('15. orçamento salvo mas entrada não confirmada — recibo bloqueado', podeGerarRecibo({ id: 'ORC-1' }, false).pode, false);
  test('16. orçamento salvo + entrada confirmada — recibo liberado', podeGerarRecibo({ id: 'ORC-1' }, true).pode, true);
}

// ────────────────────────────────────────────────────────────────────────
// P0.4 — Vitre OS não bloqueia por ficha incompleta (marca pendente)
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Vitre OS com ficha incompleta não bloqueia (P0.4) ──────────\n');
{
  function classificarItemOS(prod, estoquePronto, qtd) {
    var temFichaCompleta = !!(prod.fichaTecnica && prod.fichaTecnica.componentes && prod.fichaTecnica.componentes.length && prod.arquivoCorte);
    if (estoquePronto >= qtd) return { tipo: 'pronta_entrega' };
    if (temFichaCompleta) return { tipo: 'produzido_apos_pedido' };
    // Rodada 2, P0.4: antes bloqueava a OS inteira; agora marca pendente
    // e deixa a OS ser criada mesmo assim.
    return { tipo: 'ficha_tecnica_pendente', avisoOperacional: true };
  }
  function osEhBloqueada(itens) {
    // Nunca bloqueia mais por ficha_tecnica_pendente — só por item
    // removido/inválido (situação diferente, fora deste teste).
    return itens.some(function(i) { return i.tipo === 'produto_removido'; });
  }
  var itemSemFicha = classificarItemOS({ nome: 'Bandeja X' }, 0, 2);
  test('17. produto sem ficha completa e sem estoque vira ficha_tecnica_pendente', itemSemFicha.tipo, 'ficha_tecnica_pendente');
  test('18. item ficha_tecnica_pendente carrega aviso operacional', itemSemFicha.avisoOperacional, true);
  test('19. OS com item ficha_tecnica_pendente NÃO é bloqueada', osEhBloqueada([itemSemFicha]), false);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');

if (failed > 0) process.exitCode = 1;
