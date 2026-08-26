/**
 * test_rodada_critica_fornecedores_seed_2026-08-26.js
 *
 * RODADA CRÍTICA DE ESTABILIZAÇÃO DE LEITURA — achado EXTRA de P0 (fora do
 * bloqueador original Kanban/Iniciar Produção, corrigido por se enquadrar
 * na exceção explícita da rodada: "P0 com risco imediato de perda/
 * corrupção de dados").
 *
 * ACHADO: fornSeedDemo() (chamada toda vez que a tela "Fornecedores" é
 * aberta, index.html) gravava 3 fornecedores FICTÍCIOS ("Geoplas
 * Acrílicos", "Vallim Distribuidora", "Central Click Impressão", com
 * CNPJ/telefone/histórico de compra inventados) diretamente no Firestore
 * de PRODUÇÃO sempre que _FORN_DATA.length===0 no instante do clique —
 * sem checar se o servidor já tinha respondido. Isso é EXATAMENTE a mesma
 * classe de bug corrigida nesta rodada para Estoque/Retalhos (decidir
 * "vazio" a partir de um estado ainda não confirmado pelo servidor), mas
 * aqui a consequência é mais grave: GRAVAÇÃO real de dado fictício
 * indistinguível de um fornecedor real, não só uma tela vazia. Uma sessão
 * recém-aberta navegando rápido para Fornecedores (mesmo padrão de
 * reprodução do bug P0 original) podia poluir permanentemente a base real
 * de um cliente com fornecedores que nunca existiram.
 *
 * Corrigido fazendo fornSeedDemo() nunca decidir "vazio" antes de
 * _cloudReady (sinal já existente e confiável de "todas as cargas
 * iniciais, inclusive erp_fornecedores, já responderam do servidor") —
 * nunca inventa dado a partir de estado ainda não confirmado.
 *
 * Função sob teste extraída de index.html (nunca reimplementada):
 * fornSeedDemo, fornLoad, fornSaveAll.
 *
 * Uso: node "scripts/test_rodada_critica_fornecedores_seed_2026-08-26.js"
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

console.log('\n=== RODADA CRÍTICA — fornSeedDemo() não pode mais gravar dado fictício antes do servidor confirmar ===\n');

var FN_NAMES = ['fornSeedDemo', 'fornLoad', 'fornSaveAll'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_rodada_critica_fornecedores.tmp.js');
fs.writeFileSync(modPath, src);

var _saved;
function reset(cloudReady) {
  global._FORN_DATA = [];
  global._cloudReady = cloudReady;
  _saved = null;
  global._cloudSave = function (key, arr) { _saved = { key: key, arr: arr }; return Promise.resolve(); };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-2 — ACHADO REAL: _cloudReady ainda false (dados de erp_fornecedores
// ainda não confirmados pelo servidor — mesma corrida do bug P0 original)
// → NUNCA grava fornecedor fictício, mesmo com _FORN_DATA vazio no
// instante da chamada.
reset(false);
mod.fornSeedDemo();
assertTrue(_saved === null, '1. ACHADO REAL: _cloudReady=false (ainda não confirmado pelo servidor) — fornSeedDemo() NUNCA grava fornecedores fictícios em produção, mesmo com a lista vazia em memória');
assertTrue(global._FORN_DATA.length === 0, '2. _FORN_DATA permanece vazio (nunca populado com dado inventado) enquanto o servidor não confirmou');

// 3-4 — só depois de _cloudReady=true (servidor confirmou) e a lista
// REALMENTE vazia, o seed de demonstração é permitido (comportamento
// original preservado para conta genuinamente nova).
reset(true);
mod.fornSeedDemo();
assertTrue(_saved !== null && _saved.key === 'erp_fornecedores' && _saved.arr.length === 3, '3. Comportamento original preservado: com o servidor já confirmado E a lista genuinamente vazia, o seed de demonstração continua funcionando para onboarding');
assertTrue(_saved.arr.every(function (f) { return f.id && f.nome; }), '4. Registros de demonstração continuam com o mesmo formato de sempre (nenhuma mudança de schema)');

// 5 — dados reais já presentes (mesmo com _cloudReady=false) nunca são
// sobrescritos pelo seed — regra "não inventar quando já existe dado
// real" preservada.
reset(false);
global._FORN_DATA = [{ id: 'forn_real_1', nome: 'Fornecedor Real Ltda' }];
mod.fornSeedDemo();
assertTrue(_saved === null, '5. Fornecedor real já carregado: fornSeedDemo() nunca tenta sobrescrever/duplicar, com ou sem _cloudReady');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
