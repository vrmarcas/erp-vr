/**
 * test_hotfix_p0_1_adesivo_2026-08-12.js
 *
 * HOTFIX OPERACIONAL PÓS-GO-LIVE 2026-08-12, P0.1 — Adesivo/Adh. Branco:
 * (1) todo novo item/orçamento nasce Não/Não, nunca herda Sim de um
 *     produto/orçamento anterior; (2) preço R$/cm² configurável em
 *     Config. Orçamento → Consumíveis (migrado dos literais hardcoded
 *     0.0056/0.0011); (3) snapshot do preço usado persistido no
 *     orçamento — reabrir um orçamento antigo nunca recalcula com o
 *     preço novo da config.
 *
 * Uso: node scripts/test_hotfix_p0_1_adesivo_2026-08-12.js
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

console.log('\n=== HOTFIX P0.1 — Adesivo/Adh. Branco: default Não, preço configurável, snapshot histórico ===\n');

// ── 1. CFG_DEFAULT tem os campos migrados com os MESMOS valores hardcoded antes ──
var cfgDefaultSrc = html.slice(html.indexOf('var CFG_DEFAULT = {'), html.indexOf('var CFG_DEFAULT = {') + 1200);
ok('1a. CFG_DEFAULT.financeiro.adesivoPrecoCm2 = 0.0056 (mesmo valor hardcoded antes — migração sem quebrar cálculo)', /adesivoPrecoCm2\s*:\s*0\.0056/.test(cfgDefaultSrc));
ok('1b. CFG_DEFAULT.financeiro.adesivoBrancoPrecoCm2 = 0.0011', /adesivoBrancoPrecoCm2\s*:\s*0\.0011/.test(cfgDefaultSrc));

// ── 2. HTML: campos editáveis existem em Config. Orçamento ──
ok('2a. Campo cfgAdesivoPrecoCm2 existe no HTML', /id="cfgAdesivoPrecoCm2"/.test(html));
ok('2b. Campo cfgAdesivoBrancoPrecoCm2 existe no HTML', /id="cfgAdesivoBrancoPrecoCm2"/.test(html));

// ── 3. cfgSalvar()/cfgRenderTables() leem e gravam os novos campos ──
var cfgSalvarSrc = extractFn('cfgSalvar');
ok('3a. cfgSalvar() persiste adesivoPrecoCm2', /adesivoPrecoCm2\s*:\s*'cfgAdesivoPrecoCm2'/.test(cfgSalvarSrc));
ok('3b. cfgSalvar() persiste adesivoBrancoPrecoCm2', /adesivoBrancoPrecoCm2\s*:\s*'cfgAdesivoBrancoPrecoCm2'/.test(cfgSalvarSrc));
var cfgRenderSrc = extractFn('cfgRenderTables');
ok('3c. cfgRenderTables() preenche o form com o valor salvo', /adesivoPrecoCm2\s*:\s*'cfgAdesivoPrecoCm2'/.test(cfgRenderSrc));

// ── 4. orcRecalc() não usa mais literal hardcoded — lê config/snapshot ──
var orcRecalcSrc = extractFn('orcRecalc');
// RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 3 — fórmula passou de
// `adhYes ? areaTotal*adhPrecoCm2 : adhPecasTotal` (um substituía o outro)
// para `(adhYes?areaTotal*adhPrecoCm2:0) + adhPecasTotal` (os dois somam —
// ver commit "adesivo legado e adesivo por peça somam"). Regex atualizada
// para a nova estrutura; a intenção do teste (nunca mais literal 0.0056/
// 0.0011 hardcoded, sempre a variável adhPrecoCm2/adhbPrecoCm2) continua
// exatamente a mesma.
ok('4a. orcRecalc() não contém mais o literal 0.0056 direto no cálculo (usa adhPrecoCm2 variável)', /adhYes\s*\?\s*areaTotal\*adhPrecoCm2/.test(orcRecalcSrc));
ok('4b. orcRecalc() não contém mais o literal 0.0011 direto no cálculo (usa adhbPrecoCm2 variável)', /adhbYes\s*\?\s*areaTotal\*adhbPrecoCm2/.test(orcRecalcSrc));
ok('4c. orcRecalc() prioriza window._orcAdhPrecoSnapshot quando presente (histórico)', /_orcAdhPrecoSnapshot/.test(orcRecalcSrc));
ok('4d. orcRecalc() cai para cfgLoad().financeiro quando não há snapshot (config vigente)', /_cfgFinAdh\.adesivoPrecoCm2/.test(orcRecalcSrc));

// ── 5. orcResetFormularioVR() zera Sim→Não e limpa o snapshot ──
var resetSrc = extractFn('orcResetFormularioVR');
ok("5a. orcResetFormularioVR() seta oc_adh='nao'", /setV\('oc_adh','nao'\)/.test(resetSrc));
ok("5b. orcResetFormularioVR() seta oc_adhb='nao'", /setV\('oc_adhb','nao'\)/.test(resetSrc));
ok('5c. orcResetFormularioVR() limpa window._orcAdhPrecoSnapshot (novo orçamento nunca herda snapshot do anterior)', /_orcAdhPrecoSnapshot\s*=\s*null/.test(resetSrc));

// ── 6. RODADA 6 — orcAplicarConsumivelReceita() foi DESATIVADA (virou
// no-op). Motivo: desde a Rodada 5, oc_adh/oc_adhb são só um FALLBACK
// LEGADO (a peça é a fonte ativa — orcRecalc(): `adh = adhYes ?
// areaTotal*adhPrecoCm2 : adhPecasTotal`); e, na Rodada 6, o campo saiu de
// toda UI editável (Step 3 oculto, seção removida do modal Custos). Uma
// automação que ainda forçasse oc_adh='sim' reintroduziria exatamente o
// bug documentado na Rodada 5 — vencendo silenciosamente a configuração
// por peça, sem nenhuma UI visível para o vendedor perceber ou corrigir.
// A propriedade original testada aqui ("nunca herda 'sim' resíduo de um
// produto anterior") continua verdadeira — só que agora por construção:
// a função não toca em oc_adh/oc_adhb em nenhuma circunstância.
var aplicarSrc = extractFn('orcAplicarConsumivelReceita');
ok('6a. orcAplicarConsumivelReceita() foi desativada (no-op) — nunca mais toca em oc_adh/oc_adhb', /^function orcAplicarConsumivelReceita\(prodNome\) \{\s*return;\s*\}$/.test(aplicarSrc));

// ── 7. Execução real: com a automação desativada, oc_adh residual de um
// produto anterior JAMAIS é tocado por uma troca de produto — nem para
// forçar 'sim' nem para resetar 'nao' (o campo é legado, só o vendedor
// através da peça decide o Adesivo de um orçamento novo).
{
  var FN_NAMES = ['orcConsumivelResolverValor', 'receitaConsumiveisEfetivos', 'orcAplicarConsumivelReceita'];
  var missing = [];
  FN_NAMES.forEach(function(n){ try { extractFn(n); } catch(e){ missing.push(n); } });
  if (missing.length) {
    console.log('  ⚠️  Funções auxiliares ausentes (pulando execução real): ' + missing.join(', '));
  } else {
    var consumiveisPadraoSrc = html.slice(html.indexOf('var CONSUMIVEIS_PADRAO = ['), html.indexOf('var CONSUMIVEIS_PADRAO = [') + 800);
    consumiveisPadraoSrc = consumiveisPadraoSrc.slice(0, consumiveisPadraoSrc.indexOf('];') + 2);
    var src = [
      consumiveisPadraoSrc,
      FN_NAMES.map(extractFn).join('\n\n'),
      "module.exports = { orcAplicarConsumivelReceita: orcAplicarConsumivelReceita };"
    ].join('\n\n');
    var modPath = path.join(__dirname, '_p0_1_adesivo_extracted.tmp.js');
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];

    function makeEl(props) { return Object.assign({ value: '' }, props || {}); }
    var _els = {
      orcItemBody_rows: 1, // simula 1 <tr data-idx> via querySelectorAll abaixo
      oc_adh: makeEl({ value: 'sim' }), // resíduo: produto A tinha exigido Sim
      oc_adhb: makeEl({ value: 'nao' }),
    };
    global.document = {
      getElementById: function (id) { return _els[id]; },
      querySelectorAll: function (sel) { return sel.indexOf('orcItemBody') > -1 ? [1] : []; }, // 1 item só
    };
    global.planProdLoad = function () {
      // produto B: sem entrada de consumíveis definida (nenhuma chave 'adh'/'adhb')
      return [{ nome: 'Produto B (sem receita de adesivo)', consumiveis: [] }];
    };
    var mod = require(modPath);
    mod.orcAplicarConsumivelReceita('Produto B (sem receita de adesivo)');
    test('7. RODADA 6 — trocar de produto NUNCA mais toca oc_adh (automação desativada; "sim" residual permanece só como dado legado, não reativado nem sobrescrito)', _els.oc_adh.value, 'sim');
    try { fs.unlinkSync(modPath); } catch (e) {}
  }
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
