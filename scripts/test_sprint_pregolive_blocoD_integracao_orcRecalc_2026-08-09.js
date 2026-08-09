/**
 * test_sprint_pregolive_blocoD_integracao_orcRecalc_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco D (parte 2/2) — integração do ajuste
 * comercial por item (orcItemAplicarAjuste, ver
 * test_sprint_pregolive_blocoD_ajuste_item_2026-08-09.js) dentro do
 * agregador real orcRecalc(), com um DOM fake completo (execução real,
 * não só regex).
 *
 * Prova a ORDEM CANÔNICA exigida explicitamente pelo usuário: preço
 * original do item → AJUSTE DO ITEM → soma dos itens → AJUSTE GLOBAL →
 * ... — ou seja, o ajuste do item precisa entrar ANTES do desconto/
 * acréscimo GLOBAL do orçamento, nunca depois.
 *
 * Cenário controlado: 1 item, 1m² de área, material a R$100/m² (stub),
 * overhead/vrml/impostos = 0% (factor = 1) — assim a "venda original da
 * linha" fecha exatamente em R$100,00, batendo com os 4 cenários que o
 * usuário pediu explicitamente (R$100 → +R$10/+10%/-R$10/-10%).
 *
 * Uso: node scripts/test_sprint_pregolive_blocoD_integracao_orcRecalc_2026-08-09.js
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

var FN_NAMES = ['orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'orcRecalc'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = { orcRecalc: orcRecalc };"
].join('\n\n');
var modPath = path.join(__dirname, '_blocoD_orcrecalc_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco D (2/2) — ajuste por item integrado a orcRecalc() ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false }, props || {}); }

function rodarCenario(opts) {
  opts = opts || {};
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: opts.descTipo || 'pct' }), orcDesc: makeEl({ value: String(opts.descVal || 0) }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl({ value: '100' }), oi_alt_1: makeEl({ value: '100' }),
    oi_mat_1: makeEl({ value: 'ac3' }),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(),
    oir_1: { dataset: {} },
    orcAcresTipo: makeEl({ value: opts.acresTipo || 'pct' }), orcAcres: makeEl({ value: String(opts.acresVal || 0) }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return [{ dataset: { idx: '1' } }];
      return [];
    }
  };
  // overhead/vrml/impostos=0 direto no _cfgData (o fallback para o DOM em
  // orcRecalc() usa `parseFloat(...)||41.16` — 0 é falsy em JS, então
  // setar '0' no campo do DOM cairia no default 41,16%; só zera de
  // verdade fornecendo os 3 campos aqui, que orcRecalc() lê primeiro).
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; }; // material a R$100/m² (stub controlado)
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = opts.ajuste ? { 1: opts.ajuste } : {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;

  var mod = require(modPath);
  mod.orcRecalc();
  return { els: _els, oirDataset: _els.oir_1.dataset };
}

// ── 1-4. Cenários exatos pedidos pelo usuário: R$100,00 base ──
{
  var r1 = rodarCenario({ ajuste: { operacao: 'acrescimo', tipo: 'fixo', valor: 10 } });
  test('1. item base R$100,00 + R$10 (acréscimo fixo) → linha mostra R$110,00', r1.els.oi_tot_1.textContent, 'R$110,00');
  test('1b. total do orçamento também reflete R$110,00', r1.els.orcTotalVal.textContent, 'R$ 110,00');
}
{
  var r2 = rodarCenario({ ajuste: { operacao: 'acrescimo', tipo: 'percentual', valor: 10 } });
  test('2. item base R$100,00 + 10% (acréscimo percentual) → linha mostra R$110,00', r2.els.oi_tot_1.textContent, 'R$110,00');
}
{
  var r3 = rodarCenario({ ajuste: { operacao: 'desconto', tipo: 'fixo', valor: 10 } });
  test('3. item base R$100,00 - R$10 (desconto fixo) → linha mostra R$90,00', r3.els.oi_tot_1.textContent, 'R$90,00');
}
{
  var r4 = rodarCenario({ ajuste: { operacao: 'desconto', tipo: 'percentual', valor: 10 } });
  test('4. item base R$100,00 - 10% (desconto percentual) → linha mostra R$90,00', r4.els.oi_tot_1.textContent, 'R$90,00');
}

// ── 5. Regressão: sem nenhum ajuste, comportamento idêntico ao de antes do Bloco D ──
{
  var r5 = rodarCenario({});
  test('5. regressão — sem ajuste, item continua em R$100,00 (comportamento anterior ao Bloco D preservado)', r5.els.oi_tot_1.textContent, 'R$100,00');
}

// ── 6-7. ORDEM CANÔNICA exigida pelo usuário: ajuste do item ANTES do ajuste global ──
{
  // item +R$10 (→R$110) seguido de desconto GLOBAL de 10% sobre o total já ajustado → R$99,00.
  // Se a ordem estivesse errada (global primeiro), seria R$100*0.9+10=R$100,00 — valor diferente,
  // prova que a implementação segue a ordem certa.
  var r6 = rodarCenario({ ajuste: { operacao: 'acrescimo', tipo: 'fixo', valor: 10 }, descTipo: 'pct', descVal: 10 });
  test('6. achado real — ordem canônica: item ajustado para R$110,00, DEPOIS desconto global de 10% → R$99,00 (nunca R$100,00, que seria a ordem errada)',
    r6.els.orcTotalVal.textContent, 'R$ 99,00');
}
{
  // item -R$10 (→R$90) seguido de acréscimo GLOBAL de 10% → R$99,00.
  var r7 = rodarCenario({ ajuste: { operacao: 'desconto', tipo: 'fixo', valor: 10 }, acresTipo: 'pct', acresVal: 10 });
  test('7. ordem canônica também correta com desconto de item + acréscimo global: R$90,00 × 1,10 = R$99,00',
    r7.els.orcTotalVal.textContent, 'R$ 99,00');
}

// ── 8. Interno: nunca aparece como linha separada — só o preço final da linha muda ──
{
  var r8 = rodarCenario({ ajuste: { operacao: 'acrescimo', tipo: 'fixo', valor: 10 } });
  test('8. o ajuste nunca aparece como texto separado nas células da linha — só o valor final (oi_unit_/oi_tot_) muda',
    /ajuste/i.test(r8.els.oi_tot_1.textContent) || /ajuste/i.test(r8.els.oi_unit_1.textContent), false);
}

// ── 9. precoOriginalItemCents fica disponível no dataset da linha (para o preview do modal) ──
{
  var r9 = rodarCenario({ ajuste: { operacao: 'acrescimo', tipo: 'fixo', valor: 10 } });
  test('9. row.dataset.precoOriginalItemCents é gravado (10000 = R$100,00) — usado pelo modal para o preview antes/depois',
    r9.oirDataset.precoOriginalItemCents, 10000);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
