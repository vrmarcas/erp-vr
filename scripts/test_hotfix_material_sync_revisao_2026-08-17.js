/**
 * test_hotfix_material_sync_revisao_2026-08-17.js
 *
 * HOTFIX OPERACIONAL 2026-08-17 — achado real (rodada de validação
 * operacional, Fluxo 3: Sincronização Orçamento → OS): ao editar um
 * orçamento já aprovado (que já tem OS vinculada), a revisão sincroniza
 * corretamente a MESMA OS (sem criar uma segunda), preserva o snapshot de
 * planificação (peças/espessuras congeladas), registra auditoria completa
 * em revisoesPosProducao/histórico — mas o campo `os.material` (nível OS)
 * ficava CORROMPIDO: em vez de "Acrílico Cristal 3mm + Acrílico Cristal
 * 4mm" (deduplicado por espessura, como o item.mat correto mostra),
 * virava "Acrílico Cristal 3mm + Acrílico Cristal 3mm + Acrílico Cristal
 * 3mm + Acrílico Cristal 4mm" (duplicado).
 *
 * Causa raiz: _orcSincronizarOSVinculada() chamava osItemMateriaisResumo()
 * em cima de um item JÁ PROJETADO por osProjecaoOperacionalItem() (que já
 * havia chamado osItemMateriaisResumo() uma vez internamente e sobrescrito
 * item.mat com a string já unida "3mm + 4mm"). A segunda chamada
 * reprocessava essa string já unida como se fosse o nome base do material
 * (a regex de strip só remove o ÚLTIMO "Xmm", então o "3mm" do meio
 * sobrevive dentro do baseLabel), duplicando o segmento de 3mm uma vez por
 * peça de 3mm encontrada.
 *
 * Corrigido: novoMatLabel agora deriva de orc.itens[0] (o item BRUTO do
 * orçamento, nunca projetado), exatamente como orcEnvGerarOS() já fazia na
 * criação original da OS — uma única chamada a osItemMateriaisResumo(),
 * nunca duas.
 *
 * Estratégia de teste: mesma técnica já estabelecida neste projeto para
 * funções grandes com dependências de estado global (KB_OS) —
 * osItemMateriaisResumo() é extraída do código REAL e EXECUTADA de
 * verdade com fixtures reproduzindo o caso real (4 peças: 3mm, 3mm, 3mm,
 * 4mm). A prova de regressão é: aplicar a função duas vezes em sequência
 * (simulando o bug antigo) produz a string duplicada; aplicá-la uma vez só
 * sobre o item bruto (o novo comportamento) produz a string correta.
 * Também um teste estrutural (regex) confirma que o código real usa
 * `orc.itens[0]`, não `novosItensOS[0]`.
 *
 * Uso: node scripts/test_hotfix_material_sync_revisao_2026-08-17.js
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

console.log('\n=== HOTFIX 2026-08-17 — os.material não duplica espessuras em revisão pós-aprovação ===\n');

// ── 1. _orcSincronizarOSVinculada(): o código real usa orc.itens[0] (item
// bruto), não novosItensOS[0] (item já projetado) — regex sobre código
// extraído ──
{
  var src = extractFn('_orcSincronizarOSVinculada');
  // RODADA 5 — Orçamento comparativo: novoMatLabel passou a derivar de
  // `_itensOrigFiltrados[0]` em vez de `orc.itens[0]` puro — mesmo item
  // BRUTO (pré-projeção, nunca `novosItensOS[0]`), só que agora com o
  // filtro de grupo de opções aplicado ANTES (achado desta rodada: sem o
  // filtro, uma opção não-escolhida na posição 0 vazava para o rótulo de
  // material da OS). A propriedade testada aqui — deriva do item bruto,
  // nunca do já projetado — continua verdadeira.
  ok('1a. novoMatLabel deriva do item BRUTO do orçamento (filtrado por grupo, nunca já projetado)', /osItemMateriaisResumo\(_itensOrigFiltrados\[0\]\)/.test(src));
  ok('1b. novoMatLabel NÃO deriva mais de novosItensOS[0] (item já projetado — causa raiz do bug)', !/osItemMateriaisResumo\(novosItensOS\[0\]\)/.test(src));
  ok('1c. o filtro de grupo de opções (RODADA 5) é aplicado ANTES de extrair o item[0] (nunca uma opção não-escolhida)', /_itensOrigFiltrados\s*=\s*\(orc\.itens \|\| \[\]\)\.filter/.test(src));
}

// ── 2. osItemMateriaisResumo(): extraída e EXECUTADA de verdade — prova
// que aplicar 1x sobre o item bruto é correto, e aplicar 2x (bug antigo)
// duplica ──
{
  var marker = 'function osItemMateriaisResumo(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função osItemMateriaisResumo não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  var fnSrc = html.slice(start, i + 1);
  var osItemMateriaisResumo = eval('(' + fnSrc + ')');

  // Fixture real: item bruto do orçamento, mat = nome+espessura do
  // material selecionado, pieces = peças planificadas (3 em 3mm, 1 em 4mm)
  var itemBruto = {
    mat: 'Acrílico Cristal 4mm',
    pieces: [
      { nome: 'Lateral', esp: 3, espessuraMm: 3 },
      { nome: 'Frente/Fundo', esp: 3, espessuraMm: 3 },
      { nome: 'Base', esp: 3, espessuraMm: 3 },
      { nome: 'Peça 1', esp: '4', espessuraMm: 4 }
    ]
  };

  var resultado1x = osItemMateriaisResumo(itemBruto);
  ok('2a. 1 chamada sobre o item BRUTO produz string deduplicada correta', resultado1x === 'Acrílico Cristal 3mm + Acrílico Cristal 4mm');

  // Simula o comportamento ANTIGO (bug): item já projetado por
  // osProjecaoOperacionalItem (que sobrescreve item.mat com o resultado da
  // 1ª chamada), então aplica a função de novo por cima — mesma sequência
  // exata que _orcSincronizarOSVinculada fazia antes do fix.
  var itemJaProjetado = Object.assign({}, itemBruto, { mat: resultado1x });
  var resultado2x = osItemMateriaisResumo(itemJaProjetado);
  ok('2b. comportamento ANTIGO (2 chamadas em sequência) reproduz a string duplicada do bug real', resultado2x === 'Acrílico Cristal 3mm + Acrílico Cristal 3mm + Acrílico Cristal 3mm + Acrílico Cristal 4mm');
  ok('2c. a 1 chamada (novo comportamento) é diferente/mais curta que as 2 chamadas (bug antigo) — prova que o fix elimina a duplicação', resultado1x !== resultado2x && resultado1x.length < resultado2x.length);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
