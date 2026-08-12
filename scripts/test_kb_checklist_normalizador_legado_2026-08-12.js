/**
 * test_kb_checklist_normalizador_legado_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 21-29 — gap identificado (não corrigido
 * em rodadas anteriores): OS criadas ANTES da regra "checklist SEMPRE os
 * 5 itens fixos Corte/Gravação/Montagem/Acabamento/Embalagem" podem ter
 * os.checks incompleto (ex.: só 2-3 itens de uma composição comercial
 * antiga) ou fora da ordem canônica. Sem normalização, essas OS legadas
 * nunca ganham os itens que faltam — o funcionário nunca vê nem consegue
 * marcar etapas que realmente precisam acontecer (ex.: uma OS antiga sem
 * "Embalagem" no checklist parece nunca precisar ser embalada).
 *
 * Corrigido: kbNormalizarChecklistLegado(os) mescla SEMPRE com a lista
 * canônica (OPERACOES_PADRAO), preservando o estado já marcado dos itens
 * existentes (comparação por nome, case-insensitive), adicionando só os
 * que faltam como pendentes, preservando itens extras não-canônicos
 * (adicionados manualmente via kbCheckAddItem) — nunca duplica. Chamada
 * em kbOpen() antes de qualquer fallback/render.
 *
 * Uso: node scripts/test_kb_checklist_normalizador_legado_2026-08-12.js
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
function ok(desc, cond) {
  if (cond) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc); failed++; }
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
  var marker = 'var ' + name + ' = [';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf('];', start) + 2;
  return html.slice(start, end);
}

console.log('\n=== Normalizador de checklist legado — sempre os 5 itens canônicos ===\n');

// ── 1. kbOpen chama o normalizador ANTES do fallback de os._ck, e salva se mudou ──
(function () {
  var fnSrc = extractFn('kbOpen');
  var idxNorm = fnSrc.indexOf('kbNormalizarChecklistLegado(os)');
  var idxFallback = fnSrc.indexOf('if (!os._ck) os._ck');
  ok('1a. kbOpen chama kbNormalizarChecklistLegado(os)', idxNorm >= 0);
  ok('1b. a normalização acontece ANTES do fallback de os._ck (senão o fallback usaria o checklist velho)', idxNorm >= 0 && idxFallback >= 0 && idxNorm < idxFallback);
  ok('1c. persiste (kbSaveKbos) quando o normalizador de fato mudou algo', /kbNormalizarChecklistLegado\(os\)\)\s*\{[\s\S]{0,80}kbSaveKbos\(\)/.test(fnSrc));
})();

// ── 2. Execução real de kbNormalizarChecklistLegado (função pura) ──
var src = [extractVar('OPERACOES_PADRAO'), extractFn('kbNormalizarChecklistLegado'), 'module.exports = { kbNormalizarChecklistLegado: kbNormalizarChecklistLegado };'].join('\n\n');
var modPath = path.join(__dirname, '_kb_checklist_normalizador_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

var CANONICO = ['Corte', 'Gravação', 'Montagem', 'Acabamento', 'Embalagem'];

{
  // OS já normalizada (caso comum, maioria das OS) — não deve mexer em nada.
  var os = { checks: CANONICO.slice(), _ck: [true, true, false, false, false] };
  var mudou = mod.kbNormalizarChecklistLegado(os);
  test('2. OS já canônica: normalizador não faz nada (idempotente, retorna false)', mudou, false);
  test('2b. checks/checagens permanecem intocados', { checks: os.checks, _ck: os._ck }, { checks: CANONICO, _ck: [true, true, false, false, false] });
}

{
  // OS legada clássica: só 2 itens de uma composição antiga, sem Montagem/Acabamento/Embalagem.
  // Ambos já marcados no legado — a normalização precisa preservar o estado de CADA um
  // mesmo remapeando de posição (Embalagem estava no índice 1 do legado, vai para o índice 4 do canônico).
  var os = { checks: ['Corte', 'Embalagem'], _ck: [true, true] };
  var mudou = mod.kbNormalizarChecklistLegado(os);
  ok('3a. Detecta OS legada incompleta e normaliza (retorna true)', mudou === true);
  test('3b. Resultado final é sempre os 5 itens canônicos, na ordem canônica', os.checks, CANONICO);
  test('3c. Corte estava marcado (true) — preserva o estado já marcado', os._ck[0], true);
  test('3d. Embalagem estava marcado (true) — preserva mesmo estando fora de ordem no legado', os._ck[4], true);
  test('3e. Gravação/Montagem/Acabamento (que não existiam) entram como pendentes (false), nunca true por engano', [os._ck[1], os._ck[2], os._ck[3]], [false, false, false]);
}

{
  // OS sem nenhum checklist (campo ausente/vazio) — nunca quebra, gera os 5 canônicos do zero.
  var os = { checks: [], _ck: [] };
  var mudou = mod.kbNormalizarChecklistLegado(os);
  ok('4a. OS sem checklist algum é normalizada', mudou === true);
  test('4b. Gera os 5 itens canônicos, todos pendentes', { checks: os.checks, _ck: os._ck }, { checks: CANONICO, _ck: [false, false, false, false, false] });
}

{
  // OS com item extra customizado (adicionado manualmente via kbCheckAddItem) — nunca descarta.
  var os = { checks: ['Corte', 'Furação especial', 'Gravação'], _ck: [true, true, false] };
  var mudou = mod.kbNormalizarChecklistLegado(os);
  ok('5a. Detecta e normaliza mesmo com item extra misturado', mudou === true);
  test('5b. Os 5 canônicos vêm primeiro, na ordem certa', os.checks.slice(0, 5), CANONICO);
  test('5c. Item extra "Furação especial" é preservado no final, nunca descartado', os.checks[5], 'Furação especial');
  test('5d. Estado marcado do item extra é preservado (estava true)', os._ck[5], true);
  test('5e. Corte preserva seu estado marcado (true)', os._ck[0], true);
}

{
  // Comparação é case-insensitive e tolera espaços (dado legado digitado manualmente em outra rodada).
  var os = { checks: [' corte ', 'GRAVAÇÃO'], _ck: [true, true] };
  var mudou = mod.kbNormalizarChecklistLegado(os);
  ok('6a. Reconhece variação de caixa/espaços como o mesmo item canônico (não duplica)', mudou === true);
  test('6b. Resultado final tem exatamente 5 itens (nunca duplica "Corte"/"Gravação")', os.checks.length, 5);
  test('6c. Nomes finais sempre no formato canônico exato (nunca preserva a grafia legada)', os.checks, CANONICO);
  test('6d. Corte e Gravação preservam o estado marcado apesar da grafia diferente', [os._ck[0], os._ck[1]], [true, true]);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
