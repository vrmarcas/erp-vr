/**
 * e2e_shared_fixtures.js — identidades fixas do ambiente limpo
 * (e2e_clean_env.js), reexportadas num formato conveniente para as
 * suítes de teste (`UID.master`, `UID.producao`, etc.) — evita cada
 * suíte recriar seu próprio conjunto de usuários com UIDs baseados em
 * Date.now() (que funcionava, mas duplicava a mesma fixture 4x).
 *
 * Pré-requisito: `node scripts/e2e_clean_env.js reset` já ter rodado —
 * este módulo só LÊ a definição determinística, não semeia nada sozinho.
 */
'use strict';
const { USUARIOS, MATERIAIS, FIXTURE_PREFIX, PROJECT_ID, SENHA_PADRAO } = require('./e2e_clean_env');

var UID = {};
USUARIOS.forEach((u) => { UID[u.name] = u.uid; });

function ctx(uid, role) { return uid ? { auth: { uid: uid, token: { role: role } } } : { auth: undefined }; }

module.exports = { UID, ctx, USUARIOS, MATERIAIS, FIXTURE_PREFIX, PROJECT_ID, SENHA_PADRAO };
