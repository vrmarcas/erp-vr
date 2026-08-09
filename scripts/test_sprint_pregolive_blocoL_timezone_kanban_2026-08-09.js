/**
 * test_sprint_pregolive_blocoL_timezone_kanban_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco L — achado real de homologação: em 09/08/2026,
 * uma OS com prazo 10/08/2026 (1 dia de diferença) mostrava "Entrega
 * hoje!" no countdown do Kanban, em vez de "Entrega amanhã".
 *
 * Causa raiz: kbSalvarPrazo() (única das 3 implementações de contagem de
 * dias do Kanban com esse bug — as outras 2 já normalizavam corretamente)
 * calculava a diferença contra `new Date()` bruto — COM a hora atual
 * embutida — em vez de meia-noite local. Dependendo da hora do dia em que
 * o vendedor salvasse o prazo, a diferença em milissegundos virava uma
 * fração de dia que Math.round arredondava para 0 mesmo quando faltava
 * quase um dia inteiro (ex.: salvar às 23h um prazo para o dia seguinte
 * às 00h dava uma diferença de ~1h = 0,04 dia → arredonda para 0).
 *
 * Este teste mocka `new Date()` para simular exatamente esse cenário
 * (hora tardia do dia) e prova que o resultado agora é sempre baseado na
 * diferença de CALENDÁRIO (dias corridos), nunca na hora do relógio.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoL_timezone_kanban_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco L — Kanban: contagem de dias independente da hora do relógio ===\n');

var src = extractFn('kbSalvarPrazo') + '\n\nmodule.exports = { kbSalvarPrazo };';
var modPath = path.join(__dirname, '_blocoL_kanban_prazo_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

function makeEl(props) { return Object.assign({ value: '', style: {}, textContent: '' }, props || {}); }

function rodarCenario(prazoISO, agoraReal) {
  var _els = { kbPrazoEntrega: makeEl({ value: prazoISO }), kbPrazoCd: makeEl({}) };
  global.document = { getElementById: function (id) { return _els[id]; } };
  global._kbOsId = 'os1';
  global.KB_OS = { os1: {} };
  global.kbRender = function () {};
  global.kbSaveKbos = function () {};
  global.showToast = function () {};

  var RealDate = Date;
  global.Date = function (...args) {
    if (args.length === 0) return new RealDate(agoraReal);
    return new RealDate(...args);
  };
  global.Date.now = RealDate.now;

  var mod = require(modPath);
  mod.kbSalvarPrazo();
  global.Date = RealDate;
  return _els.kbPrazoCd.textContent;
}

// Achado real: 09/08/2026 às 23:30 (bem tarde no dia), prazo = 10/08/2026
// (amanhã, só ~30min de diferença real de relógio, mas 1 dia de calendário).
var txt1 = rodarCenario('2026-08-10', new Date(2026, 7, 9, 23, 30, 0).getTime());
test('1. achado real corrigido: salvar prazo de amanhã às 23h30 do dia anterior mostra "Entrega amanhã", NUNCA "Entrega hoje!" (bug dependia da hora do relógio)',
  txt1, '⏰ Entrega amanhã');

// Mesmo prazo, mas salvo de manhã cedo (00:05) — deve dar o MESMO
// resultado do cenário acima (a hora do dia nunca deveria mudar a
// resposta, só a diferença de calendário entre as datas).
var txt2 = rodarCenario('2026-08-10', new Date(2026, 7, 9, 0, 5, 0).getTime());
test('2. o mesmo prazo salvo às 00h05 do mesmo dia dá o MESMO resultado — a resposta depende só da diferença de calendário, nunca da hora do relógio',
  txt2, txt1);

// Prazo é hoje mesmo — deve mostrar "hoje", não "amanhã".
var txt3 = rodarCenario('2026-08-09', new Date(2026, 7, 9, 23, 30, 0).getTime());
test('3. prazo é o próprio dia de hoje (mesmo às 23h30): mostra "Entrega hoje!" corretamente',
  txt3, '🔴 Entrega hoje!');

// Prazo já passou (atrasado).
var txt4 = rodarCenario('2026-08-08', new Date(2026, 7, 9, 0, 5, 0).getTime());
test('4. prazo de ontem: mostra "Atrasado 1 dias"', txt4, '⚠️ Atrasado 1 dias');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
