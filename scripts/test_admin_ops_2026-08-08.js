/**
 * test_admin_ops_2026-08-08.js
 *
 * RODADA 3.1: prova end-to-end do caminho administrativo remoto
 * (functions/src/admin_ops.ts + scripts/apply_via_admin_function.js) usado
 * quando o Admin SDK local não tem GOOGLE_APPLICATION_CREDENTIALS para
 * escrever direto no Firestore. Roda os scripts reais via child_process
 * contra o Functions Emulator (não reimplementa a lógica), igual ao padrão
 * de test_import_historico_financeiro_2026-08-08.js.
 *
 * Cobre: autenticação por Bearer secret, seed de bancos idempotente,
 * apply/idempotência/rollback do histórico via HTTP, e que status errado
 * de auth nunca é aceito.
 *
 * Uso: node scripts/test_admin_ops_2026-08-08.js
 * Pré-requisito: Functions Emulator :5001, Firestore Emulator :8080,
 * functions/.env com ADMIN_ONE_TIME_SECRET definido (carregado pelo
 * próprio Emulator ao subir).
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const http = require('http');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }

var SCRIPT = path.join(__dirname, 'apply_via_admin_function.js');
var DATA_DIR = path.join(__dirname, '..', 'data-import', 'vr-historico-2018-2026');
var FN_URL = 'http://localhost:5001/demo-erp-homolog/us-central1/adminOneTimeOps';

function readSecret() {
  // .env.local é o que o Functions Emulator carrega para testes locais
  // (nunca deployado); .env é a variante genérica/legada — checa os dois.
  var candidatos = [path.join(__dirname, '..', 'functions', '.env.local'), path.join(__dirname, '..', 'functions', '.env')];
  for (var i = 0; i < candidatos.length; i++) {
    if (fs.existsSync(candidatos[i])) {
      var m = fs.readFileSync(candidatos[i], 'utf8').match(/ADMIN_ONE_TIME_SECRET=(.+)/);
      if (m) return m[1].trim();
    }
  }
  return null;
}
function runCli(args, secret) {
  try {
    var out = execFileSync('node', [SCRIPT].concat(args, ['--mock']), { encoding: 'utf8', env: Object.assign({}, process.env, { ADMIN_ONE_TIME_SECRET: secret || readSecret() }) });
    return { ok: true, out: out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}
function httpRaw(body, bearer) {
  return new Promise((resolve, reject) => {
    var data = JSON.stringify(body);
    var req = http.request({ hostname: 'localhost', port: 5001, path: '/demo-erp-homolog/us-central1/adminOneTimeOps', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: bearer ? 'Bearer ' + bearer : '' } }, (res) => {
      var out = ''; res.on('data', (c) => out += c); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
function statusOnce() {
  var r = runCli(['--status']);
  var jsonStart = r.out.indexOf('{');
  return JSON.parse(r.out.slice(jsonStart));
}

console.log('\n=== RODADA 3.1 — Caminho administrativo remoto (Cloud Function) para seed/histórico ===\n');

(async function main() {
  var secret = readSecret();
  if (!secret) {
    console.log('  ⏭️  functions/.env com ADMIN_ONE_TIME_SECRET ausente neste ambiente — suíte pulada (não é falha de código).');
    console.log('\n=== resultado ===\npassed=0 failed=0 (pulado)');
    return;
  }

  await test('1. Sem Authorization header → 401', async function () {
    var r = await httpRaw({ op: 'status' }, null);
    assertEq(r.status, 401);
  });

  await test('2. Bearer secret errado → 401', async function () {
    var r = await httpRaw({ op: 'status' }, 'secret-completamente-errado');
    assertEq(r.status, 401);
  });

  await test('3. op desconhecida → 400', async function () {
    var r = await httpRaw({ op: 'apagar_tudo' }, secret);
    assertEq(r.status, 400);
  });

  // reset determinístico do estado antes dos testes de negócio
  var st0 = statusOnce();
  if (st0.contasVr && st0.contasVr.length) {
    // não há endpoint de "unseed" (por design — seed é aditivo/idempotente,
    // nunca remove); segue o teste tolerando contas já presentes de execuções anteriores.
  }

  await test('4. seed_bancos via HTTP é idempotente — rodar 2x não duplica Bradesco/Itaú', async function () {
    runCli(['--seed-bancos']);
    runCli(['--seed-bancos']);
    var st = statusOnce();
    var nomes = st.contasVr.map(function (b) { return b.nome; });
    var bradescoCount = nomes.filter(function (n) { return n === 'Bradesco'; }).length;
    var itauCount = nomes.filter(function (n) { return n === 'Itaú'; }).length;
    assertEq(bradescoCount, 1, 'Bradesco aparece exatamente 1 vez mesmo após seed 2x');
    assertEq(itauCount, 1, 'Itaú aparece exatamente 1 vez mesmo após seed 2x');
  });

  if (!fs.existsSync(DATA_DIR)) {
    console.log('  ⏭️  pacote data-import/vr-historico-2018-2026/ ausente — testes de histórico via admin function pulados (dados privados, gitignored).');
  } else {
    // reset determinístico dos hist_* antes desta seção — evita contaminação
    // por estado residual de execuções manuais anteriores no mesmo Emulator
    // de longa duração (achado real ao rodar esta suíte pela 1ª vez).
    var HIST_DOCS = ['hist_mensal', 'hist_nf', 'hist_caixa_diario', 'hist_movimentacoes', 'hist_despesas', 'hist_import_runs'];
    for (var h = 0; h < HIST_DOCS.length; h++) {
      await db.collection('erp_vr').doc(HIST_DOCS[h]).set({ data: JSON.stringify({}), ts: Date.now() });
    }
    var runIdCapturado = null;

    await test('5. apply-historico via Cloud Function grava as 103 competências de hist_mensal', async function () {
      var r = runCli(['--apply-historico']);
      assertTruthy(r.ok, 'apply-historico não deve falhar — saída: ' + r.out);
      // Usa o log final "APLICADO remotamente", não o log de dry-run —
      // aquele aparece dentro de "(importRunId=X)..." e um regex genérico
      // \S+ capturaria o ")..." final junto (achado real desta suíte).
      var m = r.out.match(/APLICADO remotamente — importRunId=(\S+)/);
      assertTruthy(m, 'saída deveria conter importRunId — ' + r.out.slice(-300));
      runIdCapturado = m[1];
      var st = statusOnce();
      assertEq(st.hist.hist_mensal, 103);
      assertEq(st.hist.hist_despesas, 528);
    });

    await test('6. reaplicar via Cloud Function não duplica (idempotência real por id_importacao)', async function () {
      var r = runCli(['--apply-historico']);
      assertTruthy(r.ok);
      assertTruthy(r.out.indexOf('0 novo(s), 103 já existiam') >= 0, 'segunda aplicação: 0 novos em hist_mensal — saída: ' + r.out);
      var st = statusOnce();
      assertEq(st.hist.hist_mensal, 103, 'total não cresce ao reaplicar');
    });

    await test('7. rollback via Cloud Function remove só o lote do importRunId, hist volta a 0', async function () {
      assertTruthy(runIdCapturado, 'precisa ter capturado um importRunId no teste 5');
      var r = runCli(['--rollback=' + runIdCapturado]);
      assertTruthy(r.ok, 'rollback não deve falhar — saída: ' + r.out);
      var st = statusOnce();
      assertEq(st.hist.hist_mensal, 0, 'hist_mensal volta a 0 após rollback do único lote aplicado');
      assertEq(st.hist.hist_despesas, 0);
    });
  }

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
