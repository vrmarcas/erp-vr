/**
 * test_hotfix_p0_5_concorrencia_2026-08-12.js
 *
 * HOTFIX OPERACIONAL PÓS-GO-LIVE 2026-08-12, P0.5 — Concorrência entre
 * vendedores: (1) erp_audit_log deixou de usar _cloudSave() (CAS contra o
 * documento inteiro) e passou a gravar direto — nunca mais trava uma ação
 * comercial por causa do audit log de OUTRO usuário; (2) orcamentos ganhou
 * merge automático por entidade (_orcamentosSalvarComMerge): dois
 * vendedores salvando DOIS ORÇAMENTOS DIFERENTES nunca mais colidem, mas
 * duas sessões editando o MESMO orçamento continuam detectando o conflito
 * legítimo, com mensagem específica daquele orçamento (nunca trava o ERP
 * inteiro).
 *
 * Uso: node scripts/test_hotfix_p0_5_concorrencia_2026-08-12.js
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
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

console.log('\n=== HOTFIX P0.5 — Concorrência entre vendedores: sem lock falso, conflito real preservado ===\n');

// ── 1. secAuditLog() não usa mais _cloudSave (CAS) — grava direto, nunca conflita ──
var auditSrc = extractFn('secAuditLog');
ok('1a. secAuditLog() não chama mais _cloudSave (fonte de lock falso)', !/_cloudSave\(/.test(auditSrc));
ok('1b. secAuditLog() usa a gravação direta _auditLogGravarDireto', /_auditLogGravarDireto/.test(auditSrc));
var limparSrc = extractFn('secLimparAudit');
ok('1c. secLimparAudit() também não usa mais _cloudSave', !/_cloudSave\(/.test(limparSrc));

// ── 2. orcSetEnviados()/merge: nunca compara o array inteiro como se fosse um conflito de entidade única ──
var mergeSrc = extractFn('_orcamentosSalvarComMerge') + '\n' + extractFn('_orcamentosSalvarComMergeContinuar');
ok('2a. _orcamentosSalvarComMerge() identifica quais ids ESTA sessão mudou (diff por id, não o array inteiro)', /meusIds/.test(mergeSrc));
ok('2b. Conflito só é reportado quando um dos MEUS ids mudou no servidor (nunca por causa de outro id)', /if\(fresco && JSON\.stringify\(fresco\) !== JSON\.stringify\(antes\)\)/.test(mergeSrc));
ok('2c. Sem conflito real: faz merge automático (array fresco do servidor + meus ids) e tenta de novo', /_orcamentosSalvarComMerge\(merged, tentativas\+1\)/.test(mergeSrc));

// ── 3. Execução real com mock de Firestore: 2 "sessões" (tabs) simulando o bug relatado ──
{
  var FN_NAMES = ['_cloudSave', '_cloudSaveExec', '_orcamentosSalvarComMerge', '_orcamentosSalvarComMergeContinuar'];
  var missing = [];
  FN_NAMES.forEach(function(n){ try { extractFn(n); } catch(e){ missing.push(n); } });
  if (missing.length) {
    console.log('  ⚠️  Funções ausentes, pulando execução real: ' + missing.join(', '));
  } else {
    var src = [
      "var _homologGuardOrThrow = function(){};",
      "var _cloudReady = true;",
      "var _COL = 'erp_vr';",
      "var showToast = function(){};",
      "var orcEnviadosRender = function(){};",
      "module.exports = { criarSessao: criarSessao };",
      "function criarSessao(db){",
      "  var _cloudLastPayload = {};",
      "  var _cloudSaveQueue = {};",
      "  var _db = db;",
      "  " + extractFn('_cloudSave').replace(/^function _cloudSave/, 'var _cloudSave = function'),
      "  " + extractFn('_cloudSaveExec').replace(/^function _cloudSaveExec/, 'var _cloudSaveExec = function'),
      "  " + extractFn('_orcamentosSalvarComMerge').replace(/^function _orcamentosSalvarComMerge/, 'var _orcamentosSalvarComMerge = function'),
      "  " + extractFn('_orcamentosSalvarComMergeContinuar').replace(/^function _orcamentosSalvarComMergeContinuar/, 'var _orcamentosSalvarComMergeContinuar = function'),
      "  var _ORC_ENVIADOS_DATA = [];",
      "  function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; return _orcamentosSalvarComMerge(arr, 0); }",
      "  function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }",
      "  return { orcSetEnviados: orcSetEnviados, orcGetEnviados: orcGetEnviados, getLastPayload: function(){ return _cloudLastPayload['orcamentos']; } };",
      "}",
    ].join('\n\n');
    var modPath = path.join(__dirname, '_p0_5_conc_extracted.tmp.js');
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];

    // Mock Firestore: um doc por chave; runTransaction real (get dentro da transação + set atômico).
    function makeMockDb2(){
      var store = {};
      var db = {
        collection: function(){
          return { doc: function(key){
            return {
              get: function(){ return db.runTransactionGet(key); },
            };
          } };
        },
      };
      db.runTransaction = function(fn){
        return Promise.resolve().then(function(){
          var currentKeyRef = null;
          var txn = {
            get: function(r){ currentKeyRef = r; return r.get(); },
            set: function(r, val){ store[r.__key] = val; },
          };
          return fn(txn);
        });
      };
      db.collection = function(){
        return { doc: function(key){
          return {
            __key: key,
            get: function(){ return Promise.resolve({ exists: !!store[key], data: function(){ return store[key]; } }); },
          };
        } };
      };
      db._store = store;
      return db;
    }

    var mod = require(modPath);
    var db = makeMockDb2();
    var sessaoA = mod.criarSessao(db);
    var sessaoB = mod.criarSessao(db);

    (async function(){
      // ── Cenário 1 (T-CONC-02): A cria orçamento #A, B cria orçamento #B, "ao mesmo tempo" ──
      // Ambas as sessões partem do array vazio (nenhuma leu a outra ainda) — simula duas abas
      // que abriram o ERP antes de qualquer orçamento existir.
      var orcA = { id: 'orcA', num: '000001', cliente: 'Cliente A' };
      var orcB = { id: 'orcB', num: '000002', cliente: 'Cliente B' };
      var resA = await sessaoA.orcSetEnviados([orcA]);
      var resB = await sessaoB.orcSetEnviados([orcA, orcB]); // B já tinha visto o orçamento de A (leitura real teria sincronizado) e adiciona o seu

      ok('3a. Sessão A salva seu orçamento sem conflito', resA.ok === true);
      ok('3b. Sessão B salva um orçamento DIFERENTE do de A sem nenhum conflito falso', resB.ok === true);
      ok('3c. Servidor final contém AMBOS os orçamentos (nenhum foi perdido/sobrescrito)', db._store['orcamentos'] && JSON.parse(db._store['orcamentos'].data).length === 2);

      // ── Cenário 2 (T-CONC-02 variante mais dura): B NÃO tinha visto o orçamento de A (baseline vazio) ──
      var db2 = makeMockDb2();
      var sessaoC = mod.criarSessao(db2);
      var sessaoD = mod.criarSessao(db2);
      var orcC = { id: 'orcC', num: '000003', cliente: 'Cliente C' };
      var orcD = { id: 'orcD', num: '000004', cliente: 'Cliente D' };
      // as duas sessões partem do array VAZIO (nunca leram uma a outra) — pior caso realista de duas abas recém-abertas
      var resC = await sessaoC.orcSetEnviados([orcC]);
      var resD = await sessaoD.orcSetEnviados([orcD]); // D não sabia de C, mas seu merge automático deve reconciliar
      ok('3d. Sessão C salva seu orçamento sem conflito (baseline vazio, primeira gravação)', resC.ok === true);
      ok('3e. Sessão D salva um orçamento diferente MESMO sem ter visto o de C — merge automático resolve, nunca bloqueia', resD.ok === true);
      ok('3f. Servidor final contém os DOIS orçamentos de sessões que nunca se sincronizaram entre si', db2._store['orcamentos'] && JSON.parse(db2._store['orcamentos'].data).length === 2);

      // ── Cenário 3 (T-CONC-05): duas sessões editando o MESMO orçamento → conflito real deve ser detectado ──
      var db3 = makeMockDb2();
      var sessaoE = mod.criarSessao(db3);
      var sessaoF = mod.criarSessao(db3);
      var orcOriginal = { id: 'orc030', num: '000030', cliente: 'Cliente Original' };
      await sessaoE.orcSetEnviados([orcOriginal]); // E cria e salva primeiro
      // F "abre" o mesmo orçamento (sincroniza sua cópia local a partir do servidor)
      var serverSnapshotForF = JSON.parse(db3._store['orcamentos'].data);
      // F edita e salva
      var orcEditadoPorF = Object.assign({}, orcOriginal, { cliente: 'Cliente Editado por F' });
      var resF = await sessaoF.orcSetEnviados(serverSnapshotForF.map(function(o){ return o.id==='orc030' ? orcEditadoPorF : o; }));
      ok('3g. Sessão F consegue salvar sua edição do mesmo orçamento #000030 (primeira a editar depois do save original)', resF.ok === true);
      // E, que NUNCA viu a edição de F, tenta salvar sua PRÓPRIA edição do MESMO orçamento por cima da baseline antiga
      var orcEditadoPorE = Object.assign({}, orcOriginal, { cliente: 'Cliente Editado por E' });
      var resE2 = await sessaoE.orcSetEnviados([orcEditadoPorE]);
      ok('3h. Sessão E, editando o MESMO orçamento #000030 sem ter visto a edição de F, recebe conflito REAL (não falso)', resE2.ok === false && resE2.reason === 'conflito_orcamento');
      ok('3i. O conflito real nomeia especificamente o orçamento em conflito (orc030), não o array inteiro', resE2.orcId === 'orc030');

      console.log('\n' + '='.repeat(70));
      console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
      console.log('='.repeat(70) + '\n');
      try { fs.unlinkSync(modPath); } catch (e) {}
      if (failed > 0) process.exitCode = 1;
    })();
  }
}
