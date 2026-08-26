/**
 * test_hotfix_pagamentos_p0_1_7_condicao_vendedor_2026-08-10.js
 *
 * HOTFIX PÓS-HOMOLOGAÇÃO — Pagamentos/Saldo/Entrega de OS, P0.1-P0.7.
 *
 * Bug real em produção: PDF/WhatsApp/detalhe de Orçamentos Enviados
 * mostravam "Forma de Pagamento: PIX (100%)" para praticamente todo
 * orçamento novo — causa raiz confirmada por grep: o <select
 * id="orcFormaPgto"> oculto nunca é escrito por nenhuma tela ("Step 5"
 * citado em comentário antigo não existe mais), então sempre ficava na
 * 1ª <option>, "PIX (100%)". Também: "Vendedor: —"/"Equipe VR Marcas"
 * apesar de vendedor real cadastrado (DOM vazio sobrescrevendo o valor
 * já salvo); e o detalhe de Orçamentos Enviados nunca mostrava
 * total/recebido/saldo reais (só o texto morto o.pgto).
 *
 * Corrigido: orcCondicaoLabelPorTipo/orcCondicaoPagamentoAtual (condição
 * REAL — confirmada em kb_os_fin.pagtoTipo quando já há OS, senão o
 * padrão comercial 50/50 — nunca o select morto); orcGetResponsavel
 * agora aceita o documento salvo como fonte preferencial; o save nunca
 * mais apaga um vendedor já persistido com uma leitura vazia do DOM;
 * orcFinanceiroReal lê KB_OS/kb_os_fin + FIN_CR (histórico de
 * recebimentos), nunca inventa nem duplica uma fonte nova.
 *
 * Uso: node scripts/test_hotfix_pagamentos_p0_1_7_condicao_vendedor_2026-08-10.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

// HOTFIX BLOCO G (Rodada de Hardening, Fase 2, 2026-08-26) — orcFinanceiroReal()
// passou a normalizar valorFinal via orcEnvNormalizar() (schema legado ×
// ValerIA), nunca reimplementada.
var FN_NAMES = [
  'moneyToCents', 'centsToMoney', 'sumCents',
  'orcCondicaoLabelPorTipo', 'orcCondicaoPagamentoAtual', 'orcFinanceiroReal',
  'orcEnvParseDataSalvo', 'orcGetResponsavel', 'orcEnvNormalizar',
];
var src = [
  'var KB_OS = {}; var FIN_CR = [];',
  'var document = { getElementById: function(){ return null; } };',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  condicaoLabelPorTipo: orcCondicaoLabelPorTipo,',
  '  condicaoPagamentoAtual: orcCondicaoPagamentoAtual,',
  '  financeiroReal: orcFinanceiroReal,',
  '  getResponsavel: orcGetResponsavel,',
  '  setKBOS: function(v){ KB_OS = v; }, setFinCR: function(v){ FIN_CR = v; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_pgto_p0_1_7_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== HOTFIX PAGAMENTOS/SALDO/ENTREGA — P0.1-P0.7: condição × forma, vendedor, financeiro real ===\n');

// ─────────────────────────────────────────────────────────────────────────
// 1-6. orcCondicaoLabelPorTipo — nunca "PIX (100%)" como padrão implícito
// ─────────────────────────────────────────────────────────────────────────
test('1. tipo "50-50" (padrão comercial) — texto correto, nunca menciona PIX/100%',
  mod.condicaoLabelPorTipo('50-50'), '50% no pedido e 50% na retirada do material');
test('2. tipo desconhecido/ausente cai no padrão 50/50 (nunca "PIX 100%")',
  mod.condicaoLabelPorTipo(undefined), '50% no pedido e 50% na retirada do material');
test('3. tipo "integral" + forma PIX — só ENTÃO diz "à vista via PIX" (escolha explícita)',
  mod.condicaoLabelPorTipo('integral', 'PIX'), 'Pagamento integral à vista via PIX');
test('4. tipo "integral" + forma Cartão — nunca menciona PIX',
  mod.condicaoLabelPorTipo('integral', 'Cartão de Crédito'), 'Pagamento integral no pedido');
test('5. tipo "parcial" — texto de entrada+retirada, nunca "PIX (100%)"',
  mod.condicaoLabelPorTipo('parcial'), 'Entrada no pedido e restante na retirada do material');
test('6. tipo "futuro" — "a combinar", nunca inventa forma/condição',
  mod.condicaoLabelPorTipo('futuro'), 'A combinar — sem pagamento registrado no pedido');

// ─────────────────────────────────────────────────────────────────────────
// 7-9. orcCondicaoPagamentoAtual — fonte real (kb_os_fin) x padrão
// ─────────────────────────────────────────────────────────────────────────
mod.setKBOS({});
test('7. orçamento SEM OS ainda — condição = padrão comercial 50/50 (nunca "PIX 100%")',
  mod.condicaoPagamentoAtual({ id: 'orc1' }), '50% no pedido e 50% na retirada do material');

mod.setKBOS({ os1: { pagtoTipo: 'integral', formaPgto: 'PIX' } });
test('8. orçamento COM OS + pagamento confirmado integral/PIX — condição REAL, não o padrão',
  mod.condicaoPagamentoAtual({ id: 'orc1', osRef: 'os1' }), 'Pagamento integral à vista via PIX');

mod.setKBOS({ os2: { pagtoTipo: '50-50', formaPgto: 'PIX' } });
test('9. orçamento COM OS confirmada 50/50 — mesma condição, texto correto',
  mod.condicaoPagamentoAtual({ id: 'orc2', osRef: 'os2' }), '50% no pedido e 50% na retirada do material');

// ─────────────────────────────────────────────────────────────────────────
// 10-12. orcGetResponsavel — nunca "Equipe X" quando há vendedor salvo
// ─────────────────────────────────────────────────────────────────────────
test('10. docSalvo.vendedor presente — usa o vendedor real, nunca "Equipe X"',
  mod.getResponsavel('VR Marcas', { vendedor: 'Cleiton Gomes' }), 'Cleiton Gomes');
test('11. docSalvo ausente e DOM vazio (mock) — cai no fallback "Equipe X"',
  mod.getResponsavel('VR Marcas', null), 'Equipe VR Marcas');
test('12. docSalvo.vendedor === "—" (placeholder) — tratado como ausente, cai no fallback',
  mod.getResponsavel('Vitre', { vendedor: '—' }), 'Equipe Vitre');

// ─────────────────────────────────────────────────────────────────────────
// 13-18. orcFinanceiroReal — total/recebido/saldo/histórico (T4, P0.5-P0.7)
// ─────────────────────────────────────────────────────────────────────────
(function () {
  mod.setKBOS({});
  mod.setFinCR([]);
  var orcSemOS = { id: 'orcA', valorFinal: 131.82 };
  var r = mod.financeiroReal(orcSemOS);
  test('13. sem OS ainda — nada recebido, saldo = total (nunca inventa recebimento)',
    [r.totalCents, r.recebidoCents, r.saldoCents], [13182, 0, 13182]);
  test('13b. sem OS ainda — histórico vazio (nenhum recebimento inventado)', r.historico.length, 0);
})();

(function () {
  // Cenário real do bug reportado: total 131,82 — entrada 100,00 (PIX) —
  // saldo 31,82 pendente. Entrada já recebida NUNCA pode desaparecer.
  mod.setKBOS({ osB: { restante: 31.82 } });
  mod.setFinCR([
    { id: 'cr1', orcamentoId: 'orcB', osId: 'osB', status: 'recebido', valor: 100.00, metodo: 'PIX', dataRecebimento: '10/08/2026' },
    { id: 'cr2', orcamentoId: 'orcB', osId: 'osB', status: 'pendente', valor: 31.82, metodo: 'PIX', dataRecebimento: null },
  ]);
  var orcComOS = { id: 'orcB', osRef: 'osB', valorFinal: 131.82 };
  var r = mod.financeiroReal(orcComOS);
  test('14. entrada R$100 + saldo R$31,82 — total/recebido/saldo batem exatamente com o cenário real do bug',
    [r.totalCents, r.recebidoCents, r.saldoCents], [13182, 10000, 3182]);
  test('15. histórico mostra a entrada já recebida (nunca some ao reabrir)',
    r.historico.length, 1);
  test('15b. histórico traz Data/Valor/Forma corretos da entrada',
    [r.historico[0].data, r.historico[0].valorCents, r.historico[0].forma], ['10/08/2026', 10000, 'PIX']);

  // Depois de quitar o saldo (kbReceberSaldo/registrar pagamento) — a
  // entrada original PERMANECE no histórico, um SEGUNDO recebimento
  // aparece, nunca um único pagamento de R$131,82 substituindo tudo.
  mod.setKBOS({ osB: { restante: 0 } });
  mod.setFinCR([
    { id: 'cr1', orcamentoId: 'orcB', osId: 'osB', status: 'recebido', valor: 100.00, metodo: 'PIX', dataRecebimento: '10/08/2026' },
    { id: 'cr2', orcamentoId: 'orcB', osId: 'osB', status: 'recebido', valor: 31.82, metodo: 'PIX', dataRecebimento: '15/08/2026' },
  ]);
  var r2 = mod.financeiroReal(orcComOS);
  test('16. após quitação — saldo zerado, recebido = total exato',
    [r2.recebidoCents, r2.saldoCents], [13182, 0]);
  test('17. após quitação — histórico tem OS DOIS recebimentos (entrada preservada + saldo novo, nunca 1 só)',
    r2.historico.length, 2);
  test('17b. histórico ordenado por data (entrada antes do saldo)',
    r2.historico.map(function(h){return h.valorCents;}), [10000, 3182]);
})();

(function () {
  // Formas diferentes por recebimento (T11 do hotfix): entrada PIX,
  // saldo Cartão de Débito — nunca um único campo "forma" da venda toda.
  mod.setKBOS({ osC: { restante: 0 } });
  mod.setFinCR([
    { id: 'cr1', orcamentoId: 'orcC', osId: 'osC', status: 'recebido', valor: 500, metodo: 'PIX', dataRecebimento: '01/08/2026' },
    { id: 'cr2', orcamentoId: 'orcC', osId: 'osC', status: 'recebido', valor: 500, metodo: 'Cartão de Débito', dataRecebimento: '05/08/2026' },
  ]);
  var r = mod.financeiroReal({ id: 'orcC', osRef: 'osC', valorFinal: 1000 });
  test('18. formas diferentes por recebimento (PIX + Cartão de Débito) preservadas separadamente no histórico',
    r.historico.map(function(h){return h.forma;}), ['PIX', 'Cartão de Débito']);
})();

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
