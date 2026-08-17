/**
 * test_hotfix_marcar_pronta_etapa_chip_2026-08-17.js
 *
 * HOTFIX OPERACIONAL 2026-08-17 — achado real (rodada de validação
 * operacional, Fluxo 7: Checklist): ao completar o checklist de produção
 * de uma OS, o botão "✓ Marcar como Pronta" não aparecia imediatamente
 * (ficava com display:none no DOM) apesar de kbChecklistCompleto(os)
 * retornar true — exigindo fechar/reabrir a OS para o botão surgir.
 *
 * Causa raiz confirmada: kbToggleEtapa() (os chips de etapa renderizados
 * no card do Kanban, ex.: "✓ Corte ✓ Gravar") muta o MESMO array
 * canônico os._ck usado pelo checklist do modal (kbToggle), mas nunca
 * chamava kbAtualizarProntoBtn(os) depois — diferente de kbToggle,
 * kbCheckAddItem, kbCheckDeleteItem e kbReverterProducao, que sempre
 * chamam. Se o item que completa o checklist for marcado via chip do
 * card (não pelo checkbox do modal), o botão do modal aberto nunca é
 * atualizado.
 *
 * Corrigido: kbToggleEtapa() agora chama kbRenderChecklist(os) e
 * kbAtualizarProntoBtn(os) ao final, quando a OS alterada é a que está
 * com o modal aberto (String(_kbOsId)===String(osId)) — mesmo padrão de
 * guarda já usado em _refletirNaTela() (index.html:14421).
 *
 * Estratégia de teste: função real extraída do código e comparada
 * estruturalmente (regex) contra as demais funções irmãs que já faziam
 * isso corretamente, confirmando que o padrão agora é uniforme.
 *
 * Uso: node scripts/test_hotfix_marcar_pronta_etapa_chip_2026-08-17.js
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

console.log('\n=== HOTFIX 2026-08-17 — Marcar como Pronta reage a mudanças via chip de etapa do card ===\n');

{
  var src = extractFn('kbToggleEtapa');
  ok('1a. kbToggleEtapa agora chama kbAtualizarProntoBtn(os)', /kbAtualizarProntoBtn\(os\)/.test(src));
  ok('1b. kbToggleEtapa agora chama kbRenderChecklist(os) (o checklist do modal também ficava desatualizado)', /kbRenderChecklist\(os\)/.test(src));
  ok('1c. a chamada é protegida pelo mesmo padrão de guarda usado em _refletirNaTela (só afeta a OS com modal aberto)', /String\(_kbOsId\)===String\(osId\)/.test(src));
}

// ── Confirma que as funções irmãs (que já funcionavam) continuam intactas
// — nenhuma regressão introduzida nelas por este fix pontual ──
['kbToggle', 'kbCheckAddItem', 'kbCheckDeleteItem', 'kbReverterProducao'].forEach(function(fnName) {
  var srcSibling = extractFn(fnName);
  ok('2. ' + fnName + '() continua chamando kbAtualizarProntoBtn (não afetado pelo fix)', /kbAtualizarProntoBtn\(os\)/.test(srcSibling));
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
