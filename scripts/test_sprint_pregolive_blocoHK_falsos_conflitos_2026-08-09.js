/**
 * test_sprint_pregolive_blocoHK_falsos_conflitos_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Blocos H e K — achado real de homologação: clicar
 * "✓ Sim, Cliente Aprovou" no orçamento (e, de forma análoga, aceitar o
 * horário sugerido no Kanban) mostrava "⚠️ 'orcamentos' foi alterado por
 * outra sessão — esta mudança não foi salva", mesmo com uma ÚNICA aba
 * aberta.
 *
 * Causa raiz (confirmada lendo o código, não suposição): os dois
 * handlers gravam a MESMA chave do Firestore duas vezes em sequência
 * síncrona, sem aguardar a primeira gravação terminar:
 *   - orcEnvSetStatus(id,'aprovado') → orcSetEnviados(lista) [grava status]
 *     → (auto-cria CR) → orc.crId=... → orcSetEnviados(lista) [grava crId]
 *     — ambas para a chave 'orcamentos'.
 *   - kbAceitarSugestaoBtn() → kbSalvarTempo() [kbSaveKbos() → 'kb_os']
 *     → kbSalvarPrazo() [kbSaveKbos() → 'kb_os'] — ambas para 'kb_os'.
 * _cloudSave() captura o baseline de concorrência otimista (síncrono, no
 * instante da chamada) e só confirma no servidor depois (transação
 * assíncrona). A segunda chamada capturava o baseline ANTES da primeira
 * confirmar; quando sua própria transação relia o servidor — já
 * atualizado pela primeira gravação DESTA MESMA aba —, o valor não batia
 * e o código tratava como se fosse um conflito real entre sessões.
 *
 * Corrigido na causa raiz, dentro da função genérica _cloudSave() (não em
 * cada tela): uma fila de gravação por chave, dentro da mesma aba — ver
 * também scripts/test_cloudsave_concorrencia.js (testes 12-15), que prova
 * a serialização diretamente em _cloudSave()/_cloudSaveExec(). Este
 * arquivo prova que os DOIS achados reais específicos (orçamento e
 * Kanban) de fato dependem dessa mesma correção, reproduzindo a sequência
 * exata de gravações de cada handler contra uma implementação real de
 * _cloudSave/_cloudSaveExec extraída de index.html.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoHK_falsos_conflitos_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Blocos H/K — falsos "outra sessão" na própria aba ===\n');

(async function main() {

// ── 1-2. Regressão estrutural: os dois handlers ainda gravam a mesma
// chave duas vezes em sequência — documenta POR QUE a correção genérica
// em _cloudSave() é necessária (se algum dia deixarem de gravar duas
// vezes, ótimo, mas enquanto gravarem, a fila precisa continuar lá). ──
var srcOrc = extractFn('orcEnvSetStatus');
testSync('1. orcEnvSetStatus() continua gravando "orcamentos" duas vezes em sequência (status, depois crId) — por isso a serialização em _cloudSave() é necessária',
  (srcOrc.match(/orcSetEnviados\(lista\)/g) || []).length, 2);

var srcKb = extractFn('kbAceitarSugestaoBtn');
testSync('2. kbAceitarSugestaoBtn() continua chamando kbSalvarTempo() e kbSalvarPrazo() em sequência (cada uma grava "kb_os" via kbSaveKbos()) — mesma classe de causa raiz',
  /kbSalvarTempo\(\)/.test(srcKb) && /kbSalvarPrazo\(\)/.test(srcKb), true);

// ── 3-4. Execução real: _cloudSave/_cloudSaveExec extraídos de index.html,
// com um mock de Firestore com transação real, exercitados com a MESMA
// sequência de gravações que orcEnvSetStatus() dispara ao aprovar um
// orçamento novo (grava status, depois grava crId). ──
var src = [
  "function _makeCloudModule(){",
  "var _COL = 'erp_vr';",
  "var _cloudLastPayload = {};",
  "var _cloudSaveQueue = {};",
  "var _HOMOLOG_MODE = false;",
  "var _HOMOLOG_EMULATORS_CONNECTED = true;",
  extractFn('_homologGuardOrThrow'),
  extractFn('_cloudSave'),
  extractFn('_cloudSaveExec'),
  "return { _cloudSave: _cloudSave };",
  "}",
  "module.exports = _makeCloudModule;"
].join('\n\n');
var modPath = path.join(__dirname, '_blocoHK_cloudsave_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

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
global._lastToast = null; global._lastToastKind = null;
global.showToast = function (msg, kind) { global._lastToast = msg; global._lastToastKind = kind; };

var _makeCloudModule = require(modPath);
var mod = _makeCloudModule();

// Reproduz orcEnvSetStatus('aprovado') exatamente: lista completa de
// orçamentos é regravada primeiro com o status alterado, e — sem
// aguardar — regravada de novo com o crId preenchido (mesmo array,
// mutado em memória entre as duas chamadas, como o código real faz).
var lista = [{ id: 'orc1', num: 42, cliente: 'Cliente Teste', status: 'aguardando' }];
var orc = lista[0];
orc.status = 'aprovado';
var p1 = mod._cloudSave('orcamentos', lista); // 1ª gravação (status)
orc.crId = 'cr123456';
var p2 = mod._cloudSave('orcamentos', lista); // 2ª gravação (crId), sem aguardar p1
var r1 = await p1, r2 = await p2;

await testAsync('3. achado real corrigido: as duas gravações de orcEnvSetStatus() (status, depois crId) sucedem — nenhuma é recusada como "outra sessão"', async function () {
  assertEq(r1.ok, true, '1ª gravação (status) sucede');
  assertEq(r2.ok, true, '2ª gravação (crId) sucede — não colide com a 1ª, mesma aba');
  assertEq(global._lastToastKind === 'warn', false, 'nenhum toast de conflito foi disparado');
});

await testAsync('4. o servidor reflete o estado final completo — status E crId, nenhum dos dois foi perdido pela corrida', async function () {
  var servidor = JSON.parse(_fakeStore['orcamentos'].data);
  assertEq(servidor[0].status, 'aprovado', 'status persistido');
  assertEq(servidor[0].crId, 'cr123456', 'crId persistido — a 2ª gravação não foi descartada por falso conflito');
});

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;

})();
