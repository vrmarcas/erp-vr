/**
 * test_migracao_orcamentos_v2_leitura_2026-11-03.js
 *
 * Prova orcV2MergeComLegado() — a função PURA (extraída de index.html, real,
 * nunca reimplementada) que decide o que _ORC_ENVIADOS_DATA mostra depois da
 * migração: base = array legado (erp_vr/orcamentos), sobrescrita por id com
 * o que existir em erp_vr_orcamentos (v2 — fonte de verdade a partir da
 * Fase de corte de escrita). Garante a regra pedida explicitamente:
 * "rollback de leitura para o legado se o documento novo não existir" —
 * nenhum orçamento nunca desaparece só porque ainda não foi migrado/espelhado.
 *
 * Uso: node scripts/test_migracao_orcamentos_v2_leitura_2026-11-03.js
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
var src = extractFn('orcV2MergeComLegado') + '\nmodule.exports = { orcV2MergeComLegado: orcV2MergeComLegado };';
var modPath = path.join(__dirname, '_migracao_orcamentos_v2_leitura_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA MIGRAÇÃO ORÇAMENTOS v2 — leitura combinada (Fase 1) ===\n');

(function () {
  var legado = [{ id: 'A', v: 'legado-A' }, { id: 'B', v: 'legado-B' }, { id: 'C', v: 'legado-C' }];

  var r1 = mod.orcV2MergeComLegado(legado, {});
  ok('1. v2 vazio (antes de qualquer migração/dual-write): resultado é EXATAMENTE o legado, mesma ordem', JSON.stringify(r1) === JSON.stringify(legado));

  var r2 = mod.orcV2MergeComLegado(legado, { B: { id: 'B', v: 'v2-B-mais-fresco' } });
  ok('2. id presente em v2: usa a versão v2 (mais fresca), nunca a legada para esse id', r2.find(function (o) { return o.id === 'B'; }).v === 'v2-B-mais-fresco');
  ok('3. ids SEM entrada em v2 continuam vindo do legado — "rollback de leitura" automático', r2.find(function (o) { return o.id === 'A'; }).v === 'legado-A' && r2.find(function (o) { return o.id === 'C'; }).v === 'legado-C');
  ok('4. posição/ordem dos ids já existentes no legado é preservada (B não pula de posição)', r2[1].id === 'B');

  var r3 = mod.orcV2MergeComLegado(legado, { D: { id: 'D', v: 'v2-orfao-sem-par-no-legado' } });
  ok('5. id só em v2 (órfão — nunca existiu no legado, ex.: espelho legado falhou na criação): entra no resultado, nunca é perdido', r3.some(function (o) { return o.id === 'D'; }));
  ok('6. órfão entra na FRENTE (mesma convenção de unshift usada para orçamento novo)', r3[0].id === 'D');
  ok('7. todos os 3 do legado continuam presentes junto com o órfão (nenhuma perda)', r3.length === 4);

  var r4 = mod.orcV2MergeComLegado(legado, { A: { id: 'A', v: 'v2-A' }, B: { id: 'B', v: 'v2-B' }, C: { id: 'C', v: 'v2-C' } });
  ok('8. v2 totalmente populado (pós-backfill completo): todo registro vem de v2, array legado nunca mais consultado por conteúdo', r4.every(function (o) { return o.v.indexOf('v2-') === 0; }));
  ok('9. mesmo com v2 completo, a ORDEM/quantidade do legado é preservada (nenhum registro some ou se move)', r4.length === 3 && r4[0].id === 'A' && r4[1].id === 'B' && r4[2].id === 'C');

  ok('10. legado vazio + v2 vazio: resultado vazio, nunca erro', JSON.stringify(mod.orcV2MergeComLegado([], {})) === '[]');
  ok('11. legado null/undefined: nunca lança exceção, trata como vazio', JSON.stringify(mod.orcV2MergeComLegado(null, { X: { id: 'X' } })) === JSON.stringify([{ id: 'X' }]));
  ok('12. v2 null/undefined: nunca lança exceção, equivalente a v2 vazio', JSON.stringify(mod.orcV2MergeComLegado(legado, null)) === JSON.stringify(legado));

  var legadoComLixo = [{ id: 'A', v: '1' }, null, { v: 'sem-id' }, { id: 'B', v: '2' }];
  var r5 = mod.orcV2MergeComLegado(legadoComLixo, { A: { id: 'A', v: 'v2-A' } });
  ok('13. registros malformados no legado (null, sem id) passam direto, nunca travam o merge', r5.length === 4 && r5[0].v === 'v2-A' && r5[3].v === '2');
})();

console.log('\n' + passed + ' passou(aram), ' + failed + ' falhou(aram)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
