/**
 * test_orc_status_operacional_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 17-20 — bug real reproduzido em
 * produção (Orçamento #000018): já com entrada recebida (R$83,08) e OS
 * #8 gerada, a listagem "Orçamentos Enviados" e o detalhe do orçamento
 * mostravam "Aguard. Pagamento" (e, no detalhe, o enum cru
 * "aguardando_pagamento", sem nem passar por um mapa de rótulos).
 *
 * Causa raiz: `o.status = restante>0 ? 'aguardando_pagamento' : 'pago'`
 * era executado no momento de GERAR A OS — reusando um valor que
 * originalmente significa "cliente aprovou mas não pagou nada" para
 * representar "OS já gerada, só falta o saldo (fluxo normal 50/50)".
 * Status operacional/comercial estava misturado com status financeiro.
 *
 * Corrigido: a geração da OS sempre marca o.status='enviado_producao',
 * nunca mais 'aguardando_pagamento'/'pago' nesse momento. Uma fonte
 * única de rótulo/cor (orcStatusLabel/orcStatusCor) substitui as 3 cópias
 * divergentes do mapa (uma delas nem existia — texto cru no detalhe).
 *
 * Uso: node scripts/test_orc_status_operacional_2026-08-12.js
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
function extractVar(name) {
  var marker = 'var ' + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 2); // inclui o ';' logo após o '}'
}

console.log('\n=== Status do orçamento: nunca mais "Aguardando Pagamento" com OS já gerada ===\n');

// ── 1. Fonte única de rótulo/cor — função pura ────────────────────────
(function () {
  var src = [ extractVar('ORC_STATUS_LABEL'), extractVar('ORC_STATUS_COLOR'), extractFn('orcStatusLabel'), extractFn('orcStatusCor'),
    'module.exports = { label: orcStatusLabel, cor: orcStatusCor };' ].join('\n\n');
  var modPath = path.join(__dirname, '_orc_status_label.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  test('1a. status "enviado_producao" (OS gerada, saldo pendente ou não) → rótulo correto', mod.label('enviado_producao'), '🏭 Enviado p/ Produção');
  test('1b. nunca mostra "Aguard. Pagamento" para OS já gerada', /Aguard/.test(mod.label('enviado_producao')), false);
  test('1c. status "aguardando" (recém-salvo) → Aguardando Cliente', mod.label('aguardando'), '⏳ Aguardando Cliente');
  test('1d. legado "aguardando_pagamento" persistido antes desta correção → cai no rótulo correto (nunca enum cru)', mod.label('aguardando_pagamento'), '🏭 Enviado p/ Produção');
  test('1e. legado "pago" persistido antes desta correção → mesmo rótulo (nunca regride pra "Pago" isolado sem contexto operacional)', mod.label('pago'), '🏭 Enviado p/ Produção');
  test('1f. status desconhecido → nunca quebra, devolve o próprio valor (nunca undefined)', mod.label('xyz'), 'xyz');
  test('1g. cor de "enviado_producao" é uma cor válida (não o cinza genérico de fallback)', mod.cor('enviado_producao') !== '#9CA3AF', true);

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── 2. Código-fonte: os 2 pontos de geração de OS nunca mais escrevem 'aguardando_pagamento'/'pago' ──
(function () {
  var bugPattern = "status = restante>0 ? 'aguardando_pagamento' : 'pago'";
  test('2a. padrão do bug (status = restante>0 ? aguardando_pagamento : pago) não existe mais no código-fonte', html.indexOf(bugPattern) >= 0, false);
  test('2b. caminho fallback local usa o.status = \'enviado_producao\' na geração da OS', /o\.status = 'enviado_producao';/.test(html), true);
  test('2c. caminho transacional real usa arrOrc[idxOrc].status = \'enviado_producao\' na geração da OS', /arrOrc\[idxOrc\]\.status = 'enviado_producao';/.test(html), true);
})();

// ── 3. Listagem e detalhe usam a fonte única (nunca mais texto cru nem cópias divergentes) ──
(function () {
  test('3a. detalhe do orçamento (Status:) usa orcStatusLabel — nunca mais o.status cru', html.indexOf("orcStatusLabel(o.status)") >= 0, true);
  test('3b. listagem usa orcStatusCor/orcStatusLabel (fonte única), não um mapa local duplicado', /orcStatusCor\(o\.status\)\+'22;color:'\+orcStatusCor\(o\.status\)\+'">'\+orcStatusLabel\(o\.status\)/.test(html), true);
})();

// ── 4. Seção 20 — sincronização entre telas: Kanban avança, orçamento acompanha ──
(function () {
  test('4a. kbIniciarProd (retomada) sincroniza orçamento para em_producao', /os\.status = 'producao';[\s\S]{0,300}?orcEnvSetStatus\(os\.orcRef, 'em_producao'\)/.test(html), true);
  test('4b. kbMarcarPronto sincroniza orçamento para pronto (só no sucesso confirmado, nunca otimista)', /if\(ok\)\{[\s\S]{0,600}?orcEnvSetStatus\(os\.orcRef, 'pronto'\)/.test(html), true);
  test('4c. osLiberar sincroniza orçamento para entregue (só no sucesso confirmado)', /if\(ok && os\.orcRef.*orcEnvSetStatus\(os\.orcRef, 'entregue'\)/.test(html), true);
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
