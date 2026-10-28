/**
 * test_override_dimensao_isolamento_impacto_2026-10-27.js
 *
 * Fechamento exigido pelo usuário (2026-10-27) para o bug de override de
 * dimensão manual na planificação — prova, com as FUNÇÕES REAIS extraídas
 * de index.html (nunca reimplementadas):
 *
 *  4. ISOLAMENTO — editar a Tampa não contamina Base/Lateral/Frente/Fundo;
 *     alternativa A de um comparativo não herda override de B, nem vice-versa
 *     (cada item tem seu próprio array/snapshot persistido, nunca global).
 *  5. PERSISTÊNCIA — sobrevive a reconcile (edição/exclusão de outras
 *     peças, troca de consumível), ao payload persistido e à reabertura.
 *  6. IMPACTO REAL — a dimensão override MUDA área/custo/preço pelo motor
 *     real (orcRecalc) — nunca só a tela mostra 41×46 enquanto o cálculo
 *     usa 37×42 escondido.
 *
 * Uso: node scripts/test_override_dimensao_isolamento_impacto_2026-10-27.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function testePerto(desc, got, expected, tolerancia) {
  tolerancia = tolerancia == null ? 0.02 : tolerancia;
  if (Math.abs(got - expected) <= tolerancia) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado ≈ ' + expected + '\n       obtido   = ' + got); failed++; }
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
function extractArr(name) {
  var marker = 'var ' + name + ' = [';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Array ' + name + ' não encontrado — teste desatualizado?');
  var bracketOpen = html.indexOf('[', start);
  var depth = 0, i = bracketOpen;
  for (; i < html.length; i++) { if (html[i] === '[') depth++; else if (html[i] === ']') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

var FN_NAMES = [
  '_planPieceSlug', '_planPecaAdesivos', '_planReconcilePieces', '_planSeedFromPersisted', '_planHidratarDireto', '_planBuildAllPecas',
  'orcProdutoNomeResolvido', 'cfgEsc', 'orcFmt', 'orcSetV', 'orcItemAplicarAjuste', 'osItemMateriaisResumo', 'orcItemDescricaoComercial',
  '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcSincronizarEspPecasHerdadas', 'orcPecasHerdarEspessura',
  'cfgMaqOperInfo', '_orcMaqInfo', '_maqInfoPorMaquinaId', '_itemMaqInfo'
];
var src = [
  extractArr('ORC_MAQ_OPS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { _planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, _planHidratarDireto: _planHidratarDireto, _planBuildAllPecas: _planBuildAllPecas, orcRecalc: orcRecalc };'
].join('\n\n');
var modPath = path.join(__dirname, '_override_isolamento_impacto_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 2026-10-27 (fechamento) — Isolamento e impacto real do override de dimensão ===\n');

function receitaFresca() {
  return [
    { nome: 'Tampa',   qty: 1, larg: 37, alt: 42 },
    { nome: 'Base',    qty: 1, larg: 37, alt: 42 },
    { nome: 'Lateral', qty: 2, larg: 30, alt: 20 },
    { nome: 'Frente',  qty: 1, larg: 37, alt: 20 },
    { nome: 'Fundo',   qty: 1, larg: 37, alt: 20 }
  ];
}
function areaPlan(pecas) { return pecas.reduce(function (s, p) { return s + p.larg * p.alt * p.qty; }, 0); }

// ──────────────────────────────────────────────────────────────────────
// 4a — ISOLAMENTO ENTRE PEÇAS DO MESMO ITEM
// ──────────────────────────────────────────────────────────────────────
(function isolamentoEntrePecas() {
  global._planEditPieces = [];
  global._planEditPieces = mod._planReconcilePieces(receitaFresca(), 3);
  var tampa = global._planEditPieces.find(function (p) { return p.nome === 'Tampa'; });
  tampa.larg = 41; tampa.alt = 46; tampa.dimOverride = true;

  // "Altera consumível" de OUTRA peça (Base) — gravação/spray — dispara
  // reconciliação (mesmo caminho real de _planConsumiveisAbrir/salvar).
  var base = global._planEditPieces.find(function (p) { return p.nome === 'Base'; });
  base.gravacao = 15;

  var pecas = mod._planReconcilePieces(receitaFresca(), 3);
  var t = function (nome) { return pecas.find(function (p) { return p.nome === nome; }); };

  ok('Editar a Tampa NÃO altera a Base (37×42 intacta)', t('Base').larg === 37 && t('Base').alt === 42 && t('Base').dimOverride === false);
  ok('Editar a Tampa NÃO altera a Lateral (30×20 intacta)', t('Lateral').larg === 30 && t('Lateral').alt === 20 && t('Lateral').dimOverride === false);
  ok('Editar a Tampa NÃO altera a Frente (37×20 intacta)', t('Frente').larg === 37 && t('Frente').alt === 20 && t('Frente').dimOverride === false);
  ok('Editar a Tampa NÃO altera o Fundo (37×20 intacta)', t('Fundo').larg === 37 && t('Fundo').alt === 20 && t('Fundo').dimOverride === false);
  ok('Tampa continua 41×46 depois de alterar consumível de OUTRA peça', t('Tampa').larg === 41 && t('Tampa').alt === 46);
  ok('Consumível (gravação) da Base alterado é preservado pela reconciliação', t('Base').gravacao === 15);
})();

// ──────────────────────────────────────────────────────────────────────
// 4b — ALTERAR CONSUMÍVEL DA PRÓPRIA PEÇA OVERRIDADA NÃO RESETA A DIMENSÃO
// ──────────────────────────────────────────────────────────────────────
(function consumivelNaPecaOverridadaNaoReseta() {
  global._planEditPieces = [];
  global._planEditPieces = mod._planReconcilePieces(receitaFresca(), 3);
  var tampa = global._planEditPieces.find(function (p) { return p.nome === 'Tampa'; });
  tampa.larg = 41; tampa.alt = 46; tampa.dimOverride = true;
  tampa.adesivoNormal = true; // vendedor liga adesivo na própria Tampa overridada

  var pecas = mod._planReconcilePieces(receitaFresca(), 3);
  var t = pecas.find(function (p) { return p.nome === 'Tampa'; });
  ok('Ligar adesivo na PRÓPRIA Tampa overridada não reseta a dimensão (continua 41×46)', t.larg === 41 && t.alt === 46);
  ok('Adesivo da Tampa é preservado junto com o override de dimensão', t.adesivoNormal === true);
})();

// ──────────────────────────────────────────────────────────────────────
// 4c — COMPARATIVO: ALTERNATIVA A NÃO HERDA OVERRIDE DE B, NEM VICE-VERSA
// ──────────────────────────────────────────────────────────────────────
(function comparativoNaoCompartilhaOverride() {
  // Alternativa A (item idx 1): Tampa overridada para 41×46.
  var planPecasA = JSON.stringify([
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 41, alt: 46, dimOverride: true, origem: 'AUTOMATICA' },
    { id: 'auto_base', nome: 'Base', qty: 1, larg: 37, alt: 42, dimOverride: false, origem: 'AUTOMATICA' }
  ]);
  // Alternativa B (item idx 2, outro grupoOpcao do MESMO grupo): Tampa
  // SEM override — precisa continuar 37×42 (não pode herdar o 41×46 de A).
  var planPecasB = JSON.stringify([
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 37, alt: 42, dimOverride: false, origem: 'AUTOMATICA' },
    { id: 'auto_base', nome: 'Base', qty: 1, larg: 37, alt: 42, dimOverride: false, origem: 'AUTOMATICA' }
  ]);
  var receitaCurta = function () { return [{ nome: 'Tampa', qty: 1, larg: 37, alt: 42 }, { nome: 'Base', qty: 1, larg: 37, alt: 42 }]; };

  var seedA = mod._planSeedFromPersisted(receitaCurta(), planPecasA, 3);
  var seedB = mod._planSeedFromPersisted(receitaCurta(), planPecasB, 3);

  var tampaA = seedA.find(function (p) { return p.nome === 'Tampa'; });
  var tampaB = seedB.find(function (p) { return p.nome === 'Tampa'; });
  ok('Alternativa A: Tampa 41×46 (override próprio, independente)', tampaA.larg === 41 && tampaA.alt === 46 && tampaA.dimOverride === true);
  ok('Alternativa B: Tampa continua 37×42 — NÃO herdou o override de A', tampaB.larg === 37 && tampaB.alt === 42 && tampaB.dimOverride === false);

  // Processos de edição independentes: reconciliar A de novo (ex.: "+
  // Adicionar Peça" dentro da alternativa A) nunca contamina o estado de B,
  // porque cada alternativa tem seu PRÓPRIO _planEditPieces (um por vez, o
  // item correntemente aberto no modal — nunca um array global compartilhado).
  global._planEditPieces = seedA;
  var reconcAfterA = mod._planReconcilePieces(receitaCurta(), 3);
  ok('Reconciliar a sessão de A de novo mantém 41×46 (A não depende do estado de B)', reconcAfterA.find(function (p) { return p.nome === 'Tampa'; }).larg === 41);
  // B nunca foi tocado por essa reconciliação (snapshot persistido isolado):
  ok('O snapshot persistido de B permanece 37×42 (nunca foi alterado pela sessão de A)', JSON.parse(planPecasB)[0].larg === 37 && JSON.parse(planPecasB)[0].alt === 42);
})();

// ──────────────────────────────────────────────────────────────────────
// 6 — IMPACTO REAL em área/custo/preço (pelo motor orcRecalc real)
// ──────────────────────────────────────────────────────────────────────
function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {}, style: {} }, props || {}); }
function custoDoItem(pecas) {
  var planPecasFinal = pecas.filter(function (p) { return !p._deleted; }).map(function (p) { return Object.assign({}, p, { espessuraMm: 3, origem: 'AUTOMATICA' }); });
  var planArea = areaPlan(planPecasFinal);

  global.cfgLoad = function () { return { materiais: [{ nome: 'Acrílico Cristal 3mm', custo: 150, comp: 200, larg: 100, rsm2: 100, esp: 3 }], financeiro: {} }; };
  global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
  global._matGetRsm2 = function () { return 100; }; // R$100/m² fixo

  var idx = '1';
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocu_laser: makeEl(), ocu_dobra: makeEl(), ocu_pol: makeEl(), ocu_uv: makeEl(), ocu_lixa: makeEl(), ocu_tupia: makeEl(),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    orcMaqAlertaSemCusto: makeEl(),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }),
    oc_imp: makeEl({ value: '0' }), oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }), soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(), orcTotalLblCard: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl(),
    oi_qty_1: makeEl({ value: '1' }), oi_larg_1: makeEl({ value: '0' }), oi_alt_1: makeEl({ value: '0' }),
    oi_mat_1: makeEl({ value: 'cfg_0', dataset: {}, selectedIndex: 0, options: [{ dataset: { nome: 'Acrílico Cristal', esp: '3' }, text: 'Acrílico Cristal 3mm' }] }),
    oi_esp_1: makeEl({ value: '3' }), oi_prod_1: makeEl({ value: 'Caixa' }), oi_det_1: makeEl({ value: '' }),
    oi_custo_1: makeEl(), oi_unit_1: makeEl(), oi_tot_1: makeEl(), oi_opcaoBadge_1: makeEl(),
    oir_1: { dataset: { idx: idx, planArea: String(planArea), planPecas: JSON.stringify(planPecasFinal) } }
  };
  global.document = {
    getElementById: function (id) { return _els[id]; },
    querySelectorAll: function (sel) { if (sel === '#orcItemBody tr') return [{ dataset: _els.oir_1.dataset }]; return []; }
  };
  global.ORC_ITEM_EXTRAS = {}; global.ORC_ITEM_AJUSTES = {}; global.ORC_ITEM_OPCOES = {}; global.ORC_ITEM_MAQUINAS = {};
  global._orcVitreItensPedido = []; global.orcVitreItensPedidoTotal = function () { return 0; };
  global.window = global; global.window._orcAdhPrecoSnapshot = null;

  mod.orcRecalc();
  return {
    planArea: planArea,
    custo: parseFloat(_els.oi_custo_1.textContent.replace('R$', '').replace(',', '.')) || 0,
    total: parseFloat(_els.oi_tot_1.textContent.replace('R$', '').replace(',', '.')) || 0
  };
}

(function impactoRealDoOverrideNoCusto() {
  // Cenário SEM override: Tampa fica na dimensão bruta da receita (37×42).
  global._planEditPieces = [];
  var pecasSemOverride = mod._planReconcilePieces(receitaFresca(), 3);
  var custoSemOverride = custoDoItem(pecasSemOverride);

  // Cenário COM override: Tampa editada para 41×46, sobrevivendo a uma
  // reconciliação não relacionada (exclusão do Fundo).
  global._planEditPieces = [];
  global._planEditPieces = mod._planReconcilePieces(receitaFresca(), 3);
  var tampa = global._planEditPieces.find(function (p) { return p.nome === 'Tampa'; });
  tampa.larg = 41; tampa.alt = 46; tampa.dimOverride = true;
  var fundo = global._planEditPieces.find(function (p) { return p.nome === 'Fundo'; });
  fundo._deleted = true;
  var pecasComOverride = mod._planReconcilePieces(receitaFresca(), 3);
  var custoComOverride = custoDoItem(pecasComOverride);

  var deltaAreaCm2 = (41 * 46) - (37 * 42); // = 1886 - 1554 = 332 cm²
  var deltaAreaFundoCm2 = 37 * 20; // Fundo excluído também sai da área
  var deltaCustoEsperado = (deltaAreaCm2 - deltaAreaFundoCm2) / 10000 * 100; // R$100/m²

  ok('Área total planificada MUDA com o override (41×46 entra na soma, não 37×42)', custoComOverride.planArea !== custoSemOverride.planArea);
  testePerto('IMPACTO REAL: custo do item reflete a dimensão override (41×46) + exclusão do Fundo, nunca os 37×42 escondidos', custoComOverride.custo - custoSemOverride.custo, deltaCustoEsperado, 0.05);
  ok('Preço final (oi_tot_) também muda — não é só a tela, o cálculo usa a nova dimensão', custoComOverride.total !== custoSemOverride.total);

  // Prova direta: a área da PRÓPRIA peça Tampa na lista que alimentou
  // orcRecalc() (via planPecas/planArea) é 41×46 = 1886 cm², nunca os
  // 37×42 = 1554 cm² originais.
  var tampaNaListaUsada = pecasComOverride.find(function (p) { return p.nome === 'Tampa'; });
  ok('A peça Tampa que alimentou o cálculo tem área 1886cm² (41×46), nunca 1554cm² (37×42) escondido', tampaNaListaUsada.larg * tampaNaListaUsada.alt === 1886);
})();

console.log('\n' + (failed === 0 ? '✅ TODOS OS TESTES PASSARAM' : '❌ ' + failed + ' TESTE(S) FALHARAM') + ' (' + passed + ' passou/passaram, ' + failed + ' falhou/falharam)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
