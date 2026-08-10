/**
 * test_valeria_foundation_e2e_2026-08-09.js
 *
 * VALÉRIA + CHATVOLT — FASE 0/1: os 10 cenários obrigatórios da instrução,
 * executados contra as Functions REAIS compiladas (functions-valeria/lib e
 * functions/lib) invocadas in-process com req/res fake, sobre o Firestore
 * Emulator real (localhost:8080). Nenhum agente ChatVolt real, nenhum
 * WhatsApp real, nenhum dado de produção — fixtures descartáveis com
 * prefixo E2E_VF_ e sufixo de timestamp.
 *
 * Cenários:
 *   1. "vocês fazem placa de acrílico?" → lead criado + briefing qualifica
 *   2. cliente existente retorna pelo MESMO telefone (formato legado) →
 *      reconhecido, nunca duplicado; lead-first: upsert não cria cliente
 *   3. produto Vitre → consulta catálogo real (elegibilidade C3)
 *   4. personalizado VR → coleta medidas via briefing progressivo
 *   5. informação aos poucos → estado persiste entre mensagens/chamadas
 *   6. webhook duplicado 10x (mesmo messageId) → UMA interação efetiva
 *   7. cliente pede humano → handoff com motivo registrado
 *   8. desconto fora da regra → campo de preço livre REJEITADO + handoff
 *   9. ERP indisponível (sem config financeira) → nunca inventa preço
 *  10. produto não encontrado → elegivel:false, nunca alucina SKU/preço
 *
 * Uso: node scripts/test_valeria_foundation_e2e_2026-08-09.js
 * Pré-requisito: Firestore Emulator em localhost:8080; builds feitos
 * (functions-valeria/lib e functions/lib).
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-erp-homolog';

const path = require('path');
const RUN = Date.now();

// Secrets sintéticos (só deste processo/emulador — nunca produção)
const SECRET = 'e2e_vf_secret_' + RUN;
process.env.VALERIA_BEARER_SECRET = SECRET;
process.env.VALERIA_BEARER_SECRET_PREV = '';

const AGENT_ID = 'agent_e2e_vf_' + RUN;
const ORG_ID = 'org_e2e_vf_' + RUN;
const TEL_E164 = '+5516988' + String(RUN).slice(-6);          // telefone único por run
const TEL_LEGADO = '(16) 988' + String(RUN).slice(-6, -4) + '-' + String(RUN).slice(-4); // mesmo número, formato humano

const admin = require(path.join(__dirname, '..', 'functions-valeria', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// O codebase default (functions/) tem SUA PRÓPRIA instância de
// firebase-admin (node_modules separado) — precisa ser inicializada também
// para os handlers valeriaVitre* funcionarem in-process.
const adminDefault = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!adminDefault.apps.length) adminDefault.initializeApp({ projectId: process.env.GCLOUD_PROJECT });

// Handlers reais (codebase valeria — v2.1)
const fv = require(path.join(__dirname, '..', 'functions-valeria', 'lib', 'index.js'));
// Handlers reais Vitre (codebase default) — usam o secret Firestore (valeria_config)
const fVitre = require(path.join(__dirname, '..', 'functions', 'lib', 'valeria_vitre.js'));

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + ((e && e.stack) || e)); failed++; }
}
function assertEq(got, exp, msg) { const g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'diferente') + ' — esperado ' + e + ', obtido ' + g); }
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado truthy'); }

/** req/res fake com a superfície Express que pipeline/handlers usam. */
function fakeReq({ method, body, query, headers, bearer }) {
  const h = Object.assign({}, headers);
  if (bearer !== undefined) h['authorization'] = 'Bearer ' + bearer;
  return { method: method || 'POST', body: body || {}, query: query || {}, headers: h };
}
function invoke(handler, reqOpts) {
  return new Promise((resolve, reject) => {
    const req = fakeReq(reqOpts);
    const state = { status: 200, body: null, finished: false, listeners: {} };
    const res = {
      get statusCode() { return state.status; },
      set: () => res,
      status: (c) => { state.status = c; return res; },
      json: (b) => { state.body = b; finish(); return res; },
      send: (b) => { state.body = b; finish(); return res; },
      on: (ev, cb) => { (state.listeners[ev] = state.listeners[ev] || []).push(cb); return res; },
    };
    function finish() {
      if (state.finished) return;
      state.finished = true;
      (state.listeners['finish'] || []).forEach((cb) => { try { cb(); } catch (e) { /* log fire-and-forget */ } });
      resolve({ status: state.status, body: state.body });
    }
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const baseCtx = () => ({ agentId: AGENT_ID, organizationId: ORG_ID });

(async function main() {
  console.log('\n=== VALÉRIA×CHATVOLT FASE 0/1 — 10 cenários E2E (Functions reais + Firestore Emulator) ===\n');

  // ── Seed mínimo ─────────────────────────────────────────────────────────
  // allowlist fail-closed do codebase valeria
  await db.collection('erp_vr').doc('valeria_authorized_agents').set({
    agents: [{ agentId: AGENT_ID, organizationId: ORG_ID }],
  });
  // secret do codebase default (valeriaVitre*) — mecanismo legado próprio
  await db.collection('erp_vr').doc('valeria_config').set({ data: JSON.stringify({ secret: SECRET }), ts: Date.now() });
  // config financeira real (para o motor de preço) — removida no cenário 9
  await db.collection('erp_vr').doc('erp_config').set({
    data: JSON.stringify({
      financeiro: { overhead: 41.16, vrml: 20, impostos: 0 },
      materiais: [{ comp: 183, larg: 122, preco: 180, nome: 'Acrílico E2E' }],
    }), ts: Date.now(),
  });
  // cliente existente com telefone em FORMATO LEGADO (cenário 2)
  const CLIENTE_ID = 'E2E_VF_cli_' + RUN;
  await db.collection('erp_vr').doc('clientes').set({
    data: JSON.stringify([{ id: CLIENTE_ID, nome: 'Cliente Existente E2E', tel: TEL_LEGADO, tipo: 'PF', os: [] }]),
    ts: Date.now(),
  });
  await db.collection('erp_vr').doc('crm_leads').set({ data: JSON.stringify({}), ts: Date.now() });
  // produto Vitre elegível (cenário 3)
  const SKU = 'E2E_VF_SKU_' + RUN;
  await db.collection('vitre_produtos').doc(SKU).set({
    sku: SKU, nome: 'Aparador Acrílico E2E', marca: 'vitre', status: 'ativo', ativoValeria: true,
    custo: 10, precoVenda: 90, categoria: 'Decoração', prazoDias: 5, descricaoCurta: 'Aparador pronta entrega',
    embalagem: '20x20x10', pesoKg: 0.5, fotos: ['a.jpg'], usos: ['decoração'], beneficios: ['resistente'],
    palavrasChave: ['aparador', 'acrilico'], disponibilidade: 'pronta_entrega', origem: 'manual',
  });

  const CONV1 = 'conv_e2e_vf_1_' + RUN;
  const CONV2 = 'conv_e2e_vf_2_' + RUN;

  // ── CENÁRIO 1 — "Oi, vocês fazem placa de acrílico?" → qualificação ────
  let leadId1 = null;
  await test('C1a. Primeira mensagem → lead criado (NOVO_LEAD, coluna ia_novo do Kanban)', async () => {
    const r = await invoke(fv.valeriaCriarOportunidade, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), {
        conversationId: CONV1, userPhoneNumber: '+5516977' + String(RUN).slice(-6),
        nome: 'Interessado Placa E2E', observacoes: 'Perguntou se fazemos placa de acrílico',
      }),
    });
    assertEq(r.status, 200, 'status'); assertTruthy(r.body.success, 'success');
    assertEq(r.body.data.acao, 'criado', 'acao');
    leadId1 = r.body.data.leadId;
    const dict = JSON.parse((await db.collection('erp_vr').doc('crm_leads').get()).data().data);
    assertEq(dict[leadId1].etapa, 'ia_novo', 'coluna Kanban');
    assertEq(dict[leadId1].valeria.status, 'NOVO_LEAD', 'status interno');
  });
  await test('C1b. Briefing registra o produto e devolve o CHECKLIST do que falta (qualificação guiada, não interrogatório)', async () => {
    const r = await invoke(fv.valeriaAtualizarBriefing, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV1, produto: 'Placa de acrílico' }),
    });
    assertTruthy(r.body.success, 'success');
    assertTruthy(r.body.data.completude > 0, 'completude > 0');
    assertTruthy(Array.isArray(r.body.data.camposFaltando) && r.body.data.camposFaltando.length > 0, 'camposFaltando presentes');
    assertTruthy(r.body.data.camposFaltando.includes('larguraMm'), 'medidas ainda faltam');
  });

  // ── CENÁRIO 2 — cliente existente retorna pelo mesmo telefone ───────────
  await test('C2a. GetContexto reconhece o cliente pelo E.164 do WhatsApp mesmo com cadastro em formato legado', async () => {
    const r = await invoke(fv.valeriaGetContexto, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV2, userPhoneNumber: TEL_E164 }),
    });
    assertTruthy(r.body.success, 'success');
    assertTruthy(r.body.data.cliente, 'cliente encontrado');
    assertEq(r.body.data.cliente.id, CLIENTE_ID, 'cliente certo');
    assertEq(r.body.data.telefoneE164, TEL_E164, 'telefone canônico');
  });
  await test('C2b. LEAD-FIRST: upsert de contato DESCONHECIDO não cria cliente (orienta criar lead)', async () => {
    const r = await invoke(fv.valeriaUpsertCliente, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV2, userPhoneNumber: '+5511900000' + String(RUN).slice(-3), nome: 'Desconhecido E2E' }),
    });
    assertTruthy(r.body.success, 'success (resposta ok, não erro)');
    assertEq(r.body.data.acao, 'nenhum_cliente_criado', 'não criou');
    assertEq(r.body.data.clienteId, null, 'sem clienteId');
    const clientes = JSON.parse((await db.collection('erp_vr').doc('clientes').get()).data().data);
    assertEq(clientes.length, 1, 'lista de clientes intacta');
  });
  const CONV_RET = 'conv_e2e_vf_retorno_' + RUN;
  await test('C2c. Lead que retorna pelo mesmo telefone em conversa NOVA é atualizado, nunca duplicado', async () => {
    const telLead = '+5516977' + String(RUN).slice(-6); // mesmo do C1
    const r = await invoke(fv.valeriaCriarOportunidade, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), {
        conversationId: CONV_RET, userPhoneNumber: telLead,
        nome: 'Interessado Placa E2E', observacoes: 'Voltou a chamar',
      }),
    });
    assertEq(r.body.data.acao, 'atualizado', 'atualizado, não criado');
    assertEq(r.body.data.leadId, leadId1, 'mesmo lead');
    const dict = JSON.parse((await db.collection('erp_vr').doc('crm_leads').get()).data().data);
    assertEq(Object.keys(dict).length, 1, 'exatamente 1 lead no CRM');
  });

  // ── CENÁRIO 3 — produto Vitre: consulta catálogo real ───────────────────
  await test('C3. Busca no Catálogo Vitre devolve só produto elegível, com preço/prazo do ERP (nunca inventado)', async () => {
    const r = await invoke(fVitre.valeriaVitreBuscarCatalogo, {
      method: 'GET', bearer: SECRET, query: { q: 'aparador' },
    });
    assertEq(r.status, 200, 'status'); assertTruthy(r.body.ok, 'ok');
    const achado = (r.body.produtos || []).find((p) => p.sku === SKU);
    assertTruthy(achado, 'produto elegível na busca');
    assertEq(achado.precoVenda, 90, 'preço vem do catálogo');
    assertEq(achado.prazoDias, 5, 'prazo vem do catálogo');
    assertTruthy(achado.custo === undefined, 'custo NUNCA exposto');
  });

  // ── CENÁRIO 4 — personalizado VR: coleta medidas ───────────────────────
  await test('C4. Briefing VR coleta medidas (larguraMm/alturaMm/quantidade) e completude sobe', async () => {
    const r = await invoke(fv.valeriaAtualizarBriefing, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV1, larguraMm: 400, alturaMm: 200, quantidade: 2, material: 'Acrílico cristal 3mm' }),
    });
    assertTruthy(r.body.success, 'success');
    assertTruthy(!r.body.data.camposFaltando.includes('larguraMm'), 'largura registrada');
    assertTruthy(!r.body.data.camposFaltando.includes('quantidade'), 'quantidade registrada');
    assertTruthy(r.body.data.completude >= 50, 'completude avançou');
  });

  // ── CENÁRIO 5 — informação aos poucos: estado persiste ─────────────────
  await test('C5a. Nova informação isolada (prazo) faz merge sem apagar o que já foi coletado', async () => {
    const r = await invoke(fv.valeriaAtualizarBriefing, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV1, prazo: '10 dias' }),
    });
    assertTruthy(r.body.success, 'success');
    assertEq(r.body.data.briefing.larguraMm, 400, 'largura preservada');
    assertEq(r.body.data.briefing.produto, 'Placa de acrílico', 'produto preservado');
  });
  await test('C5b. Valor genérico ("não informado") NUNCA sobrescreve dado válido', async () => {
    const r = await invoke(fv.valeriaAtualizarBriefing, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV1, material: 'não informado' }),
    });
    assertEq(r.body.data.briefing.material, 'Acrílico cristal 3mm', 'material preservado');
  });
  await test('C5c. GetContexto devolve a memória estruturada completa (briefing + etapa + campos faltantes) numa chamada', async () => {
    const r = await invoke(fv.valeriaGetContexto, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV1, userPhoneNumber: '+5516977' + String(RUN).slice(-6) }),
    });
    assertTruthy(r.body.success, 'success');
    assertTruthy(r.body.data.lead, 'lead na resposta');
    assertTruthy(r.body.data.briefing, 'briefing na resposta');
    assertEq(r.body.data.briefing.larguraMm, 400, 'briefing consolidado');
    assertEq(r.body.data.etapaValeria, 'NOVO_LEAD', 'estágio do funil');
    assertTruthy(Array.isArray(r.body.data.camposFaltando), 'checklist do que falta');
  });

  // ── CENÁRIO 6 — webhook duplicado 10x → UMA interação efetiva ──────────
  await test('C6. Webhook reenviado 10x com o mesmo messageId grava exatamente 1 interação', async () => {
    const MSG_ID = 'msg_e2e_vf_dup_' + RUN;
    const payload = Object.assign(baseCtx(), {
      conversationId: CONV1, eventType: 'AGENT_USER_MESSAGE', messageId: MSG_ID,
      userMessage: 'Quero a placa 40x20', agentMessage: 'Perfeito! Vou registrar.',
      userPhoneNumber: '+5516977' + String(RUN).slice(-6),
    });
    for (let i = 0; i < 10; i++) {
      const r = await invoke(fv.valeriaWebhookChatvolt, { bearer: SECRET, body: payload });
      assertEq(r.status, 200, 'sempre 200 (replay idempotente)');
    }
    const msgs = await db.collection('valeria_msgs').where('messageId', '==', MSG_ID).get();
    assertEq(msgs.size, 1, 'exatamente 1 registro em valeria_msgs');
    const evts = await db.collection('valeria_webhook_events').where('messageId', '==', MSG_ID).get();
    assertEq(evts.size, 1, 'exatamente 1 evento bruto');
  });

  // ── CENÁRIO 7 — cliente pede humano → handoff com motivo ───────────────
  // (usa CONV_RET: após C2c o vínculo do lead segue a conversa MAIS RECENTE
  // do mesmo telefone — semântica correta de "cliente voltou a chamar")
  await test('C7. "Quero falar com uma pessoa" → handoff registrado com motivo + lead aguardando_humano', async () => {
    const r = await invoke(fv.valeriaTransferirHumano, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV_RET, motivo: 'cliente pediu atendente humano' }),
    });
    assertTruthy(r.body.success, 'success');
    assertTruthy(r.body.humanValidationRequired, 'humanValidationRequired');
    const dict = JSON.parse((await db.collection('erp_vr').doc('crm_leads').get()).data().data);
    assertEq(dict[leadId1].valeria.status, 'aguardando_humano', 'status do lead');
    const alertas = await db.collection('valeria_alertas')
      .where('conversationId', '==', CONV_RET).where('tipo', '==', 'transferir_humano').get();
    assertTruthy(alertas.size >= 1, 'alerta para a equipe');
    assertTruthy(alertas.docs[0].data().motivo.includes('humano'), 'motivo registrado');
  });

  // ── CENÁRIO 8 — desconto fora da regra: nunca inventar ─────────────────
  await test('C8. Tentativa de mandar preço/total livre no orçamento → REJEITADA (FORBIDDEN_FIELD); caminho certo é handoff', async () => {
    const r = await invoke(fv.valeriaCriarOrcamento, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), {
        conversationId: CONV1, simulationId: 'sim_fake', nomeCliente: 'X',
        itens: [{ larg: 100, alt: 100, qty: 1 }],
        total: 10, // desconto "negociado" na conversa — proibido
        userPhoneNumber: '+5516977' + String(RUN).slice(-6),
      }),
    });
    assertEq(r.status, 400, 'bloqueado');
    assertEq(r.body.error.code, 'FORBIDDEN_FIELD', 'código explícito');
  });

  // ── CENÁRIO 9 — ERP indisponível: nunca inventa resposta operacional ────
  await test('C9. Sem config financeira no ERP → motor NUNCA devolve preço (validação humana), zero preço inventado', async () => {
    await db.collection('erp_vr').doc('erp_config').delete();
    const r = await invoke(fv.valeriaCalcularOrcamento, {
      bearer: SECRET,
      body: Object.assign(baseCtx(), { conversationId: CONV1, itens: [{ larg: 100, alt: 100, qty: 1, matKey: 'cfg_0' }] }),
    });
    assertTruthy(!r.body.success, 'não sucesso');
    assertEq(r.body.error.code, 'HUMAN_VALIDATION_REQUIRED', 'encaminha para humano');
    assertTruthy(!JSON.stringify(r.body).includes('finalPrice'), 'nenhum preço inventado');
    // restaura para não afetar reexecuções
    await db.collection('erp_vr').doc('erp_config').set({
      data: JSON.stringify({ financeiro: { overhead: 41.16, vrml: 20, impostos: 0 }, materiais: [{ comp: 183, larg: 122, preco: 180 }] }), ts: Date.now(),
    });
  });

  // ── CENÁRIO 10 — produto não encontrado: nunca alucinar ────────────────
  await test('C10. SKU inexistente → elegivel:false com motivo, nunca aproxima para outro produto', async () => {
    const r = await invoke(fVitre.valeriaVitreConsultarProduto, {
      method: 'GET', bearer: SECRET, query: { sku: 'SKU_QUE_NAO_EXISTE_' + RUN },
    });
    assertEq(r.status, 200, 'não é erro 500');
    assertTruthy(r.body.ok, 'ok');
    assertEq(r.body.elegivel, false, 'não elegível');
    assertEq(r.body.motivo, 'SKU_NAO_ENCONTRADO', 'motivo explícito');
    assertTruthy(!r.body.produto, 'nenhum produto alucinado');
  });

  // ── Extra de segurança — sem token e agente fora da allowlist ──────────
  await test('SEC1. Sem Bearer token → 401 (nenhuma Function responde dados)', async () => {
    const r = await invoke(fv.valeriaGetContexto, { body: Object.assign(baseCtx(), { conversationId: CONV1 }) });
    assertEq(r.status, 401, '401');
  });
  await test('SEC2. Agente fora da allowlist → 403 fail-closed', async () => {
    const r = await invoke(fv.valeriaGetContexto, {
      bearer: SECRET,
      body: { conversationId: CONV1, agentId: 'agent_intruso', organizationId: 'org_intrusa' },
    });
    assertEq(r.status, 403, '403');
  });
  await test('OBS1. Chamadas autenticadas geraram registros em valeria_api_log (requestId+latência+resultado)', async () => {
    await new Promise((r) => setTimeout(r, 300)); // logs são fire-and-forget
    const logs = await db.collection('valeria_api_log').where('conversationId', '==', CONV1).get();
    assertTruthy(logs.size >= 3, 'logs presentes (' + logs.size + ')');
    const l = logs.docs[0].data();
    assertTruthy(l.requestId && l.action && typeof l.latenciaMs === 'number', 'campos de observabilidade');
    assertTruthy(!JSON.stringify(l).includes(SECRET), 'NUNCA loga o secret');
  });

  // ── Limpeza das fixtures desta run ─────────────────────────────────────
  await db.collection('erp_vr').doc('valeria_authorized_agents').delete();
  await db.collection('vitre_produtos').doc(SKU).delete();

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
