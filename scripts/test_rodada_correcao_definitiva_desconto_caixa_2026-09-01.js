/**
 * test_rodada_correcao_definitiva_desconto_caixa_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA, Bloco 3 — o ERP aplicava automaticamente
 * (e incondicionalmente) o desconto de montagem da receita 'Caixa'
 * (reduzir Lateral/Frente/Fundo pela espessura do material) sempre que o
 * vendedor informava Comprimento×Largura×Altura. Requisito: por padrão,
 * NENHUM desconto é aplicado — um toggle explícito ("Aplicar descontos de
 * montagem") liga/desliga, persistido por item, sobrevivendo a reabertura
 * e a trocas de qty/material.
 *
 * Reaproveita o mecanismo já usado por rec.pieces(L,A,P,e,extra) (o mesmo
 * parâmetro `extra` que já existia para campos extras de receita — nunca
 * um segundo sistema de configuração de peça) e o padrão de toggle+dataset
 * já usado por orcExtrasToggleManual() (checkbox de ajuste manual do
 * laser) — mesmo modelo, nunca uma implementação nova do zero.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * PLAN_RECIPES (objeto), orcItemVRRestaurarDados.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_desconto_caixa_2026-09-01.js
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
function extractVarObjLiteral(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Desconto manual da Caixa (opt-in) ===\n');

var src = [extractVarObjLiteral('PLAN_RECIPES'), extractFn('orcItemVRRestaurarDados')].join('\n\n')
  + '\n\nmodule.exports = {PLAN_RECIPES, orcItemVRRestaurarDados};';
var modPath = path.join(__dirname, '_rodada_correcao_definitiva_desconto_caixa.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════════
// 1 — flag do recipe: 'Caixa' sinaliza que suporta o toggle.
// ══════════════════════════════════════════════════════════════════════════
assertTrue(mod.PLAN_RECIPES['Caixa'].descontoMontagemOpcional === true, '1. PLAN_RECIPES.Caixa.descontoMontagemOpcional === true (sinaliza ao modal para mostrar o toggle)');

// ══════════════════════════════════════════════════════════════════════════
// 2-3 — TESTE OBRIGATÓRIO: default (sem extra, ou extra.descontosMontagem
// Aplicados=false) → NENHUM desconto. Caixa 20×20×20, espessura 0,3cm:
// Lateral/Frente-Fundo devem ter as MESMAS dimensões que Base/Tampa.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var L = 20, A = 20, P = 20, e = 0.3;
  var pecasSemExtra = mod.PLAN_RECIPES['Caixa'].pieces(L, A, P, e); // sem 5º argumento
  var pecasComFalse = mod.PLAN_RECIPES['Caixa'].pieces(L, A, P, e, { descontosMontagemAplicados: false });
  [pecasSemExtra, pecasComFalse].forEach(function (pecas, i) {
    var lateral = pecas.find(function (p) { return p.nome === 'Lateral'; });
    var frenteFundo = pecas.find(function (p) { return p.nome === 'Frente/Fundo'; });
    var base = pecas.find(function (p) { return p.nome === 'Base'; });
    assertEq(lateral.larg, P, '2.' + i + 'a. Sem toggle ligado: Lateral.larg = P inteiro (' + P + ') — NENHUM desconto aplicado por padrão');
    assertEq(lateral.alt, A, '2.' + i + 'b. Sem toggle ligado: Lateral.alt = A inteiro (' + A + ')');
    assertEq(frenteFundo.larg, L, '2.' + i + 'c. Sem toggle ligado: Frente/Fundo.larg = L inteiro (' + L + ')');
    assertEq(base.larg, L, '3.' + i + '. Base/Tampa nunca são afetadas pelo toggle (sempre L×P, com ou sem desconto)');
  });
})();

// ══════════════════════════════════════════════════════════════════════════
// 4 — TESTE OBRIGATÓRIO: toggle LIGADO → desconto aplicado (comportamento
// antigo, agora opt-in) — Lateral/Frente-Fundo reduzidas pela espessura.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var L = 20, A = 20, P = 20, e = 0.3;
  var pecas = mod.PLAN_RECIPES['Caixa'].pieces(L, A, P, e, { descontosMontagemAplicados: true });
  var lateral = pecas.find(function (p) { return p.nome === 'Lateral'; });
  var frenteFundo = pecas.find(function (p) { return p.nome === 'Frente/Fundo'; });
  var base = pecas.find(function (p) { return p.nome === 'Base'; });
  assertEq(lateral.larg, P - 2 * e, '4a. Toggle LIGADO: Lateral.larg reduzida (P - 2e = ' + (P - 2 * e) + ')');
  assertEq(lateral.alt, A - e, '4b. Toggle LIGADO: Lateral.alt reduzida (A - e = ' + (A - e) + ')');
  assertEq(frenteFundo.larg, L - 2 * e, '4c. Toggle LIGADO: Frente/Fundo.larg reduzida (L - 2e = ' + (L - 2 * e) + ')');
  assertEq(base.larg, L, '4d. Base/Tampa continuam L×P mesmo com o toggle ligado');
})();

// ══════════════════════════════════════════════════════════════════════════
// 5 — qty/nome/estrutura das peças NUNCA mudam com o toggle — só a
// geometria de largura/altura das duas peças automáticas.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var off = mod.PLAN_RECIPES['Caixa'].pieces(20, 20, 20, 0.3, { descontosMontagemAplicados: false });
  var on = mod.PLAN_RECIPES['Caixa'].pieces(20, 20, 20, 0.3, { descontosMontagemAplicados: true });
  assertEq(off.map(function (p) { return p.nome + ':' + p.qty; }), on.map(function (p) { return p.nome + ':' + p.qty; }), '5. Nomes/quantidades das 4 peças (Lateral×2, Frente/Fundo×2, Base×1, Tampa×1) são idênticos ligado/desligado — o toggle NUNCA cria/remove peças');
})();

// ══════════════════════════════════════════════════════════════════════════
// 6 — REGRESSÃO: as outras 8 receitas com redução por espessura (Armário,
// Expositor, etc.) permanecem INCONDICIONAIS — este Bloco 3 é escopado
// só à Caixa, nunca uma mudança silenciosa em outro produto.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var outrasComEsp = Object.keys(mod.PLAN_RECIPES).filter(function (k) {
    return k !== 'Caixa' && mod.PLAN_RECIPES[k].pieces.length >= 4; // aceita (L,A,P,e[,extra])
  });
  assertTrue(outrasComEsp.length > 0, '6a. (sanity) existem outras receitas 3D com espessura, além de Caixa');
  outrasComEsp.forEach(function (k) {
    assertTrue(!mod.PLAN_RECIPES[k].descontoMontagemOpcional, '6b. ' + k + ' NÃO tem descontoMontagemOpcional — continua incondicional (fora do escopo deste Bloco 3)');
  });
})();

// ══════════════════════════════════════════════════════════════════════════
// 7 — Persistência/reabertura: orcItemVRRestaurarDados() restaura o
// booleano fielmente (true/false/ausente) — nunca inverte, nunca assume
// um default diferente de false para item legado sem o campo.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  assertEq(mod.orcItemVRRestaurarDados({ descontosMontagemAplicados: true }).descontosMontagemAplicados, true, '7a. Item salvo com toggle ligado (true) restaura true');
  assertEq(mod.orcItemVRRestaurarDados({ descontosMontagemAplicados: false }).descontosMontagemAplicados, false, '7b. Item salvo com toggle desligado (false) restaura false');
  assertEq(mod.orcItemVRRestaurarDados({}).descontosMontagemAplicados, false, '7c. Item legado (salvo antes desta rodada, campo ausente) restaura false — nunca liga desconto sozinho');
})();

console.log('\n----------------------------------------------------------------------');

// ══════════════════════════════════════════════════════════════════════════
// 8 — Estrutural: os pontos de integração (planCalc, _planResincronizarPecas
// Herdadas, persistência no save, toggle handler, HTML do checkbox)
// existem e estão fiados corretamente.
// ══════════════════════════════════════════════════════════════════════════
assertTrue(html.indexOf('function planToggleDescontoMontagem()') > 0, '8a. planToggleDescontoMontagem() existe');
assertTrue(html.indexOf("row.dataset.descontosMontagemAplicados = (cb && cb.checked) ? 'true' : 'false';") > 0, '8b. planToggleDescontoMontagem() persiste o estado no dataset do item');
assertTrue(html.indexOf('if(_descontoOpcional) extra.descontosMontagemAplicados = !!(_descCb && _descCb.checked);') > 0, '8c. planCalc() injeta o estado do toggle em `extra` antes de chamar rec.pieces()');
assertTrue(html.indexOf("if (rec.descontoMontagemOpcional) extra.descontosMontagemAplicados = row.dataset.descontosMontagemAplicados==='true';") > 0, '8d. _planResincronizarPecasHerdadas() também repassa o estado persistido (troca de material/espessura não reintroduz nem remove o desconto)');
assertTrue(html.indexOf('descontosMontagemAplicados: row.dataset.descontosMontagemAplicados===\'true\',') > 0, '8e. _orcSalvarOrcamentoImpl() persiste o campo no item salvo');
var idxCheckboxHtml = html.indexOf('id="planDescMontagem"');
assertTrue(idxCheckboxHtml > 0, '8f. Checkbox do toggle existe no HTML do modal de Planificação');
if (idxCheckboxHtml > 0) {
  var trechoCheckbox = html.slice(idxCheckboxHtml - 60, idxCheckboxHtml + 40);
  assertTrue(trechoCheckbox.indexOf('checked') < 0, '8g. Checkbox NÃO nasce com o atributo "checked" no HTML — default é DESLIGADO (planCalc() só liga se o dataset persistido disser "true")');
}
assertTrue(html.indexOf('id="planDescMontagemWrap" style="display:none') > 0, '8h. Wrap do toggle nasce escondido por padrão (display:none) — só planCalc() mostra, e só para receitas com descontoMontagemOpcional');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
