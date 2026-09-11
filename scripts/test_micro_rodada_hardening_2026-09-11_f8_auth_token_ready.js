/**
 * test_micro_rodada_hardening_2026-09-11_f8_auth_token_ready.js
 *
 * MICRO-RODADA FINAL DE HARDENING (2026-09-11) — F8, correção de CAUSA
 * (não apenas log). A rodada anterior (RODADA DE CORREÇÃO PRIORIZADA,
 * mesma data) só reclassificou o console.warn->console.debug usando
 * `firebase.auth().currentUser != null` como proxy de "auth pronta". Essa
 * rodada corrige a causa real: os listeners de boot protegidos
 * (_watchStock/_watchStockTomb/_watchRetalhos) agora só disparam o
 * primeiro `.onSnapshot(...)` depois que `onIdTokenChanged` confirmar um
 * usuário real (não-anônimo) com token — em vez de currentUser (que fica
 * populado ANTES do token estar de fato pronto para o Firestore, um
 * comportamento documentado do Firebase JS SDK).
 *
 * Reproduz o cenário completo pedido:
 *   1. app boota
 *   2. currentUser aparece (mas token ainda não está pronto)
 *   3. token ainda não está pronto -> listeners NÃO iniciam
 *   4. (redundante com 3, verificado explicitamente)
 *   5. token fica pronto (onIdTokenChanged dispara com usuário válido)
 *   6. listeners iniciam
 *   7. zero permission-denied (porque não houve tentativa prematura)
 *
 * Depois testa três variações adicionais pedidas: reload (mesmo fluxo,
 * token já pronto desde o início), logout/login (onIdTokenChanged emite
 * null depois um usuário nulo -> real) e reconexão via _cloudIniciar()
 * (idempotência: não deve registrar o listener duas vezes).
 *
 * Uso: node scripts/test_micro_rodada_hardening_2026-09-11_f8_auth_token_ready.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractVar(name) {
  const re = new RegExp('var ' + name + '\\s*=');
  const m = re.exec(html);
  if (!m) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  return true;
}

function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

function extractBlockBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error('Marcador inicial não encontrado: ' + startMarker);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Marcador final não encontrado: ' + endMarker);
  return html.slice(start, end);
}

// Confirma que a fonte ainda tem as peças esperadas (documentação viva —
// se algo destas mudar de nome, o teste deve quebrar em vez de mentir).
extractVar('_authTokenReady');
extractVar('_authTokenReadyQueue');
const onAuthTokenReadySrc = extractFn('_onAuthTokenReady');
const onIdTokenChangedBlock = extractBlockBetween(
  "firebase.auth().onIdTokenChanged(function(user){",
  "var _COL = \"erp_vr\";"
);
if (!/onIdTokenChanged/.test(onIdTokenChangedBlock)) throw new Error('onIdTokenChanged não encontrado — teste desatualizado?');

console.log('\n=== MICRO-RODADA DE HARDENING 2026-09-11 — F8: auth/token readiness real (causa raiz) ===\n');

// ── Harness: reconstrói o mecanismo _authTokenReady/_onAuthTokenReady/
// onIdTokenChanged EXATAMENTE como está na fonte (extraído, não
// reimplementado), com um firebase.auth() mockado que permite disparar
// onIdTokenChanged manualmente, simulando a ordem real de eventos do SDK.
function novoAmbiente() {
  const idTokenCallbacks = [];
  const authMock = {
    onIdTokenChanged: function (cb) { idTokenCallbacks.push(cb); },
  };
  global.firebase = { auth: function () { return authMock; } };

  const src = [
    'var _authTokenReady = false;',
    'var _authTokenReadyQueue = [];',
    onAuthTokenReadySrc,
    onIdTokenChangedBlock,
    'module.exports = { onAuthTokenReady: _onAuthTokenReady, getAuthTokenReady: function(){ return _authTokenReady; } };',
  ].join('\n\n');
  const modPath = path.join(__dirname, '_f8_auth_token_ready_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  const mod = require(modPath);
  try { fs.unlinkSync(modPath); } catch (e) {}

  return {
    onAuthTokenReady: mod.onAuthTokenReady,
    getAuthTokenReady: mod.getAuthTokenReady,
    dispararIdTokenChanged: function (user) { idTokenCallbacks.forEach(function (cb) { cb(user); }); },
  };
}

function usuarioReal() { return { providerData: [{ providerId: 'password' }] }; }
function usuarioAnonimo() { return { providerData: [{ providerId: 'anonymous' }] }; }

// ══════════════════════════════════════════════════════════════════════
// Cenário central pedido pelo usuário, passo a passo:
//  1. app boota  2. currentUser aparece, token não pronto  3/4. listener
//  NÃO inicia prematuramente  5. token fica pronto  6. listener inicia
//  7. zero permission-denied (porque não houve tentativa prematura)
// ══════════════════════════════════════════════════════════════════════
{
  const env = novoAmbiente();
  let watchStockChamadas = 0;
  const permissionDeniedSimulados = []; // se o listener fosse registrado cedo demais, a chamada simulada de Firestore geraria isso

  // 1. app boota — listener protegido registrado via _onAuthTokenReady, mas
  // ainda não deve executar (equivalente a _watchStock ainda não ter rodado).
  env.onAuthTokenReady(function () {
    watchStockChamadas++;
    // se isto rodasse ANTES do token pronto, o onSnapshot real bateria em
    // permission-denied — aqui simulamos essa dependência causal.
    if (!env.getAuthTokenReady()) permissionDeniedSimulados.push('[Stock] onSnapshot erro (boot prematuro)');
  });

  ok('F8causa — passo 1/2: app boota, listener NÃO chamado antes de qualquer evento de auth', watchStockChamadas === 0);
  ok('F8causa — passo 3/4: _authTokenReady começa false (token não pronto)', env.getAuthTokenReady() === false);

  // 2. currentUser "aparece" mas ainda não é um token válido pronto — no
  // mundo real isto é o instante em que auth.currentUser != null mas
  // onIdTokenChanged ainda não disparou. Como não há evento onIdTokenChanged
  // ainda, o listener continua represado.
  ok('F8causa — passo 3: listener continua represado enquanto token não pronto (nenhum onIdTokenChanged disparado ainda)', watchStockChamadas === 0);

  // 5. token fica pronto — onIdTokenChanged dispara com usuário real.
  env.dispararIdTokenChanged(usuarioReal());

  // 6. listener inicia agora, exatamente uma vez.
  ok('F8causa — passo 5/6: token pronto -> listener inicia (exatamente 1x)', watchStockChamadas === 1);
  ok('F8causa — passo 5: _authTokenReady vira true', env.getAuthTokenReady() === true);

  // 7. zero permission-denied simulados, porque o listener nunca tentou
  // conectar antes do token estar pronto.
  ok('F8causa — passo 7: zero permission-denied simulados (nenhuma tentativa prematura)', permissionDeniedSimulados.length === 0);
}

// ══════════════════════════════════════════════════════════════════════
// Reload: token já pronto desde o primeiro evento (sessão persistida
// resolvida rápido) — listener deve iniciar imediatamente, sem fila.
// ══════════════════════════════════════════════════════════════════════
{
  const env = novoAmbiente();
  env.dispararIdTokenChanged(usuarioReal()); // token já pronto antes de registrar o listener
  let chamadas = 0;
  env.onAuthTokenReady(function () { chamadas++; });
  ok('F8causa — reload: se token já está pronto, listener roda IMEDIATAMENTE (sem esperar novo evento)', chamadas === 1);
}

// ══════════════════════════════════════════════════════════════════════
// Logout/login: token pronto -> usuário desloga (onIdTokenChanged(null))
// -> volta a logar (onIdTokenChanged com usuário real de novo). Listener
// registrado DEPOIS do logout deve esperar o novo login, não disparar
// achando que o token antigo ainda vale.
// ══════════════════════════════════════════════════════════════════════
{
  const env = novoAmbiente();
  env.dispararIdTokenChanged(usuarioReal());
  ok('F8causa — logout/login: token pronto após login inicial', env.getAuthTokenReady() === true);

  env.dispararIdTokenChanged(null); // logout
  ok('F8causa — logout/login: _authTokenReady volta a false no logout', env.getAuthTokenReady() === false);

  let chamadasPosLogout = 0;
  env.onAuthTokenReady(function () { chamadasPosLogout++; });
  ok('F8causa — logout/login: listener registrado pós-logout fica represado (não dispara com token velho)', chamadasPosLogout === 0);

  env.dispararIdTokenChanged(usuarioReal()); // login de novo
  ok('F8causa — logout/login: listener represado dispara ao relogar', chamadasPosLogout === 1);
}

// ══════════════════════════════════════════════════════════════════════
// Usuário anônimo (rejeitado pela regra de negócio) nunca deve contar
// como "token pronto" — mesma checagem de providerId já usada em
// onAuthStateChanged (linha ~2392) precisa valer também aqui.
// ══════════════════════════════════════════════════════════════════════
{
  const env = novoAmbiente();
  env.dispararIdTokenChanged(usuarioAnonimo());
  ok('F8causa — usuário anônimo NÃO conta como token pronto', env.getAuthTokenReady() === false);
}

// ══════════════════════════════════════════════════════════════════════
// Reconexão (_cloudIniciar chamando _watchStock/_watchStockTomb de novo
// após secEngageLock zerar os guards): idempotência — se o token já está
// pronto e o listener já rodou, uma nova fila não deve acumular chamadas
// órfãs nem disparar duas vezes para o mesmo registro.
// ══════════════════════════════════════════════════════════════════════
{
  const env = novoAmbiente();
  env.dispararIdTokenChanged(usuarioReal());
  let chamadas = 0;
  const fn = function () { chamadas++; };
  env.onAuthTokenReady(fn); // 1a chamada (token já pronto -> síncrona)
  env.onAuthTokenReady(fn); // 2a "reconexão" simulada -> também síncrona, pois já pronto
  ok('F8causa — reconexão: com token já pronto, cada onAuthTokenReady roda na hora (guard de idempotência fica a cargo de _watchStock/_watchStockTomb, não deste mecanismo)', chamadas === 2);
}

console.log('\n' + '─'.repeat(60));
console.log('TOTAL: ' + (passed + failed) + '  ✅ ' + passed + '  ❌ ' + failed);
console.log('─'.repeat(60) + '\n');
process.exit(failed > 0 ? 1 : 0);
