/**
 * test_hotfix_materiais_variantes_2026-08-12.js
 *
 * HOTFIX CIRÚRGICO 2026-08-12 — RESTAURAÇÃO SEGURA DO CATÁLOGO DE MATERIAIS.
 *
 * Causa raiz confirmada: os 3 pontos de merge cloud↔local de `erp_config`
 * (_cloudWatch realtime + 2 cargas iniciais) casavam materiais só por
 * `nome`, que é IDÊNTICO entre todas as espessuras de uma mesma família
 * (ex.: "Acrílico Cristal" 2mm/3mm/4mm/5mm/... todos têm nome igual, a
 * espessura vive em `esp`). Um local desatualizado (cache de uma aba que
 * só conhecia a variante 2mm) contaminava TODAS as variantes do cloud com
 * os dados dessa única entrada local — exatamente o sintoma relatado
 * (múltiplas linhas mostrando "2mm / 122×244 / R$290").
 *
 * Este teste:
 *   1. Reproduz a contaminação usando o código ANTIGO (preservado aqui
 *      verbatim, removido do index.html neste hotfix) contra o MESMO
 *      fixture — prova que o bug era real e exatamente esse mecanismo.
 *   2. Executa o código NOVO — extraído REAL do index.html atual, nunca
 *      reimplementado — contra o mesmo fixture, provando que 2mm/3mm/4mm
 *      (e Colorido) permanecem intactos.
 *   3. Testa edição isolada: alterar SOMENTE Cristal 4mm e re-mesclar não
 *      pode alterar nenhuma outra variante (essencial pois o bug era
 *      reativo/recorrente, disparava a cada snapshot do Firestore).
 *   4. Testa o backfill de id determinístico (nunca reordena, nunca
 *      reaproveita id existente).
 *
 * Uso: node scripts/test_hotfix_materiais_variantes_2026-08-12.js
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

console.log('\n=== HOTFIX CIRÚRGICO — Materiais: merge por id estável (nunca por nome sozinho) ===\n');

var FN_NAMES = ['_cfgFindMaterialMatch', '_cfgNewMaterialId', '_cfgMergeMateriais', '_cfgBackfillMaterialIds'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_materiais_variantes_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ── Código ANTIGO (removido neste hotfix) — preservado verbatim aqui só
// para provar, por execução real, que o mecanismo do bug era este. Fonte:
// _cloudWatch("erp_config", ...) antes deste hotfix (BUG #31, local vence).
function oldBuggyMergeLocalWins(cloudArr, localArr) {
  var merged = cloudArr.map(function (cm) {
    var lm = localArr.find(function (lx) { return lx.nome === cm.nome; });
    if (lm) return Object.assign({}, cm, lm);
    return cm;
  });
  localArr.forEach(function (lm) {
    if (!merged.find(function (x) { return x.nome === lm.nome; })) merged.push(lm);
  });
  return merged;
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ── Fixture 1: Acrílico Cristal — exatamente o caso do usuário ──
var cristalCloud = [
  { id: 'c2', nome: 'Acrílico Cristal', esp: 2, comp: 122, larg: 244, custo: 290, unidade: 'm²', obs: '' },
  { id: 'c3', nome: 'Acrílico Cristal', esp: 3, comp: 122, larg: 244, custo: 350, unidade: 'm²', obs: '' },
  { id: 'c4', nome: 'Acrílico Cristal', esp: 4, comp: 122, larg: 244, custo: 450, unidade: 'm²', obs: '' },
];
// Local desatualizado: cache de uma aba/sessão que só conhecia a variante
// 2mm (sem id — simula registro legado, anterior ao backfill).
var cristalLocalStale = [
  { nome: 'Acrílico Cristal', esp: 2, comp: 122, larg: 244, custo: 290, unidade: 'm²', obs: '' },
];

console.log('--- Fixture Acrílico Cristal (2mm/R$290, 3mm/R$350, 4mm/R$450) ---');
{
  var oldResult = oldBuggyMergeLocalWins(clone(cristalCloud), clone(cristalLocalStale));
  ok('1a. [PRÉ-FIX] código antigo CONTAMINA: todas as 3 variantes viram esp=2/custo=290 (bug reproduzido)',
    oldResult.every(function (r) { return r.esp === 2 && r.custo === 290; }));

  var newResult = mod._cfgMergeMateriais(clone(cristalCloud), clone(cristalLocalStale), false);
  var m2 = newResult.find(function (r) { return r.id === 'c2'; });
  var m3 = newResult.find(function (r) { return r.id === 'c3'; });
  var m4 = newResult.find(function (r) { return r.id === 'c4'; });
  ok('1b. [PÓS-FIX] 2mm continua R$290', m2 && m2.custo === 290 && m2.esp === 2);
  ok('1c. [PÓS-FIX] 3mm continua R$350 (não contaminado pelo local stale de 2mm)', m3 && m3.custo === 350 && m3.esp === 3);
  ok('1d. [PÓS-FIX] 4mm continua R$450 (não contaminado pelo local stale de 2mm)', m4 && m4.custo === 450 && m4.esp === 4);
  ok('1e. [PÓS-FIX] nenhuma variante nova/duplicada foi criada', newResult.length === 3);
}

// ── Fixture 2: Acrílico Colorido — mesma prova, thresholds do usuário ──
var coloridoCloud = [
  { id: 'k2', nome: 'Acrílico Colorido', esp: 2, comp: 100, larg: 200, custo: 290, unidade: 'm²', obs: '' },
  { id: 'k3', nome: 'Acrílico Colorido', esp: 3, comp: 100, larg: 200, custo: 390, unidade: 'm²', obs: '' },
  { id: 'k4', nome: 'Acrílico Colorido', esp: 4, comp: 100, larg: 200, custo: 490, unidade: 'm²', obs: '' },
  { id: 'k10', nome: 'Acrílico Colorido', esp: 10, comp: 100, larg: 200, custo: 100, unidade: 'm²', obs: '' }, // valor atípico autorizado
];
var coloridoLocalStale = [
  { nome: 'Acrílico Colorido', esp: 2, comp: 100, larg: 200, custo: 290, unidade: 'm²', obs: '' },
];

console.log('\n--- Fixture Acrílico Colorido (2/3/4mm + 10mm atípico R$100) ---');
{
  var oldResult2 = oldBuggyMergeLocalWins(clone(coloridoCloud), clone(coloridoLocalStale));
  ok('2a. [PRÉ-FIX] código antigo CONTAMINA todas as 4 variantes (bug reproduzido)',
    oldResult2.every(function (r) { return r.esp === 2 && r.custo === 290; }));

  var newResult2 = mod._cfgMergeMateriais(clone(coloridoCloud), clone(coloridoLocalStale), false);
  ['k2', 'k3', 'k4', 'k10'].forEach(function (id) {
    var orig = coloridoCloud.find(function (r) { return r.id === id; });
    var got = newResult2.find(function (r) { return r.id === id; });
    ok('2b. [PÓS-FIX] ' + id + ' (esp=' + orig.esp + ') preserva custo R$' + orig.custo + ' exatamente',
      got && got.custo === orig.custo && got.esp === orig.esp);
  });
  ok('2c. [PÓS-FIX] valor atípico 10mm=R$100 não foi "corrigido por lógica" nem alterado', newResult2.find(function (r) { return r.id === 'k10'; }).custo === 100);
}

// ── Teste de edição isolada (bug era REATIVO — dispara a cada snapshot) ──
console.log('\n--- Edição isolada: alterar SOMENTE Cristal 4mm e re-mesclar (simula _cloudWatch disparando de novo) ---');
{
  var full = [
    { id: 'x2', nome: 'Acrílico Cristal', esp: 2, comp: 122, larg: 244, custo: 290, unidade: 'm²', obs: '' },
    { id: 'x3', nome: 'Acrílico Cristal', esp: 3, comp: 122, larg: 244, custo: 350, unidade: 'm²', obs: '' },
    { id: 'x4', nome: 'Acrílico Cristal', esp: 4, comp: 122, larg: 244, custo: 450, unidade: 'm²', obs: '' },
    { id: 'x5', nome: 'Acrílico Cristal', esp: 5, comp: 122, larg: 244, custo: 550, unidade: 'm²', obs: '' },
  ];
  var before = clone(full);
  var editedLocal = clone(full);
  editedLocal.find(function (r) { return r.id === 'x4'; }).custo = 999; // única edição do usuário

  // Cenário A: cloud ainda não recebeu a gravação (watch dispara com snapshot antigo)
  var mergedA = mod._cfgMergeMateriais(clone(before), editedLocal, false);
  // Cenário B: cloud já é o eco da própria gravação do usuário (save concluído)
  var mergedB = mod._cfgMergeMateriais(clone(editedLocal), editedLocal, false);

  [['A (cloud desatualizado)', mergedA], ['B (cloud = eco da gravação)', mergedB]].forEach(function (pair) {
    var label = pair[0], merged = pair[1];
    var changed4 = merged.find(function (r) { return r.id === 'x4'; });
    ok('3. [' + label + '] 4mm reflete a edição (custo=999)', changed4 && changed4.custo === 999);
    ['x2', 'x3', 'x5'].forEach(function (id) {
      var orig = before.find(function (r) { return r.id === id; });
      var got = merged.find(function (r) { return r.id === id; });
      ok('3. [' + label + '] ' + id + ' NÃO mudou (custo=' + orig.custo + ' preservado)', got && got.custo === orig.custo && got.esp === orig.esp);
    });
  });
}

// ── Backfill de id: determinístico, nunca reordena, nunca reaproveita id existente ──
console.log('\n--- Backfill de id estável ---');
{
  var arr = [
    { id: 'ja-tem', nome: 'PETG', esp: 1, custo: 200 },
    { nome: 'Aço Inox 24', esp: 0.6, custo: 350 },
    { nome: 'Latão', esp: 0.4, custo: 500 },
  ];
  var arrBefore = clone(arr);
  var changed = mod._cfgBackfillMaterialIds(arr);
  ok('4a. retorna true quando atribuiu algum id novo', changed === true);
  ok('4b. id pré-existente NUNCA é sobrescrito', arr[0].id === 'ja-tem');
  ok('4c. todas as entradas têm id após o backfill', arr.every(function (r) { return !!r.id; }));
  ok('4d. ordem do array não foi alterada (nome/esp/custo preservados na mesma posição)',
    arr[1].nome === arrBefore[1].nome && arr[1].esp === arrBefore[1].esp && arr[2].nome === arrBefore[2].nome);
  var idsUnicos = new Set(arr.map(function (r) { return r.id; }));
  ok('4e. ids gerados são únicos entre si', idsUnicos.size === arr.length);

  var changedAgain = mod._cfgBackfillMaterialIds(arr);
  ok('4f. rodar de novo é idempotente (nada muda, retorna false)', changedAgain === false);
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
