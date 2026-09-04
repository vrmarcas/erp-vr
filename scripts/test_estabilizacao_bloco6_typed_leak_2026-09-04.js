/**
 * test_estabilizacao_bloco6_typed_leak_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 6 — produto digitado
 * manualmente salva "__typed__" em vez do nome real ("Aparador").
 *
 * Causa raiz confirmada: orcOnProdChange() cria um <option value="__typed__"
 * text="Aparador"> para produto personalizado — "__typed__" é um SENTINEL
 * interno de UI (identifica "este select tem um nome digitado, não uma
 * opção do catálogo"), nunca o nome em si. Vários pontos do código liam
 * `document.getElementById('oi_prod_'+idx).value` diretamente (em vez de
 * `.options[selectedIndex].text`) para obter o nome do produto — para um
 * item digitado manualmente, isso persistia/exibia a STRING LITERAL
 * "__typed__" em: salvar item (_orcSalvarOrcamentoImpl), PDF/WhatsApp/OS
 * (orcColetarItensDistribuidos), título do modal de Planificação
 * (planAbrir/planCalc), CRM (produto do lead), overlay de custos extras,
 * resumo de extras por item, e recipeSnapshot lookup.
 *
 * Corrigido: orcProdutoNomeResolvido(idxOuEl) — fonte única — resolve o
 * nome real (lendo `.text` da option quando value==='__typed__') em TODOS
 * esses pontos.
 *
 * Uso: node scripts/test_estabilizacao_bloco6_typed_leak_2026-09-04.js
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
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 6 — produto manual não vira "__typed__" ===\n');

var src = [
  extractFn('orcProdutoNomeResolvido'),
  'module.exports = { orcProdutoNomeResolvido: orcProdutoNomeResolvido };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_bloco6_typed_leak_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

function makeSelectTyped(nomeDigitado) {
  var optCatalogo = { value: 'Caixa', text: 'Caixa' };
  var optTyped = { value: '__typed__', text: nomeDigitado };
  return { value: '__typed__', selectedIndex: 1, options: [optCatalogo, optTyped] };
}
function makeSelectCatalogo(nome) {
  return { value: nome, selectedIndex: 0, options: [{ value: nome, text: nome }] };
}
function makeSelectCustomNaoConfirmado() {
  return { value: '__custom__', selectedIndex: 1, options: [{ value: 'Caixa', text: 'Caixa' }, { value: '__custom__', text: '✏️ Personalizado...' }] };
}

test('1. Produto digitado manualmente ("Aparador") resolve para o nome real, nunca "__typed__"', function () {
  global.document = { getElementById: function () { return null; } };
  var mod = require(modPath);
  var el = makeSelectTyped('Aparador');
  assertEq(mod.orcProdutoNomeResolvido(el), 'Aparador', 'deve resolver o nome digitado, não o sentinel');
});

test('2. Produto do catálogo (não digitado) continua resolvendo normalmente pelo value', function () {
  var mod = require(modPath);
  var el = makeSelectCatalogo('Caixa');
  assertEq(mod.orcProdutoNomeResolvido(el), 'Caixa', 'produto de catálogo não deve ser afetado pela correção');
});

test('3. "__custom__" (option "Personalizado..." ainda não confirmado com um nome) resolve para string vazia, nunca a label do placeholder', function () {
  var mod = require(modPath);
  var el = makeSelectCustomNaoConfirmado();
  assertEq(mod.orcProdutoNomeResolvido(el), '', '__custom__ sem nome confirmado não é um produto real');
});

test('4. Aceita idx (string/number) e resolve via document.getElementById internamente', function () {
  global.document = { getElementById: function (id) { return id === 'oi_prod_5' ? makeSelectTyped('Mesa Redonda') : null; } };
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);
  assertEq(mod.orcProdutoNomeResolvido('5'), 'Mesa Redonda', 'deve buscar o elemento por idx e resolver o nome real');
  assertEq(mod.orcProdutoNomeResolvido('999'), '', 'idx sem elemento correspondente retorna string vazia, nunca lança erro');
});

// Auditoria por regex — mesmo padrão de prova já usado nesta rodada
// (ver TESTE K em test_hotfix_orcamento_comparativo_2026-08-18.js): garante
// que os pontos CRÍTICOS realmente chamam a fonte única, não uma leitura
// direta de `.value` reintroduzida por engano numa próxima mudança.
test('5. _orcSalvarOrcamentoImpl() (persistência do item) usa orcProdutoNomeResolvido(ri), nunca lê .value direto', function () {
  var saveSrc = extractFn('_orcSalvarOrcamentoImpl');
  assertTrue(/prod:\s*orcProdutoNomeResolvido\(ri\)/.test(saveSrc), 'campo prod: deve vir de orcProdutoNomeResolvido(ri)');
  assertTrue(!/prod:\s*\(document\.getElementById\('oi_prod_'\+ri\)\|\|\{\}\)\.value/.test(saveSrc), 'não pode mais ler .value diretamente para o campo prod');
});

test('6. orcColetarItensDistribuidos() (fonte única PDF+WhatsApp+OS) usa orcProdutoNomeResolvido(idx)', function () {
  var coletarSrc = extractFn('orcColetarItensDistribuidos');
  assertTrue(/orcProdutoNomeResolvido\(idx\)/.test(coletarSrc), 'PDF/WhatsApp/OS devem resolver o nome pela fonte única, não por .value direto');
});

test('7. planAbrir()/planCalc() (título do modal de Planificação) resolvem o nome real — "📐 Planificação — __typed__" não pode mais aparecer', function () {
  var abrirSrc = extractFn('planAbrir');
  var calcSrc = extractFn('planCalc');
  assertTrue(/orcProdutoNomeResolvido/.test(abrirSrc), 'planAbrir deve usar orcProdutoNomeResolvido para o nome do produto');
  assertTrue(/orcProdutoNomeResolvido/.test(calcSrc), 'planCalc deve usar orcProdutoNomeResolvido para o nome do produto');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
