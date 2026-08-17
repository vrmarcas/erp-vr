/**
 * test_release_verify_prod_2026-08-17.js
 *
 * Prova que o gate de release (scripts/release_verify_prod.js) realmente
 * detecta a classe de falha que motivou sua criação: "push concluído" !=
 * "produção atualizada" (rodada anterior: 96e719c e f8c5ac8 estavam em
 * origin/master, mas o Hosting continha 98a43cd).
 *
 * Testa a lógica pura (compararHashes/hashDeConteudo/urlComCacheBust) sem
 * rede — nenhum deploy real, nenhuma chamada ao Firebase Hosting. Simula os
 * dois cenários que o gate precisa diferenciar corretamente:
 *   (a) produção com o MESMO conteúdo do index.html local -> deve passar;
 *   (b) produção com conteúdo DIFERENTE (deploy ausente/antigo) -> deve
 *       falhar de forma explícita, nunca silenciosa.
 *
 * Uso: node scripts/test_release_verify_prod_2026-08-17.js
 */
'use strict';
const { hashDeConteudo, urlComCacheBust, compararHashes } = require('./release_verify_prod');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

console.log('\n=== Gate de release Hosting — release_verify_prod.js ===\n');

// ── 1. hashDeConteudo: determinístico, sensível a qualquer byte diferente ──
{
  var htmlA = '<!doctype html><html><body>versão A</body></html>';
  var htmlB = '<!doctype html><html><body>versão B</body></html>';
  ok('1a. mesmo conteúdo produz o mesmo hash', hashDeConteudo(htmlA) === hashDeConteudo(htmlA));
  ok('1b. conteúdo diferente produz hash diferente', hashDeConteudo(htmlA) !== hashDeConteudo(htmlB));
}

// ── 2. urlComCacheBust: sempre acrescenta um parâmetro variável, nunca lê cache ──
{
  ok('2a. adiciona "?" quando a URL base não tem query string', urlComCacheBust('https://erp-vrmarcas.web.app', 111).indexOf('?_release_check=111') > 0);
  ok('2b. adiciona "&" quando a URL base já tem query string', urlComCacheBust('https://x/y?a=1', 222).indexOf('&_release_check=222') > 0);
  ok('2c. timestamps diferentes geram URLs diferentes (nunca reaproveita cache)', urlComCacheBust('https://x', 1) !== urlComCacheBust('https://x', 2));
}

// ── 3. compararHashes: o coração do gate — é isto que decide PASS/FAIL ──
{
  var htmlLocal = '<!doctype html><html><body>commit atual</body></html>';
  var hashLocal = hashDeConteudo(htmlLocal);

  // Cenário PASS: produção serve exatamente o mesmo commit
  var respostaOkIgual = { ok: true, corpo: htmlLocal };
  var resultadoIgual = compararHashes(hashLocal, respostaOkIgual);
  ok('3a. produção com conteúdo IDÊNTICO ao local -> ok:true', resultadoIgual.ok === true);
  ok('3b. resultado ok:true reporta motivo HASH_CONFERE', resultadoIgual.motivo === 'HASH_CONFERE');

  // Cenário FAIL real — reproduz o incidente: produção serve um HTML válido,
  // mas de um commit ANTIGO (bytes diferentes do local)
  var htmlProducaoAntiga = '<!doctype html><html><body>commit antigo (98a43cd)</body></html>';
  var respostaOkDiferente = { ok: true, corpo: htmlProducaoAntiga };
  var resultadoDivergente = compararHashes(hashLocal, respostaOkDiferente);
  ok('3c. produção com conteúdo DIFERENTE do local -> ok:false (detecta deploy ausente/antigo)', resultadoDivergente.ok === false);
  ok('3d. resultado ok:false reporta motivo HASH_DIVERGENTE', resultadoDivergente.motivo === 'HASH_DIVERGENTE');
  ok('3e. detalhe do erro inclui os dois hashes para diagnóstico', /hash local .+ != hash produção/.test(resultadoDivergente.detalhe));

  // Cenário FAIL — falha de rede/fetch (produção fora do ar, timeout, DNS etc.)
  var respostaFalhouRede = { ok: false, detalhe: 'ECONNREFUSED' };
  var resultadoRede = compararHashes(hashLocal, respostaFalhouRede);
  ok('3f. falha de rede/fetch -> ok:false, nunca interpretado como sucesso silencioso', resultadoRede.ok === false);
  ok('3g. resultado de falha de rede reporta motivo FETCH_FALHOU', resultadoRede.motivo === 'FETCH_FALHOU');

  // Cenário FAIL — resposta HTTP 200 mas conteúdo não é HTML de verdade
  // (ex.: página de erro do Hosting, placeholder, JSON de erro)
  var respostaConteudoInvalido = { ok: true, corpo: '{"error":"not found"}' };
  var resultadoInvalido = compararHashes(hashLocal, respostaConteudoInvalido);
  ok('3h. corpo que não parece HTML -> ok:false (não compara hash de lixo)', resultadoInvalido.ok === false);
  ok('3i. resultado de conteúdo inválido reporta motivo CONTEUDO_INVALIDO', resultadoInvalido.motivo === 'CONTEUDO_INVALIDO');

  // Cenário sem resposta nenhuma (undefined) — defensivo
  var resultadoSemResposta = compararHashes(hashLocal, null);
  ok('3j. resposta nula/ausente -> ok:false, não lança exceção', resultadoSemResposta.ok === false);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
