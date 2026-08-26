/**
 * test_hardening_fase2_blocop_compras_v1_morto_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, BLOCO P (2026-08-26) — auditoria
 * Compras v1 × v2, decisão arquitetural.
 *
 * INVESTIGAÇÃO (não suposição, leitura direta de index.html): uma rodada
 * anterior (RODADA FINAL, 2026-08-06) já tornou `_COMPRAS_V2_OFICIAL`
 * incondicional (`= true`, independente de _HOMOLOG_MODE/ambiente). Os 5
 * pontos de entrada de escrita do fluxo legado (criar solicitação — manual
 * e a partir de OS —, avançar status, cancelar, receber, adicionar
 * documento) e o único ponto de leitura visível (comprasRender) checam
 * essa flag PRIMEIRO e retornam antes de qualquer código v1 — o array
 * legado `COMPRAS`/`erp_vr/compras` é estruturalmente inalcançável por
 * qualquer caminho ativo, em qualquer ambiente, incluindo produção real
 * (confirmado ao vivo: COMPRAS tem 0 registros em produção hoje, nenhum
 * dado histórico real ali).
 *
 * DECISÃO (C — v1 está morto): nenhuma migração de dado necessária (não
 * há dado real para migrar). "Impedir uso operacional, sem apagar dados":
 * já estava estruturalmente impedido pela flag — não foi criada nenhuma
 * barreira nova, só corrigidos 2 comentários DESATUALIZADOS que ainda
 * diziam "v1 continua ativo fora de homologação" (não é mais verdade
 * desde a RODADA FINAL) e removida uma declaração duplicada (copy-paste)
 * da própria flag — nenhuma mudança de comportamento, só higiene de
 * código/documentação.
 *
 * Esta suíte trava a decisão como regressão: se qualquer um dos 5 pontos
 * de entrada de escrita ou o ponto de leitura perder o guard-primeiro por
 * `_COMPRAS_V2_OFICIAL`, ou se a flag deixar de ser incondicional, o teste
 * falha — nunca mais um módulo pode voltar a misturar v1/v2 silenciosamente
 * sem que isso seja notado.
 *
 * Uso: node "scripts/test_hardening_fase2_blocop_compras_v1_morto_2026-08-26.js"
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
// Extrai o corpo do PRIMEIRO `if(_COMPRAS_V2_OFICIAL){...}`/`if(_COMPRAS_V2_OFICIAL)
// return ...;` dentro de uma função — usado para provar que o guard vem
// ANTES de qualquer código v1 (nunca depois, nunca ausente).
function primeiraLinhaEhGuardV2(fnBody) {
  var semComentarios = fnBody.split('\n').filter(function (l) { return !/^\s*\/\//.test(l.trim()); }).join('\n');
  var idx = semComentarios.indexOf('{', semComentarios.indexOf('{') + 1); // pula a chave de abertura da própria função
  var corpo = semComentarios.slice(semComentarios.indexOf('{') + 1).trim();
  // pula guards triviais de reentrância (if(_comprasXxx[id]){...return...}) que vêm antes por boa razão
  var linhas = corpo.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  for (var i = 0; i < linhas.length; i++) {
    if (/^if\s*\(\s*_COMPRAS_V2_OFICIAL\s*\)/.test(linhas[i])) return true;
    // uma linha que já mexe em COMPRAS (v1) ou salva antes do guard aparecer = achado real
    if (/\bCOMPRAS\.(unshift|find|some)\(/.test(linhas[i]) || /comprasSave\(\)/.test(linhas[i])) return false;
  }
  return false;
}

console.log('\n=== HARDENING FASE 2, BLOCO P — Compras v1 estruturalmente morto, v2 única arquitetura ativa ===\n');

// ── 1 — a flag é incondicional (nunca amarrada a _HOMOLOG_MODE/ambiente) ──
var mFlag = html.match(/var _COMPRAS_V2_OFICIAL = (true|false|_HOMOLOG_MODE)\s*;/);
assertTrue(!!mFlag && mFlag[1] === 'true', '1. _COMPRAS_V2_OFICIAL é declarada como `true` incondicional — nunca amarrada a _HOMOLOG_MODE/ambiente (produção usa a mesma arquitetura que homologação)');

// ── 2 — a declaração não está mais duplicada (achado real corrigido) ──────
var ocorrenciasDeclaracao = (html.match(/var _COMPRAS_V2_OFICIAL = true;/g) || []).length;
assertTrue(ocorrenciasDeclaracao === 1, '2. ACHADO REAL corrigido: a declaração de _COMPRAS_V2_OFICIAL não está mais duplicada (era copy-paste, comentário idêntico repetido duas vezes) — agora só 1 ocorrência');

// ── 3-8 — cada um dos 5 pontos de entrada de escrita + o ponto de leitura
// checa _COMPRAS_V2_OFICIAL ANTES de qualquer código v1 (COMPRAS.unshift/
// comprasSave/COMPRAS.find) — nunca depois, nunca ausente. ────────────────
var corpoAvancar = extractFn('comprasAvancarStatus');
assertTrue(/^\s*if\s*\(_COMPRAS_V2_OFICIAL\)\s*return\s*comprasV2AvancarStatus\(id\);/m.test(corpoAvancar), '3. comprasAvancarStatus(): guard por _COMPRAS_V2_OFICIAL é a primeira linha executável — nunca alcança COMPRAS (v1)');

var corpoCancelar = extractFn('comprasCancelar');
assertTrue(primeiraLinhaEhGuardV2(corpoCancelar), '4. comprasCancelar(): guard por _COMPRAS_V2_OFICIAL vem antes de qualquer leitura/escrita em COMPRAS (v1)');

var corpoReceber = extractFn('comprasReceberModal');
assertTrue(primeiraLinhaEhGuardV2(corpoReceber), '5. comprasReceberModal(): guard por _COMPRAS_V2_OFICIAL vem antes de qualquer leitura/escrita em COMPRAS (v1)');

var corpoDocumento = extractFn('comprasAdicionarDocumento');
assertTrue(primeiraLinhaEhGuardV2(corpoDocumento), '6. comprasAdicionarDocumento(): guard por _COMPRAS_V2_OFICIAL vem antes de qualquer leitura/escrita em COMPRAS (v1)');

var corpoSolicitarDeOS = extractFn('comprasSolicitarDeOS');
assertTrue(primeiraLinhaEhGuardV2(corpoSolicitarDeOS), '7. comprasSolicitarDeOS() (criação automática a partir de OS): guard por _COMPRAS_V2_OFICIAL vem antes de COMPRAS.unshift/comprasSave — nenhuma solicitação nova pode nascer no array legado');

var corpoRender = extractFn('comprasRender');
assertTrue(/^\s*if\s*\(_COMPRAS_V2_OFICIAL\)\s*return\s*comprasV2Render\(\);/m.test(corpoRender), '8. comprasRender(): redireciona para comprasV2Render() como primeira linha — o código de renderização de COMPRAS (v1) abaixo é inalcançável, nenhum usuário jamais vê dado do array legado');

// ── 9 — guard de comprasV2RequerHomolog() checa a mesma flag oficial,
// nunca uma flag de ambiente separada que pudesse divergir. ───────────────
var corpoRequerHomolog = extractFn('comprasV2RequerHomolog');
assertTrue(/if\s*\(\s*!_COMPRAS_V2_OFICIAL\s*\)/.test(corpoRequerHomolog), '9. comprasV2RequerHomolog() usa a MESMA flag (_COMPRAS_V2_OFICIAL) que todo o resto — nenhuma segunda fonte de verdade sobre qual arquitetura está ativa');

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
