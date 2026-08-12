/**
 * test_hotfix_p0_7_todas_as_os_2026-08-12.js
 *
 * HOTFIX OPERACIONAL PÓS-GO-LIVE 2026-08-12, P0.7 — "Todas as OS" mostrava
 * 0 OS enquanto o Kanban mostrava OS reais. Raiz confirmada: a allowlist
 * _OS_ATIVOS_STATUS (usada pela aba "Ativas", padrão de "Todas as OS")
 * não incluía 'aguardando_saldo' — status comum logo após um pagamento de
 * entrada 50/50 — então qualquer OS nesse status ficava invisível em TODAS
 * as abas de "Todas as OS", enquanto o Kanban usa uma lista de EXCLUSÃO
 * (só some 'entregue'/'cancelado'), não allowlist, e por isso sempre
 * mostrava a OS normalmente.
 *
 * Uso: node scripts/test_hotfix_p0_7_todas_as_os_2026-08-12.js
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

console.log('\n=== HOTFIX P0.7 — "Todas as OS": mesma fonte do Kanban, aguardando_saldo visível ===\n');

// ── 1. Allowlist inclui o status que estava faltando ──
var listaSrc = html.slice(html.indexOf('var _OS_ATIVOS_STATUS'), html.indexOf('var _OS_ATIVOS_STATUS') + 300);
ok('1a. _OS_ATIVOS_STATUS agora inclui "aguardando_saldo"', /_OS_ATIVOS_STATUS\s*=\s*\[[^\]]*'aguardando_saldo'[^\]]*\]/.test(listaSrc));

// ── 2. Kanban e "Todas as OS" continuam lendo a MESMA fonte (Object.values(KB_OS)) ──
var renderOsTableSrc = extractFn('renderOsTable');
ok('2a. renderOsTable() lê Object.values(KB_OS) — mesma fonte do Kanban, nunca uma segunda lista', /Object\.values\(KB_OS\)/.test(renderOsTableSrc));

// ── 3. Execução real: osFiltrarPorAba('ativas', ...) inclui uma OS em status aguardando_saldo ──
{
  var FN_NAMES = ['osFiltrarPorAba'];
  try {
    var fnsSrc = FN_NAMES.map(extractFn).join('\n\n');
    var osAtivosStatusSrc = listaSrc.slice(0, listaSrc.indexOf(';')+1);
    var src = [
      "var orcEnvParseDataSalvo = function(){ return null; };",
      osAtivosStatusSrc,
      fnsSrc,
      "module.exports = { osFiltrarPorAba: osFiltrarPorAba };"
    ].join('\n\n');
    var modPath = path.join(__dirname, '_p0_7_os_extracted.tmp.js');
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);

    var osIniciada = { id: 'os1', num: '011', status: 'iniciada' };
    var osSaldo    = { id: 'os2', num: '012', status: 'aguardando_saldo' };
    var osPronta   = { id: 'os3', num: '013', status: 'pronta' };
    var osEntregue = { id: 'os4', num: '014', status: 'entregue' };
    var lista = [osIniciada, osSaldo, osPronta, osEntregue];

    var ativas = mod.osFiltrarPorAba('ativas', lista);
    ok('3a. Aba "Ativas" inclui a OS #012 em status aguardando_saldo (achado real do bug)', ativas.some(function(o){ return o.id==='os2'; }));
    ok('3b. Aba "Ativas" ainda inclui a OS #011 (iniciada) normalmente', ativas.some(function(o){ return o.id==='os1'; }));
    ok('3c. Aba "Ativas" NÃO inclui a OS pronta nem a entregue (continuam nas abas certas)', !ativas.some(function(o){ return o.id==='os3'||o.id==='os4'; }));

    var prontas = mod.osFiltrarPorAba('prontas', lista);
    ok('3d. Aba "Prontas" continua funcionando normalmente (sem regressão)', prontas.length===1 && prontas[0].id==='os3');

    try { fs.unlinkSync(modPath); } catch (e) {}
  } catch (e) {
    console.log('  ⚠️  Execução real pulada: ' + e.message);
    failed++;
  }
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
