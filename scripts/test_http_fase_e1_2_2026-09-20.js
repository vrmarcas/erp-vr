/**
 * test_http_fase_e1_2_2026-09-20.js — ValerIA 2.0, Fase E.1.2.
 *
 * Bateria HTTP MÍNIMA pós-hardening, contra as Tools deployadas reais:
 *   TESTE 1 — multi-turno custom: M → 35x25x10 → CUSTOM_REQUESTED com
 *             baseProductId/baseProductSku=C4TC3M reais (não mais null).
 *   TESTE 2 — draft Vitre completo → vitre_orcamentos.isTest=true.
 *   TESTE 3 — mesma auditoria de derivação (não confia em nenhum sinal do
 *             caller para isTest).
 *
 * Segue o mesmo procedimento auditado de ativação/desativação da flag já
 * usado na Fase E.1 (snapshot, altera SÓ data.valeriaV2Enabled, reconfirma
 * integridade, desativa ao final — inclusive em caso de erro).
 */
'use strict';
const { execSync } = require('child_process');
const { getProdApp } = require('./_prod_admin_credential');

const BASE = 'https://us-central1-erp-vrmarcas.cloudfunctions.net';
const URL_UPDATE_QUAL = `${BASE}/valeriaUpdateCatalogQualification`;
const TEL_1 = '+5562999396135';

