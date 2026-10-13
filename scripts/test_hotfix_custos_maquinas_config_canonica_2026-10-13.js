/**
 * test_hotfix_custos_maquinas_config_canonica_2026-10-13.js
 *
 * RODADA CIRÚRGICA 2026-10-13, BLOCO C — "Config. Orçamento → Máquinas"
 * vira a ÚNICA fonte real de custo de máquina do motor de orçamento.
 *
 * Achado de produção (investigação read-only ANTES de qualquer edição):
 * orcRecalc() e orcExtrasCalcMaq() tinham, cada uma, sua PRÓPRIA cópia
 * hardcoded das mesmas 6 taxas (R$0,10/min Laser, R$0,01/min Dobra,
 * R$0,02/min Politriz, R$0,002/min UV, R$0,005/min Lixadeira, R$0,01/min
 * Tupia) — a tela Config→Máquinas (custo/setup por máquina cadastrada)
 * nunca era lida por nenhuma das duas. Não havia NENHUM vínculo (por nome
 * ou id) entre as 6 operações do motor e as máquinas cadastradas — e o
 * usuário tem hoje 4 máquinas "Laser" distintas (Vermelha/Verde/Metal/
 * Fiber) sem forma de dizer qual delas precifica o campo único de Laser
 * do orçamento.
 *
 * Decisão explícita do usuário (2026-10-13, ver AskUserQuestion desta
 * sessão): ZERO fallback hardcoded "legado" — operação sem máquina
 * vinculada E precificada (custo/hora>0, unidade='hora') custa R$0,00,
 * sempre com um motivo explícito para a UI poder alertar (nunca esconder
 * a ambiguidade/lacuna). Setup é cobrado 1x por operação em uso (nunca
 * multiplicado pelos minutos). Mudar Config reflete em orçamentos NOVOS
 * imediatamente; orçamentos antigos reabertos usam o snapshot congelado no
 * momento do save (mesmo princípio de window._orcAdhPrecoSnapshot).
 *
 * Gates MACH-01 a 08 do pedido.
 *
 * Uso: node scripts/test_hotfix_custos_maquinas_config_canonica_2026-10-13.js
 */
