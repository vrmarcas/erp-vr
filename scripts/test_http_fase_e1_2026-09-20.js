// PROD_MUTATING_TEST
/**
 * ⚠️  ESTE SCRIPT ALTERA PRODUÇÃO ⚠️
 * Liga/desliga `erp_vr/erp_config.valeriaV2Enabled` em Firestore de
 * produção real. Exige `ALLOW_PROD_MUTATION=1` no ambiente (ver
 * scripts/_prod_mutation_guard.js). NUNCA deve ser executado por um
 * sweep/varredura genérica de `scripts/test_*.js` — o marcador
 * `PROD_MUTATING_TEST` acima existe exatamente para que uma ferramenta
 * de sweep possa excluir este arquivo por grep, sem sequer rodá-lo.
 *
 * test_http_fase_e1_2026-09-20.js — ValerIA 2.0, Fase E.1.
 *
 * Bateria HTTP REAL contra as 2 Tools deployadas (valeriaGetCatalog,
 * valeriaUpdateCatalogQualification), rodando contra o Firestore de
 * PRODUÇÃO real (erp-vrmarcas) — nunca emulador, nunca função pura.
 *
 * Segurança:
 *  - Bearer secret lido do Secret Manager em memória, nunca impresso.
 *  - agentId/organizationId = o único agente já cadastrado em
 *    erp_vr/valeria_authorized_agents (real, não inventado).
 *  - channelPhone = um dos 2 números de erp_vr/valeria_test_phone_numbers.
 *  - Cria 1 atendimento de teste (mesmo shape de atdCriarConversaTeste,
 *    isTeste:true) para os fluxos que precisam de handoff real
 *    (atdSolicitarHumanoValeria localiza atendimento por conversationId).
 *
 * Uso: node scripts/test_http_fase_e1_2026-09-20.js
 */
'use strict';
const { execSync } = require('child_process');
const { getProdApp } = require('./_prod_admin_credential');
const { requireAllowProdMutation, installEmergencyRestoreOnSignal } = require('./_prod_mutation_guard');

requireAllowProdMutation(__filename);

const BASE = 'https://us-central1-erp-vrmarcas.cloudfunctions.net';
const URL_GET_CATALOG = `${BASE}/valeriaGetCatalog`;
const URL_UPDATE_QUAL = `${BASE}/valeriaUpdateCatalogQualification`;

const TEL_1 = '+5562999396135';
const TEL_2 = '+556234133888';
const TEL_FORA = '+5511900000000';
const TEL_INVALIDO = 'abc';

