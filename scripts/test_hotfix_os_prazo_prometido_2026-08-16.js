/**
 * test_hotfix_os_prazo_prometido_2026-08-16.js
 *
 * HOTFIX OPERACIONAL 2026-08-16 (P0.8-P0.9) — achado real (auditoria
 * estática de index.html): ao gerar a OS, `os.prazo`/`os.entrega` eram
 * gravados como a data de HOJE (a mesma variável `dia` usada como data de
 * criação da OS) — nunca havia relação com o prazo (dias úteis) realmente
 * prometido ao cliente no orçamento. `o.prazoDias`/`o.prazoDiasMax`
 * (persistidos no orçamento) não eram lidos em NENHUM lugar dentro de
 * orcEnvGerarOS(). Confirmado via grep: nenhum teste pré-existente cobria
 * essa propagação orçamento → OS.
 *
 * Corrigido:
 *  - orçamento salvo passa a congelar `prazoTextoPromessa` ("De X a Y dias
 *    úteis"), computado UMA vez no momento do save — nunca recalculado
 *    depois, mesmo que a configuração de prazo mude.
 *  - orcEnvGerarOS() calcula `diaSugerido` (dias úteis a partir de HOJE,
 *    dia da geração da OS) e grava em os.prazo/os.entrega — só uma
 *    sugestão operacional inicial, continua editável depois (drag-and-drop
 *    no Kanban / kbSalvarPrazo(), nenhum dos dois foi tocado).
 *  - os.prazoPrometidoTexto grava o texto histórico congelado, nunca
 *    sobrescrito pelas edições operacionais acima.
 *
 * Estratégia de teste: como orcEnvGerarOS() é uma função enorme com
 * dependências de Firestore/transação (padrão já usado em
 * scripts/test_hotfix_p0_3_valor_efetivo_pagamento_2026-08-12.js para essa
 * MESMA função), a verificação estrutural é feita por asserção regex sobre
 * o código REAL extraído (nunca reimplementado) — mesma técnica já
 * estabelecida neste projeto para esta função específica. A lógica pura do
 * texto congelado (prazoTextoPromessa) é extraída e executada de verdade.
 *
 * Uso: node scripts/test_hotfix_os_prazo_prometido_2026-08-16.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

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

console.log('\n=== HOTFIX 2026-08-16 (P0.8-P0.9) — prazo prometido preservado + data sugerida em dias úteis ===\n');

// ── 1. orcEnvGerarOS(): estrutura real do fix (regex sobre código extraído) ──
{
  var gerarOSSrc = extractFn('orcEnvGerarOS');

  ok('1a. o bug original (prazo:dia,entrega:dia — igual à data de criação) NÃO existe mais', !/prazo:dia,entrega:dia/.test(gerarOSSrc));
  ok('1b. os.prazo/os.entrega agora usam diaSugerido (data calculada, não a data de hoje)', /prazo:diaSugerido,entrega:diaSugerido/.test(gerarOSSrc));
  ok('1c. diaSugerido é derivado de o.prazoDias/o.prazoDiasMax (o prazo REALMENTE salvo no orçamento)', /_prazoDiasOS\s*=\s*parseInt\(o\.prazoDias/.test(gerarOSSrc) && /_prazoDiasMaxOS\s*=\s*parseInt\(o\.prazoDiasMax/.test(gerarOSSrc));
  ok('1d. o cálculo pula sábado/domingo (dias úteis de verdade, não corridos)', /_dwSug!==0 && _dwSug!==6/.test(gerarOSSrc));
  ok('1e. prazoPrometidoTexto é gravado nos DOIS pontos de escrita da OS (local e transacional)', (gerarOSSrc.match(/prazoPrometidoTexto:prazoPrometidoTextoOS/g) || []).length === 2);
  ok('1f. prazoPrometidoTexto vem de o.prazoTextoPromessa (o texto histórico já congelado no orçamento) — nunca recalculado aqui dentro de orcEnvGerarOS', /prazoPrometidoTextoOS\s*=\s*o\.prazoTextoPromessa/.test(gerarOSSrc));
  ok('1g. sem prazo salvo no orçamento (prazoDias<=0), a data sugerida cai no fallback de sempre (dia = hoje) — nunca quebra', /if\(_prazoDiasOS > 0\)/.test(gerarOSSrc));
}

// ── 2. Congelamento do prazoTextoPromessa no momento do SAVE do orçamento
// (a IIFE que gera "De X a Y dias úteis") — extraída e EXECUTADA de
// verdade com um DOM fake, não só regex. ──
{
  function makeEl(v) { return { value: v }; }
  function computarPrazoTextoPromessa(dias, diasMax) {
    global.document = { getElementById: function (id) {
      if (id === 'orcPrazoDias') return makeEl(String(dias));
      if (id === 'orcPrazoDiasMax') return makeEl(String(diasMax));
      return null;
    } };
    // mesma expressão literal gravada no objeto do orçamento (index.html,
    // bloco "prazoTextoPromessa:" logo após "prazoDiasMax:") — extraída
    // por marcador exato para nunca divergir do código real.
    var marker = 'prazoTextoPromessa: (function(){';
    var start = html.indexOf(marker);
    if (start < 0) throw new Error('Bloco prazoTextoPromessa não encontrado — teste desatualizado?');
    var iifeStart = html.indexOf('(function(){', start);
    var braceOpen = html.indexOf('{', iifeStart + 11);
    var depth = 0, i = braceOpen;
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
    var iifeSrc = html.slice(iifeStart, i + 1) + ')()';
    return eval(iifeSrc);
  }

  ok('2a. "De 5 a 7 dias úteis" (faixa com mínimo e máximo diferentes)', computarPrazoTextoPromessa(5, 7) === 'De 5 a 7 dias úteis');
  ok('2b. "3 dias úteis" (mínimo = máximo, plural)', computarPrazoTextoPromessa(3, 3) === '3 dias úteis');
  ok('2c. "1 dia útil" (singular)', computarPrazoTextoPromessa(1, 1) === '1 dia útil');
  ok('2d. sem prazo definido (dias=0) → string vazia, nunca "De 0 a 0"', computarPrazoTextoPromessa(0, 0) === '');
  ok('2e. diasMax vazio/menor que dias cai no formato singular (usa só "dias")', computarPrazoTextoPromessa(5, 0) === '5 dias úteis');
}

// ── 3. Exibição na OS (kbOpen): prazo prometido aparece separado da data
// sugerida/definida, sem sobrescrever uma a outra ──
{
  ok('3. label "Prazo enviado ao cliente" só aparece quando existe os.prazoPrometidoTexto (nunca inventa histórico para OS sem esse campo)', /os\.prazoPrometidoTexto \? '<div class="kb-os-field">.*Prazo enviado ao cliente/.test(html));
  ok('3b. o campo de data (Entrega) muda o rótulo para "Data sugerida\\/definida" quando há prazo prometido, mas continua mostrando o MESMO valor editável de sempre (_entrega)', /os\.prazoPrometidoTexto\?'Data sugerida\/definida':'Entrega'/.test(html));
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
