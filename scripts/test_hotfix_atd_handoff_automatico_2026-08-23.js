/**
 * test_hotfix_atd_handoff_automatico_2026-08-23.js
 *
 * RODADA CURTA DE FECHAMENTO pós-Rodada 9 — Objetivo 1: fechar o elo que
 * ficou documentado como pendente ("a ValerIA pedir humano sozinha via
 * Tool do Chatvolt é a integração externa que falta").
 *
 * Auditoria (ver relatório final): o prompt v0.3 já delega o handoff
 * genérico ao "Solicitar Humano (built-in Chatvolt)" — um recurso da
 * PLATAFORMA Chatvolt, sem nenhuma escrita no nosso Firestore. Por isso o
 * badge nunca acendia sozinho: a IA já decide corretamente QUANDO
 * escalar (10 condições documentadas no prompt), só nunca tocava o
 * atendimentos/{id} do ERP.
 *
 * Corrigido reaproveitando o NÚCLEO de atdSolicitarHumano (agora extraído
 * em solicitarHumanoCore, nunca duplicado) por trás de uma nova Tool HTTP
 * — atdSolicitarHumanoValeria — na MESMA fronteira de auth (Bearer via
 * checkAuth/erp_vr/valeria_config.secret) já usada por todas as Tools de
 * valeria_vitre.ts. O núcleo agora roda dentro de uma transação Firestore
 * (get+set atômico) para fechar o Teste D (duas chamadas concorrentes não
 * duplicam a mensagem de sistema).
 *
 * Este arquivo, como o irmão test_hotfix_atendimentos_functions_vinculo,
 * NÃO tem emulador do Firestore disponível para functions/ — valida
 * compilação real (tsc), exportação, e estrutura do código-fonte real
 * (nunca reimplementa a lógica sob teste). Comportamento real (transação,
 * idempotência, checkAuth, mensagem de sistema) é verificado por smoke
 * test autenticado em produção (ver relatório final).
 *
 * Uso: node scripts/test_hotfix_atd_handoff_automatico_2026-08-23.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var functionsDir = path.join(__dirname, '..', 'functions');
var srcPath = path.join(functionsDir, 'src', 'atendimentos.ts');
var libPath = path.join(functionsDir, 'lib', 'atendimentos.js');
var indexLibPath = path.join(functionsDir, 'lib', 'index.js');

console.log('\n=== RODADA CURTA (pós-9) — Handoff automático da ValerIA ===\n');

try {
  execSync('npx tsc -p .', { cwd: functionsDir, stdio: 'pipe' });
  assertTrue(true, '0. functions/ compila limpo (tsc) — inclui atdSolicitarHumanoValeria');
} catch (e) {
  assertTrue(false, '0. functions/ compila limpo (tsc) — ' + (e.stdout || e.message).toString().slice(0, 500));
  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(1);
}

var src = fs.readFileSync(srcPath, 'utf8');
var lib = fs.readFileSync(libPath, 'utf8');
var indexLib = fs.readFileSync(indexLibPath, 'utf8');

assertTrue(/exports\.atdSolicitarHumanoValeria\s*=/.test(lib), '1. atdSolicitarHumanoValeria exportada de functions/lib/atendimentos.js');
assertTrue(/atdSolicitarHumanoValeria/.test(indexLib), '2. atdSolicitarHumanoValeria re-exportada de functions/lib/index.js (deployável)');

// ── Núcleo único, nunca duplicado ───────────────────────────────────────────
var coreDeclCount = (src.match(/async function solicitarHumanoCore/g) || []).length;
assertTrue(coreDeclCount === 1, '3. solicitarHumanoCore existe uma única vez (núcleo não duplicado)');
var coreCallCount = (src.match(/solicitarHumanoCore\(/g) || []).length;
// 1 declaração da função + 2 chamadas (onCall do ERP + onRequest da ValerIA)
assertTrue(coreCallCount === 3, '4. solicitarHumanoCore é chamado pelas DUAS fronteiras (onCall do ERP e onRequest da ValerIA) — nenhuma lógica de estado reimplementada');

// ── Transação (fecha o Teste D — duas chamadas concorrentes) ───────────────
var coreBody = src.slice(src.indexOf('async function solicitarHumanoCore'), src.indexOf('// Chamável pelo próprio ERP'));
assertTrue(/runTransaction/.test(coreBody), '5. solicitarHumanoCore roda dentro de uma transação Firestore (get+set atômico)');
assertTrue(/tx\.get\(ref\)/.test(coreBody) && /tx\.set\(ref,/.test(coreBody), '6. leitura e escrita do status acontecem DENTRO da mesma transação (sem race entre get() e set() separados)');

// ── atdSolicitarHumanoValeria — mesma fronteira de auth das Tools HTTP ─────
var valeriaFnBody = src.slice(src.indexOf('export const atdSolicitarHumanoValeria'));
assertTrue(/checkAuth\(req, res\)/.test(valeriaFnBody), '7. atdSolicitarHumanoValeria exige checkAuth (Bearer) — nunca aberta sem autenticação');
assertTrue(/import \{ checkAuth \} from "\.\/valeria"/.test(src), '8. reaproveita o MESMO checkAuth já usado pelas Tools Vitre (erp_vr/valeria_config.secret) — nenhum segundo mecanismo de auth inventado');
assertTrue(/conversationId/.test(valeriaFnBody) && /organizationId/.test(valeriaFnBody), '9. aceita conversationId/organizationId — mesmo contrato das outras Tools HTTP da ValerIA');
assertTrue(/requestId/.test(valeriaFnBody), '10. exige requestId — mesmo padrão de idempotência de retry das outras Tools');
assertTrue(/acquireIdem\(/.test(valeriaFnBody), '11. usa acquireIdem (retry de rede da própria ValerIA) — camada adicional à transação (concorrência entre chamadas distintas)');
assertTrue(/jaSolicitado:\s*true/.test(valeriaFnBody), '12. segunda chamada (idempotência de retry) retorna jaSolicitado:true — contrato pedido');
assertTrue(/"valeria"/.test(valeriaFnBody) && /"valeria_agent"/.test(valeriaFnBody), '13. audit log identifica a ValerIA como ator (nunca se passa por um uid de staff)');

// ── Nunca write direto client-side ──────────────────────────────────────────
assertTrue(!/functions\.https\.onRequest.*firestore\(\)\.collection\("atendimentos"\)\.doc\([^)]*\)\.update/.test(lib), '14. nenhum write direto sem passar pelo núcleo transacional (sanity check estrutural)');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
