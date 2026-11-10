/**
 * test_planificacao_peca_excluida_resync_material_2026-11-10.js
 *
 * CAUSA RAIZ REAL (achado desta investigação, 2026-11-10) do bug
 * reportado pelo usuário: "eu apago uma peça automática; [...] a peça
 * que eu já apaguei volta sozinha." _planReconcilePieces()/
 * _planSeedFromPersisted() (caminho do MODAL de planificação aberto)
 * já preservam `_deleted` corretamente — provado em
 * test_planificacao_peca_excluida_persistente_2026-11-10.js (11/11,
 * inclusive reabertura e nomes duplicados).
 *
 * O bug real está em OUTRO caminho, HEADLESS (sem o modal aberto):
 * trocar o MATERIAL do item (orcMatChanged → _planResincronizarPecasHerdadas,
 * RODADA 7) resincroniza a geometria das peças automáticas herdadas lendo
 * DIRETO de row.dataset.planPecas (nunca de _planEditPieces). Para cada
 * peça da receita fresca, se ela não está no snapshot persistido (`!prev`
 * — exatamente o caso de uma peça EXCLUÍDA, já que _planBuildAllPecas()
 * nunca persiste peça _deleted), a função tratava a ausência como "peça
 * nova, nunca vista" e gravava `_deleted: false` — a peça volta,
 * silenciosamente, na troca de material (index.html, função
 * _planResincronizarPecasHerdadas, campo `_deleted: prev ? !!prev._deleted
 * : false`). Em TODO o resto do código (_planSeedFromPersisted,
 * _planHidratarDireto) a mesma ausência é tratada com a semântica
 * CORRETA e já documentada: "ausente no snapshot persistido = foi
 * excluída" (`_deleted: !saved`). Para esta função especificamente, a
 * troca de material/espessura NUNCA altera o CONJUNTO de nomes de peças
 * que a receita devolve (`rec.pieces(L,A,P,e,extra)` depende de L/A/P/
 * campos extras — nenhum dos quais `orcMatChanged` toca; só `e`/espMm
 * muda, afetando só as DIMENSÕES das peças já existentes) — logo
 * qualquer nome ausente do snapshot só pode ser uma peça deliberadamente
 * excluída, nunca uma peça legitimamente nova.
 *
 * Teste usa as funções REAIS extraídas de index.html, nunca
 * reimplementadas: _planPieceSlug, _planPecaAdesivos,
 * _planResincronizarPecasHerdadas, orcMatChanged. planGetRecipe (catálogo
 * de receitas) é um STUB controlado — mesma receita fixture A+B+C usada
 * no teste companheiro, para qualquer L/A/P.
 *
 * Uso: node scripts/test_planificacao_peca_excluida_resync_material_2026-11-10.js
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
var fnResync = extractFn('_planResincronizarPecasHerdadas');
var fnOrcMatChanged = extractFn('orcMatChanged');

function makeDom() {
  var store = {};
  function el(id) {
    if (!store[id]) {
      store[id] = {
        id: id, value: '', innerHTML: '', textContent: '', disabled: false,
        style: {}, dataset: {}, options: [], selectedIndex: 0,
      };
    }
    return store[id];
  }
  return { getElementById: function (id) { return el(id); }, _store: store };
}

var src = [
  'var ORC_MATS = [];',
  "function orcProdutoNomeResolvido(){ return 'ProdutoTesteABC'; }",
  "var _RECEITA_FIXTURE_ESP = null;",
  // Receita fixture: 3 peças (A, B, C), geometria depende de `e` (espessura
  // em cm) só nas DIMENSÕES — nunca no CONJUNTO de peças (mesmo padrão real
  // de 'Caixa'/'Armário' em PLAN_RECIPES: L-(2*e) etc, nunca uma peça
  // condicional por espessura).
  "function planGetRecipe(){ return { dim3d:false, campos:[], descontoMontagemOpcional:false, pieces: function(L,A,P,e){ return [ {nome:'A', larg:30-(2*e), alt:30, qty:1}, {nome:'B', larg:20-(2*e), alt:20, qty:1}, {nome:'C', larg:10-(2*e), alt:10, qty:1} ]; } }; }",
  "function receitaCamposContexto(){ return { ctx:{}, faltando:[] }; }",
  "function orcRecalc(){}",
  fnPieceSlug, fnPecaAdesivos,
  fnResync,
  fnOrcMatChanged,
  'module.exports = {',
  '  montarItemComPecaExcluida: function (idx) {',
  '    // Estado persistido de uma planificação já SALVA antes, com a peça',
  '    // B deliberadamente excluída (ausente — nunca com _deleted:true,',
  '    // mesma convenção real de _planBuildAllPecas()).',
  '    var row = document.getElementById("oir_"+idx);',
  '    row.dataset.planLarg = "100"; row.dataset.planAlt = "100"; row.dataset.planProf = "";',
  '    var pecasPersistidas = [',
  '      { id:"auto_a", nome:"A", qty:1, larg:28, alt:30, esp:3, espOverride:"", tipo:"", adesivoNormal:false, adesivoBranco:false, gravacao:0, spray:0, extra:0, _deleted:false, espessuraMm:3, origem:"AUTOMATICA" },',
  '      { id:"auto_c", nome:"C", qty:1, larg:8,  alt:10, esp:3, espOverride:"", tipo:"", adesivoNormal:false, adesivoBranco:false, gravacao:0, spray:0, extra:0, _deleted:false, espessuraMm:3, origem:"AUTOMATICA" },',
  '    ];',
  '    row.dataset.planPecas = JSON.stringify(pecasPersistidas);',
  '    document.getElementById("oi_esp_"+idx).value = "3";',
  '    var matSel = document.getElementById("oi_mat_"+idx);',
  '    matSel.value = "ac3"; matSel.options = [{ text:"Acrílico Cristal 3mm", dataset:{} }]; matSel.selectedIndex = 0;',
  '  },',
  '  trocarMaterial: function (idx, novaEspMm) {',
  '    var matSel = document.getElementById("oi_mat_"+idx);',
  '    matSel.value = "ac" + novaEspMm; matSel.options = [{ text:"Acrílico "+novaEspMm+"mm", dataset:{} }]; matSel.selectedIndex = 0;',
  '    orcMatChanged(idx);',
  '  },',
  '  nomesPersistidosEfetivos: function (idx) {',
  '    var row = document.getElementById("oir_"+idx);',
  '    var pecas = JSON.parse(row.dataset.planPecas || "[]");',
  '    return pecas.filter(function(p){ return !p._deleted; }).map(function(p){ return p.nome; });',
  '  },',
  '};',
].join('\n\n');

var modPath = path.join(__dirname, '_test_resync_material_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
global.document = makeDom();
var mod = require(modPath);

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }
function setEq(desc, arr, expected) {
  var a = arr.slice().sort(), e = expected.slice().sort();
  ok(desc, JSON.stringify(a) === JSON.stringify(e), 'obtido=' + JSON.stringify(arr) + ' esperado=' + JSON.stringify(expected));
}

console.log('\n=== Troca de material NUNCA ressuscita peça automática excluída (achado real 2026-11-10, orcMatChanged→_planResincronizarPecasHerdadas) ===\n');

mod.montarItemComPecaExcluida(0);
setEq('0. estado inicial persistido (peça B já excluída antes desta sessão): A + C', mod.nomesPersistidosEfetivos(0), ['A', 'C']);

mod.trocarMaterial(0, 5); // troca de espessura 3mm → 5mm — só a GEOMETRIA deveria mudar
setEq('1. depois de trocar o material/espessura (3mm→5mm): continua A + C — B NUNCA volta', mod.nomesPersistidosEfetivos(0), ['A', 'C']);

mod.trocarMaterial(0, 8); // uma segunda troca, por garantia (não é "só na primeira vez")
setEq('2. uma SEGUNDA troca de material (5mm→8mm): continua A + C', mod.nomesPersistidosEfetivos(0), ['A', 'C']);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
