/**
 * test_sprint_posauditoria_p0_1_revisao_orcamento_2026-08-09.js
 *
 * SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.1 — a auditoria read-only anterior
 * encontrou que, no fluxo VR personalizado, editar o valor de um orçamento
 * já aprovado/com CR/pagamento sobrescrevia silenciosamente valorFinal sem
 * recalcular o saldo do CR já criado, sem exigir nova aprovação e sem
 * deixar nenhuma trilha útil (versoes[] era gravado mas nunca lido).
 *
 * Corrigido: orcAvaliarRevisaoFinanceira() (função pura) decide se uma
 * edição precisa virar uma revisão explícita; _orcSalvarOrcamentoImpl()
 * chama essa função antes de sobrescrever valorFinal/valorBase, bloqueia
 * quando o novo total ficaria menor que o já recebido (nunca estorna
 * automaticamente), e — quando a revisão é aceita — grava uma entrada
 * detalhada em orc.versoes[] (agora exibida no detalhe via
 * orcRenderHistoricoRevisoesHtml()) e devolve o orçamento para
 * status:'aguardando' quando ainda não existe OS gerada (exige nova
 * aprovação comercial). O CR já criado NUNCA é reescrito por esta função
 * — o valor recebido é sempre lido de FIN_CR (relFiscalRecebidoDoOrc),
 * nunca duplicado nem recriado.
 *
 * Uso: node scripts/test_sprint_posauditoria_p0_1_revisao_orcamento_2026-08-09.js
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

console.log('\n=== SPRINT DE CORREÇÃO PÓS-AUDITORIA, P0.1 — Revisão de orçamento VR aprovado/pago ===\n');

// ─────────────────────────────────────────────────────────────────────────
// 1-15. orcAvaliarRevisaoFinanceira() — função pura, cenários do T1
// ─────────────────────────────────────────────────────────────────────────
// HOTFIX BLOCO G (Rodada de Hardening, Fase 2, 2026-08-26) — orcAvaliarRevisaoFinanceira()
// passou a normalizar valorFinal via orcEnvNormalizar() (schema legado ×
// ValerIA), mantendo-se pura. Nunca reimplementada.
var src = [extractFn('orcAvaliarRevisaoFinanceira'), extractFn('orcEnvNormalizar'), 'module.exports = { orcAvaliarRevisaoFinanceira: orcAvaliarRevisaoFinanceira };'].join('\n\n');
var modPath = path.join(__dirname, '_p0_1_revisao_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);
var f = mod.orcAvaliarRevisaoFinanceira;

// Cenário T1.1 — rascunho (sem status/crId): edição livre, nunca vira revisão.
test('1. rascunho (sem aprovação/crId) — editar R$1000→R$1200 NUNCA precisa de revisão',
  f({ status: 'aguardando', valorFinal: 1000 }, 120000, 0).precisaRevisao, false);

// Cenário T1.2 — aprovado, MESMO valor: não é revisão (edição de itens sem mudar preço).
test('2. aprovado, valor final IGUAL — não dispara revisão (só edição de detalhes)',
  f({ status: 'aprovado', crId: 'cr1', valorFinal: 1000 }, 100000, 0).precisaRevisao, false);

// Cenário T1.3 — aprovado, R$0 recebido, muda R$1000→R$1200: revisão simples, sem bloqueio.
{
  var r3 = f({ status: 'aprovado', crId: 'cr1', valorFinal: 1000 }, 120000, 0);
  test('3. aprovado sem nada recebido, R$1000→R$1200 — precisa de revisão', r3.precisaRevisao, true);
  test('3b. ...e não é bloqueada (saldo novo = 1200, nunca negativo)', r3.bloqueado, false);
  test('3c. ...saldoNovoCents = 120000 (nada recebido ainda)', r3.saldoNovoCents, 120000);
}

// Cenário T1.3 exato do enunciado: aprovado R$1000 + CR R$1000 + recebido R$500 → revisão R$1200 → saldo=700.
{
  var r4 = f({ status: 'aprovado', crId: 'cr1', valorFinal: 1000 }, 120000, 50000);
  test('4. R$1000 aprovado, R$500 recebido, revisão para R$1200 — precisa de revisão', r4.precisaRevisao, true);
  test('4b. ...não bloqueada', r4.bloqueado, false);
  test('4c. ...recebido preservado em 500,00 (nunca recriado/alterado)', r4.recebidoCents, 50000);
  test('4d. ...saldo anterior = 500,00 (1000-500)', r4.saldoAnteriorCents, 50000);
  test('4e. ...saldo NOVO = R$700,00 (1200-500) — exatamente o exigido pelo enunciado', r4.saldoNovoCents, 70000);
}

// Cenário T1.4 do enunciado: mesmo cenário, revisão para R$900 → saldo=400.
{
  var r5 = f({ status: 'aprovado', crId: 'cr1', valorFinal: 1000 }, 90000, 50000);
  test('5. R$500 recebido, revisão para R$900 — saldo novo = R$400,00', r5.saldoNovoCents, 40000);
  test('5b. ...não bloqueada (saldo positivo)', r5.bloqueado, false);
}

// Cenário T1.5 do enunciado: recebido R$800, novo total R$700 — NÃO gera saldo negativo silencioso: BLOQUEIA.
{
  var r6 = f({ status: 'aprovado', crId: 'cr1', valorFinal: 1000 }, 70000, 80000);
  test('6. recebido R$800 > novo total R$700 — BLOQUEADO (nunca saldo negativo silencioso)', r6.bloqueado, true);
  test('6b. ...precisaRevisao=true mesmo bloqueado (é uma tentativa de revisão, só que recusada)', r6.precisaRevisao, true);
  test('6c. ...mensagem de bloqueio menciona os dois valores em reais', /R\$ 800,00/.test(r6.motivoBloqueio) && /R\$ 700,00/.test(r6.motivoBloqueio), true);
  test('6d. ...NÃO inventa estorno automático — não devolve nenhum campo "estornoCents"/"creditoCents"', ('estornoCents' in r6) || ('creditoCents' in r6), false);
}

// Fronteira: recebido == novo total → saldo zero, não bloqueado (permitido, saldo apenas some).
test('7. recebido == novo total (saldo zero) — permitido, não bloqueado',
  f({ status: 'aprovado', crId: 'cr1', valorFinal: 1000 }, 80000, 80000).bloqueado, false);

// crId sem status==='aprovado' explícito (defensivo — crId já é evidência de exposição financeira).
test('8. orçamento com crId mas status diferente de "aprovado" — ainda assim precisa de revisão (crId é a evidência real)',
  f({ status: 'aguardando_pagamento', crId: 'cr1', valorFinal: 1000 }, 120000, 0).precisaRevisao, true);

// Centavos exatos — nunca comparação em float direto (0.1+0.2 etc.).
test('9. comparação em centavos inteiros — R$999,99 vs R$999,99 nunca falsamente diverge por float',
  f({ status: 'aprovado', crId: 'cr1', valorFinal: 999.99 }, 99999, 0).precisaRevisao, false);

try { fs.unlinkSync(modPath); } catch (e) {}

// ─────────────────────────────────────────────────────────────────────────
// 10-13. orcRenderHistoricoRevisoesHtml() — histórico deixa de ser trilha morta
// ─────────────────────────────────────────────────────────────────────────
var src2 = [extractFn('orcRenderHistoricoRevisoesHtml'), 'module.exports = { orcRenderHistoricoRevisoesHtml: orcRenderHistoricoRevisoesHtml };'].join('\n\n');
var modPath2 = path.join(__dirname, '_p0_1_historico_extracted.tmp.js');
fs.writeFileSync(modPath2, src2);
delete require.cache[require.resolve(modPath2)];
var render = require(modPath2).orcRenderHistoricoRevisoesHtml;

test('10. sem versoes[] (ou vazio) — não renderiza nada (nunca aparece um bloco vazio confuso)',
  render([]), '');
test('11. sem versoes (undefined) — não quebra, retorna string vazia',
  render(undefined), '');

{
  var versoesFixture = [
    { ts: 1000, usuario: 'v1@vr.com', acao: 'atualizacao', valorFinalAnterior: 900, valorBaseAnterior: 900 },
    { ts: 2000, usuario: 'v2@vr.com', acao: 'revisao_financeira', valorFinalAnterior: 1000, valorBaseAnterior: 1000,
      recebidoNoMomento: 500, saldoAnterior: 500, saldoNovo: 700, motivo: 'Cliente pediu item extra' }
  ];
  var htmlOut = render(versoesFixture);
  test('12. histórico com 2 versões — título mostra a contagem exata (2)', /Histórico de revisões \(2\)/.test(htmlOut), true);
  test('13. entrada de revisão financeira mostra o motivo registrado', htmlOut.indexOf('Cliente pediu item extra') >= 0, true);
  test('14. entrada de revisão financeira mostra o saldo anterior→novo (R$500,00 → R$700,00)', /500,00.*700,00/s.test(htmlOut) || (htmlOut.indexOf('500,00')>=0 && htmlOut.indexOf('700,00')>=0), true);
}
try { fs.unlinkSync(modPath2); } catch (e) {}

// ─────────────────────────────────────────────────────────────────────────
// 15-22. Wiring estrutural: _orcSalvarOrcamentoImpl() usa a função de
// verdade, bloqueia corretamente, exige motivo, nunca reescreve o CR.
// ─────────────────────────────────────────────────────────────────────────
var srcImpl = extractFn('_orcSalvarOrcamentoImpl');
test('15. _orcSalvarOrcamentoImpl() chama orcAvaliarRevisaoFinanceira() antes de montar o objeto orc',
  /orcAvaliarRevisaoFinanceira\(/.test(srcImpl), true);
test('16. usa relFiscalRecebidoDoOrc() como fonte do "recebido" (nunca inventa um valor)',
  /relFiscalRecebidoDoOrc\(/.test(srcImpl), true);
test('17. quando bloqueado, retorna null e nunca chega a montar/salvar o orçamento (return null antes do objeto "orc = {")',
  /_revisaoFin\.bloqueado[\s\S]{0,80}return null/.test(srcImpl), true);
test('18. exige confirm() explícito antes de prosseguir com a revisão',
  /if \(!confirm\(_msgConf\)\) return null/.test(srcImpl), true);
test('19. exige motivo obrigatório (prompt) antes de gravar a revisão',
  /_motivoRevisao[\s\S]{0,200}!_motivoRevisao\.trim\(\)/.test(srcImpl), true);
test('20. quando é revisão financeira, o status volta para "aguardando" SOMENTE se ainda não existe OS (osRef)',
  /if \(!orc\.osRef\) orc\.status = 'aguardando'/.test(srcImpl), true);
test('21. a entrada de versoes[] de uma revisão financeira usa acao:"revisao_financeira" (nunca "atualizacao" genérica)',
  /acao: 'revisao_financeira'/.test(srcImpl), true);
test('22. esta função NUNCA escreve em FIN_CR (o CR já criado é só lido via relFiscalRecebidoDoOrc, nunca sobrescrito/recriado aqui)',
  /FIN_CR\s*(\.unshift|\.push|\[)/.test(srcImpl), false);
test('23. edição continua passando por orcSetEnviados()/_cloudSave (herda proteção de conflito real entre duas abas — já testada em test_cloudsave_concorrencia.js)',
  /orcSetEnviados\(lista\)/.test(srcImpl), true);

// ─────────────────────────────────────────────────────────────────────────
// 24. orcEnvAbrir() efetivamente exibe o histórico no detalhe (não é mais
// uma trilha gravada e nunca lida — achado central da auditoria).
// ─────────────────────────────────────────────────────────────────────────
var srcAbrir = extractFn('orcEnvAbrir');
test('24. orcEnvAbrir() chama orcRenderHistoricoRevisoesHtml(o.versoes) — histórico deixou de ser trilha morta',
  /orcRenderHistoricoRevisoesHtml\(o\.versoes\)/.test(srcAbrir), true);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