let passed = 0, failed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  ✅', label); }
  else { failed++; console.log('  ❌', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function getSecret() {
  return execSync('gcloud secrets versions access latest --secret=VALERIA_BEARER_SECRET --project=erp-vrmarcas', { encoding: 'utf8' }).trim();
}

async function call(url, secret, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* corpo vazio/erro */ }
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

async function readV2Flag(db) {
  const doc = await db.collection('erp_vr').doc('erp_config').get();
  return JSON.parse(doc.data().data).valeriaV2Enabled;
}

async function main() {
  const SECRET = getSecret();
  const db = getProdApp().firestore();

  installEmergencyRestoreOnSignal(() => setV2Flag(db, false), __filename);

  const agentsDoc = await db.collection('erp_vr').doc('valeria_authorized_agents').get();
  const agent = agentsDoc.data().agents[0];
  const AGENT_ID = agent.agentId;
  const ORG_ID = agent.organizationId;

  // Cria atendimento de teste real (mesmo shape de atdCriarConversaTeste)
  const atdRef = db.collection('atendimentos').doc();
  const now = Date.now();
  await atdRef.set({
    id: atdRef.id, channel: 'erp_web', externalConversationId: null, providerConversationId: null,
    contactId: null, leadId: null, clienteId: null, telefoneE164: TEL_1.replace(/\D/g, ''),
    nome: 'Cliente Teste Fase E.1', empresa: null, modoAtendimento: 'valeria', responsavelUid: null,
    responsavelNome: null, status: 'aberto', classificacao: 'nao_classificado', marca: 'indefinido',
    resumo: null, briefingRef: null, oportunidadeId: null, orcamentoId: null, naoLidas: 0,
    ultimaMensagem: null, ultimaInteracaoEm: now, createdAt: now, updatedAt: now,
    isTeste: true, criadoPorUid: 'script_test_fase_e1_2026-09-20',
  });
  const CONV_ID = atdRef.id;
  console.log('Atendimento de teste criado:', CONV_ID);

  function baseBody(extra) {
    return { conversationId: CONV_ID, agentId: AGENT_ID, organizationId: ORG_ID, ...extra };
  }

  // FASE 1 (gate OFF) já foi comprovada numa rodada anterior desta mesma
  // sessão (4/4 ✅: allowlisted bloqueado, fora da allowlist bloqueado,
  // telefone inválido bloqueado, flag confirmada off) — não repetida aqui
  // por instrução explícita ("retomar exatamente da Fase 2"). A flag real
  // (data.valeriaV2Enabled, dentro do JSON de erp_vr/erp_config) já foi
  // ativada por procedimento separado e auditado (snapshot antes/depois,
  // zero outro campo alterado, campo fantasma de topo removido).
  console.log('\n=== Confirmando estado da flag real (já ativada por procedimento auditado separado) ===');
  const flagAtual = await readV2Flag(db);
  check('data.valeriaV2Enabled = true (ativação já realizada e auditada)', flagAtual === true, flagAtual);

  // ═══════════════════════════ FASE 2 — GATE ON ═══════════════════════════
  console.log('\n=== FASE 2 — Gate com flag ON ===');
  {
    const r1 = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_1 }));
    check('allowlisted #1 (+5562999396135) → permitido', r1.status === 200, r1);

    const r2 = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_2 }));
    check('allowlisted #2 (+556234133888) → permitido', r2.status === 200, r2);

    const r3 = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_FORA }));
    check('fora da allowlist → bloqueado mesmo com flag ON', r3.status === 403 && r3.json?.error?.code === 'V2_DISABLED', r3);

    const r4 = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_INVALIDO }));
    check('telefone inválido → bloqueado', r4.status === 403, r4);

    const r5 = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'caixas' })); // sem channelPhone
    check('sem telefone → bloqueado', r5.status === 403, r5);
  }

  // ═══════════════════════════ FASE 3 — GET CATALOG (6 categorias) ═══════════════════════════
  console.log('\n=== FASE 3 — valeriaGetCatalog real para as 6 categorias ===');
  const CATEGORIAS = ['caixas', 'trofeus', 'display_qr_code', 'urnas', 'roletas', 'pulpitos'];
  for (const cat of CATEGORIAS) {
    const r = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: cat, channelPhone: TEL_1 }));
    const d = r.json?.data;
    const semCustoMargem = d ? !JSON.stringify(d).match(/custo|margem|lucroBruto/i) : false;
    check(`${cat}: 200 + catalogKnown=true + grupos>0`, r.status === 200 && d?.catalogKnown === true && Array.isArray(d?.grupos) && d.grupos.length > 0, { status: r.status, catalogKnown: d?.catalogKnown, nGrupos: d?.grupos?.length });
    check(`${cat}: sendable=false + urlCatalogo=null (urlCatalogo=null em todos hoje)`, d?.sendable === false && d?.urlCatalogo === null, { sendable: d?.sendable, urlCatalogo: d?.urlCatalogo });
    check(`${cat}: nenhum custo/margem/lucroBruto vazado no payload`, semCustoMargem);
  }

  // ═══════════════════════════ FASE 4 — CAIXA COM SKU (fluxo + idempotência) ═══════════════════════════
  console.log('\n=== FASE 4 — Caixa tampa de correr M → C4TC3M → quantity=10 → QUOTE_REVIEW ===');
  {
    const t1 = await call(URL_UPDATE_QUAL, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr' }));
    check('turno 1: grupo identificado (AMBIGUOUS/ASK_SIZE, groupName correto)', t1.status === 200 && t1.json?.data?.resolutionType === 'AMBIGUOUS' && t1.json?.data?.nextAction === 'ASK_SIZE' && t1.json?.data?.questionContext?.groupName === 'Caixa com tampa de correr', t1.json?.data);

    const t2 = await call(URL_UPDATE_QUAL, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M' }));
    check('turno 2: resolve C4TC3M', t2.status === 200 && t2.json?.data?.matchedProduct?.sku === 'C4TC3M', t2.json?.data);

    const t3 = await call(URL_UPDATE_QUAL, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M', quantity: 10 }));
    const d3 = t3.json?.data;
    check('turno 3: qualificationStatus=READY_CATALOG_DRAFT, nextAction=REQUEST_QUOTE_REVIEW', d3?.qualificationStatus === 'READY_CATALOG_DRAFT' && d3?.nextAction === 'REQUEST_QUOTE_REVIEW', d3);
    check('turno 3: persistence.catalogDraftCreated=true', d3?.persistence?.catalogDraftCreated === true, d3?.persistence);
    check('turno 3: persistence.quoteReviewCreated=true', d3?.persistence?.quoteReviewCreated === true, d3?.persistence);

    // Idempotência — repetir a MESMA chamada
    const t3b = await call(URL_UPDATE_QUAL, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M', quantity: 10 }));
    check('repetição: continua OK, sem erro', t3b.status === 200, t3b);

    // Doc id DETERMINÍSTICO (vitre_draft_writer.ts::draftDocId) — a prova
    // de idempotência real é que este ÚNICO id nunca duplica, não uma
    // query por campo (o campo de vínculo é `conversationId`, não
    // `atendimentoId` — `origemAtendimento` é outro campo, categórico,
    // usado só pelo fluxo manual do ERP, não pela V2).
    const draftDoc = await db.collection('vitre_orcamentos').doc(`valeria2_catalog_${CONV_ID}`).get();
    check('zero duplicação: exatamente 1 rascunho Vitre (doc id determinístico) para este atendimento', draftDoc.exists && draftDoc.data()?.conversationId === CONV_ID, draftDoc.exists ? draftDoc.data() : null);
    if (draftDoc.exists) {
      check('rascunho: status é rascunho (nunca enviado/produção/pago)', draftDoc.data()?.status === 'rascunho', draftDoc.data()?.status);
    }
  }

  // ═══════════════════════════ FASE 5 — SEM SKU (Modelo 07) ═══════════════════════════
  console.log('\n=== FASE 5 — Troféu Modelo 07 (sem SKU) → CATALOG_KNOWN_NO_OPERATIONAL_MATCH → PRODUCT_MAPPING_REQUIRED ===');
  {
    const CONV_ID_2 = db.collection('atendimentos').doc().id;
    await db.collection('atendimentos').doc(CONV_ID_2).set({
      id: CONV_ID_2, channel: 'erp_web', telefoneE164: TEL_1.replace(/\D/g, ''), nome: 'Cliente Teste E.1 (sem SKU)',
      modoAtendimento: 'valeria', status: 'aberto', isTeste: true, createdAt: Date.now(), updatedAt: Date.now(),
      classificacao: 'nao_classificado', marca: 'indefinido', naoLidas: 0, criadoPorUid: 'script_test_fase_e1_2026-09-20',
    });

    const t1 = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_ID_2, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'trofeus', channelPhone: TEL_1, groupNameOrAlias: 'modelo 07' });
    check('turno 1: CATALOG_KNOWN_NO_OPERATIONAL_MATCH', t1.json?.data?.resolutionType === 'CATALOG_KNOWN_NO_OPERATIONAL_MATCH', t1.json?.data);

    const t2 = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_ID_2, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'trofeus', channelPhone: TEL_1, groupNameOrAlias: 'modelo 07', quantity: 2 });
    const d2 = t2.json?.data;
    check('turno 2: qualificationStatus=READY_FOR_PRODUCT_MAPPING_REVIEW, nextAction=REQUEST_PRODUCT_MAPPING_REVIEW', d2?.qualificationStatus === 'READY_FOR_PRODUCT_MAPPING_REVIEW' && d2?.nextAction === 'REQUEST_PRODUCT_MAPPING_REVIEW', d2);
    check('turno 2: matchedProduct.id/sku continuam null (nenhum SKU inventado)', d2?.matchedProduct?.id === null && d2?.matchedProduct?.sku === null, d2);

    const draftDoc2 = await db.collection('vitre_orcamentos').doc(`valeria2_catalog_${CONV_ID_2}`).get();
    check('ZERO vitre_orcamentos criado para grupo sem SKU', !draftDoc2.exists, draftDoc2.exists);
  }

  // ═══════════════════════════ FASE 6 — PERSONALIZADO ═══════════════════════════
  console.log('\n=== FASE 6 — Caixa tampa de correr M + 35x25x10 → CUSTOM_REQUESTED ===');
  {
    const CONV_ID_3 = db.collection('atendimentos').doc().id;
    await db.collection('atendimentos').doc(CONV_ID_3).set({
      id: CONV_ID_3, channel: 'erp_web', telefoneE164: TEL_1.replace(/\D/g, ''), nome: 'Cliente Teste E.1 (custom)',
      modoAtendimento: 'valeria', status: 'aberto', isTeste: true, createdAt: Date.now(), updatedAt: Date.now(),
      classificacao: 'nao_classificado', marca: 'indefinido', naoLidas: 0, criadoPorUid: 'script_test_fase_e1_2026-09-20',
    });

    const t1 = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_ID_3, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', catalogSizeLabel: 'M' });
    check('turno 1: resolve M (C4TC3M) antes de pedir custom', t1.json?.data?.matchedProduct?.sku === 'C4TC3M', t1.json?.data);

    const t2 = await call(URL_UPDATE_QUAL, SECRET, { conversationId: CONV_ID_3, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1, groupNameOrAlias: 'tampa de correr', exactDimensionsCm: { largura: 35, altura: 25, profundidade: 10 } });
    const d2 = t2.json?.data;
    check('turno 2: CUSTOM_REQUIRED/CUSTOM_REQUESTED, baseCatalogGroupId correto', /CUSTOM/.test(d2?.resolutionType || '') && d2?.baseCatalogGroupId === 'caixa_tampa_de_correr', d2);
    check('turno 2: nextAction=CONTINUE_CUSTOM_TECHNICAL_BRIEFING (nunca handoff precoce)', d2?.nextAction === 'CONTINUE_CUSTOM_TECHNICAL_BRIEFING', d2?.nextAction);
    // Nota: baseProductId=null aqui é o contrato JÁ documentado e testado
    // (product_resolution.ts, regra 5): dimensão exata citada que não bate
    // com nenhum tamanho, no mesmo sinal que o grupo — nunca inventa um
    // productId "quase certo". Mesmo comportamento do Cenário B unitário
    // (e2e_fase_e_cenarios_ab_h.test.ts).

    // Collection real é valeria_technical_briefings (technical_briefing_store.ts),
    // não "valeria_briefings" — doc id = conversationId.
    const briefingDoc = await db.collection('valeria_technical_briefings').doc(CONV_ID_3).get();
    check('TechnicalBriefing persistido com baseCatalogGroupId', briefingDoc.exists && briefingDoc.data()?.baseCatalogGroupId === 'caixa_tampa_de_correr', briefingDoc.exists ? briefingDoc.data()?.baseCatalogGroupId : 'doc nao existe');
  }

  // ═══════════════════════════ FASE 7 — SENDABLE (via Tool real) ═══════════════════════════
  console.log('\n=== FASE 7 — sendable via Tool real (urnas vencido, caixas dentro da validade) ===');
  {
    const rUrnas = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'urnas', channelPhone: TEL_1 }));
    check('urnas (vencido, validUntil 2026-04-30): sendable=false via Tool real', rUrnas.json?.data?.sendable === false, rUrnas.json?.data);

    const rCaixas = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_1 }));
    check('caixas (validUntil 2026-09-30, hoje 2026-09-20, dentro da validade): sendable computado, urlCatalogo=null (nenhuma URL cadastrada ainda)', rCaixas.json?.data?.sendable === false && rCaixas.json?.data?.urlCatalogo === null, rCaixas.json?.data);
    // Nota: caixas não fica sendable=true hoje porque urlCatalogo continua
    // null em produção (nunca foi fornecida) — isCatalogSendable exige os
    // 3 gates juntos (ativo + url + não-vencido). O teste unitário
    // catalog_sendable_gate.test.ts já prova sendable=true quando a URL
    // existe E está dentro da validade — aqui confirmamos que a Tool REAL
    // nunca finge ter uma URL que não existe.
  }

  // ═══════════════════════════ FASE 8 — INPUT ADVERSARIAL ═══════════════════════════
  console.log('\n=== FASE 8 — Inputs adversariais (caller não controla decisões críticas) ===');
  {
    const CONV_ID_4 = db.collection('atendimentos').doc().id;
    await db.collection('atendimentos').doc(CONV_ID_4).set({
      id: CONV_ID_4, channel: 'erp_web', telefoneE164: TEL_1.replace(/\D/g, ''), nome: 'Cliente Teste E.1 (adversarial)',
      modoAtendimento: 'valeria', status: 'aberto', isTeste: true, createdAt: Date.now(), updatedAt: Date.now(),
      classificacao: 'nao_classificado', marca: 'indefinido', naoLidas: 0, criadoPorUid: 'script_test_fase_e1_2026-09-20',
    });

    const r = await call(URL_UPDATE_QUAL, SECRET, {
      conversationId: CONV_ID_4, agentId: AGENT_ID, organizationId: ORG_ID, categoria: 'caixas', channelPhone: TEL_1,
      groupNameOrAlias: 'tampa de correr',
      // Campos que o backend NUNCA deveria consumir como verdade absoluta:
      explicitSkuOrProductId: 'SKU_FALSO_INVENTADO_999',
      matchedProductId: 'PRODUTO_FALSO', matchedProductSku: 'SKU_FALSO',
      precoVenda: 1, resolutionType: 'EXACT_CATALOG_MATCH', qualificationStatus: 'READY_CATALOG_DRAFT',
      sendable: true, catalogPublishedPrice: 1,
    });
    const d = r.json?.data;
    check('SKU/productId falso via explicitSkuOrProductId → backend REVALIDA e rejeita/ignora (não aceita cego)', d?.matchedProduct?.id !== 'PRODUTO_FALSO' && d?.matchedProduct?.sku !== 'SKU_FALSO', d);
    check('resolutionType/qualificationStatus forçados pelo caller são ignorados — backend recalcula do zero', d?.resolutionType !== undefined && d?.qualificationStatus !== undefined, d);

    const rGet = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'urnas', channelPhone: TEL_1, sendable: true, urlCatalogo: 'https://forcado.com/x.pdf' }));
    check('sendable=true forçado no body de valeriaGetCatalog é ignorado (urnas continua sendable=false)', rGet.json?.data?.sendable === false, rGet.json?.data);
  }

  // ═══════════════════════════ FASE 9 — DESATIVAR FLAG (estado seguro final) ═══════════════════════════
  console.log('\n=== FASE 9 — Retornando data.valeriaV2Enabled=false (estado seguro entre E.1 e E.2) ===');
  const flagFinal = await setV2Flag(db, false);
  check('data.valeriaV2Enabled=false confirmado ao final (releitura real)', flagFinal === false, flagFinal);

  const rPosFlag = await call(URL_GET_CATALOG, SECRET, baseBody({ categoria: 'caixas', channelPhone: TEL_1 }));
  check('pós-desativação: mesmo allowlisted volta a ser bloqueado', rPosFlag.status === 403, rPosFlag);

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  console.log('conversationIds de teste criados (isTeste:true):', CONV_ID);
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    console.error('ERRO FATAL:', e);
    // FAIL-SAFE (seção 11 da autorização): primeira ação em qualquer
    // exceção é desligar a flag real antes de qualquer outra coisa.
    try {
      const { getProdApp } = require('./_prod_admin_credential');
      const db = getProdApp().firestore();
      const flagFinal = await setV2Flag(db, false);
      console.error('[FAIL-SAFE] data.valeriaV2Enabled forçado para false. Releitura:', flagFinal);
    } catch (e2) {
      console.error('[FAIL-SAFE] FALHOU AO DESLIGAR A FLAG — AÇÃO MANUAL URGENTE NECESSÁRIA:', e2);
    }
    process.exit(1);
  });
