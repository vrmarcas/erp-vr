/**
 * test_receita_consumiveis_2026-08-08.js
 *
 * RODADA 6, seção 7 — consumíveis reais (Adesivo/Adh. Branco/Impressão/
 * Spray/Extra) por receita, cada um Obrigatória/Opcional/Não-aplicável.
 * Testa as funções REAIS extraídas de index.html:
 *   receitaConsumiveisEfetivos / receitaConsumiveisValidar / orcConsumivelResolverValor
 *
 * Prova, entre outras coisas, que nada aqui reintroduz o "Adesivo/Vinil"
 * fictício removido dos Extras do item (Parte 1.2) — o catálogo usado é o
 * mesmo painel real "🧴 Consumíveis" (m_adh/m_adhb/m_imp/m_spray/m_extra).
 *
 * Uso: node scripts/test_receita_consumiveis_2026-08-08.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractVar(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

var FN_NAMES = ['receitaConsumiveisEfetivos', 'receitaConsumiveisValidar', 'orcConsumivelResolverValor'];
var src = [
  extractVar('CONSUMIVEIS_PADRAO'),
  extractVar('OPERACAO_STATUS_VALIDOS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { efetivos: receitaConsumiveisEfetivos, validar: receitaConsumiveisValidar, resolverValor: orcConsumivelResolverValor };'
].join('\n\n');
var modPath = path.join(__dirname, '_receita_consumiveis_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Consumíveis reais por receita (seção 7) ===\n');

// ── receitaConsumiveisEfetivos ───────────────────────────────────────
{
  var semConfig = mod.efetivos({});
  test('1. produto sem consumiveis tem as 5 chaves padrão, todas status=null', semConfig.map(function(c){return c.chave;}), ['adh','adhb','imp','spray','extra']);
  test('2. sem config, todo status é null', semConfig.every(function(c){return c.status===null;}), true);
  test('3. produto null não quebra', mod.efetivos(null).length, 5);
  // Confirma que o catálogo é o REAL do painel de Consumíveis, nunca um
  // "Adesivo/Vinil" fictício reintroduzido.
  test('4. nenhuma chave chamada "vinil" existe no catálogo (achado histórico: Adesivo/Vinil fictício foi removido)', semConfig.some(function(c){ return /vinil/i.test(c.chave) || /vinil/i.test(c.label); }), false);

  var comConfig = mod.efetivos({ consumiveis: { adh: 'obrigatoria', imp: 'nao_aplicavel' } });
  test('5. consumível configurado reflete o status salvo', comConfig.find(function(c){return c.chave==='adh';}).status, 'obrigatoria');
  test('6. outro consumível configurado também reflete', comConfig.find(function(c){return c.chave==='imp';}).status, 'nao_aplicavel');
  test('7. consumível NÃO configurado permanece null', comConfig.find(function(c){return c.chave==='spray';}).status, null);
}

// ── receitaConsumiveisValidar ────────────────────────────────────────
{
  test('8. sem consumiveis (undefined) é válido', mod.validar(undefined).ok, true);
  test('9. objeto vazio é válido', mod.validar({}).ok, true);
  test('10. status válido em chave válida é aceito', mod.validar({ adh: 'opcional' }).ok, true);
  test('11. todos os 3 status são aceitos em qualquer chave', ['obrigatoria','opcional','nao_aplicavel'].every(function(s){ return mod.validar({extra:s}).ok; }), true);
  test('12. chave desconhecida é rejeitada', mod.validar({ vinil: 'obrigatoria' }).ok, false);
  test('13. status desconhecido é rejeitado', mod.validar({ adh: 'sempre' }).ok, false);
}

// ── orcConsumivelResolverValor ───────────────────────────────────────
{
  test('14. receita sem config para a chave não força nada (null)', mod.resolverValor({}, 'adh'), null);
  test('15. receita com adh=obrigatoria força "sim"', mod.resolverValor({ consumiveis: { adh: 'obrigatoria' } }, 'adh'), 'sim');
  test('16. receita com adhb=nao_aplicavel força "nao"', mod.resolverValor({ consumiveis: { adhb: 'nao_aplicavel' } }, 'adhb'), 'nao');
  test('17. receita com adh=opcional não força nada (vendedor decide)', mod.resolverValor({ consumiveis: { adh: 'opcional' } }, 'adh'), null);
  test('18. produto null nunca quebra', mod.resolverValor(null, 'adh'), null);
  test('19. chave sem correspondência no catálogo nunca quebra', mod.resolverValor({ consumiveis: { adh: 'obrigatoria' } }, 'inexistente'), null);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
