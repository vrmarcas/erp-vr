/**
 * test_cloudsave_concorrencia.js
 * Regressão do bug real encontrado na Homologação Fase F (2026-08-05), durante
 * o reteste pós-deploy da correção de produção: uma escrita do SDK falhou
 * silenciosamente com permission-denied após o ID token do Firebase Auth
 * ficar obsoleto (aba de teste automatizada ficou muitas horas em segundo
 * plano — o timer de renovação do SDK sofre throttling do navegador nessas
 * condições), e — separadamente — uma aba com o array local de orçamentos
 * desatualizado (porque uma limpeza foi feita via escrita direta no
 * Firestore, sem passar por orcSetEnviados(), e o listener em tempo real não
 * havia entregue a atualização ainda) chamou kbReceberSaldo() → orcSetEnviados()
 * e regravou o array COMPLETO desatualizado de volta no Firestore, ressuscitando
 * 11 fixtures já removidas. Reproduzido de forma controlada e determinística
 * no Emulator (ver incidente_auth_expirada_sobrescrita_2026-08-05.json).
 *
 * Corrigido endurecendo _cloudSave() — a função compartilhada por TODOS os
 * documentos agregados (orçamento, OS, estoque, log de estoque, compras,
 * financeiro, fiscal, configurações) — para: (1) rodar a gravação dentro de
 * uma transação que relê o documento e recusa a escrita se o servidor já
 * mudou desde a última vez que esta aba confirmou ter visto o documento
 * (_cloudLastPayload[key] como baseline de concorrência otimista); (2) nunca
 * reaplicar automaticamente o snapshot antigo — devolve o dado real do
 * servidor para o chamador reconciliar; (3) tentar renovar o ID token uma
 * vez e repetir a operação antes de desistir, quando o erro for de
 * autenticação — sem exigir que o operador rode getIdToken(true) manualmente.
 * orcSetEnviados() (vetor confirmado do incidente) foi atualizado para
 * reconciliar seu array local com o servidor quando a gravação é recusada.
 *
 * Funções sob teste (extraídas de index.html via contagem de chaves — mesma
 * técnica do resto da suíte — não reimplementadas): _cloudSave, orcSetEnviados.
 *
 * Uso: node scripts/test_cloudsave_concorrencia.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ── Extração por contagem de chaves balanceadas ─────────────────────────────
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var FN_NAMES = ['_cloudSave', '_cloudSaveExec', '_homologGuardOrThrow', 'orcSetEnviados', 'orcGetEnviados'];
var COL = 'erp_vr';
// SPRINT PRÉ-GO-LIVE, Bloco H — envolvido numa fábrica para que cada
// chamada da fábrica produza uma instância com seu PRÓPRIO
// _cloudLastPayload/_cloudSaveQueue, isoladas uma da outra — exatamente
// como duas abas reais do navegador, cada uma com seu próprio heap de JS,
// mas compartilhando o mesmo backend (o _db fake global). Sem isso, dois
// _cloudSave() vindos da MESMA instância seriam corretamente serializados
// pela fila por chave (ver _cloudSaveExec) e não serviriam para simular um
// conflito real entre duas sessões distintas.
var src = [
  "function _makeCloudModule(){",
  "var _COL = " + JSON.stringify(COL) + ";",
  "var _cloudLastPayload = {};",
  "var _cloudSaveQueue = {};",
  "var _HOMOLOG_MODE = false;",
  "var _HOMOLOG_EMULATORS_CONNECTED = true;",
  "var _cloudReady = true;",
  "var _ORC_ENVIADOS_DATA = [];",
  FN_NAMES.map(extractFn).join('\n\n'),
  "return {",
  "  _cloudSave: _cloudSave, orcSetEnviados: orcSetEnviados, orcGetEnviados: orcGetEnviados,",
  "  getLastPayload: function(k){ return _cloudLastPayload[k]; },",
  "  setLastPayload: function(k,v){ _cloudLastPayload[k] = v; },",
  "  setEnviadosRaw: function(arr){ _ORC_ENVIADOS_DATA = arr; }",
  "};",
  "}",
  "module.exports = _makeCloudModule;"
].join('\n\n');
var modPath = path.join(__dirname, '_cloudsave_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock de Firestore com transação real (get-antes-de-set, commit único no
// final, concorrência serializada) + simulação de erro de auth controlável. ──
var _fakeStore = {};
var _txnDelayMs = 0;
var _forceErrorOnce = null; // {code, message} — próxima transação falha com este erro, uma única vez
var _getIdTokenCalls = 0;
var _txnLock = Promise.resolve(); // serializa transações concorrentes, como o Firestore real faz por documento
function resetFakeStore() { _fakeStore = {}; _forceErrorOnce = null; _getIdTokenCalls = 0; _txnLock = Promise.resolve(); }
global._db = {
  collection: function () { return { doc: function (key) { return { _key: key }; } }; },
  runTransaction: function (fn) {
    var runIt = function () {
      if (_forceErrorOnce) {
        var err = _forceErrorOnce; _forceErrorOnce = null;
        return Promise.reject(err);
      }
      var pendingWrites = {};
      var txn = {
        get: function (ref) {
          var existing = _fakeStore[ref._key];
          var snap = { exists: !!existing, data: function () { return existing; } };
          return _txnDelayMs > 0 ? sleep(_txnDelayMs).then(function () { return snap; }) : Promise.resolve(snap);
        },
        set: function (ref, data) { pendingWrites[ref._key] = data; }
      };
      return Promise.resolve().then(function () { return fn(txn); }).then(function (result) {
        Object.keys(pendingWrites).forEach(function (k) { _fakeStore[k] = pendingWrites[k]; });
        return result;
      });
    };
    var p = _txnLock.then(runIt, runIt);
    _txnLock = p.catch(function () {});
    return p;
  }
};
global.firebase = {
  auth: function () {
    return {
      currentUser: {
        getIdToken: function (force) { _getIdTokenCalls++; return Promise.resolve('fake-token'); }
      }
    };
  }
};
global._lastToast = null; global._lastToastKind = null;
global.showToast = function (msg, kind) { global._lastToast = msg; global._lastToastKind = kind; };
global._renderCalls = 0;
global.orcEnviadosRender = function () { global._renderCalls++; };

var _makeCloudModule = require(modPath);
var mod = _makeCloudModule();
function fakeOrc(key) { var raw = _fakeStore[key]; return raw ? JSON.parse(raw.data) : null; }
function makeArr(ids) { return ids.map(function (id) { return { id: id, cliente: 'E2E_FASEF_20260805_' + id }; }); }

console.log('\n=== Regressão: escrita silenciosa após auth expirada + sobrescrita por estado obsoleto (Fase F) ===\n');

(async function main() {

await test('1. gravação normal (primeira vez, sem baseline) sucede', async function () {
  resetFakeStore();
  var r = await mod._cloudSave('orcamentos', makeArr(['A', 'B']));
  assertEq(r.ok, true, 'gravação sem baseline prévio sempre sucede');
  assertTruthy(fakeOrc('orcamentos'), 'documento persistido no fake Firestore');
});

await test('2. segunda gravação da MESMA aba (baseline consistente) sucede', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A', 'B']));
  var r2 = await mod._cloudSave('orcamentos', makeArr(['A', 'B', 'C']));
  assertEq(r2.ok, true, 'sem interferência externa, a mesma aba nunca conflita consigo mesma');
  assertEq(fakeOrc('orcamentos').length, 3, 'servidor reflete a gravação mais recente');
});

await test('3. payload idêntico ao último conhecido não inicia transação (anti-eco)', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A', 'B']));
  var callsBefore = 0;
  var origRunTransaction = global._db.runTransaction;
  global._db.runTransaction = function () { callsBefore++; return origRunTransaction.apply(global._db, arguments); };
  var r = await mod._cloudSave('orcamentos', makeArr(['A', 'B']));
  global._db.runTransaction = origRunTransaction;
  assertEq(r.unchanged, true, 'retorno sinaliza que nada mudou');
  assertEq(callsBefore, 0, 'nenhuma transação nova foi aberta para um payload idêntico');
});

await test('4. escrita concorrente detectada — gravação recusada, servidor preserva a mudança externa', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A', 'B'])); // baseline conhecido por esta "aba"
  // "outra aba/sessão" grava diretamente no servidor, sem passar por _cloudSave
  _fakeStore['orcamentos'] = { data: JSON.stringify(makeArr(['A', 'B', 'EXTERNO'])), ts: Date.now() };
  // esta aba, com o baseline antigo, tenta gravar sua própria mutação
  var r = await mod._cloudSave('orcamentos', makeArr(['A', 'B', 'MEU']));
  assertEq(r.ok, false, 'gravação recusada');
  assertEq(r.reason, 'conflito', 'motivo correto');
  var servidor = fakeOrc('orcamentos');
  assertEq(servidor.some(function (o) { return o.id === 'EXTERNO'; }), true, 'mudança externa preservada — não foi apagada');
  assertEq(servidor.some(function (o) { return o.id === 'MEU'; }), false, 'mudança obsoleta desta aba NÃO foi aplicada por cima');
});

await test('5. conflito reconcilia _cloudLastPayload com a verdade do servidor (não repete o erro para sempre)', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A']));
  _fakeStore['orcamentos'] = { data: JSON.stringify(makeArr(['A', 'EXTERNO'])), ts: Date.now() };
  await mod._cloudSave('orcamentos', makeArr(['A', 'MEU']));
  assertEq(mod.getLastPayload('orcamentos'), JSON.stringify(makeArr(['A', 'EXTERNO'])), 'baseline local atualizado para o valor real do servidor após o conflito');
});

await test('6. orcSetEnviados(): em conflito, reconcilia o array local com o servidor e notifica (sem reaplicar snapshot antigo)', async function () {
  resetFakeStore();
  mod.setEnviadosRaw(makeArr(['A', 'B']));
  await mod._cloudSave('orcamentos', makeArr(['A', 'B'])); // sincroniza baseline
  _fakeStore['orcamentos'] = { data: JSON.stringify(makeArr(['A', 'B', 'EXTERNO'])), ts: Date.now() };
  var rendersAntes = global._renderCalls;
  var r = await mod.orcSetEnviados(makeArr(['A', 'B', 'MEU'])); // array obsoleto local
  assertEq(r.ok, false, 'gravação recusada propagada pelo retorno');
  assertEq(mod.orcGetEnviados().some(function (o) { return o.id === 'EXTERNO'; }), true, 'array local reconciliado com o servidor (contém EXTERNO)');
  assertEq(mod.orcGetEnviados().some(function (o) { return o.id === 'MEU'; }), false, 'mudança obsoleta local não permanece como se tivesse sido salva');
  assertTruthy(global._renderCalls > rendersAntes, 'tela foi atualizada para refletir o estado real após o conflito');
});

await test('7. erro de autenticação — renova o token automaticamente e repete a operação (sem intervenção manual)', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A']));
  var err = new Error('permission-denied'); err.code = 'permission-denied';
  _forceErrorOnce = err;
  var r = await mod._cloudSave('orcamentos', makeArr(['A', 'B']));
  assertEq(r.ok, true, 'após renovar o token, a segunda tentativa sucede sozinha');
  assertEq(_getIdTokenCalls, 1, 'getIdToken(true) foi chamado automaticamente pelo próprio código — não pelo operador');
});

await test('8. erro de autenticação persistente após renovar — falha de forma explícita, nunca finge sucesso', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A']));
  var err1 = new Error('permission-denied'); err1.code = 'permission-denied';
  var origRunTransaction = global._db.runTransaction;
  var attempts = 0;
  global._db.runTransaction = function (fn) { attempts++; return Promise.reject(err1); };
  var r = await mod._cloudSave('orcamentos', makeArr(['A', 'B']));
  global._db.runTransaction = origRunTransaction;
  assertEq(r.ok, false, 'nunca reporta sucesso quando a escrita de fato falhou');
  assertEq(_getIdTokenCalls, 1, 'tentou renovar o token exatamente uma vez');
  assertEq(attempts, 2, 'tentou uma vez, renovou o token, tentou de novo uma segunda vez — não ficou em loop além disso');
  assertEq(global._lastToastKind, 'err', 'usuário é avisado com clareza, mesmo após a tentativa de renovação falhar também');
});

await test('9. erro de cota (resource-exhausted) — não confunde com erro de auth, mostra mensagem específica', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A']));
  var err = new Error('Quota exceeded'); err.code = 'resource-exhausted';
  _forceErrorOnce = err;
  var r = await mod._cloudSave('orcamentos', makeArr(['A', 'B']));
  assertEq(r.ok, false, 'gravação falhou');
  assertEq(_getIdTokenCalls, 0, 'não tentou renovar token para um erro que não é de autenticação');
  assertEq(global._lastToastKind, 'err', 'usuário é avisado');
});

await test('10. escrita atrasada (latência simulada) não sobrescreve uma versão mais nova já confirmada', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A']));
  var baselineCapturado = mod.getLastPayload('orcamentos');
  // simula uma escrita desta aba que está "em voo" (baseline antigo capturado antes)
  // enquanto isso, uma atualização mais nova é confirmada primeiro
  _fakeStore['orcamentos'] = { data: JSON.stringify(makeArr(['A', 'NOVA_CONFIRMADA_PRIMEIRO'])), ts: Date.now() };
  mod.setLastPayload('orcamentos', baselineCapturado); // restaura o baseline "antigo" que a escrita atrasada carregava
  var r = await mod._cloudSave('orcamentos', makeArr(['A', 'ATRASADA']));
  assertEq(r.ok, false, 'a resposta atrasada não vence');
  var servidor = fakeOrc('orcamentos');
  assertEq(servidor.some(function (o) { return o.id === 'NOVA_CONFIRMADA_PRIMEIRO'; }), true, 'versão confirmada primeiro permanece');
  assertEq(servidor.some(function (o) { return o.id === 'ATRASADA'; }), false, 'versão atrasada não substitui a mais nova');
});

await test('11. nenhum documento parcial: falha de transação não deixa payload parcialmente aplicado', async function () {
  resetFakeStore();
  await mod._cloudSave('orcamentos', makeArr(['A']));
  var err = new Error('unavailable'); err.code = 'unavailable';
  _forceErrorOnce = err;
  var antes = fakeOrc('orcamentos');
  await mod._cloudSave('orcamentos', makeArr(['A', 'B', 'C']));
  assertEq(fakeOrc('orcamentos'), antes, 'documento no servidor permanece exatamente como estava — nada parcial');
});

await test('12. duas ABAS REAIS (instâncias independentes) gravando a mesma chave a partir do mesmo baseline — apenas uma vence, a outra é recusada de forma limpa', async function () {
  resetFakeStore();
  var abaA = _makeCloudModule(), abaB = _makeCloudModule();
  await abaA._cloudSave('orcamentos', makeArr(['A']));
  abaB.setLastPayload('orcamentos', abaA.getLastPayload('orcamentos')); // aba B "viu" o mesmo estado inicial
  _txnDelayMs = 15;
  try {
    var p1 = abaA._cloudSave('orcamentos', makeArr(['A', 'ABA1']));
    var p2 = abaB._cloudSave('orcamentos', makeArr(['A', 'ABA2']));
    var results = await Promise.all([p1, p2]);
    var sucessos = results.filter(function (r) { return r.ok; }).length;
    assertEq(sucessos, 1, 'exatamente uma das duas gravações concorrentes de abas DIFERENTES sucede — conflito real entre sessões continua detectado');
  } finally { _txnDelayMs = 0; }
});

// ── SPRINT PRÉ-GO-LIVE, Blocos H/K — achado real: "Cliente Aprovou" no
// orçamento e "aceitar horário sugerido" no Kanban disparavam DUAS chamadas
// de _cloudSave() para a MESMA chave, na MESMA aba, em sequência síncrona
// (sem aguardar a primeira), o que produzia um falso "foi alterado por
// outra sessão" causado pela própria aba. Corrigido enfileirando por chave
// dentro de _cloudSave(). Os testes 13-15 provam a serialização direto na
// função genérica (a causa raiz), sem depender de nenhuma tela específica.
await test('13. achado real corrigido: duas gravações da MESMA aba para a MESMA chave, disparadas sem aguardar a primeira, NUNCA mais colidem entre si', async function () {
  resetFakeStore();
  var p1 = mod._cloudSave('orcamentos', makeArr(['A', 'STATUS'])); // ex.: orcEnvSetStatus grava o status
  var p2 = mod._cloudSave('orcamentos', makeArr(['A', 'STATUS', 'CRID'])); // ex.: grava o crId, em seguida, sem esperar
  var r1 = await p1, r2 = await p2;
  assertEq(r1.ok, true, 'primeira gravação sucede');
  assertEq(r2.ok, true, 'segunda gravação da mesma aba NUNCA é recusada por "conflito consigo mesma"');
  assertEq(fakeOrc('orcamentos').length, 3, 'servidor reflete a gravação mais recente (a segunda), nenhuma foi perdida');
});
await test('14. a serialização preserva a ORDEM: a segunda gravação sempre vence sobre a primeira, nunca o inverso', async function () {
  resetFakeStore();
  _txnDelayMs = 10;
  try {
    var p1 = mod._cloudSave('kb_os', { os1: { tempoProd: '4' } }); // ex.: kbSalvarTempo
    var p2 = mod._cloudSave('kb_os', { os1: { tempoProd: '4', prazo: '2026-08-10' } }); // ex.: kbSalvarPrazo, logo em seguida
    await Promise.all([p1, p2]);
    var servidor = JSON.parse(_fakeStore['kb_os'].data);
    assertEq(servidor.os1.prazo, '2026-08-10', 'o resultado final tem os dois campos — nenhuma gravação sobrescreveu a outra por estar "atrasada"');
  } finally { _txnDelayMs = 0; }
});
await test('15. três gravações em cadeia da mesma aba para a mesma chave (ex.: várias ações rápidas em sequência) — todas sucedem, nenhuma falsamente recusada', async function () {
  resetFakeStore();
  var ps = [
    mod._cloudSave('fin_cr', ['um']),
    mod._cloudSave('fin_cr', ['um', 'dois']),
    mod._cloudSave('fin_cr', ['um', 'dois', 'tres'])
  ];
  var results = await Promise.all(ps);
  assertEq(results.every(function (r) { return r.ok; }), true, 'nenhuma das três gravações em cadeia é recusada por falso conflito consigo mesma');
  assertEq(fakeOrc('fin_cr').length, 3, 'estado final do servidor é o da última gravação da cadeia');
});

console.log('\n=== resultado ===');
console.log('passed=' + passed + ' failed=' + failed);
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);

})();
