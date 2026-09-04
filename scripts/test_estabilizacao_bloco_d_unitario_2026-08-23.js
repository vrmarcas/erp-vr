/**
 * test_estabilizacao_bloco_d_unitario_2026-08-23.js
 *
 * RODADA DE ESTABILIZAÇÃO (2026-08-23) — Bloco D.
 *
 * BUG real de produção: mesmo item/config (só variando a quantidade), o
 * preço UNITÁRIO comercial mudava — qty 1 ≈R$45,46, qty 2 ≈R$45,24, qty 6
 * ≈R$45,16. Regra oficial: unitário é FIXO; total = unitário × quantidade.
 *
 * Causa raiz (auditoria dedicada): o PASS 3 de orcRecalc() dava a cada item
 * uma fatia proporcional do POOL INTEIRO do pedido — incluindo custos FIXOS
 * do pedido (máquinas, montagem, deslocamento, extras por item, que NÃO
 * escalam com a quantidade de peças) — e dividia essa fatia por item.qty.
 * Custo fixo dividido por quantidade nunca é constante.
 *
 * Corrigido isolando o unitário comercial para refletir só material+markup+
 * ajuste PRÓPRIO do item (item.tsRaw, já linear em qty por construção) —
 * nunca mais custo fixo do pedido. Máquinas/consumíveis/montagem/
 * deslocamento/extras continuam 100% cobrados (linha própria no resumo),
 * só deixaram de ser diluídos dentro do "Unit." de uma peça específica.
 * orcColetarItensDistribuidos() (PDF/WhatsApp) — mesma correção, via escala
 * UNIFORME (não mais rateio por peso) sobre o total já correto de cada item.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * orcRecalc, orcColetarItensDistribuidos.
 *
 * Uso: node scripts/test_estabilizacao_bloco_d_unitario_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertCloseTo(got, expected, msg, eps) {
  eps = eps == null ? 0.005 : eps;
  if (Math.abs(got - expected) <= eps) { console.log('  ✅  ' + msg); passed++; }
  else { console.log('  ❌  ' + msg + '\n       esperado ≈ ' + expected + '\n       obtido   = ' + got); failed++; }
}

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

console.log('\n=== RODADA DE ESTABILIZAÇÃO — Bloco D (preço unitário mudando com a quantidade) ===\n');

var FN_NAMES = [
  'orcProdutoNomeResolvido','orcFmt', 'orcRecalc', 'orcColetarItensDistribuidos'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_estabilizacao_bloco_d.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, dataset: {}, remove: function () {}, options: [{ dataset: {}, text: '' }], selectedIndex: 0 }, props || {}); }

var _els;
// Custos FIXOS do pedido (não devem escalar com qty do item nem diluir o
// unitário) — todos > 0 de propósito: se a correção regredir, o unitário
// volta a variar com qty exatamente como o bug original.
function reset(qty) {
  _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '50' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    oi_qty_1: makeEl({ value: String(qty) }), oi_larg_1: makeEl({ value: '30' }), oi_alt_1: makeEl({ value: '20' }),
    oi_mat_1: makeEl({ value: 'ac3' }),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    orcMontagem: makeEl({ value: '80' }), orcDesl: makeEl({ value: '40' }),
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(),
    oir_1: makeEl(),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
  };
  global.document = {
    body: { appendChild: function () {} },
    createElement: function () { return makeEl(); },
    getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return [{ dataset: { idx: '1' } }];
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; }; // R$100/m² fixo — mesma config em todos os testes
  global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  global.orcItemCount = 1;
  global.orcUpdateSummary = function () {};
  global.orcSetV = function (id, v) { var el = _els[id] || (_els[id] = makeEl()); el.value = v; };
  global._orcHidratando = false;
  global._orcMostrandoCongelado = false;
  global.showToast = function () {};
  global._orcCalc = {};
  global.orcItemDescricaoComercial = function (item) { return item.prod || 'Item'; };
  global.osItemMateriaisResumo = function () { return ''; };
}

function parseReais(txt) { return parseFloat(String(txt).replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0; }

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════════
// 1-5 — mesmo item/config, só variando qty: unitário IDÊNTICO em todas
// ══════════════════════════════════════════════════════════════════════════
var unitarios = {};
[1, 2, 3, 6, 10].forEach(function (qty) {
  reset(qty);
  mod.orcRecalc();
  unitarios[qty] = parseReais(_els.oi_unit_1.textContent);
});
assertCloseTo(unitarios[2], unitarios[1], '1. qty 1 → 2: unitário idêntico (' + unitarios[1] + ' ≈ ' + unitarios[2] + ')');
assertCloseTo(unitarios[3], unitarios[1], '2. qty 1 → 3: unitário idêntico');
assertCloseTo(unitarios[6], unitarios[1], '3. qty 1 → 6: unitário idêntico — reprodução exata do caso real relatado (qty 1/2/6)');
assertCloseTo(unitarios[10], unitarios[1], '4. qty 1 → 10: unitário idêntico');
assertTrue(unitarios[1] > 0, '5. (sanity) unitário calculado é um valor real positivo, não um placeholder zerado');

// ══════════════════════════════════════════════════════════════════════════
// 6 — TOTAL da linha = unitário × quantidade (identidade pedida) — testado
// SEM custo fixo do pedido, para verificar a identidade em estado puro.
// Com custo fixo presente (máquinas/montagem/deslocamento — um valor único
// do PEDIDO, nunca desta peça), Total = Unit×Qty + a fatia desse custo
// fixo que este item absorve (ver teste 8/9, abaixo, e o mesmo padrão já
// usado por Gravação/Spray/Extra/Extra-por-item — nenhum deles nunca foi
// dividido por qty, e continuam 100% cobrados no TOTAL, só não mais no
// "Unit."). Exigir Total===Unit×Qty também COM custo fixo presente
// reintroduziria o próprio bug (obrigaria o custo fixo a ser diluído por
// qty para a identidade fechar) — ver teste 15, que confirma a mesma
// identidade quando o "extra" a mais é conhecido (taxa de cartão).
// ══════════════════════════════════════════════════════════════════════════
[1, 2, 3, 6, 10].forEach(function (qty) {
  reset(qty);
  _els.om_laser.value = '0'; _els.orcMontagem.value = '0'; _els.orcDesl.value = '0'; // sem custo fixo do pedido
  mod.orcRecalc();
  var unit = parseReais(_els.oi_unit_1.textContent);
  var tot = parseReais(_els.oi_tot_1.textContent);
  assertCloseTo(tot, unit * qty, '6. qty=' + qty + ' (sem custo fixo do pedido): Total (' + tot + ') = Unitário × Quantidade (' + (unit * qty).toFixed(2) + ')');
});

// ══════════════════════════════════════════════════════════════════════════
// 7 — ida e volta: 1 → 10 → 1, unitário retorna ao mesmo valor exato
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset(1);
  mod.orcRecalc();
  var u1a = parseReais(_els.oi_unit_1.textContent);
  _els.oi_qty_1.value = '10';
  mod.orcRecalc();
  _els.oi_qty_1.value = '1';
  mod.orcRecalc();
  var u1b = parseReais(_els.oi_unit_1.textContent);
  assertCloseTo(u1b, u1a, '7. qty 1 → 10 → 1: unitário retorna exatamente ao valor original (' + u1a + ' → ' + u1b + ')');
})();

// ══════════════════════════════════════════════════════════════════════════
// 8-9 — custos fixos (máquina/montagem/deslocamento) continuam 100% cobrados
// no TOTAL do pedido — só pararam de ser diluídos no unitário da peça.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset(1);
  mod.orcRecalc();
  var totalComCustoFixo = global._orcCalc.finalPrice || 0;
  reset(1);
  _els.om_laser.value = '0'; _els.orcMontagem.value = '0'; _els.orcDesl.value = '0';
  mod.orcRecalc();
  var totalSemCustoFixo = global._orcCalc.finalPrice || 0;
  assertTrue(totalComCustoFixo > totalSemCustoFixo, '8. custo fixo (máquina/montagem/deslocamento) continua aumentando o TOTAL do pedido — não foi removido, só deixou de ser diluído no unitário');
  assertTrue(totalComCustoFixo - totalSemCustoFixo > 100, '9. a diferença corresponde à magnitude real dos custos fixos configurados (laser+montagem+deslocamento=170), não um resíduo');

  // 9b — item ÚNICO no pedido: absorve 100% do custo fixo no seu próprio
  // TOTAL de linha (mesma regra de sempre — rateio por peso, trivial com 1
  // item só) — e essa fatia é uma CONSTANTE em R$, nunca diluída por qty:
  // dobrar a quantidade não deveria mudar QUANTO do custo fixo este item
  // absorve, só quanto material ele soma por cima.
  var fatiaQty1, fatiaQty5;
  reset(1); mod.orcRecalc();
  fatiaQty1 = parseReais(_els.oi_tot_1.textContent) - parseReais(_els.oi_unit_1.textContent) * 1;
  reset(5); mod.orcRecalc();
  fatiaQty5 = parseReais(_els.oi_tot_1.textContent) - parseReais(_els.oi_unit_1.textContent) * 5;
  assertCloseTo(fatiaQty5, fatiaQty1, '9b. a fatia de custo fixo absorvida pelo item (Total − Unit×Qty) é a MESMA em qty=1 e qty=5 — nunca diluída, sempre um valor fixo em R$');
})();

// ══════════════════════════════════════════════════════════════════════════
// 10-12 — desconto/acréscimo explícito É a única exceção permitida: unitário
// muda com ajuste comercial, e volta ao base quando o ajuste é removido.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  reset(4);
  mod.orcRecalc();
  var unitBase = parseReais(_els.oi_unit_1.textContent);

  reset(4);
  _els.orcDesc.value = '10'; // 10% de desconto GLOBAL — ação comercial explícita
  mod.orcRecalc();
  var unitComDesconto = parseReais(_els.oi_unit_1.textContent);
  assertTrue(unitComDesconto < unitBase, '10. desconto explícito (única exceção permitida pela regra) reduz o unitário');

  reset(4);
  _els.orcAcres.value = '15'; // 15% de acréscimo comercial GLOBAL — ação explícita
  mod.orcRecalc();
  var unitComAcrescimo = parseReais(_els.oi_unit_1.textContent);
  assertTrue(unitComAcrescimo > unitBase, '11. acréscimo explícito (única exceção permitida) aumenta o unitário');

  reset(4);
  _els.orcDesc.value = '0'; _els.orcAcres.value = '0'; // remove o ajuste
  mod.orcRecalc();
  var unitSemAjuste = parseReais(_els.oi_unit_1.textContent);
  assertCloseTo(unitSemAjuste, unitBase, '12. removendo o ajuste comercial, o unitário volta EXATAMENTE ao valor base');
})();

// ══════════════════════════════════════════════════════════════════════════
// 13-16 — orcColetarItensDistribuidos() (PDF/WhatsApp).
//
// Nuance real (não é regressão, é a mesma restrição que test_gate4/
// espessura_extras já protegiam antes desta rodada): o "Subtotal" exibido
// ao CLIENTE precisa somar exatamente o "VALOR TOTAL" do pedido (inclusive
// custo fixo — máquinas/montagem/deslocamento — que o cliente paga de
// verdade). Para um pedido de item único, isso força Subtotal===VALOR
// TOTAL sempre, e "unitário" ali é só Subtotal/qty por definição de
// exibição — não o "preço unitário comercial" do Bloco D (esse é o
// oi_unit_ do Step 3, já garantido invariante nos testes 1-12). Quando NÃO
// há custo fixo no pedido (cenário abaixo), as duas noções coincidem e a
// invariante de qty se mantém — prova que o mecanismo de redistribuição em
// si não reintroduz o bug original.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var unitsColetaSemFixo = {};
  [1, 6].forEach(function (qty) {
    reset(qty);
    _els.om_laser.value = '0'; _els.orcMontagem.value = '0'; _els.orcDesl.value = '0'; // sem custo fixo
    mod.orcRecalc();
    var itens = mod.orcColetarItensDistribuidos(global._orcCalc.finalPrice);
    unitsColetaSemFixo[qty] = itens[0].unit;
  });
  assertCloseTo(unitsColetaSemFixo[6], unitsColetaSemFixo[1], '13. sem custo fixo no pedido: orcColetarItensDistribuidos() (PDF/WhatsApp) dá o mesmo unitário em qty=1 e qty=6 — mecanismo de redistribuição não reintroduz o bug');

  reset(3);
  _els.om_laser.value = '0'; _els.orcMontagem.value = '0'; _els.orcDesl.value = '0';
  mod.orcRecalc();
  var unitRecalc = parseReais(_els.oi_unit_1.textContent);
  var itensColeta = mod.orcColetarItensDistribuidos(global._orcCalc.finalPrice);
  assertCloseTo(itensColeta[0].unit, unitRecalc, '14. sem custo fixo: orcColetarItensDistribuidos() devolve o MESMO unitário que orcRecalc() já pintou na tela — nunca um segundo motor de cálculo divergente');

  // 14b — COM custo fixo (pedido de item único): Subtotal precisa bater
  // EXATAMENTE com o total efetivo pago (mesma garantia que test_gate4_wa_
  // pdf_display_acrilico_4mm já protege) — isso é intencional, não o bug.
  reset(2);
  mod.orcRecalc();
  var itensComFixo = mod.orcColetarItensDistribuidos(global._orcCalc.finalPrice);
  assertCloseTo(itensComFixo[0].total, global._orcCalc.finalPrice, '14b. item único: Subtotal exibido ao cliente bate exatamente com o VALOR TOTAL do pedido, mesmo com custo fixo (máquina/montagem/deslocamento) — garantia pré-existente preservada');

  // 15 — total efetivo diferente do total "de tabela" (ex.: taxa de cartão)
  // ainda preserva total = unit × qty por item, escalado uniformemente.
  reset(3);
  mod.orcRecalc();
  var baseEfetivaComTaxa = (global._orcCalc.finalPrice || 0) * 1.05; // simula +5% de taxa de cartão
  var itensComTaxa = mod.orcColetarItensDistribuidos(baseEfetivaComTaxa);
  assertCloseTo(itensComTaxa[0].total, itensComTaxa[0].unit * 3, '15. mesmo com base efetiva diferente (taxa de cartão embutida), total da linha = unitário × quantidade');

  // 16 — sem base efetiva explícita, cai no total "de tabela" (c.finalPrice) — comportamento preservado
  reset(2);
  mod.orcRecalc();
  var itensSemBase = mod.orcColetarItensDistribuidos(0);
  assertTrue(itensSemBase[0].total > 0, '16. orcColetarItensDistribuidos(0) cai no fallback c.finalPrice (comportamento pré-existente preservado, nunca zera)');
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
