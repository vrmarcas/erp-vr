/**
 * test_rodada_cirurgica_os_2026-08-16.js
 *
 * Rodada CIRÚRGICA 2026-08-16 — cobre os 4 bugs reais corrigidos nesta
 * rodada (itens #2, #3, #4 e #6 do escopo; itens #1, #5 e #7 não tiveram
 * bug de código encontrado e por isso não geram teste novo aqui):
 *
 *  #2 — kbNormalizarChecklistLegado() nunca mais re-heala um checklist que
 *       o funcionário já customizou manualmente (os._checklistCustomizado).
 *  #3 — kbAtualizarProntoBtn(os) extraído de kbOpen() e reutilizado por
 *       kbToggle()/kbCheckAddItem()/kbCheckDeleteItem() — botão "Marcar
 *       como Pronta" reage imediatamente, sem fechar/reabrir a OS.
 *  #4 — kbSaveKbos() nunca mais persiste os locks transitórios
 *       _marcandoPronto/_liberando no Firestore; kbReverterProducao()
 *       também os reseta como rede de segurança.
 *  #6 — botão "💰 Pagamento" em renderOsTable() deixa de exigir
 *       status==='pronta' — disponível em qualquer status ativo
 *       (exceto 'cancelado') sempre que os.restante>0.
 *
 * Uso: node scripts/test_rodada_cirurgica_os_2026-08-16.js
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
function ok(desc, cond) {
  if (cond) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc); failed++; }
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
  var marker = 'var ' + name + ' = [';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf('];', start) + 2;
  return html.slice(start, end);
}

console.log('\n=== Rodada cirúrgica 2026-08-16 — checklist/Pronta/lock/pagamento de saldo ===\n');

// ── ITEM #2 — checklist customizado nunca é re-healado ──────────────────────
(function () {
  console.log('-- Item #2: kbNormalizarChecklistLegado respeita _checklistCustomizado --');
  var src = [extractVar('OPERACOES_PADRAO'), extractFn('kbNormalizarChecklistLegado'), 'module.exports = { kbNormalizarChecklistLegado: kbNormalizarChecklistLegado };'].join('\n\n');
  var modPath = path.join(__dirname, '_rodada_cirurgica_normalizador.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // OS onde o funcionário removeu 2 dos 5 itens padrão (ex.: só Corte/Montagem/Embalagem)
  var osA = { checks: ['Corte', 'Montagem', 'Embalagem'], _ck: [true, false, false], _checklistCustomizado: true };
  var mudouA = mod.kbNormalizarChecklistLegado(osA);
  ok('2a. OS customizada (itens removidos manualmente): normalizador NÃO mexe (retorna false)', mudouA === false);
  test('2b. checklist da OS A continua só com os 3 itens que o funcionário deixou', osA.checks, ['Corte', 'Montagem', 'Embalagem']);

  // OS B, independente, mantém os 5 itens padrão intactos (não-customizada)
  var osB = { checks: ['Corte', 'Gravação', 'Montagem', 'Acabamento', 'Embalagem'], _ck: [false, false, false, false, false] };
  var mudouB = mod.kbNormalizarChecklistLegado(osB);
  ok('2c. OS B (não-customizada, já canônica): comportamento de sempre preservado', mudouB === false);
  test('2d. OS B continua com os 5 itens — OS A e OS B são independentes', osB.checks.length, 5);

  // OS legada de verdade (sem a flag) continua sendo normalizada como sempre
  var osLegado = { checks: ['Corte'], _ck: [true] };
  var mudouLegado = mod.kbNormalizarChecklistLegado(osLegado);
  ok('2e. OS legada sem a flag continua sendo normalizada (comportamento antigo preservado)', mudouLegado === true);
  test('2f. OS legada ganha os 5 itens canônicos normalmente', osLegado.checks.length, 5);

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── ITEM #2 — kbCheckAddItem/kbCheckDeleteItem marcam a flag ─────────────────
(function () {
  console.log('\n-- Item #2: kbCheckAddItem/kbCheckDeleteItem marcam _checklistCustomizado --');
  var addSrc = extractFn('kbCheckAddItem');
  var delSrc = extractFn('kbCheckDeleteItem');
  ok('2g. kbCheckAddItem seta os._checklistCustomizado = true', /os\._checklistCustomizado\s*=\s*true/.test(addSrc));
  ok('2h. kbCheckDeleteItem seta os._checklistCustomizado = true', /os\._checklistCustomizado\s*=\s*true/.test(delSrc));
})();

// ── ITEM #3 — botão "Marcar como Pronta" reativo ─────────────────────────────
(function () {
  console.log('\n-- Item #3: kbAtualizarProntoBtn chamado por kbOpen/kbToggle/add/del --');
  ok('3a. kbAtualizarProntoBtn existe como função própria', html.indexOf('function kbAtualizarProntoBtn(os)') >= 0);
  var openSrc = extractFn('kbOpen');
  var toggleSrc = extractFn('kbToggle');
  var addSrc = extractFn('kbCheckAddItem');
  var delSrc = extractFn('kbCheckDeleteItem');
  var revertSrc = extractFn('kbReverterProducao');
  ok('3b. kbOpen() chama kbAtualizarProntoBtn(os)', /kbAtualizarProntoBtn\(os\)/.test(openSrc));
  ok('3c. kbToggle() chama kbAtualizarProntoBtn(os) — reage a marcar/desmarcar', /kbAtualizarProntoBtn\(os\)/.test(toggleSrc));
  ok('3d. kbCheckAddItem() chama kbAtualizarProntoBtn(os)', /kbAtualizarProntoBtn\(os\)/.test(addSrc));
  ok('3e. kbCheckDeleteItem() chama kbAtualizarProntoBtn(os)', /kbAtualizarProntoBtn\(os\)/.test(delSrc));
  ok('3f. kbReverterProducao() chama kbAtualizarProntoBtn(os)', /kbAtualizarProntoBtn\(os\)/.test(revertSrc));

  // Execução real de kbAtualizarProntoBtn + kbChecklistCompleto com DOM mínimo mockado
  var fnSrc = [extractFn('kbChecklistCompleto'), extractFn('kbAtualizarProntoBtn')].join('\n\n');
  var btnState = {};
  var fakeBtn = {
    set className(v) { btnState.className = v; }, get className() { return btnState.className; },
    set textContent(v) { btnState.textContent = v; }, get textContent() { return btnState.textContent; },
    set disabled(v) { btnState.disabled = v; }, get disabled() { return btnState.disabled; },
    style: {},
    set title(v) { btnState.title = v; }, get title() { return btnState.title; },
  };
  var fakeDocument = { getElementById: function (id) { return id === 'kbProntoBtn' ? fakeBtn : null; } };
  var runner = new Function('document', fnSrc + '\nreturn { kbAtualizarProntoBtn: kbAtualizarProntoBtn };');
  var mod3 = runner(fakeDocument);

  var os3 = { status: 'producao', checks: ['Corte', 'Montagem'], _ck: [true, false] };
  mod3.kbAtualizarProntoBtn(os3);
  ok('3g. Checklist incompleto (customizado, só 2 itens): botão fica desabilitado', btnState.disabled === true);
  os3._ck = [true, true];
  mod3.kbAtualizarProntoBtn(os3);
  ok('3h. Depois de completar os 2 itens da OS (não 5): botão habilita imediatamente', btnState.disabled === false);
  os3._ck = [true, false];
  mod3.kbAtualizarProntoBtn(os3);
  ok('3i. Desmarcar um item de novo desabilita o botão imediatamente (reage aos dois sentidos)', btnState.disabled === true);
})();

// ── ITEM #4 — locks transitórios nunca persistidos + reset defensivo ────────
(function () {
  console.log('\n-- Item #4: _marcandoPronto/_liberando nunca vão para o Firestore --');
  var saveSrc = extractFn('kbSaveKbos');
  ok('4a. kbSaveKbos() deleta o._marcandoPronto antes de gravar', /delete o\._marcandoPronto/.test(saveSrc));
  ok('4b. kbSaveKbos() deleta o._liberando antes de gravar', /delete o\._liberando/.test(saveSrc));

  // Execução real: KB_OS em memória com locks travados em true, kbSaveKbos()
  // não pode deixar nenhum dos dois vazar para o payload salvo.
  var finFieldsSrc = html.slice(html.indexOf('var _KB_OS_FIN_FIELDS'), html.indexOf(';', html.indexOf('var _KB_OS_FIN_FIELDS')) + 1);
  var runner = new Function('_cloudSave', 'KB_OS', finFieldsSrc + '\n' + saveSrc + '\nreturn kbSaveKbos;');
  var capturedPayload = null;
  var fakeCloudSave = function (key, data) { capturedPayload = data; return Promise.resolve({ ok: true }); };
  var KB_OS = { os1: { id: 'os1', status: 'pronta', checks: ['Corte'], _ck: [true], _marcandoPronto: true, _liberando: true } };
  var kbSaveKbos = runner(fakeCloudSave, KB_OS);

  return kbSaveKbos().then(function () {
    ok('4c. Payload salvo NÃO contém _marcandoPronto mesmo estando true em memória', !('_marcandoPronto' in capturedPayload.os1));
    ok('4d. Payload salvo NÃO contém _liberando mesmo estando true em memória', !('_liberando' in capturedPayload.os1));
    ok('4e. KB_OS em memória (nesta aba) continua com a trava true — só o documento salvo é que nunca a recebe', KB_OS.os1._marcandoPronto === true);

    // ── Item #4 — kbReverterProducao reseta as travas como rede de segurança ──
    console.log('\n-- Item #4: kbReverterProducao() reseta _marcandoPronto/_liberando --');
    var revertSrc = extractFn('kbReverterProducao');
    ok('4f. kbReverterProducao() reseta os._marcandoPronto = false', /os\._marcandoPronto\s*=\s*false/.test(revertSrc));
    ok('4g. kbReverterProducao() reseta os._liberando = false', /os\._liberando\s*=\s*false/.test(revertSrc));

    finishItem6();
  });
})().catch(function (e) { console.error('Erro no teste do item #4:', e); failed++; finishItem6(); });

// ── ITEM #6 — botão de pagamento de saldo disponível fora de 'pronta' ───────
function finishItem6() {
  console.log('\n-- Item #6: botão "💰 Pagamento" não exige mais status===\'pronta\' --');
  var tableSrc = extractFn('renderOsTable');
  var idxPgtoBtn = tableSrc.indexOf("btnPgto.textContent='💰 Pagamento'");
  ok('6a. Botão de pagamento existe em renderOsTable()', idxPgtoBtn >= 0);
  var idxIfPronta = tableSrc.indexOf("os.status==='pronta'");
  ok('6b. Existe pelo menos um gate por status===\'pronta\' (o do botão Entregar)', idxIfPronta >= 0);
  ok('6c. O botão de Pagamento aparece ANTES do bloco condicionado a status===\'pronta\' (não está mais preso a ele)', idxPgtoBtn >= 0 && idxIfPronta >= 0 && idxPgtoBtn < idxIfPronta);
  ok('6d. Gate real do botão é (saldo>0 && status!==\'cancelado\'), não mais status===\'pronta\'', /_temSaldoTabela\s*&&\s*os\.status!=='cancelado'\)\s*\{[\s\S]{0,40}var btnPgto/.test(tableSrc));
  ok('6e. osAbrirPagamentoSaldoModal (chamada pelo botão) só exige os.restante>0, nunca status', /var saldoAtual = os\.restante \|\| 0;\s*\n\s*if \(saldoAtual <= 0\)/.test(extractFn('osAbrirPagamentoSaldoModal')));

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
}
