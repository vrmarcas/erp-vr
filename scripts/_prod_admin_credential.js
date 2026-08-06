/**
 * _prod_admin_credential.js — GO-LIVE 2026-08-06.
 *
 * Credencial de Admin SDK para `erp-vrmarcas` (produção) reaproveitando a
 * sessão gcloud JÁ AUTENTICADA no ambiente (`gcloud auth login`, conta
 * vrmarcasgithub@gmail.com) — nunca cria nem baixa service account (fora
 * do escopo autorizado do go-live). Aponta GOOGLE_APPLICATION_CREDENTIALS
 * para o arquivo ADC "authorized_user" que o PRÓPRIO gcloud já gera e
 * mantém (~/.config/gcloud/legacy_credentials/<conta>/adc.json) — mesmo
 * mecanismo padrão de `applicationDefault()`, sem gerar nenhum
 * credencial nova nem pedir novo consentimento interativo.
 *
 * Uso: const { getProdApp } = require('./_prod_admin_credential');
 *      const db = getProdApp().firestore();
 */
'use strict';
const path = require('path');
const os = require('os');

const ADC_PATH = path.join(os.homedir(), '.config', 'gcloud', 'legacy_credentials', 'vrmarcasgithub@gmail.com', 'adc.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || ADC_PATH;

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'erp-vrmarcas';

let app = null;
function getProdApp() {
  if (app) return app;
  // App DEFAULT (sem nome) de propósito — vitre.ts/auth_helper.ts (código
  // real compilado, chamado via .run() pelos scripts de go-live) usam
  // admin.firestore()/admin.auth() sem especificar app, o que só resolve
  // contra o app default.
  if (admin.apps.length) { app = admin.app(); return app; }
  app = admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
  return app;
}

module.exports = { getProdApp, PROJECT_ID };
