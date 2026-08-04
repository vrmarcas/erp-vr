/**
 * test_homolog_guard.js
 * Testa as funções REAIS (extraídas de index.html via regex, não mirror) que
 * decidem se o app está em modo de homologação isolada (Firebase Emulator
 * Suite) e se essa configuração é segura o suficiente para prosseguir:
 * _homologComputeMode, _homologValidateProjectId.
 *
 * Objetivo: provar que a trava é fail-closed — qualquer combinação de
 * hostname/parâmetro/projectId que não seja inequivocamente segura deve
 * resultar em bloqueio (ok:false) ou em "não é modo homologação"
 * (comportamento de produção, config real intacta).
 *
 * Uso: node scripts/test_homolog_guard.js
 */

'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var gotS = JSON.stringify(got), expS = JSON.stringify(expected);
  if (gotS === expS) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + expS + '\n       obtido   : ' + gotS); failed++; }
}

// ── Extrai as funções REAIS de index.html (não reimplementa a lógica) ──────
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var re = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  var m = html.match(re);
  if (!m) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  return m[0];
}
var src = extractFn('_homologComputeMode') + '\n' + extractFn('_homologValidateProjectId') + '\n';
src += 'module.exports = { _homologComputeMode, _homologValidateProjectId };';
var modPath = path.join(__dirname, '_homolog_guard_extracted.tmp.js');
fs.writeFileSync(modPath, src);
var { _homologComputeMode, _homologValidateProjectId } = require(modPath);
fs.unlinkSync(modPath);

console.log('\n' + '='.repeat(64));
console.log(' test_homolog_guard.js — funções reais extraídas de index.html');
console.log('='.repeat(64) + '\n');

console.log('-- _homologComputeMode (hostname, param "emulator") --');
test('localhost + emulator=1 → homolog', _homologComputeMode('localhost', '1'), true);
test('127.0.0.1 + emulator=1 → homolog', _homologComputeMode('127.0.0.1', '1'), true);
test('localhost SEM parâmetro → produção (null)', _homologComputeMode('localhost', null), false);
test('localhost com emulator=0 → produção', _homologComputeMode('localhost', '0'), false);
test('localhost com emulator="true" (não é "1") → produção', _homologComputeMode('localhost', 'true'), false);
test('erp-vrmarcas.web.app (produção real) + emulator=1 → NÃO homolog (hostname manda)', _homologComputeMode('erp-vrmarcas.web.app', '1'), false);
test('erp-vrmarcas.firebaseapp.com + emulator=1 → NÃO homolog', _homologComputeMode('erp-vrmarcas.firebaseapp.com', '1'), false);
test('preview channel (*.web.app) + emulator=1 → NÃO homolog', _homologComputeMode('erp-vrmarcas--preview-x.web.app', '1'), false);
test('hostname vazio → produção', _homologComputeMode('', '1'), false);
test('192.168.x.x (rede local, não localhost/127.0.0.1) → NÃO homolog', _homologComputeMode('192.168.1.10', '1'), false);

console.log('\n-- _homologValidateProjectId (fail-closed) --');
test('modo produção (homologMode=false) → sempre ok, independe do projectId', _homologValidateProjectId(false, 'erp-vrmarcas'), { ok: true, mode: 'production' });
test('modo homolog + projectId demo-erp-homolog → ok', _homologValidateProjectId(true, 'demo-erp-homolog'), { ok: true, mode: 'homolog' });
test('modo homolog + projectId demo-qualquer-outro → ok (só precisa começar com demo-)', _homologValidateProjectId(true, 'demo-outro-teste'), { ok: true, mode: 'homolog' });
test('modo homolog + projectId REAL (erp-vrmarcas) → BLOQUEADO', _homologValidateProjectId(true, 'erp-vrmarcas').ok, false);
test('modo homolog + projectId vazio → BLOQUEADO', _homologValidateProjectId(true, '').ok, false);
test('modo homolog + projectId undefined → BLOQUEADO', _homologValidateProjectId(true, undefined).ok, false);
test('modo homolog + projectId "demo" sem hífen → BLOQUEADO (precisa "demo-")', _homologValidateProjectId(true, 'demo').ok, false);
test('modo homolog + projectId contém "demo-" no meio, não no início → BLOQUEADO', _homologValidateProjectId(true, 'erp-demo-fake').ok, false);
test('modo homolog + projectId case-sensitive "Demo-x" → BLOQUEADO (regex é case-sensitive)', _homologValidateProjectId(true, 'Demo-x').ok, false);

console.log('\n-- Composição realista (o que index.html realmente calcula) --');
// firebaseConfig.projectId é escolhido a partir de _HOMOLOG_MODE no próprio código;
// aqui simulamos as DUAS ramificações reais do ternário em index.html.
var PROJECT_ID_HOMOLOG = 'demo-erp-homolog';
var PROJECT_ID_PROD = 'erp-vrmarcas';
function simulaFluxoReal(hostname, emulatorParam) {
  var mode = _homologComputeMode(hostname, emulatorParam);
  var projectId = mode ? PROJECT_ID_HOMOLOG : PROJECT_ID_PROD;
  return _homologValidateProjectId(mode, projectId);
}
test('fluxo real: localhost+emulator=1 → homolog válido, nunca toca erp-vrmarcas', simulaFluxoReal('localhost', '1'), { ok: true, mode: 'homolog' });
test('fluxo real: produção real (sem parâmetro) → produção válida, config real', simulaFluxoReal('erp-vrmarcas.web.app', null), { ok: true, mode: 'production' });
test('fluxo real: 127.0.0.1 sem parâmetro (esqueceu ?emulator=1) → cai em produção, NUNCA em homolog com projectId errado', simulaFluxoReal('127.0.0.1', null), { ok: true, mode: 'production' });

console.log('\n' + '='.repeat(64));
console.log(' RESULTADO: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(64));
if (failed > 0) { console.log('\nAlguns testes falharam.\n'); process.exit(1); }
console.log('\nTodos os testes passaram.\n');
