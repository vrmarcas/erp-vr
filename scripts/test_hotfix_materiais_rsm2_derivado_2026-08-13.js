/**
 * test_hotfix_materiais_rsm2_derivado_2026-08-13.js
 *
 * HOTFIX 2026-08-13 — rsm2 (R$/m²) precisa ser tratado como campo DERIVADO
 * de custo/comp/larg, nunca como valor persistido com prioridade sobre os
 * campos que o originam.
 *
 * Achado real durante o reparo de Acrílico Cristal 4mm (esp/custo alterados
 * para 4/R$450 e salvos): o `rsm2` persistido continuou 97,42 (o valor
 * antigo, de antes da edição) — só ficou correto (151,17) depois de um
 * reload + novo save, porque rsm2 só era recalculado nos 3 pontos de merge
 * cloud↔local (disparados ao RECEBER dados), nunca no momento de SALVAR.
 *
 * Corrigido: _cfgSalvar() agora chama _cfgRecalcRsm2Todos(_cfgData.materiais)
 * imediatamente antes de cfgSave(_cfgData) — garante que o 1º save já sai
 * correto, sem depender de round-trip. Os 3 pontos de merge foram
 * refatorados para usar a MESMA função (fonte única da fórmula).
 *
 * Este teste extrai _cfgRecalcRsm2Todos REAL do index.html (nunca
 * reimplementada) e cobre exatamente os 5 cenários pedidos:
 *   1. 122×244, custo R$450 → R$151,17/m²
 *   2. alterar só o custo para R$500 → recalcula corretamente
 *   3. resultado já correto num único cálculo (sem depender de 2ª rodada)
 *   4. alterar dimensões → recalcula
 *   5. nenhuma outra variante é modificada
 *
 * Uso: node scripts/test_hotfix_materiais_rsm2_derivado_2026-08-13.js
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
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== HOTFIX 2026-08-13 — rsm2 (R$/m²) como campo derivado, nunca stale ===\n');

var src = extractFn('_cfgRecalcRsm2Todos') + '\n\nmodule.exports = { _cfgRecalcRsm2Todos: _cfgRecalcRsm2Todos };';
var modPath = path.join(__dirname, '_rsm2_derivado_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function rsm2Esperado(custo, comp, larg) { return custo / (comp * larg / 10000); }

// ── Cenário 1: 122×244, custo R$450 → R$151,17/m² ──
{
  var arr = [{ id: 'x', nome: 'Acrílico Cristal', esp: 4, comp: 122, larg: 244, custo: 450, rsm2: 97.42 }];
  mod._cfgRecalcRsm2Todos(arr);
  ok('1. 122×244cm, custo R$450 → R$151,17/m² (não fica com o valor antigo 97,42)',
    Math.abs(arr[0].rsm2 - 151.169) < 0.01);
}

// ── Cenário 2 e 3: alterar só o custo para R$500 → recalcula certo NUM ÚNICO save ──
{
  var arr = [{ id: 'x', nome: 'Acrílico Cristal', esp: 4, comp: 122, larg: 244, custo: 450, rsm2: 151.17 }];
  arr[0].custo = 500; // única mudança — simula o usuário editando só o campo custo
  mod._cfgRecalcRsm2Todos(arr); // exatamente 1 chamada — simula 1º save, sem round-trip
  var esperado = rsm2Esperado(500, 122, 244); // ≈ R$167,96/m²
  ok('2/3. alterar só custo p/ R$500 → R$/m² muda para R$' + esperado.toFixed(2) + '/m² já no 1º cálculo (nunca fica com R$151,17 antigo)',
    Math.abs(arr[0].rsm2 - esperado) < 0.01);
}

// ── Cenário 4: alterar dimensões → recalcula ──
{
  var arr = [{ id: 'x', nome: 'Acrílico Cristal', esp: 4, comp: 122, larg: 244, custo: 450, rsm2: 151.17 }];
  arr[0].comp = 100; arr[0].larg = 200; // nova chapa 100x200cm, mesmo custo
  mod._cfgRecalcRsm2Todos(arr);
  ok('4. alterar dimensões (100×200, mesmo custo R$450) → recalcula p/ R$225,00/m²',
    Math.abs(arr[0].rsm2 - 225) < 0.01);
}

// ── Cenário 5: nenhuma outra variante é modificada ──
{
  var full = [
    { id: 'a', nome: 'Acrílico Cristal', esp: 2, comp: 122, larg: 244, custo: 290, rsm2: 97.42 },
    { id: 'b', nome: 'Acrílico Cristal', esp: 3, comp: 122, larg: 244, custo: 350, rsm2: 117.58 },
    { id: 'c', nome: 'Acrílico Cristal', esp: 4, comp: 122, larg: 244, custo: 450, rsm2: 97.42 }, // stale, será corrigido
    { id: 'd', nome: 'Acrílico Cristal', esp: 5, comp: 122, larg: 244, custo: 550, rsm2: 184.76 },
  ];
  var before = clone(full);
  mod._cfgRecalcRsm2Todos(full);
  ok('5a. variante c (a única com rsm2 desatualizado) é corrigida para R$151,17/m²',
    Math.abs(full.find(function (r) { return r.id === 'c'; }).rsm2 - 151.169) < 0.01);
  ['a', 'b', 'd'].forEach(function (id) {
    var b = before.find(function (r) { return r.id === id; });
    var a = full.find(function (r) { return r.id === id; });
    var esperado = rsm2Esperado(b.custo, b.comp, b.larg);
    ok('5b. variante ' + id + ' permanece consistente com custo/área (esperado R$' + esperado.toFixed(2) + '/m²) — nenhuma outra alterada',
      Math.abs(a.rsm2 - esperado) < 0.01);
  });
}

// ── Reprodução do achado real: rsm2 persistido ANTIGO não deve "vencer" ──
// os campos que o originam (a função sempre recalcula, nunca preserva o
// rsm2 antigo com prioridade — condição explícita do reparo pedido).
{
  var stale = [{ id: 'x', nome: 'Acrílico Cristal', esp: 4, comp: 122, larg: 244, custo: 450, rsm2: 999999 }]; // rsm2 propositalmente absurdo
  mod._cfgRecalcRsm2Todos(stale);
  ok('6. rsm2 persistido antigo (mesmo um valor absurdo) nunca tem prioridade — sempre recalculado a partir de custo/área',
    Math.abs(stale[0].rsm2 - 151.169) < 0.01);
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
