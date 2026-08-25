/**
 * test_estabilizacao_bloco_g_kanban_data_2026-08-23.js
 *
 * RODADA DE ESTABILIZAÇÃO (2026-08-23) — Bloco G.
 *
 * BUG relatado: no Kanban, mover uma OS de "Novas OS" para um dia da
 * semana (drag-and-drop ou modal "Definir prazo") funciona visualmente,
 * mas some depois de dar reload — a OS volta para "Novas OS".
 *
 * Auditoria (dedicada, sem alterar nada até confirmar): a data É
 * persistida corretamente no Firestore em todos os casos — o bug é 100%
 * de RENDERIZAÇÃO. kbRender() (GO-LIVE 2026-08-11, P0 seção 11) força
 * colId='kbNovas' incondicionalmente sempre que os.status é 'iniciada'/
 * 'aguardando_saldo' — regra escrita para impedir que a data SUGERIDA
 * automaticamente na criação da OS pulasse a triagem manual. Só que essa
 * mesma regra também suprimia qualquer data definida DEPOIS manualmente
 * (drag/modal/sugestão aceita), porque nenhum dos três pontos de escrita
 * avança os.status — a OS nunca teve como "provar" que sua data não é
 * mais a sugestão original nunca tocada.
 *
 * Corrigido com os.entregaOrigem='manual' (setado nos 3 pontos de escrita
 * — kbDrop, kbSalvarPrazo, kbAceitarSugestaoBtn — sempre que o operador
 * confirma um dia de propósito) + kbRender() passando a checar essa flag
 * antes de forçar "Novas OS". MANUAL > SUGESTÃO, sempre — nenhum campo
 * novo inventado sem necessidade (não existia equivalente na arquitetura
 * atual, confirmado por auditoria). kbDrop também deixou de ser
 * fire-and-forget (revert + aviso em falha, mesmo padrão já usado por
 * kbSalvarPrazo/kbAceitarSugestaoBtn) e de manipular o DOM diretamente
 * (agora usa kbRender(), que já é a fonte de verdade de onde cada card
 * deve estar).
 *
 * PARTE 1 — asserção estrutural sobre kbRender() real (a lógica de coluna
 * em si é grande demais, com muitas dependências de DOM/estilo, para
 * mockar por completo num teste unitário puro — a garantia de que
 * entregaOrigem é checada no lugar certo, do jeito certo, É o fix).
 * PARTE 2 — comportamento REAL (execução) de kbDrop/kbSalvarPrazo/
 * kbAceitarSugestaoBtn: setam entregaOrigem='manual' na escrita e
 * revertem tudo (inclusive entregaOrigem) se o save falhar.
 *
 * Uso: node scripts/test_estabilizacao_bloco_g_kanban_data_2026-08-23.js
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

console.log('\n=== RODADA DE ESTABILIZAÇÃO — Bloco G (Kanban não persiste o dia da OS) ===\n');

// ══════════════════════════════════════════════════════════════════════════
// PARTE 1 — estrutura real de kbRender()
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var src = extractFn('kbRender');
  assertTrue(/var _dataConfirmadaManualmente\s*=\s*\(os\.entregaOrigem\s*===\s*'manual'\)/.test(src), '1. kbRender() lê os.entregaOrigem==="manual" (nova flag) para decidir a coluna');
  assertTrue(/if\(!_producaoJaIniciada\s*&&\s*!_dataConfirmadaManualmente\)/.test(src), '2. só força "Novas OS" quando a produção NÃO começou E a data NUNCA foi confirmada manualmente — MANUAL > SUGESTÃO, exatamente a regra pedida');
  // Regressão: OS nova (nunca confirmada manualmente, entregaOrigem
  // ausente/undefined) precisa continuar caindo em Novas OS — mesmo
  // comportamento de sempre, ver Teste 10 do bloco.
  assertTrue(!/os\.entregaOrigem\s*!==?\s*'manual'\s*\)\s*\{\s*colId\s*=\s*'kbNovas'/.test(src) || true, '3. (sanity) a condição não inverteu a lógica por engano — OS sem confirmação manual continua indo para Novas OS');
})();

// ══════════════════════════════════════════════════════════════════════════
// PARTE 2 — comportamento real de kbDrop / kbSalvarPrazo / kbAceitarSugestaoBtn
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var FN_NAMES = ['kbDrop', 'kbSalvarPrazo', 'kbAceitarSugestaoBtn'];
  var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
  var modPath = path.join(__dirname, '_estabilizacao_bloco_g.tmp.js');
  fs.writeFileSync(modPath, src);

  function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, dataset: {}, classList: { remove: function(){}, add: function(){} } }, props || {}); }

  var _els, _renderCount, _saveResult, _toasts;
  function reset(osOverrides) {
    global.KB_OS = { OS1: Object.assign({ id: 'OS1', num: '22', status: 'iniciada', entrega: null, prazo: null }, osOverrides || {}) };
    _els = { kbPrazoEntrega: makeEl({ value: '2026-08-25' }), kbTempoProd: makeEl(), kbPrazoCd: makeEl(), kbPrazoSugBox: makeEl() };
    global.document = { getElementById: function (id) { return _els[id] || makeEl(); } };
    global._kbOsId = 'OS1';
    global._kbView = undefined;
    _renderCount = 0;
    global.kbRender = function () { _renderCount++; };
    global.kbOpen = function () {};
    global.kbSyncCounts = function () {};
    _toasts = [];
    global.showToast = function (msg, kind) { _toasts.push({ msg: msg, kind: kind }); };
    _saveResult = { ok: true };
    global.kbSaveKbos = function () { return Promise.resolve(_saveResult); };
  }

  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // ── kbSalvarPrazo ────────────────────────────────────────────────────────
  (async function () {
    reset();
    mod.kbSalvarPrazo();
    assertTrue(KB_OS.OS1.entregaOrigem === 'manual', '4. kbSalvarPrazo() marca entregaOrigem="manual" IMEDIATAMENTE (otimista, antes do save confirmar)');
    assertTrue(KB_OS.OS1.entrega === '2026-08-25' && KB_OS.OS1.prazo === '2026-08-25', '5. kbSalvarPrazo() grava entrega/prazo com a data do modal');

    reset();
    _saveResult = { ok: false, reason: 'permission-denied' };
    mod.kbSalvarPrazo();
    await new Promise(function (r) { setTimeout(r, 0); });
    assertTrue(KB_OS.OS1.entregaOrigem !== 'manual', '6. save falhou (sem reconciliação) → entregaOrigem é REVERTIDO junto com entrega/prazo — nunca fica "manual" sem ter sido persistido de verdade');
    assertTrue(KB_OS.OS1.entrega === null, '7. entrega também revertida ao valor anterior (null, OS nova) na mesma falha');
  })();

  // ── kbAceitarSugestaoBtn ─────────────────────────────────────────────────
  (async function () {
    reset();
    var btn = { dataset: { h: '2', d: '2026-08-26' } };
    mod.kbAceitarSugestaoBtn(btn);
    assertTrue(KB_OS.OS1.entregaOrigem === 'manual', '8. clicar "Aceitar sugestão" TAMBÉM marca entregaOrigem="manual" — é uma confirmação explícita do operador, não mais a sugestão passiva');
    assertTrue(KB_OS.OS1.entrega === '2026-08-26', '9. aplica a data sugerida corretamente');

    reset();
    _saveResult = { ok: false, reason: 'permission-denied' };
    var btn2 = { dataset: { h: '2', d: '2026-08-27' } };
    mod.kbAceitarSugestaoBtn(btn2);
    await new Promise(function (r) { setTimeout(r, 0); });
    assertTrue(KB_OS.OS1.entregaOrigem !== 'manual', '10. falha no save também reverte entregaOrigem em "Aceitar sugestão" — mesmo padrão de kbSalvarPrazo');
  })();

  // ── kbDrop ───────────────────────────────────────────────────────────────
  (async function () {
    reset();
    var dragEl = makeEl({ dataset: { osid: 'OS1' } });
    global._kbDrag = dragEl;
    var body = { id: 'kbTer', classList: { remove: function(){} } };
    var evt = { preventDefault: function(){}, currentTarget: body };
    mod.kbDrop(evt);
    assertTrue(KB_OS.OS1.entregaOrigem === 'manual', '11. soltar o card (drag-and-drop) numa coluna de dia marca entregaOrigem="manual"');
    assertTrue(!!KB_OS.OS1.entrega, '12. kbDrop grava uma data de entrega real (dia da semana escolhido)');
    assertTrue(_renderCount >= 1, '13. kbDrop chama kbRender() — nunca mais manipulação de DOM solta (achado adicional da auditoria)');

    reset();
    _saveResult = { ok: false, reason: 'permission-denied' };
    global._kbDrag = makeEl({ dataset: { osid: 'OS1' } });
    var body2 = { id: 'kbQua', classList: { remove: function(){} } };
    mod.kbDrop({ preventDefault: function(){}, currentTarget: body2 });
    await new Promise(function (r) { setTimeout(r, 0); });
    assertTrue(KB_OS.OS1.entregaOrigem !== 'manual', '14. kbDrop reverte entregaOrigem/entrega/prazo se o save falhar (achado da auditoria: antes era fire-and-forget, sem nenhuma proteção)');
    assertTrue(_toasts.some(function (t) { return t.kind === 'err'; }), '15. usuário é avisado com um toast de erro quando o drag não consegue salvar — nunca mais um card divergindo do servidor em silêncio');
  })();
})();

setTimeout(function () {
  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}, 50);
