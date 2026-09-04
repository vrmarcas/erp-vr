/**
 * test_estabilizacao_bloco7_onboarding_usuarios_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 7 — onboarding de usuários
 * quebrado ("criar usuário → e-mail demorou → usuário definiu senha →
 * ERP disse que não tinha acesso").
 *
 * Investigação encontrou DUAS causas raiz reais:
 *
 * (1) A UI de criação (usrSalvar(), modo criação) nunca chamava a Cloud
 * Function `adminCreateUser` (que já existe com transação/rollback
 * corretos — Auth+claim+perfil canônico revertidos se qualquer etapa
 * falhar). Em vez disso criava a conta via
 * `createUserWithEmailAndPassword` client-side (senha JÁ VÁLIDA nesse
 * instante) e só DEPOIS chamava `adminUpdateUserRole` para gravar
 * `erp_vr_usuarios/{uid}` — o documento que authLogin() exige para
 * conceder acesso. Falha nessa segunda chamada (ou o usuário logando
 * na janela entre as duas) deixava uma conta que autentica mas o ERP
 * rejeita, SEM NENHUM ROLLBACK — reproduz exatamente o sintoma
 * relatado.
 *
 * (2) authLogin() tinha um catch mudo na leitura de
 * `erp_vr_usuarios/{uid}`: QUALQUER falha (rede, permission-denied,
 * timeout, ou a janela de corrida acima) virava `users:[]`, disparando
 * a MESMA mensagem "Conta sem perfil atribuído" de um perfil
 * genuinamente inexistente — impossível diagnosticar em campo, e
 * problemas transitórios eram tratados como definitivos.
 *
 * Corrigido: usrSalvar() (criação) passa a chamar adminCreateUser
 * (única fonte, atômica) e dispara o e-mail de definição de senha
 * (sendPasswordResetEmail, mesmo mecanismo do botão "🔑 Senha")
 * imediatamente após — nunca mais senha digitada pelo master.
 * authLogin() ganhou _authLerPerfilComRetry() (cobre a janela de
 * corrida residual) e distingue "falha de leitura" de "perfil ausente"
 * na mensagem exibida.
 *
 * Uso: node scripts/test_estabilizacao_bloco7_onboarding_usuarios_2026-09-04.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
var pendentes = [];
function test(desc, fn) {
  try {
    var r = fn();
    if (r && typeof r.then === 'function') {
      pendentes.push(r.then(
        function () { console.log('  ✅  ' + desc); passed++; },
        function (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
      ));
      return;
    }
    console.log('  ✅  ' + desc); passed++;
  }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}

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

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 7 — onboarding de usuários ===\n');

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — usrSalvar() (criação) usa adminCreateUser como fonte
// única/atômica, nunca mais createUserWithEmailAndPassword client-side.
// ══════════════════════════════════════════════════════════════════════
var usrSalvarSrc = extractFn('usrSalvar');

test('1. usrSalvar() (modo criação) chama a Cloud Function adminCreateUser', function () {
  assertTrue(/httpsCallable\(['"]adminCreateUser['"]\)/.test(usrSalvarSrc), 'deve chamar httpsCallable(\'adminCreateUser\')');
});

test('2. usrSalvar() NUNCA MAIS chama createUserWithEmailAndPassword client-side (causa raiz do estado órfão sem rollback)', function () {
  assertTrue(!/createUserWithEmailAndPassword/.test(usrSalvarSrc), 'não pode restar nenhuma chamada client-side de criação de conta Auth');
});

test('3. usrSalvar() dispara sendPasswordResetEmail (e-mail de convite) logo após adminCreateUser resolver — nunca mais senha digitada pelo master', function () {
  assertTrue(/sendPasswordResetEmail\(email\)/.test(usrSalvarSrc), 'deve enviar e-mail de definição de senha após criar');
});

test('4. Falha de adminCreateUser NUNCA grava nada localmente (nada de "sucesso parcial") — .catch() só mostra erro, sem push em users/_USR_DATA', function () {
  var catchIdx = usrSalvarSrc.indexOf(".catch(function(err){");
  assertTrue(catchIdx > 0, 'deve haver um .catch() para adminCreateUser');
  var catchBody = usrSalvarSrc.slice(catchIdx, catchIdx + 400);
  assertTrue(!/users\.push|_USR_DATA\s*=/.test(catchBody), 'o catch de falha não pode persistir nada — nunca estado órfão');
  assertTrue(/showToast\(.*err/.test(catchBody), 'deve mostrar erro real ao master');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — authLogin() usa a leitura com retentativa e distingue
// falha de leitura de perfil ausente.
// ══════════════════════════════════════════════════════════════════════
var authLoginSrc = extractFn('authLogin');

test('5. authLogin() usa _authLerPerfilComRetry() (cobre a janela de corrida Auth×Firestore), não mais um .get() direto sem retentativa', function () {
  assertTrue(/_authLerPerfilComRetry\(cred\.user\.uid/.test(authLoginSrc), 'deve chamar _authLerPerfilComRetry');
});

test('6. authLogin() distingue "falha ao ler" (mensagem de retry) de "perfil ausente" (mensagem definitiva) — nunca mais a mesma frase pros dois casos', function () {
  assertTrue(/perfilLeituraFalhou/.test(authLoginSrc), 'deve propagar o flag perfilLeituraFalhou até a mensagem exibida');
  assertTrue(/Não foi possível verificar seu acesso agora/.test(authLoginSrc), 'mensagem de falha transitória deve existir');
  assertTrue(/Conta sem perfil atribuído/.test(authLoginSrc), 'mensagem de perfil genuinamente ausente deve continuar existindo');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA DE EXECUÇÃO — _authLerPerfilComRetry() de verdade (não regex),
// simulando a janela de corrida real: doc "aparece" só depois de N
// tentativas (Cloud Function ainda em voo), e o caso "nunca aparece"
// (perfil genuinamente ausente) não trava/retenta para sempre.
// ══════════════════════════════════════════════════════════════════════
var src = [
  extractFn('_authLerPerfilComRetry'),
  'module.exports = { _authLerPerfilComRetry: _authLerPerfilComRetry };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_bloco7_onboarding_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];

// Os dois cenários abaixo compartilham `global._db` (a mesma variável livre
// que _authLerPerfilComRetry() usa em produção) — rodados em SEQUÊNCIA
// (nunca em paralelo) para nunca um cenário reatribuir global._db enquanto
// o outro ainda tem retentativas (setTimeout) pendentes no event loop.
var cenario7e8 = (function(){
  var tentativas7 = 0, apareceNaTentativa = 3; // simula a CF ainda gravando nas 2 primeiras leituras
  global._db = {
    collection: function () { return { doc: function () { return { get: function () {
      tentativas7++;
      var existe = tentativas7 >= apareceNaTentativa;
      return Promise.resolve({ exists: existe, data: function () { return existe ? { nome: 'Fulano', funcao: 'comercial', ativo: 1, email: 'fulano@teste.com' } : undefined; } });
    } }; } }; }
  };
  delete require.cache[require.resolve(modPath)];
  var mod7 = require(modPath);

  return mod7._authLerPerfilComRetry('uid-teste', 3).then(function (doc) {
    assertTrue(doc.exists, 'doc deve existir após as retentativas');
    assertEq(doc.data().nome, 'Fulano', 'dado do perfil deve ser o real');
    assertEq(tentativas7, 3, 'deve ter tentado exatamente 3 vezes (não mais, não menos)');
  }).then(function(){
    // só troca global._db (e roda o cenário 8) depois do 7 estar 100% resolvido
    var tentativas8 = 0;
    global._db = {
      collection: function () { return { doc: function () { return { get: function () {
        tentativas8++;
        return Promise.resolve({ exists: false, data: function () { return undefined; } });
      } }; } }; }
    };
    delete require.cache[require.resolve(modPath)];
    var mod8 = require(modPath);
    return mod8._authLerPerfilComRetry('uid-orfao', 3).then(function (doc) {
      assertTrue(!doc.exists, 'doc deve continuar inexistente após esgotar tentativas');
      assertEq(tentativas8, 3, 'deve ter esgotado exatamente as 3 tentativas configuradas, sem retry infinito');
    });
  });
})();

test('7. Janela de corrida real (doc só existe na 3ª leitura): _authLerPerfilComRetry(uid, 3) encontra o perfil (nunca declara "ausente" prematuramente) + 8. Perfil GENUINAMENTE ausente esgota as tentativas sem travar', function () {
  return cenario7e8;
});

Promise.all(pendentes).then(function () {
  console.log('\n' + '─'.repeat(60));
  console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
  if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
  console.log('\n✅ PASSOU\n');
});
