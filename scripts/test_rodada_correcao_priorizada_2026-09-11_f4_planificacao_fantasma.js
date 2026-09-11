/**
 * test_rodada_correcao_priorizada_2026-09-11_f4_planificacao_fantasma.js
 *
 * RODADA DE CORREÇÃO PRIORIZADA (2026-09-11) — F4 (P0), primeiro achado
 * confirmado pela auditoria funcional real de produção (sessão anterior):
 *
 *   Sequência real reproduzida na auditoria:
 *   1. Linha 1 = Urna, planificada com sucesso (6 peças, 0.1266 m²).
 *   2. Linha 2 = Placa (produto novo, nunca planificado). Modal aberto,
 *      só o Comprimento preenchido (Largura vazia) — dimensões
 *      obrigatórias incompletas.
 *   3. A linha 2 passou a exibir "6 peças · 0,1266 m² · R$56,59" — os
 *      MESMOS números da Urna (linha 1), mesmo com o modal da Placa
 *      mostrando estado real vazio ao reabrir.
 *
 * CAUSA RAIZ (confirmada por leitura do código antes de editar, mesma
 * técnica de todas as rodadas anteriores): #planSumBox é um ÚNICO
 * elemento DOM reaproveitado por TODOS os itens do orçamento (mesmo
 * problema já corrigido uma vez para dataset.planManualMatCost/
 * planManualAreaM2 em _planCalcAndMerge(), homologação Fase F
 * 2026-08-05 — mas o reset nunca foi replicado para dataset.totalArea/
 * totalQty/pcs nos DOIS pontos de early-return de planCalc() quando as
 * dimensões/campos obrigatórios estão incompletos). Sem o reset,
 * dataset.totalArea/totalQty ficavam com o valor do ÚLTIMO item
 * calculado com sucesso; tanto planAplicar() quanto
 * _planSincronizarComItem() (chamada em TODO planCalc(), mesmo sem
 * clicar "Aplicar") só checam `totalArea<=0` para decidir se há algo
 * pronto — uma linha nova com dimensões incompletas herdava
 * silenciosamente o cálculo de outra linha.
 *
 * FIX: nos dois early-returns de planCalc() (dims faltando; campos
 * obrigatórios da receita faltando), zera explicitamente
 * sumBox.dataset.totalArea/totalQty e remove dataset.pcs — fecha as
 * DUAS portas de vazamento (planAplicar() e _planSincronizarComItem())
 * de uma vez, sem duplicar a checagem em cada consumidor.
 *
 * Uso: node scripts/test_rodada_correcao_priorizada_2026-09-11_f4_planificacao_fantasma.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

const FN_NAMES = [
  '_planAtualizarLabelsDim', 'orcProdutoNomeResolvido', 'cfgEsc',
  '_matGetRsm2', '_matResolverPrecoFamiliaEspessura', '_planPecaEspOverride',
  '_planPecaAdesivos', '_planDeltaEspecificoPecas', '_planConsumiveisChip',
  '_planConsumiveisCelulaHtml', '_planPieceSlug', '_planReconcilePieces',
  '_planSeedFromPersisted', '_planHidratarDireto', '_planBuildAllPecas',
  'planCalc', 'planLerCamposExtras',
  'planAplicar', '_planSincronizarComItem',
];

const src = [
  'var _planIdx = null;',
  'var planManualPieces = [];',
  'var _planEditPieces = [];',
  'var _planSeedPersistedJson = null;',
  'var _cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };',
  'var ORC_MATS = [];',
  // stubs de funções fora do escopo deste bug — planAplicar()/afins só
  // precisam que existam, nunca são o alvo da asserção.
  'function showToast(){}',
  'function planFechar(){}',
  'function orcRecalc(){ orcRecalcChamadas.push(_planIdx); }',
  'var orcRecalcChamadas = [];',
  'function orcAutoLaserSeNecessario(){}',
  'function planProdLoad(){ return []; }',
  'function receitaSnapshotParaItem(){ return {}; }',
  'function planDrawCanvas(){}',
  FN_NAMES.filter(Boolean).map(extractFn).join('\n\n'),
  'module.exports = {',
  '  planCalc: planCalc, planAplicar: planAplicar, _planSincronizarComItem: _planSincronizarComItem,',
  '  setPlanIdx: function(v){ _planIdx = v; }, setEditPieces: function(v){ _planEditPieces = v; },',
  '  getOrcRecalcChamadas: function(){ return orcRecalcChamadas; }',
  '};'
].join('\n\n');
const modPath = path.join(__dirname, '_f4_planificacao_fantasma_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

console.log('\n=== RODADA DE CORREÇÃO PRIORIZADA 2026-09-11 — F4: planificação fantasma entre linhas ===\n');

function makeEl(props) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, checked: false,
    disabled: false, options: [], selectedIndex: 0,
    appendChild: function () {}, setAttribute: function () {},
    classList: { add: function () {}, remove: function() {}, contains: function () { return false; } },
    closest: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  }, props || {});
}

// planSumBox é o MESMO objeto reaproveitado pelas duas linhas — é
// exatamente essa a condição real do bug (elemento único no DOM).
const sharedSumBox = makeEl({ dataset: {} });
const sharedPiecesBody = makeEl();
const sharedPiecesFoot = makeEl();
const sharedAplicarBtn = makeEl();
const sharedCamposAviso = makeEl();

// Linhas 1 (Urna, dados completos) e 2 (Placa, incompleta) têm seus
// próprios elementos de linha (oir_1/oir_2) e inputs (oi_*_1/oi_*_2) —
// só o modal de planificação (planLarg/planAlt/.../planSumBox) é
// compartilhado, fiel ao real.
const els = {
  planLarg: makeEl({ value: '' }),
  planAlt: makeEl({ value: '' }),
  planProf: makeEl({ value: '' }),
  planPiecesBody: sharedPiecesBody,
  planPiecesFoot: sharedPiecesFoot,
  planAplicarBtn: sharedAplicarBtn,
  planSumBox: sharedSumBox,
  planSumArea: makeEl(), planSumPecas: makeEl(), planSumProporcao: makeEl(),
  planSumCusto: makeEl(), planSumVenda: makeEl(), planSumFormula: makeEl(),
  planCamposExtrasAviso: sharedCamposAviso,
  planEspBreakdown: makeEl(), planModalTitle: makeEl(),
  planDescMontagemWrap: makeEl(), planDescMontagem: makeEl(),

  oi_prod_1: makeEl({ value: 'Urna' }),
  oi_esp_1: makeEl({ value: '2' }),
  oi_mat_1: makeEl({ value: 'cfg_0' }),
  oir_1: { dataset: {} },

  oi_prod_2: makeEl({ value: 'Placa' }),
  oi_esp_2: makeEl({ value: '2' }),
  oi_mat_2: makeEl({ value: 'cfg_0' }),
  oir_2: { dataset: {} },
};
global.document = {
  getElementById: function (id) { return els[id]; },
  createElement: function () { return makeEl(); }
};
global._cfgData = { financeiro: { overhead: 0, vrml: 0, impostos: 0 } };
global.ORC_MATS = [{ key: 'cfg_0', label: 'Acrílico Cristal 2mm', esp: 2 }];
global.cfgLoad = function () { return { materiais: [{ nome: 'Acrílico Cristal 2mm', custo: 100, comp: 200, larg: 100, rsm2: 100, esp: 2 }] }; };
global.setTimeout = function () {};

// Receita "caixa-like" (6 peças) para a Urna — usada só na linha 1, para
// reproduzir exatamente os números observados na auditoria (6 peças).
global.planGetRecipe = function (produto) {
  if (produto === 'Urna') {
    return {
      dim3d: true, desc: 'Urna', campos: [],
      pieces: function (L, A, P, e) {
        return [
          { qty: 2, nome: 'Lateral', larg: L, alt: A },
          { qty: 2, nome: 'Frente/Fundo', larg: L, alt: P },
          { qty: 1, nome: 'Base', larg: L, alt: L },
          { qty: 1, nome: 'Tampa', larg: L, alt: L }
        ];
      }
    };
  }
  // Placa — peça plana simples (L×A), igual ao produto real da auditoria.
  return {
    dim3d: false, desc: 'Peça plana', campos: [],
    pieces: function (L, A) { return [{ qty: 1, nome: 'Placa', larg: L, alt: A }]; }
  };
};
global.receitaCamposContexto = function () { return { ctx: {}, faltando: [] }; };

const mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════
// PASSO 1 — Linha 1 (Urna) recebe dimensões completas e é aplicada com
// sucesso, exatamente como na auditoria (linha calculada ANTES da Placa).
// ══════════════════════════════════════════════════════════════════════
mod.setPlanIdx('1');
mod.setEditPieces([]);
els.planLarg.value = '20'; els.planAlt.value = '10'; els.planProf.value = '15';
mod.planCalc();
mod.planAplicar();

const totalAreaLinha1 = parseFloat(els.oir_1.dataset.planArea) || 0;
ok('Linha 1 (Urna) aplicada com sucesso — planArea > 0 no próprio item', totalAreaLinha1 > 0);
ok('planSumBox ficou com o total da Urna logo após aplicar (pré-condição do teste)', parseFloat(sharedSumBox.dataset.totalArea) === totalAreaLinha1);

// ══════════════════════════════════════════════════════════════════════
// PASSO 2 — Linha 2 (Placa) é aberta do zero (mesma troca de _planIdx
// que planAbrir() faz de verdade) e só o Comprimento é preenchido — a
// exata reprodução do bug real da auditoria.
// ══════════════════════════════════════════════════════════════════════
mod.setPlanIdx('2');
mod.setEditPieces([]); // planAbrir() real sempre zera _planEditPieces ao trocar de item
els.planLarg.value = '30';
els.planAlt.value = ''; // Largura vazia — dimensão obrigatória faltando
mod.planCalc();

ok('F4 — sumBox.dataset.totalArea ZERADO quando linha 2 está com dimensão faltando (não herdou 0,1266 m² da Urna)', parseFloat(sharedSumBox.dataset.totalArea) === 0);
ok('F4 — sumBox.dataset.totalQty ZERADO quando linha 2 está com dimensão faltando', parseFloat(sharedSumBox.dataset.totalQty) === 0);
ok('F4 — sumBox.dataset.pcs não existe mais (peças da Urna não vazam para o preview da Placa)', sharedSumBox.dataset.pcs === undefined);

// ══════════════════════════════════════════════════════════════════════
// PASSO 3 — Tentar aplicar a Placa incompleta: NUNCA pode gravar em
// oir_2 nenhum resquício da Urna (regra do usuário: "Proibido: qualquer
// área/preço/peça de A aparecer em B").
// ══════════════════════════════════════════════════════════════════════
const chamadasAntesDoAplicar = mod.getOrcRecalcChamadas().length;
mod.planAplicar(); // clique real do vendedor em "Aplicar Planificação"

ok('F4 — planAplicar() NÃO grava planArea na linha 2 com dados incompletos (bloqueado, não aplicou)', els.oir_2.dataset.planArea === undefined);
ok('F4 — planAplicar() NÃO grava planPecas na linha 2 com dados incompletos', els.oir_2.dataset.planPecas === undefined);
ok('F4 — orcRecalc() não foi chamado por um planAplicar() que não deveria ter aplicado nada', mod.getOrcRecalcChamadas().length === chamadasAntesDoAplicar);

// _planSincronizarComItem() roda a CADA planCalc() (mesmo sem clicar em
// "Aplicar") — é o outro dos dois pontos de vazamento identificados na
// investigação; precisa estar igualmente bloqueado.
ok('F4 — _planSincronizarComItem() (chamada automática a cada planCalc) também não contaminou a linha 2', els.oir_2.dataset.planArea === undefined && els.oir_2.dataset.planPecas === undefined);

// ══════════════════════════════════════════════════════════════════════
// PASSO 4 — Preencher a Largura corretamente: a Placa passa a calcular
// SÓ os próprios dados (30×20 = 0,0600 m², 1 peça), nunca os da Urna.
// ══════════════════════════════════════════════════════════════════════
els.planAlt.value = '20';
mod.planCalc();
ok('F4 — com dimensões completas, a Placa calcula só a própria área (0,0600 m², não 0,1266 m² da Urna)', Math.abs(parseFloat(sharedSumBox.dataset.totalArea) - 600) < 0.01);
ok('F4 — com dimensões completas, a Placa calcula só a própria contagem de peças (1, não 6 da Urna)', parseFloat(sharedSumBox.dataset.totalQty) === 1);

mod.planAplicar();
const areaAplicadaPlaca = parseFloat(els.oir_2.dataset.planArea) || 0;
ok('F4 — Placa aplicada com sucesso após preencher os dois campos — planArea próprio (600 cm²)', Math.abs(areaAplicadaPlaca - 600) < 0.01);

// Linha 1 (Urna) permanece intacta durante todo o processo — nenhuma
// mutação da Placa pode "vazar de volta" para a Urna.
ok('F4 — a Urna (linha 1) permanece com sua própria área, nunca alterada pelo processamento da Placa', Math.abs((parseFloat(els.oir_1.dataset.planArea)||0) - totalAreaLinha1) < 0.01);

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '─'.repeat(60));
console.log('TOTAL: ' + (passed + failed) + '  ✅ ' + passed + '  ❌ ' + failed);
console.log('─'.repeat(60) + '\n');
process.exit(failed > 0 ? 1 : 0);
