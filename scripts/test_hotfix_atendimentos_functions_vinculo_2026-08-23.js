/**
 * test_hotfix_atendimentos_functions_vinculo_2026-08-23.js
 *
 * RODADA 9, FECHAMENTO (2026-08-23) — Bloqueador 2: os botões "Criar/Abrir
 * cliente"/"Criar/Abrir oportunidade"/"Revisar e criar orçamento" do
 * painel de Atendimentos eram só visuais — nada persistia. Causa raiz: a
 * Rule de `atendimentos` já bloqueia (corretamente) escrita direta do
 * client, e não existia nenhuma Cloud Function para gravar
 * clienteId/leadId/orcamentoId de volta no atendimento.
 *
 * Corrigido com 4 novas Cloud Functions em functions/src/atendimentos.ts
 * (atdVincularCliente, atdVincularOportunidade, atdVincularOrcamento,
 * atdSolicitarHumano — mesma fronteira de auth de todas as outras funções
 * do módulo: getCallerVerificado/requireRole, nunca confia em role vinda
 * do payload).
 *
 * Este teste compila o código REAL (tsc) e exercita a lógica de dedupe
 * pura extraída dele (normTelAtd/normNomeAtd/encontrarClienteDuplicado —
 * export adicionado só para viabilizar este teste, nenhuma mudança de
 * comportamento) — mesmo critério já usado por
 * _crmBuscarClienteDuplicado()/_crmNormalizarTel()/_crmNormalizarNome() no
 * index.html (nunca uma fórmula nova): nome normalizado, e-mail, ou
 * telefone normalizado com >=8 dígitos (containment).
 *
 * As Cloud Functions em si (que fazem I/O real no Firestore) são
 * verificadas por: tsc --noEmit limpo, build limpo, e smoke test
 * autenticado em produção (ver relatório final) — este projeto não tem
 * emulador do Firestore configurado para functions/ (só functions-valeria/
 * tem __tests__ com esse padrão).
 *
 * Uso: node scripts/test_hotfix_atendimentos_functions_vinculo_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var functionsDir = path.join(__dirname, '..', 'functions');
var libPath = path.join(functionsDir, 'lib', 'atendimentos.js');

console.log('\n=== RODADA 9, FECHAMENTO — Cloud Functions de vínculo Atendimento→CRM/Orçamento ===\n');

try {
  execSync('npx tsc -p .', { cwd: functionsDir, stdio: 'pipe' });
  console.log('  ✅  0. functions/ compila limpo (tsc) — inclui as 4 novas Cloud Functions\n');
  passed++;
} catch (e) {
  console.log('  ❌  0. functions/ NÃO compila — ' + (e.stdout || e.message));
  failed++;
  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  process.exitCode = 1;
  return;
}

delete require.cache[require.resolve(libPath)];
var mod = require(libPath);

assertTrue(typeof mod.atdVincularCliente !== 'undefined', '1. atdVincularCliente exportada de functions/src/index.ts');
assertTrue(typeof mod.atdVincularOportunidade !== 'undefined', '2. atdVincularOportunidade exportada');
assertTrue(typeof mod.atdVincularOrcamento !== 'undefined', '3. atdVincularOrcamento exportada');
assertTrue(typeof mod.atdSolicitarHumano !== 'undefined', '4. atdSolicitarHumano exportada');

// ── normTelAtd / normNomeAtd ──────────────────────────────────────────────
test('5. normTelAtd remove tudo que não é dígito', mod.normTelAtd('+55 (62) 99888-7766'), '5562998887766');
test('6. normTelAtd de string vazia/undefined não lança exceção', mod.normTelAtd(undefined), '');
test('7. normNomeAtd normaliza espaços e caixa', mod.normNomeAtd('  João   DA  Silva '), 'joão da silva');

// ── encontrarClienteDuplicado — mesmo critério de _crmBuscarClienteDuplicado ──
var lista = [
  { id: 'c1', nome: 'Maria Souza', tel: '(62) 99888-7766', email: 'maria@exemplo.com' },
  { id: 'c2', nome: 'João Silva', tel: '(11) 98888-1234', email: 'joao@exemplo.com' },
];

test('8. encontra por nome normalizado (case/espaço diferentes)', mod.encontrarClienteDuplicado(lista, '  maria souza  ', '', ''), lista[0]);
test('9. encontra por e-mail exato (case-insensitive)', mod.encontrarClienteDuplicado(lista, 'Outro Nome', '', 'JOAO@exemplo.com'), lista[1]);
test('10. encontra por telefone normalizado (formatação diferente, mesmo número)', mod.encontrarClienteDuplicado(lista, 'Outro Nome', '62 998887766', ''), lista[0]);
test('11. NÃO encontra quando nome/tel/email são todos diferentes — não duplica à toa nem inventa um "quase igual"', mod.encontrarClienteDuplicado(lista, 'Cliente Novo', '(21) 90000-0000', 'novo@exemplo.com'), null);
test('12. lista vazia nunca lança exceção — devolve null', mod.encontrarClienteDuplicado([], 'Qualquer', '11999998888', 'x@x.com'), null);
test('13. telefone com menos de 8 dígitos nunca é usado para dedupe (evita falso positivo por número curto/incompleto)', mod.encontrarClienteDuplicado(lista, 'Nome Diferente', '1234', ''), null);

try { fs.unlinkSync(path.join(functionsDir, 'tsconfig.tsbuildinfo')); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
