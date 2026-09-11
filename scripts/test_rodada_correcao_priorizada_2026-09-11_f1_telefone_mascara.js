/**
 * test_rodada_correcao_priorizada_2026-09-11_f1_telefone_mascara.js
 *
 * RODADA DE CORREÇÃO PRIORIZADA (2026-09-11) — F1 (P2), achado da
 * auditoria funcional de produção: o campo "WhatsApp / Telefone" (Novo
 * Orçamento > Cliente) aceitava e salvava o valor cru digitado (ex.:
 * "62999990001"), sem nenhuma máscara — mesmo com o placeholder
 * sugerindo "(62) 99999-9999". Confirmado que o valor cru persistia no
 * orçamento salvo (Telefone: 62999990001).
 *
 * INVESTIGAÇÃO (antes de corrigir): o dedupe de cliente por telefone
 * (orcAutoSalvarCliente/orcLinkClienteOrcamento/_crmBuscarClienteDuplicado)
 * JÁ normaliza com `.replace(/\D/g,'')` antes de comparar — ou seja, já é
 * "digit-safe" independente de máscara. O que faltava era só a
 * FORMATAÇÃO VISUAL exibida/salva no campo em si.
 *
 * FIX: orcMascararTelefoneInput(el) formata o campo em tempo real
 * (oninput) — 10 dígitos → "(XX) XXXX-XXXX", 11 dígitos →
 * "(XX) XXXXX-XXXX" — aplicado aos 4 pontos de entrada de telefone de
 * cliente/lead: orcClientTel (Novo Orçamento VR), vitreOrcClienteTel
 * (Novo Orçamento Vitre), nlTel (Novo Lead CRM), cliNovoTel (Novo
 * Cliente). Puramente visual — nunca deleta dígitos digitados, nunca
 * trava a digitação, nunca é a fonte de verdade para dedupe (que
 * continua via `.replace(/\D/g,'')`, já correto).
 *
 * Uso: node scripts/test_rodada_correcao_priorizada_2026-09-11_f1_telefone_mascara.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

const src = [extractFn('orcMascararTelefoneInput'), 'module.exports = { orcMascararTelefoneInput: orcMascararTelefoneInput };'].join('\n\n');
const modPath = path.join(__dirname, '_f1_telefone_mascara_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
const mod = require(modPath);

console.log('\n=== RODADA DE CORREÇÃO PRIORIZADA 2026-09-11 — F1: máscara de telefone ===\n');

function mascarar(valorDigitado) {
  const el = { value: valorDigitado };
  mod.orcMascararTelefoneInput(el);
  return el.value;
}

// ══════════════════════════════════════════════════════════════════════
// Digitação crua (cenário exato da auditoria) — celular (11 dígitos) e
// fixo (10 dígitos).
// ══════════════════════════════════════════════════════════════════════
ok('F1 — celular cru "62999990001" vira "(62) 99999-0001"', mascarar('62999990001') === '(62) 99999-0001');
ok('F1 — fixo cru "6233221100" vira "(62) 3322-1100"', mascarar('6233221100') === '(62) 3322-1100');

// ══════════════════════════════════════════════════════════════════════
// Já formatado (usuário cola um número já mascarado) — idempotente, não
// quebra nem duplica parênteses/traços.
// ══════════════════════════════════════════════════════════════════════
ok('F1 — já formatado "(62) 99999-0001" continua "(62) 99999-0001"', mascarar('(62) 99999-0001') === '(62) 99999-0001');

// ══════════════════════════════════════════════════════════════════════
// Com +55 — DDI é removido da máscara exibida (mesmo padrão do
// placeholder, que não mostra DDI), nunca duplicado.
// ══════════════════════════════════════════════════════════════════════
ok('F1 — com DDI "+55 62 99999-0001" mostra só "(62) 99999-0001" (sem DDI duplicado)', mascarar('+55 62 99999-0001') === '(62) 99999-0001');
ok('F1 — DDI cru "5562999990001" mostra "(62) 99999-0001"', mascarar('5562999990001') === '(62) 99999-0001');

// ══════════════════════════════════════════════════════════════════════
// Digitação incremental — a cada tecla, nunca trava/quebra (simula o
// usuário digitando dígito a dígito, oninput a cada tecla).
// ══════════════════════════════════════════════════════════════════════
{
  const digitos = '62999990001'.split('');
  let valorAtual = '';
  let quebrou = false;
  digitos.forEach(function (d) {
    const el = { value: valorAtual + d };
    mod.orcMascararTelefoneInput(el);
    valorAtual = el.value;
    if (valorAtual == null) quebrou = true;
  });
  ok('F1 — digitação incremental tecla a tecla nunca quebra/limpa o campo', !quebrou && valorAtual === '(62) 99999-0001');
}

// ══════════════════════════════════════════════════════════════════════
// Nunca trunca/perde dígitos que o usuário digitou de fato — mesmo além
// do que a máscara sabe formatar (ex.: número internacional/errado
// digitado por engano), o dado não desaparece silenciosamente.
// ══════════════════════════════════════════════════════════════════════
ok('F1 — excesso de dígitos (13) não é apagado silenciosamente', mascarar('1234567890123').replace(/\D/g, '').length >= 11);

// ══════════════════════════════════════════════════════════════════════
// Vazio/parcial — nunca lança exceção, nunca produz "(NaN)" ou similar.
// ══════════════════════════════════════════════════════════════════════
ok('F1 — campo vazio não quebra e não produz lixo', mascarar('') === '');
ok('F1 — só DDD parcial "6" produz "(6" (nunca trava a digitação)', mascarar('6') === '(6');
ok('F1 — DDD completo "62" produz "(62" (parêntese fecha só a partir do 3º dígito)', mascarar('62') === '(62');
ok('F1 — DDD + 1º dígito "629" produz "(62) 9"', mascarar('629') === '(62) 9');

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '─'.repeat(60));
console.log('TOTAL: ' + (passed + failed) + '  ✅ ' + passed + '  ❌ ' + failed);
console.log('─'.repeat(60) + '\n');
process.exit(failed > 0 ? 1 : 0);
