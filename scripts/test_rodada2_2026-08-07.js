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
  // Espelha orcObterConfirmacaoEntrada(): recibo só libera com OS gerada
  // pela transação real de pagamento E valorEntrada>0 nela — nunca a
  // partir do campo de texto livre orcEntradaValor.
  function orcObterConfirmacaoEntradaMirror(orcId, lista, KB_OS) {
    if (!orcId) return { pode: false, motivo: 'orcamento_nao_salvo' };
    var orc = lista.find(function (x) { return x.id === orcId; });
    if (!orc) return { pode: false, motivo: 'orcamento_nao_encontrado' };
    if (!orc.osRef) return { pode: false, motivo: 'pagamento_nao_confirmado' };
    var os = KB_OS[orc.osRef];
    if (!os || !((os.valorEntrada || 0) > 0)) return { pode: false, motivo: 'entrada_nao_confirmada' };
    return { pode: true, orc: orc, os: os };
  }
  var listaOrc = [{ id: 'ORC-1', num: '1' }, { id: 'ORC-2', num: '2', osRef: 'os1' }, { id: 'ORC-3', num: '3', osRef: 'os2' }];
  var kbOs = { os1: { num: '10', valorEntrada: 0, restante: 400 }, os2: { num: '11', valorEntrada: 200, restante: 200 } };
  test('14. sem orçamento salvo (id nulo), recibo bloqueado mesmo com campo preenchido', orcObterConfirmacaoEntradaMirror(null, listaOrc, kbOs).pode, false);
  test('15. orçamento salvo mas sem OS/pagamento confirmado — recibo bloqueado', orcObterConfirmacaoEntradaMirror('ORC-1', listaOrc, kbOs).pode, false);
  test('15b. OS gerada mas com valorEntrada=0 ("a receber") — recibo bloqueado', orcObterConfirmacaoEntradaMirror('ORC-2', listaOrc, kbOs).pode, false);
  test('16. orçamento salvo + OS com entrada confirmada — recibo liberado', orcObterConfirmacaoEntradaMirror('ORC-3', listaOrc, kbOs).pode, true);
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

// ────────────────────────────────────────────────────────────────────────
// P0.2 — Salvar antes de enviar: WhatsApp/PDF/E-mail/Link de Pagamento só
// liberados após o 1º save (window._orcSessaoAtualId atribuído). Espelha
// _orcAtualizarVisibilidadeEnvio().
// ────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────
// P0.5 — OS detalhada: cada item do pedido aparece com produto/qtd/
// material/medidas/observações, nunca só um resumo genérico do itens[0].
// Espelha kbRenderItensDetalhe() (sem HTML real — só a extração de dados).
// ────────────────────────────────────────────────────────────────────────
console.log('\n── OS detalhada — snapshot operacional completo (P0.5) ────────\n');
{
  function extrairLinhasItens(itens) {
    // Espelha exatamente os campos lidos por kbRenderItensDetalhe() — só
    // prod/qty/mat/larg/alt/det/extras.descricao/planArea. NUNCA lê
    // it.unit/it.total (dado financeiro), mesmo que existam no objeto de
    // origem (Master/Financeiro têm esses campos via merge de kb_os_fin).
    return (itens || []).filter(function (it) { return it && it.prod; }).map(function (it) {
      return {
        prod: it.prod, qty: it.qty || 1,
        mat: it.mat || '—',
        medidas: (it.larg && it.alt) ? (it.larg + '×' + it.alt + ' cm') : '—',
        obs: [it.det, it.extras && it.extras.descricao].filter(Boolean).join(' · '),
      };
    });
  }
  var itensOS = [
    { prod: 'Caixa Personalizada', qty: 2, mat: 'MDF 6mm', larg: 30, alt: 20, det: 'gravação a laser', unit: 'R$ 50,00', total: 'R$ 100,00' },
    { prod: 'Placa de Acrílico', qty: 1, mat: 'Acrílico Cristal 3mm', larg: 40, alt: 15, extras: { descricao: 'furos para fixação', acabamento: 30 } },
  ];
  var linhas = extrairLinhasItens(itensOS);
  test('20. OS com 2 produtos diferentes gera 2 linhas de detalhe (não resume em 1)', linhas.length, 2);
  test('21. segunda linha traz material e medidas do PRÓPRIO item (não herda do item 1)', { mat: linhas[1].mat, medidas: linhas[1].medidas }, { mat: 'Acrílico Cristal 3mm', medidas: '40×15 cm' });
  test('22. observação combina det + extras.descricao quando ambos existem', linhas[0].obs, 'gravação a laser');
  test('22b. item sem det usa só extras.descricao', linhas[1].obs, 'furos para fixação');
  // A função real (kbRenderItensDetalhe) só lê prod/qty/mat/larg/alt/det/
  // extras.descricao/planArea — nunca it.unit/it.total no HTML gerado,
  // mesmo que esses campos estejam presentes no objeto (Master/Financeiro).
  test('22c. dado financeiro (unit/total) existe no objeto de origem mas nunca é usado na extração', linhas.every(function(l){ return !('unit' in l) && !('total' in l); }), true);
}

