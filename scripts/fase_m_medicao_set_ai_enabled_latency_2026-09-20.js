// PROD_MUTATING_TEST
/**
 * ⚠️  ESTE SCRIPT ALTERA PRODUÇÃO ⚠️
 * Liga/desliga `isAiEnabled` numa conversa real do ChatVolt (API externa,
 * não Firestore). Exige `ALLOW_PROD_MUTATION=1` no ambiente (ver
 * scripts/_prod_mutation_guard.js). NUNCA deve ser executado por um
 * sweep/varredura genérica de `scripts/test_*.js`.
 *
 * fase_m_medicao_set_ai_enabled_latency_2026-09-20.js — VALERIA 2.0, Fase M.
 *
 * Mede o round-trip HTTP de POST /conversations/{id}/set-ai-enabled numa
 * ÚNICA conversa de teste dormente, previamente escolhida e verificada
 * (cmtatdbeh0eokvyqtbfxv6bz2 — sem atividade há ~24 dias, isTeste=true,
 * sem orçamento/produção/oportunidade vinculados, modoAtendimento=valeria,
 * sem handoff pendente).
 *
 * Segurança:
 *   - Lê o CHATVOLT_API_KEY via `gcloud secrets versions access` dentro
 *     do próprio processo Node — o valor NUNCA é impresso/logado.
 *   - Lê o estado atual (isAiEnabled) via GET antes de qualquer mudança.
 *   - Cada toggle é imediatamente confirmado via GET e revertido.
 *   - try/finally garante restauração do estado original mesmo se algo
 *     falhar no meio, e falha ALTO se a restauração final não for
 *     confirmada (não silencia esse caso).
 *   - Não envia nenhuma mensagem nessa conversa.
 *   - Não ativa a feature flag valeriaV2Enabled (nem toca nela).
 *
 * Uso: node scripts/fase_m_medicao_set_ai_enabled_latency_2026-09-20.js
 */
'use strict';
const { execFileSync } = require('child_process');
const { requireAllowProdMutation, installEmergencyRestoreOnSignal } = require('./_prod_mutation_guard');

requireAllowProdMutation(__filename);

const CONVERSATION_ID = 'cmtatdbeh0eokvyqtbfxv6bz2';
const ROUNDS = 5; // 5 idas e voltas = 10 amostras de latência
const API_BASE = 'https://api.chatvolt.ai';

function getApiKey() {
  // Executado dentro do processo — stdout capturado em variável, nunca
  // impresso/logado neste script.
  const out = execFileSync('gcloud', [
    'secrets', 'versions', 'access', 'latest',
    '--secret=CHATVOLT_API_KEY', '--project=erp-vrmarcas',
  ], { encoding: 'utf8' });
  return out.trim();
}

async function getConversation(apiKey) {
  const res = await fetch(`${API_BASE}/conversation/${CONVERSATION_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`GET conversation falhou: ${res.status} ${await res.text()}`);
  return res.json();
}

async function setAiEnabled(apiKey, enabled) {
  const t0 = process.hrtime.bigint();
  const res = await fetch(`${API_BASE}/conversations/${CONVERSATION_ID}/set-ai-enabled`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const t1 = process.hrtime.bigint();
  const latencyMs = Number(t1 - t0) / 1e6;
  if (!res.ok) throw new Error(`POST set-ai-enabled(${enabled}) falhou: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { latencyMs, body };
}

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const sum = v.reduce((a, b) => a + b, 0);
  const p = (pct) => v[Math.max(0, Math.min(v.length - 1, Math.ceil((pct / 100) * v.length) - 1))];
  return {
    n: v.length,
    min: Math.round(v[0] * 10) / 10,
    p50: Math.round(p(50) * 10) / 10,
    p95: Math.round(p(95) * 10) / 10,
    max: Math.round(v[v.length - 1] * 10) / 10,
    mean: Math.round((sum / v.length) * 10) / 10,
  };
}

