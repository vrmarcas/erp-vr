/**
 * _comparativo_shim.js — helpers puros do comparativo (Bloco C/D, 2026-10-06)
 * carregados como globais para os harnesses que extraem funções do
 * index.html. No navegador esses helpers já são globais do index.html; aqui
 * só evitam que um harness antigo quebre por ReferenceError ao chamar
 * orcColetarItensDistribuidos/orcEnvGerarOS/orcRegistrarSituacaoFinanceira.
 * Não altera nenhuma expectativa de teste.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('shim: função ' + name + ' não encontrada');
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractVarDecl(name) {
  const marker = 'var ' + name + ' = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('shim: variável ' + name + ' não encontrada');
  let depth = 0, i = start + marker.length, end = -1;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error('shim: fim de ' + name + ' não encontrado');
  return html.slice(start, end + 1);
}
vm.runInThisContext('var ORC_REGRA_COMPARATIVO_ATUAL = 2;');
['_orcItemEntraNaOperacao', 'orcComparativoPendente', 'orcTextoValorCliente', 'orcComparativoPendenteDOM', 'orcBloqueioComparativoPendente', 'orcRegistroComparativoPendente', '_orcEntraNaOperacaoDoRegistro', 'orcPecasHerdarEspessura', 'orcSincronizarEspPecasHerdadas', 'orcPctBR']
  .forEach(function (n) { if (typeof global[n] !== 'function') vm.runInThisContext(extractFn(n)); });
// RODADA CIRÚRGICA 2026-10-13, Bloco C — orcRecalc() passou a depender de
// ORC_MAQ_OPS/cfgMaqOperInfo()/_orcMaqInfo() (Config→Máquinas canônica, ver
// index.html) em vez de taxas hardcoded. Harness antigo que extrai só
// orcRecalc (sem essas 3 entradas) quebrava por ReferenceError — mesmo
// papel desta shim para os outros helpers acima. Um harness cujo próprio
// cfgLoad() stub não tiver `maquinas`/`maquinasOperacoes` simplesmente
// nunca vincula nenhuma operação (comportamento real e intencional: sem
// vínculo, custo de máquina = R$0,00 — nunca um hardcode oculto), o que é
// correto mesmo em testes antigos que não passavam om_laser/om_dobra etc.
if (typeof global.ORC_MAQ_OPS === 'undefined') vm.runInThisContext(extractVarDecl('ORC_MAQ_OPS'));
['cfgMaqOperInfo', '_orcMaqInfo'].forEach(function (n) { if (typeof global[n] !== 'function') vm.runInThisContext(extractFn(n)); });
// RODADA CIRÚRGICA 2026-10-28 — máquina/tempo por item/operação (nunca
// mais um único campo global do pedido — ver ORC_ITEM_MAQUINAS em
// index.html). orcRecalc() passou a depender de _itemMaqInfo()
// (que por sua vez depende de _maqInfoPorMaquinaId() e do mapa
// ORC_ITEM_MAQUINAS) — mesmo papel desta shim para as outras 3 entradas
// acima: harness antigo que extrai só orcRecalc (sem essas 3) quebrava por
// ReferenceError. Harness cujo próprio ORC_ITEM_MAQUINAS[idx] nunca é
// populado simplesmente nunca tem máquina vinculada por item (custo
// R$0,00 — mesmo comportamento real e intencional de cfgMaqOperInfo acima,
// nunca um hardcode oculto).
if (typeof global.ORC_ITEM_MAQUINAS === 'undefined') vm.runInThisContext('var ORC_ITEM_MAQUINAS = {};');
['_maqInfoPorMaquinaId', '_itemMaqInfo'].forEach(function (n) { if (typeof global[n] !== 'function') vm.runInThisContext(extractFn(n)); });
