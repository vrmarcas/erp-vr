/**
 * test_planificacao_qty_override_reconciliacao_2026-11-12.js
 *
 * ACHADO REAL (smoke de produção pós-deploy, 2026-11-12) — usuário
 * reportou que o bug "peça automática excluída volta ao clicar
 * '+ Adicionar Peça'" continuava, mesmo depois do fix de troca de
 * material (_planResincronizarPecasHerdadas, 2026-11-10/11). Investigação
 * exaustiva (ver test_planificacao_peca_excluida_persistente_2026-11-10.js,
 * 11/11, inclusive nomes duplicados e reabertura) confirmou que a
 * exclusão PLENA (_deleted:true via 🗑) já era preservada corretamente em
 * TODOS os caminhos testados.
 *
 * CAUSA RAIZ REAL (achado novo): _planReconcilePieces() — a função que
 * roda em TODA reconciliação dentro da mesma sessão de edição ("+
 * Adicionar Peça", excluir outra peça, editar consumível) — preservava
 * _deleted/dimOverride/espOverride/adesivo/gravação/spray/extra de
 * `prev`, mas NUNCA `qty`: a quantidade sempre vinha da receita fresca
 * (pc.qty). Reduzir manualmente a quantidade de uma peça automática (ex.:
 * receita manda 2 "Lateral", vendedor edita para 1 em vez de excluir a
 * peça inteira) era revertido pela PRÓXIMA reconciliação — sintoma
 * idêntico ao relatado: "a peça volta" (volta com a quantidade da
 * receita, não com a reduzida pelo vendedor).
 *
 * Corrigido: mesmo padrão do dimOverride (já existente) — um novo
 * `qtyOverride`, setado por _planEditField ao editar o campo qty, agora
 * congela a quantidade em _planReconcilePieces() (e é propagado por
 * _planSeedFromPersisted/_planHidratarDireto para sobreviver a reabrir).
 *
 * Testa as funções REAIS extraídas de index.html — nunca reimplementadas.
 *
 * Uso: node scripts/test_planificacao_qty_override_reconciliacao_2026-11-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var fnPieceSlug = extractFn('_planPieceSlug');
var fnPecaAdesivos = extractFn('_planPecaAdesivos');
var fnReconcile = extractFn('_planReconcilePieces');
var fnSeedFromPersisted = extractFn('_planSeedFromPersisted');
var fnEditField = extractFn('_planEditField');
var fnRecompute = extractFn('_planRecompute');
var fnDeltaEspecifico = extractFn('_planDeltaEspecificoPecas');
var fnPecaEspOverride = extractFn('_planPecaEspOverride');

function makeDom() {
  var store = {};
  function el(id) {
    if (!store[id]) store[id] = { id: id, value: '', textContent: '', dataset: {}, style: {} };
    return store[id];
  }
  return { getElementById: function (id) { return el(id); } };
}

var src = [
  'var _planEditPieces = [];',
  'var planManualPieces = [];',
  'var _planIdx = 0;',
  'var ORC_MATS = [];',
  'function _matGetRsm2(){ return 100; }',
  'function planDrawCanvas(){}',
  'var _cfgData = { financeiro: { overhead: 41.16, vrml: 20, impostos: 0 } };',
  fnPieceSlug, fnPecaAdesivos, fnPecaEspOverride, fnReconcile, fnSeedFromPersisted, fnDeltaEspecifico, fnRecompute, fnEditField,
  'module.exports = {',
  '  setPieces: function (p) { _planEditPieces = p; },',
  '  getPieces: function () { return _planEditPieces; },',
  '  reconciliar: function (freshPieces, espMm) { _planEditPieces = _planReconcilePieces(freshPieces, espMm); return _planEditPieces; },',
  '  editarQty: function (pci, novoValor) {',
  '    var input = { dataset: { planf: "qty", pci: String(pci) }, value: String(novoValor) };',
  '    _planEditField(input);',
  '  },',
  '  seedFromPersisted: function (freshPieces, planPecasJson, espMm) { _planEditPieces = _planSeedFromPersisted(freshPieces, planPecasJson, espMm); return _planEditPieces; },',
  '};',
].join('\n\n');

var modPath = path.join(__dirname, '_test_qty_override_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
global.document = makeDom();
var mod = require(modPath);
try { fs.unlinkSync(modPath); } catch (e) {}

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

console.log('\n=== qty editada manualmente sobrevive a qualquer reconciliação (achado real 2026-11-12) ===\n');

// Receita fixture: 2 peças "Lateral" (qty=2) + 1 "Tampa" (qty=1) — mesmo
// padrão real de receitas tipo Caixa/Armário.
var RECEITA = [
  { nome: 'Lateral', larg: 30, alt: 20, qty: 2 },
  { nome: 'Tampa', larg: 25, alt: 25, qty: 1 },
];

// 1. Geração inicial — Lateral com qty=2 (a receita manda 2)
mod.reconciliar(RECEITA, 3);
var lateralIdx = mod.getPieces().findIndex(function (p) { return p.nome === 'Lateral'; });
ok('1. geração inicial: Lateral vem com qty=2 (igual à receita)', mod.getPieces()[lateralIdx].qty === 2, 'obtido=' + mod.getPieces()[lateralIdx].qty);

// 2. Vendedor reduz manualmente a quantidade de Lateral para 1 (em vez de
// excluir a peça inteira) — mesma ação real: editar o campo qty na linha.
mod.editarQty(lateralIdx, 1);
ok('2. depois de editar: qty=1 e qtyOverride=true', mod.getPieces()[lateralIdx].qty === 1 && mod.getPieces()[lateralIdx].qtyOverride === true, 'obtido=' + JSON.stringify(mod.getPieces()[lateralIdx]));

// 3. "+ Adicionar Peça" (ou qualquer outra ação) dispara nova
// reconciliação — qty=1 NUNCA pode voltar para 2 (receita).
mod.reconciliar(RECEITA, 3);
var p3 = mod.getPieces().find(function (p) { return p.nome === 'Lateral'; });
ok('3. depois de "+ Adicionar Peça" (reconciliação): Lateral continua qty=1 — NUNCA volta a 2', p3.qty === 1, 'obtido=' + p3.qty);

// 4. Reconciliações repetidas (excluir outra peça, consumível, etc.)
// continuam respeitando o override.
mod.reconciliar(RECEITA, 3);
mod.reconciliar(RECEITA, 3);
var p4 = mod.getPieces().find(function (p) { return p.nome === 'Lateral'; });
ok('4. múltiplas reconciliações seguidas: qty continua 1', p4.qty === 1, 'obtido=' + p4.qty);

// 5. Tampa (nunca editada) continua respondendo normalmente à receita —
// o override é POR PEÇA, nunca global.
var pTampa = mod.getPieces().find(function (p) { return p.nome === 'Tampa'; });
ok('5. Tampa (nunca editada) não tem qtyOverride e segue a receita (qty=1)', pTampa.qty === 1 && !pTampa.qtyOverride, 'obtido=' + JSON.stringify(pTampa));

// 6. Salvar (snapshot persistido) e reabrir (seedFromPersisted) preserva
// qty=1 E o próprio override (para uma reconciliação FUTURA, já na
// sessão reaberta, continuar respeitando).
var snapshotPersistido = JSON.stringify(mod.getPieces().map(function (p) { return Object.assign({}, p, { origem: 'AUTOMATICA' }); }));
mod.seedFromPersisted(RECEITA, snapshotPersistido, 3);
var p6 = mod.getPieces().find(function (p) { return p.nome === 'Lateral'; });
ok('6. reabrir (seed do snapshot persistido): Lateral continua qty=1', p6.qty === 1, 'obtido=' + p6.qty);
ok('6b. qtyOverride sobrevive à reabertura (para a próxima reconciliação dentro da sessão reaberta)', p6.qtyOverride === true, 'obtido=' + JSON.stringify(p6));

// 7. Depois de reaberto, nova reconciliação ("+ Adicionar Peça" de novo)
// ainda respeita a qty=1 — exatamente o caminho real completo:
// excluir/reduzir → salvar → reabrir → "+ Adicionar Peça" de novo.
mod.reconciliar(RECEITA, 3);
var p7 = mod.getPieces().find(function (p) { return p.nome === 'Lateral'; });
ok('7. depois de reaberto + nova reconciliação: Lateral continua qty=1 — nunca ressuscita para 2', p7.qty === 1, 'obtido=' + p7.qty);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
process.exit(failed > 0 ? 1 : 0);
