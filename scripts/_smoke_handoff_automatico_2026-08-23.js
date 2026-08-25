/**
 * _smoke_handoff_automatico_2026-08-23.js — verificação manual em produção.
 *
 * Simula exatamente o que a ValerIA faria ao chamar a nova Tool
 * solicitar_atendimento_humano (atdSolicitarHumanoValeria): lê o mesmo
 * bearer que qualquer Tool HTTP já usa (erp_vr/valeria_config.secret, via
 * Admin SDK — nunca exposto ao client), e faz o mesmo POST que o Chatvolt
 * faria. Não é um teste automatizado (não entra na suíte leve) — é uma
 * ferramenta de smoke test manual, mesmo padrão de _live_verify_* e
 * _audit_orc* já usados neste projeto.
 *
 * Uso: node scripts/_smoke_handoff_automatico_2026-08-23.js <atendimentoId> ["motivo"]
 */
'use strict';
const { getProdApp } = require('./_prod_admin_credential');
const https = require('https');

async function main() {
  const atdId = process.argv[2];
  if (!atdId) { console.error('Uso: node _smoke_handoff_automatico_2026-08-23.js <atendimentoId> ["motivo"]'); process.exit(1); }
  const motivo = process.argv[3] || 'Cliente solicitou falar com uma pessoa.';

  const db = getProdApp().firestore();
  const cfgSnap = await db.collection('erp_vr').doc('valeria_config').get();
  const secret = JSON.parse(cfgSnap.data().data).secret;

  const requestId = 'smoke_' + Date.now();
  const payload = JSON.stringify({
    conversationId: atdId,
    organizationId: 'cmmmk6oqi02hmlcxugbddv62q',
    requestId,
    motivo,
  });

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      'https://us-central1-erp-vrmarcas.cloudfunctions.net/atdSolicitarHumanoValeria',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + secret,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  console.log(JSON.stringify({ status: result.status, body: JSON.parse(result.body), requestId }, null, 2));
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
