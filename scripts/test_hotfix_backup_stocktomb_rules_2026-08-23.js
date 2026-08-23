/**
 * test_hotfix_backup_stocktomb_rules_2026-08-23.js
 *
 * RODADA CURTA DE FECHAMENTO pós-Rodada 9 — Objetivos 2, 3 e 4.
 *
 * Objetivo 2 (backup automático): causa raiz do "[Backup] Falhou" — a
 * função erpBackupAutomatico() (index.html) escrevia erp_backups/{date}
 * direto do navegador, e essa coleção nunca teve Rule própria (caía no
 * catch-all `allow write: if false` do fim de firestore.rules, negando
 * até o master). Corrigido movendo a escrita para uma Cloud Function
 * agendada (erpBackupDiario, functions/src/backup.ts, mesmo padrão de
 * syncMarketingMetricsData) + Rule mínima por role (leitura só master,
 * escrita sempre negada ao client). A função client-side antiga foi
 * removida (não fica código morto tentando escrever e falhando sempre).
 *
 * Objetivo 3 (_stockApplyTomb): removido o write-back client-side
 * (stockSaveData()) que sempre falhava contra as Rules de estoque já
 * publicadas na Rodada 9 (só Cloud Function escreve 'stock') — a limpeza
 * LOCAL (delete STOCK[k]) continua.
 *
 * Objetivo 4 (limpeza cosmética): comentário desatualizado em
 * firestore.rules ("RULES CANDIDATAS... NÃO publicadas") corrigido —
 * sem alterar nenhuma regra ativa.
 *
 * Uso: node scripts/test_hotfix_backup_stocktomb_rules_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var functionsDir = path.join(__dirname, '..', 'functions');
var htmlPath = path.join(__dirname, '..', 'index.html');
var rulesPath = path.join(__dirname, '..', 'firestore.rules');
var backupSrcPath = path.join(functionsDir, 'src', 'backup.ts');

console.log('\n=== RODADA CURTA (pós-9) — Backup automático + _stockApplyTomb + limpeza de Rules ===\n');

try {
  execSync('npx tsc -p .', { cwd: functionsDir, stdio: 'pipe' });
  assertTrue(true, '0. functions/ compila limpo (tsc) — inclui backup.ts');
} catch (e) {
  assertTrue(false, '0. functions/ compila limpo (tsc) — ' + (e.stdout || e.message).toString().slice(0, 500));
  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(1);
}

var indexLib = fs.readFileSync(path.join(functionsDir, 'lib', 'index.js'), 'utf8');
var backupLib = fs.readFileSync(path.join(functionsDir, 'lib', 'backup.js'), 'utf8');
var backupSrc = fs.readFileSync(backupSrcPath, 'utf8');
var html = fs.readFileSync(htmlPath, 'utf8');
var rules = fs.readFileSync(rulesPath, 'utf8');

// ── Objetivo 2 — backup ─────────────────────────────────────────────────────
assertTrue(/exports\.erpBackupDiario\s*=/.test(backupLib), '1. erpBackupDiario exportada de functions/lib/backup.js');
assertTrue(/erpBackupDiario/.test(indexLib), '2. erpBackupDiario re-exportada de functions/lib/index.js (deployável)');
assertTrue(/onSchedule/.test(backupSrc), '3. erpBackupDiario é uma Cloud Function AGENDADA (mesmo padrão de syncMarketingMetricsData) — nunca client-side');

var htmlBackupKeysMatch = html.match(/var _BACKUP_KEYS = \[([^\]]+)\]/);
var srcBackupKeysMatch = backupSrc.match(/const BACKUP_KEYS = \[([\s\S]+?)\];/);
assertTrue(!!htmlBackupKeysMatch, '4. _BACKUP_KEYS ainda existe em index.html (usado por erpBackupExportar, manual — intocado)');
assertTrue(!!srcBackupKeysMatch, '5. BACKUP_KEYS existe em functions/src/backup.ts');
if (htmlBackupKeysMatch && srcBackupKeysMatch) {
  var normalizar = function (s) { return s.replace(/['"\s\n]/g, '').split(',').filter(Boolean).sort().join(','); };
  assertTrue(
    normalizar(htmlBackupKeysMatch[1]) === normalizar(srcBackupKeysMatch[1]),
    '6. BACKUP_KEYS do backend é EXATAMENTE o mesmo conjunto de _BACKUP_KEYS do index.html — escopo do backup inalterado nesta rodada, só o mecanismo de escrita'
  );
}
assertTrue(/LIMITE_SEGURO_BYTES/.test(backupSrc), '7. backup.ts tem checagem de tamanho de payload (nunca existia antes — achado da auditoria)');

assertTrue(!/function erpBackupAutomatico/.test(html), '8. função client-side erpBackupAutomatico() removida de index.html (não fica código morto que sempre falha)');
assertTrue(!/setTimeout\(function\(\)\{ try\{ erpBackupAutomatico/.test(html), '9. chamada a erpBackupAutomatico() removida do fluxo de carga da página');
assertTrue(/function erpBackupExportar/.test(html), '10. erpBackupExportar() (download manual, não escreve no Firestore) PRESERVADA — fora do escopo desta rodada');

var rulesBackupMatch = rules.match(/match \/erp_backups\/\{docId\} \{([\s\S]*?)\}/);
assertTrue(!!rulesBackupMatch, '11. firestore.rules agora tem um match explícito para erp_backups (antes caía no catch-all "if false")');
if (rulesBackupMatch) {
  var body = rulesBackupMatch[1];
  assertTrue(/allow read:\s*if isMaster\(\)/.test(body), '12. leitura de erp_backups restrita a master (dado sensível — snapshot completo de estoque/clientes/financeiro)');
  assertTrue(/allow write:\s*if false/.test(body), '13. escrita de erp_backups sempre negada ao client — só Admin SDK (erpBackupDiario) grava');
}

// ── Objetivo 3 — _stockApplyTomb ────────────────────────────────────────────
var tombFnMatch = html.match(/function _stockApplyTomb\(\) \{([\s\S]*?)\n\}/);
assertTrue(!!tombFnMatch, '14. _stockApplyTomb() ainda existe em index.html');
if (tombFnMatch) {
  var tombBody = tombFnMatch[1];
  assertTrue(/delete STOCK\[k\]/.test(tombBody), '15. limpeza LOCAL do item tombado preservada (a tela nunca mostra item excluído)');
  // Ignora linhas de comentário (o próprio comentário explicativo cita
  // "stockSaveData()" como documentação do que foi removido) — só
  // verifica se a chamada REAL (código executável) ainda existe.
  var tombCodeLines = tombBody.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
  assertTrue(!/stockSaveData\(\)/.test(tombCodeLines), '16. write-back client-side (stockSaveData()) removido do CÓDIGO — sempre falhava contra a Rule de stock já publicada (deny-by-default, só Cloud Function escreve)');
}
assertTrue(!/var _stockCleanTimer/.test(html), '17. variável _stockCleanTimer (debounce do write-back removido) também removida — sem código morto órfão');

// ── Objetivo 4 — comentário desatualizado em firestore.rules ───────────────
assertTrue(!/NÃO publicadas/.test(rules), '18. comentário "RULES CANDIDATAS... NÃO publicadas" removido de firestore.rules (as Rules já estão publicadas desde a Rodada 9)');
assertTrue(!/BLOQUEADOR DE DEPLOY CONHECIDO/.test(rules), '19. menção ao bloqueador de deploy (Compras v1) removida — _COMPRAS_V2_OFICIAL=true tornou esse ramo código morto antes mesmo da Rule ser publicada');
assertTrue(
  rules.includes("allow read: if isProducao() && docId in\n        ['stock', 'stock_deleted', 'erp_stock_log', 'retalhos', 'retalhos_seq'];"),
  '20. a Rule ATIVA de leitura de estoque (comportamento) não mudou — só o comentário acima dela'
);

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
