/**
 * send_password_setup_email.js
 * Envia (de verdade, via e-mail) o link oficial de definição de senha do
 * Firebase Auth para UMA conta específica, recém-criada sem senha.
 *
 * Diferença para auth.generatePasswordResetLink() (usado por
 * create_missing_erp_users.js): aquele método só GERA o link e prova que o
 * fluxo funciona, mas nunca o envia. Este script usa o mesmo endpoint REST
 * que o Client SDK usa internamente (accounts:sendOobCode) para efetivamente
 * disparar o e-mail — sem NUNCA solicitar, ler, logar, gravar ou devolver o
 * link em si (returnOobLink nunca é enviado como true, então o próprio
 * Firebase nunca inclui o link na resposta).
 *
 * Segurança:
 *   - Alvo é SEMPRE explícito via --email=; nunca "manda para todo mundo".
 *   - Só envia se o e-mail estiver em DECISOES_HUMANAS com acao:'criar-conta'
 *     E a conta já existir no Auth (senão não há para quem enviar).
 *   - Usa a Web API key de produção lida diretamente de index.html (a mesma
 *     chave pública já embutida no site; não é segredo, mas evita duplicá-la
 *     em texto solto num segundo arquivo).
 *   - Nunca imprime a resposta bruta da API (que, mesmo sem o link, pode
 *     conter o e-mail em claro — já mascarado nos logs deste script).
 *
 * Uso:
 *   node scripts/send_password_setup_email.js --email=contato@aprovain.com \
 *     --apply --confirm-project=erp-vrmarcas --allow-production \
 *     --authorization=FASE_F_USERS_2026_08_05
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { DECISOES_HUMANAS } = require('./lib/user_decisions');

const APPLY = process.argv.includes('--apply');
const EMAIL_ARG = process.argv.find(a => a.startsWith('--email='));
const TARGET_EMAIL = EMAIL_ARG ? EMAIL_ARG.split('=')[1] : null;
const CONFIRM_PROJECT_ARG = process.argv.find(a => a.startsWith('--confirm-project='));
const CONFIRM_PROJECT = CONFIRM_PROJECT_ARG ? CONFIRM_PROJECT_ARG.split('=')[1] : null;

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***@***';
  return local[0] + '***@' + domain;
}

function extrairWebApiKeyProducao() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const blocoMatch = html.match(/\}\s*:\s*\{[^}]*projectId:\s*"erp-vrmarcas"[^}]*\}/);
  if (!blocoMatch) throw new Error('Não foi possível localizar o bloco firebaseConfig de produção em index.html');
  const keyMatch = blocoMatch[0].match(/apiKey:\s*"([^"]+)"/);
  if (!keyMatch) throw new Error('apiKey não encontrada no bloco firebaseConfig de produção');
  return keyMatch[1];
}

function sendOobCode(apiKey, email) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ requestType: 'PASSWORD_RESET', email }); // sem returnOobLink -- nunca pedimos o link de volta
    const req = https.request({
      hostname: 'identitytoolkit.googleapis.com',
      path: '/v1/accounts:sendOobCode?key=' + apiKey,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(true);
        else {
          let motivo = 'HTTP ' + res.statusCode;
          try { motivo = JSON.parse(data).error.message; } catch (e) {}
          reject(new Error(motivo));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!TARGET_EMAIL) { console.error('❌ --email=<endereco> é obrigatório.'); process.exit(1); }
  if (APPLY && !CONFIRM_PROJECT) { console.error('❌ --apply exige --confirm-project=<projectId>.'); process.exit(1); }

  const decisao = DECISOES_HUMANAS.find(d => d.email.toLowerCase() === TARGET_EMAIL.toLowerCase() && d.acao === 'criar-conta');
  if (!decisao) {
    console.error('❌ ' + maskEmail(TARGET_EMAIL) + ' não é uma conta acao:"criar-conta" em DECISOES_HUMANAS — recusando enviar. Nada foi feito.');
    process.exit(1);
  }

  if (APPLY && CONFIRM_PROJECT === 'erp-vrmarcas') {
    const { flagsDeProducaoPresentes, validarEstadoEsperado, initializeAppComModoCorreto } = require('./lib/production_safety');
    const flags = flagsDeProducaoPresentes(process.argv);
    if (!flags.ok) { console.error('❌ Produção exige --allow-production E --authorization=<token> simultaneamente. Abortando.'); process.exit(1); }

    const admin = require('firebase-admin');
    initializeAppComModoCorreto(admin, CONFIRM_PROJECT, process.argv);
    const auth = admin.auth();
    const db = admin.firestore();

    let allUsers = [], pt;
    do { const r = await auth.listUsers(1000, pt); allUsers = allUsers.concat(r.users.map(u=>({uid:u.uid,email:u.email}))); pt = r.pageToken; } while (pt);
    const norm = await db.collection('erp_vr_usuarios').get();
    const check = validarEstadoEsperado(allUsers, new Set(norm.docs.map(d=>d.id)), null);
    console.log('=== validação de estado esperado (produção) ===');
    console.log(JSON.stringify(check.resumo));
    if (!check.ok) { console.error('❌ Estado real diverge do esperado — abortando ANTES de enviar o e-mail:'); check.erros.forEach(e => console.error('  -', e)); process.exit(1); }

    let authUser;
    try { authUser = await auth.getUserByEmail(TARGET_EMAIL); }
    catch (e) { console.error('❌ ' + maskEmail(TARGET_EMAIL) + ' ainda não existe no Auth — crie a conta primeiro com create_missing_erp_users.js.'); process.exit(1); }
    if (authUser.disabled) { console.error('❌ ' + maskEmail(TARGET_EMAIL) + ' está desabilitada no Auth — recusando enviar e-mail de definição de senha.'); process.exit(1); }
    console.log('✅ estado confere — conta existe, habilitada, uid ' + authUser.uid.slice(0,6) + '…\n');
  }

  const apiKey = extrairWebApiKeyProducao();

  if (!APPLY) {
    console.log('[dry-run] enviaria e-mail oficial de definição de senha para', maskEmail(TARGET_EMAIL), '(projeto de produção, via accounts:sendOobCode)');
    process.exit(0);
  }

  console.log('=== ENVIANDO — projeto:', CONFIRM_PROJECT, '===');
  await sendOobCode(apiKey, TARGET_EMAIL);
  console.log('✅ e-mail oficial de definição de senha enviado para', maskEmail(TARGET_EMAIL), '(link NUNCA solicitado/exibido/logado por este script)');
  process.exit(0);
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
