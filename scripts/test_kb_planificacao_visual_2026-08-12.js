/**
 * test_kb_planificacao_visual_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 30-35 — bug real: a OS mostrava só
 * metadados (medidas/tabela de peças) na "Planificação do Orçamento",
 * nunca o desenho de como as peças foram planificadas na chapa — "uma OS
 * sem planificação visual pode fabricar produto diferente do vendido".
 * Existência do botão "Abrir Planificação" sozinha NÃO bastava.
 *
 * Corrigido: kbPlanificacaoGerarSVG(pecas) gera o layout real (mesmo
 * algoritmo determinístico de empacotamento já usado em
 * planExportSVG()/planDrawCanvas()) a partir do snapshot IMUTÁVEL de
 * peças (it.pieces / it.recipeSnapshot.pecas) — nunca recalcula medidas,
 * só desenha o que já foi congelado na venda. kbAbrirPlanificacaoItem()
 * agora injeta esse SVG no modal somente-leitura da OS.
 *
 * Uso: node scripts/test_kb_planificacao_visual_2026-08-12.js
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

console.log('\n=== OS — planificação visual real (desenho do corte), não só medidas ===\n');

// ── 1. HTML estático: kbAbrirPlanificacaoItem injeta o SVG gerado, nunca só o botão ──
(function () {
  var fnSrc = extractFn('kbAbrirPlanificacaoItem');
  ok('1a. kbAbrirPlanificacaoItem chama kbPlanificacaoGerarSVG (gera o desenho, não só texto)', /kbPlanificacaoGerarSVG\(pecas\)/.test(fnSrc));
  ok('1b. o desenho gerado é injetado no HTML do modal (desenhoHtml)', /desenhoHtml/.test(fnSrc) && /svgDesenho/.test(fnSrc));
  ok('1c. nomes de peça no template SVG do catálogo passam por svgSanitizar antes de ir para o DOM', /svgSanitizar\(s\.svgData\)/.test(fnSrc));
})();

// ── 2. Execução real de kbPlanificacaoGerarSVG (função pura, sem DOM) ──
var FN_NAMES = ['cfgEsc', 'kbPlanificacaoGerarSVG'];
var src = [FN_NAMES.map(extractFn).join('\n\n'), 'module.exports = { kbPlanificacaoGerarSVG: kbPlanificacaoGerarSVG };'].join('\n\n');
var modPath = path.join(__dirname, '_kb_plan_visual_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

{
  var svg = mod.kbPlanificacaoGerarSVG([]);
  test('2. Nenhuma peça (array vazio) → string vazia (nunca desenha chapa fantasma)', svg, '');
}
{
  var svg = mod.kbPlanificacaoGerarSVG([{ nome: 'Lateral', larg: 19.4, alt: 19.7, qty: 2, esp: 3 }]);
  ok('3a. Peça válida gera markup <svg>', /^<svg /.test(svg));
  ok('3b. Desenha 2 retângulos (qty:2 expandido, uma peça por unidade)', (svg.match(/<rect x="/g) || []).length >= 2);
  ok('3c. Rótulo de medidas em cm aparece no desenho (19.4×19.7)', /19\.4×19\.7 cm/.test(svg));
  ok('3d. Uma chapa só (peças pequenas cabem em 200×100cm)', (svg.match(/Chapa \d+/g) || []).length === 1);
}
{
  // Peças sem larg/alt (dados incompletos/legado) são ignoradas, nunca crasham nem desenham 0×0.
  var svg = mod.kbPlanificacaoGerarSVG([{ nome: 'SemMedida' }, { nome: 'Valida', larg: 10, alt: 10, qty: 1 }]);
  ok('4. Peça sem medidas é descartada silenciosamente; peça válida ainda desenha', /<svg /.test(svg) && !/SemMedida/.test(svg));
}
{
  // Muitas peças grandes forçam múltiplas chapas — nunca sobrepõe peças além do limite 200x100.
  var pecasGrandes = [];
  for (var i = 0; i < 8; i++) pecasGrandes.push({ nome: 'Painel' + i, larg: 90, alt: 90, qty: 1 });
  var svg = mod.kbPlanificacaoGerarSVG(pecasGrandes);
  var numChapas = (svg.match(/Chapa \d+ de \d+|Chapa \d+ —/g) || []).length;
  ok('5. 8 peças de 90×90cm (não cabem todas numa chapa de 200×100) geram mais de 1 chapa', numChapas > 1);
}
{
  // Aliases alternativos de campo (p.l/p.a, usados por dados legados) também funcionam.
  var svg = mod.kbPlanificacaoGerarSVG([{ nome: 'Legado', l: 30, a: 40, qty: 1 }]);
  ok('6. Aceita aliases legados p.l/p.a (não só p.larg/p.alt)', /30×40 cm/.test(svg));
}
{
  // Nome de peça malicioso (tentativa de injeção) é escapado — o SVG é inserido via innerHTML no DOM real.
  // cfgEsc (mesma função usada em todo o resto do arquivo) escapa "<", que
  // já é suficiente para impedir a formação de uma tag nova — o "<" literal
  // nunca aparece na saída, só a entidade "&lt;".
  var svg = mod.kbPlanificacaoGerarSVG([{ nome: '<script>alert(1)</script>', larg: 50, alt: 50, qty: 1 }]);
  ok('7. Nome de peça com "<" é escapado (cfgEsc) antes de entrar no SVG — nenhum "<" literal sobrevive, nunca forma uma tag nova', svg.indexOf('<script>') === -1 && /&lt;script/.test(svg));
}
{
  // Determinismo: mesma entrada sempre produz o mesmo desenho (é isto que garante "nunca recalculado" — não há aleatoriedade).
  var pecas = [{ nome: 'A', larg: 40, alt: 30, qty: 3 }, { nome: 'B', larg: 20, alt: 20, qty: 1 }];
  var svg1 = mod.kbPlanificacaoGerarSVG(pecas);
  var svg2 = mod.kbPlanificacaoGerarSVG(pecas);
  test('8. Determinístico — a mesma lista de peças sempre produz exatamente o mesmo SVG', svg1, svg2);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