async function main() {
  console.log(`Fase M — medição de latência de set-ai-enabled. conversationId=${CONVERSATION_ID}`);
  const apiKey = getApiKey();

  console.log('\n--- Passo 1: ler estado ANTES de qualquer mudança ---');
  const before = await getConversation(apiKey);
  console.log(`isAiEnabled atual: ${before.isAiEnabled}`);
  console.log(`status: ${before.status} | blocked: ${before.blocked} | priority: ${before.priority}`);
  console.log(`lastHumanInteractionAt: ${before.lastHumanInteractionAt || '(nunca)'}`);
  console.log(`assignees: ${(before.assignees || []).length} | unreadMessagesCount: ${before.unreadMessagesCount}`);

  const originalEnabled = before.isAiEnabled;
  if (typeof originalEnabled !== 'boolean') {
    console.error('isAiEnabled não veio como boolean — abortando por segurança, sem tocar em nada.');
    process.exit(1);
  }

  const dormancyOk = (before.assignees || []).length === 0 && !before.blocked;
  console.log(`\nConfirmação de dormência (assignees vazio, não blocked): ${dormancyOk ? 'OK' : 'FALHOU — abortando'}`);
  if (!dormancyOk) {
    console.error('Critério de dormência não confirmado via API. Abortando sem executar nenhum toggle.');
    process.exit(1);
  }

  installEmergencyRestoreOnSignal(async () => {
    await setAiEnabled(apiKey, originalEnabled);
    const reread = await getConversation(apiKey);
    if (reread.isAiEnabled !== originalEnabled) throw new Error('releitura não confirmou isAiEnabled=' + originalEnabled);
  }, __filename);

  const enableLatencies = [];
  const disableLatencies = [];
  let restoredOk = false;

  try {
    console.log(`\n--- Passo 2: ${ROUNDS} rodadas de toggle + confirmação + restauração ---`);
    for (let i = 1; i <= ROUNDS; i++) {
      const flipped = !originalEnabled;

      const r1 = await setAiEnabled(apiKey, flipped);
      const confirm1 = await getConversation(apiKey);
      const ok1 = confirm1.isAiEnabled === flipped;
      (flipped ? enableLatencies : disableLatencies).push(r1.latencyMs);
      console.log(`  rodada ${i}: set(${flipped}) latency=${r1.latencyMs.toFixed(1)}ms confirmado=${ok1}`);
      if (!ok1) throw new Error(`Rodada ${i}: estado não confirmado após set(${flipped}) — abortando loop, indo para restauração final.`);

      const r2 = await setAiEnabled(apiKey, originalEnabled);
      const confirm2 = await getConversation(apiKey);
      const ok2 = confirm2.isAiEnabled === originalEnabled;
      (originalEnabled ? enableLatencies : disableLatencies).push(r2.latencyMs);
      console.log(`  rodada ${i}: set(${originalEnabled}) [restaura] latency=${r2.latencyMs.toFixed(1)}ms confirmado=${ok2}`);
      if (!ok2) throw new Error(`Rodada ${i}: estado original não confirmado após restaurar — abortando loop, indo para restauração final.`);
    }
    restoredOk = true;
  } finally {
    console.log('\n--- Passo 3: restauração final garantida (try/finally) ---');
    const finalRead = await getConversation(apiKey);
    if (finalRead.isAiEnabled !== originalEnabled) {
      console.log(`Estado divergente (${finalRead.isAiEnabled} != original ${originalEnabled}) — forçando restauração agora.`);
      await setAiEnabled(apiKey, originalEnabled);
      const reread = await getConversation(apiKey);
      restoredOk = reread.isAiEnabled === originalEnabled;
      if (!restoredOk) {
        console.error(`FALHA CRÍTICA: não foi possível confirmar a restauração do estado original (esperado ${originalEnabled}, obtido ${reread.isAiEnabled}). INTERVENÇÃO MANUAL NECESSÁRIA na conversa ${CONVERSATION_ID}.`);
      }
    } else {
      restoredOk = true;
    }
    console.log(`Estado final confirmado: isAiEnabled=${finalRead.isAiEnabled} (original era ${originalEnabled}) — restoredOk=${restoredOk}`);
  }

  console.log('\n=== Estatísticas de latência (ms) ===');
  console.log('Todas as chamadas set-ai-enabled (enable+disable combinadas):');
  console.log(JSON.stringify(stats([...enableLatencies, ...disableLatencies]), null, 2));
  console.log('\nSomente enable(true):');
  console.log(JSON.stringify(stats(enableLatencies), null, 2));
  console.log('\nSomente disable(false):');
  console.log(JSON.stringify(stats(disableLatencies), null, 2));

  if (!restoredOk) {
    console.error('\nENCERRANDO COM CÓDIGO DE ERRO — restauração não confirmada.');
    process.exit(1);
  }
  console.log('\nFase M (latência set-ai-enabled): concluída, estado original restaurado e confirmado. Nenhuma mensagem enviada. Feature flag valeriaV2Enabled não foi tocada.');
}

main().catch((e) => {
  console.error('Erro na medição de latência (ver acima se a restauração foi confirmada mesmo assim):', e.message);
  process.exit(1);
});
