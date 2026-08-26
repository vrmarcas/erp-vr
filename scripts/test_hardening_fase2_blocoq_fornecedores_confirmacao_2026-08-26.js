/**
 * test_hardening_fase2_blocoq_fornecedores_confirmacao_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, BLOCO Q (2026-08-26) — achado real:
 * fornSalvar() mostrava o toast "cadastrado!"/"atualizado!" e fechava o
 * modal IMEDIATAMENTE após chamar fornSaveAll(list), sem esperar a
 * confirmação real do servidor (_cloudSave já detecta e trata falha de
 * rede/permissão/conflito, mas fornSalvar() nunca olhava o resultado). Uma
 * falha nesse meio-tempo passava despercebida: o operador via "sucesso",
 * fechava o modal e seguia em frente — mas o fornecedor nunca chegou a
 * existir de verdade no servidor.
 *
 * Corrigido: fornSaveAll() agora repassa a Promise real de _cloudSave
 * (nunca dispara-e-esquece); fornSalvar() só fecha o modal/mostra sucesso
 * DEPOIS do commit confirmado (res.ok===true) e, em falha, desfaz a
 * mutação otimista local (_FORN_DATA volta ao estado anterior) e mantém o
 * modal aberto para nova tentativa — nunca finge que salvou.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * fornSalvar, fornSaveAll, fornLoad.
 *
 * Uso: node "scripts/test_hardening_fase2_blocoq_fornecedores_confirmacao_2026-08-26.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

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

console.log('\n=== HARDENING FASE 2, BLOCO Q — Fornecedores só confirma sucesso após persistência real ===\n');

var FN_NAMES = ['fornSalvar', 'fornSaveAll', 'fornLoad'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_hardening_fase2_blocoq_fornecedores.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', disabled: false }, props || {}); }
var _els, _toasts, _closed, _rendered, _cloudSaveResult;
function reset(opts) {
  opts = opts || {};
  global._FORN_DATA = (opts.existente || []).slice();
  global._cloudReady = opts.cloudReady !== false;
  _toasts = []; _closed = 0; _rendered = 0;
  _els = {
    fornNome: makeEl({ value: opts.nome !== undefined ? opts.nome : 'Acrílicos Silva Ltda' }),
    fornEditId: makeEl({ value: opts.editId || '' }),
    fornCat: makeEl({ value: 'Matéria-prima' }),
    fornCNPJ: makeEl({ value: '' }),
    fornWA: makeEl({ value: '' }),
    fornTel: makeEl({ value: '' }),
    fornEmail: makeEl({ value: '' }),
    fornObs: makeEl({ value: '' }),
  };
  var submitBtn = makeEl({});
  global.document = {
    getElementById: function (id) { return _els[id] || null; },
    querySelector: function (sel) { return sel === '#fornOverlay .gen-submit' ? submitBtn : null; },
  };
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  global.fornCloseModal = function () { _closed++; };
  global.fornRender = function () { _rendered++; };
  _cloudSaveResult = opts.cloudSaveResult || Promise.resolve({ ok: true });
  global._cloudSave = function (key, arr) { return _cloudSaveResult; };
  return submitBtn;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-4 — caminho feliz: servidor confirma → só ENTÃO fecha modal/mostra sucesso.
(function () {
  reset({ cloudSaveResult: Promise.resolve({ ok: true }) });
  return mod.fornSalvar().then(function () {
    assertTrue(_closed === 1, '1. sucesso confirmado pelo servidor: modal fecha');
    assertTrue(_rendered >= 1, '2. sucesso confirmado: lista é re-renderizada');
    assertTrue(_toasts.length === 1 && _toasts[0].tipo === 'ok' && /cadastrado/.test(_toasts[0].msg), '3. toast de sucesso só aparece depois da confirmação real (nunca antes)');
    assertTrue(global._FORN_DATA.length === 1 && global._FORN_DATA[0].nome === 'Acrílicos Silva Ltda', '4. fornecedor persiste na lista local após confirmação real');
  });
})()
// 5-8 — achado real: falha do servidor (rede/permissão/conflito) NUNCA
// mostra sucesso nem fecha o modal — desfaz a mutação otimista local.
.then(function () {
  reset({ cloudSaveResult: Promise.resolve({ ok: false, reason: 'permissao' }) });
  return mod.fornSalvar().then(function () {
    assertTrue(_closed === 0, '5. ACHADO REAL corrigido: falha do servidor NUNCA fecha o modal (antes fechava sempre, mascarando a falha)');
    assertTrue(!_toasts.some(function (t) { return t.tipo === 'ok'; }), '6. ACHADO REAL corrigido: nenhum toast de sucesso é mostrado quando a persistência real falhou');
    assertTrue(global._FORN_DATA.length === 0, '7. mutação local otimista é desfeita — fornecedor que nunca foi salvo não aparece na lista');
    assertTrue(_rendered >= 1, '8. tela é re-renderizada mesmo na falha (reflete o rollback, nunca deixa um estado visual desatualizado)');
  });
})
// 9-10 — botão de salvar fica desabilitado durante a confirmação e volta
// a ficar habilitável depois (nunca trava "Salvando..." para sempre).
.then(function () {
  var _resolveSave;
  var pendingPromise = new Promise(function (res) { _resolveSave = res; });
  var submitBtn = reset({ cloudSaveResult: pendingPromise });
  var p = mod.fornSalvar();
  assertTrue(submitBtn.disabled === true, '9. botão "Salvar Fornecedor" fica desabilitado enquanto aguarda confirmação (evita duplo clique)');
  _resolveSave({ ok: true });
  return p.then(function () {
    assertTrue(submitBtn.disabled === false, '10. botão volta a ficar habilitado depois que o servidor responde (nunca travado)');
  });
})
// 11 — edição de um fornecedor existente também só confirma depois do
// servidor responder (mesma proteção, não só criação).
.then(function () {
  reset({ existente: [{ id: 'forn1', nome: 'Nome Antigo', historico: [] }], editId: 'forn1', nome: 'Nome Corrigido', cloudSaveResult: Promise.resolve({ ok: true }) });
  return mod.fornSalvar().then(function () {
    assertTrue(global._FORN_DATA.length === 1 && global._FORN_DATA[0].nome === 'Nome Corrigido' && _closed === 1, '11. edição de fornecedor existente também segue o fluxo de confirmação real (nome atualizado só após ok:true)');
  });
})
.then(function () {
  try { fs.unlinkSync(modPath); } catch (e) {}
  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})
.catch(function (e) {
  console.error('ERRO INESPERADO:', e);
  process.exit(1);
});
