/**
 * test_kb_marcar_pronta_gate_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 25/67 — bug real reproduzido em produção
 * (OS #8): o botão "Marcar como Pronta" ficava disponível e clicável no
 * modal do Kanban mesmo com 0 dos 5 itens do checklist marcados; e
 * kbMarcarPronto() FORÇA-COMPLETAVA o checklist inteiro ao clicar
 * (os._ck = todos true), em vez de exigir que o funcionário realmente
 * marque as 5 etapas antes. Isso violava a regra de negócio ("Mesmo com
 * as 5 etapas marcadas: NÃO marcar automaticamente como Pronta" e o
 * inverso — nunca marcar Pronta SEM as 5 etapas).
 *
 * Corrigido: kbChecklistCompleto(os) é a fonte única de verdade; usada
 * tanto para desabilitar/ocultar visualmente o botão quanto — mais
 * importante — para BLOQUEAR kbMarcarPronto() no clique (nunca só
 * visual, ver seção 67 "concluído no código mas errado na tela").
 *
 * Uso: node scripts/test_kb_marcar_pronta_gate_2026-08-12.js
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

console.log('\n=== "Marcar como Pronta" exige as 5 etapas de verdade (gate real, não só visual) ===\n');

// ── 1. kbChecklistCompleto — função pura ──────────────────────────────
(function () {
  var src = [ extractFn('kbChecklistCompleto'), 'module.exports = { completo: kbChecklistCompleto };' ].join('\n\n');
  var modPath = path.join(__dirname, '_kb_checklist_completo.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  test('1a. 0/5 marcados → incompleto', mod.completo({ checks: ['Corte','Gravação','Montagem','Acabamento','Embalagem'], _ck: [false,false,false,false,false] }), false);
  test('1b. 4/5 marcados (falta Embalagem) → incompleto', mod.completo({ checks: ['Corte','Gravação','Montagem','Acabamento','Embalagem'], _ck: [true,true,true,true,false] }), false);
  test('1c. 5/5 marcados → completo', mod.completo({ checks: ['Corte','Gravação','Montagem','Acabamento','Embalagem'], _ck: [true,true,true,true,true] }), true);
  test('1d. checklist vazio → incompleto (nunca Pronta sem checklist real)', mod.completo({ checks: [], _ck: [] }), false);
  test('1e. os nulo → incompleto', mod.completo(null), false);

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── 2. kbMarcarPronto — bloqueia de verdade (não só visualmente) ──────
(function () {
  var toasts = [];
  var elements = {};
  function makeEl(id) { return { id: id, className: '', textContent: '', style: {}, dataset: {}, value: '' }; }
  ['kbProntoBtn','kbOsStag','kbReverterBtn','kbAvisarClienteBox','kbAvisarMsg','kbEntregarBtn'].forEach(function(id){ elements[id]=makeEl(id); });
  var mockDoc = {
    getElementById: function (id) { return elements[id] || makeEl(id); },
    querySelector: function () { return null; },
  };
  var KB_OS = {
    'osIncompleta': { status: 'producao', checks: ['Corte','Gravação','Montagem','Acabamento','Embalagem'], _ck: [true,true,true,false,false], restante: 0 },
    'osCompleta':   { status: 'producao', checks: ['Corte','Gravação','Montagem','Acabamento','Embalagem'], _ck: [true,true,true,true,true],  restante: 0 },
    'osNaoIniciada': { status: 'iniciada', checks: ['Corte','Gravação','Montagem','Acabamento','Embalagem'], _ck: [false,false,false,false,false], restante: 0 },
  };
  var src = [
    'var document = MOCK_DOC;',
    'var KB_OS = MOCK_KB_OS;',
    'var _kbOsId = null;',
    'function showToast(msg){ TOAST_LOG.push(msg); }',
    'function kbRenderChecklist(){}',
    'function renderOsTable(){}',
    'function syncSidebarBadges(){}',
    'function kbMsgOsPronta(){ return ""; }',
    'function _confirmarAposSalvar(){}',
    'function kbSaveKbos(){}',
    'var _currentSession = { funcao: "master" };',
    extractFn('kbChecklistCompleto'),
    extractFn('kbMarcarPronto'),
    'module.exports = { marcar: kbMarcarPronto, setOsId: function(id){ _kbOsId = id; }, getOs: function(id){ return KB_OS[id]; } };',
  ].join('\n\n');
  var modPath = path.join(__dirname, '_kb_marcar_pronto.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  global.MOCK_DOC = mockDoc;
  global.MOCK_KB_OS = KB_OS;
  global.TOAST_LOG = toasts;
  var mod = require(modPath);

  mod.setOsId('osIncompleta');
  mod.marcar();
  test('2a. OS com checklist incompleto (3/5) NÃO muda de status ao clicar Marcar como Pronta', mod.getOs('osIncompleta').status, 'producao');
  test('2b. checklist NÃO é força-completado (continua 3/5, nunca "todos true" silenciosamente)', mod.getOs('osIncompleta')._ck, [true,true,true,false,false]);
  test('2c. toast de aviso mostrado ao funcionário', toasts.indexOf('Marque as 5 etapas do checklist antes de marcar como Pronta.') >= 0, true);

  toasts.length = 0;
  mod.setOsId('osNaoIniciada');
  mod.marcar();
  test('2d. OS ainda não iniciada NÃO pode virar Pronta mesmo clicando o botão diretamente', mod.getOs('osNaoIniciada').status, 'iniciada');
  test('2e. toast específico de "inicie a produção"', toasts.indexOf('Inicie a produção antes de marcar como Pronta.') >= 0, true);

  toasts.length = 0;
  mod.setOsId('osCompleta');
  mod.marcar();
  test('2f. OS com checklist 5/5 completo — pode ser marcada Pronta normalmente', mod.getOs('osCompleta').status, 'pronta');

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
// Encerra antes de qualquer setTimeout pendente do _cloudSave assíncrono
// dentro de kbMarcarPronto() (fora do escopo deste teste — só a decisão
// síncrona de bloquear/permitir é testada aqui).
process.exit(failed > 0 ? 1 : 0);
