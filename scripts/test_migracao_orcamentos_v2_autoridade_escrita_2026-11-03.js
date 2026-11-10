/**
 * test_migracao_orcamentos_v2_autoridade_escrita_2026-11-03.js
 *
 * Prova o ponto CENTRAL da migração (Fase de corte de escrita): o save de
 * um orçamento NUNCA MAIS pode falhar só porque o array legado
 * erp_vr/orcamentos excedeu o limite de 1MiB do Firestore — causa raiz
 * real de o orçamento #000266 não salvar (medido em produção: 1.046.595 de
 * 1.048.576 bytes, 1.981 bytes de margem). erp_vr_orcamentos/{id}
 * (documento por orçamento) é agora a ÚNICA fonte que decide sucesso/
 * falha; o array legado é só um espelho melhor-esforço.
 *
 * Usa as FUNÇÕES REAIS extraídas de index.html (_orcamentosSalvarComMerge,
 * _orcamentosSalvarComMergeContinuar, orcV2SalvarComConflito, _cloudSave,
 * _cloudSaveExec) contra um Firestore FALSO em memória — nunca reimplementa
 * a lógica sob teste.
 *
 * Uso: node scripts/test_migracao_orcamentos_v2_autoridade_escrita_2026-11-03.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

var FN_NAMES = ['_cloudSave', '_cloudSaveExec', '_orcamentosSalvarComMerge', '_orcamentosSalvarComMergeContinuar', 'orcV2SalvarComConflito', '_orcV2CanonJSON'];
var src = [
  "var _homologGuardOrThrow = function(){};",
  "var _cloudReady = true;",
  "var _COL = 'erp_vr';",
  "var _toasts = [];",
  "var showToast = function(m,k){ _toasts.push({msg:m,kind:k}); };",
  "var _ORC_V2_CACHE = {};",
  "var _orcV2RecomputarERenderizar = function(){};",
  extractFn('_orcV2CanonJSON'),
  "module.exports = { criarSessao: criarSessao, getToasts: function(){ return _toasts; } };",
  "function criarSessao(db){",
  "  var _cloudLastPayload = {};",
  "  var _cloudSaveQueue = {};",
  "  var _orcV2LastPayload = {};",
  "  var _db = db;",
  "  " + extractFn('_cloudSave').replace(/^function _cloudSave/, 'var _cloudSave = function'),
  "  " + extractFn('_cloudSaveExec').replace(/^function _cloudSaveExec/, 'var _cloudSaveExec = function'),
  "  " + extractFn('orcV2SalvarComConflito').replace(/^function orcV2SalvarComConflito/, 'var orcV2SalvarComConflito = function'),
  "  " + extractFn('_orcamentosSalvarComMerge').replace(/^function _orcamentosSalvarComMerge/, 'var _orcamentosSalvarComMerge = function'),
  "  " + extractFn('_orcamentosSalvarComMergeContinuar').replace(/^function _orcamentosSalvarComMergeContinuar/, 'var _orcamentosSalvarComMergeContinuar = function'),
  "  var _ORC_ENVIADOS_DATA = [];",
  "  function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; return _orcamentosSalvarComMerge(arr, 0); }",
  "  function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }",
  "  return { orcSetEnviados: orcSetEnviados, orcGetEnviados: orcGetEnviados };",
  "}",
].join('\n\n');
var modPath = path.join(__dirname, '_autoridade_escrita_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA MIGRAÇÃO ORÇAMENTOS v2 — autoridade de escrita (elimina o limite de 1MiB) ===\n');

// Mock Firestore: doc por chave; a chave 'orcamentos' (array legado) pode
// ser configurada para FALHAR com um erro "documento grande demais" — as
// chaves por id (erp_vr_orcamentos/{id}) nunca têm esse problema (cada
// documento é pequeno por construção).
function makeMockDb({ legadoFalha } = {}) {
  var store = {};
  var db = {
    collection: function () {
      return {
        doc: function (key) {
          return {
            __key: key,
            get: function () { return Promise.resolve({ exists: !!store[key], data: function () { return store[key]; } }); }
          };
        }
      };
    },
    runTransaction: function (fn) {
      return Promise.resolve().then(function () {
        if (key_about_to_fail(fn)) { /* noop placeholder, real check happens in txn.set below */ }
        var txn = {
          get: function (r) { return r.get(); },
          set: function (r, val) {
            if (legadoFalha && r.__key === 'orcamentos') {
              var e = new Error('Firestore: documento excede 1048576 bytes');
              e.code = 'invalid-argument';
              throw e;
            }
            store[r.__key] = val;
          }
        };
        return fn(txn);
      });
    }
  };
  function key_about_to_fail() { return false; }
  db._store = store;
  return db;
}

(async function () {
  // ── 1. Array legado PERTO DO LIMITE: a gravação do espelho legado falha,
  // mas o save do orçamento (via erp_vr_orcamentos/{id}) SUCEDE — nunca mais
  // o bug real do #000266. ──────────────────────────────────────────────────
  {
    var db = makeMockDb({ legadoFalha: true });
    var sessao = mod.criarSessao(db);
    var orc = { id: 'ORC-000266', num: '000266', cliente: 'Cliente Real', itens: [{ prod: 'Placa grande' }] };
    var r = await sessao.orcSetEnviados([orc]);
    ok('1. Legado "grande demais": o save AINDA ASSIM é confirmado (ok:true) — causa raiz do #000266 eliminada', r.ok === true);
    ok('2. Documento próprio (erp_vr_orcamentos/ORC-000266) foi gravado de verdade', !!db._store['ORC-000266'] && db._store['ORC-000266'].num === '000266');
    ok('3. O array legado NÃO foi gravado (falhou, mas isso não apareceu como falha do save)', !db._store['orcamentos']);
  }

  // ── 2. Caso normal (legado cabe): continua funcionando exatamente igual —
  // nenhuma regressão no caminho feliz. ──────────────────────────────────────
  {
    var db2 = makeMockDb({ legadoFalha: false });
    var sessao2 = mod.criarSessao(db2);
    var orc2 = { id: 'ORC-000100', num: '000100', cliente: 'Cliente Normal' };
    var r2 = await sessao2.orcSetEnviados([orc2]);
    ok('4. Caso normal: save confirmado', r2.ok === true);
    ok('5. Caso normal: documento v2 gravado', !!db2._store['ORC-000100']);
    ok('6. Caso normal: espelho legado TAMBÉM gravado (não regride o caminho feliz)', !!db2._store['orcamentos']);
  }

  // ── 3. A FONTE DE VERDADE é erp_vr_orcamentos/{id}: se ESSE write falhar
  // (não o legado), o save deve reportar falha real — nunca finge sucesso. ──
  {
    var db3 = makeMockDb({ legadoFalha: false });
    var origRunTransaction = db3.runTransaction;
    db3.runTransaction = function (fn) {
      return origRunTransaction.call(db3, function (txn) {
        var origSet = txn.set;
        txn.set = function (r, val) {
          if (r.__key === 'ORC-999') { var e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
          return origSet(r, val);
        };
        return fn(txn);
      });
    };
    var sessao3 = mod.criarSessao(db3);
    var orc3 = { id: 'ORC-999', num: '000999', cliente: 'Cliente' };
    var r3 = await sessao3.orcSetEnviados([orc3]);
    ok('7. Falha na fonte de verdade (erp_vr_orcamentos): o save reporta falha real, nunca finge sucesso', r3.ok === false);
  }

  console.log('\n' + passed + ' passou(aram), ' + failed + ' falhou(aram)\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
