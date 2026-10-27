/**
 * test_plan_dim_override_2026-10-27.js
 *
 * Regressão do bug real relatado pelo usuário (2026-10-27): editar
 * manualmente a largura/altura de uma peça automática planificada (ex.:
 * Tampa de 37×42 para 41×46) e depois clicar em "+ Adicionar Peça" (ou
 * qualquer outra ação que dispare planCalc()/_planReconcilePieces() de
 * novo — excluir outra peça, mexer em consumíveis) revertia a dimensão
 * editada de volta para o valor bruto calculado pela receita.
 *
 * Causa raiz: `_planReconcilePieces()` preservava esp/adesivo/gravação/
 * spray/extra do estado anterior (`prev`), mas `larg`/`alt` eram SEMPRE
 * recalculados a partir da peça fresca da receita — nunca preservados.
 *
 * Correção: peça automática ganha `dimOverride` (setado por
 * `_planEditField` ao editar largura/altura, ver index.html), e
 * `_planReconcilePieces`/`_planSeedFromPersisted`/`_planHidratarDireto`
 * preservam `larg`/`alt` (e propagam o próprio `dimOverride`) sempre que
 * esse flag estiver marcado, igual ao padrão já existente para espOverride.
 *
 * Uso: node scripts/test_plan_dim_override_2026-10-27.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

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

var FN_NAMES = ['_planPieceSlug', '_planPecaAdesivos', '_planReconcilePieces', '_planSeedFromPersisted', '_planHidratarDireto', '_planBuildAllPecas'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { _planReconcilePieces: _planReconcilePieces, _planSeedFromPersisted: _planSeedFromPersisted, _planHidratarDireto: _planHidratarDireto, _planBuildAllPecas: _planBuildAllPecas };'
].join('\n\n');
var modPath = path.join(__dirname, '_plan_dim_override_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA CIRÚRGICA 2026-10-27 — Override de dimensão manual na planificação ===\n');

// Receita simulada de uma "Caixa": Tampa/Base/Lateral×2/Frente/Fundo,
// sempre recalculada a partir de L/A/P (37×42, por exemplo) — exatamente
// como rec.pieces(L,A,P,e,extra) devolveria, sem esp/adesivo por peça.
function receitaFresca() {
  return [
    { nome: 'Tampa',   qty: 1, larg: 37, alt: 42 },
    { nome: 'Base',    qty: 1, larg: 37, alt: 42 },
    { nome: 'Lateral', qty: 2, larg: 30, alt: 20 },
    { nome: 'Frente',  qty: 1, larg: 37, alt: 20 },
    { nome: 'Fundo',   qty: 1, larg: 37, alt: 20 }
  ];
}

(function teste1_edicaoManualSobreviveAReconciliacaoSeguinte() {
  // 1ª reconciliação (planCalc() inicial, sem _planEditPieces prévio).
  global._planEditPieces = [];
  var pecas1 = mod._planReconcilePieces(receitaFresca(), 3);
  ok('Tampa nasce com a dimensão bruta da receita (37×42)', pecas1[0].nome === 'Tampa' && pecas1[0].larg === 37 && pecas1[0].alt === 42);
  ok('Tampa nasce sem dimOverride', pecas1[0].dimOverride === false);

  // Vendedor edita manualmente a Tampa para 41×46 (simula _planEditField).
  global._planEditPieces = pecas1;
  var tampa = global._planEditPieces.find(function (p) { return p.nome === 'Tampa'; });
  tampa.larg = 41; tampa.alt = 46; tampa.dimOverride = true;

  // Ação não relacionada (clicar "+ Adicionar Peça") dispara planCalc()
  // de novo → nova chamada a _planReconcilePieces() com a MESMA receita
  // fresca (L/A/P do item não mudaram).
  var pecas2 = mod._planReconcilePieces(receitaFresca(), 3);
  var tampa2 = pecas2.find(function (p) { return p.nome === 'Tampa'; });
  ok('BUG FECHADO: Tampa continua 41×46 depois de "+ Adicionar Peça" (não volta para 37×42)', tampa2.larg === 41 && tampa2.alt === 46);
  ok('dimOverride permanece marcado após a 2ª reconciliação (sobrevive a uma 3ª)', tampa2.dimOverride === true);

  // Peças NÃO editadas continuam 100% reativas à receita (nunca "congelam" à toa).
  var base2 = pecas2.find(function (p) { return p.nome === 'Base'; });
  ok('Base (não editada) continua acompanhando a receita', base2.larg === 37 && base2.alt === 42 && base2.dimOverride === false);

  // 3ª reconciliação, agora simulando MUDANÇA real na receita (ex.: outra
  // peça renomeada/retirada não deveria importar) — override persiste.
  var pecas3 = mod._planReconcilePieces(receitaFresca(), 3);
  var tampa3 = pecas3.find(function (p) { return p.nome === 'Tampa'; });
  ok('Override sobrevive a uma 3ª reconciliação consecutiva', tampa3.larg === 41 && tampa3.alt === 46);
})();

(function teste2_exclusaoDeOutraPecaNaoAfetaOverride() {
  global._planEditPieces = mod._planReconcilePieces(receitaFresca(), 3);
  var tampa = global._planEditPieces.find(function (p) { return p.nome === 'Tampa'; });
  tampa.larg = 41; tampa.alt = 46; tampa.dimOverride = true;
  var fundo = global._planEditPieces.find(function (p) { return p.nome === 'Fundo'; });
  fundo._deleted = true; // vendedor exclui outra peça

  var pecas = mod._planReconcilePieces(receitaFresca(), 3);
  var tampaDepois = pecas.find(function (p) { return p.nome === 'Tampa'; });
  var fundoDepois = pecas.find(function (p) { return p.nome === 'Fundo'; });
  ok('Excluir outra peça não reverte a dimensão override da Tampa', tampaDepois.larg === 41 && tampaDepois.alt === 46);
  ok('Exclusão da outra peça continua respeitada (_deleted preservado)', fundoDepois._deleted === true);
})();

(function teste3_reaberturaDeOrcamentoSalvoPreservaOverride() {
  // Orçamento salvo com a Tampa já overridada (41×46, dimOverride:true).
  var planPecasSalvo = JSON.stringify([
    { id: 'auto_tampa', nome: 'Tampa', qty: 1, larg: 41, alt: 46, dimOverride: true, origem: 'AUTOMATICA' },
    { id: 'auto_base',  nome: 'Base',  qty: 1, larg: 37, alt: 42, dimOverride: false, origem: 'AUTOMATICA' },
    { id: 'auto_lateral', nome: 'Lateral', qty: 2, larg: 30, alt: 20, dimOverride: false, origem: 'AUTOMATICA' },
    { id: 'auto_frente', nome: 'Frente', qty: 1, larg: 37, alt: 20, dimOverride: false, origem: 'AUTOMATICA' },
    { id: 'auto_fundo', nome: 'Fundo', qty: 1, larg: 37, alt: 20, dimOverride: false, origem: 'AUTOMATICA' }
  ]);

  // Caminho 1: reabertura normal (L/A/P restaurados) via _planSeedFromPersisted.
  var seeded = mod._planSeedFromPersisted(receitaFresca(), planPecasSalvo, 3);
  var tampaSeed = seeded.find(function (p) { return p.nome === 'Tampa'; });
  ok('_planSeedFromPersisted restaura a dimensão salva (41×46) ao reabrir', tampaSeed.larg === 41 && tampaSeed.alt === 46);
  ok('_planSeedFromPersisted propaga dimOverride=true para a próxima reconciliação', tampaSeed.dimOverride === true);

  // Simula uma AÇÃO dentro da mesma sessão reaberta (ex.: "+ Adicionar
  // Peça" de novo) — 2ª reconciliação precisa continuar respeitando.
  global._planEditPieces = seeded;
  var pecasDepoisDeReabrir = mod._planReconcilePieces(receitaFresca(), 3);
  var tampaDepoisDeReabrir = pecasDepoisDeReabrir.find(function (p) { return p.nome === 'Tampa'; });
  ok('Após reabrir E reconciliar de novo, a Tampa continua 41×46', tampaDepoisDeReabrir.larg === 41 && tampaDepoisDeReabrir.alt === 46);

  // Caminho 2: hidratação direta (L/A/P não restaurados, só o snapshot).
  var hidratado = mod._planHidratarDireto(planPecasSalvo, 3);
  var tampaHidr = hidratado.find(function (p) { return p.nome === 'Tampa'; });
  ok('_planHidratarDireto também restaura a dimensão salva (41×46)', tampaHidr.larg === 41 && tampaHidr.alt === 46);
  ok('_planHidratarDireto também propaga dimOverride=true', tampaHidr.dimOverride === true);
})();

(function teste4_persistenciaIncluiDimOverride() {
  global.planManualPieces = [];
  global._planEditPieces = mod._planReconcilePieces(receitaFresca(), 3);
  var tampa = global._planEditPieces.find(function (p) { return p.nome === 'Tampa'; });
  tampa.larg = 41; tampa.alt = 46; tampa.dimOverride = true;

  var payload = mod._planBuildAllPecas();
  var tampaPayload = payload.find(function (p) { return p.nome === 'Tampa'; });
  ok('_planBuildAllPecas (payload persistido) inclui dimOverride:true na Tampa', tampaPayload.dimOverride === true);
  ok('_planBuildAllPecas preserva a dimensão editada no payload persistido', tampaPayload.larg === 41 && tampaPayload.alt === 46);
})();

console.log('\n' + (failed === 0 ? '✅ TODOS OS TESTES PASSARAM' : '❌ ' + failed + ' TESTE(S) FALHARAM') + ' (' + passed + ' passou/passaram, ' + failed + ' falhou/falharam)\n');
try { fs.unlinkSync(modPath); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
