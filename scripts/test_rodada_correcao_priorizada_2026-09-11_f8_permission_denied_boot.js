/**
 * test_rodada_correcao_priorizada_2026-09-11_f8_permission_denied_boot.js
 *
 * RODADA DE CORREÇÃO PRIORIZADA (2026-09-11) — F8 (P2), achado da
 * auditoria funcional de produção: console mostrava `permission-denied`
 * recorrente em [Stock]/[Cloud] mesmo para a conta Master.
 *
 * INVESTIGAÇÃO (antes de corrigir, confirmada AO VIVO na sessão real de
 * produção): os listeners de boot (_watchStock()/_watchStockTomb()/
 * _cloudWatch()) são registrados de forma síncrona no carregamento da
 * página, ANTES de onAuthStateChanged confirmar a sessão — nesse
 * instante, sem usuário autenticado ainda, a Rule nega de propósito
 * (comportamento correto), e `_cloudIniciar()` reconecta o mesmo
 * listener poucos milissegundos depois, assim que o auth confirma.
 * Verificado ao vivo: `_STOCK_FORBIDDEN`/`_STOCK_LOAD_ERROR` voltam a
 * `false`, `_cloudReady`/`_cloudIniciou` ficam `true` — nada fica
 * quebrado de fato. É a negação ESPERADA e transitória do boot que já se
 * autocorrige — só o `console.warn` incondicional escondia essa
 * distinção e fazia parecer um erro real e recorrente.
 *
 * FIX (só no LOG — não mexe em Rules nem na lógica de retry/reconexão,
 * já corretas): `_cloudLogPermissionDenied(prefixo, e)` distingue negado
 * SEM usuário logado ainda (esperado — console.debug) de negado COM
 * usuário logado (real — console.warn); qualquer erro que não seja
 * `permission-denied` sempre vira console.warn, independente do auth.
 *
 * Uso: node scripts/test_rodada_correcao_priorizada_2026-09-11_f8_permission_denied_boot.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

const src = [extractFn('_cloudLogPermissionDenied'), 'module.exports = { _cloudLogPermissionDenied: _cloudLogPermissionDenied };'].join('\n\n');
const modPath = path.join(__dirname, '_f8_permission_denied_boot_extracted.tmp.js');
fs.writeFileSync(modPath, src);

console.log('\n=== RODADA DE CORREÇÃO PRIORIZADA 2026-09-11 — F8: log de permission-denied no boot ===\n');

function rodar(opts) {
  const calls = { warn: [], debug: [] };
  global.console = Object.assign({}, console, {
    warn: function () { calls.warn.push(Array.from(arguments)); },
    debug: function () { calls.debug.push(Array.from(arguments)); }
  });
  global.firebase = opts.firebaseDefinido === false ? undefined : { auth: function () { return { currentUser: opts.currentUser || null }; } };
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);
  mod._cloudLogPermissionDenied('[Teste] erro:', opts.erro);
  return calls;
}

// ══════════════════════════════════════════════════════════════════════
// Caso F8 central: permission-denied SEM usuário logado ainda (boot,
// antes de onAuthStateChanged) — esperado, deve ser SILENCIOSO
// (console.debug, nunca console.warn assustando o operador/auditor).
// ══════════════════════════════════════════════════════════════════════
{
  const calls = rodar({ erro: { code: 'permission-denied', message: 'Missing or insufficient permissions.' }, currentUser: null });
  ok('F8 — permission-denied sem usuário logado: NÃO usa console.warn', calls.warn.length === 0);
  ok('F8 — permission-denied sem usuário logado: usa console.debug (visível só quem quer depurar)', calls.debug.length === 1);
}

// ══════════════════════════════════════════════════════════════════════
// permission-denied COM usuário logado (ex.: Master) — isso SIM é
// inesperado/real, precisa continuar visível como warn.
// ══════════════════════════════════════════════════════════════════════
{
  const calls = rodar({ erro: { code: 'permission-denied', message: 'Missing or insufficient permissions.' }, currentUser: { email: 'gabriel@vrmarcas.com' } });
  ok('F8 — permission-denied COM usuário logado (ex.: Master): continua console.warn (alerta real)', calls.warn.length === 1);
  ok('F8 — permission-denied COM usuário logado: não usa console.debug', calls.debug.length === 0);
}

// ══════════════════════════════════════════════════════════════════════
// Erro diferente de permission-denied (ex.: unavailable, rede) — sempre
// warn, independente do estado de auth (nunca escondido).
// ══════════════════════════════════════════════════════════════════════
{
  const calls = rodar({ erro: { code: 'unavailable', message: 'network error' }, currentUser: null });
  ok('F8 — erro não-permission-denied sem usuário logado: continua console.warn', calls.warn.length === 1);
}
{
  const calls = rodar({ erro: { code: 'unavailable', message: 'network error' }, currentUser: { email: 'gabriel@vrmarcas.com' } });
  ok('F8 — erro não-permission-denied com usuário logado: continua console.warn', calls.warn.length === 1);
}

// ══════════════════════════════════════════════════════════════════════
// firebase indisponível (script ainda carregando) — nunca lança exceção,
// trata como "sem usuário logado ainda" (mesmo caminho silencioso).
// ══════════════════════════════════════════════════════════════════════
{
  const calls = rodar({ erro: { code: 'permission-denied' }, firebaseDefinido: false });
  ok('F8 — firebase ainda não definido: não lança exceção, trata como esperado (debug)', calls.debug.length === 1 && calls.warn.length === 0);
}

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '─'.repeat(60));
console.log('TOTAL: ' + (passed + failed) + '  ✅ ' + passed + '  ❌ ' + failed);
console.log('─'.repeat(60) + '\n');
process.exit(failed > 0 ? 1 : 0);
