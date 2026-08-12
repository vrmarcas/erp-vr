/**
 * test_orc_pix_sugestao_override_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 6 — o campo de desconto PIX é
 * auto-preenchido com a sugestão (taxa do cartão da parcela atual), mas
 * NUNCA sobrescreve silenciosamente um valor que o vendedor já digitou
 * (override manual). Ao trocar de parcelas, a sugestão recalcula — se
 * não houver override, o campo atualiza sozinho; se houver, o campo é
 * preservado e a nova sugestão só é exibida como atalho ("usar sugerido").
 *
 * Uso: node scripts/test_orc_pix_sugestao_override_2026-08-12.js
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

console.log('\n=== PIX — sugestão automática vs override manual (nunca sobrescreve em silêncio) ===\n');

function makeEl(id) { return { id: id, value: '', textContent: '', innerHTML: '' }; }
var elements = { orcPixDiscPct: makeEl('orcPixDiscPct'), orcPixSugestaoHint: makeEl('orcPixSugestaoHint') };
var mockDoc = { getElementById: function (id) { return elements[id] || null; } };

var src = [
  'var document = MOCK_DOC;',
  'var window = GLOBAL_WINDOW;',
  'function cfgLoad(){ return CFG_ATUAL; }',
  'var CFG_DEFAULT = { parcelamento: [] };',
  extractFn('_orcPixEstadoGlobal'),
  extractFn('orcPixSincronizarSugestao'),
  'module.exports = { sync: orcPixSincronizarSugestao, getWindow: function(){ return window; } };',
].join('\n\n');
var modPath = path.join(__dirname, '_orc_pix_sync.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
global.MOCK_DOC = mockDoc;
global.GLOBAL_WINDOW = {};
global.CFG_ATUAL = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 3 }, { parcelas: 3, taxa: 6 }] };
var mod = require(modPath);

// ── Cenário 1: campo vazio (novo orçamento) — auto-preenche com a sugestão ──
elements.orcPixDiscPct.value = '';
mod.getWindow()._orcPixUltimaSugestao = null;
mod.sync(3);
test('1a. campo vazio + 3x selecionado → auto-preenche com 6% (taxa de 3x)', elements.orcPixDiscPct.value, 6);
test('1b. hint mostra a sugestão automática', /Sugestão automática/.test(elements.orcPixSugestaoHint.textContent), true);

// ── Cenário 2: trocar de 3x → 1x sem ter mexido no campo → recalcula sozinho ──
mod.sync(1);
// taxa de 1x é 0% — campo fica vazio (0% não é oferecido como desconto,
// mesmo padrão do placeholder "deixe em branco para não oferecer PIX").
test('2a. sem override, trocar pra 1x (taxa 0%) recalcula o campo pra vazio — não "0"', elements.orcPixDiscPct.value, '');
test('2b. sugestão interna registrada corretamente como 0 mesmo com campo vazio', mod.getWindow()._orcPixUltimaSugestao, 0);

// ── Cenário 3: trocar pra 2x sem ter mexido → recalcula pra 3% ──
mod.sync(2);
test('3a. sem override, trocar pra 2x recalcula o campo pra 3% (taxa de 2x)', elements.orcPixDiscPct.value, 3);

// ── Cenário 4: vendedor digita manualmente um valor diferente (override) ──
elements.orcPixDiscPct.value = '10'; // vendedor negociou 10%, diferente da sugestão de 3%
mod.sync(2); // mesma parcela, campo já não bate com a última sugestão (3)
test('4a. valor digitado manualmente (10%, diferente da sugestão 3%) é PRESERVADO', elements.orcPixDiscPct.value, '10');
test('4b. hint mostra atalho "usar sugerido", não sobrescreve', /usar sugerido|Nova sugestão/.test(elements.orcPixSugestaoHint.innerHTML), true);

// ── Cenário 5: trocar de parcelas COM override ativo — nunca sobrescreve, só mostra nova sugestão ──
mod.sync(3); // troca pra 3x (sugestão seria 6%) — mas o campo tem override manual de 10%
test('5a. override manual sobrevive à troca de parcelas (continua 10%, não vira 6%)', elements.orcPixDiscPct.value, '10');
test('5b. hint mostra a NOVA sugestão (6%) como atalho, sem aplicar sozinho', /6%/.test(elements.orcPixSugestaoHint.innerHTML), true);

// ── Cenário 6: sentinela -1 (reabertura de orçamento salvo) sempre trata como override ──
elements.orcPixDiscPct.value = '6'; // coincidentemente igual à sugestão atual de 3x
mod.getWindow()._orcPixUltimaSugestao = -1; // orcEnvEditar força este sentinela antes de restaurar
mod.sync(3);
test('6a. mesmo com valor coincidindo com a sugestão, sentinela -1 trata como override (nunca assume coincidência)', elements.orcPixDiscPct.value, '6');

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
