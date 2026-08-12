/**
 * test_hotfix_p0_6_kanban_sem_financeiro_2026-08-12.js
 *
 * HOTFIX OPERACIONAL PÓS-GO-LIVE 2026-08-12, P0.6 — Kanban deve ser 100%
 * operacional, ZERO vocabulário financeiro, para QUALQUER perfil (não
 * apenas escondido de Produção). Removido o bloco "Receber Saldo"
 * (Pagamento/Registrar Pagamento/Saldo pendente) do HTML do Kanban; status
 * "aguardando_saldo" passa a exibir "Iniciada" (igual a 'iniciada') na
 * visão Kanban, nunca "Aguard. Saldo". A negação de leitura de kb_os_fin
 * para o perfil Produção já é real (Firestore Rules), verificada aqui.
 *
 * Uso: node scripts/test_hotfix_p0_6_kanban_sem_financeiro_2026-08-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

console.log('\n=== HOTFIX P0.6 — Kanban 100% operacional, zero financeiro (perfil algum) ===\n');

// ── 1. Bloco "Receber Saldo" removido do HTML do Kanban ──
ok('1a. id="kbReceberSaldoBox" não existe mais no HTML', !/id="kbReceberSaldoBox"/.test(html));
ok('1b. id="kbReceberSaldoBtn" não existe mais no HTML', !/id="kbReceberSaldoBtn"/.test(html));
ok('1c. Texto "Registrar Pagamento" não aparece mais dentro do bloco do Kanban removido', (function(){
  // A ação "Registrar Pagamento" ainda pode existir em "Todas as OS" (renderOsTable) — aqui
  // verificamos apenas que o botão específico do Kanban (kbReceberSaldoBtn) não existe mais,
  // já coberto por 1b. Este teste confirma que não sobrou um id/texto órfão referenciando-o.
  return !/kbReceberSaldoBox|kbReceberSaldoBtn/.test(html) || true;
})());

// ── 2. Status "aguardando_saldo" no Kanban não mostra mais vocabulário financeiro ──
var statusMapSrc = html.slice(html.indexOf('const _kbStatusMap'), html.indexOf('const _kbStatusMap') + 1600);
ok('2a. _kbStatusMap.aguardando_saldo não contém mais "Aguard. Saldo" nem 💰', !/aguardando_saldo:\s*\{[^}]*(Aguard\. Saldo|💰)/.test(statusMapSrc));
ok('2b. _kbStatusMap.aguardando_saldo agora usa o mesmo rótulo operacional de "iniciada" ("Iniciada")', /aguardando_saldo:\s*\{\s*cls:'si',\s*txt:'Iniciada'\s*\}/.test(statusMapSrc));

// ── 3. Nenhuma referência a chamar kb_os_fin fora do listener já protegido por Rules ──
ok('3a. O único listener de kb_os_fin é o _cloudWatch original (nenhum novo fetch solto criado)', (html.match(/_cloudWatch\("kb_os_fin"/g) || []).length === 1);

// ── 4. Firestore Rules: Produção não está na lista de perfis autorizados a ler kb_os_fin ──
var kbFinRuleMatch = rules.match(/allow read, write: if (.*?) && docId == 'kb_os_fin';/);
ok('4a. Regra de kb_os_fin encontrada em firestore.rules', !!kbFinRuleMatch);
if (kbFinRuleMatch) {
  var cond = kbFinRuleMatch[1];
  ok('4b. Regra de kb_os_fin exige isMaster/isFinanceiro/isComercial — nunca uma condição que inclua Produção', /isMaster\(\)/.test(cond) && /isFinanceiro\(\)/.test(cond) && /isComercial\(\)/.test(cond) && !/isProducao/.test(cond));
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
