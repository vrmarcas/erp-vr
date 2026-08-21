/**
 * test_hotfix_os_materiais_espessura_2026-08-16.js
 *
 * HOTFIX OPERACIONAL 2026-08-16 (P0.5-P0.6) — a OS mostrava só UMA
 * espessura de material por item, mesmo quando o item tinha peças
 * automáticas numa espessura (ex.: Cristal 3mm) e uma peça manual noutra
 * (ex.: Cristal 4mm) — porque `it.mat`/`os.material` sempre foram uma
 * ÚNICA string (o material selecionado no dropdown do item), nunca
 * derivados das peças reais. Além disso, a coluna "Esp." da planificação
 * dentro da OS mostrava literalmente "mm" (sem número) para peças
 * automáticas, porque a checagem `p.esp!=null` não barra string vazia e
 * nunca caía para `p.espessuraMm` (sempre presente ao lado).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * osItemMateriaisResumo, osProjecaoOperacionalItem, kbAbrirPlanificacaoItem
 * (só a construção da tabela — via injeção de KB_OS/_kbOsId, sem depender
 * de DOM real de OS completo).
 *
 * Uso: node scripts/test_hotfix_os_materiais_espessura_2026-08-16.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }

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

var FN_NAMES = ['osItemMateriaisResumo', 'osProjecaoOperacionalItem', 'kbPlanificacaoGerarSVG', 'kbAbrirPlanificacaoItem', '_planPecaAdesivos'];
global.window = global;
global.cfgEsc = function (v) { return v == null ? '' : String(v); };
global.KB_OS = {};
global._kbOsId = null;
global._lastInsertedHtml = '';
global.document = {
  getElementById: function () { return { innerHTML: '', style: {} }; },
  body: { insertAdjacentHTML: function (pos, html) { global._lastInsertedHtml = html; } }
};
global.kbFecharPlanificacaoItemModal = function () {};
global.svgSanitizar = function (s) { return s; };

var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_hotfix_os_materiais_espessura_extracted.tmp.js');
fs.writeFileSync(modPath, src);
var mod = require(modPath);

console.log('\n=== HOTFIX 2026-08-16 (P0.5-P0.6) — múltiplas espessuras/materiais visíveis na OS ===\n');

// ── osItemMateriaisResumo ───────────────────────────────────────────────────
test('1. item com peças automáticas 3mm + peça manual 4mm → resumo "Acrílico Cristal 3mm + Acrílico Cristal 4mm"', function () {
  var item = {
    mat: 'Acrílico Cristal',
    pieces: [
      { nome: 'Lateral', qty: 2, esp: 3, espessuraMm: 3, origem: 'AUTOMATICA' },
      { nome: 'Base', qty: 1, esp: 3, espessuraMm: 3, origem: 'AUTOMATICA' },
      { nome: 'Peça 1', qty: 1, esp: 4, espessuraMm: 4, origem: 'MANUAL' },
    ]
  };
  assertEq(mod.osItemMateriaisResumo(item), 'Acrílico Cristal 3mm + Acrílico Cristal 4mm');
});

test('2. três espessuras (3/4/5mm) sem duplicar', function () {
  var item = {
    mat: 'Acrílico Cristal',
    pieces: [
      { nome: 'A', qty: 1, esp: 3, espessuraMm: 3 },
      { nome: 'B', qty: 1, esp: 3, espessuraMm: 3 }, // repetida — não deve duplicar
      { nome: 'C', qty: 1, esp: 4, espessuraMm: 4 },
      { nome: 'D', qty: 1, esp: 5, espessuraMm: 5 },
    ]
  };
  assertEq(mod.osItemMateriaisResumo(item), 'Acrílico Cristal 3mm + Acrílico Cristal 4mm + Acrílico Cristal 5mm');
});

test('3. todas as peças com a mesma espessura → resumo com uma só entrada (sem "+" redundante)', function () {
  var item = { mat: 'Acrílico Cristal', pieces: [{ nome: 'A', esp: 3, espessuraMm: 3 }, { nome: 'B', esp: 3, espessuraMm: 3 }] };
  assertEq(mod.osItemMateriaisResumo(item), 'Acrílico Cristal 3mm');
});

test('4. item sem peças detalhadas (OS antiga, ou item Vitre/catálogo) → cai no fallback item.mat', function () {
  assertEq(mod.osItemMateriaisResumo({ mat: 'Acrílico Cristal 3mm', pieces: [] }), 'Acrílico Cristal 3mm');
  assertEq(mod.osItemMateriaisResumo({ mat: null, pieces: [] }), '—');
  assertEq(mod.osItemMateriaisResumo(null), '—');
});

test('5. usa recipeSnapshot.pecas quando item.pieces está vazio (compatibilidade com OS antigas)', function () {
  var item = { mat: 'Acrílico Cristal', pieces: [], recipeSnapshot: { pecas: [{ nome: 'A', esp: 3, espessuraMm: 3 }, { nome: 'B', esp: 4, espessuraMm: 4 }] } };
  assertEq(mod.osItemMateriaisResumo(item), 'Acrílico Cristal 3mm + Acrílico Cristal 4mm');
});

// ── osProjecaoOperacionalItem ────────────────────────────────────────────────
test('6. mat congelado na OS já é o resumo completo (não a string única do item)', function () {
  var item = {
    tipoItem: 'personalizado_vr', prod: 'Caixa', qty: '1', mat: 'Acrílico Cristal',
    pieces: [{ nome: 'Lateral', esp: 3, espessuraMm: 3 }, { nome: 'Peça 1', esp: 4, espessuraMm: 4 }]
  };
  var congelado = mod.osProjecaoOperacionalItem(item);
  assertEq(congelado.mat, 'Acrílico Cristal 3mm + Acrílico Cristal 4mm');
  // dado operacional continua todo presente
  assertEq(congelado.pieces, item.pieces);
});

test('7. item Vitre/catálogo sem mat/pieces não quebra — cai em "—" sem lançar exceção', function () {
  var item = { tipoItem: 'vitre_catalogo', prod: 'Placa X', qty: '1' };
  var congelado = mod.osProjecaoOperacionalItem(item);
  assertEq(congelado.mat, '—');
});

// ── kbAbrirPlanificacaoItem — coluna Esp. ────────────────────────────────────
function abrirPlanificacaoHtml(pecas) {
  global.KB_OS = { OS1: { itens: [{ pieces: pecas }] } };
  global._kbOsId = 'OS1';
  global._lastInsertedHtml = '';
  mod.kbAbrirPlanificacaoItem(0);
  return global._lastInsertedHtml;
}

test('8. peça automática com esp:"" mas espessuraMm:3 → coluna mostra "3mm" (não "mm" sem número)', function () {
  var html = abrirPlanificacaoHtml([{ nome: 'Lateral', larg: 20, alt: 20, qty: 2, esp: '', espessuraMm: 3 }]);
  assertTrue(html.indexOf('>3mm<') >= 0, 'deveria conter ">3mm<" — obtido: ' + html);
  assertTrue(html.indexOf('>mm<') === -1, 'não pode conter "mm" sem número — bug original');
});

test('9. peça manual com esp já numérico → continua mostrando corretamente (sem regressão)', function () {
  var html = abrirPlanificacaoHtml([{ nome: 'Peça 1', larg: 20, alt: 20, qty: 1, esp: 4, espessuraMm: 4 }]);
  assertTrue(html.indexOf('>4mm<') >= 0, 'deveria conter ">4mm<" — obtido: ' + html);
});

test('10. peça sem esp E sem espessuraMm → mostra "—" (nunca "mm" vazio)', function () {
  var html = abrirPlanificacaoHtml([{ nome: 'Peça sem espessura', larg: 10, alt: 10, qty: 1 }]);
  assertTrue(html.indexOf('>—<') >= 0, 'deveria conter ">—<" — obtido: ' + html);
  assertTrue(html.indexOf('>mm<') === -1, 'não pode conter "mm" sem número');
});

test('11. espessura 0 é um valor válido (chapa fininha) — não deve cair no fallback "—"', function () {
  var html = abrirPlanificacaoHtml([{ nome: 'Peça 0mm', larg: 10, alt: 10, qty: 1, esp: 0, espessuraMm: 0 }]);
  assertTrue(html.indexOf('>0mm<') >= 0, 'espessura 0 deveria renderizar "0mm" — obtido: ' + html);
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
fs.unlinkSync(modPath);
if (failed > 0) process.exitCode = 1;
