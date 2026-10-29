#!/usr/bin/env node
/**
 * guard_ponte_homolog_only_deploy.js — "Operação Valéria", rodada
 * "publicar e validar a ponte ERP em homologação" (2026-10-29).
 *
 * Equivalente de scripts/guard_deploy_branch.js, mas para o codebase
 * ISOLADO `pontehomolog` (functions_ponte_homolog/, gerado por
 * prepare_ponte_homolog_deploy_package.js). O guard de branch já roda
 * antes deste (mesmo predeploy chain) e continua intacto — este guard
 * cobre um risco DIFERENTE e complementar: publicar por engano no
 * projeto Firebase ERRADO (erp-vrmarcas em vez de erp-vrmarcas-homolog),
 * mesmo com a branch correta.
 *
 * Falha (exit 1) se $GCLOUD_PROJECT (injetado pelo Firebase CLI nos
 * predeploy hooks) não for EXATAMENTE "erp-vrmarcas-homolog". Nunca
 * silencioso — sempre imprime o motivo exato do bloqueio.
 */
'use strict';

const HOMOLOG_PROJECT_ID = 'erp-vrmarcas-homolog';
const PRODUCTION_PROJECT_ID = 'erp-vrmarcas';

function fail(msg) {
  console.error('\n⛔ DEPLOY BLOQUEADO (guard da ponte ERP) — ' + msg);
  console.error('   O codebase "pontehomolog" é EXCLUSIVO do projeto "' + HOMOLOG_PROJECT_ID + '".');
  process.exit(1);
}

const project = process.env.GCLOUD_PROJECT || '';

if (!project) {
  fail('variável de ambiente GCLOUD_PROJECT não foi recebida do Firebase CLI — não é possível confirmar o destino do deploy, então ele é recusado por segurança.');
}
if (project === PRODUCTION_PROJECT_ID) {
  fail('GCLOUD_PROJECT="' + project + '" é o projeto de PRODUÇÃO. O codebase "pontehomolog" nunca deve publicar em produção.');
}
if (project !== HOMOLOG_PROJECT_ID) {
  fail('GCLOUD_PROJECT="' + project + '" não é "' + HOMOLOG_PROJECT_ID + '". Passe --project ' + HOMOLOG_PROJECT_ID + ' explicitamente.');
}

console.log('✔ guard_ponte_homolog_only_deploy: destino confirmado = ' + project + ' (homologação). Prosseguindo.');
