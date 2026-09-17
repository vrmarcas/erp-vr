/**
 * reset_operacional_os_kanban_fin_2026-09-17.js — Rodada funcional (Bloco 6).
 *
 * Reset operacional autorizado pelo usuário em 2026-09-17: todas as 13 OS
 * atualmente em `kb_os` são teste (confirmado explicitamente, incluindo as
 * que usam nomes de clientes reais — usados como fixture durante testes do
 * fluxo operacional). Remove:
 *   - as 13 OS de `kb_os` + seus 13 `kb_os_fin`;
 *   - 11 `kb_os_fin` ÓRFÃOS pré-existentes (OS #11-#36 já removidas por
 *     limpezas anteriores, cujo financeiro nunca foi limpo em conjunto —
 *     achado desta rodada, não do escopo original, mas cai diretamente no
 *     objetivo "sem registro operacional órfão" pedido pelo usuário);
 *   - `fin_cr` vinculado a qualquer uma dessas 24 OS (osId direto);
 *   - `fin_tx` vinculado por número de OS a qualquer uma dessas 24 OS.
 *
 * NUNCA TOCA:
 *   - `orcamentos` (preservados integralmente — só ficam com `osRef` órfão,
 *     é aceito, não é uma exclusão);
 *   - `clientes`;
 *   - `erp_stock_log` / estoque (8 movimentações vinculadas identificadas
 *     e reportadas, mas a reversão é decisão separada do usuário);
 *   - `fin_cp` (não tem vínculo com OS neste schema).
 *
 * Uso:
 *   node scripts/reset_operacional_os_kanban_fin_2026-09-17.js dry-run
 *   node scripts/reset_operacional_os_kanban_fin_2026-09-17.js apply
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential');

const SNAPSHOT_DIR = '/private/tmp/claude-501/-Users-gbsgabriel-Desktop-ERP-VR---go-live/3943a008-ec85-42d9-b1d9-fe0d28818a3e/scratchpad';

// ── OS atuais (auditoria dry-run 2026-09-17, todas confirmadas teste) ────
const OS_ATUAIS = [
  'os1786924167693_19', 'os1786924769166_20', 'os1787587098076_24',
  'os1787588236858_25', 'os1787662905078_26', 'os1787665171378_27',
  'os1787694752625_28', 'os1787704190169_29', 'os1787765929112_30',
  'os1787768843658_31', 'os1787847709610_33', 'os1787849818741_34',
  'os1787859310125_35',
];
// ── kb_os_fin órfãos (OS #11-#36 já removidas por limpezas anteriores) ──
const OS_ORFAS_FIN = [
  'os1786541596851_11', 'os1786546605760_12', 'os1786556950149_13',
  'os1786564275090_14', 'os1786889487626_15', 'os1786923587759_18',
  'os1786937304817_21', 'os1787434900793_22', 'os1787440015412_23',
  'os1787778812105_32', 'os1788199086022_36',
];
const TODAS_OS_IDS = OS_ATUAIS.concat(OS_ORFAS_FIN);
const TODOS_OS_NUMS = new Set(TODAS_OS_IDS.map((id) => id.split('_').pop()));

function finCrLinkedOsId(r, osIdSet) {
  if (r.osId && osIdSet.has(r.osId)) return r.osId;
  return null;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'dry-run' && mode !== 'apply') {
    console.log('Uso: node scripts/reset_operacional_os_kanban_fin_2026-09-17.js <dry-run|apply>');
    process.exitCode = 1;
    return;
  }

  const db = getProdApp().firestore();
  const COL = 'erp_vr';

  async function readDoc(key) {
    const snap = await db.collection(COL).doc(key).get();
    if (!snap.exists || !snap.data() || typeof snap.data().data === 'undefined') return null;
    return JSON.parse(snap.data().data);
  }

  console.log('[reset] lendo estado atual de produção (erp-vrmarcas)...\n');
  const kbOs = (await readDoc('kb_os')) || {};
  const kbOsFin = (await readDoc('kb_os_fin')) || {};
  const finCr = (await readDoc('fin_cr')) || [];
  const finTx = (await readDoc('fin_tx')) || [];
  const orcamentos = (await readDoc('orcamentos')) || [];
  const clientes = (await readDoc('clientes')) || [];

  const osIdSet = new Set(TODAS_OS_IDS);

  // ── snapshot de rollback (antes de qualquer decisão de escrita) ──────
  if (mode === 'apply') {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const snapPath = path.join(SNAPSHOT_DIR, 'snapshot_pre_reset_operacional_2026-09-17.json');
    fs.writeFileSync(snapPath, JSON.stringify({ kbOs, kbOsFin, finCr, finTx }, null, 2));
    console.log('[reset] snapshot de rollback salvo em: ' + snapPath + '\n');
  }

  // ── kb_os: remove as 13 atuais ────────────────────────────────────────
  const kbOsNovo = {}; let kbOsRemovidos = 0;
  Object.keys(kbOs).forEach((k) => { if (OS_ATUAIS.indexOf(k) >= 0) kbOsRemovidos++; else kbOsNovo[k] = kbOs[k]; });

  // ── kb_os_fin: remove as 13 atuais + 11 órfãs = 24 ──────────────────────
  const kbOsFinNovo = {}; let kbOsFinRemovidos = 0;
  Object.keys(kbOsFin).forEach((k) => { if (osIdSet.has(k)) kbOsFinRemovidos++; else kbOsFinNovo[k] = kbOsFin[k]; });

  // ── fin_cr: remove vinculados a qualquer uma das 24 OS ──────────────────
  const finCrNovo = finCr.filter((r) => !finCrLinkedOsId(r, osIdSet));
  const finCrRemovidos = finCr.length - finCrNovo.length;
  const finCrValorRemovido = finCr.filter((r) => finCrLinkedOsId(r, osIdSet)).reduce((s, r) => s + (Number(r.valor) || 0), 0);

  // ── fin_tx: remove vinculados por número de OS ──────────────────────────
  const finTxNovo = finTx.filter((t) => !(t.os && TODOS_OS_NUMS.has(String(t.os))));
  const finTxRemovidos = finTx.length - finTxNovo.length;
  const finTxValorRemovido = finTx.filter((t) => t.os && TODOS_OS_NUMS.has(String(t.os))).reduce((s, t) => s + (Number(t.valor) || 0), 0);

  console.log('=== ' + (mode === 'dry-run' ? 'DRY-RUN' : 'APLICANDO') + ' — reset operacional OS/Kanban/Financeiro ===\n');
  console.log('kb_os:      ' + Object.keys(kbOs).length + ' → ' + Object.keys(kbOsNovo).length + '  (remove ' + kbOsRemovidos + ')');
  console.log('kb_os_fin:  ' + Object.keys(kbOsFin).length + ' → ' + Object.keys(kbOsFinNovo).length + '  (remove ' + kbOsFinRemovidos + ')');
  console.log('fin_cr:     ' + finCr.length + ' → ' + finCrNovo.length + '  (remove ' + finCrRemovidos + ', R$ ' + finCrValorRemovido.toFixed(2) + ')');
  console.log('fin_tx:     ' + finTx.length + ' → ' + finTxNovo.length + '  (remove ' + finTxRemovidos + ', R$ ' + finTxValorRemovido.toFixed(2) + ')');
  console.log('orcamentos: ' + orcamentos.length + ' → ' + orcamentos.length + '  (NUNCA TOCADO)');
  console.log('clientes:   ' + clientes.length + ' → ' + clientes.length + '  (NUNCA TOCADO)');

  // ── salvaguardas: invariante esperado (auditoria manual 2026-09-17) ───
  const problemas = [];
  if (kbOsRemovidos !== 13) problemas.push('kb_os: esperado 13, obteve ' + kbOsRemovidos);
  if (kbOsFinRemovidos !== 24) problemas.push('kb_os_fin: esperado 24, obteve ' + kbOsFinRemovidos);
  if (finCrRemovidos !== 30) problemas.push('fin_cr: esperado 30, obteve ' + finCrRemovidos);
  if (finTxRemovidos !== 18) problemas.push('fin_tx: esperado 18, obteve ' + finTxRemovidos);

  if (problemas.length) {
    console.log('\n[reset] ABORTADO — estado da produção divergiu da auditoria manual:');
    problemas.forEach((p) => console.log('  - ' + p));
    console.log('Nenhuma escrita foi feita. Reaudite manualmente antes de tentar novamente.');
    process.exitCode = 1;
    return;
  }

  if (mode === 'dry-run') {
    console.log('\n[reset] dry-run OK — contagens batem com a auditoria manual. Nada foi escrito.');
    return;
  }

  console.log('\n[reset] APLICANDO...');
  const ts = Date.now();
  await db.collection(COL).doc('kb_os').set({ data: JSON.stringify(kbOsNovo), ts });
  await db.collection(COL).doc('kb_os_fin').set({ data: JSON.stringify(kbOsFinNovo), ts });
  await db.collection(COL).doc('fin_cr').set({ data: JSON.stringify(finCrNovo), ts });
  await db.collection(COL).doc('fin_tx').set({ data: JSON.stringify(finTxNovo), ts });
  console.log('[reset] gravação concluída.\n');

  console.log('[reset] auditoria pós-apply...');
  const kbOsAudit = (await readDoc('kb_os')) || {};
  const kbOsFinAudit = (await readDoc('kb_os_fin')) || {};
  const finCrAudit = (await readDoc('fin_cr')) || [];
  const finTxAudit = (await readDoc('fin_tx')) || [];
  const orcamentosAudit = (await readDoc('orcamentos')) || [];
  const clientesAudit = (await readDoc('clientes')) || [];
  console.log('  kb_os:      ' + Object.keys(kbOsAudit).length + ' (esperado ' + Object.keys(kbOsNovo).length + ')');
  console.log('  kb_os_fin:  ' + Object.keys(kbOsFinAudit).length + ' (esperado ' + Object.keys(kbOsFinNovo).length + ')');
  console.log('  fin_cr:     ' + finCrAudit.length + ' (esperado ' + finCrNovo.length + ')');
  console.log('  fin_tx:     ' + finTxAudit.length + ' (esperado ' + finTxNovo.length + ')');
  console.log('  orcamentos: ' + orcamentosAudit.length + ' (esperado ' + orcamentos.length + ', inalterado)');
  console.log('  clientes:   ' + clientesAudit.length + ' (esperado ' + clientes.length + ', inalterado)');
  console.log('\n[reset] CONCLUÍDO.');
}

main().catch((e) => { console.error('[reset] ERRO:', e); process.exitCode = 1; });