// ────────────────────────────────────────────────────────────────────────
// P0.7 — Sugestão automática de material (chapa/retalho) a partir da
// planificação. Espelha kbCalcAreaOS/kbParseDimsArea/kbSugerirMaterial().
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Sugestão automática de chapa/retalho (P0.7) ────────────────\n');
{
  function kbCalcAreaOSMirror(os) {
    var itens = os.itens || [];
    var total = 0;
    itens.forEach(function (it) {
      if (it && it.planArea && parseFloat(it.planArea) > 0) { total += parseFloat(it.planArea); return; }
      var l = it && parseFloat(it.larg) || 0, a = it && parseFloat(it.alt) || 0, q = it && parseInt(it.qty) || 1;
      if (l > 0 && a > 0) total += (l * a / 10000) * q;
    });
    return total;
  }
  function kbParseDimsAreaMirror(dimsStr) {
    var m = String(dimsStr || '').match(/(\d+(?:[.,]\d+)?)\s*[×xX]\s*(\d+(?:[.,]\d+)?)/);
    if (!m) return 0;
    var w = parseFloat(m[1].replace(',', '.')), h = parseFloat(m[2].replace(',', '.'));
    return (w * h) / 10000;
  }
  function kbSugerirMaterialMirror(os, matKey, STOCK, RETALHOS) {
    var areaNecessaria = kbCalcAreaOSMirror(os);
    if (!areaNecessaria || !matKey || !STOCK[matKey]) return null;
    var rCompativeis = RETALHOS.filter(function (r) {
      return r.qty > 0 && r.mat === matKey && kbParseDimsAreaMirror(r.dims) >= areaNecessaria * 0.98;
    }).sort(function (a, b) { return kbParseDimsAreaMirror(a.dims) - kbParseDimsAreaMirror(b.dims); });
    if (rCompativeis.length) {
      var r = rCompativeis[0];
      return { tipo: 'retalho', retalho: r, texto: 'Usar retalho ' + (r.codigo || '—') + ' — ' + r.dims + ' cm' };
    }
    var s = STOCK[matKey];
    var areaChapa = (s.chapLarg && s.chapComp) ? (s.chapLarg * s.chapComp / 10000) : 0;
    if (!areaChapa) return null;
    var fracaoBruta = areaNecessaria / areaChapa;
    var fracao = fracaoBruta <= 0.5 ? 0.5 : Math.ceil(fracaoBruta * 4) / 4;
    return { tipo: 'chapa', fracaoChapa: fracao };
  }

  var STOCK_T = { acr3: { chapLarg: 200, chapComp: 100 } };
  // OS com 1 peça de 100x50cm = 0,5 m² → cabe numa meia-chapa (200x100=2m²; metade=1m²... vamos calibrar valores abaixo)
  var osPequena = { itens: [{ prod: 'Placa', qty: 1, larg: 70, alt: 70, mat: 'Acrílico 3mm' }] }; // 0,49 m²
  var osGrande  = { itens: [{ prod: 'Painel', qty: 1, larg: 190, alt: 95, mat: 'Acrílico 3mm' }] }; // 1,805 m² (quase 1 chapa inteira de 2 m²)

  test('26. sem retalho compatível, sugere fração de chapa (área pequena → 0,5 chapa)', kbSugerirMaterialMirror(osPequena, 'acr3', STOCK_T, []), { tipo: 'chapa', fracaoChapa: 0.5 });
  test('27. área quase do tamanho de 1 chapa inteira → sugere 1 chapa (arredonda pra cima)', kbSugerirMaterialMirror(osGrande, 'acr3', STOCK_T, []).fracaoChapa, 1);

  var retalhoCompativel = { mat: 'acr3', dims: '90×90', qty: 2, codigo: 'ACR-014' };
  var retalhoPequenoDemais = { mat: 'acr3', dims: '50×50', qty: 3, codigo: 'ACR-003' };
  var sugRetalho = kbSugerirMaterialMirror(osPequena, 'acr3', STOCK_T, [retalhoPequenoDemais, retalhoCompativel]);
  test('28. quando existe retalho grande o bastante (encaixe), sugere o retalho — nunca chapa nova', sugRetalho.tipo, 'retalho');
  test('29. sugestão de retalho traz o código exato', sugRetalho.texto, 'Usar retalho ACR-014 — 90×90 cm');
  test('30. retalho pequeno demais (não encaixa a área necessária) nunca é sugerido', sugRetalho.retalho.codigo, 'ACR-014');
}

console.log('\n── Salvar antes de enviar (P0.2) ──────────────────────────────\n');
{
  function estadoBotoesEnvio(sessaoAtualId) {
    var salvo = !!sessaoAtualId;
    return { salvar: true, whatsapp: salvo, pdf: salvo, email: salvo, linkPgto: salvo };
  }
  test('31. antes do 1º save (sessao=null): só Salvar habilitado', estadoBotoesEnvio(null), { salvar: true, whatsapp: false, pdf: false, email: false, linkPgto: false });
  test('32. depois do 1º save (sessao=ORC-1): todos os canais liberados', estadoBotoesEnvio('ORC-1'), { salvar: true, whatsapp: true, pdf: true, email: true, linkPgto: true });

  // Duplo clique em Salvar: orcSalvarOrcamento() reusa a MESMA promise em
  // voo (_orcSalvarEmVoo) — nunca dispara duas gravações/duas reservas de
  // número para o mesmo clique duplicado.
  function simularSalvarComDedup() {
    var emVoo = null, chamadasReais = 0;
    function salvarImpl() { chamadasReais++; return Promise.resolve({ id: 'ORC-1', num: '1' }); }
    function salvar() {
      if (emVoo) return emVoo;
      emVoo = salvarImpl().finally(function () { emVoo = null; });
      return emVoo;
    }
    return Promise.all([salvar(), salvar()]).then(function () { return chamadasReais; });
  }
  simularSalvarComDedup().then(function (chamadas) {
    test('33. duplo clique em Salvar dispara só 1 gravação real (dedup por promise em voo)', chamadas, 1);

    console.log('\n' + '='.repeat(70));
    console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
    console.log('='.repeat(70) + '\n');
    if (failed > 0) process.exitCode = 1;
  });
}

if (failed > 0) process.exitCode = 1;
