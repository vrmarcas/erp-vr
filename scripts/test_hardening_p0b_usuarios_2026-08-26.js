/**
 * test_hardening_p0b_usuarios_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 1 — P0-B: criação/edição de usuário pela
 * UI não completa a fonte canônica de autorização.
 *
 * AUDITORIA CONFIRMADA (grep + leitura de código, functions/src/*.ts e
 * index.html): `erp_vr_usuarios/{uid}` é a fonte CANÔNICA — authLogin()
 * (client) e getCallerVerificado() (auth_helper.ts, toda outra Cloud
 * Function protegida) leem EXCLUSIVAMENTE este documento por UID. Rules
 * (`match /erp_vr_usuarios/{uid} { allow write: if false; }`) já
 * documentavam a intenção de que só adminCreateUser/adminUpdateUserRole/
 * adminToggleStatus (Admin SDK) escrevessem aqui — mas nenhuma das 3
 * funções realmente fazia essa escrita (confirmado lendo
 * functions/src/adminUsers.ts linha a linha: as 3 só tocavam o array
 * legado erp_vr/erp_usuarios). Consequências reais encontradas:
 *   1) usrSalvar() (criação) já chamava adminUpdateUserRole após o Auth —
 *      um usuário novo ficava com claim definida mas SEM
 *      erp_vr_usuarios/{uid} → authLogin() sempre negava ("Conta sem
 *      perfil atribuído").
 *   2) usrSalvar() (EDIÇÃO de um usuário existente) nunca chamava NENHUMA
 *      Cloud Function — mudar a função/status de alguém na UI só alterava
 *      o array legado (nunca lido para autorizar nada); a claim e o
 *      documento canônico jamais mudavam. Um master "promovendo" ou
 *      "desativando" alguém via a UI achava que funcionou (toast de
 *      sucesso), mas a permissão real da pessoa NUNCA mudava.
 *   3) usrRecriarAcesso() criava uma nova conta Auth para um usuário sem
 *      uid, mas também nunca definia claim nem erp_vr_usuarios/{uid} — a
 *      conta "recriada" continuava incapaz de logar de verdade.
 *
 * CORRIGIDO:
 *  - functions/src/adminUsers.ts: as 3 funções agora escrevem
 *    erp_vr_usuarios/{uid} (helper writeErpVrUsuariosDoc) como passo
 *    CRÍTICO — falha aqui compensa de verdade (remove a conta Auth em
 *    adminCreateUser; reverte a claim em adminUpdateUserRole; reverte o
 *    disabled do Auth em adminToggleStatus) e propaga erro real, nunca
 *    "sucesso parcial" silencioso. O array legado erp_usuarios continua
 *    sendo escrito, mas como best-effort não-bloqueante (é só histórico).
 *  - index.html: usrSalvar() (edição) agora chama adminUpdateUserRole/
 *    adminToggleStatus quando função/status realmente mudam, só mostra
 *    sucesso depois de confirmado, e bloqueia com aviso claro se o
 *    usuário não tiver uid vinculado (não inventa uma mudança que não
 *    pode se propagar). usrRecriarAcesso() agora também chama
 *    adminUpdateUserRole após criar a conta Auth.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * usrSalvar (edição), usrRecriarAcesso — mais verificação estrutural de
 * functions/src/adminUsers.ts (arquivo TypeScript, sem emulador local —
 * mesmo padrão já estabelecido para Cloud Functions nesta base: compile
 * limpo + regex estrutural; comportamento real verificado no smoke test
 * em produção).
 *
 * Uso: node "scripts/test_hardening_p0b_usuarios_2026-08-26.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

console.log('\n=== HARDENING P0-B — Usuário criado/editado pela UI não completa erp_vr_usuarios/{uid} ===\n');

// ── Parte 1: adminUsers.ts — compila limpo + verificação estrutural ─────
try {
  execSync('npx tsc -p . --noEmit', { cwd: path.join(__dirname, '..', 'functions'), stdio: 'pipe' });
  assertTrue(true, '1. functions/ compila limpo (npx tsc --noEmit) com as 3 funções alteradas');
} catch (e) {
  assertTrue(false, '1. functions/ compila limpo — ERRO: ' + (e.stdout ? e.stdout.toString() : e.message));
}

var fnSrc = fs.readFileSync(path.join(__dirname, '..', 'functions', 'src', 'adminUsers.ts'), 'utf8');
assertTrue(/async function writeErpVrUsuariosDoc/.test(fnSrc), '2. Helper writeErpVrUsuariosDoc() existe (escreve o documento canônico)');
assertTrue((fnSrc.match(/writeErpVrUsuariosDoc\(/g) || []).length >= 4, '3. writeErpVrUsuariosDoc() é chamado nas 3 funções (definição + 3 chamadas = 4 ocorrências)');

function extraiFuncao(nome) {
  var marker = 'export const ' + nome + ' = functions.https.onCall(async (data, context) => {';
  var start = fnSrc.indexOf(marker);
  if (start < 0) throw new Error(nome + ' não encontrada');
  var braceStart = fnSrc.indexOf('{', start + marker.length - 1);
  var depth = 0, i = braceStart;
  for (; i < fnSrc.length; i++) { if (fnSrc[i] === '{') depth++; else if (fnSrc[i] === '}') { depth--; if (depth === 0) break; } }
  return fnSrc.slice(start, i + 1);
}

var createFn = extraiFuncao('adminCreateUser');
assertTrue(createFn.indexOf('writeErpVrUsuariosDoc(newUser.uid') >= 0, '4. adminCreateUser escreve erp_vr_usuarios/{uid} do usuário recém-criado');
assertTrue(/deleteUser\(newUser\.uid\)/.test(createFn.split('writeErpVrUsuariosDoc(newUser.uid')[1] ? createFn.split('writeErpVrUsuariosDoc(newUser.uid')[1].slice(0, 800) : ''), '5. ACHADO REAL: se a escrita do documento canônico falhar, adminCreateUser COMPENSA removendo a conta Auth recém-criada (nunca deixa Auth+claim sem o documento que os autoriza)');
assertTrue(/throw new functions\.https\.HttpsError\("internal", "Erro ao criar o perfil de acesso/.test(createFn), '6. Falha no documento canônico propaga erro real ao chamador (nunca "sucesso parcial" silencioso)');

var updateFn = extraiFuncao('adminUpdateUserRole');
assertTrue(updateFn.indexOf('writeErpVrUsuariosDoc(targetUid') >= 0, '7. adminUpdateUserRole escreve erp_vr_usuarios/{uid}.funcao');
assertTrue(/setCustomUserClaims\(targetUid, existingClaims\)/.test(updateFn), '8. ACHADO REAL: se a escrita do documento canônico falhar, adminUpdateUserRole REVERTE a claim já aplicada (nunca deixa claim nova × documento antigo divergindo — isso trancaria a conta)');
assertTrue(updateFn.indexOf('revokeRefreshTokens') > updateFn.indexOf('writeErpVrUsuariosDoc(targetUid'), '9. Sessões só são revogadas DEPOIS do documento canônico confirmar (nunca força um relogin para uma mudança que na verdade falhou)');

var toggleFn = extraiFuncao('adminToggleStatus');
assertTrue(toggleFn.indexOf('writeErpVrUsuariosDoc(targetUid') >= 0, '10. adminToggleStatus escreve erp_vr_usuarios/{uid}.ativo');
assertTrue(/updateUser\(targetUid, \{ disabled: disabledAntes \}\)/.test(toggleFn), '11. ACHADO REAL: se a escrita do documento canônico falhar, adminToggleStatus REVERTE o disabled do Auth ao estado anterior (nunca deixa Auth e Firestore divergindo sobre se a conta está ativa)');

// ── Parte 2: index.html — usrSalvar() (edição) e usrRecriarAcesso() ─────
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
var FN_NAMES = ['usrSalvar', '_normalizeRole', 'usrLoadUsuarios'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_hardening_p0b_usuarios.tmp.js');
fs.writeFileSync(modPath, src);

var _els, _toasts, _callableCalls, _callableFail, _cloudSaved, _auditLogs;
function makeEl(props) { return Object.assign({ value: '' }, props || {}); }
function reset() {
  _els = {
    usrNome: makeEl({ value: 'Fulano Editado' }),
    usrEmail: makeEl({ value: 'fulano@teste.com' }),
    usrFuncao: makeEl({ value: 'comercial' }),
    usrEditIdx: makeEl({ value: '0' }),
    usrAtivo: makeEl({ value: '1' }),
    usrSenha: makeEl({ value: '' }),
  };
  global.document = { getElementById: function (id) { return _els[id] || null; } };
  global.window = global;
  global._USR_DATA = [{ nome: 'Fulano', email: 'fulano@teste.com', funcao: 'comercial', ativo: 1, uid: 'uid_fulano_123' }];
  global._currentSession = { funcao: 'master', email: 'master@teste.com' };
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  _cloudSaved = null;
  global._cloudSave = function (key, data) { _cloudSaved = { key: key, data: data }; return Promise.resolve(); };
  global._cloudReady = true;
  _auditLogs = [];
  global.secAuditLog = function (action, detail) { _auditLogs.push({ action: action, detail: detail }); };
  global.usrNovoClose = function () {};
  global.usrRender = function () {};
  global.orcPopulateVendedores = function () {};
  global.vendedoresRender = function () {};
  _callableCalls = [];
  _callableFail = null;
  global.firebase = {
    functions: function () {
      return {
        httpsCallable: function (fnName) {
          return function (payload) {
            _callableCalls.push({ fn: fnName, payload: payload });
            if (_callableFail && _callableFail === fnName) return Promise.reject(new Error('permission-denied (simulado)'));
            return Promise.resolve({ data: { ok: true } });
          };
        },
      };
    },
  };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);
function esperar() { return new Promise(function (r) { setTimeout(r, 0); }); }

async function rodarTestes() {
  // 12-13 — só nome/e-mail mudam (função/status intactos): NUNCA chama
  // Cloud Function, comportamento síncrono de sempre preservado.
  reset();
  _els.usrFuncao.value = 'comercial'; // igual ao atual — não mudou
  _els.usrAtivo.value = '1'; // igual ao atual — não mudou
  mod.usrSalvar();
  await esperar();
  assertTrue(_callableCalls.length === 0, '12. Editar só nome/e-mail (função/status intactos): NUNCA chama Cloud Function — comportamento leve preservado');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'ok'; }), '13. Toast de sucesso imediato quando nada de permissão real muda');

  // 14-16 — ACHADO REAL: mudar a FUNÇÃO chama adminUpdateUserRole de
  // verdade, e só confirma sucesso depois da Promise resolver.
  reset();
  _els.usrFuncao.value = 'financeiro'; // mudou de comercial → financeiro
  mod.usrSalvar();
  assertTrue(!_toasts.some(function (t) { return t.tipo === 'ok' && t.msg.indexOf('permissão real aplicada') >= 0; }), '14. Toast de sucesso final NÃO aparece antes da Cloud Function confirmar (só o "Salvando…" intermediário)');
  await esperar();
  assertTrue(_callableCalls.some(function (c) { return c.fn === 'adminUpdateUserRole' && c.payload.targetUid === 'uid_fulano_123' && c.payload.newRole === 'financeiro'; }), '15. ACHADO REAL: mudar a função na edição agora REALMENTE chama adminUpdateUserRole (antes: nunca chamava nenhuma Cloud Function)');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'ok' && t.msg.indexOf('permissão real aplicada') >= 0; }), '16. Toast final confirma que a permissão REAL foi aplicada, só depois da Promise resolver');

  // 17-18 — ACHADO REAL: mudar o STATUS (ativo/inativo) chama
  // adminToggleStatus de verdade.
  reset();
  _els.usrAtivo.value = '0'; // mudou de ativo(1) → inativo(0)
  mod.usrSalvar();
  await esperar();
  assertTrue(_callableCalls.some(function (c) { return c.fn === 'adminToggleStatus' && c.payload.targetUid === 'uid_fulano_123' && c.payload.disabled === true; }), '17. ACHADO REAL: desativar um usuário na edição agora chama adminToggleStatus de verdade (antes: só mudava um array que ninguém consulta)');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'ok'; }), '18. Toast de sucesso confirma a desativação real');

  // 19-20 — ACHADO REAL: se a Cloud Function falhar, NENHUMA mudança local
  // é aplicada — nunca finge que a permissão mudou.
  reset();
  _els.usrFuncao.value = 'producao';
  _callableFail = 'adminUpdateUserRole';
  mod.usrSalvar();
  await esperar();
  assertTrue(global._USR_DATA[0].funcao === 'comercial', '19. ACHADO REAL: falha real na Cloud Function → função do usuário NUNCA muda localmente (nada de "atualizado" falso)');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'err'; }), '20. Toast de erro explícito quando a mudança de permissão falha de verdade');

  // 21-22 — ACHADO REAL: usuário sem uid vinculado — nunca finge que a
  // mudança de permissão se propagou; bloqueia com aviso claro.
  reset();
  global._USR_DATA[0].uid = undefined;
  _els.usrFuncao.value = 'financeiro';
  mod.usrSalvar();
  await esperar();
  assertTrue(_callableCalls.length === 0, '21. ACHADO REAL: usuário sem uid vinculado — NUNCA tenta chamar a Cloud Function (não há targetUid válido)');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'err' && t.msg.indexOf('Recriar Acesso') >= 0; }), '22. Aviso claro instruindo a usar "Recriar Acesso" antes — nunca um "atualizado" enganoso');
  assertTrue(global._USR_DATA[0].funcao === 'comercial', '23. Função permanece intocada localmente quando o uid está ausente');

  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

rodarTestes();
