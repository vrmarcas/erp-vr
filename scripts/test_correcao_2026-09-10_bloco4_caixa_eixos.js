/**
 * test_correcao_2026-09-10_bloco4_caixa_eixos.js
 *
 * RODADA DE CORREÇÃO 2026-09-10, Bloco 4 — a auditoria funcional
 * (produção real) reproduziu que a peça "Frente/Fundo" da receita 'Caixa'
 * usava o eixo Largura em vez do eixo Altura. Com Comprimento=8, Largura=8,
 * Altura=20 (nomenclatura do usuário: C/L/A — que no código correspondem a
 * L/A/P de PLAN_RECIPES.Caixa, ver planCalc() em index.html: planLarg=L=
 * Comprimento, planAlt=A=Largura, planProf=P=Altura), Frente/Fundo saía
 * 8×8 em vez de 8×20.
 *
 * Regra correta (confirmada com o usuário):
 *   2 Laterais    = Largura × Altura
 *   2 Frente/Fundo = Comprimento × Altura
 *   1 Base        = Comprimento × Largura
 *   1 Tampa       = Comprimento × Largura
 *
 * Extrai PLAN_RECIPES.Caixa AO VIVO de index.html (nunca reimplementado
 * aqui) — falha no código anterior (alt:A-(d) em Frente/Fundo), passa
 * depois da correção (alt:P-(d)).
 *
 * Uso: node scripts/test_correcao_2026-09-10_bloco4_caixa_eixos.js
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

const sandbox = { Math };
vm.createContext(sandbox);
vm.runInContext(extractVarBlock('PLAN_RECIPES'), sandbox);
const Caixa = sandbox.PLAN_RECIPES.Caixa;

console.log('\n=== Bloco 4 — Caixa: peças usam os eixos corretos (C=L código, Largura=A código, Altura=P código) ===\n');

// Caso 1 (reprodução original do usuário): C=8, L(largura)=8, A(altura)=20
// código: L=8 (Comprimento), A=8 (Largura), P=20 (Altura)
(function () {
  const pecas = Caixa.pieces(8, 8, 20, 0.3);
  const byNome = {};
  pecas.forEach(function (p) { byNome[p.nome] = p; });
  assertEq([byNome['Lateral'].larg, byNome['Lateral'].alt], [20, 8], 'Caso 1 (8×8×20): Lateral = Largura×Altura = 8×20 (larg=P,alt=A → 20×8, mesma peça)');
  assertEq([byNome['Frente/Fundo'].larg, byNome['Frente/Fundo'].alt], [8, 20], 'Caso 1 (8×8×20): Frente/Fundo = Comprimento×Altura = 8×20 (BUG: antes saía 8×8)');
  assertEq([byNome['Base'].larg, byNome['Base'].alt], [8, 8], 'Caso 1 (8×8×20): Base = Comprimento×Largura = 8×8');
  assertEq([byNome['Tampa'].larg, byNome['Tampa'].alt], [8, 8], 'Caso 1 (8×8×20): Tampa = Comprimento×Largura = 8×8');
})();

// Caso 2: C=18,5 L(largura)=12,5 A(altura)=14 → código: L=18.5, A=12.5, P=14
(function () {
  const pecas = Caixa.pieces(18.5, 12.5, 14, 0.3);
  const byNome = {};
  pecas.forEach(function (p) { byNome[p.nome] = p; });
  assertEq([byNome['Lateral'].larg, byNome['Lateral'].alt], [14, 12.5], 'Caso 2 (18,5×12,5×14): Lateral = Largura×Altura = 12,5×14');
  assertEq([byNome['Frente/Fundo'].larg, byNome['Frente/Fundo'].alt], [18.5, 14], 'Caso 2 (18,5×12,5×14): Frente/Fundo = Comprimento×Altura = 18,5×14');
  assertEq([byNome['Base'].larg, byNome['Base'].alt], [18.5, 12.5], 'Caso 2 (18,5×12,5×14): Base = Comprimento×Largura = 18,5×12,5');
  assertEq([byNome['Tampa'].larg, byNome['Tampa'].alt], [18.5, 12.5], 'Caso 2 (18,5×12,5×14): Tampa = Comprimento×Largura = 18,5×12,5');
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
