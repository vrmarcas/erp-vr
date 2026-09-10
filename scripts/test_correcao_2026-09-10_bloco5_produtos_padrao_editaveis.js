/**
 * test_correcao_2026-09-10_bloco5_produtos_padrao_editaveis.js
 *
 * RODADA DE CORREÇÃO 2026-09-10, Bloco 5 — a auditoria confirmou que
 * "Produtos Padrão (somente leitura)" continuava, de fato, somente
 * leitura: criar um produto com o mesmo nome em "Meus Produtos
 * Cadastrados" tecnicamente já sobrescrevia a receita, mas não era o que
 * foi pedido — o usuário quer editar/desativar/reativar/renomear um
 * Produto Padrão diretamente, sem duas listas paralelas.
 *
 * Corrigido:
 *  - _planProdListaUnificada() mescla customs + um "virtual" por built-in
 *    ainda não customizado (uma lista só, nunca duas verdades).
 *  - planGetRecipe() herda geometria do PLAN_RECIPES original
 *    (custom.builtinKey) enquanto custom.pecas estiver vazio — editar
 *    nome/descrição/ativo de um Produto Padrão nunca exige reimplementar
 *    a fórmula.
 *  - orcProdutosCanonicos() tinha um bug latente: desativar um produto
 *    não impedia o nome de "ressuscitar" pela lista legado (ORC_PRODUTOS,
 *    que inclui todos os built-ins) — corrigido.
 *  - planProdDel() nunca mais apaga de vez um produto vindo de um Produto
 *    Padrão (builtinKey) nem um custom já usado em orçamento enviado
 *    (histórico) — sempre sugere Desativar nesses casos.
 *
 * Extrai as funções reais AO VIVO de index.html — falha no código
 * anterior (funções/campos novos não existiam), passa depois da correção.
 *
 * Uso: node scripts/test_correcao_2026-09-10_bloco5_produtos_padrao_editaveis.js
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
function extractVarBlock(name) {
  var marker = 'var ' + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error(name + ' não encontrado — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1) + ';';
}

console.log('\n=== Bloco 5 — Produtos Padrão editáveis, fonte única ===\n');

// ══════════════════════════════════════════════════════════════════════
// GRUPO 1 — planGetRecipe(): herda geometria do built-in via builtinKey
// ══════════════════════════════════════════════════════════════════════
(function () {
  var src = [
    extractVarBlock('PLAN_RECIPES'),
    'var PLAN_BUILTIN_NAMES = Object.keys(PLAN_RECIPES);',
    'var _PLAN_PROD_DATA = global.__PLAN_PROD_DATA__;',
    'function planProdLoad(){ return _PLAN_PROD_DATA.slice(); }',
    extractFn('receitaResolverParaCalculo'),
    extractFn('receitaFormulaAvaliar'),
    extractFn('planEvalFormulaCtx'),
    extractFn('planGetRecipe'),
    'module.exports = { planGetRecipe: planGetRecipe, PLAN_RECIPES: PLAN_RECIPES };'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_correcao_2026-09-10_bloco5_recipe_extracted.tmp.js');
  fs.writeFileSync(modPath, src);

  global.__PLAN_PROD_DATA__ = [
    { id: 'pp1', nome: 'Caixa', desc: 'Caixa renomeada', dim3d: true, pecas: [], builtinKey: 'Caixa', ativo: 1 }
  ];
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  test('1.1 — editar só nome/desc (pecas=[]) de um Produto Padrão: geometria continua vindo de PLAN_RECIPES (Frente/Fundo correta, já com o fix do Bloco 4)', function () {
    var rec = mod.planGetRecipe('Caixa', null);
    var pecas = rec.pieces(8, 8, 20, 0.3);
    var ff = pecas.find(function (p) { return p.nome === 'Frente/Fundo'; });
    assertEq([ff.larg, ff.alt], [8, 20], 'BUG: geometria não foi herdada do built-in — Frente/Fundo deveria ser 8×20 (C×A)');
  });

  test('1.2 — desc customizada é respeitada mesmo herdando a geometria', function () {
    var rec = mod.planGetRecipe('Caixa', null);
    assertEq(rec.desc, 'Caixa renomeada', 'BUG: desc customizada foi ignorada');
  });

  test('1.3 — assim que o usuário adiciona peça própria (pecas não-vazio), a geometria custom passa a mandar, não mais o built-in', function () {
    global.__PLAN_PROD_DATA__[0].pecas = [{ qty: '1', nome: 'Painel único', larg: 'L', alt: 'A' }];
    delete require.cache[require.resolve(modPath)];
    var mod2 = require(modPath);
    var rec = mod2.planGetRecipe('Caixa', null);
    var pecas = rec.pieces(10, 5, 0, 0.3);
    assertEq(pecas.length, 1, 'BUG: peça customizada não sobrescreveu a geometria herdada do built-in');
    assertEq(pecas[0].nome, 'Painel único', 'BUG: peça customizada não foi usada');
  });
})();

// ══════════════════════════════════════════════════════════════════════
// GRUPO 2 — _planProdListaUnificada(): fonte única, sem duas verdades
// ══════════════════════════════════════════════════════════════════════
(function () {
  var src = [
    extractVarBlock('PLAN_RECIPES'),
    'var PLAN_BUILTIN_NAMES = Object.keys(PLAN_RECIPES);',
    'var _PLAN_PROD_DATA = global.__PLAN_PROD_DATA2__;',
    'function planProdLoad(){ return _PLAN_PROD_DATA.slice(); }',
    extractFn('_planProdListaUnificada'),
    'module.exports = { listar: _planProdListaUnificada };'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_correcao_2026-09-10_bloco5_lista_extracted.tmp.js');
  fs.writeFileSync(modPath, src);

  test('2.1 — sem nenhum custom: cada built-in aparece uma única vez, como entrada virtual (id="builtin:<nome>")', function () {
    global.__PLAN_PROD_DATA2__ = [];
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    var lista = mod.listar();
    var caixa = lista.filter(function (p) { return p.nome === 'Caixa'; });
    assertEq(caixa.length, 1, 'Caixa deve aparecer exatamente 1 vez');
    assertEq(caixa[0].id, 'builtin:Caixa', 'entrada virtual deve ter id="builtin:Caixa"');
    assertEq(caixa[0]._virtual, true, 'entrada virtual deve estar marcada como _virtual');
  });

  test('2.2 — renomear um Produto Padrão ("Caixa"→"Caixa Acrílica", builtinKey="Caixa") não deixa "Caixa" reaparecer como linha virtual separada', function () {
    global.__PLAN_PROD_DATA2__ = [
      { id: 'pp1', nome: 'Caixa Acrílica', desc: 'x', dim3d: true, pecas: [], builtinKey: 'Caixa', ativo: 1 }
    ];
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    var lista = mod.listar();
    var nomes = lista.map(function (p) { return p.nome; });
    assertTrue(nomes.indexOf('Caixa Acrílica') >= 0, 'BUG: "Caixa Acrílica" (renomeada) deveria estar na lista');
    assertTrue(nomes.indexOf('Caixa') < 0, 'BUG: "Caixa" original voltou a aparecer como linha separada depois de renomeada — duas verdades');
  });

  test('2.3 — um custom genuinamente novo (sem builtinKey) convive normalmente com os virtuais', function () {
    global.__PLAN_PROD_DATA2__ = [
      { id: 'pp2', nome: 'AUDITORIA TESTE PRODUTO SIMPLES', desc: '', dim3d: false, pecas: [], ativo: 1 }
    ];
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    var lista = mod.listar();
    var nomes = lista.map(function (p) { return p.nome; });
    assertTrue(nomes.indexOf('AUDITORIA TESTE PRODUTO SIMPLES') >= 0, 'produto custom simples deve aparecer na lista');
    assertTrue(nomes.indexOf('Caixa') >= 0, 'built-ins não tocados continuam aparecendo (virtuais)');
  });
})();

// ══════════════════════════════════════════════════════════════════════
// GRUPO 3 — orcProdutosCanonicos(): desativar realmente esconde (mesmo built-in)
// ══════════════════════════════════════════════════════════════════════
(function () {
  var src = [
    extractFn('orcProdutosCanonicos'),
    'module.exports = { orcProdutosCanonicos: orcProdutosCanonicos };'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_correcao_2026-09-10_bloco5_canonicos_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  test('3.1 — desativar um produto derivado de built-in (builtinKey) impede o nome de reaparecer via a lista legado (achado real durante a correção)', function () {
    var planProdList = [{ nome: 'Caixa', ativo: 0, builtinKey: 'Caixa' }];
    var orcProdutosLegado = ['Caixa', 'Armário']; // legado inclui todos os built-ins, sempre
    var lista = mod.orcProdutosCanonicos(planProdList, orcProdutosLegado);
    assertTrue(lista.indexOf('Caixa') < 0, 'BUG: "Caixa" desativada voltou a aparecer, ressuscitada pela lista legado');
    assertTrue(lista.indexOf('Armário') >= 0, 'produtos não relacionados continuam normalmente na lista');
  });

  test('3.2 — REGRESSÃO: produto customizado ativo continua aparecendo normalmente', function () {
    var lista = mod.orcProdutosCanonicos([{ nome: 'Caixa Especial' }], []);
    assertTrue(lista.indexOf('Caixa Especial') >= 0, 'produto sem ativo definido deve contar como ativo');
  });
})();

// ══════════════════════════════════════════════════════════════════════
// GRUPO 4 — _planProdTemHistorico() + planProdDel(): nunca quebra histórico
// ══════════════════════════════════════════════════════════════════════
(function () {
  var src = [
    'var _ORC_ENVIADOS_DATA = global.__ENVIADOS__;',
    'function _isTestRecord(){ return false; }',
    'function orcGetEnviados(){ return _ORC_ENVIADOS_DATA.filter(function(o){ return !_isTestRecord(o); }); }',
    extractFn('_planProdTemHistorico'),
    'module.exports = { temHistorico: _planProdTemHistorico };'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_correcao_2026-09-10_bloco5_historico_extracted.tmp.js');
  fs.writeFileSync(modPath, src);

  global.__ENVIADOS__ = [
    { id: 'ORC-1', itens: [{ prod: 'Caixa' }, { prod: 'Placa' }] }
  ];
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  test('4.1 — produto usado em orçamento já enviado tem histórico detectado', function () {
    assertEq(mod.temHistorico('Caixa'), true, 'BUG: "Caixa" foi usada em ORC-1 mas não foi detectada');
  });

  test('4.2 — produto nunca usado não tem histórico', function () {
    assertEq(mod.temHistorico('AUDITORIA TESTE PRODUTO SIMPLES'), false, 'produto nunca usado não deveria ter histórico');
  });
})();

// planProdDel() com harness de DOM mínimo — confirma os dois early-returns novos
(function () {
  var src = [
    'var ORC_PRODUTOS = [];',
    'function planProdLoad(){ return global.__PROD_DATA3__.slice(); }',
    'function planProdSaveList(arr){ global.__PROD_DATA3__ = arr; global.__SAVED__ = true; }',
    'function orcGetEnviados(){ return global.__ENVIADOS3__; }',
    'function planProdRender(){}',
    'function orcRefreshProdSelects(){}',
    'function showToast(msg){ global.__LAST_TOAST__ = msg; }',
    'function cfgRenderProdutos(){}',
    'function _prodSave(){}',
    extractFn('_planProdTemHistorico'),
    extractFn('planProdDel'),
    'module.exports = { planProdDel: planProdDel, wasSaved: function(){ return !!global.__SAVED__; }, lastToast: function(){ return global.__LAST_TOAST__; } };'
  ].join('\n\n');
  var modPath = path.join(__dirname, '_correcao_2026-09-10_bloco5_del_extracted.tmp.js');
  fs.writeFileSync(modPath, src);

  test('5.1 — planProdDel() nunca apaga um produto com builtinKey (vindo de Produto Padrão) — sugere Desativar', function () {
    global.__PROD_DATA3__ = [{ id: 'pp1', nome: 'Caixa', builtinKey: 'Caixa' }];
    global.__ENVIADOS3__ = [];
    global.__SAVED__ = false;
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    mod.planProdDel('pp1');
    assertEq(mod.wasSaved(), false, 'BUG: produto com builtinKey foi excluído de verdade');
    assertTrue(/Desativar/.test(mod.lastToast() || ''), 'toast deveria orientar a usar Desativar');
  });

  test('5.2 — planProdDel() nunca apaga um produto custom já usado em orçamento enviado — sugere Desativar', function () {
    global.__PROD_DATA3__ = [{ id: 'pp2', nome: 'Produto Com Historico' }];
    global.__ENVIADOS3__ = [{ itens: [{ prod: 'Produto Com Historico' }] }];
    global.__SAVED__ = false;
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    mod.planProdDel('pp2');
    assertEq(mod.wasSaved(), false, 'BUG: produto com histórico de orçamento foi excluído de verdade');
    assertTrue(/Desativar/.test(mod.lastToast() || ''), 'toast deveria orientar a usar Desativar');
  });

  test('5.3 — REGRESSÃO: planProdDel() continua excluindo normalmente um produto custom sem builtinKey e sem histórico', function () {
    global.__PROD_DATA3__ = [{ id: 'pp3', nome: 'Produto Sem Uso' }];
    global.__ENVIADOS3__ = [];
    global.__SAVED__ = false;
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    mod.planProdDel('pp3');
    assertEq(mod.wasSaved(), true, 'produto sem builtinKey e sem histórico deve continuar podendo ser excluído de vez');
  });
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
