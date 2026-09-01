/**
 * test_rodada_correcao_definitiva_dimensao_real_chapa_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA, Bloco 9 — bug real: o layout de
 * planificação (nesting/packing) sempre usava chapa fixa 200×100cm, mesmo
 * quando o material real cadastrado tem outro formato (ex.: acrílico
 * 122×244cm) — distorcendo número de chapas, aproveitamento, sobra,
 * retalho, custo e baixa de estoque. As 3 funções de packing
 * (kbPlanificacaoGerarSVG/planDrawCanvas/planExportSVG) tinham cada uma
 * sua própria constante hardcoded SHEET_W=200,SHEET_H=100, duplicada 3x.
 *
 * Corrigido com um helper único (_planResolveSheetDims), reaproveitando a
 * MESMA leitura de _cfgData.materiais[i].comp/larg que já alimentava o
 * cálculo de "% de chapa usada"/custo (planSumProporcao) — nunca uma
 * segunda fonte de verdade. Fallback 200×100 preservado só quando o
 * material não tem dimensão cadastrada.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _planResolveSheetDims, kbPlanificacaoGerarSVG, osProjecaoOperacionalItem.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_dimensao_real_chapa_2026-09-01.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) { console.log('  ❌  ' + msg + '\n       esperado ' + e + '\n       obtido   ' + g); failed++; }
  else { console.log('  ✅  ' + msg); passed++; }
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

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Dimensão real da chapa no nesting ===\n');

var FN_NAMES = ['_planResolveSheetDims', 'kbPlanificacaoGerarSVG', 'osProjecaoOperacionalItem', 'osItemMateriaisResumo'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_rodada_correcao_definitiva_dimensao_real_chapa.tmp.js');
fs.writeFileSync(modPath, src);

function reset() {
  global._cfgData = {
    materiais: [
      { id: 'ac3', nome: 'Acrílico 3mm', comp: 122, larg: 244 }, // cfg_0 — formato real de acrílico
      { id: 'ac5', nome: 'Acrílico 5mm', comp: 100, larg: 200 }, // cfg_1 — outro formato cadastrado
      { id: 'semdim', nome: 'Material sem dimensão', comp: 0, larg: 0 }, // cfg_2 — sem comp/larg
    ]
  };
  global.cfgLoad = function () { return { materiais: [] }; };
  global.cfgEsc = function (s) { return String(s == null ? '' : s); };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════════
// 1-4 — _planResolveSheetDims()
// ══════════════════════════════════════════════════════════════════════════
reset();
assertEq(mod._planResolveSheetDims(null), { w: 200, h: 100 }, '1. Sem matKey: fallback 200×100 preservado');
assertEq(mod._planResolveSheetDims('cfg_0'), { w: 122, h: 244 }, '2. TESTE OBRIGATÓRIO — chapa 122×244 (acrílico real): dimensão REAL usada, nunca o fallback fixo');
assertEq(mod._planResolveSheetDims('cfg_1'), { w: 100, h: 200 }, '3. TESTE OBRIGATÓRIO — outro formato cadastrado (100×200): muda corretamente, não fica preso no primeiro material lido');
assertEq(mod._planResolveSheetDims('cfg_2'), { w: 200, h: 100 }, '4. Material cadastrado SEM comp/larg: cai no fallback 200×100 (nunca quebra, nunca usa 0×0)');
assertEq(mod._planResolveSheetDims('naoexiste_999'), { w: 200, h: 100 }, '4b. matKey que não é "cfg_N" (ex.: chave legada): fallback 200×100');
assertEq(mod._planResolveSheetDims('cfg_99'), { w: 200, h: 100 }, '4c. Índice fora do array: fallback 200×100, nunca lança exceção');

// ══════════════════════════════════════════════════════════════════════════
// 5-7 — kbPlanificacaoGerarSVG(pecas, matKey): o SVG gerado reflete a
// dimensão real, e o número de chapas muda conforme o formato.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var pecasGrandes = [{ nome: 'Painel', larg: 110, alt: 230, qty: 1 }]; // cabe numa chapa 122×244, não em 100×200 nem 200×100 padrão
  var svgFallback = mod.kbPlanificacaoGerarSVG(pecasGrandes, null);
  var svgReal = mod.kbPlanificacaoGerarSVG(pecasGrandes, 'cfg_0');
  assertTrue(svgFallback.indexOf('200×100 cm') >= 0, '5. Sem matKey: rótulo do SVG ainda mostra 200×100 cm (fallback preservado)');
  assertTrue(svgReal.indexOf('122×244 cm') >= 0, '6. TESTE OBRIGATÓRIO — com matKey de acrílico real: rótulo do SVG mostra 122×244 cm, nunca 200×100');
  // Peça 110×230 não cabe numa chapa 200×100 (alt>100) nem 100×200 (larg>100 ao girar,
  // mas o algoritmo não gira peças) — deve gerar MÚLTIPLAS "chapas" no fallback,
  // mas cabe inteira numa única chapa real 122×244.
  var chapasFallback = (svgFallback.match(/Chapa \d+/g) || []).length;
  var chapasReal = (svgReal.match(/Chapa /g) || []).length;
  assertTrue(chapasReal <= chapasFallback, '7. TESTE OBRIGATÓRIO — chapa real (122×244) acomoda a peça com igual ou menos "chapas" que o fallback fixo (200×100 não a acomoda em pé: 230>100)');
})();

// ══════════════════════════════════════════════════════════════════════════
// 8 — Whitelist operacional da OS (osProjecaoOperacionalItem) propaga
// matKey — sem isso, o Kanban/OS nunca teria como saber qual chapa real
// usar no desenho.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var itemComMatKey = { tipoItem: 'personalizado_vr', prod: 'Caixa', qty: '1', larg: '20', alt: '20', matKey: 'cfg_0', mat: 'Acrílico 3mm' };
  var seguro = mod.osProjecaoOperacionalItem(itemComMatKey);
  assertEq(seguro.matKey, 'cfg_0', '8. osProjecaoOperacionalItem() propaga matKey para a OS (não-financeiro, mesma categoria de "mat" já whitelisted)');
  var itemSemMatKey = { tipoItem: 'personalizado_vr', prod: 'Caixa' };
  assertEq(mod.osProjecaoOperacionalItem(itemSemMatKey).matKey, null, '8b. Item sem matKey: campo vem null (nunca undefined solto, nunca lança exceção)');
})();

console.log('\n----------------------------------------------------------------------');

// ══════════════════════════════════════════════════════════════════════════
// 9 — Estrutural: planDrawCanvas()/planExportSVG() usam o mesmo helper
// (nunca voltam a hardcodar 200/100 depois desta correção).
// ══════════════════════════════════════════════════════════════════════════
var srcDrawCanvas = extractFn('planDrawCanvas');
var srcExportSVG = extractFn('planExportSVG');
assertTrue(srcDrawCanvas.indexOf('_planResolveSheetDims(') > 0, '9a. planDrawCanvas() usa _planResolveSheetDims()');
assertTrue(!/SHEET_W\s*=\s*200/.test(srcDrawCanvas), '9b. planDrawCanvas() não tem mais "SHEET_W=200" hardcoded');
assertTrue(srcExportSVG.indexOf('_planResolveSheetDims(') > 0, '9c. planExportSVG() usa _planResolveSheetDims()');
assertTrue(!/SHEET_W\s*=\s*200/.test(srcExportSVG), '9d. planExportSVG() não tem mais "SHEET_W=200" hardcoded');
var idxKbFn = html.indexOf('function kbPlanificacaoGerarSVG(pecas, matKey)');
assertTrue(idxKbFn > 0, '9e. kbPlanificacaoGerarSVG() aceita matKey como 2º parâmetro (assinatura atualizada)');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
