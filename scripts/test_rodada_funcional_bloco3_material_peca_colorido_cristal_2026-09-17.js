/**
 * test_rodada_funcional_bloco3_material_peca_colorido_cristal_2026-09-17.js
 *
 * RODADA FUNCIONAL 2026-09-17, Bloco 3 — causa raiz confirmada com dado
 * real: ORC-000155 (produção, erp-vrmarcas), cliente Juliana Lobo.
 *
 * Snapshot real do item (auditoria read-only, campo a campo):
 *   item.mat = "Acrílico Cristal 3mm" (matKey "cfg_1")
 *   pieces:
 *     - "Lateral"/"Frente/Fundo"/"Tampa" (origem AUTOMATICA, esp 3, SEM
 *       matId próprio — usam o material do item, corretamente).
 *     - "Peça 1" (origem MANUAL, esp 2, matId "mat_msrsdhg1_nyfduc",
 *       precoM2 145) — resolvido no cadastro de materiais (erp_config):
 *       cfg_11 = {nome:"Acrílico Colorido 2mm", rsm2:145, id:"mat_msrsdhg1_nyfduc"}
 *       — precoM2 da peça bate exatamente com o rsm2 do material: prova
 *       que o vendedor selecionou Colorido 2mm de fato.
 *     - "Peça 2" (origem MANUAL, esp 4, matId "mat_msrsdhg1_y7gdyj",
 *       precoM2 245) — cfg_13 = {nome:"Acrílico Colorido 4mm", rsm2:245,
 *       id:"mat_msrsdhg1_y7gdyj"} — mesma prova.
 *
 * Causa raiz: osItemMateriaisResumo() nunca lia `p.matId` — montava o
 * resumo com o material do ITEM (item.mat, "Acrílico Cristal 3mm") para
 * TODAS as peças, inclusive as manuais com material próprio diferente.
 * Mensagem/PDF mostravam "Acrílico Cristal 2mm"/"Acrílico Cristal 4mm" em
 * vez do material real de cada peça.
 *
 * Corrigido: resolve o nome real via p.matId no cadastro (_cfgMateriaisReais)
 * quando presente; peça sem matId preserva o material do item, como
 * sempre (as peças automáticas da receita nunca tiveram material próprio
 * — não é regressão inventar um).
 *
 * Uso: node scripts/test_rodada_funcional_bloco3_material_peca_colorido_cristal_2026-09-17.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
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

var src = [
  extractFn('osItemMateriaisResumo'),
  'module.exports = { osItemMateriaisResumo: osItemMateriaisResumo };'
].join('\n\n');
var modPath = path.join(__dirname, '_bloco3_material_peca_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// Cadastro real (erp_config.materiais, auditado em produção 2026-09-17) —
// só as entradas relevantes ao caso, nos MESMOS índices reais (cfg_1,
// cfg_11, cfg_13) para o teste ficar honesto sobre o formato real.
var MATERIAIS_REAIS = [
  { nome: 'Acrílico Cristal 2mm', id: 'mat_msrsdhg1_aaaa01', rsm2: 100 },   // cfg_0
  { nome: 'Acrílico Cristal 3mm', id: 'mat_msrsdhg1_yyegwn', rsm2: 117.58 }, // cfg_1 — material do item no caso real
];
for (var i = 2; i < 11; i++) MATERIAIS_REAIS.push({ nome: 'Material Genérico ' + i, id: 'mat_ficticio_' + i, rsm2: 50 });
MATERIAIS_REAIS.push({ nome: 'Acrílico Colorido 2mm', id: 'mat_msrsdhg1_nyfduc', rsm2: 145 }); // cfg_11 — Peça 1
MATERIAIS_REAIS.push({ nome: 'Material Genérico 12', id: 'mat_ficticio_12', rsm2: 60 });
MATERIAIS_REAIS.push({ nome: 'Acrílico Colorido 4mm', id: 'mat_msrsdhg1_y7gdyj', rsm2: 245 }); // cfg_13 — Peça 2

global.window = global;
global._cfgDataLoaded = true;
global.cfgLoad = function () { return { materiais: MATERIAIS_REAIS }; };
global._cfgMateriaisReais = function () {
  if (!global._cfgDataLoaded) return null;
  return global.cfgLoad().materiais.filter(function (m) { return m.nome && m.nome !== 'Novo material'; });
};
var mod = require(modPath);

console.log('\n=== RODADA FUNCIONAL 2026-09-17 — Bloco 3: material da peça (caso real ORC-000155) ===\n');

// Snapshot REAL do item do ORC-000155 (auditoria de produção, 2026-09-17),
// reduzido às peças que importam para o bug (Lateral automática + 2
// peças manuais com material próprio).
var ITEM_ORC155 = {
  mat: 'Acrílico Cristal 3mm',
  matKey: 'cfg_1',
  pieces: [
    { id: 'auto_lateral', nome: 'Lateral', qty: 2, larg: 55, alt: 19, esp: 3, espessuraMm: 3, origem: 'AUTOMATICA' },
    { nome: 'Peça 1', larg: 36, alt: 48, qty: 1, esp: '2', precoM2: 145, matId: 'mat_msrsdhg1_nyfduc', espessuraMm: 2, origem: 'MANUAL' },
    { nome: 'Peça 2', larg: 26, alt: 19, qty: 1, esp: '4', precoM2: 245, matId: 'mat_msrsdhg1_y7gdyj', espessuraMm: 4, origem: 'MANUAL' }
  ]
};

test('3.1 — BUG REAL: peça manual com matId de "Acrílico Colorido 2mm" NUNCA aparece como "Cristal" no resumo', function () {
  var out = mod.osItemMateriaisResumo(ITEM_ORC155);
  assertTrue(out.indexOf('Colorido 2mm') >= 0, 'esperado "Acrílico Colorido 2mm" no resumo — obtido: ' + out);
  assertTrue(out.indexOf('Cristal 2mm') < 0, 'REGRESSÃO: peça de 2mm com material Colorido saiu como Cristal — obtido: ' + out);
});

test('3.2 — BUG REAL: peça manual com matId de "Acrílico Colorido 4mm" NUNCA aparece como "Cristal"', function () {
  var out = mod.osItemMateriaisResumo(ITEM_ORC155);
  assertTrue(out.indexOf('Colorido 4mm') >= 0, 'esperado "Acrílico Colorido 4mm" no resumo — obtido: ' + out);
  assertTrue(out.indexOf('Cristal 4mm') < 0, 'REGRESSÃO: peça de 4mm com material Colorido saiu como Cristal — obtido: ' + out);
});

test('3.3 — peça AUTOMÁTICA (sem matId próprio) continua usando o material do ITEM — "Acrílico Cristal" continua Cristal quando é o que foi de fato selecionado', function () {
  var out = mod.osItemMateriaisResumo(ITEM_ORC155);
  assertTrue(out.indexOf('Cristal 3mm') >= 0, 'peça automática (Lateral, esp 3, sem matId) deveria usar o material do item (Cristal 3mm) — obtido: ' + out);
});

test('3.4 — resumo final do item real tem as 3 variantes de material corretas (Cristal 3 + Colorido 2 + Colorido 4)', function () {
  var out = mod.osItemMateriaisResumo(ITEM_ORC155);
  assertEq(out, 'Acrílico Cristal 3mm + Acrílico Colorido 2mm + Acrílico Colorido 4mm');
});

test('3.5 — sem cadastro de materiais disponível (_cfgMateriaisReais retorna null), cai no comportamento anterior (material do item) — nunca quebra', function () {
  var savedLoaded = global._cfgDataLoaded;
  global._cfgDataLoaded = false; // simula config ainda não carregada
  var out = mod.osItemMateriaisResumo(ITEM_ORC155);
  assertTrue(out.indexOf('Cristal 2mm') >= 0, 'sem cadastro disponível, deve cair no fallback do material do item — obtido: ' + out);
  global._cfgDataLoaded = savedLoaded;
});

test('3.6 — item sem NENHUMA peça com matId (caso comum, produtos simples) mantém o comportamento de sempre, intacto', function () {
  var item = { mat: 'PS Cristal 3mm', pieces: [{ esp: 3 }, { esp: 5 }] };
  var out = mod.osItemMateriaisResumo(item);
  assertEq(out, 'PS Cristal 3mm + PS Cristal 5mm');
});

test('3.7 — duas peças de MESMA espessura mas material DIFERENTE não são mais deduplicadas incorretamente em uma só (dedup agora é por material+espessura)', function () {
  var item = {
    mat: 'Acrílico Cristal 3mm',
    pieces: [
      { nome: 'A', esp: 2, matId: 'mat_msrsdhg1_nyfduc' },  // Colorido 2mm
      { nome: 'B', esp: 2 }                                  // sem matId -> material do item, mas item é 3mm não 2mm — ainda assim usa baseLabel do item
    ]
  };
  var out = mod.osItemMateriaisResumo(item);
  assertTrue(out.indexOf('Colorido 2mm') >= 0 && out.indexOf('Cristal 2mm') >= 0, 'as duas peças de 2mm com materiais diferentes devem aparecer separadamente — obtido: ' + out);
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
