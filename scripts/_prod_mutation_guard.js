/**
 * _prod_mutation_guard.js — ValerIA 2.0, hardening de scripts de teste
 * (2026-09-24).
 *
 * Achado real (2026-09-23): um sweep genérico com timeout agressivo
 * (`perl -e 'alarm(6)'`) matou `test_http_fase_e2_string_parsing_2026-09-20.js`
 * no meio da execução, DEPOIS de ele ligar `valeriaV2Enabled=true` em
 * produção mas ANTES do próprio fail-safe (try/finally em JS) religar
 * para `false` — SIGALRM mata o processo Node a nível de SO, o que nunca
 * passa por `try/catch/finally`. A flag ficou presa em `true` por ~41min
 * até ser encontrada e revertida manualmente (ver
 * feedback_prod_flag_scripts_sweep_risk na memória do projeto).
 *
 * Este módulo dá 3 camadas de defesa a qualquer script que liga/desliga
 * uma flag real de produção (Firestore ou API externa como ChatVolt).
 * As camadas NÃO têm peso igual — leia a ordem com atenção:
 *
 *  1. `requireAllowProdMutation` — **a proteção PRINCIPAL**. Barra
 *     QUALQUER escrita se `ALLOW_PROD_MUTATION=1` não estiver setado no
 *     ambiente. Um script assim só roda (e só corre qualquer risco de
 *     ficar preso) quando alguém decide isso explicitamente, nunca por
 *     fazer parte de um sweep genérico. Esta é a única camada que
 *     realmente elimina o risco — as outras duas são mitigação para
 *     quando o script JÁ está rodando com opt-in.
 *  2. `installEmergencyRestoreOnSignal` — **BEST-EFFORT, não é garantia
 *     de rollback**. Registra handlers para SIGINT/SIGTERM/SIGALRM (os
 *     sinais que um kill externo tipicamente manda antes de recorrer a
 *     SIGKILL) que TENTAM restaurar o estado seguro antes de sair. Pode
 *     falhar (rede lenta, segundo sinal antes do primeiro terminar,
 *     Firestore indisponível) — quando falha, ele avisa e pede
 *     intervenção manual, nunca finge sucesso. **SIGKILL/SIGSTOP não
 *     podem ser capturados por NENHUM processo, de nenhuma forma** —
 *     garantia do POSIX, não uma falha deste módulo; nenhuma técnica em
 *     JS contorna isso. Por isso a camada 1 é a que importa de verdade.
 *  3. Convenção `// PROD_MUTATING_TEST` — uma linha EXATA (comentário de
 *     linha, não texto dentro do JSDoc), como a primeira linha de cada
 *     script que usa este módulo. Detecção oficial:
 *       grep -l '^// PROD_MUTATING_TEST$' scripts/*.js
 *     Isso evita falso-positivo: o texto "PROD_MUTATING_TEST" pode
 *     aparecer dentro de comentários explicativos (como aqui, ou no
 *     JSDoc de cada script) sem que isso conte como marcação — só a
 *     linha exata conta. Ver scripts/TESTING_SAFETY.md.
 *
 * Resumo para quem for integrar um script novo: a única coisa que
 * garante segurança é NÃO EXECUTAR sem opt-in explícito (camada 1). As
 * camadas 2 e 3 reduzem o dano quando a execução já está em curso, mas
 * nenhuma delas substitui a camada 1.
 */
'use strict';

/**
 * Aborta o processo (exit 1) ANTES de qualquer escrita se
 * ALLOW_PROD_MUTATION=1 não estiver setado. Chamar isso é a PRIMEIRA
 * linha de `main()`, antes de qualquer leitura de secret/Firestore.
 */
function requireAllowProdMutation(scriptLabel) {
  if (process.env.ALLOW_PROD_MUTATION === '1') return;
  console.error('\n🛑 BLOQUEADO — ' + scriptLabel);
  console.error('Este script ALTERA PRODUÇÃO (Firestore e/ou API externa reais).');
  console.error('Nenhuma escrita foi feita. Para confirmar explicitamente e prosseguir:');
  console.error('  ALLOW_PROD_MUTATION=1 node ' + scriptLabel + '\n');
  process.exit(1);
}

/**
 * BEST-EFFORT — NÃO é garantia de rollback. Registra handlers de
 * emergência para SIGINT/SIGTERM/SIGALRM que TENTAM restaurar o estado
 * seguro antes de o processo sair. `restoreFn` deve devolver uma Promise
 * que resolve quando o estado seguro foi confirmado por releitura real
 * (nunca só "enviei a escrita") — se a tentativa falhar, isso é
 * reportado como falha real, nunca escondido.
 *
 * LIMITAÇÃO REAL, documentada de propósito: SIGKILL/SIGSTOP NÃO PODEM
 * SER CAPTURADOS por nenhum processo, em nenhuma linguagem — garantia do
 * POSIX, não uma falha deste módulo. Contra um SIGKILL, esta função não
 * roda, ponto final. A proteção que de fato importa contra esse cenário
 * é nunca executar sem opt-in explícito — ver `requireAllowProdMutation`
 * acima, que é a defesa principal, não esta.
 */
function installEmergencyRestoreOnSignal(restoreFn, scriptLabel) {
  let handling = false;
  const handler = (sig) => {
    if (handling) return;
    handling = true;
    console.error('\n⚠️  ' + scriptLabel + ' recebeu ' + sig + ' — tentando restaurar o estado seguro antes de sair...');
    Promise.resolve()
      .then(restoreFn)
      .then(() => console.error('✅ restauração de emergência confirmada.'))
      .catch((e) => {
        console.error('❌ restauração de emergência FALHOU:', e && e.message);
        console.error('   AÇÃO MANUAL URGENTE: confirme o estado da flag/toggle diretamente.');
      })
      .finally(() => process.exit(1));
  };
  ['SIGINT', 'SIGTERM', 'SIGALRM'].forEach((sig) => {
    try {
      process.on(sig, () => handler(sig));
    } catch {
      // SIGALRM não existe em todas as plataformas (ex.: Windows) — ignora.
    }
  });
}

module.exports = { requireAllowProdMutation, installEmergencyRestoreOnSignal };
