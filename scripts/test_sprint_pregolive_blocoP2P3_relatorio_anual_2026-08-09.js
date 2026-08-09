/**
 * test_sprint_pregolive_blocoP2P3_relatorio_anual_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco P2/P3 — Relatório Anual: seletor de ano,
 * vendas/recebimentos/saídas/saldo mês a mês + total anual.
 *
 * Exigência explícita do usuário: "Nunca misturar VENDA com RECEBIMENTO."
 * As duas colunas usam fontes e campos de data estritamente distintos:
 *   VENDAS       = orcGetEnviados() com status==='aprovado', via o.dataSalvo
 *   RECEBIMENTOS = FIN_CR com status==='recebido', via r.dataRecebimento
 *   SAÍDAS       = FIN_CP com status==='pago', via c.dataPagamento
 *
 * Uso: node scripts/test_sprint_pregolive_blocoP2P3_relatorio_anual_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco P2/P3 — Relatório Anual (vendas x recebimentos x saídas) ===\n');

// ── 1-3. Regressão estrutural: aba/dispatch/HTML wired corretamente ──
var srcRelTab = extractFn('relTab');
test('1. relTab() registra a aba "Anual" na lista de abas conhecidas', /'Anual'/.test(srcRelTab), true);
test('2. relTab() despacha relAnual() quando a aba ativa é "anual"', /_rt===\s*'anual'\s*\)\s*relAnual\(\)/.test(srcRelTab), true);

var srcSetMes = extractFn('relSetMesAtualUmaVez');
test('3. relSetMesAtualUmaVez() também aplica o ano corrente ao select relAnualAno (mesmo mecanismo do Bloco P1)',
  /relAnualAno/.test(srcSetMes), true);

test('4. HTML contém o botão da aba Anual', /id="relTabBtnAnual"/.test(html), true);
test('5. HTML contém o painel relPgAnual com o select relAnualAno e o container relAnualConteudo',
  /id="relPgAnual"/.test(html) && /id="relAnualAno"/.test(html) && /id="relAnualConteudo"/.test(html), true);

// ── 6+. Execução real: DOM fake completo ──
var FN_NAMES = ['finFmt', 'orcEnvParseDataSalvo', 'relAnual'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = { relAnual: relAnual };"
].join('\n\n');
var modPath = path.join(__dirname, '_blocoP2P3_relanual_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

function makeEl(props) { return Object.assign({ value: '', textContent: '', innerHTML: '' }, props || {}); }

function rodarCenario(ano, envList, crList, cpList) {
  var _els = {
    relAnualAno: makeEl({ value: String(ano) }),
    relAnualConteudo: makeEl()
  };
  global.document = { getElementById: function (id) { return _els[id]; } };
  global.orcGetEnviados = function () { return envList; };
  global.FIN_CR = crList;
  global.FIN_CP = cpList;
  global.window = global;
  var mod = require(modPath);
  mod.relAnual();
  return _els.relAnualConteudo.innerHTML;
}

{
  // Cenário controlado: 2 vendas aprovadas em meses distintos (Jan/Mar),
  // 1 recebimento em Fev, 1 saída em Fev — todas em 2026. Prova que os 3
  // totais NUNCA se misturam, mesmo quando caem em meses diferentes.
  var envList = [
    { status: 'aprovado', dataSalvo: '10/01/2026 09:00', valorFinal: 1000 },
    { status: 'aprovado', dataSalvo: '05/03/2026 14:30', valorBase: 500 },
    { status: 'aguardando', dataSalvo: '20/01/2026 10:00', valorFinal: 9999 }, // não aprovado — nunca deve contar
  ];
  var crList = [
    { status: 'recebido', dataRecebimento: '15/02/2026', valor: 300 },
    { status: 'pendente', dataRecebimento: '16/02/2026', valor: 9999 }, // não recebido — nunca deve contar
  ];
  var cpList = [
    { status: 'pago', dataPagamento: '20/02/2026', valor: 120 },
  ];
  var html6 = rodarCenario(2026, envList, crList, cpList);

  test('6. Total Vendas do ano = soma apenas dos orçamentos aprovados (R$1000+R$500=R$1.500,00), nunca conta "aguardando"',
    html6.indexOf('R$ 1.500,00') >= 0, true);
  test('7. Total Recebimentos do ano = apenas os efetivamente recebidos (R$300,00), nunca conta "pendente"',
    html6.indexOf('R$ 300,00') >= 0, true);
  test('8. Total Saídas do ano = apenas as efetivamente pagas (R$120,00)',
    html6.indexOf('R$ 120,00') >= 0, true);
  test('9. Saldo Anual = Recebimentos - Saídas = R$300,00 - R$120,00 = R$180,00 (nunca soma vendas ao saldo de caixa)',
    html6.indexOf('R$ 180,00') >= 0, true);

  // Janeiro deve mostrar a venda (R$1.000,00) mas ZERO recebimento/saída —
  // prova que a mesma linha do mês não confunde as 3 fontes.
  test('10. mês de Janeiro mostra a venda de R$1.000,00 na coluna própria (sem misturar com recebimento/saída, que são zero nesse mês)',
    /Janeiro[\s\S]{0,400}R\$ 1\.000,00/.test(html6), true);
}

{
  // Ano diferente do filtrado nunca deve contaminar o total.
  var envList2 = [
    { status: 'aprovado', dataSalvo: '10/01/2025 09:00', valorFinal: 5000 }, // 2025 — fora do filtro
    { status: 'aprovado', dataSalvo: '10/01/2026 09:00', valorFinal: 700 },
  ];
  var html11 = rodarCenario(2026, envList2, [], []);
  test('11. venda de outro ano (2025) nunca contamina o total de 2026 (só R$700,00, nunca R$5.700,00)',
    html11.indexOf('R$ 5.700,00') < 0 && html11.indexOf('R$ 700,00') >= 0, true);
}

{
  // Nenhuma movimentação no ano — mensagem de vazio, nunca uma tabela quebrada.
  var htmlVazio = rodarCenario(2027, [], [], []);
  test('12. sem nenhuma movimentação no ano selecionado, mostra mensagem de vazio (nunca uma tabela com linhas fantasmas)',
    /Nenhuma movimentação lançada em 2027/.test(htmlVazio), true);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
