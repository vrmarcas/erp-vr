/**
 * cleanup_orc000018_os8_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, seções 50-52/65 — remove o cenário de teste
 * Orçamento #000018 / OS #8, explicitamente confirmado pelo usuário como
 * TESTE (usado para reproduzir os bugs desta rodada: PIX/status/
 * checklist/privacidade). Usado depois para reprodução, precisa ser
 * removido sem deixar resíduo e sem alterar estoque/financeiro reais.
 *
 * Achado da auditoria (read-only, antes deste script): a OS consumiu
 * 1 unidade REAL de estoque ("acr_lico" — Acrílico Cristal 2mm) via
 * erp_stock_log (tipo:'saida', finalidade:'inicio_producao',
 * idempotencyKey:'producao_inicio:os1786504160979_8'). Por isso este
 * script NÃO apenas apaga os registros — primeiro ESTORNA essa saída com
 * uma entrada compensatória auditável (nunca edita/apaga o log
 * original), depois remove os artefatos do cenário de teste:
 *   - orcamentos: entrada ORC-000018
 *   - kb_os / kb_os_fin: os1786504160979_8
 *   - fin_cr: 2 lançamentos (entrada recebida + restante pendente)
 *   - fin_tx: 1 lançamento (entrada recebida)
 *   - crm_leads: nenhum vinculado (auditado, confirmado vazio)
 *   - retalhos: nenhum vinculado (a OS usou chapa nova, não retalho)
 *
 * Modo: snapshot → dry-run (mostra o que seria alterado) → apply (só se
 * chamado com --apply) → auditoria pós-apply.
 *
 * Uso:
 *   node scripts/cleanup_orc000018_os8_2026-08-12.js            # dry-run
 *   node scripts/cleanup_orc000018_os8_2026-08-12.js --apply    # aplica
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();

const APPLY = process.argv.includes('--apply');
const ORC_ID = 'ORC-000018';
const OS_ID = 'os1786504160979_8';
const STOCK_MAT_KEY = 'acr_lico';
const STOCK_QTY_ESTORNAR = 1;
const IDEMPOTENCY_KEY_ORIGINAL = 'producao_inicio:os1786504160979_8';

async function getData(key) {
  const doc = await db.collection('erp_vr').doc(key).get();
  if (!doc.exists) return null;
  return JSON.parse(doc.data().data);
}
async function setData(key, data) {
  await db.collection('erp_vr').doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

(async () => {
  console.log('\n=== LIMPEZA — Orçamento #000018 / OS #8 (cenário de teste autorizado) ===\n');
  console.log('Modo:', APPLY ? 'APPLY (grava no Firestore)' : 'DRY-RUN (só mostra, não grava)');

  const keys = ['orcamentos', 'kb_os', 'kb_os_fin', 'fin_cr', 'fin_tx', 'erp_stock_log', 'stock', 'crm_leads', 'retalhos'];
  const snapshot = {};
  for (const k of keys) snapshot[k] = await getData(k);

  const snapshotPath = path.join(__dirname, '_snapshot_pre_limpeza_orc000018_2026-08-12.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log('Snapshot salvo em:', snapshotPath);

  // Safety gate: confirma que a saída de estoque original ainda está
  // presente exatamente como auditado (nunca estorna 2x, nunca estorna
  // se o log já mudou desde a auditoria).
  const logOriginal = (snapshot.erp_stock_log || []).find(l => l.idempotencyKey === IDEMPOTENCY_KEY_ORIGINAL);
  if (!logOriginal) {
    console.log('\n❌ ABORTADO — log de saída original (idempotencyKey=' + IDEMPOTENCY_KEY_ORIGINAL + ') não encontrado. Pode já ter sido estornado, ou o estado mudou desde a auditoria. Não prosseguir sem investigar.');
    process.exit(1);
  }
  const jaEstornado = (snapshot.erp_stock_log || []).some(l => l.estornoDe === IDEMPOTENCY_KEY_ORIGINAL);
  if (jaEstornado) {
    console.log('\n❌ ABORTADO — já existe um estorno para esta saída (estornoDe=' + IDEMPOTENCY_KEY_ORIGINAL + '). Não estornar de novo.');
    process.exit(1);
  }
  console.log('\n✅ Confirmado: 1 saída real de estoque (' + logOriginal.matKey + ', qty=' + logOriginal.qty + ') ligada à OS de teste, ainda não estornada.');

  const orc = (snapshot.orcamentos || []).find(o => o.id === ORC_ID);
  const os = (snapshot.kb_os || {})[OS_ID];
  const crRelacionados = (snapshot.fin_cr || []).filter(c => c.orcamentoId === ORC_ID || c.osId === OS_ID);
  const txRelacionados = (snapshot.fin_tx || []).filter(t => t.os === '8' && t.marca === 'vr' && Math.abs((t.valor||0) - 83.08) < 0.005);

  console.log('\n--- DRY-RUN: o que seria alterado ---');
  console.log('  orcamentos: remove', orc ? orc.id : '(não encontrado)');
  console.log('  kb_os / kb_os_fin: remove', OS_ID);
  console.log('  fin_cr: remove', crRelacionados.length, 'lançamento(s) —', crRelacionados.map(c => c.id).join(', '));
  console.log('  fin_tx: remove', txRelacionados.length, 'lançamento(s) heurístico(s) (os=8, marca=vr, valor≈83.08)');
  console.log('  erp_stock_log: adiciona 1 entrada compensatória (estorno de', STOCK_QTY_ESTORNAR, STOCK_MAT_KEY + ')');
  console.log('  stock[' + STOCK_MAT_KEY + '].qty:', (snapshot.stock && snapshot.stock[STOCK_MAT_KEY] && snapshot.stock[STOCK_MAT_KEY].qty), '→', (snapshot.stock && snapshot.stock[STOCK_MAT_KEY] && snapshot.stock[STOCK_MAT_KEY].qty + STOCK_QTY_ESTORNAR));

  if (!orc || !os) {
    console.log('\n❌ ABORTADO — orçamento ou OS não encontrados no estado atual (já removidos? id mudou?). Não prosseguir às cegas.');
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDry-run concluído — nada foi gravado. Rode novamente com --apply para aplicar.\n');
    return;
  }

  // 1) Estorno de estoque — SEMPRE primeiro, e sempre uma entrada NOVA
  // (nunca edita/apaga o log original) para preservar o rastro auditável
  // completo (saída real do teste + estorno do teste, ambos visíveis).
  const novoStockLog = (snapshot.erp_stock_log || []).concat([{
    tipo: 'entrada',
    matKey: STOCK_MAT_KEY,
    matLabel: logOriginal.matLabel || 'Acrílico',
    qty: STOCK_QTY_ESTORNAR,
    os: '',
    obs: 'Estorno — OS #8 / Orçamento #000018 era cenário de teste autorizado pelo usuário (GO-LIVE FINAL 2026-08-12), removido no cleanup pós-homologação. Reverte a saída de ' + STOCK_QTY_ESTORNAR + ' un. registrada em ' + (logOriginal.dt || '(sem data)') + '.',
    dt: new Date().toLocaleString('pt-BR'),
    estornoDe: IDEMPOTENCY_KEY_ORIGINAL,
    materialId: STOCK_MAT_KEY,
    quantidade: STOCK_QTY_ESTORNAR,
    finalidade: 'estorno_cleanup_teste',
  }]);
  const novoStock = Object.assign({}, snapshot.stock);
  if (novoStock[STOCK_MAT_KEY]) {
    novoStock[STOCK_MAT_KEY] = Object.assign({}, novoStock[STOCK_MAT_KEY], { qty: (novoStock[STOCK_MAT_KEY].qty || 0) + STOCK_QTY_ESTORNAR });
  }
  await setData('erp_stock_log', novoStockLog);
  await setData('stock', novoStock);
  console.log('\n✅ Estoque estornado (+' + STOCK_QTY_ESTORNAR + ' ' + STOCK_MAT_KEY + '), log compensatório gravado.');

  // 2) Remove os artefatos do cenário de teste
  const novoOrcamentos = (snapshot.orcamentos || []).filter(o => o.id !== ORC_ID);
  const novoKbOs = Object.assign({}, snapshot.kb_os); delete novoKbOs[OS_ID];
  const novoKbOsFin = Object.assign({}, snapshot.kb_os_fin); delete novoKbOsFin[OS_ID];
  const novoFinCr = (snapshot.fin_cr || []).filter(c => !(c.orcamentoId === ORC_ID || c.osId === OS_ID));
  const novoFinTx = (snapshot.fin_tx || []).filter(t => !(t.os === '8' && t.marca === 'vr' && Math.abs((t.valor||0) - 83.08) < 0.005));

  await setData('orcamentos', novoOrcamentos);
  await setData('kb_os', novoKbOs);
  await setData('kb_os_fin', novoKbOsFin);
  await setData('fin_cr', novoFinCr);
  await setData('fin_tx', novoFinTx);
  console.log('✅ Orçamento/OS/financeiro de teste removidos.');

  // Auditoria pós-apply
  console.log('\n--- AUDITORIA PÓS-APPLY ---');
  const orcDepois = await getData('orcamentos');
  const kbOsDepois = await getData('kb_os');
  const kbOsFinDepois = await getData('kb_os_fin');
  const finCrDepois = await getData('fin_cr');
  const finTxDepois = await getData('fin_tx');
  const stockDepois = await getData('stock');

  console.log('  orcamentos: ORC-000018 ainda existe?', orcDepois.some(o => o.id === ORC_ID));
  console.log('  kb_os: OS ainda existe?', !!kbOsDepois[OS_ID]);
  console.log('  kb_os_fin: fin da OS ainda existe?', !!kbOsFinDepois[OS_ID]);
  console.log('  fin_cr: lançamentos remanescentes ligados?', finCrDepois.filter(c => c.orcamentoId === ORC_ID || c.osId === OS_ID).length);
  console.log('  fin_tx: lançamentos remanescentes (heurística)?', finTxDepois.filter(t => t.os === '8' && t.marca === 'vr' && Math.abs((t.valor||0) - 83.08) < 0.005).length);
  console.log('  stock[' + STOCK_MAT_KEY + '].qty final:', stockDepois[STOCK_MAT_KEY] && stockDepois[STOCK_MAT_KEY].qty, '(esperado:', (snapshot.stock[STOCK_MAT_KEY].qty + STOCK_QTY_ESTORNAR) + ')');
  console.log('\n✅ Limpeza concluída — zero resíduo do cenário de teste, estoque estornado com rastro auditável.\n');
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
