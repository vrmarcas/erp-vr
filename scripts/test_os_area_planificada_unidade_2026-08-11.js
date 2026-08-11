/**
 * test_os_area_planificada_unidade_2026-08-11.js
 *
 * GO-LIVE 2026-08-11 — SMOKE VISUAL FINAL, achado real: a tela de detalhe
 * da OS (kbRenderItensDetalhe) mostrava "Área planificada" com o valor
 * CRU de it.planArea (gravado em cm², mesma unidade do preview ao vivo do
 * wizard) rotulado como "m²" — ex.: uma peça real de 1,66 m² aparecia como
 * "16634.16 m²" para a Produção, confusão grave de mais de 10.000x.
 *
 * Uso: node scripts/test_os_area_planificada_unidade_2026-08-11.js
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

var src = [
  "var document_stub = { getElementById: function(){ return null; } };",
  "function cfgEsc(s){ return String(s == null ? '' : s); }",
  extractFn('kbRenderItensDetalhe'),
  "module.exports = { render: kbRenderItensDetalhe };",
].join('\n\n');
var modPath = path.join(__dirname, '_os_area_planificada_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== GO-LIVE SMOKE FINAL — unidade da Área Planificada na tela da OS ===\n');

// document.getElementById precisa devolver um elemento fake com innerHTML gravável
global.document = { getElementById: function () { return { innerHTML: '' }; } };
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

var wrapEl = { innerHTML: '' };
global.document.getElementById = function () { return wrapEl; };

var os = {
  itens: [{ prod: 'Carrinho de Make Patrícia', mat: 'Acrílico Cristal 2mm', planArea: 16634.156000000003, larg: '', alt: '' }],
};
mod.render(os);

test('1. área planificada de 16634.16 cm² aparece como 1.6634 m² (dividida por 10000) — nunca o número cru rotulado como m²', /1\.6634\s*m²/.test(wrapEl.innerHTML), true);
test('2. o valor cru errado (16634.16 m²) NÃO aparece mais na tela', /16634\.16\s*m²/.test(wrapEl.innerHTML), false);

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
