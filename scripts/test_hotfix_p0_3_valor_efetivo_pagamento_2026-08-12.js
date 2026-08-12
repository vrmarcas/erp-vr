/**
 * test_hotfix_p0_3_valor_efetivo_pagamento_2026-08-12.js
 *
 * HOTFIX OPERACIONAL PÓS-GO-LIVE 2026-08-12, P0.3 — achado real: o modal
 * de "Confirmar Pagamento" sempre usava o.valorFinal (preço Cartão) como
 * base para Integral/50-50/Entrada, mesmo quando o vendedor selecionava
 * PIX/Dinheiro (que têm um valor MENOR, com o desconto PIX aplicado) —
 * exemplo real do usuário: Cartão R$42,60, PIX R$40,41; selecionar PIX +
 * 50/50 calculava sobre R$42,60 (errado, R$21,30) em vez de R$40,41
 * (correto, R$20,21+R$20,20). Corrigido com uma função canônica única
 * (orcValorEfetivoPorForma) consumida por todo o fluxo de pagamento —
 * Cartão sempre o preço cheio, PIX/Dinheiro sempre com o desconto salvo
 * no orçamento (o.descPix) aplicado.
 *
 * Também cobre: bloco "Recibo de Entrada/Sinal" (simulação duplicada)
 * removido da Etapa 4/5 pré-confirmação; "A Receber" nunca cria FIN_TX
 * mas mantém/atualiza o CR vinculado à OS.
 *
 * Uso: node scripts/test_hotfix_p0_3_valor_efetivo_pagamento_2026-08-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

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

console.log('\n=== HOTFIX P0.3 — Valor efetivo por forma de pagamento, sem divergência ===\n');

// ── 1. Bloco "Recibo de Entrada / Sinal" (simulação) removido da Etapa 5 ──
ok('1a. id="orcEntradaValor" (simulação de entrada) não existe mais no HTML', !/id="orcEntradaValor"/.test(html));
ok('1b. id="orcEntradaResto" (restante simulado) não existe mais no HTML', !/id="orcEntradaResto"/.test(html));

// ── 2. orcValorEfetivoPorForma(): Cartão = valorFinal cheio; PIX/Dinheiro = com desconto salvo ──
{
  var fnSrc = extractFn('orcValorEfetivoPorForma');
  var src = fnSrc + '\nmodule.exports = { orcValorEfetivoPorForma: orcValorEfetivoPorForma };';
  var modPath = path.join(__dirname, '_p0_3_valor_efetivo_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // Fixture EXATA do worked example do usuário: Cartão R$42,60, PIX R$40,41 (desconto ≈5,14%).
  var o = { valorFinal: 42.60, descPix: 5.14 };

  ok('2a. Cartão de Crédito usa o valor cheio (R$42,60)', Math.abs(mod.orcValorEfetivoPorForma(o, 'Cartão de Crédito') - 42.60) < 0.005);
  ok('2b. Cartão de Débito também usa o valor cheio (R$42,60)', Math.abs(mod.orcValorEfetivoPorForma(o, 'Cartão de Débito') - 42.60) < 0.005);
  ok('2c. PIX usa o valor com desconto — R$40,41, NUNCA R$42,60', Math.abs(mod.orcValorEfetivoPorForma(o, 'PIX') - 40.41) < 0.01);
  ok('2d. Dinheiro usa o MESMO valor do PIX (regra já aprovada) — R$40,41', Math.abs(mod.orcValorEfetivoPorForma(o, 'Dinheiro') - 40.41) < 0.01);
  ok('2e. Boleto/Transferência (nenhum desconto definido) caem no valor cheio', Math.abs(mod.orcValorEfetivoPorForma(o, 'Boleto') - 42.60) < 0.005);

  try { fs.unlinkSync(modPath); } catch (e) {}
}

// ── 3. HOTFIX P0.3/P0.4 (unificação da Etapa 4) — o valor efetivo é
// confirmado UMA única vez (orcConfirmarPagamentoWizard, a partir de
// window._orcPgtoValorEfetivo — a mesma fonte canônica de "Valor a
// Receber") e persistido em o.pgtoConfirmado.valorEfetivo; orcEnvGerarOS()
// nunca recalcula esse valor de novo — só lê o que já foi confirmado. ──
{
  var confirmarSrc = extractFn('orcConfirmarPagamentoWizard');
  ok('3a. orcConfirmarPagamentoWizard() lê o valor efetivo de window._orcPgtoValorEfetivo (fonte única, nunca um cálculo próprio)', /window\._orcPgtoValorEfetivo/.test(confirmarSrc));
  ok('3b. orcConfirmarPagamentoWizard() não usa mais "o.valorFinal" direto para a base do cálculo', !/o\.valorFinal/.test(confirmarSrc));

  var gerarOSSrc = extractFn('orcEnvGerarOS');
  ok('3c. orcEnvGerarOS() (o que é REALMENTE gravado na OS/CR) lê o valor já confirmado em o.pgtoConfirmado.valorEfetivo — nunca recalcula', /var valorTotal=Math\.round\(\(o\.pgtoConfirmado\.valorEfetivo\|\|0\)\*100\)\/100;/.test(gerarOSSrc));
  ok('3d. orcEnvGerarOS() não chama mais orcValorEfetivoPorForma nem lê "o.valorFinal" direto para o total', !/orcValorEfetivoPorForma/.test(gerarOSSrc) && !/var valorTotal=Math\.round\(\(o\.valorFinal\|\|0\)\*100\)\/100;/.test(gerarOSSrc));
  ok('3e. Confirmar Pagamento e Gerar OS são ações SEPARADAS: orcEnvGerarOS() nunca CHAMA orcRegistrarSituacaoFinanceira (menções em comentário são só explicação, não invocação)', !/[=(]\s*orcRegistrarSituacaoFinanceira\(/.test(gerarOSSrc) && !/await orcRegistrarSituacaoFinanceira/.test(gerarOSSrc));
  ok('3f. Gerar OS só prossegue se a situação financeira já foi confirmada (gate em o.pgtoConfirmado)', /if\(!o\.pgtoConfirmado\)\{/.test(gerarOSSrc));
}

// ── 4. "A Receber" (tipo=futuro): nunca gera FIN_TX na Confirmação; o CR é
// registrado/corrigido lá e só VINCULADO à OS (nunca recriado) quando
// Gerar OS roda depois ──
{
  var registrarSrc = extractFn('orcRegistrarSituacaoFinanceira');
  ok('4a. orcRegistrarSituacaoFinanceira(): tipo="futuro" sem dinheiro real nunca cria FIN_TX (0 recibo)', /\}\s*else if\(tipo==='futuro'\)\{/.test(registrarSrc));
  ok('4b. orcRegistrarSituacaoFinanceira(): CR de "A Receber" é registrado com o valor EFETIVO já confirmado, nunca preso na estimativa de aprovação', /arrCR\[crIdx\]\.valor = valorTotal;/.test(registrarSrc));

  var gerarOSSrc = extractFn('orcEnvGerarOS');
  ok('4c. orcEnvGerarOS() generaliza o vínculo: todo CR deste orçamento sem osId (independente do tipo) é vinculado à OS recém-criada, nunca recriado', /FIN_CR\.forEach\(function\(c\)\{ if\(c\.orcamentoId===o\.id && !c\.osId\)/.test(gerarOSSrc));
  ok('4d. mesmo tratamento no caminho transacional real (dentro da MESMA transação que cria a OS)', /arrCR\.forEach\(function\(c\)\{ if\(c\.orcamentoId===o\.id && !c\.osId\)/.test(gerarOSSrc));
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
