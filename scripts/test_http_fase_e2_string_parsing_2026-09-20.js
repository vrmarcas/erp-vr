// PROD_MUTATING_TEST
/**
 * ⚠️  ESTE SCRIPT ALTERA PRODUÇÃO ⚠️
 * Liga/desliga `erp_vr/erp_config.valeriaV2Enabled` em Firestore de
 * produção real. Exige `ALLOW_PROD_MUTATION=1` no ambiente (ver
 * scripts/_prod_mutation_guard.js). NUNCA deve ser executado por um
 * sweep/varredura genérica de `scripts/test_*.js` — foi executar este
 * arquivo dentro de um sweep sem esse cuidado que deixou
 * `valeriaV2Enabled=true` preso em produção por ~41min em 2026-09-23.
 *
 * test_http_fase_e2_string_parsing_2026-09-20.js — ValerIA 2.0, Fase E.2.
 *
 * Teste HTTP real (seção 13 do pedido) contra a função `valeriaUpdateCatalogQualification`
 * JÁ DEPLOYADA com os novos parsers string→tipo (http_field_parsers.ts /
 * qualification_body_parser.ts). Para os 3 cenários da suíte de paridade
 * unitária, envia um par de requests reais — um com tipos NATIVOS, outro
 * com os MESMOS dados totalmente serializados como STRING (o único
 * formato comprovado no schema JSON do ChatVolt) — e compara a saída
 * relevante (resolutionType, matchedProduct, baseProduct, qualificationStatus,
 * nextAction, missingFields).
 *
 * Segue o mesmo procedimento auditado de ativação/desativação de
 * `data.valeriaV2Enabled` já usado nas Fases E.1/E.1.2 (snapshot antes,
 * altera SÓ esse campo, reconfirma integridade, desativa ao final —
 * inclusive em caso de erro, via fail-safe).
 */
'use strict';
const { execSync } = require('child_process');
const { getProdApp } = require('./_prod_admin_credential');
const { requireAllowProdMutation, installEmergencyRestoreOnSignal } = require('./_prod_mutation_guard');

requireAllowProdMutation(__filename);

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

async function seedAtendimento(db, id, nome) {
  await db.collection('atendimentos').doc(id).set({
    id, channel: 'erp_web', telefoneE164: TEL_1.replace(/\D/g, ''), nome,
    modoAtendimento: 'valeria', status: 'aberto', isTeste: true, createdAt: Date.now(), updatedAt: Date.now(),
    classificacao: 'nao_classificado', marca: 'indefinido', naoLidas: 0, criadoPorUid: 'script_test_fase_e2_2026-09-20',
  });
}

/** Só compara o que é contrato observável pela ValerIA. */
function relevant(data) {
  if (!data) return null;
  return {
    resolutionType: data.resolutionType,
    matchedProduct: data.matchedProduct,
    baseProduct: data.baseProduct,
    baseCatalogGroupId: data.baseCatalogGroupId,
    qualificationStatus: data.qualificationStatus,
    missingFields: data.missingFields,
    nextAction: data.nextAction,
  };
}

