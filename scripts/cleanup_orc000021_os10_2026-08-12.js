/**
 * cleanup_orc000021_os10_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12 — remove o cenário de teste Orçamento #000021 /
 * OS #10, criado durante a reverificação final dos gates 1 e 2 (fixture
 * "TESTE GO-LIVE 20260812 GATE1 REVERIFICACAO — excluir").
 *
 * Achado da auditoria (read-only, antes deste script):
 *   - orcamentos: ORC-000021 (num "000021"), status 'em_producao',
 *     osRef 'os1786534242836_10'.
 *   - kb_os: os1786534242836_10 (num "10"), status 'producao'.
 *   - A OS consumiu 1 unidade REAL de estoque ("acr_lico" — Acrílico
 *     Cristal 2mm) via erp_stock_log (tipo:'saida',
 *     finalidade:'inicio_producao',
 *     idempotencyKey:'producao_inicio:os1786534242836_10').
 *     stock.acr_lico.qty atual = 22 (era 23 antes do teste). Nenhum
 *     estorno existente para essa chave (confirmado).
 *   - kb_os_fin[os1786534242836_10]: totalGeral 806.84, valorEntrada
 *     403.42, restante 403.42 (pagtoTipo '50-50').
 *   - fin_cr: 2 lançamentos ligados por orcamentoId/osId —
 *     cr1786534242837_10 (Entrada, recebido) e cr1786534242838_10
 *     (Restante, pendente).
 *   - fin_tx: 1 lançamento (os:'10', marca:'vr', valor 403.42, PIX,
 *     recebido) — sem id próprio no array, casado por heurística
 *     (os+marca+valor).
 *   - crm_leads: chave 'orc_101' (orcamentoId: 'ORC-000021', criado por
 *     orcGerarOS).
 *   - clientes: c1786533044696 — criado automaticamente só para este
 *     teste (único orçamento vinculado é ORC-000021, nenhuma OS própria).
 *   - retalhos: nenhum vinculado (a OS usou chapa nova, não retalho).
 *   - erp_vr_rascunho_orc/{uid}: rascunho temporário "TESTE VERIFICACAO
 *     TEMP — nao salvar" já removido diretamente durante a sessão
 *     (não faz parte deste script).
 *
 * Este script NÃO apenas apaga os registros — primeiro ESTORNA a saída de
 * estoque com uma entrada compensatória auditável (nunca edita/apaga o
 * log original), depois remove os artefatos do cenário de teste:
 *   - orcamentos: entrada ORC-000021
 *   - kb_os / kb_os_fin: os1786534242836_10
 *   - fin_cr: 2 lançamentos
 *   - fin_tx: 1 lançamento
 *   - crm_leads: orc_101
 *   - clientes: c1786533044696
 *   - retalhos: nenhum (nada a remover)
 *
 * Modo: snapshot → dry-run (mostra o que seria alterado) → apply (só se
 * chamado com --apply) → auditoria pós-apply.
 *
 * Uso:
 *   node scripts/cleanup_orc000021_os10_2026-08-12.js            # dry-run
 *   node scripts/cleanup_orc000021_os10_2026-08-12.js --apply    # aplica
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();

const APPLY = process.argv.includes('--apply');
const ORC_ID = 'ORC-000021';
const OS_ID = 'os1786534242836_10';
const CRM_LEAD_ID = 'orc_101';
const CLIENTE_ID = 'c1786533044696';
const STOCK_MAT_KEY = 'acr_lico';
const STOCK_QTY_ESTORNAR = 1;
const COL = 'erp_vr';

async function getDoc(key) {
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return { exists: false, data: null, raw: null };
  const raw = doc.data();
  if (!raw || typeof raw.data === 'undefined') return { exists: false, data: null, raw };
  try { return { exists: true, data: JSON.parse(raw.data), raw }; }
  catch (e) { return { exists: true, data: raw.data, raw }; }
}

async function setDoc(key, data) {
  await db.collection(COL).doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

(async () => {
  console.log('='.repeat(70));
  console.log(APPLY ? 'MODO: APPLY (vai gravar alterações)' : 'MODO: DRY-RUN (nada será gravado)');
  console.log('='.repeat(70));

  const [orcamentosDoc, kbOsDoc, kbOsFinDoc, finCrDoc, finTxDoc, crmLeadsDoc, clientesDoc, stockDoc, stockLogDoc] =
    await Promise.all(['orcamentos', 'kb_os', 'kb_os_fin', 'fin_cr', 'fin_tx', 'crm_leads', 'clientes', 'stock', 'erp_stock_log'].map(getDoc));

  const snapshot = {
    orcamentos: orcamentosDoc.data,
    kb_os: kbOsDoc.data,
    kb_os_fin: kbOsFinDoc.data,
    fin_cr: finCrDoc.data,
    fin_tx: finTxDoc.data,
    crm_leads: crmLeadsDoc.data,
    clientes: clientesDoc.data,
    stock: stockDoc.data,
    erp_stock_log: stockLogDoc.data,
  };
  const snapshotPath = path.join(__dirname, '_snapshot_pre_limpeza_orc000021_2026-08-12.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log('\nSnapshot salvo em:', snapshotPath);

  // ── orcamentos ──
  const arrOrc = snapshot.orcamentos || [];
  const orc = arrOrc.find(o => o.id === ORC_ID);
  if (!orc) { console.log('\n⚠️  Orçamento ' + ORC_ID + ' não encontrado — nada a fazer.'); process.exit(0); }
  console.log('\norcamentos: remove', ORC_ID, '(status atual:', orc.status + ')');
  const novoArrOrc = arrOrc.filter(o => o.id !== ORC_ID);

  // ── kb_os / kb_os_fin ──
  const objOs = snapshot.kb_os || {};
  console.log('kb_os: remove', OS_ID, '(status atual:', (objOs[OS_ID] || {}).status + ')');
  const novoObjOs = Object.assign({}, objOs); delete novoObjOs[OS_ID];

  const objOsFin = snapshot.kb_os_fin || {};
  console.log('kb_os_fin: remove', OS_ID);
  const novoObjOsFin = Object.assign({}, objOsFin); delete novoObjOsFin[OS_ID];

  // ── fin_cr ──
  const arrCr = snapshot.fin_cr || [];
  const crMatches = arrCr.filter(c => c.orcamentoId === ORC_ID || c.osId === OS_ID);
  console.log('fin_cr: remove', crMatches.length, 'lançamento(s) —', crMatches.map(c => c.id).join(', '));
  const novoArrCr = arrCr.filter(c => !(c.orcamentoId === ORC_ID || c.osId === OS_ID));

  // ── fin_tx (sem id próprio — casa por heurística os+marca+valor) ──
  const arrTx = snapshot.fin_tx || [];
  const txMatches = arrTx.filter(t => t.os === '10' && t.marca === 'vr' && Math.abs((t.valor || 0) - 403.42) < 0.005);
  console.log('fin_tx: remove', txMatches.length, 'lançamento(s) (os=10, marca=vr, valor≈403.42)');
  let txRemovidos = 0;
  const novoArrTx = arrTx.filter(t => {
    if (t.os === '10' && t.marca === 'vr' && Math.abs((t.valor || 0) - 403.42) < 0.005 && txRemovidos < 1) {
      txRemovidos++; return false;
    }
    return true;
  });

  // ── crm_leads ──
  const objLeads = snapshot.crm_leads || {};
  console.log('crm_leads: remove', CRM_LEAD_ID, '(existe:', !!objLeads[CRM_LEAD_ID] + ')');
  const novoObjLeads = Object.assign({}, objLeads); delete novoObjLeads[CRM_LEAD_ID];

  // ── clientes ──
  const arrClientes = snapshot.clientes || [];
  const cliente = arrClientes.find(c => c.id === CLIENTE_ID);
  console.log('clientes: remove', CLIENTE_ID, '(existe:', !!cliente + ', orçamentos vinculados:', (cliente && cliente.orcamentos || []).length + ')');
  const novoArrClientes = arrClientes.filter(c => c.id !== CLIENTE_ID);

  // ── stock + erp_stock_log (estorno) ──
  const objStock = snapshot.stock || {};
  const qtyAtual = (objStock[STOCK_MAT_KEY] || {}).qty;
  console.log('stock[' + STOCK_MAT_KEY + '].qty:', qtyAtual, '→', qtyAtual + STOCK_QTY_ESTORNAR);
  const arrLog = snapshot.erp_stock_log || [];
  const jaTemEstorno = arrLog.some(l => l.estornoDe === 'producao_inicio:' + OS_ID);
  if (jaTemEstorno) { console.log('⚠️  Já existe estorno para esta chave — abortando para evitar duplicidade.'); process.exit(1); }
  const novoObjStock = Object.assign({}, objStock);
  if (novoObjStock[STOCK_MAT_KEY]) {
    novoObjStock[STOCK_MAT_KEY] = Object.assign({}, novoObjStock[STOCK_MAT_KEY], { qty: (novoObjStock[STOCK_MAT_KEY].qty || 0) + STOCK_QTY_ESTORNAR });
  }
  const novoArrLog = arrLog.concat([{
    tipo: 'entrada',
    matKey: STOCK_MAT_KEY,
    matLabel: (objStock[STOCK_MAT_KEY] || {}).label || 'Acrílico',
    qty: STOCK_QTY_ESTORNAR,
    materialId: STOCK_MAT_KEY,
    quantidade: STOCK_QTY_ESTORNAR,
    finalidade: 'estorno_limpeza_teste',
    obs: 'Estorno automático — limpeza do cenário de teste ORC-000021/OS#10 (GO-LIVE FINAL 2026-08-12)',
    estornoDe: 'producao_inicio:' + OS_ID,
    dt: new Date().toLocaleString('pt-BR'),
    ts: Date.now(),
    usuario: 'cleanup-script',
  }]);
  console.log('erp_stock_log: adiciona 1 entrada compensatória (estorno de', STOCK_QTY_ESTORNAR, STOCK_MAT_KEY + ')');

  console.log('\n' + '='.repeat(70));
  if (!APPLY) {
    console.log('DRY-RUN concluído — nada foi gravado. Rode com --apply para aplicar.');
    process.exit(0);
  }

  console.log('APLICANDO alterações...');
  await setDoc('orcamentos', novoArrOrc);
  await setDoc('kb_os', novoObjOs);
  await setDoc('kb_os_fin', novoObjOsFin);
  await setDoc('fin_cr', novoArrCr);
  await setDoc('fin_tx', novoArrTx);
  await setDoc('crm_leads', novoObjLeads);
  await setDoc('clientes', novoArrClientes);
  await setDoc('stock', novoObjStock);
  await setDoc('erp_stock_log', novoArrLog);
  console.log('✅ Alterações gravadas.');

  // ── auditoria pós-apply ──
  console.log('\n' + '='.repeat(70));
  console.log('AUDITORIA PÓS-APPLY');
  console.log('='.repeat(70));
  const [orcDepois, osDepois, osFinDepois, crDepois, txDepois, leadsDepois, clientesDepois, stockDepois, logDepois] =
    await Promise.all(['orcamentos', 'kb_os', 'kb_os_fin', 'fin_cr', 'fin_tx', 'crm_leads', 'clientes', 'stock', 'erp_stock_log'].map(getDoc));

  const checks = [
    ['orçamento removido', !(orcDepois.data || []).some(o => o.id === ORC_ID)],
    ['OS removida', !(osDepois.data || {})[OS_ID]],
    ['kb_os_fin removido', !(osFinDepois.data || {})[OS_ID]],
    ['fin_cr sem lançamentos do teste', !(crDepois.data || []).some(c => c.orcamentoId === ORC_ID || c.osId === OS_ID)],
    ['fin_tx sem lançamento do teste', !(txDepois.data || []).some(t => t.os === '10' && t.marca === 'vr' && Math.abs((t.valor||0)-403.42) < 0.005)],
    ['crm_leads sem orc_101', !(leadsDepois.data || {})[CRM_LEAD_ID]],
    ['cliente removido', !(clientesDepois.data || []).some(c => c.id === CLIENTE_ID)],
    ['stock.acr_lico.qty restaurado (' + (qtyAtual + STOCK_QTY_ESTORNAR) + ')', (stockDepois.data || {})[STOCK_MAT_KEY] && (stockDepois.data[STOCK_MAT_KEY].qty === qtyAtual + STOCK_QTY_ESTORNAR)],
    ['erp_stock_log tem original + estorno', (logDepois.data || []).filter(l => l.osId === OS_ID || l.estornoDe === 'producao_inicio:' + OS_ID).length === 2],
  ];
  let allOk = true;
  checks.forEach(([label, ok]) => { console.log((ok ? '✅' : '❌'), label); if (!ok) allOk = false; });
  console.log('\n' + (allOk ? '✅ AUDITORIA: 8/8 PASS — resíduo zero.' : '❌ AUDITORIA: alguma checagem falhou — revisar.'));
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
