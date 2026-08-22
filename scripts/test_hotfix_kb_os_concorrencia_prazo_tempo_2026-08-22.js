/**
 * test_hotfix_kb_os_concorrencia_prazo_tempo_2026-08-22.js
 *
 * RODADA 9, BLOCO A (2026-08-22) — achado real de produção: editar
 * prazo/tempo estimado de uma OS no Kanban mostrava, na mesma interação:
 *   "Prazo salvo: 24/08/2026"
 *   "Prazo e tempo estimado definidos!"
 * e logo em seguida:
 *   "kb_os" foi alterado por outra sessão — esta mudança não foi salva.
 *
 * Causa raiz (investigação em duas partes):
 * 1) kbSalvarPrazo()/kbSalvarTempo()/kbAceitarSugestaoBtn() mostravam o
 *    toast de sucesso de forma OTIMISTA, antes de aguardar a Promise real
 *    de kbSaveKbos() confirmar a gravação no Firestore.
 * 2) kb_os é um ÚNICO documento agregado (todas as OS's do board);
 *    kbSaveKbos() antigo comparava o payload serializado INTEIRO contra o
 *    baseline — qualquer gravação concorrente em QUALQUER OUTRA OS (nesta
 *    mesma aba, ex. kbReceberSaldo/finRegistrarRecebimento/orcEnvGerarOS,
 *    ou de outra aba/sessão) fazia o próximo kbSaveKbos() ver "conflito",
 *    mesmo que a OS que o usuário estava editando não tivesse sido tocada
 *    por ninguém.
 *
 * Corrigido reaproveitando o MESMO padrão já usado por
 * _orcamentosSalvarComMergeContinuar() para o documento agregado
 * "orcamentos": diff por id de OS contra o baseline; conflito só é real
 * se uma OS que EU mudei também mudou no servidor; caso contrário, merge
 * automático + retry (até 5 tentativas). Funções sob teste extraídas de
 * index.html (nunca reimplementadas): kbSaveKbos, kbSalvarPrazo,
 * kbSalvarTempo, kbAceitarSugestaoBtn, _cloudSave, _cloudSaveExec,
 * _homologGuardOrThrow. Mock de Firestore com transação real (mesmo
 * padrão de scripts/test_sprint_pregolive_blocoHK_falsos_conflitos_2026-08-09.js).
 *
 * Uso: node scripts/test_hotfix_kb_os_concorrencia_prazo_tempo_2026-08-22.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function testSync(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
async function testAsync(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }

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

var FN_NAMES = ['kbSaveKbos', 'kbSalvarPrazo', 'kbSalvarTempo', 'kbAceitarSugestaoBtn', '_cloudSave', '_cloudSaveExec', '_homologGuardOrThrow'];
var src = "var _KB_OS_FIN_FIELDS = ['valor','totalGeral','parcelas','formaPgto','pagtoTipo','valorEntrada','restante'];\n\n"
  + FN_NAMES.map(extractFn).join('\n\n')
  + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_kb_os_concorrencia_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock de Firestore com transação real (mesmo padrão do teste Bloco H/K) ──
var _fakeStore = {};
global._db = {
  collection: function () { return { doc: function (key) { return { _key: key }; } }; },
  runTransaction: function (fn) {
    var pendingWrites = {};
    var txn = {
      get: function (ref) {
        var existing = _fakeStore[ref._key];
        return Promise.resolve({ exists: !!existing, data: function () { return existing; } });
      },
      set: function (ref, data) { pendingWrites[ref._key] = data; }
    };
    return Promise.resolve().then(function () { return fn(txn); }).then(function (result) {
      Object.keys(pendingWrites).forEach(function (k) { _fakeStore[k] = pendingWrites[k]; });
      return result;
    });
  }
};
global._COL = 'erp_vr';
global._HOMOLOG_MODE = false;
global._HOMOLOG_EMULATORS_CONNECTED = true;
global.window = global;

var _toasts = [];
global.showToast = function (msg, kind) { _toasts.push({ msg: msg, kind: kind }); };
function ultimoToast() { return _toasts.length ? _toasts[_toasts.length - 1] : null; }
function toastsDeSucesso() { return _toasts.filter(function (t) { return kind_ok(t); }); }
function kind_ok(t) { return t.kind === 'ok'; }

var _els = {};
global.document = {
  getElementById: function (id) { return _els[id] || (_els[id] = { value: '', style: {} }); }
};

global.kbRender = function () {};
global.renderOsTable = function () {};
global.kbOpen = function () {};
global.kbApplyViewFilter = function () {};
global.kbRenderMonthCalendar = function () {};

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

function resetTudo() {
  _fakeStore = {};
  global._cloudLastPayload = {};
  global._cloudSaveQueue = {};
  _toasts.length = 0;
  Object.keys(_els).forEach(function (k) { delete _els[k]; });
}

function osBase(id, num, extra) {
  var o = { id: id, num: num, titulo: 'Item', cliente: 'Cliente', status: 'iniciada', entrega: '2026-08-20', prazo: '2026-08-20', tempoProd: '2' };
  return Object.assign(o, extra || {});
}

async function seedServidor(kb) {
  // Popula o "servidor" fake E o baseline local desta aba, simulando que a
  // aba já leu o documento uma vez (_cloudLoad/_cloudWatch reais) antes de
  // o usuário começar a editar.
  var payload = JSON.stringify(kb);
  _fakeStore['kb_os'] = { data: payload, ts: 1 };
  global._cloudLastPayload['kb_os'] = payload;
}

console.log('\n=== RODADA 9, Bloco A — concorrência kb_os (prazo/tempo) ===\n');

(async function main() {

// ── 1. Editar somente prazo ──────────────────────────────────────────────
await testAsync('1. editar somente prazo: sucesso só depois da confirmação real, valor persistido correto', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbPrazoEntrega'] = { value: '2026-08-24' };
  var res = await mod.kbSalvarPrazo();
  assertEq(res.ok, true, 'kbSaveKbos confirma sucesso');
  var servidor = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(servidor.osA.prazo, '2026-08-24', 'prazo persistido no servidor');
  assertEq(servidor.osA.entrega, '2026-08-24', 'entrega persistida no servidor');
  assertTrue(_toasts.some(function (t) { return t.kind === 'ok' && /Prazo salvo/.test(t.msg); }), 'toast de sucesso apareceu');
  assertTrue(!_toasts.some(function (t) { return t.kind === 'warn'; }), 'nenhum toast de conflito apareceu');
});

// ── 2. Editar somente tempo ──────────────────────────────────────────────
await testAsync('2. editar somente tempo: sucesso confirmado, valor persistido correto', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbTempoProd'] = { value: '7.5' };
  var res = await mod.kbSalvarTempo();
  assertEq(res.ok, true, 'kbSaveKbos confirma sucesso');
  var servidor = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(servidor.osA.tempoProd, '7.5', 'tempoProd persistido no servidor');
});

// ── 3. Editar ambos (aceitar sugestão) ───────────────────────────────────
await testAsync('3. aceitar sugestão (prazo + tempo): toast único de sucesso só após AMBAS confirmarem', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbPrazoEntrega'] = { value: '' };
  _els['kbTempoProd'] = { value: '' };
  var btn = { dataset: { h: '4', d: '2026-08-25' } };
  mod.kbAceitarSugestaoBtn(btn);
  // kbAceitarSugestaoBtn dispara as duas gravações e resolve o toast final
  // de forma assíncrona (Promise.all) — aguarda um tick para a fila de
  // gravação (mesma chave 'kb_os') e o Promise.all resolverem.
  await new Promise(function (r) { setTimeout(r, 20); });
  var servidor = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(servidor.osA.prazo, '2026-08-25', 'prazo persistido');
  assertEq(servidor.osA.tempoProd, '4', 'tempo persistido');
  assertTrue(_toasts.some(function (t) { return t.kind === 'ok' && /definidos/.test(t.msg); }), 'toast único de sucesso apareceu');
  assertTrue(!_toasts.some(function (t) { return t.kind === 'warn'; }), 'nenhum toast de conflito — achado original reproduzido e corrigido');
});

// ── 4. Duas alterações sequenciais rápidas (mesma aba, mesma OS) ────────
await testAsync('4. duas gravações sequenciais rápidas da mesma aba (tempo, depois prazo) — nenhum falso conflito', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbTempoProd'] = { value: '3' };
  _els['kbPrazoEntrega'] = { value: '2026-08-26' };
  var p1 = mod.kbSalvarTempo();
  var p2 = mod.kbSalvarPrazo();
  var r1 = await p1, r2 = await p2;
  assertEq(r1.ok, true, '1ª gravação (tempo) sucede');
  assertEq(r2.ok, true, '2ª gravação (prazo) sucede');
  var servidor = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(servidor.osA.tempoProd, '3', 'tempo persistido');
  assertEq(servidor.osA.prazo, '2026-08-26', 'prazo persistido');
});

// ── 5. Duas abas — outra sessão edita OUTRA OS ───────────────────────────
await testAsync('5. outra sessão grava OUTRA OS (campo independente) enquanto eu edito a minha — merge automático, sem falso conflito', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10), osB: osBase('osB', 11) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbPrazoEntrega'] = { value: '2026-08-27' };
  // Simula outra sessão: grava osB diretamente no "servidor" fake, sem
  // passar pelo _cloudLastPayload desta aba — representa uma aba/sessão
  // diferente que já confirmou sua própria escrita.
  var kbOutraSessao = { osA: JSON.parse(JSON.stringify(global.KB_OS.osA)), osB: osBase('osB', 11, { status: 'pronta' }) };
  _fakeStore['kb_os'] = { data: JSON.stringify(kbOutraSessao), ts: 2 };
  var res = await mod.kbSalvarPrazo();
  assertEq(res.ok, true, 'minha gravação sucede via merge automático (retry)');
  var servidor = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(servidor.osA.prazo, '2026-08-27', 'minha mudança foi persistida');
  assertEq(servidor.osB.status, 'pronta', 'mudança da outra sessão em osB não foi perdida (merge, não sobrescrita)');
  assertTrue(!_toasts.some(function (t) { return t.kind === 'warn'; }), 'nenhum toast de conflito — a OS que eu editei não foi tocada por ninguém');
});

// ── 6. Conflito real — outra sessão edita a MESMA OS ─────────────────────
await testAsync('6. conflito real: outra sessão muda a prazo da MESMA OS que eu edito — minha mudança NÃO é salva, reconciliação clara, toast único e correto', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbPrazoEntrega'] = { value: '2026-08-28' };
  // Simula outra sessão gravando um prazo DIFERENTE na MESMA osA.
  var kbOutraSessao = { osA: osBase('osA', 10, { entrega: '2026-08-30', prazo: '2026-08-30' }) };
  _fakeStore['kb_os'] = { data: JSON.stringify(kbOutraSessao), ts: 2 };
  var res = await mod.kbSalvarPrazo();
  assertEq(res.ok, false, 'minha gravação é recusada — conflito real');
  assertEq(res.reason, 'conflito_os', 'motivo correto');
  var servidor = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(servidor.osA.prazo, '2026-08-30', 'o servidor mantém o valor da outra sessão — minha mudança não sobrescreveu silenciosamente');
  assertEq(global.KB_OS.osA.prazo, '2026-08-30', 'estado local reconciliado com a verdade do servidor — nunca fica divergente');
  assertTrue(_toasts.some(function (t) { return t.kind === 'warn' && /outra sessão/.test(t.msg); }), 'toast de conflito claro apareceu');
  assertTrue(!_toasts.some(function (t) { return t.kind === 'ok' && /Prazo salvo/.test(t.msg); }), 'NUNCA mostra sucesso e falha para a mesma ação — achado original');
});

// ── 7. Regressão: campos "diferentes" mas mesmo objeto de OS ainda é
// tratado com segurança (nunca perde dado, mesmo sendo conservador) ─────
await testAsync('7. mudança em campo diferente da MESMA OS (status, por outra rotina) é tratada como possível conflito — nunca perde a mudança de ninguém', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbTempoProd'] = { value: '9' };
  var kbOutraSessao = { osA: osBase('osA', 10, { status: 'producao' }) };
  _fakeStore['kb_os'] = { data: JSON.stringify(kbOutraSessao), ts: 2 };
  var res = await mod.kbSalvarTempo();
  // Conservador (mesmo critério já usado para "orcamentos"): objeto
  // inteiro da OS diferente → conflito reportado, nunca uma sobrescrita
  // silenciosa de um lado ou do outro.
  assertEq(res.ok, false, 'reportado como conflito (whole-object diff, mesmo padrão de orçamentos)');
  var servidor = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(servidor.osA.status, 'producao', 'status da outra rotina preservado — não sobrescrito');
});

// ── 8. Reload depois de salvar — valor persistido real ───────────────────
await testAsync('8. reload depois de salvar: releitura do "servidor" confirma exatamente o valor gravado', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbPrazoEntrega'] = { value: '2026-08-29' };
  await mod.kbSalvarPrazo();
  // Simula um "reload": nova aba lê o documento do zero.
  var releitura = JSON.parse(_fakeStore['kb_os'].data);
  assertEq(releitura.osA.prazo, '2026-08-29', 'prazo sobrevive a um reload simulado');
  assertEq(releitura.osA.entrega, '2026-08-29', 'entrega sobrevive a um reload simulado');
});

// ── 9. Conflito persistente (>5 tentativas) — nunca trava, nunca finge sucesso ──
await testAsync('9. conflito persistente: após 5 tentativas, desiste com aviso claro — nunca finge sucesso', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  var origRunTransaction = global._db.runTransaction;
  var chamadas = 0;
  global._db.runTransaction = function (fn) {
    chamadas++;
    // A cada tentativa, "outra sessão" muda a MESMA OS um instante antes
    // da minha transação reler o servidor — nunca deixa convergir.
    var kbOutraSessao = { osA: osBase('osA', 10, { entrega: '2026-08-3' + (chamadas % 10), prazo: '2026-08-3' + (chamadas % 10) }) };
    _fakeStore['kb_os'] = { data: JSON.stringify(kbOutraSessao), ts: chamadas };
    return origRunTransaction(fn);
  };
  _els['kbTempoProd'] = { value: '1' };
  var res = await mod.kbSalvarTempo();
  global._db.runTransaction = origRunTransaction;
  assertEq(res.ok, false, 'gravação recusada após esgotar tentativas');
  assertTrue(res.reason === 'conflito_os' || res.reason === 'conflito-persistente', 'motivo é um dos dois conflitos esperados — nunca reporta sucesso');
  assertTrue(!_toasts.some(function (t) { return t.kind === 'ok'; }), 'nenhum toast de sucesso foi mostrado');
});

// ── 10. Nunca reportar sucesso quando a gravação falha (reprodução direta do bug original) ──
await testAsync('10. reprodução direta do bug original: toast de sucesso e toast de conflito NUNCA aparecem juntos para a mesma ação', async function () {
  resetTudo();
  global.KB_OS = { osA: osBase('osA', 10) };
  await seedServidor(global.KB_OS);
  global._kbOsId = 'osA';
  _els['kbPrazoEntrega'] = { value: '2026-08-24' };
  _els['kbTempoProd'] = { value: '' };
  var kbOutraSessao = { osA: osBase('osA', 10, { entrega: '2026-08-31', prazo: '2026-08-31' }) };
  _fakeStore['kb_os'] = { data: JSON.stringify(kbOutraSessao), ts: 2 };
  var btn = { dataset: { h: '', d: '2026-08-24' } };
  mod.kbAceitarSugestaoBtn(btn);
  await new Promise(function (r) { setTimeout(r, 20); });
  var teveSucesso = _toasts.some(function (t) { return t.kind === 'ok'; });
  var teveConflito = _toasts.some(function (t) { return t.kind === 'warn'; });
  assertTrue(!(teveSucesso && teveConflito), 'NUNCA mostra "salvo" e "não salvo" para a mesma ação — bug original eliminado');
  assertTrue(teveConflito, 'o conflito real É reportado claramente');
});

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;

})();
