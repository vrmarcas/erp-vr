/**
 * apply_via_admin_function.js
 *
 * RODADA 3.1 — caminho remoto para aplicar seed de contas bancárias e
 * histórico financeiro em produção quando o ambiente local não tem
 * GOOGLE_APPLICATION_CREDENTIALS para o Admin SDK escrever direto no
 * Firestore. Faz TODO o parsing/normalização/validação localmente,
 * reaproveitando scripts/hist_lib.js (mesma lógica já testada em
 * scripts/import_historico_financeiro.js — sem duplicar/reimplementar) —
 * só a ESCRITA final vai para a Cloud Function administrativa
 * (functions/src/admin_ops.ts), que roda com credenciais automáticas do
 * runtime do Cloud Functions (sem chave, sem segredo persistido em
 * coleção nenhuma).
 *
 * Uso:
 *   ADMIN_ONE_TIME_SECRET=<segredo> node scripts/apply_via_admin_function.js --status [--mock]
 *   ADMIN_ONE_TIME_SECRET=<segredo> node scripts/apply_via_admin_function.js --seed-bancos [--mock]
 *   ADMIN_ONE_TIME_SECRET=<segredo> node scripts/apply_via_admin_function.js --apply-historico [--mock]
 *   ADMIN_ONE_TIME_SECRET=<segredo> node scripts/apply_via_admin_function.js --rollback=<importRunId> [--mock]
 *
 * --mock aponta para o Functions Emulator local (porta 5001) em vez de produção.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const histLib = require('./hist_lib');

const MOCK = process.argv.includes('--mock');
const DATA_DIR = path.join(__dirname, '..', 'data-import', 'vr-historico-2018-2026');
const SECRET = process.env.ADMIN_ONE_TIME_SECRET;
const ROLLBACK_ARG = process.argv.find((a) => a.indexOf('--rollback=') === 0);
const ROLLBACK_ID = ROLLBACK_ARG ? ROLLBACK_ARG.split('=')[1] : null;

const BASE_URL = MOCK
  ? 'http://localhost:5001/demo-erp-homolog/us-central1/adminOneTimeOps'
  : 'https://us-central1-erp-vrmarcas.cloudfunctions.net/adminOneTimeOps';

if (!SECRET) {
  console.error('[apply_via_admin_function] ADMIN_ONE_TIME_SECRET não definido no ambiente. Aborta.');
  process.exit(1);
}

function callOp(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(BASE_URL);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + SECRET },
    }, (res) => {
      let out = ''; res.on('data', (c) => out += c);
      res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(out); } catch (e) { /* corpo não-JSON */ }
        resolve({ status: res.statusCode, body: parsed, raw: out });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function status() {
  var r = await callOp({ op: 'status' });
  console.log('[status] HTTP ' + r.status);
  console.log(JSON.stringify(r.body, null, 2));
  return r;
}

async function seedBancos() {
  var r = await callOp({ op: 'seed_bancos' });
  console.log('[seed_bancos] HTTP ' + r.status);
  console.log(JSON.stringify(r.body, null, 2));
  return r;
}

async function rollbackHistorico(importRunId) {
  var r = await callOp({ op: 'rollback_historico', importRunId: importRunId });
  console.log('[rollback_historico] HTTP ' + r.status);
  console.log(JSON.stringify(r.body, null, 2));
  return r;
}

async function applyHistorico() {
  // ── Dry-run local obrigatório antes de qualquer escrita remota — mesmo
  // gate de segurança de import_historico_financeiro.js. ──────────────────
  console.log('\n=== DRY-RUN LOCAL (antes de qualquer escrita remota) ===\n');
  var runId = 'hist_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  var porFonte = [];
  var algumProblema = false;

  for (var i = 0; i < histLib.FONTES.length; i++) {
    var f = histLib.FONTES[i];
    var src = histLib.readSource(DATA_DIR, f.arquivo);
    if (!src) { console.log('  ⚠️  ' + f.arquivo + ' não encontrado — pulado'); continue; }
    if (f.validar) {
      var v = f.validar(src.rows);
      if (!v.ok) {
        algumProblema = true;
        console.log('  ❌ VALIDAÇÃO DE ' + f.arquivo + ' FALHOU:');
        v.problemas.forEach(function (p) { console.log('       - ' + p); });
      } else {
        console.log('  ✅ ' + f.arquivo + ': checksums de sanidade OK (' + src.rows.length + ' linhas)');
      }
    } else {
      console.log('  📄 ' + f.arquivo + ': ' + src.rows.length + ' linhas (sem checksum dedicado)');
    }
    var registros = {};
    src.rows.forEach(function (row) {
      var norm = f.normalizar(row, runId, f.arquivo);
      if (norm.id_importacao) registros[norm.id_importacao] = norm;
    });
    porFonte.push({ docId: f.doc, arquivo: f.arquivo, hash: src.hash, totalNaFonte: src.rows.length, registros: registros });
  }

  if (algumProblema) {
    console.error('\n❌ APPLY ABORTADO — dry-run local encontrou divergência de checksum. Nada foi enviado à Cloud Function.');
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ Dry-run local OK — enviando à Cloud Function administrativa (importRunId=' + runId + ')...\n');

  var runRecord = { importRunId: runId, dataImportacao: Date.now(), status: 'concluido', usuario: 'apply_via_admin_function', fontes: {} };

  for (var j = 0; j < porFonte.length; j++) {
    var pf = porFonte[j];
    var r = await callOp({ op: 'importar_fonte', docId: pf.docId, importRunId: runId, registros: pf.registros });
    if (r.status !== 200 || !r.body || !r.body.ok) {
      console.error('  ❌ ' + pf.docId + ' — FALHOU: HTTP ' + r.status + ' — ' + r.raw);
      process.exitCode = 1;
      return;
    }
    runRecord.fontes[pf.docId] = { arquivo: pf.arquivo, hash: pf.hash, novos: r.body.novos, jaExistiam: r.body.jaExistiam, totalNaFonte: pf.totalNaFonte };
    console.log('  ✅ ' + pf.docId + ': ' + r.body.novos + ' novo(s), ' + r.body.jaExistiam + ' já existiam (idempotente)');
  }

  var rRun = await callOp({ op: 'registrar_run', runRecord: runRecord });
  console.log('\n✅ APLICADO remotamente — importRunId=' + runId);
  console.log(JSON.stringify(runRecord, null, 2));
  return runRecord;
}

(async function main() {
  if (process.argv.includes('--status')) { await status(); return; }
  if (process.argv.includes('--seed-bancos')) { await seedBancos(); return; }
  if (ROLLBACK_ID) { await rollbackHistorico(ROLLBACK_ID); return; }
  if (process.argv.includes('--apply-historico')) { await applyHistorico(); return; }
  console.log('Uso: --status | --seed-bancos | --apply-historico | --rollback=<id>  (+ --mock opcional)');
})().catch((e) => { console.error('[apply_via_admin_function] ERRO:', e); process.exitCode = 1; });
