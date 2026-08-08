/**
 * test_cloud_ready_never_stuck_2026-08-08.js
 *
 * RODADA 6, seção 0 — achado real, crítico: _cloudReady NUNCA ficava true,
 * em NENHUM ambiente (Emulator ou produção), desde que a chamada
 * `crmBaseLoadIdx(...)` foi introduzida dentro de _cloudLoadAll().
 *
 * Causa raiz (dupla, ambas mascaradas pela mesma regressão de contagem):
 *
 * 1) _cloudLoadAll() tinha um guard `if(typeof crmBaseLoadIdx==='function')
 *    {...} else { _cloudLoad("crm_base_idx", ...) }`. crmBaseLoadIdx é uma
 *    função top-level do MESMO arquivo (hoisted) — está SEMPRE definida
 *    quando _cloudLoadAll roda (setTimeout 800ms após o parse). O ramo
 *    `else` nunca era alcançável em nenhum ambiente, mas seu `done()`
 *    contava para o `total` declarado — exigindo uma finalização a mais
 *    do que era fisicamente possível.
 *
 * 2) O teste de regressão que existia para validar esse `total`
 *    (test_cloud_load_all_counter_2026-08-08.js) contava ocorrências
 *    textuais de `done()` — incluindo a própria declaração
 *    `function done() {`, que também contém a substring "done()". Isso
 *    inflava a contagem "esperada" em +1 e escondia exatamente o tipo de
 *    off-by-one que o teste existe para detectar.
 *
 * Resultado observado (Emulator, usuário master real, sessão limpa):
 *   _cloudReady nunca chegava a `true` — nenhum _cloudWatch (tempo real)
 *   era registrado, e orcSetEnviados() (salvamento de orçamento) recusava
 *   gravar na nuvem (`reason:'nuvem-nao-pronta'`), quebrando o pipeline
 *   inteiro de Produto→Receita→Orçamento→OS na ponta de salvar/gerar OS.
 *
 * Corrigido:
 *   - crmBaseLoadIdx(...) chamado incondicionalmente (guard morto removido).
 *   - `total` recalculado para bater com o nº real de chamadas de done()
 *     alcançáveis em tempo de execução (41).
 *   - test_cloud_load_all_counter_2026-08-08.js corrigido para contar só
 *     `done();` (chamadas), nunca a declaração `function done() {`.
 *
 * Esta suíte prova, a partir do corpo REAL de _cloudLoadAll() (extraído de
 * index.html), que:
 *   1. crmBaseLoadIdx é chamada sem nenhum guard condicional (nunca mais
 *      pode existir um ramo morto irmão que infle o total).
 *   2. Não existe NENHUM outro padrão `if(typeof X==='function'){...
 *      done()...} else {...done()...}` no corpo (a mesma classe de bug,
 *      em qualquer outra função condicionalmente chamada).
 *   3. O `total` declarado bate com o nº de chamadas de done() que o
 *      próprio código consegue emitir somando 1 done() por _cloudLoad()
 *      direto no corpo + 1 done() pela cadeia do crmBaseLoadIdx — nunca
 *      contando a declaração da função.
 *
 * Uso: node scripts/test_cloud_ready_never_stuck_2026-08-08.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractBraceBlock(marker) {
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('marcador não encontrado: ' + marker + ' — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

var body = extractBraceBlock('function _cloudLoadAll(');

console.log('\n=== RODADA 6 — _cloudReady nunca deve ficar preso (achado real) ===\n');

// ── 1. crmBaseLoadIdx chamada sem guard condicional morto ──────────────
test(
  '1. crmBaseLoadIdx é chamada incondicionalmente (sem `if(typeof crmBaseLoadIdx===...)`)',
  /if\s*\(\s*typeof\s+crmBaseLoadIdx/.test(body),
  false
);
test('2. crmBaseLoadIdx(function(){...}) é de fato chamada no corpo', body.indexOf('crmBaseLoadIdx(function(') >= 0, true);

// ── 2. Nenhum outro padrão de guard-morto-com-done-duplicado no corpo ──
// Um "guard morto" nesta função tem a forma: `if(typeof X==='function'){
// ...} else { ... done() ... }` — o ramo else só existe para um X que,
// sendo definido no mesmo arquivo (hoisted), nunca é realmente
// alternativo em tempo de execução. Sinaliza qualquer `else` cujo bloco
// contenha `done()` diretamente (candidato a ramo morto que nunca deveria
// ter seu done() somado ao total).
var elseBlocosComDone = [];
var reElse = /}\s*else\s*{/g;
var m;
while ((m = reElse.exec(body))) {
  var elseStart = m.index + m[0].length;
  var depth = 1, j = elseStart;
  for (; j < body.length && depth > 0; j++) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; }
  var elseBody = body.slice(elseStart, j);
  if (/done\(\)/.test(elseBody)) elseBlocosComDone.push(elseBody.slice(0, 80));
}
test('3. nenhum bloco `else` no corpo chama done() diretamente (candidato a ramo morto)', elseBlocosComDone, []);

// ── 3. `total` declarado bate com o nº real de chamadas de done() ──────
// (mesma proteção de test_cloud_load_all_counter_2026-08-08.js, replicada
// aqui com o MESMO cuidado de nunca contar a declaração `function done()`)
var mTotal = body.match(/var loaded = 0, total = (\d+);/);
if (!mTotal) throw new Error('declaração de `total` não encontrada — teste desatualizado?');
var totalDeclarado = parseInt(mTotal[1], 10);
var chamadasReaisDeDone = (body.match(/done\(\);/g) || []).length;
test('4. `total` declarado bate exatamente com as chamadas reais de done() (nunca a declaração da função)', totalDeclarado, chamadasReaisDeDone);

// ── 4. Nenhuma ocorrência de `done()` sem ponto-e-vírgula imediato exceto a declaração ──
// (garante que a regex de contagem em produção — `done\(\);` — não perde nenhuma chamada real)
var todasOcorrenciasDone = (body.match(/done\(\)/g) || []).length;
test('5. a única ocorrência de `done()` que não é uma chamada (`done();`) é a própria declaração da função', todasOcorrenciasDone - chamadasReaisDeDone, 1);

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
