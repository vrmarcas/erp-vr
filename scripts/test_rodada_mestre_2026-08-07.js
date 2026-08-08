/**
 * test_rodada_mestre_2026-08-07.js
 * Testes de regressão para a "RODADA MESTRE — Estabilização Operacional"
 * (2026-08-07). Espelha (não importa) a lógica pura equivalente do
 * index.html, mesmo padrão de scripts/test_orcamento_hotfix_2026-08-07.js.
 * Cresce incrementalmente ao longo da rodada — cada bloco cobre só os
 * bugs efetivamente corrigidos até aquele ponto.
 *
 * Uso: node scripts/test_rodada_mestre_2026-08-07.js
 */

'use strict';

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}

console.log('\n' + '='.repeat(70));
console.log(' test_rodada_mestre_2026-08-07.js');
console.log('='.repeat(70) + '\n');

// ────────────────────────────────────────────────────────────────────────
// Kanban — bug real reproduzido: OS com prazo 07/08/2026 aparecia como
// "Atrasado 30 dias" porque new Date('07/08/2026') é interpretado como
// MM/DD (8 de julho), não DD/MM. Este arquivo convive com dois formatos
// (BR dd/mm/yyyy ao criar a OS; ISO yyyy-mm-dd depois de normalizado) —
// o parser precisa detectar o separador antes de montar a Date.
// ────────────────────────────────────────────────────────────────────────
console.log('── kbOpen: parsing de prazo BR vs ISO (seção 21) ──────────────\n');
{
  function parseEntregaParaAtraso(entrega, hojeISO) {
    var pp = entrega.indexOf('/') >= 0 ? entrega.split('/') : entrega.split('-');
    var ped = entrega.indexOf('/') >= 0
      ? new Date(+pp[2], +pp[1]-1, +pp[0])   // dd/mm/yyyy
      : new Date(+pp[0], +pp[1]-1, +pp[2]);  // yyyy-mm-dd
    var hp = hojeISO.split('-');
    var hoje = new Date(+hp[0], +hp[1]-1, +hp[2]);
    return Math.ceil((ped - hoje) / 864e5);
  }
  test('1. prazo BR 07/08/2026 avaliado em 07/08/2026 (hoje) não está atrasado',
    parseEntregaParaAtraso('07/08/2026', '2026-08-07'), 0);
  test('2. prazo BR 07/08/2026 avaliado em 05/08/2026 mostra +2 dias, não -30',
    parseEntregaParaAtraso('07/08/2026', '2026-08-05'), 2);
  test('3. prazo ISO 2026-08-07 avaliado em 2026-08-07 (hoje) não está atrasado',
    parseEntregaParaAtraso('2026-08-07', '2026-08-07'), 0);
  test('4. prazo BR de fato atrasado (01/08/2026, hoje 07/08/2026) mostra -6, nunca -30',
    parseEntregaParaAtraso('01/08/2026', '2026-08-07'), -6);
}

// ────────────────────────────────────────────────────────────────────────
// Duplo clique / idempotência (seção 5) — guard em memória contra chamada
// concorrente da mesma ação enquanto a primeira ainda está em voo.
// ────────────────────────────────────────────────────────────────────────
console.log('\n── Guard de chamada concorrente (seção 5) ─────────────────────\n');
{
  // Espelha o padrão usado em orcSalvarOrcamento(): a segunda chamada
  // enquanto a primeira está em voo reaproveita a MESMA promise, nunca
  // executa a lógica de novo (que criaria um registro duplicado com o
  // mesmo id, já que o número reservado é memoizado).
  function criarGuardEmVoo(implFn) {
    var emVoo = null;
    return function chamar() {
      if (emVoo) return emVoo;
      emVoo = implFn().finally(function () { emVoo = null; });
      return emVoo;
    };
  }
  var execucoes = 0;
  var salvar = criarGuardEmVoo(function () {
    execucoes++;
    return new Promise(function (resolve) { setTimeout(function () { resolve({ id: 'ORC-1' }); }, 10); });
  });
  var p1 = salvar(), p2 = salvar();
  Promise.all([p1, p2]).then(function (results) {
    test('5. duas chamadas quase simultâneas executam a lógica real só UMA vez', execucoes, 1);
    test('6. ambas as chamadas recebem o MESMO resultado (mesmo id, nunca dois registros)',
      results[0].id === results[1].id, true);
    finalizar();
  });
}

function finalizar() {
  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
}
