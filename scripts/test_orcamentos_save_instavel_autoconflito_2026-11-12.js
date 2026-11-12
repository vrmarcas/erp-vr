/**
 * test_orcamentos_save_instavel_autoconflito_2026-11-12.js
 *
 * ACHADO REAL (smoke de produção pós-deploy, 2026-11-12) — usuário
 * reportou: "o orçamento está salvando de forma inconsistente — salva
 * quando quer", explicitamente SEM o falso conflito já corrigido (ORC-
 * 000046/_orcV2CanonJSON — comparação de ordem de chaves).
 *
 * CAUSA RAIZ REAL: alguns chamadores gravam o MESMO orçamento duas vezes
 * em sequência síncrona, SEM aguardar a 1ª terminar — ex. real no próprio
 * index.html, orcEnvSetStatus(): grava `status` via orcSetEnviados(lista)
 * e, na mesma execução síncrona (sem await), grava `crId` via uma 2ª
 * orcSetEnviados(lista) quando o orçamento é aprovado. Cada uma dispara
 * sua própria orcV2SalvarComConflito(id,...) — ANTES desta correção, sem
 * NENHUMA serialização por id. A 2ª transação capturava baseline/payload
 * ANTES da 1ª confirmar no servidor; ao ler o servidor (já atualizado
 * pela 1ª, desta MESMA aba), o valor não batia com o baseline antigo —
 * autoconflito da MESMA aba, reportado como "outro usuário editou" sem
 * nenhuma concorrência real. Mesma classe de bug já corrigida para o
 * array legado (ver _cloudSave/_cloudSaveQueue) — nunca portada para o
 * caminho v2 quando ele foi criado.
 *
 * Corrigido: orcV2SalvarComConflito() agora enfileira por id (mesmo
 * padrão do _cloudSaveQueue), lendo baseline/payload só depois que a
 * gravação anterior do MESMO id (nesta aba) já terminou.
 *
 * Testa a função REAL extraída de index.html contra um Firestore FAKE
 * (1 documento, runTransaction real) — nunca reimplementada.
 *
 * Uso: node scripts/test_orcamentos_save_instavel_autoconflito_2026-11-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

// _orcV2SalvarComConflitoExec só existe na versão CORRIGIDA — tenta
// extrair; se não existir (versão anterior ao fix), o teste roda só
// orcV2SalvarComConflito mesmo (sem fila), reproduzindo o bug original.
var temFix = html.indexOf('function _orcV2SalvarComConflitoExec(') >= 0;
var fnCanon = extractFn('_orcV2CanonJSON');
var fnSalvarConflito = extractFn('orcV2SalvarComConflito');
var fnSalvarConflitoExec = temFix ? extractFn('_orcV2SalvarComConflitoExec') : '';

function makeFakeDb(docIdFixo, valorInicial) {
  var doc = valorInicial;
  var tentativasTransacao = 0;
  return {
    collection: function () {
      return { doc: function () { return { id: docIdFixo }; } };
    },
    runTransaction: function (fn) {
      tentativasTransacao++;
      var txn = {
        get: function () {
          var exists = doc !== null;
          return Promise.resolve({ exists: exists, data: function () { return doc; } });
        },
        set: function (_ref, val) { doc = val; },
      };
      return Promise.resolve().then(function () { return fn(txn); });
    },
    _valorAtual: function () { return doc; },
    _tentativas: function () { return tentativasTransacao; },
  };
}

function makeModule() {
  var src = [
    fnCanon,
    temFix ? 'var _orcV2SaveQueue = {};' : '',
    fnSalvarConflitoExec,
    fnSalvarConflito,
    'module.exports = {',
    '  _run: function (id, chamadas, db, baselineInicial) {',
    '    _db = db;',
    '    _orcV2LastPayload = { }; if (baselineInicial !== undefined) _orcV2LastPayload[id] = baselineInicial;',
    '    if (typeof _orcV2SaveQueue !== "undefined") _orcV2SaveQueue = {};',
    '    return Promise.all(chamadas.map(function (valor) { return orcV2SalvarComConflito(id, valor); }));',
    '  },',
    '};',
  ].join('\n\n');
  var modPath = path.join(__dirname, '_test_autoconflito_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  global._db = null;
  global._orcV2LastPayload = {};
  global.console = console;
  var mod = require(modPath);
  try { fs.unlinkSync(modPath); } catch (e) {}
  return mod;
}

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

console.log('\n=== Save instável: duas gravações síncronas do MESMO orçamento (status, depois crId) não podem se autoconflitar (achado real 2026-11-12) ===\n');
console.log('Versão de index.html ' + (temFix ? 'COM' : 'SEM') + ' a fila por id (_orcV2SalvarComConflitoExec).\n');

var ID = 'ORC-000900';
var valorBase = { id: ID, num: '000900', cliente: 'Cliente Teste', status: 'aguardando', crId: null };
var valorComStatus = Object.assign({}, valorBase, { status: 'aprovado' });
var valorComStatusECrId = Object.assign({}, valorComStatus, { crId: 'cr123' });

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}

var fakeDb = makeFakeDb(ID, valorBase);
var mod = makeModule();

// Reproduz orcEnvSetStatus(): 1ª chamada grava status, 2ª (síncrona, sem
// aguardar a 1ª) grava status+crId — exatamente a sequência real do
// código (duas chamadas a orcSetEnviados() back-to-back).
var baselineInicial = canon(valorBase); // esta aba já observou o estado-base via listener
var resultadosPromise = mod._run(ID, [valorComStatus, valorComStatusECrId], fakeDb, baselineInicial);

resultadosPromise.then(function (resultados) {
  var r1 = resultados[0], r2 = resultados[1];
  ok('1. a 1ª gravação (status=aprovado) é bem-sucedida', !!r1.ok, 'obtido=' + JSON.stringify(r1));
  ok('2. a 2ª gravação (status+crId), síncrona e sem await da 1ª, TAMBÉM é bem-sucedida — nunca autoconflito', !!r2.ok, 'obtido=' + JSON.stringify(r2));
  ok('2b. a 2ª gravação nunca é reportada como "conflito" (que o toast mostraria como "outro usuário editou")', r2.reason !== 'conflito', 'obtido=' + JSON.stringify(r2));
  var valorFinal = fakeDb._valorAtual();
  ok('3. o valor final no servidor é o da ÚLTIMA gravação (status E crId) — nenhuma das duas foi perdida', valorFinal && valorFinal.crId === 'cr123' && valorFinal.status === 'aprovado', 'obtido=' + JSON.stringify(valorFinal));

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (!temFix) {
    console.log('(Esperado falhar nesta versão — rode novamente após o fix para confirmar que passa.)\n');
  }
  process.exit(failed > 0 ? 1 : 0);
}).catch(function (e) {
  console.error('ERRO INESPERADO:', e);
  process.exit(1);
});
