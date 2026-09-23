/**
 * test_e247_1_deploy_pipeline_functions_build.js — Fase E.2.47.1 (2026-09-23).
 *
 * Regressão da causa raiz da falha de reenvio em E.2.47: `firebase.json` do
 * codebase `functions` (V1, "default") não compilava TypeScript antes de
 * empacotar `lib/` para deploy — o deploy subia o que já estivesse em disco,
 * podendo ser uma build antiga. Foi exatamente o que aconteceu: `npx tsc
 * --noEmit` (checagem de tipos, sem emit) validou o código mas nunca
 * regravou `functions/lib/`, e o `firebase deploy --only
 * functions:sendVitreQuoteToConversation` publicou o `lib/` desatualizado
 * (sem `resendHomologacao`).
 *
 * Mesma causa raiz já corrigida antes em `functions-valeria/` (ver
 * functions-valeria/src/__tests__/deploy_pipeline_static_safety.test.ts,
 * Fase E.2.10) — este arquivo aplica a MESMA correção/prova para o
 * codebase `functions`, sem tocar em `functions-valeria/`.
 *
 * Prova, estaticamente e por build real:
 *  D. o `predeploy` de `functions` sempre compila ANTES do guard de
 *     branch, sem enfraquecer o guard;
 *  C. uma build real (tsc, com emit) a partir do `src/` atual produz um
 *     `lib/vitre_quote_send.js` que contém `resendHomologacao` e os
 *     branches novos da Fase E.2.47 — nenhum resíduo de versão anterior
 *     sobrevive a uma rebuild limpa;
 *  G. o pipeline de `functions-valeria/` (já correto) permanece intocado
 *     por esta correção.
 *
 * Uso: node scripts/test_e247_1_deploy_pipeline_functions_build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅', msg); }
  else { fail++; console.log('  ❌', msg); }
}

(async () => {
  console.log('\n== D. firebase.json — predeploy de functions compila ANTES do guard, guard nunca removido ==');
  {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
    const predeploy = cfg.functions[0].predeploy;
    assert(cfg.functions[0].source === 'functions' && cfg.functions[0].codebase === 'default', 'confirma que estamos checando o codebase functions/ (default), não functions-valeria/');
    assert(Array.isArray(predeploy), 'predeploy é um array de comandos');
    assert(predeploy.length >= 2, 'predeploy tem pelo menos 2 etapas (build + guard)');

    const buildIdx = predeploy.findIndex((cmd) => /npm .*--prefix functions run build/.test(cmd));
    const guardIdx = predeploy.findIndex((cmd) => /guard_deploy_branch\.js/.test(cmd));

    assert(buildIdx >= 0, 'etapa de build ("npm --prefix functions run build") está presente no predeploy');
    assert(guardIdx >= 0, 'guard_deploy_branch.js continua presente no predeploy — nunca removido/enfraquecido');
    assert(buildIdx >= 0 && guardIdx >= 0 && buildIdx < guardIdx, 'build roda ANTES do guard (ordem correta)');
  }

  console.log('\n== D2. functions/package.json ainda expõe "build": "tsc" (comando que o predeploy invoca) ==');
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'functions', 'package.json'), 'utf8'));
    assert(pkg.scripts && pkg.scripts.build === 'tsc', 'functions/package.json.scripts.build === "tsc"');
  }

  console.log('\n== C. build real a partir do src/ atual não deixa resíduo de versão anterior ==');
  {
    execFileSync('npx', ['tsc', '-p', '.'], { cwd: path.join(ROOT, 'functions'), stdio: 'pipe' });
    const compiled = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'vitre_quote_send.js'), 'utf8');

    // Marcadores da lógica atual (Fase E.2.47) — precisam estar no artefato compilado.
    assert(compiled.includes('resendHomologacao'), 'lib/vitre_quote_send.js contém "resendHomologacao" após build real');
    assert(compiled.includes('vitre_quote_resend_homolog:'), 'lib/vitre_quote_send.js contém o prefixo de idempotência distinto do reenvio');
    assert(compiled.includes('reenviar_orcamento_vitre_whatsapp'), 'lib/vitre_quote_send.js contém a action de auditoria do reenvio');
    assert(compiled.includes('ultimoReenvioHomologacaoEm'), 'lib/vitre_quote_send.js contém o campo aditivo ultimoReenvioHomologacaoEm');

    // Marcador do BUG desta fase: o guard antigo tratava status==="enviado" incondicionalmente
    // como já-processado, sem checar resendHomologacao — não pode sobreviver a uma build limpa.
    assert(!/if \(quote\.status === "enviado"\) \{\s*\/\/ Já enviado/.test(compiled), 'branch antigo (status==="enviado" incondicional, sem resendHomologacao) não sobrevive à rebuild');
  }

  console.log('\n== G. pipeline de functions-valeria/ permanece intocado por esta correção ==');
  {
    const cfgValeria = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-valeria.json'), 'utf8'));
    const predeployValeria = cfgValeria.functions[0].predeploy;
    assert(
      JSON.stringify(predeployValeria) === JSON.stringify(['npm --prefix functions-valeria run build', 'node scripts/guard_deploy_branch.js']),
      'predeploy de functions-valeria/ segue exatamente igual (build + guard, nesta ordem) — não modificado nesta fase'
    );
    assert(cfgValeria.functions[0].postdeploy && cfgValeria.functions[0].postdeploy.length === 1, 'postdeploy de functions-valeria/ (rebind do secret) permanece intocado');
  }

  console.log('\n' + '='.repeat(60));
  console.log(pass + ' passaram, ' + fail + ' falharam.');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
