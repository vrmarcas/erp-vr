/**
 * test_hotfix_orc_financeiro_real_recebido_pix_2026-08-16.js
 *
 * HOTFIX 2026-08-16 — smoke financeiro real da rodada Kanban/OS/Financeiro
 * encontrou um achado real no modal de detalhe de "Orçamentos Enviados":
 * o card "Recebido" (orcFinanceiroReal) calculava
 *   recebidoCents = totalCents(o.valorFinal — preço "de cartão" congelado
 *                    no orçamento) − saldoCents(osFin.restante — já na
 *                    base do pagamento REAL registrado na OS)
 * Sempre que o cliente pagava por um método com desconto (ex.: PIX 5,14%),
 * o.valorFinal (preço-cartão) ficava MAIOR que o valor realmente cobrado
 * (osFin.valor/totalGeral), e a subtração usava bases diferentes — o card
 * mostrava um "Recebido" inflado exatamente pela diferença do desconto,
 * mesmo com o histórico de recebimentos (FIN_CR) mostrando corretamente
 * só o valor real recebido.
 *
 * Reproduzido em produção real (fixture E2E_GOLIVE_SMOKE_20260816,
 * orçamento #000035): valorFinal (cartão) R$123,04, pagamento real via
 * PIX R$116,72 (entrada 50% = R$58,36, saldo 50% = R$58,36) — o card
 * mostrava "Recebido: R$64,68" (deveria ser R$58,36 — a diferença de
 * R$6,32 é exatamente o desconto PIX de 5,14% sobre R$123,04).
 *
 * Corrigido fazendo totalCents usar a MESMA base de osFin (osFin.valor/
 * totalGeral) que já alimenta o saldo, sempre que a OS existe — nunca
 * mais misturar o preço-cartão do orçamento com o saldo real da OS.
 *
 * Uso: node scripts/test_hotfix_orc_financeiro_real_recebido_pix_2026-08-16.js
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
var FN_NAMES = ['orcFinanceiroReal', 'orcCondicaoPagamentoAtual', 'orcCondicaoLabelPorTipo', 'moneyToCents', 'orcEnvParseDataSalvo', 'orcEnvNormalizar'];
var src = [
  "var KB_OS = null; var FIN_CR = [];",
  "function fmtV(){ return ''; }",
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcFinanceiroReal: orcFinanceiroReal, setKB_OS: function(v){ KB_OS = v; }, setFIN_CR: function(v){ FIN_CR = v; } };',
].join('\n\n');
var modPath = path.join(__dirname, '_orc_financeiro_real_pix_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== HOTFIX — orcFinanceiroReal(): Recebido não infla com desconto PIX ===\n');

// ── Cenário real reproduzido: fixture E2E_GOLIVE_SMOKE_20260816 #000035 ──
{
  var osFin = {
    valor: 116.72,       // total REAL cobrado (já com desconto PIX 5.14% sobre 123.04)
    totalGeral: 116.72,
    restante: 58.36,      // saldo pendente (50% de 116.72)
    pagtoTipo: '50-50',
    formaPgto: 'pix',
  };
  mod.setKB_OS({ 'os16': osFin });
  mod.setFIN_CR([
    { status: 'recebido', orcamentoId: 'orc35', osId: 'os16', valor: 58.36, dataRecebimento: '16/08/2026', metodo: 'pix' },
    { status: 'pendente', orcamentoId: 'orc35', osId: 'os16', valor: 58.36, dataRecebimento: null, metodo: 'pix' },
  ]);
  var orc = { id: 'orc35', osRef: 'os16', valorFinal: 123.04 }; // preço "de cartão" congelado no orçamento

  var fin = mod.orcFinanceiroReal(orc);
  test('1. achado real corrigido: Recebido = R$58,36 (valor real do FIN_CR), não R$64,68 (inflado pelo desconto PIX)', fin.recebidoCents, 5836);
  test('2. Valor contratado agora usa a mesma base do saldo (osFin.valor=116,72), não o preço-cartão do orçamento (123,04)', fin.totalCents, 11672);
  test('3. Saldo continua vindo de osFin.restante, inalterado', fin.saldoCents, 5836);
  test('4. Identidade financeira sempre válida: recebido + saldo === total', fin.recebidoCents + fin.saldoCents, fin.totalCents);
  test('5. Recebido bate exatamente com a soma do histórico real (FIN_CR recebido) — nunca um cálculo paralelo', fin.recebidoCents, fin.historico.reduce(function (s, h) { return s + h.valorCents; }, 0));
  test('6. Histórico mostra exatamente 1 recebimento de R$58,36 (nunca duplicado)', fin.historico.map(function (h) { return h.valorCents; }), [5836]);
}

// ── Cenário de controle: pagamento via cartão (sem desconto) — total bate igual antes/depois ──
{
  var osFinCartao = { valor: 123.04, totalGeral: 123.04, restante: 61.52, pagtoTipo: '50-50', formaPgto: 'cartao' };
  mod.setKB_OS({ 'os20': osFinCartao });
  mod.setFIN_CR([
    { status: 'recebido', orcamentoId: 'orc40', osId: 'os20', valor: 61.52, dataRecebimento: '10/08/2026', metodo: 'cartao' },
  ]);
  var orc2 = { id: 'orc40', osRef: 'os20', valorFinal: 123.04 };
  var fin2 = mod.orcFinanceiroReal(orc2);
  test('7. controle — sem desconto (cartão), Recebido continua correto (R$61,52) — a correção não quebra o caso já funcional', fin2.recebidoCents, 6152);
  test('8. controle — Valor contratado = R$123,04 (osFin.valor === o.valorFinal, nenhuma divergência aqui)', fin2.totalCents, 12304);
}

// ── Cenário sem OS ainda (orçamento aguardando) — nada foi recebido ──
{
  mod.setKB_OS({});
  mod.setFIN_CR([]);
  var orc3 = { id: 'orc50', osRef: null, valorFinal: 200 };
  var fin3 = mod.orcFinanceiroReal(orc3);
  test('9. sem OS vinculada: Recebido=0, Saldo=Total (comportamento pré-OS inalterado)', { r: fin3.recebidoCents, s: fin3.saldoCents, t: fin3.totalCents }, { r: 0, s: 20000, t: 20000 });
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
