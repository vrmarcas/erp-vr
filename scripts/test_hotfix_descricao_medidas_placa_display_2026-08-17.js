/**
 * test_hotfix_descricao_medidas_placa_display_2026-08-17.js
 *
 * RODADA CIRÚRGICA 2026-08-17 (2/2 desta sessão) — escopo: (1) medidas do
 * produto na descrição comercial do orçamento; (2) causa raiz da
 * divergência de preço entre Placa e Display com inputs econômicos
 * equivalentes.
 *
 * ACHADO 1 — descrição comercial: orcColetarItensDistribuidos() (fonte
 * única de PDF/WhatsApp) montava a descrição a partir de item.larg/alt —
 * campos LEGADOS que hoje nunca são populados em orçamento novo (colunas
 * removidas do <thead>, inputs oi_larg_/oi_alt_ ficam display:none e sem
 * value). As medidas reais vivem em row.dataset.planLarg/planAlt/planProf
 * (gravadas por planAplicar()/_planSincronizarComItem()). Nova função pura
 * orcItemDescricaoComercial() deriva a descrição semanticamente dessas
 * medidas reais, sem nenhum `if (produto === 'Caixa')`.
 *
 * ACHADO 2 — causa raiz Placa×Display (comprovada matematicamente antes de
 * qualquer edição): _matGetRsm2() (index.html) tem um fallback usado
 * sempre que o <select> do item ainda não tem dataset.rsm2 (não roda
 * orcMatChanged — acontece quando a receita do produto não declara
 * materialPadrao/materiaisPermitidos, ver orcAplicarMaterialReceita). Esse
 * fallback indexava cfgLoad().materiais CRU por "cfg_N", mas "cfg_N" é o
 * índice na lista FILTRADA que orcConstruirMatOpts() usa para montar o
 * <select> (remove materiais sem nome / chamados "Novo material"). Uma
 * única entrada assim no cadastro desloca o índice e o fallback lê o
 * preço de OUTRO material — e ainda ignorava m.rsm2 quando configurado à
 * mão. Não é diferença de receita, fórmula legada por tipo de produto nem
 * markup diferente: é o MESMO matKey resolvendo para DOIS preços/m²
 * diferentes dependendo de qual caminho de código populou o preço.
 *
 * Uso: node scripts/test_hotfix_descricao_medidas_placa_display_2026-08-17.js
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

var FN_NAMES = [
  'orcProdutoNomeResolvido','orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial', '_matGetRsm2', 'orcRecalc', 'orcColetarItensDistribuidos'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcItemDescricaoComercial: orcItemDescricaoComercial, _matGetRsm2: _matGetRsm2, orcRecalc: orcRecalc, orcColetarItensDistribuidos: orcColetarItensDistribuidos };'
].join('\n\n');
var modPath = path.join(__dirname, '_descricao_placa_display_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA CIRÚRGICA 2026-08-17 (2/2) — medidas na descrição + Placa×Display ===\n');

// ══════════════════════════════════════════════════════════════════════
// TESTE A — CAIXA (medidas presentes, semânticas, sem hardcode por produto)
// ══════════════════════════════════════════════════════════════════════
{
  var desc = mod.orcItemDescricaoComercial({
    prod: 'Caixa', planLarg: '20', planAlt: '20', planProf: '20',
    matResumo: 'Acrílico Cristal 4mm', det: '3 compartimentos de 7,5 × 7cm'
  });
  ok('A1. descrição contém o nome do produto', /Caixa/.test(desc));
  ok('A2. contém as 3 medidas em cm (largura/comprimento/altura)', /20cm/.test(desc) && (desc.match(/20cm/g) || []).length === 3);
  ok('A3. contém os rótulos semânticos largura/comprimento/altura', /largura/.test(desc) && /comprimento/.test(desc) && /altura/.test(desc));
  ok('A4. contém material + espessura (Acrílico Cristal 4mm)', /Acrílico Cristal 4mm/.test(desc));
  ok('A5. contém o detalhe digitado pelo vendedor (compartimentos)', /3 compartimentos de 7,5 × 7cm/.test(desc));
  console.log('       desc real: "' + desc + '"');
}

// ══════════════════════════════════════════════════════════════════════
// TESTE B — CAMPOS NÃO APLICÁVEIS (produto 2D, sem profundidade/altura)
// ══════════════════════════════════════════════════════════════════════
{
  // Placa: só largura/comprimento (planProf ausente — produto 2D)
  var descPlaca = mod.orcItemDescricaoComercial({ prod: 'Placa', planLarg: '50', planAlt: '30', planProf: '', matResumo: 'PS Cristal 3mm' });
  ok('B1. sem profundidade cadastrada — "altura" NÃO aparece', !/altura/i.test(descPlaca));
  ok('B2. sem "0cm" (dimensão zero) — não confundir com "30cm"/"50cm" reais', !/(^|\D)0cm/.test(descPlaca));
  ok('B3. sem "undefined"', !/undefined/i.test(descPlaca));
  ok('B4. sem "NaN"', !/NaN/i.test(descPlaca));
  ok('B5. sem "—" (traço de campo vazio)', !/—/.test(descPlaca));
  console.log('       desc real (2D): "' + descPlaca + '"');

  // planProf='0' explícito — mesmo resultado (0 é ausência, não dimensão real)
  var descZero = mod.orcItemDescricaoComercial({ prod: 'Placa', planLarg: '50', planAlt: '30', planProf: '0', matResumo: 'PS Cristal 3mm' });
  ok('B6. profundidade=0 explícito — também não aparece (0 não é dimensão real)', !/altura/i.test(descZero) && !/(^|\D)0cm/.test(descZero));

  // Item nunca planificado, sem larg/alt legado — só produto + material
  var descSemMedida = mod.orcItemDescricaoComercial({ prod: 'Item genérico', matResumo: 'Acrílico Cristal 3mm' });
  ok('B7. item sem nenhuma medida disponível — nunca inventa "0cm"/"undefined"', !/(^|\D)0cm/.test(descSemMedida) && !/undefined/i.test(descSemMedida) && !/NaN/i.test(descSemMedida));
  test('B8. item sem medida mostra só produto + material', descSemMedida, 'Item genérico em Acrílico Cristal 3mm');
}

// ══════════════════════════════════════════════════════════════════════
// TESTE C/G — CONSISTÊNCIA ENTRE CANAIS (PDF, WhatsApp, mesma fonte)
// ══════════════════════════════════════════════════════════════════════
{
  var pdfSrc = extractFn('orcImprimirOrcamentoPDF');
  var waSrc = extractFn('orcEnviarOrcamentoWA');
  var coletarSrc = extractFn('orcColetarItensDistribuidos');
  ok('C1. PDF usa orcColetarItensDistribuidos (fonte única)', /orcColetarItensDistribuidos\(/.test(pdfSrc));
  ok('C2. WhatsApp usa orcColetarItensDistribuidos (a MESMA fonte, não uma cópia própria)', /orcColetarItensDistribuidos\(/.test(waSrc));
  ok('C3. orcColetarItensDistribuidos usa a função canônica de descrição (não monta string solta)', /orcItemDescricaoComercial\(item\)/.test(coletarSrc));
  ok('C4. PDF não tem lógica própria de montagem de "desc" (nenhum "item.prod" solto fora da fonte única)', !/var desc\s*=\s*item\.prod/.test(pdfSrc));
  ok('C5. WhatsApp não tem lógica própria de montagem de "desc"', !/var desc\s*=\s*item\.prod/.test(waSrc));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE D — CAUSA RAIZ Placa×Display: _matGetRsm2 isolado
// ══════════════════════════════════════════════════════════════════════
{
  // Cadastro real com 2 entradas "lixo" (sem nome / "Novo material") ANTES
  // dos materiais reais — exatamente o cenário que desloca o índice.
  var materiaisComLixo = [
    { nome: '', custo: 999, comp: 100, larg: 100 },                                  // filtrado (sem nome)
    { nome: 'Novo material', custo: 999, comp: 100, larg: 100 },                     // filtrado ("Novo material")
    { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150 },   // cfg_0 pós-filtro — rsm2 EXPLÍCITO
    { nome: 'PS Cristal 3mm', custo: 90, comp: 200, larg: 100 }                      // cfg_1 pós-filtro — rsm2 calculado (90/2=45)
  ];
  global.document = { getElementById: function () { return null; } }; // sem dataset.rsm2 armazenado — força o fallback
  global.cfgLoad = function () { return { materiais: materiaisComLixo }; };

  var rsm2_cfg0 = mod._matGetRsm2('cfg_0', 1);
  var rsm2_cfg1 = mod._matGetRsm2('cfg_1', 2);
  test('D1. cfg_0 (pós-filtro) resolve para Acrílico Cristal 3mm — rsm2 EXPLÍCITO (150), não recalculado (75)', rsm2_cfg0, 150);
  test('D2. cfg_1 (pós-filtro) resolve para PS Cristal 3mm — rsm2 calculado corretamente (R$45/m²)', rsm2_cfg1, 45);
  ok('D3. índice não fica deslocado pelas entradas "lixo" — cfg_1 NUNCA é R$999 (preço do lixo na lista crua)', rsm2_cfg1 !== 999 && rsm2_cfg0 !== 999);
}

// ══════════════════════════════════════════════════════════════════════
// TESTE E — Placa × Display, receita real simulada: mesmo matKey, mesma
// área, um item com dataset.rsm2 já populado (receita com materialPadrao
// — ex. Display) e outro SEM (receita sem materialPadrao — ex. Placa,
// cai no fallback corrigido) — devem convergir para o MESMO preço.
// ══════════════════════════════════════════════════════════════════════
function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

function rodarCenarioPrecoPlacaDisplay(qtyPlaca, qtyDisplay) {
  // cfg_1 (índice pós-filtro) precisa resolver para o MESMO material que o
  // item "Display" já tem em dataset.rsm2 (150) — só assim o teste prova
  // que o fallback do "Placa" (sem dataset.rsm2) chega ao MESMO número.
  var materiaisComLixo = [
    { nome: 'Novo material', custo: 999, comp: 100, larg: 100 },                       // filtrado — raw idx0
    { nome: 'PS Cristal 3mm', custo: 200, comp: 200, larg: 100, rsm2: 90 },             // pós-filtro cfg_0
    { nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 150 }       // pós-filtro cfg_1 (alvo)
  ];
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    // Item 1 = "Placa" — select SEM dataset.rsm2 (receita sem materialPadrao — cai no fallback)
    oi_qty_1: makeEl({ value: String(qtyPlaca) }), oi_larg_1: makeEl({ value: '40' }), oi_alt_1: makeEl({ value: '30' }),
    oi_mat_1: makeEl({ value: 'cfg_1' }), // dataset.rsm2 ausente de propósito
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(), oir_1: { dataset: {} },
    // Item 2 = "Display" — select COM dataset.rsm2 já populado (receita com materialPadrao — orcMatChanged já rodou)
    oi_qty_2: makeEl({ value: String(qtyDisplay) }), oi_larg_2: makeEl({ value: '40' }), oi_alt_2: makeEl({ value: '30' }),
    oi_mat_2: makeEl({ value: 'cfg_1', dataset: { rsm2: '150' } }),
    oi_custo_2: makeEl(), oi_unit_2: makeEl(), oi_tot_2: makeEl(), oir_2: { dataset: {} }
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return [{ dataset: { idx: '1' } }, { dataset: { idx: '2' } }];
      return [];
    }
  };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global.cfgLoad = function () { return { materiais: materiaisComLixo }; };
  global.ORC_ITEM_EXTRAS = {};
  global.ORC_ITEM_AJUSTES = {};
  global._orcVitreItensPedido = [];
  global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global;
  mod.orcRecalc();
  return _els;
}

{
  var r = rodarCenarioPrecoPlacaDisplay(1, 1);
  test('E1. mesma área/mesmo matKey — CUSTO unitário de material idêntico entre Placa e Display', r.oi_custo_1.textContent, r.oi_custo_2.textContent);
  test('E2. UNIT. final idêntico — a causa raiz (índice deslocado) foi eliminada', r.oi_unit_1.textContent, r.oi_unit_2.textContent);
  test('E3. TOTAL da linha idêntico', r.oi_tot_1.textContent, r.oi_tot_2.textContent);
  ok('E4. preço não ficou em R$999 (bug antigo leria a entrada "Novo material" pelo índice deslocado)', !/999/.test(r.oi_unit_1.textContent));
}

// ══════════════════════════════════════════════════════════════════════
// TESTE F — QUANTIDADE (1 vs 10, sem duplicação de multiplicação)
// ══════════════════════════════════════════════════════════════════════
{
  var r1 = rodarCenarioPrecoPlacaDisplay(1, 1);
  var r10 = rodarCenarioPrecoPlacaDisplay(10, 10);
  var unit1 = parseBRL(r1.oi_unit_1.textContent);
  var unit10 = parseBRL(r10.oi_unit_1.textContent);
  test('F1. preço UNITÁRIO não muda com a quantidade (Placa)', Math.round(unit1 * 100), Math.round(unit10 * 100));
  var tot10 = parseBRL(r10.oi_tot_1.textContent);
  ok('F2. TOTAL com qty=10 é exatamente 10× o unitário (sem dupla multiplicação)', Math.abs(tot10 - unit10 * 10) < 0.02);
  test('F3. Placa e Display continuam idênticos também com qty=10', r10.oi_unit_1.textContent, r10.oi_unit_2.textContent);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
try { fs.unlinkSync(modPath); } catch (e) {}
if (failed > 0) process.exitCode = 1;
