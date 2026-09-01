/**
 * test_rodada_correcao_definitiva_estoque_retalhos_boot_race_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA — bug real de produção: Kanban → Iniciar
 * Produção em SESSÃO NOVA (login fresco, sem cache aquecido) mostrava "Não
 * foi possível carregar o Estoque de chapas" e "Não foi possível carregar
 * os Retalhos", mesmo com o ERP online (não é FORBIDDEN, não é falta de
 * internet).
 *
 * Causa raiz (investigação dedicada, 2026-09-01): ao contrário de
 * _watchStock() (sempre ungated desde o boot), o listener de retalhos
 * (_watchRetalhos()) só era criado dentro do corpo GATED de
 * _cloudLoadAll()/done() — só depois que as 42 leituras de boot
 * terminassem e _cloudReady virasse true. Em sessão nova isso facilmente
 * ultrapassa os 5s de polling do modal de Iniciar Produção — o listener
 * simplesmente ainda não existia quando o modal tentava confirmar.
 *
 * Corrigido chamando _watchRetalhos() ungated, logo após _watchStock() (que
 * já não era gated e nunca reproduziu o bug) — removida a chamada duplicada
 * de dentro de done() (_cloudWatch nunca é idempotente por chave: chamar
 * duas vezes criaria dois onSnapshot vivos na mesma chave).
 *
 * Este teste é estrutural (não extrai/executa a função, que depende
 * pesadamente do SDK real do Firestore) — verifica a ORDEM/UNICIDADE do
 * texto-fonte de index.html, prova objetiva de que:
 *   1. _watchRetalhos() é chamado ANTES do corpo gated de _cloudLoadAll()
 *      (ou seja, ungated, no mesmo ponto do boot que _watchStock()).
 *   2. Existe exatamente UMA chamada de _watchRetalhos() no arquivo inteiro
 *      (nunca duas — nunca dois listeners vivos na mesma chave).
 *   3. A chamada ungated vem logo após _watchStock(), preservando a mesma
 *      pré-condição (_db já pronto) que já provou ser segura em produção.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_estoque_retalhos_boot_race_2026-09-01.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Boot race Estoque/Retalhos (Iniciar Produção) ===\n');

var idxWatchStockCall = html.indexOf('_watchStock();');
var idxCloudLoadAllDef = html.indexOf('function _cloudLoadAll()');
var idxCloudLoadAllDone = html.indexOf('function done()');
var chamadas = [];
var re = /(?<!function )_watchRetalhos\(\);/g;
var m;
while ((m = re.exec(html))) chamadas.push(m.index);

assertTrue(idxWatchStockCall > 0, '0a. (sanity) _watchStock() encontrado no arquivo');
assertTrue(idxCloudLoadAllDef > 0, '0b. (sanity) function _cloudLoadAll() encontrada no arquivo');
assertTrue(idxCloudLoadAllDone > 0, '0c. (sanity) function done() encontrada no arquivo');

assertTrue(chamadas.length === 1, '1. Existe exatamente UMA chamada de _watchRetalhos() no arquivo inteiro (nunca duas — _cloudWatch não é idempotente por chave, duas chamadas criariam dois onSnapshot vivos na mesma chave "retalhos")');

if (chamadas.length >= 1) {
  var idxChamada = chamadas[0];
  assertTrue(idxChamada < idxCloudLoadAllDef, '2. A chamada de _watchRetalhos() está ANTES da definição de _cloudLoadAll() — ou seja, fora (não dentro) do corpo gated por _cloudReady, executa desde o boot sem esperar as 42 leituras terminarem');
  assertTrue(idxChamada > idxWatchStockCall, '3. A chamada de _watchRetalhos() vem DEPOIS de _watchStock() — mesma ordem de boot, reaproveitando a pré-condição já provada estável (_db pronto neste ponto)');
  var distancia = idxChamada - idxWatchStockCall;
  assertTrue(distancia < 2000, '4. A chamada de _watchRetalhos() está logo em seguida de _watchStock() (distância de ' + distancia + ' caracteres) — no mesmo bloco ungated do boot, não espalhada/perdida em outro lugar do arquivo');
}

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
