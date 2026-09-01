/**
 * test_rodada_correcao_definitiva_kanban_persistencia_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA — bug real de produção: mover uma OS no
 * Kanban (kbDrop/kbSalvarPrazo/kbAceitarSugestaoBtn) podia "sumir" depois
 * de reload, nova aba ou bloqueio/desbloqueio — MESMO dentro da mesma
 * semana (a hipótese de fronteira de semana foi descartada pelo relato
 * real do usuário).
 *
 * Causa raiz (investigação dedicada, 2026-09-01, reproduzida com harness
 * fiel simulando _cloudSaveExec real): nenhuma das escritas críticas
 * esperava a Promise de _cloudSave() confirmar antes de secEngageLock()/
 * authLogout() invalidarem o token (signOut) ou de pagehide/beforeunload
 * deixarem a aba fechar/recarregar. O documento no servidor ainda era o
 * ANTIGO quando a sessão seguinte relia 'kb_os' do zero.
 *
 * Corrigido com _aguardarCloudSavesPendentes() (index.html) — espera toda
 * gravação _cloudSave() atualmente em voo (rastreada por _cloudSaveQueue)
 * confirmar (sucesso OU falha, nunca trava numa que já rejeitou) antes de
 * secEngageLock()/authLogout() prosseguirem para o teardown de listeners +
 * signOut(). A tela de bloqueio já cobre a aba ANTES dessa espera
 * (secApplyLockUI roda primeiro) — o atraso é invisível ao usuário.
 * beforeunload avisa (native confirm) se uma gravação está em voo no
 * momento de fechar/recarregar a aba — JS não pode bloquear isso de
 * verdade, mas pode dar ao usuário a chance de cancelar.
 *
 * Este teste cobre dois níveis:
 *   A. Unitário/comportamental — extrai _cloudSave/_cloudSaveExec/
 *      _aguardarCloudSavesPendentes de verdade e prova que a espera
 *      realmente bloqueia até a gravação em voo confirmar (ou até o
 *      timeout de segurança, se travar de verdade).
 *   B. Estrutural — prova que secEngageLock() e authLogout() de fato
 *      chamam _aguardarCloudSavesPendentes() ANTES de firebase.auth().
 *      signOut() (ordem no código-fonte), e que beforeunload existe e
 *      consulta _CLOUD_SAVES_EM_VOO.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _cloudSave, _cloudSaveExec, _aguardarCloudSavesPendentes.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_kanban_persistencia_2026-09-01.js
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
function extractVar(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Persistência do Kanban antes de lock/logout/reload ===\n');

// ══════════════════════════════════════════════════════════════════════════
// A — Unitário/comportamental
// ══════════════════════════════════════════════════════════════════════════
(async function () {
  var src = [
    extractVar('_cloudSaveQueue'),
    extractVar('_cloudLastPayload'),
    extractVar('_CLOUD_SAVES_EM_VOO'),
    extractFn('_aguardarCloudSavesPendentes'),
    extractFn('_cloudSave'),
    extractFn('_cloudSaveExec'),
  ].join('\n\n') + '\n\nmodule.exports = {_cloudSave, _cloudSaveExec, _aguardarCloudSavesPendentes, getEmVoo: function(){ return _CLOUD_SAVES_EM_VOO; }, getQueue: function(){ return _cloudSaveQueue; }};';
  var modPath = path.join(__dirname, '_rodada_correcao_definitiva_kanban_persistencia.tmp.js');
  fs.writeFileSync(modPath, src);

  function reset() {
    global._COL = 'erp_vr';
    global._db = {
      collection: function () {
        return {
          doc: function () {
            return { get: function () { return Promise.resolve({ exists: false, data: function () { return null; } }); } };
          }
        };
      },
      runTransaction: function (fn) {
        return fn({ get: function (ref) { return ref.get(); }, set: function () {} });
      }
    };
    global._homologGuardOrThrow = function () {};
    global.showToast = function () {};
    global.console = console;
  }
  reset();
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // 1 — sem nenhuma gravação em voo, a espera resolve imediatamente.
  var t0 = Date.now();
  await mod._aguardarCloudSavesPendentes(2000);
  assertTrue(Date.now() - t0 < 100, '1. Sem nenhuma gravação em voo, _aguardarCloudSavesPendentes() resolve imediatamente (não espera nada à toa)');

  // 2 — com uma gravação genuinamente pendente (nunca resolvida por conta
  // própria — controlamos manualmente quando ela "confirma"), a espera só
  // resolve DEPOIS que a Promise em voo resolve.
  var resolverPendente;
  var pendente = new Promise(function (resolve) { resolverPendente = resolve; });
  mod.getQueue()['kb_os'] = pendente;
  var resolveu = false;
  var esperaPromise = mod._aguardarCloudSavesPendentes(5000).then(function () { resolveu = true; });
  await new Promise(function (r) { setTimeout(r, 50); });
  assertTrue(resolveu === false, '2a. Com uma gravação genuinamente em voo, a espera NÃO resolveu ainda 50ms depois — não finge que terminou');
  resolverPendente({ ok: true });
  await esperaPromise;
  assertTrue(resolveu === true, '2b. Assim que a gravação em voo confirma, a espera resolve — nunca trava além do necessário');

  // 3 — timeout de segurança: uma gravação que NUNCA resolve não trava a
  // espera para sempre (nunca bloqueia o bloqueio/logout indefinidamente).
  mod.getQueue()['kb_os_travado'] = new Promise(function () {}); // nunca resolve
  var t1 = Date.now();
  await mod._aguardarCloudSavesPendentes(300);
  assertTrue(Date.now() - t1 < 600, '3. Uma gravação que nunca resolve não trava a espera além do timeout de segurança configurado (300ms neste teste)');

  // 4 — _CLOUD_SAVES_EM_VOO reflete corretamente uma gravação real via
  // _cloudSave() (mesma função usada por kbSaveKbos()): sobe durante a
  // gravação, desce depois de confirmar.
  reset();
  delete require.cache[require.resolve(modPath)];
  mod = require(modPath);
  var duranteEmVoo = null;
  var savePromise = mod._cloudSave('kb_os', { a: 1 }).then(function (res) { return res; });
  duranteEmVoo = mod.getEmVoo();
  await savePromise;
  assertTrue(duranteEmVoo === 1, '4a. _CLOUD_SAVES_EM_VOO === 1 enquanto a gravação real está em andamento');
  assertTrue(mod.getEmVoo() === 0, '4b. _CLOUD_SAVES_EM_VOO volta a 0 depois que a gravação confirma (sucesso)');

  // 5 — dado idêntico ao já salvo (anti-eco) nunca fica "em voo" (early
  // return antes de incrementar o contador) — beforeunload não deveria
  // avisar por uma gravação que nem chegou a acontecer de verdade.
  reset();
  delete require.cache[require.resolve(modPath)];
  mod = require(modPath);
  await mod._cloudSave('kb_os', { a: 1 }); // primeira gravação real
  var emVooAntes = mod.getEmVoo();
  await mod._cloudSave('kb_os', { a: 1 }); // dado idêntico — anti-eco
  assertTrue(emVooAntes === 0 && mod.getEmVoo() === 0, '5. Gravação com dado idêntico ao já persistido (anti-eco) não passa pelo contador de "em voo" — nunca dispara um aviso de beforeunload à toa');

  console.log('\n----------------------------------------------------------------------');

  // ══════════════════════════════════════════════════════════════════════
  // B — Estrutural: ordem real no código-fonte
  // ══════════════════════════════════════════════════════════════════════
  var idxEngageLockDef = html.indexOf('function secEngageLock(motivo)');
  var idxEngageLockEnd = (function () {
    var braceOpen = html.indexOf('{', idxEngageLockDef);
    var depth = 0, i = braceOpen;
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
    return i;
  })();
  var corpoEngageLock = html.slice(idxEngageLockDef, idxEngageLockEnd);
  var idxEsperaNoLock = corpoEngageLock.indexOf('_aguardarCloudSavesPendentes(');
  var idxSignOutNoLock = corpoEngageLock.indexOf('firebase.auth().signOut()');
  assertTrue(idxEsperaNoLock > 0, '6. secEngageLock() chama _aguardarCloudSavesPendentes()');
  assertTrue(idxSignOutNoLock > 0, '7. secEngageLock() chama firebase.auth().signOut()');
  assertTrue(idxEsperaNoLock > 0 && idxSignOutNoLock > 0 && idxEsperaNoLock < idxSignOutNoLock, '8. Dentro de secEngageLock(), _aguardarCloudSavesPendentes() é chamado ANTES de firebase.auth().signOut() — nunca invalida o token antes de esperar gravações em voo confirmarem');

  var idxLogoutDef = html.indexOf('function authLogout()');
  var idxLogoutEnd = (function () {
    var braceOpen = html.indexOf('{', idxLogoutDef);
    var depth = 0, i = braceOpen;
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
    return i;
  })();
  var corpoLogout = html.slice(idxLogoutDef, idxLogoutEnd);
  assertTrue(corpoLogout.indexOf('_aguardarCloudSavesPendentes(') > 0, '9. authLogout() também chama _aguardarCloudSavesPendentes() antes do signOut (mesma proteção do bloqueio)');

  assertTrue(html.indexOf("addEventListener('beforeunload'") > 0, '10. Existe um listener de beforeunload registrado');
  var idxBeforeUnload = html.indexOf("addEventListener('beforeunload'");
  var trechoBeforeUnload = html.slice(idxBeforeUnload, idxBeforeUnload + 500);
  assertTrue(trechoBeforeUnload.indexOf('_CLOUD_SAVES_EM_VOO') > 0, '11. O listener de beforeunload consulta _CLOUD_SAVES_EM_VOO (avisa o usuário só quando há gravação genuinamente em voo, nunca sempre)');

  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
})();
