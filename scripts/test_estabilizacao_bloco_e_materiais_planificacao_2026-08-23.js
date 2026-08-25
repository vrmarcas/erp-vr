/**
 * test_estabilizacao_bloco_e_materiais_planificacao_2026-08-23.js
 *
 * RODADA DE ESTABILIZAÇÃO (2026-08-23) — Bloco E.
 *
 * BUG real de produção (já relatado antes e nunca corrigido): dentro do
 * modal de Planificação, o seletor de material/espessura das peças manuais
 * mostrava materiais que NÃO existem/não estão ativos na Configuração de
 * Orçamento.
 *
 * Causa raiz (auditoria dedicada): _planGetEspOptions() combinava, sem
 * nenhuma deduplicação nem checagem de existência, dois catálogos —
 * ORC_MATS (6 materiais hardcoded no código-fonte, preço em <input
 * type="hidden">, nunca sincronizado com exclusões) + _cfgData.materiais
 * (Configuração de Orçamento, fonte de verdade real). ORC_MATS sempre
 * entrava inteiro, independente de o material ter sido removido/nunca
 * cadastrado oficialmente.
 *
 * Corrigido removendo ORC_MATS da LISTA de opções (a função passa a ler só
 * _cfgData.materiais, mesma fonte que orcConstruirMatOpts() já usa
 * corretamente para o seletor principal do item) — ORC_MATS continua
 * existindo no código para RESOLVER chaves legadas de itens muito antigos
 * (orcMatChanged/_matGetRsm2, caminho separado, intocado). Identidade
 * também migrada de "espessura + aproximação de preço" para ID estável
 * (m.id), mesmo padrão já usado no merge da Config Orçamento.
 *
 * Função sob teste extraída de index.html (nunca reimplementada):
 * _planGetEspOptions. planRenderManual (geração do <select>) é grande
 * demais para mockar toda a árvore de DOM — verificada por asserção
 * estrutural sobre o código-fonte real (mesmo princípio de
 * assertOnclickBemFormado de rodadas anteriores).
 *
 * Uso: node scripts/test_estabilizacao_bloco_e_materiais_planificacao_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

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

console.log('\n=== RODADA DE ESTABILIZAÇÃO — Bloco E (planificação com materiais fantasma) ===\n');

// ══════════════════════════════════════════════════════════════════════════
// PARTE 1 — _planGetEspOptions() isolada (comportamento real)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var FN_NAMES = ['_planGetEspOptions'];
  var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
  var modPath = path.join(__dirname, '_estabilizacao_bloco_e.tmp.js');
  fs.writeFileSync(modPath, src);

  function reset(materiais) {
    global.document = { getElementById: function () { return null; } };
    global._cfgData = { materiais: materiais };
    global.cfgLoad = function () { return { materiais: materiais }; };
  }

  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  // 1 — material ativo (cadastrado na Config) aparece
  reset([{ id: 'm1', nome: 'Acrílico Cristal', esp: 3, comp: 200, larg: 100, custo: 200 }]);
  var opts1 = mod._planGetEspOptions();
  assertTrue(opts1.length === 1 && opts1[0].label === 'Acrílico Cristal', '1. material ativo cadastrado na Configuração de Orçamento aparece no seletor');

  // 2/3 — material removido/desativado (não está mais no array) NÃO aparece
  reset([]);
  var opts2 = mod._planGetEspOptions();
  assertTrue(opts2.length === 0, '2. material removido da Configuração de Orçamento NÃO aparece mais (array vazio → zero opções)');

  // 6 — CENTRAL: materiais do catálogo legado ORC_MATS (Acrílico Cristal
  // 3mm/5mm/8mm/10mm, PS Cristal 3mm, Metal/Inox 2mm) NUNCA mais aparecem
  // por si só — só o que estiver de fato na Config Orçamento.
  assertTrue(opts2.length === 0, '3. (mesmo caso) nenhum material "fantasma" do ORC_MATS vaza quando a Config está vazia — antes desta correção apareceriam sempre 6 opções fixas aqui');

  // 4 — nova espessura cadastrada aparece
  reset([
    { id: 'm1', nome: 'Acrílico Cristal', esp: 3, comp: 200, larg: 100, custo: 200 },
    { id: 'm2', nome: 'Acrílico Cristal', esp: 5, comp: 200, larg: 100, custo: 300 },
  ]);
  var opts4 = mod._planGetEspOptions();
  assertTrue(opts4.length === 2 && opts4.some(function (o) { return o.espMm === 5; }), '4. nova espessura cadastrada na Config aparece no seletor');

  // 5 — removendo uma das duas espessuras, só a que ficou aparece
  reset([{ id: 'm1', nome: 'Acrílico Cristal', esp: 3, comp: 200, larg: 100, custo: 200 }]);
  var opts5 = mod._planGetEspOptions();
  assertTrue(opts5.length === 1 && opts5[0].espMm === 3, '5. espessura removida da Config não aparece mais — só a remanescente');

  // 7 — identidade por ID estável: cada opção carrega o m.id original
  reset([{ id: 'mat-abc-123', nome: 'PVC Branco', esp: 4, comp: 200, larg: 100, custo: 400 }]);
  var opts7 = mod._planGetEspOptions();
  assertTrue(opts7[0].id === 'mat-abc-123', '6. cada opção carrega o ID estável do material (m.id) — nunca mais só espessura+preço aproximado');

  // 8 — material sem nome / "Novo material" (linha em edição, ainda não
  // salva de verdade) nunca aparece como opção válida
  reset([{ id: 'm9', nome: 'Novo material', esp: 3, comp: 100, larg: 100, custo: 100 }]);
  var opts8 = mod._planGetEspOptions();
  assertTrue(opts8.length === 0, '7. linha "Novo material" (placeholder de cadastro em edição) nunca vira opção selecionável');

  // 9 — dois materiais DIFERENTES com a MESMA espessura e preço aproximado
  // (caso de ambiguidade que a auditoria encontrou) — ambos aparecem
  // distintamente, com IDs próprios, para o seletor poder desambiguar por ID
  reset([
    { id: 'm-cristal', nome: 'Acrílico Cristal', esp: 3, comp: 200, larg: 100, custo: 200 },
    { id: 'm-fume', nome: 'Acrílico Fumê', esp: 3, comp: 200, larg: 100, custo: 200 },
  ]);
  var opts9 = mod._planGetEspOptions();
  assertTrue(opts9.length === 2 && opts9[0].id !== opts9[1].id, '8. dois materiais com mesma espessura/preço (ambíguos por aproximação) permanecem distinguíveis por ID próprio');
})();

// ══════════════════════════════════════════════════════════════════════════
// PARTE 2 — Bloco E: garantias estruturais sobre o código-fonte real
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var srcEspOptions = extractFn('_planGetEspOptions');
  assertTrue(!/ORC_MATS\.forEach/.test(srcEspOptions), '9. _planGetEspOptions() não itera mais ORC_MATS (fonte legada removida da LISTA de opções)');
  assertTrue(/_cfgData\s*&&\s*_cfgData\.materiais/.test(srcEspOptions), '10. continua lendo _cfgData.materiais — mesma fonte de verdade do seletor principal do item');
  assertTrue(/id:\s*m\.id\s*\|\|\s*null/.test(srcEspOptions), '11. cada opção carrega m.id — identidade estável, não mais só espessura+preço');

  // ORC_MATS precisa continuar existindo em algum lugar (resolução de
  // chaves legadas) — a correção NÃO pode ter apagado o array inteiro,
  // só removido seu uso dentro do seletor de peça manual.
  assertTrue(/const ORC_MATS = \[/.test(html), '12. ORC_MATS continua existindo no arquivo (necessário para resolver chaves legadas de itens muito antigos — orcMatChanged/_matGetRsm2, caminho separado)');

  var srcRenderManual = extractFn('planRenderManual');
  assertTrue(/p\.matId\s*\?\s*\(p\.matId===o\.id\)/.test(srcRenderManual), '13. planRenderManual() reseleciona por ID (p.matId===o.id) quando a peça já tem matId salvo');
  assertTrue(/parseFloat\(p\.esp\|\|0\)===o\.espMm/.test(srcRenderManual), '14. fallback por espessura+preço aproximado preservado — peças manuais salvas ANTES desta correção continuam reselecionando corretamente (compatibilidade)');
  assertTrue(/data-matid=/.test(srcRenderManual), '15. o <option> gerado carrega data-matid — permite o <select> capturar o ID estável ao escolher');
  assertTrue(/planManualPieces\[.*\]\.matId\s*=/.test(srcRenderManual), '16. ao selecionar um material, planManualPieces[i].matId é gravado na peça (persistido junto com esp/precoM2)');
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
