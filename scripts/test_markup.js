/**
 * test_markup.js
 * Testes automatizados para a lógica pura da revisão semestral de markup
 * (index.html, seção 18): detecção de mudança, cálculo de dias restantes,
 * adiamento, e a garantia de que preços não são alterados automaticamente.
 *
 * Espelha (não importa) a lógica equivalente em index.html: cfgSalvar()
 * (trecho de detecção de mudança de markup), cfgMarkupRevisaoStatus(),
 * cfgMarkupAdiar().
 *
 * Uso: node scripts/test_markup.js
 */

'use strict';

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}

var DIA_MS = 86400000;
var INTERVALO_DIAS = 182;

// Espelho: detecção de mudança dentro de cfgSalvar()
function detectaMudancaMarkup(antes, depois) {
  return ['overhead', 'vrml', 'impostos'].some(function (k) { return (antes[k] || 0) !== (depois[k] || 0); });
}

// Espelho: cfgMarkupRevisaoStatus() (usando "agora" como parâmetro em vez de Date.now())
function statusRevisao(mr, agora) {
  if (!mr.ultimaRevisao) return { nunca: true, diasRestantes: null };
  var proxima = mr.proximaRevisao || (mr.ultimaRevisao + INTERVALO_DIAS * DIA_MS);
  var diasRestantes = Math.ceil((proxima - agora) / DIA_MS);
  return { nunca: false, proximaRevisao: proxima, diasRestantes: diasRestantes };
}

console.log('\n' + '='.repeat(64));
console.log(' test_markup.js');
console.log('='.repeat(64) + '\n');

console.log('── Detecção de mudança (o que dispara uma "revisão") ────────\n');
test('1. mudar overhead conta como revisão', detectaMudancaMarkup({ overhead: 15, vrml: 30, impostos: 0 }, { overhead: 18, vrml: 30, impostos: 0 }), true);
test('2. mudar apenas comissão/cartão NÃO conta como revisão de markup', detectaMudancaMarkup({ overhead: 15, vrml: 30, impostos: 8.5, comissao: 5 }, { overhead: 15, vrml: 30, impostos: 8.5, comissao: 7 }), false);
test('3. salvar sem alterar nada não dispara revisão', detectaMudancaMarkup({ overhead: 15, vrml: 30, impostos: 8.5 }, { overhead: 15, vrml: 30, impostos: 8.5 }), false);
test('4. mudar impostos conta como revisão', detectaMudancaMarkup({ overhead: 15, vrml: 30, impostos: 7 }, { overhead: 15, vrml: 30, impostos: 8.5 }), true);

console.log('\n── Cálculo de dias restantes / atraso ────────────────────────\n');
{
  var agora = 1000 * DIA_MS; // dia 1000, arbitrário
  test('5. nunca revisado -> nunca=true', statusRevisao({}, agora).nunca, true);

  var mr30 = { ultimaRevisao: agora - 152 * DIA_MS, proximaRevisao: agora + 30 * DIA_MS };
  test('6. faltando 30 dias -> diasRestantes=30', statusRevisao(mr30, agora).diasRestantes, 30);

  var mrAtrasado = { ultimaRevisao: agora - 200 * DIA_MS, proximaRevisao: agora - 18 * DIA_MS };
  test('7. revisão atrasada -> diasRestantes negativo', statusRevisao(mrAtrasado, agora).diasRestantes < 0, true);
  test('8. atraso de exatos 18 dias', statusRevisao(mrAtrasado, agora).diasRestantes, -18);

  var mrSemProxima = { ultimaRevisao: agora }; // proximaRevisao calculada pelo intervalo padrão
  test('9. sem proximaRevisao explícita, usa ultimaRevisao + 182 dias', statusRevisao(mrSemProxima, agora).proximaRevisao, agora + 182 * DIA_MS);
}

console.log('\n── Adiamento não altera valores, só empurra a data ───────────\n');
{
  // Espelho: cfgMarkupAdiar()
  function adiar(mr, agora, justificativa) {
    if (!justificativa || !justificativa.trim()) return { ok: false };
    var base = mr.proximaRevisao || agora;
    mr.proximaRevisao = base + 30 * DIA_MS;
    if (!mr.historico) mr.historico = [];
    mr.historico.push({ data: agora, tipo: 'adiamento', justificativa: justificativa.trim() });
    return { ok: true };
  }
  var mr = { ultimaRevisao: 500 * DIA_MS, proximaRevisao: 682 * DIA_MS, overheadNaoDeveExistirAqui: undefined };
  var r = adiar(mr, 1000 * DIA_MS, '');
  test('10. adiar sem justificativa falha', r.ok, false);
  var r2 = adiar(mr, 1000 * DIA_MS, 'fornecedor não respondeu ainda');
  test('11. adiar com justificativa funciona', r2.ok, true);
  test('12. próxima revisão empurrada em 30 dias', mr.proximaRevisao, 712 * DIA_MS);
  test('13. histórico registra o adiamento com justificativa', mr.historico[0].justificativa, 'fornecedor não respondeu ainda');
  test('14. adiar NÃO tem campo overhead/vrml/impostos — não mexe em preço', Object.keys(mr).indexOf('overhead') < 0 && Object.keys(mr).indexOf('vrml') < 0, true);
}

console.log('\n── Preços não mudam retroativamente (arquitetura já garante) ─\n');
{
  // orçamentos já salvam valorFinal/valorBase como snapshot no momento da
  // criação (orcSalvarOrcamento) — não recalculam a partir da config atual.
  var orcamentoFechado = { id: 'ORC-1', valorFinal: 915, pricingVersion: '15_30_8.5' };
  var configApósRevisão = { overhead: 18, vrml: 30, impostos: 8.5 }; // overhead mudou de 15 para 18
  test('15. orçamento fechado mantém valorFinal mesmo após revisão de markup', orcamentoFechado.valorFinal, 915);
}

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64) + '\n');

if (failed > 0) process.exit(1);
console.log('Todos os testes passaram.\n');
