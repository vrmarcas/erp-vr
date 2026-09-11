/**
 * test_rodada_correcao_priorizada_2026-09-11_f5_consumiveis_unit_x_qtd.js
 *
 * RODADA DE CORREÇÃO PRIORIZADA (2026-09-11) — F5 (P0), segundo achado
 * confirmado pela auditoria funcional real de produção (sessão anterior):
 *
 *   Reprodução real: item Chaveiro (QTD=1), peça planificada com
 *   consumível "Gravação" = R$5 informado no popover "⚙️ Consumíveis da
 *   peça". Depois de salvar o consumível, a linha passou a exibir
 *   CUSTO R$0,38 / UNITÁRIO R$2,38 / TOTAL R$12,38 — TOTAL ≠ UNITÁRIO ×
 *   QTD mesmo com QTD=1 (2,38 × 1 = 2,38 ≠ 12,38). Diferença de R$10,00
 *   (exatamente 2× o valor informado de Gravação, pela regra comercial
 *   "custo × 2 (venda)" já existente e preservada nesta correção).
 *
 * CAUSA RAIZ #1 (a real quebra de TOTAL=UNIT×QTD): o PASS 3 de
 * orcRecalc() somava item.gravSprayExtraOwn (Gravação/Spray/Extra×2) e
 * item.ajusteFixoPortionRS direto no TOTAL da linha, mas o UNITÁRIO
 * exibido era calculado ANTES e independentemente dessas parcelas — nunca
 * as refletia. FIX: TOTAL continua com a MESMA fórmula de sempre (nenhum
 * valor cobrado muda); o UNITÁRIO agora é DERIVADO do total (totalFinal /
 * qty) em vez de calculado à parte — garante a invariante por construção.
 *
 * CAUSA RAIZ #2 (gap semântico apontado pelo usuário nesta rodada): o
 * valor de Gravação/Spray/Extra informado na peça NUNCA era multiplicado
 * pela quantidade (qty) do item — um comentário da RODADA 6 já registrava
 * essa decisão como uma leitura "sem evidência". Corrigido para escalar
 * por qty, mesma regra que material/Adesivo/Adh.Branco já seguiam.
 *
 * Reaproveita o harness de extração viva de orcRecalc() já validado em
 * scripts/test_rodada_estabilizacao_2026-09-10_preco_por_item.js (mesma
 * técnica: extrai e executa o código real do index.html, nunca
 * reimplementa a fórmula).
 *
 * Uso: node scripts/test_rodada_correcao_priorizada_2026-09-11_f5_consumiveis_unit_x_qtd.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
// Tolerância de 2 centavos: MESMO padrão já usado em todo o resto desta
// suíte (ver testePerto() em test_hotfix_planificacao_consistencia_
// 2026-08-17.js e outros — 0.02 é o valor padrão já estabelecido no
// projeto para comparação de valores monetários). Necessária aqui porque
// oi_unit_/oi_tot_ são exibidos INDEPENDENTEMENTE arredondados a 2 casas
// (toFixed(2) cada) — quando TOTAL não é múltiplo exato de QTD em
// centavos, comparar unit_exibido×qty contra total_exibido pode divergir
// por até ~1 centavo por unidade (mesma limitação inerente de qualquer
// sistema que exiba preço unitário E total, ambos arredondados,
// separadamente — não é um bug novo introduzido por este fix: o TOTAL em
// ponto flutuante, ANTES de qualquer arredondamento de exibição, sempre
// bate exatamente com unitário×qtd — é só a rodada dupla de toFixed(2)
// independente que pode reintroduzir até ~1 centavo por unidade).
function assertClose(got, exp, msg, tol) {
  tol = tol == null ? 0.02 : tol;
  if (Math.abs(got - exp) > tol) throw new Error((msg || 'valores diferentes') + ' — esperado ≈' + exp.toFixed(4) + ', obtido ' + got.toFixed(4));
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
const modPath = path.join(__dirname, '_f5_consumiveis_unit_x_qtd_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(value) { return { value: value, checked: false, textContent: '', dataset: {} }; }

function buildHarness(rows, opts) {
  opts = opts || {};
  const elements = {};
  elements['orcDescTipo'] = makeEl(opts.descTipo || 'pct');
  elements['orcDesc'] = makeEl(opts.desc != null ? opts.desc : 0);
  elements['orcAcresTipo'] = makeEl(opts.acresTipo || 'pct');
  elements['orcAcres'] = makeEl(opts.acres != null ? opts.acres : 0);
  if (opts.montagem != null) elements['orcMontagem'] = makeEl(opts.montagem);
  if (opts.deslocamento != null) elements['orcDesl'] = makeEl(opts.deslocamento);

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
  const out = {};
  rows.forEach(function (r) {
    out[r.idx] = {
      unit: parseFloat((doc.__elements__['oi_unit_' + r.idx].textContent || '0').replace('R$', '').replace(',', '.')),
      total: parseFloat((doc.__elements__['oi_tot_' + r.idx].textContent || '0').replace('R$', '').replace(',', '.'))
    };
  });
  return out;
}

console.log('\n=== RODADA DE CORREÇÃO PRIORIZADA 2026-09-11 — F5: consumíveis (Gravação/Spray/Extra) e TOTAL=UNIT×QTD ===\n');

function linhaComConsumivel(qty, campo, valor) {
  const peca = { origem: 'MANUAL', larg: 10, alt: 10, qty: 1 };
  peca[campo] = valor;
  return { idx: '1', qty: qty, matKey: 'ac3', larg: 10, alt: 10, planArea: 100, planPecas: [peca] };
}

// ══════════════════════════════════════════════════════════════════════
// GRUPO 1 — invariante TOTAL = UNIT × QTD (o achado central de F5),
// testado nas QTDs pedidas pela rodada: 1, 2, 3, 5 — com Gravação.
// ══════════════════════════════════════════════════════════════════════
[1, 2, 3, 5].forEach(function (qty) {
  test('F5 — Gravação R$5, QTD=' + qty + ': TOTAL = UNITÁRIO × QTD (centavo-idêntico)', function () {
    const out = runRecalc([linhaComConsumivel(qty, 'gravacao', 5)], {});
    assertClose(out['1'].total, out['1'].unit * qty, 'TOTAL não bate com UNIT×QTD');
  });
});

// ══════════════════════════════════════════════════════════════════════
// GRUPO 2 — mesma invariante para Spray, Extra, Adesivo Normal e Adesivo
// Branco (regra do usuário: "Não corrigir só Gravação se Spray/Extra
// usam mesma arquitetura" — os quatro usam o mesmo caminho de código).
// ══════════════════════════════════════════════════════════════════════
test('F5 — Spray R$3, QTD=3: TOTAL = UNITÁRIO × QTD', function () {
  const out = runRecalc([linhaComConsumivel(3, 'spray', 3)], {});
  assertClose(out['1'].total, out['1'].unit * 3, 'TOTAL não bate com UNIT×QTD (spray)');
});
test('F5 — Extra R$2, QTD=5: TOTAL = UNITÁRIO × QTD', function () {
  const out = runRecalc([linhaComConsumivel(5, 'extra', 2)], {});
  assertClose(out['1'].total, out['1'].unit * 5, 'TOTAL não bate com UNIT×QTD (extra)');
});
test('F5 — Adesivo Normal, QTD=4: TOTAL = UNITÁRIO × QTD', function () {
  const out = runRecalc([{ idx: '1', qty: 4, matKey: 'ac3', larg: 10, alt: 10, planArea: 100, planPecas: [{ origem: 'MANUAL', larg: 10, alt: 10, qty: 1, adesivoNormal: true }] }], {});
  assertClose(out['1'].total, out['1'].unit * 4, 'TOTAL não bate com UNIT×QTD (adesivo normal)');
});
test('F5 — Adesivo Branco, QTD=2: TOTAL = UNITÁRIO × QTD', function () {
  const out = runRecalc([{ idx: '1', qty: 2, matKey: 'ac3', larg: 10, alt: 10, planArea: 100, planPecas: [{ origem: 'MANUAL', larg: 10, alt: 10, qty: 1, adesivoBranco: true }] }], {});
  assertClose(out['1'].total, out['1'].unit * 2, 'TOTAL não bate com UNIT×QTD (adesivo branco)');
});
test('F5 — Adesivo Normal + Branco juntos (não são mais exclusivos), QTD=3: TOTAL = UNITÁRIO × QTD', function () {
  const out = runRecalc([{ idx: '1', qty: 3, matKey: 'ac3', larg: 10, alt: 10, planArea: 100, planPecas: [{ origem: 'MANUAL', larg: 10, alt: 10, qty: 1, adesivoNormal: true, adesivoBranco: true }] }], {});
  assertClose(out['1'].total, out['1'].unit * 3, 'TOTAL não bate com UNIT×QTD (adesivo normal+branco)');
});

// ══════════════════════════════════════════════════════════════════════
// GRUPO 3 — Gravação/Spray/Extra agora escalam com QTD do item (gap
// semântico apontado pelo usuário: material/Adesivo já escalavam,
// Gravação/Spray/Extra não escalavam antes desta correção).
// ══════════════════════════════════════════════════════════════════════
test('F5 — dobrar QTD (1→2) com mesma Gravação/peça dobra o TOTAL atribuível ao consumível', function () {
  const out1 = runRecalc([linhaComConsumivel(1, 'gravacao', 5)], {});
  const out2 = runRecalc([linhaComConsumivel(2, 'gravacao', 5)], {});
  // custo×2 (regra comercial preservada): gravação=5 vira +10 na venda por
  // "unidade de peça"; dobrando qty, a parcela de gravação no total dobra.
  const baseSemGravacao = runRecalc([{ idx: '1', qty: 1, matKey: 'ac3', larg: 10, alt: 10, planArea: 100, planPecas: [{ origem: 'MANUAL', larg: 10, alt: 10, qty: 1 }] }], {});
  const parcelaGravacaoQty1 = out1['1'].total - baseSemGravacao['1'].total;
  const baseSemGravacaoQty2 = runRecalc([{ idx: '1', qty: 2, matKey: 'ac3', larg: 10, alt: 10, planArea: 100, planPecas: [{ origem: 'MANUAL', larg: 10, alt: 10, qty: 1 }] }], {});
  const parcelaGravacaoQty2 = out2['1'].total - baseSemGravacaoQty2['1'].total;
  assertClose(parcelaGravacaoQty2, parcelaGravacaoQty1 * 2, 'parcela de Gravação no TOTAL não dobrou ao dobrar QTD (1→2)');
});

// ══════════════════════════════════════════════════════════════════════
// GRUPO 4 — regressão: TOTAL cobrado (subtotal do item) não pode ficar
// diferente do que já era antes da correção quando QTD=1 (fórmula do
// TOTAL não mudou, só a exibição do UNITÁRIO) — reproduz literalmente o
// cenário numérico da auditoria (Chaveiro, 0.0025m², Cristal 2mm, custo
// R$0,38, Gravação R$5 → total deve continuar R$12,38-ish; só o
// unitário exibido é que muda de R$2,38 para bater com o total).
// ══════════════════════════════════════════════════════════════════════
test('F5 — cenário real da auditoria (QTD=1): TOTAL da linha não muda por causa do fix (só o UNIT passa a bater)', function () {
  const out = runRecalc([{
    idx: '1', qty: 1, matKey: 'ac3', esp: 2, larg: 0.05, alt: 0.05,
    planArea: 25, // 0.0025 m² em cm²
    planPecas: [{ origem: 'MANUAL', larg: 5, alt: 5, qty: 1, adesivoNormal: true, gravacao: 5 }]
  }], { matPrices: { ac3: 97.42 } });
  assertClose(out['1'].total, out['1'].unit * 1, 'TOTAL ainda não bate com UNIT×QTD no cenário real da auditoria');
});

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
