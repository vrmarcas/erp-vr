/**
 * test_hotfix_atendimentos_briefing_crm_orcamento_2026-08-22.js
 *
 * RODADA 9, BLOCOS G/H/I (2026-08-22) — a tela de Atendimentos existia mas
 * ficava isolada do resto do ERP: o painel direito não mostrava os dados
 * estruturados que a ValerIA já extrai da conversa (achado real de
 * auditoria: valeria_briefings/{atendimentoId} já existe no backend —
 * produto/medidas/material/prazo/quantidade + completude + campos
 * faltando — mas nunca era lido pelo painel), e não havia caminho
 * conversa → cliente/oportunidade → orçamento.
 *
 * Corrigido (frontend, sem tocar no "cérebro" da ValerIA — só integração
 * operacional, reaproveitando dados/fluxos já existentes):
 * - atdBriefingListenerInit()/atdBriefingHtml(): lê e renderiza o briefing
 *   já existente, com status ✅ (confirmado) / ❌ (faltando, só para os
 *   campos que o backend já considera essenciais) e prontidão para
 *   orçamento (% + lista do que falta).
 * - Ações de criar/abrir cliente/oportunidade: ver
 *   scripts/test_hotfix_atendimentos_botoes_acao_2026-08-23.js e
 *   scripts/test_hotfix_atendimentos_functions_vinculo_2026-08-23.js
 *   (RODADA 9, Fechamento — redesenhadas para persistir de verdade via
 *   Cloud Function, não mais só pré-preencher um modal).
 * - atdRevisarCriarOrcamento(): abre Novo Orçamento pré-preenchido com
 *   cliente + primeiro item (quando o briefing tiver produto/medidas/
 *   material) — nunca inventa dado ausente, o cálculo continua sendo do
 *   motor oficial (orcRecalc).
 *
 * ATUALIZAÇÃO (Rodada 9, Fechamento, 2026-08-23): a regra de
 * valeria_briefings JÁ foi deployada (`firebase deploy --only
 * firestore:rules`, ver relatório final) — o comentário original abaixo
 * ficou obsoleto; o listener continua com o mesmo catch defensivo por
 * segurança, mas a leitura já deve funcionar em produção.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * atdBriefingHtml, atdRenderPainel, atdRevisarCriarOrcamento.
 *
 * Uso: node scripts/test_hotfix_atendimentos_briefing_crm_orcamento_2026-08-22.js
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

// HOTFIX BLOCO G (Rodada de Hardening, Fase 2, 2026-08-26) — atdRenderPainel()
// passou a normalizar o fallback de orçamento via orcEnvNormalizar() (schema
// legado × ValerIA), nunca reimplementada.
var FN_NAMES = ['atdBriefingHtml', 'atdRenderPainel', 'atdRevisarCriarOrcamento', 'orcEnvNormalizar'];
global.window = global;
global.cfgEsc = function (v) { return v == null ? '' : String(v).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };

var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_atd_briefing_crm_orc_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, innerHTML: '', options: [] }, props || {}); }

var _els, _toasts, _navCalls;
function reset() {
  _els = {
    atdColPainel: makeEl(),
    nlNome: makeEl(), nlTel: makeEl(), nlProduto: makeEl(), nlObs: makeEl(), nlMarca: makeEl(),
    orcClientNome: makeEl(), orcClientTel: makeEl(),
    oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl(), oi_alt_1: makeEl(), oi_det_1: makeEl(),
    oi_prod_1: makeEl({ value: '', options: [
      { text: 'Placa', value: 'Placa' }, { text: 'Display', value: 'Display' }, { text: 'Caixa', value: 'Caixa' }
    ] }),
  };
  global.document = { getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); } };
  _toasts = [];
  global.showToast = function (msg, kind) { _toasts.push({ msg: msg, kind: kind }); };
  _navCalls = [];
  global.nav = function (page) { _navCalls.push(page); };
  global.crmAbrirNovoLead = function () { global._crmAbriuModal = true; };
  global.orcOnProdChange = function (sel) { global._orcOnProdChangeArg = sel; };
  global.orcRecalc = function () { global._orcRecalcChamado = true; };
  global._crmAbriuModal = false;
  global._orcOnProdChangeArg = null;
  global._orcRecalcChamado = false;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 9, Blocos G/H/I — briefing estruturado + CRM/orçamento a partir do Atendimento ===\n');

// ── atdBriefingHtml: sem dados ainda ──────────────────────────────────────
(function () {
  var out = mod.atdBriefingHtml(null);
  assertTrue(/sem dados estruturados/i.test(out), '1. sem briefing: mostra claramente "ainda sem dados", nunca uma tela vazia sem explicação');
})();

// ── atdBriefingHtml: parcial (achado real — o atendente não deveria reler a conversa) ──
(function () {
  var briefing = { produto: 'Caixa', larguraMm: 300, alturaMm: 200, quantidade: 2, camposFaltando: ['material', 'acabamento', 'prazo', 'referencia', 'observacoes'], completude: 40, classificacao: 'personalizada' };
  var out = mod.atdBriefingHtml(briefing);
  assertTrue(out.indexOf('✅ Produto') >= 0 && out.indexOf('Caixa') >= 0, '2. campo confirmado (produto) aparece com ✅ e o valor');
  assertTrue(out.indexOf('✅ Largura (mm)') >= 0 && out.indexOf('300') >= 0, '3. largura confirmada aparece com ✅ e o valor em mm');
  assertTrue(out.indexOf('❌ Material') >= 0, '4. material faltando aparece com ❌ — nunca omitido silenciosamente');
  assertTrue(out.indexOf('40%') >= 0, '5. prontidão para orçamento mostra o percentual real (40%)');
  assertTrue(/faltam:/i.test(out) && out.indexOf('material') >= 0, '6. lista explicitamente o que falta — achado explícito do pedido');
  assertTrue(out.indexOf('Personalizada') >= 0, '7. classificação da demanda (personalizada/catálogo/semi-personalizada) aparece');
})();

// ── atdBriefingHtml: completo — "dados suficientes" ──────────────────────
(function () {
  var briefing = { produto: 'Placa', larguraMm: 100, alturaMm: 50, quantidade: 1, material: 'Acrílico', acabamento: 'Polido', prazo: '5 dias', referencia: 'ref-1', observacoes: 'sem obs', camposFaltando: [], completude: 100 };
  var out = mod.atdBriefingHtml(briefing);
  assertTrue(/✅ Dados suficientes para orçamento/.test(out), '8. 100% de completude: mostra claramente "dados suficientes para orçamento"');
  assertTrue(out.indexOf('❌') === -1, '9. nenhum campo aparece como faltando quando completude é 100%');
})();

// ── atdRenderPainel: botões Criar vs Abrir conforme vínculo ──────────────
(function () {
  reset();
  global.ATD_CACHE = [{ id: 'atd1', nome: 'Cliente Teste', telefoneE164: '+5562999990000', classificacao: 'nao_classificado', marca: 'vr' }];
  global.ATD_BRIEFING_CACHE = null;
  mod.atdRenderPainel(global.ATD_CACHE[0]);
  var out = _els.atdColPainel.innerHTML;
  assertTrue(/Criar\/Abrir cliente/.test(out), '10. sem clienteId vinculado: botão oferece CRIAR (não fica travado em "Abrir" desabilitado)');
  assertTrue(/Criar\/Abrir oportunidade/.test(out), '11. sem leadId vinculado: botão oferece CRIAR oportunidade');
  assertTrue(/Revisar e criar orçamento/.test(out), '12. sem orçamento vinculado: botão de revisar/criar orçamento aparece — achado explícito do pedido (conversa → orçamento)');
})();

(function () {
  reset();
  global.ATD_CACHE = [{ id: 'atd2', nome: 'Cliente Vinculado', clienteId: 'cli123', leadId: 'lead456', orcamentoId: 'orc789', classificacao: 'catalogo', marca: 'vitre' }];
  global.ATD_BRIEFING_CACHE = null;
  mod.atdRenderPainel(global.ATD_CACHE[0]);
  var out = _els.atdColPainel.innerHTML;
  assertTrue(/Abrir cliente/.test(out) && !/Criar\/Abrir cliente/.test(out), '13. com clienteId já vinculado: botão vira "Abrir" (nunca oferece criar de novo — nunca duplica)');
  assertTrue(/Abrir oportunidade/.test(out) && !/Criar\/Abrir oportunidade/.test(out), '14. com leadId já vinculado: botão vira "Abrir"');
  assertTrue(/Abrir orçamento/.test(out) && !/Revisar e criar/.test(out), '15. com orcamentoId já vinculado: botão vira "Abrir orçamento"');
})();

// RODADA 9, FECHAMENTO (2026-08-23) — atdCriarOuAbrirLead() foi removida:
// os botões "Criar/Abrir cliente"/"Criar/Abrir oportunidade" deixaram de
// só pré-preencher um modal (achado real: nada persistia) e passaram a
// chamar Cloud Functions dedicadas que persistem o vínculo de verdade —
// ver scripts/test_hotfix_atendimentos_botoes_acao_2026-08-23.js e
// scripts/test_hotfix_atendimentos_functions_vinculo_2026-08-23.js, que
// cobrem esse comportamento (novo) por completo.

// ── atdRevisarCriarOrcamento: prefill correto, nunca inventa ─────────────
(function () {
  reset();
  global.ATD_CACHE = [{ id: 'atd4', nome: 'Maria Souza', telefoneE164: '+5562977776666' }];
  global.ATD_BRIEFING_CACHE = { produto: 'Placa', material: 'Acrílico Cristal', acabamento: 'Polido', larguraMm: 300, alturaMm: 200, quantidade: 2, prazo: '5 dias úteis', referencia: 'REF-99' };
  mod.atdRevisarCriarOrcamento('atd4');
})();
setTimeout(function () {
  test('22. navega para a tela de Novo Orçamento', _navCalls, ['orcamento']);
  test('23. nome do cliente pré-preenchido', _els.orcClientNome.value, 'Maria Souza');
  test('24. telefone pré-preenchido', _els.orcClientTel.value, '+5562977776666');
  test('25. quantidade pré-preenchida a partir do briefing', _els.oi_qty_1.value, 2);
  test('26. largura convertida de mm (briefing) para cm (unidade do orçamento): 300mm → 30.0cm', _els.oi_larg_1.value, '30.0');
  test('27. altura convertida de mm para cm: 200mm → 20.0cm', _els.oi_alt_1.value, '20.0');
  assertTrue(_els.oi_det_1.value.indexOf('Acrílico Cristal') >= 0 && _els.oi_det_1.value.indexOf('Polido') >= 0 && _els.oi_det_1.value.indexOf('REF-99') >= 0, '28. detalhes reúnem material/acabamento/referência — nada do briefing é silenciosamente perdido');
  test('29. produto com opção EXATA no dropdown (Placa) é selecionado automaticamente', _els.oi_prod_1.value, 'Placa');
  assertTrue(global._orcOnProdChangeArg === _els.oi_prod_1, '30. dispara orcOnProdChange() ao selecionar o produto (mesmo comportamento de uma troca manual)');
  assertTrue(global._orcRecalcChamado === true, '31. recalcula pelo motor OFICIAL do orçamento (orcRecalc) — a IA nunca aplica preço próprio');

  // ── Produto sem correspondência exata — nunca adivinha por aproximação ──
  reset();
  global.ATD_CACHE = [{ id: 'atd5', nome: 'Cliente X' }];
  global.ATD_BRIEFING_CACHE = { produto: 'Totem luminoso gigante', larguraMm: 100, alturaMm: 100, quantidade: 1 };
  mod.atdRevisarCriarOrcamento('atd5');
  setTimeout(function () {
    test('32. produto sem opção exata no catálogo: dropdown NÃO é forçado para nenhum valor arbitrário (fica vazio/"Personalizado")', _els.oi_prod_1.value, '');
    assertTrue(_els.oi_det_1.value.indexOf('Totem luminoso gigante') >= 0, '33. nome do produto identificado é preservado nos Detalhes para conferência — nunca perdido silenciosamente');

    try { fs.unlinkSync(modPath); } catch (e) {}
    console.log('\n' + '='.repeat(70));
    console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
    console.log('='.repeat(70) + '\n');
    if (failed > 0) process.exitCode = 1;
  }, 350);
}, 350);
