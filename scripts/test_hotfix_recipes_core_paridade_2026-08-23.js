/**
 * test_hotfix_recipes_core_paridade_2026-08-23.js
 *
 * Sprint P0.2 — prova de PARIDADE entre a geometria PLAN_RECIPES original
 * (extraída ao vivo de index.html, nunca reimplementada aqui) e a porta
 * pura em functions-valeria/src/recipes.ts (compilada em lib/recipes.js).
 *
 * Para as 13 receitas embutidas + o fallback de peça plana, roda várias
 * combinações reais de L/A/P/e e exige diferença ZERO (JSON.stringify
 * idêntico) entre pieces(L,A,P,e) do original e da porta.
 *
 * Uso:
 *   cd functions-valeria && npm run build
 *   node scripts/test_hotfix_recipes_core_paridade_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assertEq(got, exp, msg) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { console.log('  ✅  ' + msg); passed++; }
  else { console.log('  ❌  ' + msg + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

// ── 1. Extrai PLAN_RECIPES ao vivo de index.html (nunca reimplementado) ──
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractVarBlock(name) {
  const marker = 'var ' + name + ' = {';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(name + ' não encontrado — teste desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1) + ';';
}

const originalSrc = extractVarBlock('PLAN_RECIPES');
const sandbox = { Math };
vm.createContext(sandbox);
vm.runInContext(originalSrc, sandbox);
const ORIGINAL = sandbox.PLAN_RECIPES;

// ── 2. Carrega a porta TS compilada ───────────────────────────────────────
const { PLAN_RECIPES: PORTED, resolveRecipe } = require('../functions-valeria/lib/recipes.js');

// ── 3. Paridade nome-a-nome + pieces() para várias dimensões ─────────────
console.log('=== Paridade: mesmos nomes de receita ===');
const nomesOriginal = Object.keys(ORIGINAL).sort();
const nomesPorted = Object.keys(PORTED).sort();
assertEq(nomesPorted, nomesOriginal, 'PLAN_RECIPES: mesmo conjunto de nomes de produto');

const DIMENSOES = [
  { L: 30, A: 20, P: 15, e: 3 },
  { L: 50, A: 40, P: 25, e: 4 },
  { L: 100, A: 60, P: 30, e: 2 },
  { L: 15, A: 15, P: 15, e: 3 },
];

console.log('\n=== Paridade: pieces(L,A,P,e) para cada receita e dimensão ===');
nomesOriginal.forEach((nome) => {
  DIMENSOES.forEach((d) => {
    const origPecas = ORIGINAL[nome].pieces(d.L, d.A, d.P, d.e);
    const portedPecas = PORTED[nome].pieces(d.L, d.A, d.P, d.e);
    assertEq(portedPecas, origPecas, `${nome} @ L${d.L}A${d.A}P${d.P}e${d.e}`);
  });
  assertEq(PORTED[nome].dim3d, ORIGINAL[nome].dim3d, `${nome}: dim3d igual`);
  assertEq(PORTED[nome].desc, ORIGINAL[nome].desc, `${nome}: desc igual`);
});

console.log('\n=== Paridade: fallback peça plana (produto não cadastrado) ===');
const fallbackOriginal = (function () {
  // Réplica do ramo 3 de planGetRecipe (index.html ~10104-10108) — só o
  // fallback, sem custom recipes (fora do escopo desta porta).
  return { dim3d: false, desc: 'Peça plana', pieces: function (L, A) { return [{ qty: 1, nome: 'Produto Inexistente XYZ', larg: L, alt: A }]; } };
})();
const fallbackPorted = resolveRecipe('Produto Inexistente XYZ');
assertEq(fallbackPorted.pieces(30, 20, 0, 0), fallbackOriginal.pieces(30, 20), 'fallback: mesma peça única L×A');
assertEq(fallbackPorted.dim3d, fallbackOriginal.dim3d, 'fallback: dim3d=false');

console.log('\n=== Paridade: resolveRecipe() para receita built-in ===');
DIMENSOES.forEach((d) => {
  assertEq(resolveRecipe('Caixa').pieces(d.L, d.A, d.P, d.e), ORIGINAL['Caixa'].pieces(d.L, d.A, d.P, d.e), `resolveRecipe('Caixa') @ L${d.L}A${d.A}P${d.P}e${d.e}`);
});

// RODADA DE CORREÇÃO DEFINITIVA (2026-09-01), Bloco 3 — desconto de
// montagem da Caixa virou opt-in via `extra.descontosMontagemAplicados`
// (index.html) — mesmo parâmetro portado para functions-valeria/src/
// recipes.ts. Sem este bloco, uma futura mudança em só um dos dois lados
// (client ou porta server-side usada pela Valéria) voltaria a divergir
// silenciosamente, exatamente como já aconteceu nesta própria rodada
// (a porta ficou com a fórmula antiga incondicional por alguns minutos
// até este teste apontar a quebra de paridade).
console.log('\n=== Paridade: Caixa com extra.descontosMontagemAplicados (Bloco 3, 2026-09-01) ===');
DIMENSOES.forEach((d) => {
  const semExtra = ORIGINAL['Caixa'].pieces(d.L, d.A, d.P, d.e);
  const comExtraFalse = ORIGINAL['Caixa'].pieces(d.L, d.A, d.P, d.e, { descontosMontagemAplicados: false });
  const comExtraTrue = ORIGINAL['Caixa'].pieces(d.L, d.A, d.P, d.e, { descontosMontagemAplicados: true });
  assertEq(semExtra, comExtraFalse, `Caixa (original): sem extra === extra.descontosMontagemAplicados=false @ L${d.L}A${d.A}P${d.P}e${d.e}`);
  assertEq(resolveRecipe('Caixa').pieces(d.L, d.A, d.P, d.e), semExtra, `resolveRecipe('Caixa') sem extra bate com ORIGINAL sem extra (default: SEM desconto) @ L${d.L}A${d.A}P${d.P}e${d.e}`);
  assertEq(resolveRecipe('Caixa').pieces(d.L, d.A, d.P, d.e, { descontosMontagemAplicados: true }), comExtraTrue, `resolveRecipe('Caixa') com extra.descontosMontagemAplicados=true bate com ORIGINAL @ L${d.L}A${d.A}P${d.P}e${d.e}`);
});

console.log(`\n${passed} passou, ${failed} falhou`);
process.exitCode = failed > 0 ? 1 : 0;
