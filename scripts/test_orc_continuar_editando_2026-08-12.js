/**
 * test_orc_continuar_editando_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seção 9-13 — bug real reproduzido em produção
 * (Orçamento #000018): clicar "Continuar editando" no modal "Você possui
 * um orçamento ainda não salvo" só fechava o modal (orcNovoOrcamentoFecharModal
 * antiga), deixando o operador preso na tela de escolha de fluxo (opg0) —
 * mesmo com "Editando orçamento #000018" ainda visível no banner e os
 * dados intactos no DOM. Causa raiz: nav('orcamento') sempre chama
 * orcEscolhaFluxo() ao entrar na página (linha ~8430), então reabrir
 * "Novo Orçamento" pelo menu enquanto se edita um orçamento salvo
 * silenciosamente troca a visão para o seletor VR/Vitre, sem limpar nada.
 *
 * Corrigido: "Continuar editando" agora chama orcNovoOrcamentoEscolherContinuar(),
 * que reexibe o wizard na última etapa realmente ativa
 * (window._orcUltimoStepAtivo, gravado por orcStep) — nunca cria número
 * novo, nunca limpa dado, nunca fica preso no seletor.
 *
 * Uso: node scripts/test_orc_continuar_editando_2026-08-12.js
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

console.log('\n=== "Continuar editando" restaura o editor real (não só fecha o modal) ===\n');

// ── 0. O botão do modal chama a função corrigida, não a antiga (que só fechava) ──
(function () {
  var btnMarker = "onclick=\"orcNovoOrcamentoEscolherContinuar()\" style=\"padding:10px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text);font-weight:700;font-size:12px;cursor:pointer\">Continuar editando</button>";
  test('0a. botão "Continuar editando" do modal chama orcNovoOrcamentoEscolherContinuar()', html.indexOf(btnMarker) >= 0, true);
  test('0b. orcNovoOrcamentoEscolherContinuar não chama orcResetFormularioVR (nunca limpa dado ao continuar)', /function orcNovoOrcamentoEscolherContinuar[\s\S]{0,400}?orcResetFormularioVR/.test(html), false);
})();

// ── 1. Simulação DOM: orcStep grava a última etapa ativa, e "continuar" volta pra ela ──
(function () {
  // Mock mínimo de DOM — cada elemento é um objeto simples com .style/.value/.classList
  function makeEl(id) {
    return {
      id: id, value: '', textContent: '', innerHTML: '',
      style: { display: '' },
      classList: { _c: [], add: function(c){ if(this._c.indexOf(c)<0) this._c.push(c); }, remove: function(c){ this._c=this._c.filter(function(x){return x!==c;}); }, contains: function(c){ return this._c.indexOf(c)>=0; } },
      dataset: {}, options: [], selectedIndex: 0
    };
  }
  var elements = {};
  ['opg0','opg1','opg2','opg4','opg5','vitreOrcWrap','vitreOrcSteps','orcNovoOrcModal',
   'ostp1','ostp2','ostp3','ostp4','ostp5'].forEach(function(id){ elements[id] = makeEl(id); });
  var toastMsgs = [];
  var mockDoc = {
    getElementById: function (id) { return elements[id] || null; },
    querySelector: function (sel) { if (sel === '.orc-steps') { if(!elements['__orcSteps']) elements['__orcSteps']=makeEl('__orcSteps'); return elements['__orcSteps']; } return null; },
    querySelectorAll: function (sel) {
      if (sel === '.orc-pg') return [elements.opg1, elements.opg2, elements.opg4, elements.opg5];
      return [];
    },
  };
  var src = [
    'var document = MOCK_DOC;',
    'var window = GLOBAL_WINDOW;',
    'var ORC_TIPO = null;',
    'function showToast(msg){ TOAST_LOG.push(msg); }',
    'function orcSyncStep3Result(){}',
    'function orcUpdateSummary(){}',
    'function orcPreencherPrazoAuto(){}',
    'function orcPgtoAtualizarValorReceber(){}',
    'function orcPopularBancos(){}',
    extractFn('orcStep').replace(/^function orcStep/, 'function orcStepImpl'),
    // Stubs no-ops for everything orcStep conditionally calls at step 4/5 (guarded by typeof checks — leaving undefined is fine)
    extractFn('orcNovoOrcamentoFecharModal'),
    extractFn('orcNovoOrcamentoEscolherContinuar').replace('orcStep(', 'orcStepImpl('),
    'module.exports = { step: orcStepImpl, continuar: orcNovoOrcamentoEscolherContinuar, getWindow: function(){ return window; } };',
  ].join('\n\n');
  var modPath = path.join(__dirname, '_orc_continuar_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  global.MOCK_DOC = mockDoc;
  global.GLOBAL_WINDOW = {};
  global.TOAST_LOG = toastMsgs;
  var mod = require(modPath);

  // Simula: orcEnvEditar(#000018) chamou orcStep(4) — operador estava na etapa 4
  mod.step(4);
  test('1a. orcStep(4) grava window._orcUltimoStepAtivo=4', mod.getWindow()._orcUltimoStepAtivo, 4);
  test('1b. opg4 fica visível após orcStep(4)', elements.opg4.style.display, 'block');

  // Simula: nav('orcamento') roda orcEscolhaFluxo() por baixo dos panos —
  // esconde tudo e mostra o seletor (opg0), sem alterar window._orcUltimoStepAtivo
  elements.opg4.style.display = 'none';
  elements.opg0.style.display = 'block';
  // Simula: usuário clicou "VR", viu o modal "orçamento ainda não salvo",
  // e agora clica "Continuar editando"
  elements.orcNovoOrcModal.remove = function(){ elements.orcNovoOrcModal.style.display='removed'; };
  // getElementById precisa retornar um objeto com .remove() para orcNovoOrcamentoFecharModal
  mod.continuar();

  test('2a. modal é removido', elements.orcNovoOrcModal.style.display, 'removed');
  test('2b. seletor de fluxo (opg0) é escondido — nunca fica preso na tela "qual fluxo?"', elements.opg0.style.display, 'none');
  test('2c. wizard volta para a ÚLTIMA etapa ativa (opg4), não para o passo 1', elements.opg4.style.display, 'block');
  test('2d. toast de confirmação mostrado ao operador', toastMsgs.indexOf('Continuando o orçamento em andamento') >= 0, true);

  try { fs.unlinkSync(modPath); } catch (e) {}
})();

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
