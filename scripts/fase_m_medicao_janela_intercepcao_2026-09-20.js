/**
 * fase_m_medicao_janela_intercepcao_2026-09-20.js — VALERIA 2.0, Fase M.
 *
 * SOMENTE LEITURA. Não escreve, não chama set-ai-enabled, não envia
 * mensagens, não altera nenhum estado. Objetivo único: medir a janela
 * real entre USER_MESSAGE_RECEIVED chegar no nosso backend e a resposta
 * do agente (AGENT_MESSAGE_SENDED / texto do agente) ser registrada,
 * usando os logs já existentes:
 *
 *   - valeria_api_log        → t1 aproximado (ingresso HTTP no nosso
 *                               servidor, capturado em pipeline.ts antes
 *                               de auth/contexto/rate-limit terminarem)
 *   - valeria_webhook_events / valeria_msgs → eventType + conversationId
 *                               para saber QUAL evento é qual
 *   - atendimentos/{id}/mensagens → t0 (createdAt nativo do ChatVolt,
 *                               vindo da API real GET /api/conversations)
 *
 * Uso:
 *   node scripts/fase_m_medicao_janela_intercepcao_2026-09-20.js \
 *     --since="2026-09-20T18:00:00-03:00" \
 *     [--conversationIds=id1,id2,...] \
 *     [--phone=5511999999999]
 *
 * Sem --conversationIds, o script descobre as conversas do(s) número(s)
 * de teste (erp_vr/valeria_test_phone_numbers, ou --phone explícito)
 * dentro da janela --since→agora, via atendimentos com isTeste===true.
 */
'use strict';
const { getProdApp } = require('./_prod_admin_credential');

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, min: null, p50: null, p95: null, max: null, mean: null };
  const sum = v.reduce((a, b) => a + b, 0);
  return {
    n: v.length,
    min: v[0],
    p50: percentile(v, 50),
    p95: percentile(v, 95),
    max: v[v.length - 1],
    mean: Math.round((sum / v.length) * 10) / 10,
  };
}

const OUTBOUND_EVENT_FALLBACK = new Set(['AGENT_MESSAGE_SENDED', 'AGENT_MESSAGE_FOLLOW_UP', 'AGENT_MESSAGE_BLOCKED', 'AGENT_MESSAGE_NOTED', 'AGENT_USER_MESSAGE']);

