/**
 * e2e_run_all_tests.js — comando único: reset+seed do ambiente limpo,
 * depois executa TODAS as suítes server-side em sequência, reportando
 * contagens SEPARADAS por categoria (nunca uma soma única enganosa).
 *
 * Observação operacional: o Firestore Emulator, neste ambiente, mostrou
 * perder estado em memória entre execuções separadas de processo Node
 * quando há uma janela de tempo entre elas (não determinado se é
 * eviction por inatividade do emulador ou artefato do host) — por isso
 * este runner SEMPRE reseta imediatamente antes de rodar a suíte, no
 * mesmo processo do orquestrador, para nunca depender de estado
 * sobrevivendo entre invocações separadas.
 *
 * Uso: node scripts/e2e_run_all_tests.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const { reset, seed, hashState } = require('./e2e_clean_env');

const SUITES = [
  { file: 'test_producao_autorizacao_server.js', categoria: 'Functions — Produção (autorização/idempotência/concorrência)' },
  { file: 'test_estoque_autorizacao_server.js', categoria: 'Functions — Estoque (12 comandos)' },
  { file: 'test_compras_v2_server.js', categoria: 'Functions — Compras v2' },
  { file: 'test_qa_fixture_guard.js', categoria: 'Ferramenta — QA fixture guard' },
  { file: 'test_estoque_rules.js', categoria: 'Rules — REST via Auth Emulator' },
  // Fase G — Catálogo Vitre + Valéria (adicionado na HOMOLOGAÇÃO 2026-08-06, Parte 11)
  { file: 'test_vitre_catalogo_server.js', categoria: 'Functions — Catálogo Vitre (CRUD/importação/orçamento)' },
  { file: 'test_vitre_rules.js', categoria: 'Rules — bloco vitre_* via REST' },
  { file: 'test_vitre_importador_unit.js', categoria: 'Unitário — parser da planilha Vitre' },
  { file: 'test_vitre_sku_conflitos_fixture.js', categoria: 'Fixture — prova de resolução dos 4 conflitos de SKU' },
  { file: 'test_vitre_os_server.js', categoria: 'Functions — conversão de orçamento Vitre em OS' },
  { file: 'test_valeria_vitre_server.js', categoria: 'Functions — Valéria × Catálogo Vitre (onRequest)' },
];

function runSuite(file) {
  var full = path.join(__dirname, file);
  try {
    var out = execFileSync('node', [full], { encoding: 'utf8', env: process.env });
    var m = out.match(/passed=(\d+)\s+failed=(\d+)/);
    return { ok: true, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null, out };
  } catch (e) {
    var out2 = (e.stdout || '') + (e.stderr || '');
    var m2 = out2.match(/passed=(\d+)\s+failed=(\d+)/);
    return { ok: false, passed: m2 ? Number(m2[1]) : null, failed: m2 ? Number(m2[2]) : null, out: out2 };
  }
}

async function main() {
  console.log('[e2e_run_all_tests] resetando e semeando ambiente limpo...');
  await reset();
  await seed();
  var h = await hashState();
  console.log('[e2e_run_all_tests] SHA-256 do seed: ' + h.hash + '\n');

  var resultados = [];
  for (var s of SUITES) {
    console.log('── ' + s.categoria + ' (' + s.file + ') ──');
    var r = runSuite(s.file);
    console.log(r.out.split('\n').slice(-4).join('\n'));
    resultados.push(Object.assign({ categoria: s.categoria, file: s.file }, r));
  }

  console.log('\n=== RESUMO POR CATEGORIA (nunca somado como total único) ===');
  var totalPassed = 0, totalFailed = 0, algumaFalhou = false;
  resultados.forEach((r) => {
    console.log('  ' + r.categoria.padEnd(55) + ' passed=' + r.passed + ' failed=' + r.failed + (r.ok ? '' : '  ⚠️ processo saiu com erro'));
    if (r.passed) totalPassed += r.passed;
    if (r.failed) totalFailed += r.failed;
    if (!r.ok || r.failed) algumaFalhou = true;
  });
  console.log('\n  (soma bruta só para referência — cada categoria testa uma superfície DIFERENTE, não intercambiável): ' + totalPassed + ' passed / ' + totalFailed + ' failed');
  console.log('  seedHash=' + h.hash);
  process.exitCode = algumaFalhou ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
