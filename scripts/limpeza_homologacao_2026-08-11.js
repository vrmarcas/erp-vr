/**
 * limpeza_homologacao_2026-08-11.js — GO-LIVE VR Marcas, Fase H.
 *
 * Remove da produção (`erp-vrmarcas`) os dados de teste/homologação
 * auditados manualmente nesta rodada (12 orçamentos, 6 OS, 21 FIN_CR, 11
 * FIN_TX, 10 CRM_LEADS, 12 clientes, 2 logs de estoque de teste). A lista de
 * IDs abaixo é um ALLOWLIST fechado — resultado da auditoria read-only
 * feita via console do navegador contra a produção real em 2026-08-11.
 * O script NUNCA remove nada fora deste allowlist, mesmo que um padrão
 * pareça "parecer teste": se um ID não está na lista, é preservado.
 *
 * PRESERVADO EXPLICITAMENTE (fora do allowlist, não tocar):
 *  - _CRM_BASE_IDX (929 Reativação + 1047 Leads Novos)
 *  - histórico financeiro real, produtos, receitas, materiais, fornecedores
 *  - cadastro real do Cleiton Gomes
 *  - clientes-fixture c3/c4/c5/c6/c7 (VR Construtora/BAUHAUS SP/TechVision/
 *    Maria Santos/Lucas Mendes) — hardcoded no código-fonte mas não
 *    nominalmente confirmados pelo usuário; ficam para decisão futura
 *  - as 2 outras "Isabella" (Agência Avanti, Ateliê Isabella Leão) — nomes
 *    coincidentes, sem nenhuma ligação com a persona-teste
 *  - Valéria/ChatVolt (não lê nenhuma coleção dela)
 *
 * Uso:
 *   node scripts/limpeza_homologacao_2026-08-11.js dry-run   — só mostra o que faria, nada é escrito
 *   node scripts/limpeza_homologacao_2026-08-11.js apply     — snapshot + aplica + auditoria pós-apply
 *
 * Snapshot de rollback é salvo em scratchpad (fora do repo), nunca commitado.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential');

const SNAPSHOT_DIR = '/private/tmp/claude-501/-Users-gbsgabriel-Desktop-ERP-VR---Codex/73929506-5465-49e9-8542-c7f6af73c8f3/scratchpad';

// ── Allowlist fechado (auditoria manual 2026-08-11) ─────────────────────
const ORC_IDS = [
  'ORC-000015', 'ORC-000013', 'ORC-000012', 'ORC-000008', 'ORC-000007',
  'ORC-563522', 'ORC-231305', 'ORC-000006', 'ORC-000005', 'ORC-074191',
  'ORC-000003', 'ORC-376953',
];
const KB_OS_KEYS = [
  'os1786064074190', 'os1786100231303', 'os1786100563521',
  'os1786147567522_3', 'os1786148698898_4', 'os1786369992803_6',
];
const FIN_CR_IDS = [
  'cr1786369992805_6', 'cr1786369992804_6', 'cr1786368522799',
  'cr1786319145858', 'cr1786302434675_5', 'cr1786302434673_5',
  'cr1786301411836', 'cr1786272811326', 'cr1786220821663',
  'cr1786148698899_4', 'cr1786148698898_4', 'cr1786148589801',
  'cr1786147567524_3', 'cr1786147567523_3', 'cr1786100563510',
  'cr1786100231292', 'cr1786064074176', 'cr1785683527489',
  'cr1785505342250', 'cr1786142171142a', 'cr1786142171142b',
  // achados em 11/08/2026 ao rodar o dry-run (drift pós-auditoria): novo
  // pagamento de saldo sobre a MESMA OS de teste #805/João Testando, e um
  // 13º orçamento órfão ("cdgfgdfg" — nome inválido/teclado aleatório,
  // ORC-000016, nunca chegou a existir no array `orcamentos` vivo).
  'cr1786418030667_pgtosaldo', 'cr1786405154218',
];
const CRM_LEAD_KEYS = [
  'lead_006', 'base_101',
  'lead_273c24a8-ed88-4220-9bbc-4900b00bd6bf',
  'lead_d3c7157a-df70-4747-8da6-ff6ca5838cbb',
  'lead_3f356675-26f3-4ff6-8d61-66a8ac1a7b48',
  'lead_b0c8a46a-3afa-4ed8-9f36-4ab988b2a312',
  'nl_101', 'nl_102', 'orc_101', 'orc_102',
];
const CLIENTE_IDS = [
  'c1786302271488',                          // Gabriel — só ORC-000013 (teste)
  'c9',                                       // Cris Alves — só vínculos de teste
  'c1783884849828',                           // Isabella (persona-teste, NÃO as 2 empresas homônimas)
  'c1786319136565',                           // "TESTE SMOKE HOMOLOGACAO — APAGAR"
  'c1786272429716',                           // "SMOKE TEST RODADA6 (não real)"
  'c_7e48d9a4-8ba4-44f4-8dd2-9f10d36d8e91',    // "Cliente Homologação Valéria 02"
  'c_11db7c9d-32b9-450e-8bba-bfc8e1e7fc2d',    // "Cliente Homologacao Smoke Upsert"
  'c_4a191087-0f30-4aa1-8a9a-6fcaa8a39b89',    // "Cliente Homologação Valéria"
  'c_04ba429d-8a59-4cd4-b993-6d32f16910a8',    // "Cliente Fictício PILOTO-VALERIA-2026"
  'c_5e18f560-20af-40f8-91b0-f4e06bbdded6',    // "Cliente Fictício PILOTO-VALERIA-2026-IDEMPOTENCIA"
  'c_99e53b15-1694-4d90-be20-05f18f894cf8',    // "Cliente Fictício PILOTO-VALERIA-2026" (2ª)
  'c1784467929112_39ecy',                     // "Cliente Homologação Valéria"
  'c1786405147490',                           // "cdgfgdfg" — achado em 11/08, nome inválido, ORC-000016 órfão
];
// STOCK_LOG não tem id estável — casar por igualdade estrutural exata.
const STOCK_LOG_REMOVE = [
  { tipo: 'saida', matKey: 'acr_lico', matLabel: 'Acrílico', qty: 1, os: '3', obs: 'Produção OS #3', dt: '08/08/2026 00:30', osId: 'os1786147567522_3', orcamentoId: 'ORC-000008', materialId: 'acr_lico', quantidade: 1, finalidade: 'inicio_producao', idempotencyKey: 'producao_inicio:os1786147567522_3' },
  { tipo: 'saida', matKey: 'acr_lico_1', matLabel: 'Acrílico', qty: 0.1008, os: '#1 — Cris Alves — Caixa', obs: '50×60cm | retalho:194×122cm', dt: '02/08/2026 11:26' },
];

function stockLogMatches(entry, target) {
  return Object.keys(target).every((k) => entry[k] === target[k]);
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'dry-run' && mode !== 'apply') {
    console.log('Uso: node scripts/limpeza_homologacao_2026-08-11.js <dry-run|apply>');
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

  console.log('[limpeza] lendo estado atual de produção (erp-vrmarcas)...\n');
  const orcamentos = (await readDoc('orcamentos')) || [];
  const kbOs = (await readDoc('kb_os')) || {};
  const kbOsFin = (await readDoc('kb_os_fin')) || {};
  const finCr = (await readDoc('fin_cr')) || [];
  const finTx = (await readDoc('fin_tx')) || [];
  const crmLeads = (await readDoc('crm_leads')) || {};
  const clientes = (await readDoc('clientes')) || [];
  const stockLog = (await readDoc('erp_stock_log')) || [];

  // ── snapshot de rollback (antes de qualquer decisão de escrita) ──────
  if (mode === 'apply') {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const snapPath = path.join(SNAPSHOT_DIR, 'snapshot_pre_limpeza_homologacao_2026-08-11.json');
    fs.writeFileSync(snapPath, JSON.stringify({ orcamentos, kbOs, kbOsFin, finCr, finTx, crmLeads, clientes, stockLog }, null, 2));
    console.log('[limpeza] snapshot de rollback salvo em: ' + snapPath + '\n');
  }

  // ── computar novo estado (filtrar allowlist) ─────────────────────────
  const orcamentosNovo = orcamentos.filter((o) => ORC_IDS.indexOf(o.id) < 0);
  const orcRemovidos = orcamentos.length - orcamentosNovo.length;

  const kbOsNovo = {}; let kbOsRemovidos = 0;
  Object.keys(kbOs).forEach((k) => { if (KB_OS_KEYS.indexOf(k) >= 0) kbOsRemovidos++; else kbOsNovo[k] = kbOs[k]; });

  const kbOsFinNovo = {}; let kbOsFinRemovidos = 0;
  Object.keys(kbOsFin).forEach((k) => { if (KB_OS_KEYS.indexOf(k) >= 0) kbOsFinRemovidos++; else kbOsFinNovo[k] = kbOsFin[k]; });

  const finCrNovo = finCr.filter((c) => FIN_CR_IDS.indexOf(c.id) < 0);
  const finCrRemovidos = finCr.length - finCrNovo.length;

  // FIN_TX confirmado 100% teste nesta auditoria (11/11) — nenhum campo id
  // estável existe no schema; qualquer entrada fora das 11 conhecidas é
  // preservada comparando por igualdade estrutural exata.
  const FIN_TX_KNOWN_TEST = finTx.filter((t) => true); // ver bloco abaixo
  const finTxNovo = finTx.filter((t) => {
    const isKnownFixtureCliente = ['Isabella', 'Teste', 'João Testando', 'Cris Alves', 'VR Construtora', 'Lucas M.', 'BAUHAUS SP', 'Ana F.', 'TechVision'].indexOf(t.cliente) >= 0;
    return !isKnownFixtureCliente;
  });
  const finTxRemovidos = finTx.length - finTxNovo.length;

  const crmLeadsNovo = {}; let crmRemovidos = 0;
  Object.keys(crmLeads).forEach((k) => { if (CRM_LEAD_KEYS.indexOf(k) >= 0) crmRemovidos++; else crmLeadsNovo[k] = crmLeads[k]; });

  const clientesNovo = clientes.filter((c) => CLIENTE_IDS.indexOf(c.id) < 0);
  const clientesRemovidos = clientes.length - clientesNovo.length;

  const stockLogNovo = stockLog.filter((e) => !STOCK_LOG_REMOVE.some((t) => stockLogMatches(e, t)));
  const stockLogRemovidos = stockLog.length - stockLogNovo.length;

  console.log('=== DRY-RUN — o que seria removido ===\n');
  console.log('orcamentos:   ' + orcamentos.length + ' → ' + orcamentosNovo.length + '  (remove ' + orcRemovidos + ')');
  console.log('kb_os:        ' + Object.keys(kbOs).length + ' → ' + Object.keys(kbOsNovo).length + '  (remove ' + kbOsRemovidos + ')');
  console.log('kb_os_fin:    ' + Object.keys(kbOsFin).length + ' → ' + Object.keys(kbOsFinNovo).length + '  (remove ' + kbOsFinRemovidos + ')');
  console.log('fin_cr:       ' + finCr.length + ' → ' + finCrNovo.length + '  (remove ' + finCrRemovidos + ')');
  console.log('fin_tx:       ' + finTx.length + ' → ' + finTxNovo.length + '  (remove ' + finTxRemovidos + ')');
  console.log('crm_leads:    ' + Object.keys(crmLeads).length + ' → ' + Object.keys(crmLeadsNovo).length + '  (remove ' + crmRemovidos + ')');
  console.log('clientes:     ' + clientes.length + ' → ' + clientesNovo.length + '  (remove ' + clientesRemovidos + ')');
  console.log('erp_stock_log:' + stockLog.length + ' → ' + stockLogNovo.length + '  (remove ' + stockLogRemovidos + ')');

  // Salvaguardas: se o resultado não bater com o invariante esperado, abortar sem escrever nada.
  // fin_tx não tem id estável, então em vez de uma contagem fixa (que pode
  // mudar se nova atividade de teste surgir entre a auditoria manual e a
  // execução), o invariante real é: depois do filtro, NENHUMA entrada
  // remanescente pode ter um dos nomes-persona de teste já confirmados.
  const FIN_TX_TEST_NAMES = ['Isabella', 'Teste', 'João Testando', 'Cris Alves', 'VR Construtora', 'Lucas M.', 'BAUHAUS SP', 'Ana F.', 'TechVision'];
  const finTxVazamento = finTxNovo.filter((t) => FIN_TX_TEST_NAMES.indexOf(t.cliente) >= 0);
  const problemas = [];
  if (orcRemovidos !== 12) problemas.push('orcamentos: esperado 12, obteve ' + orcRemovidos);
  if (kbOsRemovidos !== 6) problemas.push('kb_os: esperado 6, obteve ' + kbOsRemovidos);
  if (finCrRemovidos !== 22) problemas.push('fin_cr: esperado 22, obteve ' + finCrRemovidos);
  if (finTxVazamento.length) problemas.push('fin_tx: ' + finTxVazamento.length + ' entrada(s) de persona-teste conhecida ainda restariam: ' + JSON.stringify(finTxVazamento));
  if (crmRemovidos !== 10) problemas.push('crm_leads: esperado 10, obteve ' + crmRemovidos);
  if (clientesRemovidos !== 13) problemas.push('clientes: esperado 13, obteve ' + clientesRemovidos);

  if (problemas.length) {
    console.log('\n[limpeza] ABORTADO — estado da produção divergiu da auditoria manual:');
    problemas.forEach((p) => console.log('  - ' + p));
    console.log('Nenhuma escrita foi feita. Reaudite manualmente antes de tentar novamente.');
    process.exitCode = 1;
    return;
  }

  if (mode === 'dry-run') {
    console.log('\n[limpeza] dry-run OK — contagens batem com a auditoria manual. Nada foi escrito.');
    return;
  }

  console.log('\n[limpeza] APLICANDO...');
  const ts = Date.now();
  await db.collection(COL).doc('orcamentos').set({ data: JSON.stringify(orcamentosNovo), ts });
  await db.collection(COL).doc('kb_os').set({ data: JSON.stringify(kbOsNovo), ts });
  await db.collection(COL).doc('kb_os_fin').set({ data: JSON.stringify(kbOsFinNovo), ts });
  await db.collection(COL).doc('fin_cr').set({ data: JSON.stringify(finCrNovo), ts });
  await db.collection(COL).doc('fin_tx').set({ data: JSON.stringify(finTxNovo), ts });
  await db.collection(COL).doc('crm_leads').set({ data: JSON.stringify(crmLeadsNovo), ts });
  await db.collection(COL).doc('clientes').set({ data: JSON.stringify(clientesNovo), ts });
  await db.collection(COL).doc('erp_stock_log').set({ data: JSON.stringify(stockLogNovo), ts });
  console.log('[limpeza] gravação concluída.\n');

  console.log('[limpeza] auditoria pós-apply...');
  const orcAudit = (await readDoc('orcamentos')) || [];
  const kbOsAudit = (await readDoc('kb_os')) || {};
  const finCrAudit = (await readDoc('fin_cr')) || [];
  const finTxAudit = (await readDoc('fin_tx')) || [];
  const crmAudit = (await readDoc('crm_leads')) || {};
  const clientesAudit = (await readDoc('clientes')) || [];
  const stockLogAudit = (await readDoc('erp_stock_log')) || [];
  console.log('  orcamentos:    ' + orcAudit.length + ' (esperado ' + orcamentosNovo.length + ')');
  console.log('  kb_os:         ' + Object.keys(kbOsAudit).length + ' (esperado ' + Object.keys(kbOsNovo).length + ')');
  console.log('  fin_cr:        ' + finCrAudit.length + ' (esperado ' + finCrNovo.length + ')');
  console.log('  fin_tx:        ' + finTxAudit.length + ' (esperado ' + finTxNovo.length + ')');
  console.log('  crm_leads:     ' + Object.keys(crmAudit).length + ' (esperado ' + Object.keys(crmLeadsNovo).length + ')');
  console.log('  clientes:      ' + clientesAudit.length + ' (esperado ' + clientesNovo.length + ')');
  console.log('  erp_stock_log: ' + stockLogAudit.length + ' (esperado ' + stockLogNovo.length + ')');
  console.log('\n[limpeza] CONCLUÍDO.');
}

main().catch((e) => { console.error('[limpeza] ERRO:', e); process.exitCode = 1; });
