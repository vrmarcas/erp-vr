/**
 * test_rodada_funcional_bloco4_medidas_os_2026-09-17.js
 *
 * Bloco 4 — medidas ausentes na OS/Kanban. Cada um dos 6 pontos de
 * renderização (kbRenderItensDetalhe, kbOpen, osImprimirPDF, orcEnvAbrir,
 * orcEnvGerarOS, _orcSincronizarOSVinculada) resolve as medidas com
 * fallback INLINE (it.larg/it.alt legado -> it.planLarg/it.planAlt/
 * it.planProf planificado), sem função helper compartilhada — o padrão de
 * teste deste repo extrai cada função testada isoladamente por regex, sem
 * puxar dependências externas (ver scripts/test_hotfix_os_sync_*,
 * test_orc_cr_placeholder_*, test_os_area_planificada_*,
 * test_planificacao_os_prazo_*), então uma função helper nova quebraria
 * esses 4 testes existentes.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { console.log('  ✅ ' + desc); pass++; }
  else { console.log('  ❌ ' + desc); fail++; }
}

console.log('=== Bloco 4 — fallback inline de medidas nos 6 pontos de renderização ===');

// Nenhuma função osMedidasResolvidas deve existir (evita quebrar os 4
// testes de extração isolada que já existiam antes desta rodada).
check('0. sem função helper compartilhada (evita quebrar extração isolada)', !/function osMedidasResolvidas/.test(html));

// Os 6 pontos devem usar o fallback planLarg/planAlt/planProf inline.
const pontos = (html.match(/\|\|\s*it\d?\.planLarg\s*\|\|\s*null|\|\|_it0\w*\.planLarg\|\|null|\|\s*_it0\w*\.planLarg\s*\|\s*null/g) || []);
const ocorrenciasPlanLarg = (html.match(/planLarg\s*\|\|\s*null/g) || []).length;
check('1. ao menos 6 pontos com fallback "|| ...planLarg || null"', ocorrenciasPlanLarg >= 6);

// Funções específicas continuam com o MESMO nome/assinatura (padrão do
// repo — nunca renomear/dividir função testada).
['function kbRenderItensDetalhe(os) {', 'function kbOpen(', 'function osImprimirPDF(id) {', 'function orcEnvAbrir(id) {', 'function orcEnvGerarOS(', 'function _orcSincronizarOSVinculada(orc) {']
  .forEach((sig) => check('2. assinatura preservada: ' + sig, html.includes(sig)));

console.log('\n======================================================================');
console.log(' RESULTADO: ' + pass + ' passaram, ' + fail + ' falharam (' + (pass + fail) + ' total)');
console.log('======================================================================');
process.exitCode = fail ? 1 : 0;
