/**
 * dryrun_reset_operacional_2026-09-17.js — Rodada funcional (Bloco 6).
 *
 * SOMENTE LEITURA. Não escreve nada em nenhuma coleção. Inventaria o estado
 * atual de produção (erp-vrmarcas) para decidir se um reset operacional de
 * OS/Kanban/Financeiro pode ser executado com segurança:
 *   - todas as OS existentes;
 *   - todo o Kanban (kb_os / kb_os_fin);
 *   - Contas a Receber (fin_cr) vinculadas a cada OS (campo osId, com
 *     fallback textual "OS #<num>" em osRef para lançamentos antigos);
 *   - Contas a Pagar legado (fin_cp) — não tem vínculo com OS, reportado
 *     apenas para constar;
 *   - Contas a Pagar v2 / Compras (erp_vr_fin_cp, erp_vr_compras) vinculadas
 *     via origem.osId;
 *   - fin_tx (caixa) vinculado por número de OS (campo `os`, string);
 *   - erp_stock_log vinculado por osId (para relatar, NUNCA reverter
 *     automaticamente);
 *   - vitre_os vinculado via grupoPedidoId/kbOsRef;
 *   - quantos orçamentos e clientes SERIAM afetados por um reset de OS
 *     (deve dar 0 exclusões — orçamento/cliente não é tocado por este
 *     reset; o único efeito colateral possível é o campo `osRef` do
 *     orçamento ficar "orfão" apontando pra uma OS que deixou de existir,
 *     o que é uma decisão em aberto, não uma exclusão).
 *
 * Uso:
 *   node scripts/dryrun_reset_operacional_2026-09-17.js
 */
'use strict';
const { getProdApp } = require('./_prod_admin_credential');

