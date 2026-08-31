#!/usr/bin/env node
/**
 * guard_deploy_branch.js — portão de segurança contra deploy a partir da
 * branch/worktree errada.
 *
 * Achado que motivou este script (2026-08-31): o Firebase Hosting de
 * produção (erp-vrmarcas) ficou servindo o conteúdo da worktree/branch
 * `feat/valeria-atendimentos-mvp-2026-08-21` por horas, enquanto `master`
 * (com o hardening `fin_cr`, correção de unitário, `orcEnvNormalizar`,
 * persistência de Kanban, reconexão de Estoque/Retalhos e materiais
 * canônicos) continha o código correto mas nunca deployado — um `firebase
 * deploy` rodado da worktree errada, fora do `release_hosting.sh`.
 * `release_hosting.sh` já valida branch=master antes de deployar, mas só
 * protege quem o usa. Este script roda como `predeploy` no firebase.json
 * — o Firebase CLI o executa e ABORTA o deploy se ele sair com código
 * != 0, então protege TAMBÉM quem rodar `firebase deploy` diretamente,
 * de qualquer worktree, ignorando o script de release.
 *
 * Falha (exit 1) se:
 *   1. a branch atual não for exatamente `master`;
 *   2. HEAD local não for idêntico a origin/master (nada para
 *      push/pull) — mesma regra do release_hosting.sh, Etapa 2.
 *
 * Nunca silencioso: sempre imprime o motivo exato do bloqueio.
 */
'use strict';
const { execSync } = require('child_process');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(msg) {
  console.error('\n⛔ DEPLOY BLOQUEADO — ' + msg);
  console.error('   Deploy de produção só é permitido a partir da branch "master", sincronizada com origin/master.');
  console.error('   Veja scripts/guard_deploy_branch.js para o histórico do incidente que motivou esta trava.\n');
  process.exit(1);
}

let branch, localSha, remoteSha;
try {
  branch = sh('git rev-parse --abbrev-ref HEAD');
} catch (e) {
  fail('não foi possível determinar a branch atual (' + e.message + ').');
}

if (branch !== 'master') {
  fail('branch atual é "' + branch + '", não "master".');
}

try {
  sh('git fetch origin master --quiet');
  localSha = sh('git rev-parse HEAD');
  remoteSha = sh('git rev-parse origin/master');
} catch (e) {
  fail('falha ao conferir sincronismo com origin/master (' + e.message + ').');
}

if (localSha !== remoteSha) {
  fail('HEAD local (' + localSha + ') difere de origin/master (' + remoteSha + ') — falta push ou pull.');
}

console.log('✅ guard_deploy_branch — branch master, sincronizada com origin/master (' + localSha + '). Deploy autorizado.');
process.exit(0);
