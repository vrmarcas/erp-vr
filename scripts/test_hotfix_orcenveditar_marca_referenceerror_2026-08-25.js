/**
 * test_hotfix_orcenveditar_marca_referenceerror_2026-08-25.js
 *
 * HOTFIX CRÍTICO — orçamento zera ao passar de APROVAÇÃO para PAGAMENTO.
 *
 * ACHADO REAL EM PRODUÇÃO (reprodução ao vivo — nunca só auditoria
 * estática): reabrir o orçamento real ORC-000061 (Juliana Caetano, marca
 * "vitre", status "aprovado") pela tela de pagamento, com a marca ativa
 * na UI em "vr" (estado inicial padrão do dashboard), lançava:
 *
 *   ReferenceError: orcToggleMarca is not defined
 *     at orcEnvEditar (index.html:27877ish)
 *
 * orcEnvEditar() chamava orcToggleMarca() para sincronizar a marca
 * VR/Vitre da tela com a marca do orçamento sendo reaberto — mas essa
 * função NUNCA foi definida em lugar nenhum do arquivo (grep confirma
 * zero declarações). Isso lançava direto no catch(_eHidratacao) do
 * Bloco A (Rodada de Estabilização, 2026-08-23) — ANTES do loop que
 * restaura os itens (o.itens.forEach(...) vem logo depois no código) —
 * exatamente o sintoma relatado: cliente aparece (setV('orcClientNome')
 * roda ANTES da marca), mas itens somem, e o toast "Este orçamento não
 * pôde ser restaurado completamente" dispara. Reproduz para QUALQUER
 * orçamento cuja marca (o.marca) seja diferente da marca ativa no body
 * (document.body.classList.contains('vitre')) no momento da reabertura —
 * cenário comum (equipe trocou de marca na tela, ou a página recarregou e
 * voltou para o padrão VR).
 *
 * Corrigido substituindo a chamada inexistente pela função real e já
 * existente setBrand(brand) (index.html, "Brand switcher") — determinística
 * (recebe a marca alvo explicitamente) e idempotente (nunca depende de
 * adivinhar/alternar o estado atual como um "toggle").
 *
 * Este teste é uma asserção estrutural (regex sobre o código-fonte real
 * de index.html, nunca reimplementado) — orcEnvEditar() depende de tanto
 * DOM/estado global que reproduzir seu comportamento completo em Node
 * exigiria remockar o wizard inteiro; a prova comportamental real foi
 * feita por reprodução ao vivo em produção (ver relatório). O que este
 * teste garante de forma barata e permanente: a chamada quebrada nunca
 * volta a existir, e o guard usa a função real setBrand().
 *
 * Uso: node "scripts/test_hotfix_orcenveditar_marca_referenceerror_2026-08-25.js"
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

console.log('\n=== HOTFIX CRÍTICO — orcToggleMarca() inexistente (ReferenceError real em produção) ===\n');

// Remove linhas de comentário (// ...) antes de procurar CHAMADAS reais —
// este próprio arquivo de teste e os comentários históricos do hotfix
// mencionam "orcToggleMarca(" em prosa explicativa; só código executável
// importa aqui.
function semComentariosDeLinha(src) {
  return src.split('\n').map(function(l){ return l.replace(/\/\/.*$/, ''); }).join('\n');
}
var htmlSemComentarios = semComentariosDeLinha(html);

// 1 — a função quebrada (nunca definida em lugar nenhum) nunca mais é
// CHAMADA em nenhum ponto EXECUTÁVEL do arquivo.
var chamadasReais = (htmlSemComentarios.match(/[^./]orcToggleMarca\s*\(/g) || []);
assertTrue(chamadasReais.length === 0, '1. orcToggleMarca() — função que nunca existiu — não é mais chamada em nenhum ponto executável de index.html (ReferenceError real eliminado)');

// 2 — setBrand (a função real e existente) continua definida.
assertTrue(html.indexOf('function setBrand(') >= 0, '2. setBrand() — função real usada como substituta — continua definida');

// 3 — orcEnvEditar() agora sincroniza a marca via setBrand(), nunca via
// toggle inexistente.
var srcEditar = extractFn('orcEnvEditar');
var srcEditarSemComentarios = semComentariosDeLinha(srcEditar);
assertTrue(/setBrand\s*\(\s*o\.marca===['"]vr['"]\s*\?\s*['"]vr['"]\s*:\s*['"]vitre['"]\s*\)/.test(srcEditarSemComentarios), '3. orcEnvEditar() sincroniza a marca da tela com a marca do orçamento via setBrand() (determinística, nunca um toggle que depende do estado atual)');
assertTrue((srcEditarSemComentarios.match(/[^./]orcToggleMarca\s*\(/g) || []).length === 0, '4. orcEnvEditar() não CHAMA mais orcToggleMarca em nenhum ponto executável');

// 5 — setBrand() é chamado com guard typeof (mesma disciplina defensiva
// já usada no resto da função — nunca quebra a hidratação se, por algum
// motivo futuro, a função não estiver disponível).
assertTrue(/typeof setBrand===['"]function['"]/.test(srcEditar), '5. Chamada a setBrand() protegida por guard typeof (mesmo padrão defensivo do resto de orcEnvEditar)');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
