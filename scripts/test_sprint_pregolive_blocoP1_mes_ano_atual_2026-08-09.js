/**
 * test_sprint_pregolive_blocoP1_mes_ano_atual_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco P1 — o Relatório Mensal (e o filtro de Contas
 * Pagas) deve sempre abrir com o mês/ano ATUAL selecionado, nunca um
 * valor fixo no código.
 *
 * Investigação: o MÊS já era corrigido dinamicamente por
 * relSetMesAtualUmaVez() (usa finMesAtual() = new Date().getMonth()+1).
 * Achado real: o ANO continuava fixo em "2026" via atributo `selected`
 * no HTML dos selects #relMensalAno/#relContasAno — nunca lido de
 * new Date(). Corrigido estendendo a mesma função para também aplicar o
 * ano corrente real a esses dois selects (só quando existe uma <option>
 * para esse ano — nunca força um value inexistente).
 *
 * Este teste mocka um argless `new Date()` para simular anos diferentes
 * do atual (2026, 2027) e prova que o comportamento segue o relógio real,
 * não um valor fixo.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoP1_mes_ano_atual_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco P1 — Relatórios: mês/ano atual, nunca fixo ===\n');

// ── 1. Regressão estrutural: HTML ainda tem os selects com as opções esperadas ──
{
  var idx = html.indexOf('id="relMensalAno"');
  var trecho = html.slice(idx, idx + 400);
  test('1. #relMensalAno continua com opções 2025/2026/2027 (não removidas, só o auto-select deixa de depender do `selected` fixo)',
    /<option value="2025">2025<\/option>/.test(trecho) && /<option value="2026"[^>]*>2026<\/option>/.test(trecho) && /<option value="2027">2027<\/option>/.test(trecho), true);
}

// ── 2-6. Execução real: relSetMesAtualUmaVez() extraída, com Date mockado ──
var src = 'var _relMesAutoSet=false; function finMesAtual(){ return new Date().getMonth()+1; }\n\n'
  + extractFn('relSetMesAtualUmaVez')
  + '\n\nmodule.exports = { relSetMesAtualUmaVez: relSetMesAtualUmaVez, resetAutoSet: function(){ _relMesAutoSet=false; } };';
var modPath = path.join(__dirname, '_blocoP1_relmes_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeSelect(options, initialValue) {
  var opts = options.map(function (v) { return { value: String(v) }; });
  return {
    value: initialValue,
    querySelector: function (sel) {
      var m = /value="([^"]+)"/.exec(sel);
      var v = m && m[1];
      return opts.some(function (o) { return o.value === v; }) ? {} : null;
    }
  };
}

function rodar(anoSimulado, mesSimulado) {
  delete require.cache[require.resolve(modPath)];
  var _els = {
    relMensalMes: makeSelect([1,2,3,4,5,6,7,8,9,10,11,12], '1'),
    relMes: makeSelect([0,1,2,3,4,5,6,7,8,9,10,11,12], '0'),
    relContasMes: makeSelect([1,2,3,4,5,6,7,8,9,10,11,12], '1'),
    finDREMes: makeSelect([1,2,3,4,5,6,7,8,9,10,11,12], '1'),
    relMensalAno: makeSelect([2025,2026,2027], '2026'),
    relContasAno: makeSelect([2025,2026,2027], '2026')
  };
  global.document = { getElementById: function (id) { return _els[id]; } };
  var RealDate = Date;
  global.Date = function (...args) {
    if (args.length === 0) return new RealDate(anoSimulado, mesSimulado - 1, 15);
    return new RealDate(...args);
  };
  global.Date.now = RealDate.now;
  var mod = require(modPath);
  mod.resetAutoSet();
  mod.relSetMesAtualUmaVez();
  global.Date = RealDate;
  return _els;
}

var r1 = rodar(2026, 3); // simula março/2026
test('2. mês atual (março) aplicado a relMensalMes', r1.relMensalMes.value, '3');
test('3. achado real corrigido: ano atual (2026) aplicado a relMensalAno — antes ficava sempre fixo independentemente do relógio',
  r1.relMensalAno.value, '2026');
test('4. ano atual também aplicado a relContasAno (mesmo achado, mesmo filtro usado em Contas Pagas)',
  r1.relContasAno.value, '2026');

var r2 = rodar(2027, 11); // simula novembro/2027 — ano diferente do "hardcoded" 2026 original
test('5. achado real corrigido: rodando em 2027 (não mais 2026), o ano aplicado segue o relógio real — prova que não é mais um valor fixo no código',
  [r2.relMensalAno.value, r2.relContasAno.value], ['2027', '2027']);
test('6. mês (novembro) também segue o relógio nesse cenário', r2.relMensalMes.value, '11');

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