'use strict';
require(require('path').join(__dirname, '_comparativo_shim.js'));
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }
function eq(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
function perto(desc, got, expected, tol) {
  tol = tol == null ? 0.0001 : tol;
  if (Math.abs(got - expected) <= tol) { console.log('  ✅  ' + desc); passed++; }
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
function extractVarDecl(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var depth = 0, i = start + marker.length, end = -1;
  for (; i < html.length; i++) {
    var c = html[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error('Fim de ' + name + ' não encontrado');
  return html.slice(start, end + 1);
}

var FN_NAMES = [
  'cfgMaqOperInfo', '_orcMaqInfo', '_cfgNewMaquinaId', '_cfgBackfillMaquinaIds',
  'orcFmt', 'orcSetV', 'orcGetItemExtrasTotal', 'orcRecalc', 'orcVitreItensPedidoTotal'
];
var src = [
  extractVarDecl('ORC_MAQ_OPS'),
  'var _cfgData = null;',
  'function cfgLoad(){ return _cfgData; }',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  setCfg: function(c){ _cfgData = c; },',
  '  cfgMaqOperInfo: cfgMaqOperInfo, _orcMaqInfo: _orcMaqInfo,',
  '  newMaquinaId: _cfgNewMaquinaId, backfillMaquinaIds: _cfgBackfillMaquinaIds,',
  '  orcRecalc: orcRecalc,',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_hotfix_custos_maquinas_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== HOTFIX 2026-10-13 (Bloco C) — Config→Máquinas como fonte canônica de custo ===\n');

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, dataset: {} }, props || {}); }

// Harness mínimo de orcRecalc: ZERO itens no pedido (document.querySelectorAll
// de '#orcItemBody tr' retorna []) — isola totalmente a parte MÁQUINAS do
// resto do motor (material/consumíveis/vitre ficam em 0, sem interferir).
function montarHarnessOrcamento(cfg) {
  var _els = {
    cfgOverhead: makeEl({ value: '0' }), cfgVrml: makeEl({ value: '0' }), cfgImpostos: makeEl({ value: '0' }),
    orcOverheadInfo: makeEl(), orcVrmlInfo: makeEl(),
    orcDescTipo: makeEl({ value: 'pct' }), orcDesc: makeEl({ value: '0' }),
    om_laser: makeEl({ value: '0' }), om_dobra: makeEl({ value: '0' }), om_pol: makeEl({ value: '0' }),
    om_uv: makeEl({ value: '0' }), om_lixa: makeEl({ value: '0' }), om_tupia: makeEl({ value: '0' }),
    ocv_laser: makeEl(), ocv_dobra: makeEl(), ocv_pol: makeEl(), ocv_uv: makeEl(), ocv_lixa: makeEl(), ocv_tupia: makeEl(),
    ocu_laser: makeEl(), ocu_dobra: makeEl(), ocu_pol: makeEl(), ocu_uv: makeEl(), ocu_lixa: makeEl(), ocu_tupia: makeEl(),
    orcMaqAlertaSemCusto: makeEl({ style: {} }),
    oc_adh: makeEl({ value: 'nao' }), oc_adhb: makeEl({ value: 'nao' }), oc_imp: makeEl({ value: '0' }),
    oc_spray: makeEl({ value: '0' }), oc_extra: makeEl({ value: '0' }),
    ocv_adh: makeEl(), ocv_adhb: makeEl(), ocv_imp: makeEl(), ocv_spray: makeEl(), ocv_extra: makeEl(),
    orcMontagem: makeEl({ value: '0' }), orcDesl: makeEl({ value: '0' }),
    orcAcresTipo: makeEl({ value: 'pct' }), orcAcres: makeEl({ value: '0' }),
    orcSoCorte: makeEl({ checked: false }), orcSoCorteMin: makeEl({ value: '30' }),
    soCorteValor: makeEl(),
    orcTotalVal: makeEl(), orcUnitLbl: makeEl(), orcBreak: makeEl(),
    orcTotalVal3: makeEl(), orcUnitLbl3: makeEl(), orcBreak3: makeEl()
  };
  global.document = { getElementById: function (id) { return _els[id]; }, querySelectorAll: function () { return []; } };
  global.window = global;
  global._orcVitreItensPedido = [];
  global.ORC_ITEM_EXTRAS = {};
  mod.setCfg(cfg);
  return _els;
}

function cfgBase(maquinas, maquinasOperacoes) {
  return { financeiro: { overhead: 0, vrml: 0, impostos: 0 }, materiais: [], maquinas: maquinas || [], maquinasOperacoes: maquinasOperacoes || { laser: null, dobra: null, pol: null, uv: null, lixa: null, tupia: null } };
}

// ══════════════════════════════════════════════════════════════════════
// MACH-01 — operação usada (minutos>0) SEM nenhuma máquina vinculada:
// custo R$0,00, nunca um fallback oculto, alerta visível e nomeando a
// operação.
// ══════════════════════════════════════════════════════════════════════
{
  var els = montarHarnessOrcamento(cfgBase([]));
  els.om_laser.value = '10';
  window._orcMaqInfoSnapshot = null;
  mod.orcRecalc();
  perto('MACH-01.1: Laser sem máquina vinculada custa R$0,00 (zero fallback oculto)', window._orcCalc.maqTotal, 0, 0.0001);
  ok('MACH-01.2: alerta pré-envio fica visível', els.orcMaqAlertaSemCusto.style.display === 'block');
  ok('MACH-01.3: alerta nomeia a operação Laser', els.orcMaqAlertaSemCusto.textContent.indexOf('Laser') >= 0);
  ok('MACH-01.4: rótulo da taxa mostra o aviso, nunca um número inventado', els.ocu_laser.textContent.indexOf('⚠️') === 0);
}

// ══════════════════════════════════════════════════════════════════════
// MACH-02 — máquina vinculada, unidade='hora', custo/setup configurados:
// custo/min = custo/hora ÷ 60 (regra de conversão exigida); setup cobrado
// EXATAMENTE 1x (não multiplicado pelos minutos).
// ══════════════════════════════════════════════════════════════════════
{
  var maquinas = [{ id: 'maqLaserVermelha', nome: 'Laser Vermelha', unidade: 'hora', custo: 120, setup: 15 }];
  var ops = { laser: 'maqLaserVermelha', dobra: null, pol: null, uv: null, lixa: null, tupia: null };
  var els = montarHarnessOrcamento(cfgBase(maquinas, ops));
  els.om_laser.value = '30'; // 30 minutos
  window._orcMaqInfoSnapshot = null;
  mod.orcRecalc();
  // custo/min = 120/60 = 2,00 → 30min × 2,00 = 60,00 + setup 15,00 = 75,00 (1x, não ×30)
  perto('MACH-02.1: custo/min derivado = custo/hora ÷ 60 (R$120/h → R$2,00/min)', window._orcCalc.maqTotal, 60 + 15, 0.0001);
  ok('MACH-02.2: rótulo mostra a taxa real derivada (R$2,0000/min)', els.ocu_laser.textContent.indexOf('2,0000') >= 0);
  els.om_laser.value = '60'; // dobrar os minutos
  mod.orcRecalc();
  // setup continua 1x (15,00), só o componente por minuto dobra (120,00) = 135,00
  perto('MACH-02.3: setup cobrado 1x mesmo dobrando os minutos (nunca ×minutos)', window._orcCalc.maqTotal, 120 + 15, 0.0001);
  ok('MACH-02.4: nenhum alerta de falta de custo quando a máquina está corretamente configurada', els.orcMaqAlertaSemCusto.style.display !== 'block');
}

// ══════════════════════════════════════════════════════════════════════
// MACH-03 — máquina vinculada mas com unidade incompatível (m²/un): não
// inventa conversão nenhuma — custo R$0,00 e motivo explícito.
// ══════════════════════════════════════════════════════════════════════
{
  var maquinas = [{ id: 'maqDobraM2', nome: 'Dobra por m²', unidade: 'm²', custo: 50, setup: 0 }];
  var ops = { laser: null, dobra: 'maqDobraM2', pol: null, uv: null, lixa: null, tupia: null };
  var els = montarHarnessOrcamento(cfgBase(maquinas, ops));
  els.om_dobra.value = '20';
  window._orcMaqInfoSnapshot = null;
  mod.orcRecalc();
  perto('MACH-03.1: máquina com unidade m² vinculada a operação por minuto custa R$0,00 (nunca inventa conversão)', window._orcCalc.maqTotal, 0, 0.0001);
  eq('MACH-03.2: motivo explícito é "unidade_incompativel"', mod.cfgMaqOperInfo('dobra').motivo, 'unidade_incompativel');
}

// ══════════════════════════════════════════════════════════════════════
// MACH-04 — máquina vinculada, unidade='hora', mas Custo=R$0 (ainda não
// preenchido pelo usuário): sinaliza "sem custo configurado", nunca
// silencioso.
// ══════════════════════════════════════════════════════════════════════
{
  var maquinas = [{ id: 'maqLaserFiber', nome: 'Laser Fiber', unidade: 'hora', custo: 0, setup: 0 }];
  var ops = { laser: 'maqLaserFiber', dobra: null, pol: null, uv: null, lixa: null, tupia: null };
  eq('MACH-04.1: motivo explícito é "sem_custo"', (function(){ mod.setCfg(cfgBase(maquinas, ops)); return mod.cfgMaqOperInfo('laser').motivo; })(), 'sem_custo');
}

// ══════════════════════════════════════════════════════════════════════
// MACH-05 — id estável: excluir uma máquina do MEIO da lista não corrompe
// o vínculo de operação→máquina das outras (vínculo é por id, nunca por
// posição no array).
// ══════════════════════════════════════════════════════════════════════
{
  var maquinas = [
    { id: 'maqA', nome: 'Laser Verde', unidade: 'hora', custo: 60, setup: 0 },
    { id: 'maqB', nome: 'Laser Metal', unidade: 'hora', custo: 300, setup: 0 },
    { id: 'maqC', nome: 'Dobra', unidade: 'hora', custo: 36, setup: 0 }
  ];
  var ops = { laser: 'maqB', dobra: 'maqC', pol: null, uv: null, lixa: null, tupia: null };
  mod.setCfg(cfgBase(maquinas, ops));
  var antesLaser = mod.cfgMaqOperInfo('laser');
  // Exclui a máquina do MEIO (maqA, índice 0 — simula cfgDelRow('maq',0))
  maquinas.splice(0, 1);
  mod.setCfg(cfgBase(maquinas, ops));
  var depoisLaser = mod.cfgMaqOperInfo('laser'), depoisDobra = mod.cfgMaqOperInfo('dobra');
  perto('MACH-05.1: vínculo do Laser (maqB) sobrevive intacto após excluir outra máquina', depoisLaser.custoMin, antesLaser.custoMin, 0.0001);
  ok('MACH-05.2: vínculo da Dobra (maqC) também permanece correto', depoisDobra.ok === true && Math.abs(depoisDobra.custoMin - 36/60) < 0.0001);
}

// ══════════════════════════════════════════════════════════════════════
// MACH-06 — snapshot: orçamento ANTIGO reaberto preserva a taxa vigente
// QUANDO FOI SALVO, mesmo que a Config tenha mudado depois (nunca
// recalcula histórico com preço novo).
// ══════════════════════════════════════════════════════════════════════
{
  var maquinas1 = [{ id: 'maqX', nome: 'Laser X', unidade: 'hora', custo: 60, setup: 0 }]; // R$1,00/min na época do save
  var opsX = { laser: 'maqX', dobra: null, pol: null, uv: null, lixa: null, tupia: null };
  var els = montarHarnessOrcamento(cfgBase(maquinas1, opsX));
  els.om_laser.value = '10';
  window._orcMaqInfoSnapshot = null; // orçamento em edição "ao vivo" (ainda não reaberto)
  mod.orcRecalc();
  var snapshotSalvoNoMomentoDoSave = JSON.parse(JSON.stringify(window._orcMaqOpsCalc)); // simula o que orc.parametros.maqInfoSnapshot grava
  perto('MACH-06.1: custo no momento do save = R$10,00 (10min × R$1,00/min)', window._orcCalc.maqTotal, 10, 0.0001);

  // Config muda DEPOIS do save (vendedor reconfigura a máquina para R$6,00/h)
  maquinas1[0].custo = 360; // R$6,00/min agora
  mod.setCfg(cfgBase(maquinas1, opsX));

  // Reabre o orçamento ANTIGO (restaura o snapshot, como orcEnvEditar faz)
  window._orcMaqInfoSnapshot = {};
  Object.keys(snapshotSalvoNoMomentoDoSave).forEach(function (k) { window._orcMaqInfoSnapshot[k] = snapshotSalvoNoMomentoDoSave[k].info; });
  mod.orcRecalc();
  perto('MACH-06.2: orçamento ANTIGO reaberto continua R$10,00 — nunca recalcula com a taxa nova', window._orcCalc.maqTotal, 10, 0.0001);
}

// ══════════════════════════════════════════════════════════════════════
// MACH-07 — orçamento NOVO (sem snapshot) sempre usa a Config VIGENTE —
// mudar Config reflete imediatamente, sem editar código.
// ══════════════════════════════════════════════════════════════════════
{
  var maquinas = [{ id: 'maqY', nome: 'Laser Y', unidade: 'hora', custo: 60, setup: 0 }];
  var ops = { laser: 'maqY', dobra: null, pol: null, uv: null, lixa: null, tupia: null };
  var els = montarHarnessOrcamento(cfgBase(maquinas, ops));
  els.om_laser.value = '10';
  window._orcMaqInfoSnapshot = null; // orçamento novo — nunca tem snapshot
  mod.orcRecalc();
  perto('MACH-07.1: orçamento novo usa a taxa vigente (R$1,00/min × 10min = R$10,00)', window._orcCalc.maqTotal, 10, 0.0001);
  maquinas[0].custo = 120; // Config muda — dobra a taxa
  mod.setCfg(cfgBase(maquinas, ops));
  mod.orcRecalc();
  perto('MACH-07.2: mesmo orçamento (sem reabrir/sem snapshot) reflete a nova Config imediatamente', window._orcCalc.maqTotal, 20, 0.0001);
}

// ══════════════════════════════════════════════════════════════════════
// MACH-08 — "Velocidades de Corte — Laser" (tempo) é um sistema DIFERENTE
// e nunca é lido por cfgMaqOperInfo (custo) — preservado intocado.
// ══════════════════════════════════════════════════════════════════════
{
  mod.setCfg({ financeiro: {}, materiais: [], maquinas: [], maquinasOperacoes: { laser: null }, laser: { speeds: [{ material: 'Acrílico', esp: 3, vel: 16 }] } });
  var info = mod.cfgMaqOperInfo('laser');
  eq('MACH-08: cfgMaqOperInfo nunca lê _cfgData.laser (tabela de velocidades) — motivo continua "nao_vinculada"', info.motivo, 'nao_vinculada');
}

console.log('\n' + '─'.repeat(70));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); fs.unlinkSync(modPath); process.exit(1); }
console.log('\n✅ PASSOU\n');
fs.unlinkSync(modPath);