async function main() {
  const SECRET = getSecret();
  const db = getProdApp().firestore();

  installEmergencyRestoreOnSignal(() => setV2Flag(db, false), __filename);

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

  const convIds = [];

  // ═══ CENÁRIO 1 — caixa M + quantity ═══
  console.log('\n=== CENÁRIO 1 — caixa M + quantity: native vs. string ===');
  const CONV_1A = db.collection('atendimentos').doc().id;
  const CONV_1B = db.collection('atendimentos').doc().id;
  convIds.push(CONV_1A, CONV_1B);
  await seedAtendimento(db, CONV_1A, 'Cliente Teste E.2 (cenario1-native)');
  await seedAtendimento(db, CONV_1B, 'Cliente Teste E.2 (cenario1-string)');

  const r1a = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_1A, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M', quantity: 10 });
  const r1b = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_1B, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M', quantity: '10' });
  check('cenario 1: ambos HTTP 200', r1a.status === 200 && r1b.status === 200, { a: r1a.status, b: r1b.status });
  check('cenario 1: resolve C4TC3M em ambos', r1a.json?.data?.matchedProduct?.sku === 'C4TC3M' && r1b.json?.data?.matchedProduct?.sku === 'C4TC3M', { a: r1a.json?.data?.matchedProduct, b: r1b.json?.data?.matchedProduct });
  check('cenario 1: saida relevante IDENTICA (native === string)', JSON.stringify(relevant(r1a.json?.data)) === JSON.stringify(relevant(r1b.json?.data)), { native: relevant(r1a.json?.data), string: relevant(r1b.json?.data) });
  check('cenario 1: qualificationStatus = READY_CATALOG_DRAFT', r1a.json?.data?.qualificationStatus === 'READY_CATALOG_DRAFT', r1a.json?.data?.qualificationStatus);

  // ═══ CENÁRIO 2 — custom por dimensões exatas + customerExplicitlyRequestsCustom ═══
  console.log('\n=== CENÁRIO 2 — custom 35x25x10 + customerExplicitlyRequestsCustom: native vs. string ===');
  const CONV_2A = db.collection('atendimentos').doc().id;
  const CONV_2B = db.collection('atendimentos').doc().id;
  convIds.push(CONV_2A, CONV_2B);
  await seedAtendimento(db, CONV_2A, 'Cliente Teste E.2 (cenario2-native)');
  await seedAtendimento(db, CONV_2B, 'Cliente Teste E.2 (cenario2-string)');

  const r2a = await call(URL_UPDATE_QUAL, SECRET, {
    conversationId: CONV_2A, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', groupNameOrAlias: 'tampa de correr',
    exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 }, customerExplicitlyRequestsCustom: true,
  });
  const r2b = await call(URL_UPDATE_QUAL, SECRET, {
    conversationId: CONV_2B, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', groupNameOrAlias: 'tampa de correr',
    exactDimensionsCm: '{"largura":35,"altura":25,"profundidade":10}', customerExplicitlyRequestsCustom: 'true',
  });
  check('cenario 2: ambos HTTP 200', r2a.status === 200 && r2b.status === 200, { a: r2a.status, b: r2b.status });
  check('cenario 2: resolutionType=CUSTOM_REQUESTED em ambos', r2a.json?.data?.resolutionType === 'CUSTOM_REQUESTED' && r2b.json?.data?.resolutionType === 'CUSTOM_REQUESTED', { a: r2a.json?.data?.resolutionType, b: r2b.json?.data?.resolutionType });
  check('cenario 2: saida relevante IDENTICA (native === string)', JSON.stringify(relevant(r2a.json?.data)) === JSON.stringify(relevant(r2b.json?.data)), { native: relevant(r2a.json?.data), string: relevant(r2b.json?.data) });

  // ═══ CENÁRIO 3 — personalização comercial (array), 2 chamadas por variante ═══
  console.log('\n=== CENÁRIO 3 — personalization array: native vs. string ===');
  const CONV_3A = db.collection('atendimentos').doc().id;
  const CONV_3B = db.collection('atendimentos').doc().id;
  convIds.push(CONV_3A, CONV_3B);
  await seedAtendimento(db, CONV_3A, 'Cliente Teste E.2 (cenario3-native)');
  await seedAtendimento(db, CONV_3B, 'Cliente Teste E.2 (cenario3-string)');

  await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_3A, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M' });
  await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_3B, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M' });

  const r3a = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_3A, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', quantity: 5, personalization: ['logo_evento', 'nome_joao'] });
  const r3b = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_3B, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', quantity: '5', personalization: '["logo_evento","nome_joao"]' });
  check('cenario 3: ambos HTTP 200', r3a.status === 200 && r3b.status === 200, { a: r3a.status, b: r3b.status });
  check('cenario 3: saida relevante IDENTICA (native === string)', JSON.stringify(relevant(r3a.json?.data)) === JSON.stringify(relevant(r3b.json?.data)), { native: relevant(r3a.json?.data), string: relevant(r3b.json?.data) });

  const draftA3 = await db.collection('valeria_catalog_drafts').doc(CONV_3A).get();
  const draftB3 = await db.collection('valeria_catalog_drafts').doc(CONV_3B).get();
  check('cenario 3: personalization persistida igual em ambos os drafts', JSON.stringify(draftA3.data()?.fields?.personalization) === JSON.stringify(draftB3.data()?.fields?.personalization), { a: draftA3.data()?.fields?.personalization, b: draftB3.data()?.fields?.personalization });
  check('cenario 3: personalization = ["logo_evento","nome_joao"]', JSON.stringify(draftA3.data()?.fields?.personalization) === JSON.stringify(['logo_evento', 'nome_joao']), draftA3.data()?.fields?.personalization);

  // ═══ CENÁRIO EXTRA — validação de erro explícito (JSON inválido não derruba a function) ═══
  console.log('\n=== CENÁRIO EXTRA — JSON inválido em campo complexo → erro de validação, não 500 ===');
  const CONV_ERR = db.collection('atendimentos').doc().id;
  convIds.push(CONV_ERR);
  await seedAtendimento(db, CONV_ERR, 'Cliente Teste E.2 (validacao-erro)');
  const rErr = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_ERR, agentId: AGENT_ID, organizationId: ORG_ID, channelPhone: TEL_1, categoria: 'caixas', exactDimensionsCm: '{largura: 35 (json quebrado' });
  check('JSON inválido → HTTP 400 (VALIDATION_ERROR), nunca 500', rErr.status === 400 && rErr.json?.error?.code === 'VALIDATION_ERROR', { status: rErr.status, body: rErr.json });

  // ═══ DESATIVAR ═══
  console.log('\n=== Retornando data.valeriaV2Enabled=false ===');
  const flagFinal = await setV2Flag(db, false);
  check('flag final = false (releitura real)', flagFinal === false, flagFinal);

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  console.log('conversationIds de teste criados (isTeste:true):', convIds.join(', '));
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
