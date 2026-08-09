/**
 * test_sprint_pregolive_blocoB_stalestate_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco B — achado real de homologação: um Novo
 * Orçamento exibia taxa/valor de parcela/total do cartão do orçamento
 * ANTERIOR, corrigido só depois de alternar o toggle "Parcelamento no
 * cartão" Sim→Não→Sim manualmente. Causa raiz: orcResetFormularioVR()
 * (fluxo VR) e orcIniciarFluxoVitre() (fluxo Vitre) nunca limpavam o card
 * compartilhado "Resumo do Orçamento" (orcParcToggle/orcDescCondToggle/
 * orcPixDiscToggle/_pgtoTipoAtual) — o motor central (orcMotorPagamento)
 * lê esses campos direto do DOM, então o estado do orçamento anterior
 * sobrevivia sem o usuário tocar em nada.
 *
 * Corrigido extraindo um helper único (orcResetCondicoesPagamentoCompartilhadas)
 * chamado tanto por orcResetFormularioVR() quanto por orcIniciarFluxoVitre().
 *
 * Uso: node scripts/test_sprint_pregolive_blocoB_stalestate_2026-08-09.js
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

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco B — reset de estado ao iniciar novo orçamento ===\n');

// ── 1. orcResetCondicoesPagamentoCompartilhadas() — execução real ───────
{
  var src = extractFn('orcResetCondicoesPagamentoCompartilhadas') + '\n\nmodule.exports = { orcResetCondicoesPagamentoCompartilhadas };';
  var modPath = path.join(__dirname, '_blocoB_reset_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  function makeEl(props) { return Object.assign({ value: '', checked: false, innerHTML: '' }, props || {}); }
  var _els = {
    orcDescCondToggle: makeEl({ checked: true }),
    orcDescCond: makeEl({ value: '10' }),
    orcDescCondData: makeEl({ value: '2026-08-20' }),
    orcPixDiscPct: makeEl({ value: '5' }),
    // SPRINT PRÉ-GO-LIVE, Bloco E — parcelamento no cartão (1/2/3x sem
    // juros) e desconto PIX deixaram de ser Sim/Não: não existe mais
    // orcParcToggle/orcPixDiscToggle.checked para o reset desmarcar. O
    // achado real de stale-state agora se traduz em: o seletor de
    // parcelas (orcParcSel) precisa ser limpo, para não herdar a
    // opção/seleção (ex.: "6x", herdado de um orçamento salvo ANTES desta
    // rodada, quando ainda existiam mais de 3 parcelas) do anterior.
    orcParcSel: makeEl({ value: '6', innerHTML: '<option value="6">6x — herdado do orçamento anterior</option>' })
  };
  global.document = { getElementById: function (id) { return _els[id]; } };
  global._pgtoTipoAtual = '50-50';
  // orcToggleDescCond/orcToggleParc/orcTogglePixDisc intencionalmente
  // ausentes — o teste foca no que o próprio reset faz diretamente
  // (valores limpos, _pgtoTipoAtual=null), não na cascata de refresh
  // visual (já coberta por outros testes desta suíte).

  var mod = require(modPath);
  mod.orcResetCondicoesPagamentoCompartilhadas();

  test('1. achado real: orcDescCondToggle (desconto condicional) é desmarcado ao iniciar novo orçamento',
    _els.orcDescCondToggle.checked, false);
  test('2. valor e data do desconto condicional são limpos', [_els.orcDescCond.value, _els.orcDescCondData.value], ['', '']);
  test('3. achado real (Bloco E): orcParcSel é limpo — não herda a opção/seleção de parcelas do orçamento anterior',
    _els.orcParcSel.innerHTML, '');
  test('4. achado real: percentual do desconto PIX (orcPixDiscPct) é limpo — não herda o % configurado no orçamento anterior',
    _els.orcPixDiscPct.value, '');
  test('5. achado real: _pgtoTipoAtual (tipo de pagamento do modal de confirmação) volta a null',
    global._pgtoTipoAtual, null);
}

// ── 2. Regressão estrutural: os dois pontos de entrada de "novo orçamento" chamam o reset compartilhado ──
{
  var srcResetVR = extractFn('orcResetFormularioVR');
  test('6. orcResetFormularioVR() (fluxo VR) chama o reset compartilhado de condições de pagamento',
    /orcResetCondicoesPagamentoCompartilhadas\(\)/.test(srcResetVR), true);

  var srcVitreFluxo = extractFn('orcIniciarFluxoVitre');
  test('7. achado real: orcIniciarFluxoVitre() (fluxo Vitre) também chama o reset compartilhado — antes só o fluxo VR limpava esse card, então um Vitre novo herdava taxa/parcela/PIX de um VR ou híbrido anterior',
    /orcResetCondicoesPagamentoCompartilhadas/.test(srcVitreFluxo), true);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
