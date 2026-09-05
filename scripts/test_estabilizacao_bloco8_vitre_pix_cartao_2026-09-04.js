/**
 * test_estabilizacao_bloco8_vitre_pix_cartao_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 8 — Vitre Cartão + Pix.
 * O preço cadastrado no Catálogo Vitre (precoVenda) é sempre o preço de
 * CARTÃO (nunca alterado automaticamente); o Pix é sempre DERIVADO dele
 * por um percentual configurável — global (Configurações → Catálogo
 * Vitre → cfgLoad().vitre.pixDescontoPct) com override por orçamento
 * (nunca digitado item a item, nunca altera o catálogo).
 *
 * vitreCalcularPrecoPix(precoCartao, overridePct) — motor canônico.
 * Persistido por item no momento da venda (precoPixUnit/pixPct em
 * _orcSalvarOrcamentoImpl) — alterar o padrão global amanhã nunca muda
 * um orçamento já enviado.
 *
 * Uso: node scripts/test_estabilizacao_bloco8_vitre_pix_cartao_2026-09-04.js
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
function assertClose(got, exp, msg) {
  if (Math.abs(got - exp) > 0.01) throw new Error((msg || 'valores diferentes') + ' — esperado ≈' + exp + ', obtido ' + got);
}

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
function extractVar(name) {
  var marker = 'var ' + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1) + ';';
}

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 8 — Vitre Cartão + Pix ===\n');

var src = [
  extractVar('CFG_DEFAULT'),
  extractFn('vitreResolverDescontoPixPadrao'),
  extractFn('vitreCalcularPrecoPix'),
  'module.exports = { vitreResolverDescontoPixPadrao, vitreCalcularPrecoPix, CFG_DEFAULT };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_bloco8_vitre_pix_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function montar(cfgVitre) {
  delete require.cache[require.resolve(modPath)];
  global.cfgLoad = function () { return { vitre: cfgVitre }; };
  return require(modPath);
}

test('1. Preço-base do catálogo Vitre é sempre CARTÃO — vitreCalcularPrecoPix() nunca modifica o valor de entrada', function () {
  var mod = montar({ pixDescontoPct: 10 });
  var r = mod.vitreCalcularPrecoPix(100, null);
  assertEq(r.cartao, 100, 'cartao retornado deve ser exatamente o preço de entrada, nunca alterado');
});

test('2. Pix é SEMPRE derivado do cartão pelo percentual padrão global (nunca digitado manualmente)', function () {
  var mod = montar({ pixDescontoPct: 10 });
  var r = mod.vitreCalcularPrecoPix(100, null);
  assertClose(r.pix, 90, 'com 10% de desconto padrão, pix de R$100 cartão deve ser R$90');
  assertEq(r.percentual, 10, 'percentual aplicado deve ser o padrão global');
});

test('3. Override por orçamento tem prioridade sobre o padrão global, sem alterar o catálogo/config global', function () {
  var mod = montar({ pixDescontoPct: 10 });
  var r = mod.vitreCalcularPrecoPix(100, 20);
  assertClose(r.pix, 80, 'override de 20% deve valer sobre o padrão global de 10%');
  assertEq(r.percentual, 20, 'percentual aplicado deve ser o override');
  // config global não foi tocada — nova chamada sem override volta ao padrão
  var r2 = mod.vitreCalcularPrecoPix(100, null);
  assertEq(r2.percentual, 10, 'padrão global deve continuar 10% — override não pode ter alterado a config');
});

test('4. Override vazio ("") é tratado como "sem override" — usa o padrão global, nunca NaN/0% acidental', function () {
  var mod = montar({ pixDescontoPct: 7 });
  var r = mod.vitreCalcularPrecoPix(100, '');
  assertEq(r.percentual, 7, 'string vazia deve cair no padrão global, nunca virar 0%');
});

test('5. Percentual nunca sai do intervalo [0,100] mesmo com dado corrompido/digitado errado', function () {
  var mod = montar({ pixDescontoPct: 10 });
  var rNeg = mod.vitreCalcularPrecoPix(100, -50);
  assertEq(rNeg.percentual, 0, 'percentual negativo deve ser clampado para 0');
  var rAlto = mod.vitreCalcularPrecoPix(100, 500);
  assertEq(rAlto.percentual, 100, 'percentual acima de 100 deve ser clampado para 100');
});

test('6. Quantidade multiplica corretamente cartão E pix (qty=2 e qty=3)', function () {
  var mod = montar({ pixDescontoPct: 10 });
  var r2 = mod.vitreCalcularPrecoPix(100 * 2, null);
  assertClose(r2.cartao, 200, 'qty=2: cartão deve dobrar');
  assertClose(r2.pix, 180, 'qty=2: pix deve dobrar mantendo o mesmo desconto');
  var r3 = mod.vitreCalcularPrecoPix(100 * 3, null);
  assertClose(r3.cartao, 300, 'qty=3: cartão deve triplicar');
  assertClose(r3.pix, 270, 'qty=3: pix deve triplicar mantendo o mesmo desconto');
});

test('7. Sem configuração global nenhuma (cfgLoad().vitre ausente): cai no default de CFG_DEFAULT.vitre.pixDescontoPct, nunca erro/NaN', function () {
  delete require.cache[require.resolve(modPath)];
  global.cfgLoad = function () { return {}; };
  var mod = require(modPath);
  var r = mod.vitreCalcularPrecoPix(100, null);
  assertTrue(!isNaN(r.pix), 'pix nunca pode ser NaN mesmo sem nenhuma config salva');
  assertEq(r.percentual, mod.CFG_DEFAULT.vitre.pixDescontoPct, 'deve usar o default do próprio motor');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — persistência: alterar o padrão global amanhã não pode
// mudar um orçamento já enviado (congelado no momento da venda).
// ══════════════════════════════════════════════════════════════════════
test('8. _orcSalvarOrcamentoImpl() congela precoPixUnit/pixPct por item Vitre no momento da venda', function () {
  var src = extractFn('_orcSalvarOrcamentoImpl');
  assertTrue(/vitreCalcularPrecoPix\(/.test(src), 'deve calcular o pix no momento de salvar, usando o motor canônico');
  assertTrue(/precoPixUnit:/.test(src), 'deve persistir precoPixUnit por item');
  assertTrue(/pixPct:\s*_pixCalc\.percentual/.test(src), 'deve persistir o percentual efetivamente aplicado (congelado)');
});

test('9. orcEnvEditar() restaura o percentual Pix CONGELADO do orçamento (nunca recalcula com o padrão vigente)', function () {
  var src = extractFn('orcEnvEditar');
  assertTrue(/it\.pixPct/.test(src), 'reabertura deve ler o pixPct persistido no item, não recalcular do zero');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — orcVitreRenderLista() mostra Cartão E Pix por item
// (requisito explícito: "Para itens Vitre, mostrar Cartão / Pix").
// ══════════════════════════════════════════════════════════════════════
test('10. orcVitreRenderLista() exibe Cartão e Pix separadamente para cada item (nunca só um valor)', function () {
  var src = extractFn('orcVitreRenderLista');
  assertTrue(/vitreCalcularPrecoPix\(/.test(src), 'deve calcular pix por item para exibição');
  assertTrue(/subtotalCartao/.test(src) && /_pix\.pix/.test(src), 'deve renderizar tanto o valor de cartão quanto o de pix');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