let passed = 0, failed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  ✅', label); }
  else { failed++; console.log('  ❌', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function getSecret() {
  return execSync('gcloud secrets versions access latest --secret=VALERIA_BEARER_SECRET --project=erp-vrmarcas', { encoding: 'utf8' }).trim();
}

async function call(url, secret, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function setV2Flag(db, value) {
  const ref = db.collection('erp_vr').doc('erp_config');
  const doc = await ref.get();
  const parsed = JSON.parse(doc.data().data);
  parsed.valeriaV2Enabled = value;
  await ref.update({ data: JSON.stringify(parsed) });
  const doc2 = await ref.get();
  return JSON.parse(doc2.data().data).valeriaV2Enabled;
}

async function main() {
  const SECRET = getSecret();
  const db = getProdApp().firestore();

  const agentsDoc = await db.collection('erp_vr').doc('valeria_authorized_agents').get();
  const agent = agentsDoc.data().agents[0];
  const AGENT_ID = agent.agentId;
  const ORG_ID = agent.organizationId;

  console.log('=== Snapshot antes da alteração ===');
  const cfgAntes = await db.collection('erp_vr').doc('erp_config').get();
  const dataAntes = JSON.parse(cfgAntes.data().data);
  check('flag inicial = false (estado seguro)', dataAntes.valeriaV2Enabled === false, dataAntes.valeriaV2Enabled);

  console.log('\n=== Ativando data.valeriaV2Enabled=true (só este campo) ===');
  const flagOn = await setV2Flag(db, true);
  check('flag ativada = true (releitura real)', flagOn === true, flagOn);
  const cfgDepois = await db.collection('erp_vr').doc('erp_config').get();
  const dataDepois = JSON.parse(cfgDepois.data().data);
  const outrosCamposMudaram = Object.keys(dataAntes).filter((k) => k !== 'valeriaV2Enabled' && JSON.stringify(dataAntes[k]) !== JSON.stringify(dataDepois[k]));
  check('nenhum outro campo de data mudou', outrosCamposMudaram.length === 0, outrosCamposMudaram);

  // ═══ TESTE 1 — MULTI-TURNO CUSTOM ═══
  console.log('\n=== TESTE 1 — multi-turno: M → 35x25x10 → CUSTOM_REQUESTED com base real ===');
  const CONV_1 = db.collection('atendimentos').doc().id;
  await db.collection('atendimentos').doc(CONV_1).set({
    id: CONV_1, channel: 'erp_web', telefoneE164: TEL_1.replace(/\D/g, ''), nome: 'Cliente Teste E.1.2 (multiturno)',
    modoAtendimento: 'valeria', status: 'aberto', isTeste: true, createdAt: Date.now(), updatedAt: Date.now(),
    classificacao: 'nao_classificado', marca: 'indefinido', naoLidas: 0, criadoPorUid: 'script_test_fase_e1_2_2026-09-20',
  });
  const t1 = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_1, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M' });
  check('turno 1: resolve C4TC3M', t1.json?.data?.matchedProduct?.sku === 'C4TC3M', t1.json?.data);

  const t2 = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_1, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 } });
  const d2 = t2.json?.data;
  check('turno 2: CUSTOM_REQUESTED (não mais CUSTOM_REQUIRED)', d2?.resolutionType === 'CUSTOM_REQUESTED', d2?.resolutionType);
  check('turno 2: baseCatalogGroupId correto', d2?.baseCatalogGroupId === 'caixa_tampa_de_correr', d2?.baseCatalogGroupId);
  check('turno 2: baseProduct.id=C4TC3M REAL (não mais null)', d2?.baseProduct?.id === 'C4TC3M', d2?.baseProduct);
  check('turno 2: baseProduct.sku=C4TC3M REAL', d2?.baseProduct?.sku === 'C4TC3M', d2?.baseProduct);

  const briefingDoc = await db.collection('valeria_technical_briefings').doc(CONV_1).get();
  check('TechnicalBriefing recebeu os 3 campos de base', briefingDoc.exists && briefingDoc.data()?.baseCatalogGroupId === 'caixa_tampa_de_correr' && briefingDoc.data()?.baseProductId === 'C4TC3M' && briefingDoc.data()?.baseProductSku === 'C4TC3M', briefingDoc.exists ? briefingDoc.data() : null);
  check('TechnicalBriefing.isTest=true (novo campo)', briefingDoc.exists && briefingDoc.data()?.isTest === true, briefingDoc.exists ? briefingDoc.data()?.isTest : null);

  const draftDoc1 = await db.collection('valeria_catalog_drafts').doc(CONV_1).get();
  check('valeria_catalog_drafts.isTest=true', draftDoc1.exists && draftDoc1.data()?.isTest === true, draftDoc1.exists ? draftDoc1.data()?.isTest : null);

  // ═══ TESTE 2 — DRAFT VITRE COMPLETO, isTest=true ═══
  console.log('\n=== TESTE 2 — produto padrão completo → vitre_orcamentos.isTest=true ===');
  const CONV_2 = db.collection('atendimentos').doc().id;
  await db.collection('atendimentos').doc(CONV_2).set({
    id: CONV_2, channel: 'erp_web', telefoneE164: TEL_1.replace(/\D/g, ''), nome: 'Cliente Teste E.1.2 (draft)',
    modoAtendimento: 'valeria', status: 'aberto', isTeste: true, createdAt: Date.now(), updatedAt: Date.now(),
    classificacao: 'nao_classificado', marca: 'indefinido', naoLidas: 0, criadoPorUid: 'script_test_fase_e1_2_2026-09-20',
  });
  await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_2, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'P' });
  const t2b = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_2, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'P', quantity: 3 });
  check('draft completo: READY_CATALOG_DRAFT', t2b.json?.data?.qualificationStatus === 'READY_CATALOG_DRAFT', t2b.json?.data?.qualificationStatus);

  const draftVitre = await db.collection('vitre_orcamentos').doc(`valeria2_catalog_${CONV_2}`).get();
  check('vitre_orcamentos.isTest=true (achado corrigido)', draftVitre.exists && draftVitre.data()?.isTest === true, draftVitre.exists ? draftVitre.data()?.isTest : null);
  check('vitre_orcamentos.status continua rascunho (defesa em profundidade, camada 1 preservada)', draftVitre.exists && draftVitre.data()?.status === 'rascunho', draftVitre.exists ? draftVitre.data()?.status : null);

  // ═══ TESTE 3 — DERIVAÇÃO NUNCA CONFIA NO CALLER ═══
  console.log('\n=== TESTE 3 — isTest=false forçado no body é ignorado (deriva do atendimento real) ===');
  const t3 = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_2, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'P', quantity: 3, isTest: false });
  check('repetição com isTest=false forçado no body → continua OK (campo ignorado, não é lido por nenhum signal)', t3.status === 200, t3.status);
  const draftVitreRe = await db.collection('vitre_orcamentos').doc(`valeria2_catalog_${CONV_2}`).get();
  check('vitre_orcamentos.isTest continua true mesmo após body tentar isTest=false', draftVitreRe.data()?.isTest === true, draftVitreRe.data()?.isTest);

  // ═══ DESATIVAR ═══
  console.log('\n=== Retornando data.valeriaV2Enabled=false ===');
  const flagFinal = await setV2Flag(db, false);
  check('flag final = false (releitura real)', flagFinal === false, flagFinal);

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  console.log('conversationIds de teste criados (isTeste:true):', CONV_1, CONV_2);
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    console.error('ERRO FATAL:', e);
    try {
      const { getProdApp } = require('./_prod_admin_credential');
      const db = getProdApp().firestore();
      const ref = db.collection('erp_vr').doc('erp_config');
      const doc = await ref.get();
      const parsed = JSON.parse(doc.data().data);
      parsed.valeriaV2Enabled = false;
      await ref.update({ data: JSON.stringify(parsed) });
      console.error('[FAIL-SAFE] data.valeriaV2Enabled forçado para false.');
    } catch (e2) {
      console.error('[FAIL-SAFE] FALHOU AO DESLIGAR A FLAG — AÇÃO MANUAL URGENTE:', e2);
    }
    process.exit(1);
  });
