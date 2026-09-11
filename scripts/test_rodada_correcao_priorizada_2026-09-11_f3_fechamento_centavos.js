/**
 * test_rodada_correcao_priorizada_2026-09-11_f3_fechamento_centavos.js
 *
 * RODADA DE CORREÇÃO PRIORIZADA (2026-09-11) — F3 (P1), terceiro achado
 * confirmado pela auditoria funcional real de produção (sessão anterior):
 *
 *   Reprodução real: em dois momentos distintos do mesmo orçamento,
 *   "Subtotal dos itens" + "Custos gerais" (+ "Ajuste comercial", quando
 *   visível) não batia com o "TOTAL" exibido — diferença de R$0,01, nos
 *   dois sentidos (R$59,92 esperado / R$59,93 exibido; depois R$508,52
 *   esperado / R$508,51 exibido).
 *
 * CAUSA RAIZ: `ajusteOrcamentoTotal` já era definido "por construção"
 * como o resíduo exato em ponto flutuante (finalPrice − subtotal − custos
 * gerais − legados − vitre), o que garante a igualdade em PRECISÃO TOTAL —
 * mas cada linha do rodapé (Subtotal/Custos gerais/Legados/Vitre/Ajuste/
 * TOTAL) é arredondada de forma INDEPENDENTE para 2 casas na hora de
 * EXIBIR (orcFmt). Quando o resíduo real é menor que meio centavo, a
 * linha "Ajuste" ficava oculta (limiar antigo: >=0.005) — mas o TOTAL
 * exibido (arredondado) podia não bater com a soma das linhas exibidas
 * (também arredondadas de forma independente).
 *
 * FIX: cada parcela é arredondada a CENTAVOS INTEIROS primeiro, e o
 * Ajuste é definido como o resíduo em centavos inteiros — garante que a
 * SOMA DAS LINHAS EXIBIDAS bate exatamente com o TOTAL EXIBIDO, sempre.
 *
 * Reaproveita o harness de extração viva de orcRecalc() já validado em
 * scripts/test_rodada_estabilizacao_2026-09-10_preco_por_item.js.
 *
 * Uso: node scripts/test_rodada_correcao_priorizada_2026-09-11_f3_fechamento_centavos.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

const src = [
  'var document = global.__DOC__;',
  'var window = global.__WIN__;',
  'var _cfgData = global.__CFG_DATA__;',
  'var ORC_ITEM_EXTRAS = global.__ORC_ITEM_EXTRAS__;',
  'var ORC_ITEM_AJUSTES = global.__ORC_ITEM_AJUSTES__;',
  'var ORC_ITEM_OPCOES = global.__ORC_ITEM_OPCOES__;',
  'var _orcVitreItensPedido = [];',
  'function _matGetRsm2(matKey, idx) { return global.__MAT_PRICE_M2__[matKey] != null ? global.__MAT_PRICE_M2__[matKey] : 100; }',
  'function _matResolverPrecoFamiliaEspessura() { return null; }',
  'function _planPecaAdesivos(p) { return { normal: !!p.adesivoNormal, branco: !!p.adesivoBranco }; }',
  'function _planPecaEspOverride() { return { tem: false, esp: 0 }; }',
  'function cfgLoad() { return _cfgData; }',
  'function orcGetItemExtrasTotal() { var t=0; Object.keys(ORC_ITEM_EXTRAS).forEach(function(k){ var e=ORC_ITEM_EXTRAS[k]; t += (e.acabamento||0)+(e.instalacao||0)+(e.outros||0); }); return t; }',
  'function orcVitreItensPedidoTotal() { return 0; }',
  'function orcSetV(id, v) { if (document.__elements__[id]) document.__elements__[id].textContent = String(v); }',
  "function orcFmt(v) { return 'R$'+(v||0).toFixed(2).replace('.',','); }",
  'function orcProdutoNomeResolvido(idx) { return "Item "+idx; }',
  'function cfgEsc(s) { return s; }',
  'function showToast() {}',
  extractFn('orcItemAplicarAjuste'),
  extractFn('orcRecalc'),
  'module.exports = { orcRecalc: orcRecalc };'
].join('\n\n');
const modPath = path.join(__dirname, '_f3_fechamento_centavos_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(value) { return { value: value, checked: false, textContent: '', innerHTML: '', dataset: {} }; }

function buildHarness(rows, opts) {
  opts = opts || {};
  const elements = {};
  elements['orcDescTipo'] = makeEl(opts.descTipo || 'pct');
  elements['orcDesc'] = makeEl(opts.desc != null ? opts.desc : 0);
  elements['orcAcresTipo'] = makeEl(opts.acresTipo || 'pct');
  elements['orcAcres'] = makeEl(opts.acres != null ? opts.acres : 0);
  if (opts.montagem != null) elements['orcMontagem'] = makeEl(opts.montagem);
  if (opts.deslocamento != null) elements['orcDesl'] = makeEl(opts.deslocamento);
  // Necessários para o bloco de fechamento (orcBreak/orcTotalVal) rodar —
  // sem eles, orcRecalc() pula o bloco inteiro (`if (tv) {...}`) e não há
  // nada pra comparar.
  elements['orcTotalVal'] = makeEl('');
  elements['orcUnitLbl'] = makeEl('');
  elements['orcBreak'] = makeEl('');
  elements['orcTotalVal3'] = makeEl('');
  elements['orcUnitLbl3'] = makeEl('');
  elements['orcBreak3'] = makeEl('');

  const fakeRows = rows.map(function (r) {
    elements['oi_qty_' + r.idx] = makeEl(r.qty);
    elements['oi_larg_' + r.idx] = makeEl(r.larg || 0);
    elements['oi_alt_' + r.idx] = makeEl(r.alt || 0);
    elements['oi_mat_' + r.idx] = makeEl(r.matKey || 'ac3');
    elements['oi_esp_' + r.idx] = makeEl(r.esp || 0);
    elements['oi_custo_' + r.idx] = makeEl('');
    elements['oi_unit_' + r.idx] = makeEl('');
    elements['oi_tot_' + r.idx] = makeEl('');
    elements['oir_' + r.idx] = makeEl('');
    const row = { dataset: {} };
    row.dataset.idx = r.idx;
    if (r.planArea) row.dataset.planArea = String(r.planArea);
    if (r.planPecas) row.dataset.planPecas = JSON.stringify(r.planPecas);
    return row;
  });

  return {
    __elements__: elements,
    getElementById: function (id) { return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null; },
    querySelectorAll: function (sel) { return sel === '#orcItemBody tr' ? fakeRows : []; }
  };
}

function runRecalc(rows, opts) {
  const doc = buildHarness(rows, opts);
  global.__DOC__ = doc;
  global.__WIN__ = { _orcHidratando: false, _orcMostrandoCongelado: false, _orcAdhPrecoSnapshot: null };
  global.__CFG_DATA__ = { financeiro: { overhead: 41.16, vrml: 20, impostos: 0, adesivoPrecoCm2: 0.0056, adesivoBrancoPrecoCm2: 0.0011 } };
  global.__ORC_ITEM_EXTRAS__ = opts.extras || {};
  global.__ORC_ITEM_AJUSTES__ = opts.ajustes || {};
  global.__ORC_ITEM_OPCOES__ = opts.opcoes || {};
  global.__MAT_PRICE_M2__ = opts.matPrices || { ac3: 100 };
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);
  mod.orcRecalc();
  return doc.__elements__;
}

// Extrai todos os valores "R$X,XX" de dentro de orcBreak.innerHTML (cada
// linha do rodapé) e soma — nunca reimplementa a lógica de negócio, só lê
// o que a função real escreveu na tela (mesma técnica de todo teste desta
// suíte: ler o resultado real, não recalcular em paralelo).
function somarLinhasDoRodape(breakHtml) {
  // Cada linha do rodapé é um <div style="display:flex;justify-content:
  // space-between...">...</div> — divide nesse marcador de abertura (mais
  // robusto que contar </div> aninhados, já que o valor de cada span não
  // tem filhos).
  const linhas = breakHtml.split('<div style="display:flex;justify-content:space-between').filter(function (l) { return l.indexOf('<span') >= 0; });
  let soma = 0;
  linhas.forEach(function (linha) {
    if (linha.indexOf('TOTAL</span>') >= 0) return; // a própria linha do TOTAL não entra na soma das PARTES
    if (linha.indexOf('Margem aplicada') >= 0) return; // % — não é valor monetário
    if (linha.indexOf('Custo Total') >= 0) return; // informativo (Step 3), não faz parte da equação subtotal+custos+ajuste=total
    const negativo = linha.indexOf('>-R$') >= 0;
    const m = linha.match(/R\$\s?([\d.,]+)/g);
    if (!m) return;
    const ultimo = m[m.length - 1]; // valor da linha é sempre o último R$ do bloco (label pode conter outro texto, mas não R$)
    const num = parseFloat(ultimo.replace('R$', '').trim().replace(/\./g, '').replace(',', '.'));
    soma += negativo ? -num : num;
  });
  return soma;
}

function parseBRL(str) {
  return parseFloat(String(str).replace('R$', '').trim().replace(/\./g, '').replace(',', '.')) || 0;
}

console.log('\n=== RODADA DE CORREÇÃO PRIORIZADA 2026-09-11 — F3: fechamento do orçamento em centavos exatos ===\n');

// ══════════════════════════════════════════════════════════════════════
// Bateria de cenários variados (qty, materiais, custos gerais, ajuste
// comercial escopo orçamento) escolhidos para produzir resíduos de
// arredondamento pequenos (<meio centavo) — exatamente a condição que
// escondia o bug antes da correção.
// ══════════════════════════════════════════════════════════════════════
const CENARIOS = [
  { nome: '1 item, sem custos gerais', rows: [{ idx: '1', qty: 1, larg: 20, alt: 15, matKey: 'ac3' }], opts: { matPrices: { ac3: 97.42 } } },
  { nome: '1 item + custos gerais (máquinas/montagem/deslocamento)', rows: [{ idx: '1', qty: 1, larg: 20, alt: 15, matKey: 'ac3' }], opts: { montagem: 1.5, deslocamento: 0, matPrices: { ac3: 97.42 } } },
  { nome: '2 itens (Caixa 6 peças-like + Urna-like), custos gerais', rows: [
      { idx: '1', qty: 1, larg: 10, alt: 10, matKey: 'ac3', planArea: 1300, planPecas: [{ origem: 'MANUAL', larg: 65, alt: 20, qty: 1 }] },
      { idx: '2', qty: 3, larg: 10, alt: 10, matKey: 'ac3', planArea: 1266, planPecas: [{ origem: 'MANUAL', larg: 63.3, alt: 20, qty: 1 }] }
    ], opts: { montagem: 0.85, matPrices: { ac3: 97.42 } } },
  { nome: '3 itens, ajuste comercial escopo orçamento (+R$15)', rows: [
      { idx: '1', qty: 1, larg: 5, alt: 5, matKey: 'ac3' },
      { idx: '2', qty: 5, larg: 10, alt: 10, matKey: 'ac3' },
      { idx: '3', qty: 2, larg: 30, alt: 20, matKey: 'ac3' }
    ], opts: { matPrices: { ac3: 97.42 }, ajustes: { '2': { operacao: 'acrescimo', tipo: 'fixo', valor: 15, escopo: 'orcamento' } } } },
  { nome: 'muitos decimais (material a R$63.77/m², qty=7)', rows: [{ idx: '1', qty: 7, larg: 13, alt: 17, matKey: 'ac3' }], opts: { matPrices: { ac3: 63.77 }, montagem: 2.13, deslocamento: 1.07 } },
  { nome: 'desconto percentual global 7%', rows: [{ idx: '1', qty: 3, larg: 22, alt: 18, matKey: 'ac3' }], opts: { matPrices: { ac3: 84.90 }, descTipo: 'pct', desc: 7 } },
];

CENARIOS.forEach(function (cen) {
  test('F3 — ' + cen.nome + ': Subtotal + Custos gerais + Legados + Vitre + Ajuste (linhas exibidas) = TOTAL exibido, exato', function () {
    const els = runRecalc(cen.rows, cen.opts);
    const totalExibido = parseBRL(els['orcTotalVal'].textContent);
    const somaLinhas = somarLinhasDoRodape(els['orcBreak'].innerHTML);
    if (Math.abs(somaLinhas - totalExibido) > 0.001) {
      throw new Error('soma das linhas exibidas (' + somaLinhas.toFixed(2) + ') != TOTAL exibido (' + totalExibido.toFixed(2) + ')');
    }
  });
});

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
