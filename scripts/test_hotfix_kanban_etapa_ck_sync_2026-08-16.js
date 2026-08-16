/**
 * test_hotfix_kanban_etapa_ck_sync_2026-08-16.js
 *
 * HOTFIX 2026-08-16 — smoke visual OBRIGATÓRIO do Kanban × Todas as OS
 * encontrou um bug real: o chip de etapa no CARD do Kanban
 * (kbToggleEtapa, chamado ao clicar "Corte"/"Gravar"/etc direto no card)
 * escrevia num campo paralelo `os._etapas[key]` que NENHUM outro lugar do
 * sistema lia. O checklist do MODAL da OS (kbToggle) escreve em
 * `os._ck[i]`, e é esse campo que `kbEtapaAtual()` (coluna "Etapa" de
 * "Todas as OS") e `kbChecklistCompleto()` (gate de "Marcar como Pronta")
 * realmente leem. Resultado: marcar as 5 etapas direto no card do Kanban
 * fazia todos os chips ficarem verdes, mas "Todas as OS" continuava
 * mostrando "—" e a OS não podia ser marcada como Pronta — zero efeito
 * real, só feedback visual falso.
 *
 * Corrigido fazendo kbToggleEtapa() operar sobre o MESMO array `os._ck`
 * (por índice 0-4, mesma ordem de OPERACOES_PADRAO) que kbToggle() já usa
 * — nunca mais um campo paralelo. `os._etapas` foi removido de todo o
 * arquivo (não é mais lido nem escrito em lugar nenhum).
 *
 * Uso: node scripts/test_hotfix_kanban_etapa_ck_sync_2026-08-16.js
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

console.log('\n=== HOTFIX — Kanban card × Todas as OS: etapa via _ck único (sem _etapas) ===\n');

// ── 1. Regressão estrutural: _etapas nunca mais existe no arquivo ──────
{
  test('1. achado real corrigido: nenhuma referência a _etapas restante em index.html',
    /_etapas/.test(html), false);
}

// ── 2-8. Execução real: kbToggleEtapa/kbToggle/kbEtapaAtual/kbChecklistCompleto ──
{
  var FN_NAMES = ['kbToggleEtapa', 'kbToggle', 'kbEtapaAtual', 'kbChecklistCompleto'];
  var src = [
    "var KB_OS = {};",
    "var _kbOsId = null;",
    "function kbSaveKbos(){ return Promise.resolve({ok:true}); }",
    "function kbRenderOsList(){}",
    "function renderOsTable(){}",
    "var _fakeEl = { style:{}, textContent:'' };",
    "function document_getElementById(id){ return { classList:{toggle:function(){}}, querySelector:function(){ return {checked:false}; } }; }",
    "var document = { getElementById: document_getElementById };",
    FN_NAMES.map(extractFn).join('\n\n'),
    [
      'module.exports = {',
      '  toggleEtapa: kbToggleEtapa, toggle: kbToggle,',
      '  etapaAtual: kbEtapaAtual, checklistCompleto: kbChecklistCompleto,',
      '  setOs: function(id, os){ KB_OS[id] = os; },',
      '  setModalOsId: function(id){ _kbOsId = id; },',
      '  fakeEl: function(){ return { style:{}, textContent:"" }; },',
      '};',
    ].join('\n'),
  ].join('\n\n');
  var modPath = path.join(__dirname, '_hotfix_kanban_etapa_ck_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  var CHECKS = ['Corte', 'Gravação', 'Montagem', 'Acabamento', 'Embalagem'];

  // Cenário 1 — OS recém-criada (como orcEnvGerarOS grava: checks + _ck alinhados)
  var os1 = { id: 'os1', num: '16', status: 'aguardando_saldo', checks: CHECKS.slice(), _ck: CHECKS.map(function () { return false; }) };
  mod.setOs('os1', os1);

  // Clicar "Corte" no CARD do Kanban (índice 0) — o clique real do achado
  var el = mod.fakeEl();
  mod.toggleEtapa('os1', 0, el);
  test('2. clicar a etapa "Corte" no card do Kanban marca os._ck[0]=true (mesmo campo do modal)', os1._ck[0], true);
  test('3. o card NUNCA mais grava em os._etapas (campo removido do modelo)', '_etapas' in os1, false);
  test('4. o restante do checklist continua intacto (só o índice clicado muda)', os1._ck.slice(1), [false, false, false, false]);

  // O status ainda é "aguardando_saldo" — kbEtapaAtual() intencionalmente
  // mostra "—" antes da produção começar (ver comentário da função) — isso
  // é esperado, não é o bug. O bug era o campo nunca ser lido, não a regra
  // de quando mostrar.
  test('5. antes de iniciar produção, kbEtapaAtual() mostra "—" mesmo com Corte marcado (regra existente, não o bug)', mod.etapaAtual(os1), '—');

  // Agora simula produção iniciada — reproduz o passo "iniciar produção no
  // Kanban" do cenário 6 do usuário.
  os1.status = 'producao';
  test('6. com produção iniciada, "Todas as OS" (kbEtapaAtual) reflete o Corte marcado direto no card: mostra a PRÓXIMA etapa pendente (Gravação)', mod.etapaAtual(os1), 'Gravação');

  // Cenário 2 — marcar a mesma etapa agora pelo MODAL (kbToggle, índice 1 = Gravação)
  mod.setModalOsId('os1');
  mod.toggle(1);
  test('7. marcar "Gravação" no MODAL também escreve em os._ck (mesmo array do card) — os dois caminhos convergem', os1._ck, [true, true, false, false, false]);
  test('8. "Todas as OS" após marcar pelo modal mostra a próxima etapa pendente (Montagem) — prova bidirecional card↔modal↔tabela', mod.etapaAtual(os1), 'Montagem');

  // Cenário 3 — marcar as 5 (mix card+modal) → kbChecklistCompleto vira true
  mod.toggleEtapa('os1', 2, mod.fakeEl());
  mod.toggleEtapa('os1', 3, mod.fakeEl());
  mod.toggleEtapa('os1', 4, mod.fakeEl());
  test('9. com as 5 etapas marcadas (card+modal combinados), kbChecklistCompleto()=true — habilita "Marcar como Pronta" de verdade (não só visual)', mod.checklistCompleto(os1), true);
  test('10. kbEtapaAtual() com tudo marcado mostra "Produção concluída"', mod.etapaAtual(os1), 'Produção concluída');

  // Cenário 4 — OS Pronta/Entregue: card não pode mais alterar checklist (mesma regra do modal)
  var os2 = { id: 'os2', num: '20', status: 'pronta', checks: CHECKS.slice(), _ck: CHECKS.map(function () { return true; }) };
  mod.setOs('os2', os2);
  mod.toggleEtapa('os2', 0, mod.fakeEl());
  test('11. clicar etapa no card de uma OS "pronta" não desmarca nada (mesma trava do kbToggle do modal)', os2._ck[0], true);

  try { fs.unlinkSync(modPath); } catch (e) {}
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