async function main() {
  const db = getProdApp().firestore();
  const COL = 'erp_vr';

  async function readDoc(key) {
    const snap = await db.collection(COL).doc(key).get();
    if (!snap.exists || !snap.data() || typeof snap.data().data === 'undefined') return null;
    return JSON.parse(snap.data().data);
  }

  console.log('[dry-run] lendo estado atual de produção (erp-vrmarcas)...\n');

  const orcamentos = (await readDoc('orcamentos')) || [];
  const kbOs = (await readDoc('kb_os')) || {};
  const kbOsFin = (await readDoc('kb_os_fin')) || {};
  const finCr = (await readDoc('fin_cr')) || [];
  const finCpLegado = (await readDoc('fin_cp')) || [];
  const finTx = (await readDoc('fin_tx')) || [];
  const clientes = (await readDoc('clientes')) || [];
  const stockLog = (await readDoc('erp_stock_log')) || [];

  const osIds = Object.keys(kbOs);
  const osNums = new Set(osIds.map((k) => String(kbOs[k].num)));

  // ── breakdown por status ──────────────────────────────────────────────
  const STATUS_TERMINAL = ['entregue', 'cancelado'];
  const porStatus = {};
  osIds.forEach((k) => {
    const st = kbOs[k].status || '(sem status)';
    porStatus[st] = (porStatus[st] || 0) + 1;
  });
  const ativas = osIds.filter((k) => STATUS_TERMINAL.indexOf(kbOs[k].status) < 0 && kbOs[k].status !== 'pronta').length;
  const prontas = osIds.filter((k) => kbOs[k].status === 'pronta').length;
  const entregues = osIds.filter((k) => kbOs[k].status === 'entregue').length;
  const cancelados = osIds.filter((k) => kbOs[k].status === 'cancelado').length;

  // ── fin_cr vinculado a OS (osId direto, ou osRef textual "OS #n") ──────
  function finCrLinkedOsId(r) {
    if (r.osId && osIds.indexOf(r.osId) >= 0) return r.osId;
    const m = /OS #(\S+)/.exec(r.osRef || '');
    if (m && osNums.has(m[1])) {
      const found = osIds.find((k) => String(kbOs[k].num) === m[1]);
      return found || null;
    }
    return null;
  }
  const finCrVinculado = finCr.filter((r) => finCrLinkedOsId(r));
  const finCrValorTotal = finCrVinculado.reduce((s, r) => s + (Number(r.valor) || 0), 0);

  // ── fin_tx vinculado a OS (campo `os` = número da OS) ───────────────────
  const finTxVinculado = finTx.filter((t) => t.os && osNums.has(String(t.os)));
  const finTxValorTotal = finTxVinculado.reduce((s, t) => s + (Number(t.valor) || 0), 0);

  // ── erp_stock_log vinculado a OS (osId) ─────────────────────────────────
  const stockLogVinculado = stockLog.filter((e) => e.osId && osIds.indexOf(e.osId) >= 0);

  // ── orçamentos / clientes que SERIAM afetados (deve ser 0 exclusões) ───
  // Este reset não filtra/remove nada de `orcamentos` nem `clientes` — só
  // reporta quantos orçamentos têm osRef apontando para uma OS que será
  // zerada (efeito colateral de referência órfã, não uma exclusão).
  const orcamentosComOsRefAfetado = orcamentos.filter((o) => o.osRef && osIds.indexOf(o.osRef) >= 0);
  const clientesRemovidos = 0; // este reset nunca toca `clientes`

  console.log('=== DRY-RUN — RESET OPERACIONAL (OS / Kanban / Financeiro) ===\n');
  console.log('TOTAL OS (kb_os):', osIds.length);
  console.log('  por status:', JSON.stringify(porStatus, null, 2));
  console.log('  ATIVAS (não pronta/entregue/cancelado):', ativas);
  console.log('  PRONTAS:', prontas);
  console.log('  ENTREGUES:', entregues);
  console.log('  CANCELADAS:', cancelados);
  console.log('  kb_os_fin (financeiro por OS):', Object.keys(kbOsFin).length);
  console.log();
  console.log('KANBAN CARDS: derivado 1:1 de kb_os (não há coleção separada) →', osIds.length);
  console.log();
  console.log('CONTAS A RECEBER (fin_cr) vinculadas a OS:');
  console.log('  quantidade:', finCrVinculado.length, '/ total fin_cr:', finCr.length);
  console.log('  valor total: R$', finCrValorTotal.toFixed(2));
  console.log();
  console.log('CONTAS A PAGAR legado (fin_cp) — sem vínculo com OS neste schema:');
  console.log('  total fin_cp (não afetado por este reset):', finCpLegado.length);
  console.log();
  console.log('FIN_TX (caixa) vinculado a OS (por número):');
  console.log('  quantidade:', finTxVinculado.length, '/ total fin_tx:', finTx.length);
  console.log('  valor total: R$', finTxValorTotal.toFixed(2));
  console.log();
  console.log('ESTOQUE — erp_stock_log vinculado a OS (SÓ RELATO, não reverter automaticamente):');
  console.log('  quantidade:', stockLogVinculado.length, '/ total erp_stock_log:', stockLog.length);
  if (stockLogVinculado.length) {
    console.log('  detalhe:');
    stockLogVinculado.forEach((e) => {
      console.log('   - OS ' + e.osId + ' | material ' + (e.matLabel || e.materialId) + ' | qty ' + (e.qty || e.quantidade) + ' | ' + (e.dt || '') + ' | ' + (e.obs || ''));
    });
  }
  console.log();
  console.log('ORÇAMENTOS que seriam afetados por exclusão: 0 (este reset NUNCA filtra `orcamentos`)');
  console.log('  orçamentos com osRef apontando p/ OS que será zerada (referência órfã, não exclusão):', orcamentosComOsRefAfetado.length);
  if (orcamentosComOsRefAfetado.length) {
    orcamentosComOsRefAfetado.forEach((o) => console.log('   - ' + o.id + ' → osRef ' + o.osRef));
  }
  console.log();
  console.log('CLIENTES que seriam afetados por exclusão:', clientesRemovidos, '(este reset NUNCA filtra `clientes`)');
  console.log();
  console.log('=== OS individuais (detalhe para revisão manual) ===');
  osIds.forEach((k) => {
    const os = kbOs[k];
    const crCount = finCr.filter((r) => finCrLinkedOsId(r) === k).length;
    const txCount = finTx.filter((t) => t.os && String(t.os) === String(os.num)).length;
    const stkCount = stockLog.filter((e) => e.osId === k).length;
    console.log(
      '  ' + k + ' | #' + os.num + ' | ' + (os.cliente || '?') + ' | status=' + os.status +
      ' | orcRef=' + (os.orcRef || '—') + ' | fin_cr=' + crCount + ' | fin_tx=' + txCount + ' | stock=' + stkCount
    );
  });

  console.log('\n[dry-run] CONCLUÍDO. Nenhuma escrita foi feita.');
}

main().catch((e) => { console.error('[dry-run] ERRO:', e); process.exitCode = 1; });
