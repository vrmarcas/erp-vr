/**
 * test_rodada_funcional_bloco4_medidas_os_2026-09-17.js
 *
 * Bloco 4 — medidas ausentes na OS/Kanban. Valida osMedidasResolvidas()
 * (fallback it.larg/it.alt -> it.planLarg/it.planAlt/it.planProf, nunca
 * inventa) extraída diretamente de index.html, sem emulador/admin SDK.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /function osMedidasResolvidas\(it\) \{[\s\S]*?\n\}/.exec(html);
if (!m) { console.error('❌ osMedidasResolvidas não encontrada em index.html'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[0] + '\nthis.osMedidasResolvidas = osMedidasResolvidas;', ctx);
const osMedidasResolvidas = ctx.osMedidasResolvidas;

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { console.log('  ✅ ' + desc); pass++; }
  else { console.log('  ❌ ' + desc); fail++; }
}

console.log('=== Bloco 4 — osMedidasResolvidas ===');

// A. item sem nenhum campo — nunca inventa
var r1 = osMedidasResolvidas({});
check('A1. sem larg/alt/plan* — larg null', r1.larg === null);
check('A2. sem larg/alt/plan* — alt null', r1.alt === null);
check('A3. sem larg/alt/plan* — prof null', r1.prof === null);

// B. campo legado presente — usa direto (nunca sobrepõe com plan* se legado existe)
var r2 = osMedidasResolvidas({ larg: '26', alt: '19', planLarg: '99', planAlt: '99' });
check('B1. it.larg/it.alt legado tem prioridade', r2.larg === '26' && r2.alt === '19');

// C. só campos planificados (caso relatado pelo usuário: item vindo de receita) — fallback funciona
var r3 = osMedidasResolvidas({ planLarg: '26', planAlt: '19', planProf: '55' });
check('C1. fallback planLarg', r3.larg === '26');
check('C2. fallback planAlt', r3.alt === '19');
check('C3. fallback planProf (altura, só quando existe)', r3.prof === '55');

// D. item null — nunca quebra
var r4 = osMedidasResolvidas(null);
check('D1. item null não lança exceção e retorna nulls', r4.larg === null && r4.alt === null && r4.prof === null);

// E. os 6 pontos de renderização foram de fato migrados para usar a função
var usos = (html.match(/osMedidasResolvidas/g) || []).length;
check('E1. função definida + usada nos 6 pontos de renderização (7 ocorrências totais)', usos === 7);

console.log('\n======================================================================');
console.log(' RESULTADO: ' + pass + ' passaram, ' + fail + ' falharam (' + (pass + fail) + ' total)');
console.log('======================================================================');
process.exitCode = fail ? 1 : 0;
