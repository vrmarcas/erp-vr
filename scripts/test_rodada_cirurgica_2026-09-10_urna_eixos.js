/**
 * test_rodada_cirurgica_2026-09-10_urna_eixos.js
 *
 * RODADA CIRÚRGICA 2026-09-10, item 1 — receita da Urna trocava os eixos:
 * Frente/Fundo usava Largura (A) em vez de Altura (P), e Base/Tampa usavam
 * Altura (P) em vez de Largura (A). Mesmo padrão de bug já corrigido na
 * Caixa (Bloco 4 / rodada 2026-09-09).
 *
 * Convenção de nomes em PLAN_RECIPES.<Produto>.pieces(L,A,P,e):
 *   L = Comprimento, A = Largura, P = Altura (confirmado via DOM real do
 *   modal de Planificação: planLarg→L "Comprimento", planAlt→A "Largura",
 *   planProf→P "Altura").
 *
 * Caso do usuário (terminologia dele: C=Comprimento, L=Largura, A=Altura):
 *   C=20, L=10, A=15  →  código: L=20, A=10, P=15
 * Esperado (nomenclatura do usuário):
 *   Laterais = 10×15 ; Frente/Fundo = 20×15 ; Base = 20×10 ; Tampa = 20×10
 *
 * Extrai PLAN_RECIPES ao vivo de index.html (não reimplementa a fórmula) e
 * também de functions-valeria/lib/recipes.js, para provar paridade.
 *
 * Uso: node scripts/test_rodada_cirurgica_2026-09-10_urna_eixos.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  if (got !== exp) throw new Error((msg || 'valores diferentes') + ' — esperado ' + exp + ', obtido ' + got);
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractVarBlock(name) {
  var marker = 'var ' + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Bloco ' + name + ' não encontrado — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(braceOpen, i + 1);
}

function loadPlanRecipesFromHtml() {
  var src = 'var PLAN_RECIPES = ' + extractVarBlock('PLAN_RECIPES') + ';\nPLAN_RECIPES;';
  var sandbox = {};
  return vm.runInNewContext(src, sandbox);
}

console.log('\n=== Urna — eixos Frente/Fundo e Base/Tampa (dimensões assimétricas C=20,L=10,A=15) ===\n');

var PLAN_RECIPES = loadPlanRecipesFromHtml();
var e = 3;
// código: L=20 (Comprimento do usuário), A=10 (Largura do usuário), P=15 (Altura do usuário)
var pieces = PLAN_RECIPES['Urna'].pieces(20, 10, 15, e);
function piece(nome) {
  var p = pieces.filter(function (x) { return x.nome === nome; });
  if (!p.length) throw new Error('peça "' + nome + '" não encontrada na receita');
  return p[0];
}

test('Lateral — larg=P-2e=9, alt=A-e=7 (eixo já estava correto, não deveria ter mudado)', function () {
  var lateral = piece('Lateral');
  assertEq(lateral.larg, 15 - 2 * e, 'Lateral.larg deveria usar Altura(P)');
  assertEq(lateral.alt, 10 - e, 'Lateral.alt deveria usar Largura(A)');
});

test('Frente/Fundo — larg=L-2e=14, alt=P-e=12 (esperado usuário: 20×15, aqui com desconto de espessura)', function () {
  var ff = piece('Frente/Fundo');
  assertEq(ff.larg, 20 - 2 * e, 'Frente/Fundo.larg deveria usar Comprimento(L)');
  assertEq(ff.alt, 15 - e, 'BUG: Frente/Fundo.alt deveria usar Altura(P), não Largura(A)');
});

test('Base — larg=L=20, alt=A=10 (esperado usuário: Base = 20×10)', function () {
  var base = piece('Base');
  assertEq(base.larg, 20, 'Base.larg deveria usar Comprimento(L)');
  assertEq(base.alt, 10, 'BUG: Base.alt deveria usar Largura(A), não Altura(P)');
});

test('Tampa — larg=L=20, alt=A=10 (esperado usuário: Tampa = 20×10)', function () {
  var tampa = piece('Tampa');
  assertEq(tampa.larg, 20, 'Tampa.larg deveria usar Comprimento(L)');
  assertEq(tampa.alt, 10, 'BUG: Tampa.alt deveria usar Largura(A), não Altura(P)');
});

// ── Paridade com functions-valeria (lib compilado) ──────────────────────
(function () {
  var libPath = path.join(__dirname, '..', 'functions-valeria', 'lib', 'recipes.js');
  if (!fs.existsSync(libPath)) {
    console.log('  ⚠️  functions-valeria/lib/recipes.js não encontrado — pulando checagem de paridade (rode `npm run build` em functions-valeria)');
    return;
  }
  test('Paridade functions-valeria — Urna.pieces(20,10,15,3) bate exatamente com index.html', function () {
    delete require.cache[require.resolve(libPath)];
    var mod = require(libPath);
    var piecesTs = mod.PLAN_RECIPES['Urna'].pieces(20, 10, 15, e);
    assertEq(JSON.stringify(piecesTs), JSON.stringify(pieces), 'divergência entre index.html e functions-valeria/recipes.ts para Urna');
  });
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
