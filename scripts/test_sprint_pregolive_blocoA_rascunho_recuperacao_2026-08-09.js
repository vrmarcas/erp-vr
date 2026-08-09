/**
 * test_sprint_pregolive_blocoA_rascunho_recuperacao_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco A — o rascunho de "Novo Orçamento" já existia
 * de verdade (Fase F, Seção 5): autosave em nuvem (erp_vr_rascunho_orc/
 * {uid}, isolado por UID nas Rules), cobrindo cliente + linhas de item.
 *
 * Achado real (confirmado lendo o código): a restauração era SILENCIOSA —
 * escrevia direto nos campos do wizard e só mostrava um toast DEPOIS — e
 * só era oferecida em UM ponto de entrada (desbloqueio por inatividade,
 * ver authUnlock). Reabrir "Novo Orçamento" numa navegação normal (sem
 * nunca ter passado pelo bloqueio) nunca oferecia recuperar nada — o
 * rascunho ficava salvo, mas invisível para o usuário.
 *
 * Corrigido: orcRascunhoOferecerRecuperacao() substitui a restauração
 * silenciosa por uma escolha explícita (modal com "Continuar de onde
 * parei" / "Sair e continuar depois" / "Descartar rascunho"), oferecida
 * nos DOIS pontos de entrada reais — nav('orcamento') e authUnlock.
 * "Continuar" entra no wizard VR (orcIniciarFluxoVR — que sempre reseta
 * primeiro) e SÓ DEPOIS aplica os dados do rascunho, nunca na ordem
 * inversa (que apagaria o que acabou de ser restaurado).
 *
 * Uso: node scripts/test_sprint_pregolive_blocoA_rascunho_recuperacao_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco A — recuperação de rascunho com escolha explícita ===\n');

(async function main() {

// ── 1-4. Regressão estrutural: wiring correto nos dois pontos de entrada ──
testSync('1. a função antiga de restauração silenciosa (orcRascunhoRestaurar) não existe mais',
  html.indexOf('function orcRascunhoRestaurar(') >= 0, false);
testSync('2. achado real corrigido: nav(\'orcamento\', ...) agora oferece a recuperação do rascunho (antes, só o desbloqueio fazia isso)',
  /if \(page === 'orcamento'\)[\s\S]{0,900}orcRascunhoOferecerRecuperacao\(_currentSession\.uid\)/.test(html), true);
testSync('3. authUnlock() continua oferecendo a recuperação (agora com escolha, não mais silenciosa)',
  /orcRascunhoOferecerRecuperacao\(_currentSession\.uid\)/.test(html), true);

var srcContinuar = extractFn('orcRascunhoEscolherContinuar');
testSync('4. "Continuar" chama orcIniciarFluxoVR() ANTES de aplicar o rascunho — nunca na ordem inversa (que apagaria o que acabou de ser restaurado, já que orcIniciarFluxoVR sempre reseta o formulário)',
  srcContinuar.indexOf('orcIniciarFluxoVR()') < srcContinuar.indexOf('orcRascunhoAplicar('), true);

// ── 5-11. Execução real: fluxo completo com _db/document/orcAddItem fake ──
var FN_NAMES = ['orcRascunhoEstaVazio', 'orcRascunhoOferecerRecuperacao', 'orcRascunhoFecharModal',
  'orcRascunhoMostrarModal', 'orcRascunhoAplicar', 'orcRascunhoEscolherContinuar', 'orcRascunhoEscolherDescartar',
  'orcRascunhoLimpar'];
var src = [
  "function _makeModule(){",
  FN_NAMES.map(extractFn).join('\n\n'),
  "return { orcRascunhoOferecerRecuperacao: orcRascunhoOferecerRecuperacao, orcRascunhoEscolherContinuar: orcRascunhoEscolherContinuar, orcRascunhoEscolherDescartar: orcRascunhoEscolherDescartar, orcRascunhoFecharModal: orcRascunhoFecharModal };",
  "}",
  "module.exports = _makeModule;"
].join('\n\n');
var modPath = path.join(__dirname, '_blocoA_rascunho_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

function makeAmbiente(draftDoc, wizardVazio) {
  var _els = { orcClientNome: { value: wizardVazio ? '' : 'Já Preenchido' } };
  var _modalEl = null;
  var _deleteCalls = [];
  var _iniciarFluxoVRCalls = 0;
  var _addItemCalls = 0;
  global.orcItemCount = 0;
  global.orcAddItem = function () { global.orcItemCount++; _addItemCalls++; };
  global.orcRecalc = function () {};
  global.orcIniciarFluxoVR = function () { _iniciarFluxoVRCalls++; _els.orcClientNome = { value: '' }; };
  global.showToast = function () {};
  global.cfgEsc = function (s) { return s; };
  global.window = global;
  global.document = {
    getElementById: function (id) {
      if (id === 'orcRascunhoModal') return _modalEl;
      if (!_els[id]) _els[id] = { value: '' };
      return _els[id];
    },
    body: {
      insertAdjacentHTML: function () { _modalEl = { remove: function () { _modalEl = null; } }; }
    },
    querySelectorAll: function () { return { forEach: function () {} }; }
  };
  global._db = {
    collection: function () {
      return {
        doc: function () {
          return {
            get: function () { return Promise.resolve({ exists: !!draftDoc, data: function () { return draftDoc; } }); },
            delete: function () { _deleteCalls.push(true); return Promise.resolve(); }
          };
        }
      };
    }
  };
  return {
    els: function () { return _els; },
    modalAberto: function () { return !!_modalEl; },
    deleteCalls: function () { return _deleteCalls.length; },
    iniciarFluxoVRCalls: function () { return _iniciarFluxoVRCalls; },
    addItemCalls: function () { return _addItemCalls; }
  };
}

var _makeModule = require(modPath);

await testAsync('5. wizard vazio + rascunho com dados: o modal de recuperação é oferecido (nunca restaura sozinho)', async function () {
  var mod = _makeModule();
  var amb = makeAmbiente({ nome: 'Cliente Teste', itens: [{ prod: 'Placa' }], salvoEm: Date.now() }, true);
  await mod.orcRascunhoOferecerRecuperacao('uid1');
  assertEq(amb.modalAberto(), true, 'modal aparece');
  assertEq(amb.els().orcClientNome.value, '', 'campos NÃO são preenchidos sozinhos — só depois de uma escolha explícita');
});

await testAsync('6. wizard JÁ preenchido (edição em andamento): nunca oferece o modal — não interrompe o que o usuário já está fazendo', async function () {
  var mod = _makeModule();
  var amb = makeAmbiente({ nome: 'Cliente Teste', itens: [], salvoEm: Date.now() }, false);
  await mod.orcRascunhoOferecerRecuperacao('uid1');
  assertEq(amb.modalAberto(), false, 'modal não aparece');
});

await testAsync('7. nenhum rascunho salvo: nunca oferece o modal', async function () {
  var mod = _makeModule();
  var amb = makeAmbiente(null, true);
  await mod.orcRascunhoOferecerRecuperacao('uid1');
  assertEq(amb.modalAberto(), false, 'modal não aparece');
});

await testAsync('8. achado real corrigido: escolher "Continuar" chama orcIniciarFluxoVR() e SÓ DEPOIS aplica os dados — nunca perde o rascunho por causa do reset', async function () {
  var mod = _makeModule();
  var amb = makeAmbiente({ nome: 'Cliente Recuperado', itens: [{ prod: 'Placa', qty: '2' }], salvoEm: Date.now() }, true);
  await mod.orcRascunhoOferecerRecuperacao('uid1');
  mod.orcRascunhoEscolherContinuar();
  assertEq(amb.iniciarFluxoVRCalls(), 1, 'orcIniciarFluxoVR() foi chamado exatamente uma vez');
  assertEq(amb.els().orcClientNome.value, 'Cliente Recuperado', 'o nome do cliente foi restaurado DEPOIS do reset, não apagado por ele');
  assertEq(amb.addItemCalls(), 1, 'o item salvo foi recriado');
  assertEq(amb.modalAberto(), false, 'modal fechado após a escolha');
});

await testAsync('9. escolher "Descartar rascunho" apaga o documento salvo e NÃO restaura nada no wizard', async function () {
  var mod = _makeModule();
  var amb = makeAmbiente({ nome: 'Cliente Teste', itens: [], salvoEm: Date.now() }, true);
  await mod.orcRascunhoOferecerRecuperacao('uid1');
  mod.orcRascunhoEscolherDescartar();
  assertEq(amb.deleteCalls(), 1, 'o rascunho foi apagado do Firestore');
  assertEq(amb.els().orcClientNome.value, '', 'nada foi restaurado no wizard');
  assertEq(amb.modalAberto(), false, 'modal fechado após a escolha');
});

await testAsync('10. escolher "Sair e continuar depois" (fechar o modal) NÃO apaga o rascunho nem restaura nada — pode ser oferecido de novo depois', async function () {
  var mod = _makeModule();
  var amb = makeAmbiente({ nome: 'Cliente Teste', itens: [], salvoEm: Date.now() }, true);
  await mod.orcRascunhoOferecerRecuperacao('uid1');
  mod.orcRascunhoFecharModal();
  assertEq(amb.deleteCalls(), 0, 'o rascunho continua salvo — nada foi apagado');
  assertEq(amb.els().orcClientNome.value, '', 'nada foi restaurado no wizard');
  assertEq(amb.modalAberto(), false, 'modal fechado');
});

await testAsync('11. rascunho tecnicamente existente mas sem nenhum dado real (nome vazio e sem itens): nunca oferece o modal por um documento vazio', async function () {
  var mod = _makeModule();
  var amb = makeAmbiente({ nome: '', itens: [], salvoEm: Date.now() }, true);
  await mod.orcRascunhoOferecerRecuperacao('uid1');
  assertEq(amb.modalAberto(), false, 'modal não aparece para um rascunho vazio');
});

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;

})();
