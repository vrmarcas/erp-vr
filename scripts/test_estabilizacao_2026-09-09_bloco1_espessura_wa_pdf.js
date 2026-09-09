/**
 * test_estabilizacao_2026-09-09_bloco1_espessura_wa_pdf.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-09, BLOCO 1 — espessura divergente entre
 * o cálculo do orçamento e o texto exibido ao cliente (WhatsApp/PDF): item
 * calculado em 2mm aparecia como "3mm" na mensagem/documento.
 *
 * Causa raiz confirmada: orcColetarItensDistribuidos() — fonte única de
 * itens usada tanto pelo PDF quanto pelo WhatsApp — montava o resumo de
 * material do fallback legado (item sem peças detalhadas em
 * row.dataset.planPecas) lendo a espessura de matOptSel.dataset.esp (o
 * atributo `data-esp` da <option> ATUALMENTE selecionada no dropdown ao
 * vivo do catálogo), em vez do campo oi_esp_ — a mesma fonte que
 * orcRecalc() usa para calcular o custo/preço do item. Se o dropdown
 * aponta para uma opção cujo `data-esp` diverge do que está de fato
 * aplicado ao item (ex.: catálogo reindexado, opção coincide com outra
 * espessura da mesma família), o texto ao cliente mentia a espessura
 * mesmo com o cálculo correto. Corrigido: prioriza oi_esp_ (index.html).
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_bloco1_espessura_wa_pdf.js
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

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var FN_NAMES = ['orcColetarItensDistribuidos', 'orcItemDescricaoComercial', 'osItemMateriaisResumo', 'orcProdutoNomeResolvido'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcColetarItensDistribuidos: orcColetarItensDistribuidos };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_2026-09-09_bloco1_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) {
  return Object.assign({ value: '', textContent: '', dataset: {}, options: [], selectedIndex: 0 }, props || {});
}
var _elements = {};
function reg(id, el) { _elements[id] = el; return el; }
global.window = global;
global.document = { getElementById: function (id) { return _elements[id]; }, querySelectorAll: function (sel) { return sel === '#orcItemBody tr' ? [_elements['__row0']] : []; } };
global._orcCalc = { finalPrice: 100 };
global.ORC_ITEM_OPCOES = {};

// Cenário do bug: item calculado/planificado em 2mm (oi_esp_1 = '2'), mas
// a <option> atualmente selecionada no dropdown do catálogo aponta para
// data-esp="3" (ex.: catálogo reindexado após edição em Config) — e o item
// NUNCA foi planificado em detalhe (row.dataset.planPecas vazio), caindo
// no fallback legado de matResumo.
reg('oi_prod_1', makeEl({ value: 'Caixa' }));
reg('oi_qty_1', makeEl({ value: '1' }));
reg('oi_larg_1', makeEl({ value: '' }));
reg('oi_alt_1', makeEl({ value: '' }));
reg('oi_esp_1', makeEl({ value: '2' }));
reg('oi_mat_1', makeEl({
  value: 'cfg_0', selectedIndex: 0,
  options: [{ dataset: { nome: 'Acrílico Cristal', esp: '3' }, text: 'Acrílico Cristal 3mm' }]
}));
reg('oi_det_1', makeEl({ value: '' }));
reg('oi_tot_1', makeEl({ textContent: 'R$ 100,00' }));
reg('__row0', { dataset: { idx: '1', planLarg: '', planAlt: '', planProf: '', planPecas: '[]' } });

var mod = require(modPath);

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-09 — Bloco 1: espessura WhatsApp/PDF ===\n');

test('BLOCO 1 — orcColetarItensDistribuidos() usa a espessura do item (oi_esp_), não a da <option> ao vivo do catálogo (2mm, não 3mm)', function () {
  var itens = mod.orcColetarItensDistribuidos(100);
  assertEq(itens.length, 1, 'deve haver 1 item');
  assertTrueContains(itens[0].desc, '2mm');
});
function assertTrueContains(str, sub) {
  if (String(str).indexOf(sub) < 0) throw new Error('BUG: descrição não contém "' + sub + '" — obtido: "' + str + '"');
  if (String(str).indexOf('3mm') >= 0) throw new Error('BUG: descrição contém a espessura ERRADA "3mm" (deveria ser 2mm) — obtido: "' + str + '"');
}

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