async function main() {
  const args = parseArgs();
  const db = getProdApp().firestore();

  const sinceMs = args.since ? new Date(args.since).getTime() : Date.now() - 24 * 3600 * 1000;
  const untilMs = args.until ? new Date(args.until).getTime() : Date.now();
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    console.error('--since/--until inválido. Use ISO 8601, ex: --since="2026-09-20T18:00:00-03:00"');
    process.exit(1);
  }

  console.log(`Fase M — medição read-only. Janela: desde ${new Date(sinceMs).toISOString()}`);

  // 1. Descobrir conversationIds de teste na janela.
  let conversationIds = args.conversationIds ? args.conversationIds.split(',').filter(Boolean) : [];

  if (conversationIds.length === 0) {
    let phones = args.phone ? [args.phone] : [];
    if (phones.length === 0) {
      const allowDoc = await db.collection('erp_vr').doc('valeria_test_phone_numbers').get();
      phones = (allowDoc.exists && Array.isArray(allowDoc.data().numeros)) ? allowDoc.data().numeros : [];
    }
    if (phones.length === 0) {
      console.error('Nenhum número de teste encontrado (erp_vr/valeria_test_phone_numbers vazio) e --phone não informado. Abortando.');
      process.exit(1);
    }
    console.log(`Números de teste considerados: ${phones.join(', ')}`);

    const atendimentosSnap = await db.collection('atendimentos')
      .where('isTeste', '==', true)
      .get();
    for (const doc of atendimentosSnap.docs) {
      const d = doc.data();
      const tsField = d.updatedAt || d.createdAt || null;
      const ms = tsField && tsField.toMillis ? tsField.toMillis() : (typeof tsField === 'number' ? tsField : null);
      const phoneOk = !d.channelPhone || phones.some((p) => String(d.channelPhone).includes(p) || p.includes(String(d.channelPhone)));
      if (phoneOk && (ms === null || ms >= sinceMs)) {
        conversationIds.push(doc.id);
      }
    }
    console.log(`Conversas de teste encontradas na janela: ${conversationIds.length}`);
  }

  if (conversationIds.length === 0) {
    console.log('Nenhuma conversa encontrada. Envie as mensagens de teste via WhatsApp primeiro, depois rode este script novamente.');
    process.exit(0);
  }

  const results = [];

  for (const conversationId of conversationIds) {
    // t1 aproximado: valeria_api_log, por conversationId (filtra action em
    // memória para evitar depender de um índice composto novo no Firestore).
    const apiLogSnapRaw = await db.collection('valeria_api_log')
      .where('conversationId', '==', conversationId)
      .get();
    const apiLogSnap = { docs: apiLogSnapRaw.docs.filter((d) => d.data().action === 'valeriaWebhookChatvolt') };

    // eventType por chamada: valeria_webhook_events, mesma janela/conversationId.
    // Sem orderBy na query (evita depender de índice composto novo) — ordena em memória.
    const webhookEventsSnapRaw = await db.collection('valeria_webhook_events')
      .where('conversationId', '==', conversationId)
      .select('eventType', 'ts', 'createdAt', 'data', 'mensagemCliente', 'respostaAgente')
      .get();

    // t0 nativo do ChatVolt: atendimentos/{id}/mensagens (createdAt real).
    const mensagensSnapRaw = await db.collection('atendimentos').doc(conversationId).collection('mensagens')
      .select('createdAt', 'actorType', 'provider')
      .get();

    // Filtro de janela [sinceMs, untilMs] SEMPRE aplicado em memória — mesmo
    // quando --conversationIds é passado diretamente — porque conversationIds
    // de teste são reaproveitados ao longo de dias/semanas de testes
    // anteriores; sem este filtro, pares de eventos de rodadas antigas
    // acabam casados com eventos de hoje, produzindo deltas absurdos.
    const inWindow = (ts) => typeof ts === 'number' && ts >= sinceMs && ts <= untilMs;

    const apiLogEvents = apiLogSnap.docs.map((d) => ({ ts: d.data().ts, latenciaMs: d.data().latenciaMs, requestId: d.data().requestId }))
      .filter((e) => inWindow(e.ts))
      .sort((a, b) => a.ts - b.ts);
    const webhookEvents = webhookEventsSnapRaw.docs.map((d) => {
      const v = d.data();
      const temClienteTexto = !!v.mensagemCliente;
      const temAgenteTexto = !!v.respostaAgente;
      // Mesma lógica de webhook.ts:559-562 — conteúdo decide a direção,
      // eventType puro só é fallback nominal quando nenhum texto está presente.
      let direcao;
      if (temClienteTexto && !temAgenteTexto) direcao = 'entrada';
      else if (temAgenteTexto) direcao = 'saida';
      else direcao = OUTBOUND_EVENT_FALLBACK.has(v.eventType) ? 'saida' : (v.eventType === 'USER_MESSAGE_RECEIVED' ? 'entrada' : 'saida');
      return { eventType: v.eventType, ts: v.ts, direcao, temClienteTexto, temAgenteTexto };
    }).filter((e) => inWindow(e.ts)).sort((a, b) => a.ts - b.ts);
    const mensagensNativas = mensagensSnapRaw.docs.map((d) => ({ createdAt: d.data().createdAt, actorType: d.data().actorType }))
      .filter((m) => inWindow(m.createdAt))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    results.push({ conversationId, apiLogEvents, webhookEvents, mensagensNativas });
  }

  // Pareamento: para cada conversationId, casar eventos por ordem temporal,
  // usando `direcao` computada por CONTEÚDO (mensagemCliente/respostaAgente),
  // igual à lógica real de webhook.ts:559-562 — não pelo eventType puro
  // (P1.2b: AGENT_USER_MESSAGE carrega os dois sentidos neste canal).
  // t1 = ts do evento de entrada (nosso ingresso). t2 = ts do próximo evento de saída.

  const agentResponseWindows = [];
  const webhookIngressDelays = [];
  const perConversationReport = [];

  for (const r of results) {
    const inboundTs = r.webhookEvents.filter((e) => e.direcao === 'entrada').map((e) => e.ts);
    const outboundTs = r.webhookEvents.filter((e) => e.direcao === 'saida').map((e) => e.ts);
    const pairs = [];
    let oi = 0;
    for (const inTs of inboundTs) {
      while (oi < outboundTs.length && outboundTs[oi] < inTs) oi++;
      if (oi < outboundTs.length) {
        pairs.push({ t1: inTs, t2: outboundTs[oi], window: outboundTs[oi] - inTs });
        agentResponseWindows.push(outboundTs[oi] - inTs);
        oi++;
      }
    }

    // webhookIngressDelay: t1 (nosso valeria_api_log.ts, mais próximo do ingresso HTTP real)
    // vs t0 (createdAt nativo mais próximo, quando existir e for anterior ao t1).
    // Por rodada: casa cada evento de entrada (nosso t1, via valeria_api_log,
    // mais próximo do ingresso HTTP real) com a mensagem nativa do cliente
    // (t0, createdAt do ChatVolt) mais próxima que a precede.
    const t0Candidates = r.mensagensNativas
      .filter((m) => m.actorType === 'customer' && typeof m.createdAt === 'number')
      .map((m) => m.createdAt)
      .sort((a, b) => a - b);
    const t1Candidates = r.apiLogEvents.map((e) => e.ts).filter((x) => typeof x === 'number').sort((a, b) => a - b);
    let t0i = 0;
    for (const t1 of t1Candidates) {
      while (t0i + 1 < t0Candidates.length && t0Candidates[t0i + 1] <= t1) t0i++;
      if (t0Candidates[t0i] !== undefined && t0Candidates[t0i] <= t1) {
        webhookIngressDelays.push(t1 - t0Candidates[t0i]);
      }
    }

    perConversationReport.push({
      conversationId: r.conversationId,
      eventTypesObservados: r.webhookEvents.map((e) => `${e.eventType}[${e.direcao}]@${new Date(e.ts).toISOString()}`),
      inboundCount: inboundTs.length,
      outboundCount: outboundTs.length,
      pares: pairs,
      mensagensNativasCount: r.mensagensNativas.length,
    });
  }

  console.log('\n=== Relatório por conversa ===');
  for (const rep of perConversationReport) {
    console.log(`\nconversationId=${rep.conversationId}`);
    console.log(`  eventTypes observados (ordem): ${rep.eventTypesObservados.join(', ') || '(nenhum)'}`);
    console.log(`  inbound=${rep.inboundCount} outbound=${rep.outboundCount} pares_casados=${rep.pares.length}`);
    for (const p of rep.pares) {
      console.log(`    t1=${new Date(p.t1).toISOString()} t2=${new Date(p.t2).toISOString()} agentResponseWindow=${p.window}ms`);
    }
  }

  console.log('\n=== Estatísticas agregadas ===');
  console.log('agentResponseWindow (ms) [t2 - t1, nosso ingresso do evento de entrada até nosso ingresso do evento de saída]:');
  console.log(JSON.stringify(stats(agentResponseWindows), null, 2));

  console.log('\nwebhookIngressDelay (ms) [t1 nosso vs t0 nativo ChatVolt, quando disponível]:');
  console.log(JSON.stringify(stats(webhookIngressDelays), null, 2));

  const minWindow = agentResponseWindows.length ? Math.min(...agentResponseWindows) : null;
  console.log(`\nMINIMUM SAFETY WINDOW observada: ${minWindow === null ? 'sem dados' : minWindow + 'ms'}`);

  console.log('\nNOTA IMPORTANTE (limitação conhecida, documentada em webhook.ts P1.2b):');
  console.log('O nome do eventType sozinho não é 100% confiável para direção (AGENT_USER_MESSAGE pode carregar');
  console.log('texto do cliente OU da agente). Este script usa apenas eventType puro para simplicidade e velocidade');
  console.log('desta primeira medição — os números aqui são uma APROXIMAÇÃO. Para confirmação fina por rodada,');
  console.log('cruzar manualmente com o campo `mensagem`/`mensagemCliente`/`respostaAgente` de valeria_msgs para os');
  console.log('conversationId/ts específicos reportados acima antes de tirar conclusões definitivas.');

  console.log('\nFase M: nenhuma escrita foi feita. Nenhuma mensagem foi enviada. Nenhum set-ai-enabled foi chamado.');
}

main().catch((e) => {
  console.error('Erro na Fase M (read-only):', e);
  process.exit(1);
});
