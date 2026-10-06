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
['_orcItemEntraNaOperacao', 'orcComparativoPendente', 'orcTextoValorCliente', 'orcComparativoPendenteDOM', 'orcBloqueioComparativoPendente']
  .forEach(function (n) { if (typeof global[n] !== 'function') vm.runInThisContext(extractFn(n)); });
