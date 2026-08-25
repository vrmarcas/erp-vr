/**
 * test_hotfix_consumiveis_gravacao_preco_unificado_2026-08-17.js
 *
 * RODADA CIRÚRGICA 2026-08-17 — escopo exato: (1) regressão de Adesivo/
 * Adh. Branco; (2) renomeação Impressão→Gravação; (3) regra comercial
 * própria da Gravação (custo×2, fora do markup); (4) fonte única do
 * "preço final unitário efetivo do item" alimentando linha/resumo/PDF/
 * WhatsApp/reabertura.
 *
 * Causa raiz confirmada da regressão do Adesivo/Adh. Branco (achado real,
 * lido diretamente da produção): financeiro.adesivoPrecoCm2 e
 * financeiro.adesivoBrancoPrecoCm2 estavam gravados como 0 no Firestore
 * (erp_vr/erp_config). Como cfgSalvar() grava `parseFloat(el.value)||0`
 * para TODOS os campos de Config numa única gravação genérica, e os
 * inputs #cfgAdesivoPrecoCm2/#cfgAdesivoBrancoPrecoCm2 nunca tinham
 * `value` no HTML nem eram preenchidos com um default, qualquer
 * "💾 Salvar Alterações" em QUALQUER aba de Config persistia 0 nesses
 * dois campos — e como `typeof 0==='number'` é `true`, o fallback para
 * 0.0056/0.0011 nunca mais era usado. orcRecalc() agora exige `>0`
 * também, tratando um valor salvo <=0 como "nunca configurado" (preço/cm²
 * de adesivo nunca é legitimamente R$0).
 *
 * Estratégia de teste: mesma técnica já estabelecida neste projeto —
 * extrai orcRecalc()/orcColetarItensDistribuidos() REAIS do index.html e
 * executa contra um DOM fake (mesmo padrão de
 * test_sprint_pregolive_blocoD_integracao_orcRecalc_2026-08-09.js), nunca
 * reimplementando a fórmula. Testes estruturais (regex) complementam,
 * travando os pontos-chave do código real.
 *
 * Uso: node scripts/test_hotfix_consumiveis_gravacao_preco_unificado_2026-08-17.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
function testePerto(desc, got, expected, tolerancia) {
  tolerancia = tolerancia == null ? 0.02 : tolerancia;
  if (Math.abs(got - expected) <= tolerancia) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado ≈ ' + expected + '\n       obtido   = ' + got); failed++; }
}
function parseBRL(str) {
  return parseFloat(String(str).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
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

var FN_NAMES = ['orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial', 'orcRecalc', 'orcColetarItensDistribuidos'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  "module.exports = { orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos };"
].join('\n\n');
var modPath = path.join(__dirname, '_consumiveis_gravacao_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== RODADA CIRÚRGICA 2026-08-17 — Adesivo/Adh.Branco + Gravação + preço final único ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false }, props || {}); }

// Monta um cenário com N itens de mesma área/material — flexível o
// suficiente para os 6 testes (A-F). `overhead/vrml/impostos` controlam o
// factor de markup; `cfgLoad` (opcional) simula a Config persistida.
function rodarCenario(opts) {
  opts = opts || {};
  var itens = opts.itens || [{ idx: '1', qty: 1, larg: 100, alt: 100 }];
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: opts.descTipo || 'pct' }), orcDesc: makeEl({ value: String(opts.descVal || 0) }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: opts.adh || 'nao' }), oc_adhb: makeEl({ value: opts.adhb || 'nao' }),
    oc_imp: makeEl({ value: String(opts.imp || 0) }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: opts.acresTipo || 'pct' }), orcAcres: makeEl({ value: String(opts.acresVal || 0) }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  itens.forEach(function (it) {
    _els['oi_qty_' + it.idx] = makeEl({ value: String(it.qty) });
    _els['oi_larg_' + it.idx] = makeEl({ value: String(it.larg) });
    _els['oi_alt_' + it.idx] = makeEl({ value: String(it.alt) });
    _els['oi_mat_' + it.idx] = makeEl({ value: 'ac3', options: [{ dataset: { nome: 'Acrílico Cristal 3mm' }, text: 'Acrílico Cristal 3mm' }], selectedIndex: 0 });
    _els['oi_prod_' + it.idx] = makeEl({ value: it.prod || 'Item ' + it.idx });
    _els['oi_det_' + it.idx] = makeEl({ value: '' });
    _els['oi_custo_' + it.idx] = makeEl();
    _els['oi_unit_' + it.idx] = makeEl();
    _els['oi_tot_' + it.idx] = makeEl();
    _els['oir_' + it.idx] = { dataset: {} };
  });
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return itens.map(function (it) { return { dataset: { idx: it.idx } }; });
      return [];
    }
  };
  global._cfgData = { financeiro: Object.assign({ overhead: opts.overhead || 0, vrml: opts.vrml || 0, impostos: opts.impostos || 0 }, opts.cfgFinanceiroExtra || {}) };
  global._matGetRsm2 = function () { return opts.precoM2 == null ? 100 : opts.precoM2; };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = opts.ajuste ? { '1': opts.ajuste } : {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  if (opts.cfgLoad) global.cfgLoad = opts.cfgLoad; else delete global.cfgLoad;
  if (opts._orcAdhPrecoSnapshot !== undefined) global._orcAdhPrecoSnapshot = opts._orcAdhPrecoSnapshot; else delete global._orcAdhPrecoSnapshot;
  global.window = global;

  var mod = require(modPath);
  mod.orcRecalc();
  return { els: _els, mod: mod, itens: itens };
}

// ══════════════════════════════════════════════════════════════════════
// TESTE A — ADESIVO
// ══════════════════════════════════════════════════════════════════════
{
  // 1 item, 1m² (larg=alt=100cm), material R$100/m², overhead/vrml/impostos=0
  // (factor=1) — matCost=R$100,00 exato, fácil de auditar.
  var base = { itens: [{ idx: '1', qty: 1, larg: 100, alt: 100 }], precoM2: 100 };

  // A1 — Não → sem custo, item mostra só o material (R$100,00)
  var rNao = rodarCenario(Object.assign({}, base, { adh: 'nao' }));
  test('A1. Adesivo=Não — ocv_adh mostra R$0,00', rNao.els.ocv_adh.textContent, 'R$0,00');
  test('A1b. Adesivo=Não — item mostra só o material (R$100,00)', rNao.els.oi_tot_1.textContent, 'R$100,00');

  // A2 — achado real: reproduz o BUG DE PRODUÇÃO — financeiro.adesivoPrecoCm2=0
  // (valor real lido em erp_vr/erp_config) — deve cair no fallback 0,0056/cm²,
  // NUNCA ficar em R$0,00.
  var rBugProd = rodarCenario(Object.assign({}, base, {
    adh: 'sim',
    cfgLoad: function () { return { financeiro: { adesivoPrecoCm2: 0, adesivoBrancoPrecoCm2: 0 } }; }
  }));
  test('A2. REGRESSÃO REAL — Adesivo=Sim com config corrompida (0 gravado em produção) usa o fallback 0,0056/cm² → R$56,00 (nunca R$0,00)', rBugProd.els.ocv_adh.textContent, 'R$56,00');
  test('A2b. custo do adesivo entra no preço final do item imediatamente (R$100 material + R$56 adesivo = R$156,00)', rBugProd.els.oi_tot_1.textContent, 'R$156,00');

  // A3 — valor CUSTOM configurado (positivo, não é o bug) continua sendo honrado
  var rCustom = rodarCenario(Object.assign({}, base, {
    adh: 'sim',
    cfgLoad: function () { return { financeiro: { adesivoPrecoCm2: 0.01, adesivoBrancoPrecoCm2: 0.02 } }; }
  }));
  test('A3. preço/cm² CUSTOM configurado (0,01, positivo) é usado normalmente — R$100,00 (10000cm²×0,01)', rCustom.els.ocv_adh.textContent, 'R$100,00');

  // A4 — Sim → Não: volta a zero imediatamente, sem precisar fechar/reabrir
  var rVolta = rodarCenario(Object.assign({}, base, { adh: 'nao' })); // simula reexecução de orcRecalc() após trocar o toggle de volta
  test('A4. Sim → Não: ocv_adh volta a R$0,00', rVolta.els.ocv_adh.textContent, 'R$0,00');
  test('A4b. Sim → Não: preço final do item volta a R$100,00 (só material)', rVolta.els.oi_tot_1.textContent, 'R$100,00');
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — ADESIVO BRANCO (mesmo cenário)
// ══════════════════════════════════════════════════════════════════════
{
  var base = { itens: [{ idx: '1', qty: 1, larg: 100, alt: 100 }], precoM2: 100 };
  var rBugProd = rodarCenario(Object.assign({}, base, {
    adhb: 'sim',
    cfgLoad: function () { return { financeiro: { adesivoPrecoCm2: 0, adesivoBrancoPrecoCm2: 0 } }; }
  }));
  test('B1. REGRESSÃO REAL — Adh. Branco=Sim com config corrompida (0) usa fallback 0,0011/cm² → R$11,00 (nunca R$0,00)', rBugProd.els.ocv_adhb.textContent, 'R$11,00');
  test('B1b. entra no preço final do item (R$100 material + R$11 adh.branco = R$111,00)', rBugProd.els.oi_tot_1.textContent, 'R$111,00');
  var rNao = rodarCenario(Object.assign({}, base, { adhb: 'nao' }));
  test('B2. Sim → Não: ocv_adhb volta a R$0,00 e preço volta a R$100,00', rNao.els.ocv_adhb.textContent === 'R$0,00' && rNao.els.oi_tot_1.textContent === 'R$100,00', true);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C — GRAVAÇÃO (regra especial: custo×2, fora do markup)
// ══════════════════════════════════════════════════════════════════════
{
  // overhead=75% → factor=0.25 (escolhido de propósito: se a Gravação
  // ainda passasse pelo markup — bug antigo — o resultado seria bem
  // diferente do esperado, provando a separação).
  var base = { itens: [{ idx: '1', qty: 1, larg: 100, alt: 100 }], precoM2: 100, overhead: 75 };

  var semGravacao = rodarCenario(Object.assign({}, base, { imp: 0 }));
  var precoBase = parseBRL(semGravacao.els.oi_tot_1.textContent);
  test('C1. sem Gravação — preço base do item (material/0,25 = R$400,00)', semGravacao.els.oi_tot_1.textContent, 'R$400,00');

  var grav20 = rodarCenario(Object.assign({}, base, { imp: 20 }));
  test('C2. Gravação custo R$20 → preço = base + R$40,00 (20×2) = R$440,00', grav20.els.oi_tot_1.textContent, 'R$440,00');

  var grav30 = rodarCenario(Object.assign({}, base, { imp: 30 }));
  test('C3. Gravação custo R$30 → preço = base + R$60,00 (30×2) = R$460,00', grav30.els.oi_tot_1.textContent, 'R$460,00');

  // C4 — prova explícita de que o markup NÃO incide de novo sobre os R$40/R$60:
  // se incidisse (bug antigo: custo entrava em totalCost/factor), o resultado
  // com imp=20 seria (100+20)/0,25 = R$480,00 — bem diferente de R$440,00.
  var valorSeMarkupIncidisseDeNovo = (100 + 20) / 0.25;
  ok('C4. R$440,00 (correto) é DIFERENTE de R$480,00 (resultado se o markup incidisse de novo sobre a Gravação — bug antigo)', parseBRL(grav20.els.oi_tot_1.textContent) !== valorSeMarkupIncidisseDeNovo);

  // C5 — o preço-base ANTES do adicional de Gravação (finalPriceVR interno) é
  // idêntico em todos os cenários, provando que o custo da gravação nunca
  // entra na base do markup, qualquer que seja o valor digitado.
  ok('C5. base de markup idêntica com imp=0/20/30 (Gravação nunca entra na base do markup geral)',
    precoBase === 400 && (parseBRL(grav20.els.oi_tot_1.textContent) - 40) === precoBase && (parseBRL(grav30.els.oi_tot_1.textContent) - 60) === precoBase);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — LINHA DO ITEM = PREÇO FINAL REAL (1 unidade)
// ══════════════════════════════════════════════════════════════════════
{
  // Combina adesivo + gravação + markup (overhead=50%) — cenário completo,
  // não só material puro (achado real: linha mostrava só material).
  var r = rodarCenario({
    itens: [{ idx: '1', qty: 1, larg: 100, alt: 100 }],
    precoM2: 100, overhead: 50, adh: 'sim', imp: 10
  });
  var unit = parseBRL(r.els.oi_unit_1.textContent);
  var tot = parseBRL(r.els.oi_tot_1.textContent);
  var resumo = parseBRL(r.els.orcTotalVal.textContent);
  // RODADA DE ESTABILIZAÇÃO (2026-08-23), Bloco D — "Unit.=Total quando
  // qty=1" deixou de valer por CONSTRUÇÃO quando há Gravação/Spray/Extra
  // no item: a causa raiz do bloco é justamente que o preço UNITÁRIO
  // comercial nunca pode incluir um custo que não escala com a
  // quantidade (Gravação é "valor TOTAL da ocorrência", RODADA 6 — nunca
  // um valor por peça) — mesmo em qty=1. Total continua correto (D3,
  // abaixo, R$332,00) — só passou a ser Unit (material+adesivo, R$312,00,
  // a parte que de fato escalaria com qty) + a fatia de Gravação (R$20,00
  // = 10×2, flat) que este item sozinho absorve por inteiro.
  testePerto('D1. Total = Unitário + a fatia de Gravação/custo-fixo do pedido (nunca mais confundidos em qty=1)', tot - unit, 20, 0.02);
  testePerto('D2. TOTAL da linha bate com o Resumo lateral (mesma fonte canônica)', tot, resumo);
  ok('D3. o preço da linha agora inclui adesivo+Gravação+markup, não só material (R$332,00, não R$100,00 nem R$156,00)', Math.abs(tot - 332) < 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — 40 UNIDADES + PARIDADE COM PDF/WHATSAPP
// ══════════════════════════════════════════════════════════════════════
{
  var r = rodarCenario({
    itens: [{ idx: '1', qty: 40, larg: 10, alt: 10 }],
    precoM2: 100, adh: 'sim'
  });
  var unit = parseBRL(r.els.oi_unit_1.textContent);
  var tot = parseBRL(r.els.oi_tot_1.textContent);
  testePerto('E1. TOTAL da linha = UNIT. × 40', tot, unit * 40, 0.05);
  ok('E2. UNIT. não é mais R$0,00/vazio nem ignora extras — reflete o preço final real', unit > 0);

  // PDF e WhatsApp usam a MESMA orcColetarItensDistribuidos(); chamando com
  // window._orcCalc.finalPrice (sem condição de pagamento especial — cenário
  // padrão à vista) prova que ambos batem exatamente com a linha.
  var itensDistribuidos = r.mod.orcColetarItensDistribuidos(window._orcCalc.finalPrice);
  testePerto('E3. PDF/WhatsApp (orcColetarItensDistribuidos) devolvem o MESMO unitário da linha', itensDistribuidos[0].unit, unit, 0.02);
  testePerto('E4. PDF/WhatsApp devolvem o MESMO total da linha', itensDistribuidos[0].total, tot, 0.02);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE F — REABERTURA (determinismo do recálculo + wiring real confirmado)
// ══════════════════════════════════════════════════════════════════════
{
  var opts = {
    itens: [{ idx: '1', qty: 3, larg: 60, alt: 40 }],
    precoM2: 120, overhead: 30, adh: 'sim', adhb: 'sim', imp: 15, descVal: 5
  };
  var r1 = rodarCenario(opts);
  var snap1 = { unit: r1.els.oi_unit_1.textContent, tot: r1.els.oi_tot_1.textContent, adh: r1.els.ocv_adh.textContent, adhb: r1.els.ocv_adhb.textContent, imp: r1.els.ocv_imp.textContent };
  // "Fechar e reabrir" = restaurar os MESMOS valores salvos (oc_adh/oc_adhb/
  // oc_imp/etc., exatamente o que orcEnvEditar() faz via setV()) e rodar
  // orcRecalc() de novo — mesma função, mesmo caminho de código real.
  var r2 = rodarCenario(opts);
  var snap2 = { unit: r2.els.oi_unit_1.textContent, tot: r2.els.oi_tot_1.textContent, adh: r2.els.ocv_adh.textContent, adhb: r2.els.ocv_adhb.textContent, imp: r2.els.ocv_imp.textContent };
  test('F1. reabrir com os mesmos valores restaurados produz EXATAMENTE o mesmo preço unitário/total/consumíveis (nada muda ao reabrir)', snap2, snap1);

  // Confirma no código REAL que orcEnvEditar() restaura oc_adh/oc_adhb/oc_imp
  // e SEMPRE chama orcRecalc() depois — sem isso, o determinismo acima não
  // teria relação com o que a UI de fato faz ao reabrir.
  var envEditarSrc = extractFn('orcEnvEditar');
  ok('F2. orcEnvEditar() restaura oc_adh/oc_adhb ao reabrir', /setV\('oc_adh',\s*p\.oc_adh\)/.test(envEditarSrc) && /setV\('oc_adhb',\s*p\.oc_adhb\)/.test(envEditarSrc));
  ok('F3. orcEnvEditar() restaura oc_imp (Gravação) ao reabrir', /setV\('oc_imp',\s*p\.oc_imp\)/.test(envEditarSrc));
  ok('F4. orcEnvEditar() chama orcRecalc() (recalcula com os valores restaurados, nunca mostra número desatualizado)', /orcRecalc\(\)/.test(envEditarSrc));
}

// ══════════════════════════════════════════════════════════════════════
// TESTES ESTRUTURAIS — travam o código real das correções
// ══════════════════════════════════════════════════════════════════════
{
  var orcRecalcSrc = extractFn('orcRecalc');
  ok('G1. fallback do Adesivo exige >0 (não confunde 0 gravado por engano com "configurado")', /_cfgFinAdh\.adesivoPrecoCm2>0/.test(orcRecalcSrc));
  ok('G2. fallback do Adh. Branco exige >0', /_cfgFinAdh\.adesivoBrancoPrecoCm2>0/.test(orcRecalcSrc));
  // RODADA 6 — Gravação passou a ser peça-local (`gravacaoCusto`, com
  // `impLegado` como fallback do campo global antigo); a REGRA testada
  // aqui (venda = custo×2; base do markup nunca inclui esse custo)
  // continua idêntica, só o nome da variável de custo mudou.
  ok('G3. gravacaoAdicionalVenda = custo×2 (gravacaoCusto*2)', /gravacaoAdicionalVenda\s*=\s*gravacaoCusto\*2/.test(orcRecalcSrc));
  {
    var _mTcpm = /const totalCostParaMarkup = ([^;]*);/.exec(orcRecalcSrc);
    var _tcpmFormula = _mTcpm ? _mTcpm[1] : '';
    ok('G4. base do markup exclui o custo da Gravação (fórmula de totalCostParaMarkup nunca cita gravacaoCusto)', _tcpmFormula==='matTotal + extras + itemExtrasTotal');
  }
  ok('G5. finalPrice usa totalCostParaMarkup (não totalCost) na fórmula de markup', /totalCostParaMarkup\/factor/.test(orcRecalcSrc));
  ok('G6. Gravação é somada ao preço final DEPOIS do markup/desconto/acréscimo/Vitre', /finalPrice\s*=\s*finalPriceVR\s*\+\s*vitreItensPedidoTotal\s*\+\s*gravacaoAdicionalVenda/.test(orcRecalcSrc));
  // RODADA CIRÚRGICA 2026-08-17 (3/3) — _totalVRParaRepartir passou a usar
  // finalPriceVR_semItemExtras (não finalPriceVR puro) para isolar extras
  // por item (ver test_hotfix_espessura_extras_2026-08-17.js) — a
  // asserção original checava o texto exato da fórmula antiga; o que
  // importa (PASS 3 escreve oi_unit_/oi_tot_ com o preço final
  // redistribuído a partir de finalPriceVR) continua verdadeiro.
  //
  // RODADA DE ESTABILIZAÇÃO (2026-08-23), Bloco D — _totalVRParaRepartir
  // foi substituído por finalPriceVR_soMaterial/_fatorPoolMaterial (isola
  // o preço UNITÁRIO comercial de custos fixos do pedido — máquinas/
  // montagem/deslocamento — que antes eram diluídos por item.qty, bug real
  // de produção). Extras "➕ deste Item" continuam somados no TOTAL da
  // linha (nunca no unitário) via itemExtrasProprio, exatamente como
  // antes — a asserção abaixo troca só o nome da variável do achado desta
  // rodada, a garantia comportamental (oi_unit_/oi_tot_ escritos a partir
  // de um preço final único, nunca duas fórmulas) continua a mesma.
  ok('G7. PASS 3 escreve oi_unit_/oi_tot_ com o preço final redistribuído (fonte canônica única, agora com extras isolados por item)', /finalPriceVR_qtySafe\s*=\s*_calcularFinalPriceVR\(matTotal\s*\+\s*consTotal\)/.test(orcRecalcSrc) && /eu=document\.getElementById\('oi_unit_'\+item\.idx\)/.test(orcRecalcSrc) && /itemExtrasProprio/.test(orcRecalcSrc));

  var cfgRenderSrc = extractFn('cfgRenderTables');
  ok('G8. cfgRenderTables() nunca deixa os campos de preço do adesivo em branco/0 (evita reintroduzir o bug ao salvar Config de novo)', /cfgAdesivoPrecoCm2/.test(cfgRenderSrc) && /parseFloat\(elAdhCm2\.value\)>0/.test(cfgRenderSrc));

  ok('G9. label "Gravação" presente no popup de custos (renomeado de "Impressão")', /🖨️ Gravação/.test(html));
  ok('G10. rótulo "Impressão" (ligado ao consumível) não existe mais no HTML/JS do popup de custos', !/\['🖨️','Impressão'/.test(html) && !html.includes(">🖨️ Impressão Digital<"));
  ok('G11. CONSUMIVEIS_PADRAO usa label "Gravação"', /chave:\s*'imp',\s*label:\s*'Gravação'/.test(html));

  ok('G12. cliente nunca vê o breakdown/regra da Gravação — PDF/WhatsApp continuam usando orcColetarItensDistribuidos (preço final consolidado, sem custo/×2/margem expostos)', (function(){
    var pdfSrc = extractFn('orcImprimirOrcamentoPDF');
    var waSrc = extractFn('orcEnviarOrcamentoWA');
    return !/gravacaoAdicionalVenda|gravacaoCusto/.test(pdfSrc) && !/gravacaoAdicionalVenda|gravacaoCusto/.test(waSrc);
  })());
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
