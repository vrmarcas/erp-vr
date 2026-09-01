/**
 * test_rodada_correcao_definitiva_material_fantasma_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA — bug real de produção: material "excluído"
 * na Configuração de Orçamento reaparecia como opção normal na Planificação
 * (Peças Adicionais), mesmo abrindo a tela do zero, sem edição concorrente.
 *
 * Causa raiz (investigação dedicada, 2026-09-01): cfgSave() nunca
 * confirmava se a gravação no Firestore de fato acontecia — mutava
 * _cfgData em memória e retornava undefined (nunca a Promise de
 * _cloudSave()). cfgDelRow() tratava a exclusão como concluída
 * IMEDIATAMENTE, sem esperar nada. Duas janelas concretas faziam a
 * exclusão "vazar" só localmente:
 *   1. Guard de _cfgDataLoaded (gravação bloqueada antes do Firestore
 *      carregar) — cfgSave() nem chamava _cloudSave().
 *   2. Conflito/falha de rede/permissão na transação real de _cloudSave().
 * Em qualquer um dos dois casos, o material "excluído" continuava intacto
 * no documento erp_vr/erp_config do Firestore — a próxima abertura da tela
 * (mesmo do zero) lia o documento real do servidor e o material
 * reaparecia, porque nunca tinha sido removido de verdade.
 *
 * Corrigido: cfgSave() agora SEMPRE retorna a Promise real (nunca
 * undefined) — inclusive nos dois early-returns de guard, como
 * Promise.resolve({ok:false,...}). cfgDelRow()/cfgAddRow() fazem a
 * mutação otimista (UI responde na hora, mesma UX de sempre) mas SÓ
 * consideram a operação concluída depois que cfgSave() confirma sucesso;
 * se falhar, revertem _cfgData ao estado anterior (item de volta na mesma
 * posição) e re-renderizam — nunca fingem sucesso.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * cfgSave, cfgAddRow, cfgDelRow, cfgLoad, _cfgNewMaterialId.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_material_fantasma_2026-09-01.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) { console.log('  ❌  ' + msg + '\n       esperado ' + e + '\n       obtido   ' + g); failed++; }
  else { console.log('  ✅  ' + msg); passed++; }
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
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  // CFG_DEFAULT é um objeto literal grande — varrer chaves balanceadas a
  // partir do "{" logo após o marcador, igual à extração de funções.
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Material fantasma (cfgSave/cfgDelRow/cfgAddRow) ===\n');

var src = [
  extractVar('CFG_DEFAULT'),
  extractFn('_cfgNewMaterialId'),
  extractFn('cfgLoad'),
  extractFn('cfgSave'),
  extractFn('cfgAddRow'),
  extractFn('cfgDelRow'),
].join('\n\n') + '\n\nmodule.exports = {cfgSave, cfgAddRow, cfgDelRow, cfgLoad, getCfgData: function(){ return _cfgData; }, setCfgData: function(d){ _cfgData = d; }};';
var modPath = path.join(__dirname, '_rodada_correcao_definitiva_material_fantasma.tmp.js');
fs.writeFileSync(modPath, src);

var _renderCount, _cloudSaveImpl, _toasts;
function reset(cloudSaveImpl) {
  global._cfgData = null;
  global._cfgDataLoaded = true;
  global._cloudReady = true;
  _renderCount = 0;
  global.cfgRenderTables = function () { _renderCount++; };
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  global.console = console;
  _cloudSaveImpl = cloudSaveImpl || function () { return Promise.resolve({ ok: true }); };
  global._cloudSave = function (key, data) { return _cloudSaveImpl(key, data); };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

(async function () {
  // ══════════════════════════════════════════════════════════════════════
  // 1 — cfgSave() sempre retorna uma Promise real (nunca undefined) — em
  // TODOS os caminhos, inclusive os dois early-returns de guard.
  // ══════════════════════════════════════════════════════════════════════
  reset();
  mod.setCfgData(mod.cfgLoad());
  var r1 = mod.cfgSave(mod.getCfgData());
  assertTrue(r1 && typeof r1.then === 'function', '1a. cfgSave() com sucesso retorna uma Promise (nunca undefined)');
  await r1;

  reset();
  global._cfgDataLoaded = false; // guard 1: Firestore ainda não carregou
  var r2 = mod.cfgSave(mod.cfgLoad());
  assertTrue(r2 && typeof r2.then === 'function', '1b. cfgSave() bloqueado pelo guard de _cfgDataLoaded também retorna uma Promise (nunca undefined)');
  var res2 = await r2;
  assertEq(res2.ok, false, '1c. ...e essa Promise resolve com ok:false (nunca finge sucesso)');

  reset();
  global._cloudReady = false; // guard 2: sem conexão
  var r3 = mod.cfgSave(mod.cfgLoad());
  assertTrue(r3 && typeof r3.then === 'function', '1d. cfgSave() sem _cloudReady também retorna uma Promise (nunca undefined)');
  assertEq((await r3).ok, false, '1e. ...e resolve com ok:false');

  // ══════════════════════════════════════════════════════════════════════
  // 2 — cfgDelRow(): exclusão bem-sucedida (mesma UX de sempre: some da
  // tabela na hora) e PERMANECE removida depois que o save confirma.
  // ══════════════════════════════════════════════════════════════════════
  reset(function () { return Promise.resolve({ ok: true }); });
  mod.setCfgData(mod.cfgLoad());
  var nomeAntes = mod.getCfgData().materiais[0].nome;
  var totalAntes = mod.getCfgData().materiais.length;
  mod.cfgDelRow('mat', 0);
  assertEq(mod.getCfgData().materiais.length, totalAntes - 1, '2a. cfgDelRow(): material some da tabela imediatamente (UX otimista preservada)');
  await new Promise(function (r) { setTimeout(r, 20); }); // deixa a Promise de sucesso resolver
  assertEq(mod.getCfgData().materiais.length, totalAntes - 1, '2b. ...e permanece removido depois que cfgSave() confirma sucesso — comportamento normal preservado');

  // ══════════════════════════════════════════════════════════════════════
  // 3 — ACHADO REAL: cfgDelRow() com gravação BLOQUEADA (_cfgDataLoaded
  // ainda false) — a exclusão nunca chega ao Firestore. A UI deve
  // restaurar o material removido, nunca fingir que a exclusão aconteceu.
  // ══════════════════════════════════════════════════════════════════════
  reset();
  mod.setCfgData(mod.cfgLoad());
  var nomeMaterial3 = mod.getCfgData().materiais[1].nome;
  var totalAntes3 = mod.getCfgData().materiais.length;
  global._cfgDataLoaded = false; // simula o guard real de produção
  mod.cfgDelRow('mat', 1);
  assertEq(mod.getCfgData().materiais.length, totalAntes3 - 1, '3a. Exclusão otimista some da tabela na hora (mesmo com o guard bloqueando por trás)');
  await new Promise(function (r) { setTimeout(r, 20); });
  assertEq(mod.getCfgData().materiais.length, totalAntes3, '3b. ACHADO REAL corrigido: gravação bloqueada pelo guard — material é DEVOLVIDO ao array (nunca fica "fantasmagoricamente excluído" só na UI, intacto no servidor)');
  assertEq(mod.getCfgData().materiais[1].nome, nomeMaterial3, '3c. ...na MESMA posição, com os mesmos dados — nunca reaparece corrompido/deslocado');
  assertTrue(_renderCount >= 2, '3d. cfgRenderTables() é chamado de novo após a reversão — usuário VÊ o material de volta, não fica com a tela desatualizada');

  // ══════════════════════════════════════════════════════════════════════
  // 4 — ACHADO REAL: cfgDelRow() com conflito/falha real na transação
  // (_cloudSave rejeita) — mesma garantia de reversão.
  // ══════════════════════════════════════════════════════════════════════
  reset(function () { return Promise.resolve({ ok: false, reason: 'conflito', serverData: null }); });
  mod.setCfgData(mod.cfgLoad());
  var nomeMaterial4 = mod.getCfgData().materiais[2].nome;
  var totalAntes4 = mod.getCfgData().materiais.length;
  mod.cfgDelRow('mat', 2);
  await new Promise(function (r) { setTimeout(r, 20); });
  assertEq(mod.getCfgData().materiais.length, totalAntes4, '4a. ACHADO REAL corrigido: conflito real na gravação — material também é devolvido ao array');
  assertEq(mod.getCfgData().materiais[2].nome, nomeMaterial4, '4b. ...na mesma posição');

  // ══════════════════════════════════════════════════════════════════════
  // 5 — Simétrico: cfgAddRow() com gravação que falha nunca deixa uma
  // linha "adicionada" fantasma (mesmo bug, direção oposta).
  // ══════════════════════════════════════════════════════════════════════
  reset(function () { return Promise.resolve({ ok: false, reason: 'erro' }); });
  mod.setCfgData(mod.cfgLoad());
  var totalAntes5 = mod.getCfgData().materiais.length;
  mod.cfgAddRow('cfgMatTable', 'mat');
  assertEq(mod.getCfgData().materiais.length, totalAntes5 + 1, '5a. cfgAddRow(): linha nova aparece imediatamente (UX otimista)');
  await new Promise(function (r) { setTimeout(r, 20); });
  assertEq(mod.getCfgData().materiais.length, totalAntes5, '5b. ACHADO REAL (simétrico): gravação falhou — a linha adicionada é removida de volta, nunca fica fantasma só na UI');

  // ══════════════════════════════════════════════════════════════════════
  // 6 — Regressão: exclusão com sucesso não dispara nenhum toast de erro
  // (comportamento silencioso de sempre nesse caminho feliz).
  // ══════════════════════════════════════════════════════════════════════
  reset(function () { return Promise.resolve({ ok: true }); });
  mod.setCfgData(mod.cfgLoad());
  mod.cfgDelRow('mat', 0);
  await new Promise(function (r) { setTimeout(r, 20); });
  assertEq(_toasts.length, 0, '6. Exclusão bem-sucedida não dispara nenhum toast de erro/aviso (caminho feliz silencioso, como sempre foi)');

  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
})();
