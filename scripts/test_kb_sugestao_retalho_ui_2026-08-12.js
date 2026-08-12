/**
 * test_kb_sugestao_retalho_ui_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 36-42 — o motor de sugestão de
 * retalho/chapa (encaixe geométrico largura×altura + margem de segurança,
 * melhor-fit) já estava correto de rodada anterior, mas a UI só mostrava
 * um texto solto — o funcionário não tinha ação explícita de usar a
 * sugestão, escolher outro retalho, ou abrir chapa nova; precisava
 * adivinhar que o dropdown pré-preenchido já era a sugestão.
 *
 * Corrigido: kbSugestaoHtml(sug) gera o cartão "♻️ Sugestão de
 * aproveitamento" com as 3 ações pedidas (✅ Usar retalho / 🔎 Escolher
 * outro / 🆕 Abrir chapa nova) — cada botão só troca o tipo/foco (nunca
 * confirma sozinho; kbConfirmarProd() continua sendo o único ponto que
 * dispara a baixa real de estoque, via a Function transacional já
 * existente).
 *
 * Uso: node scripts/test_kb_sugestao_retalho_ui_2026-08-12.js
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

console.log('\n=== Sugestão de retalho — cartão com as 3 ações explícitas (usar/escolher outro/chapa nova) ===\n');

// ── 1. kbProdOnMatChange usa o novo cartão HTML (não mais texto solto) ──
(function () {
  var fnSrc = extractFn('kbProdOnMatChange');
  ok('1. kbProdOnMatChange injeta kbSugestaoHtml(sug) via innerHTML (não mais sugBox.textContent = sug.texto)', /sugBox\.innerHTML = kbSugestaoHtml\(sug\)/.test(fnSrc));
  ok('1b. nunca mais usa .textContent para a sugestão (regressão de guarda)', !/sugBox\.textContent\s*=\s*sug\.texto/.test(fnSrc));
})();

// ── 2. Execução real de kbSugestaoHtml (função pura, sem DOM) ──
var FN_NAMES = ['cfgEsc', 'kbSugestaoHtml'];
var src = [FN_NAMES.map(extractFn).join('\n\n'), 'module.exports = { kbSugestaoHtml: kbSugestaoHtml };'].join('\n\n');
var modPath = path.join(__dirname, '_kb_sugestao_retalho_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

test('3. Sem sugestão (null) → string vazia', mod.kbSugestaoHtml(null), '');

{
  var sug = { tipo: 'retalho', retalho: { codigo: 'AC3-001', dims: '52x68' }, texto: '💡 Sugestão: usar retalho AC3-001 — 52x68 cm.' };
  var htmlOut = mod.kbSugestaoHtml(sug);
  ok('4a. Mostra o cabeçalho "♻️ Sugestão de aproveitamento"', /♻️ Sugestão de aproveitamento/.test(htmlOut));
  ok('4b. Mostra o código do retalho recomendado (AC3-001)', /AC3-001/.test(htmlOut));
  ok('4c. Mostra as dimensões do retalho (52x68 cm)', /52x68 cm/.test(htmlOut));
  ok('4d. Botão "✅ Usar retalho AC3-001" presente e chama kbProdSetTipo("retalho")', /✅ Usar retalho AC3-001/.test(htmlOut) && /kbProdSetTipo\(&quot;retalho&quot;\)/.test(htmlOut));
  ok('4e. Botão "🔎 Escolher outro retalho" presente e foca o select real (kbProdRetalhoSel)', /🔎 Escolher outro retalho/.test(htmlOut) && /kbProdRetalhoSel/.test(htmlOut));
  ok('4f. Botão "🆕 Abrir chapa nova" presente e chama kbProdSetTipo("chapa")', /🆕 Abrir chapa nova/.test(htmlOut) && /kbProdSetTipo\(&quot;chapa&quot;\)/.test(htmlOut));
}

{
  // Sugestão de chapa nova (nenhum retalho compatível) continua simples (texto), sem os 3 botões — não faz sentido "escolher outro retalho" quando não há nenhum.
  var sugChapa = { tipo: 'chapa', fracaoChapa: 1, texto: '💡 Sugestão: usar 1 chapa (área planificada 1.50 m² de 2.00 m²/chapa).' };
  var htmlOut = mod.kbSugestaoHtml(sugChapa);
  test('5a. Sugestão de chapa nova retorna o texto simples (sem botões, sem retalho para recomendar)', htmlOut, '💡 Sugestão: usar 1 chapa (área planificada 1.50 m² de 2.00 m²/chapa).');
  ok('5b. Nunca mostra os botões de retalho quando a sugestão é de chapa', !/Escolher outro retalho/.test(htmlOut));
}
{
  // Nome/código de retalho malicioso é escapado (o cartão vai para innerHTML no DOM real).
  var sugMalicioso = { tipo: 'retalho', retalho: { codigo: '<img src=x onerror=alert(1)>', dims: '50x50' }, texto: '' };
  var htmlOut = mod.kbSugestaoHtml(sugMalicioso);
  ok('6. Código de retalho malicioso é escapado (cfgEsc) — nenhum "<" literal sobrevive no cartão', htmlOut.indexOf('<img') === -1);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
