/**
 * _audit_orc000035_os16_readonly_2026-08-16.js
 * READ-ONLY — mapeia todos os documentos ligados ao fixture
 * E2E_GOLIVE_SMOKE_20260816 (Orçamento #000035 / OS #16) antes de escrever
 * o script de limpeza definitivo. Nada é gravado.
 *
 * Uso: node scripts/_audit_orc000035_os16_readonly_2026-08-16.js
 */
'use strict';
const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();
const COL = 'erp_vr';

async function getDoc(key) {
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return null;
  const raw = doc.data();
  if (!raw || typeof raw.data === 'undefined') return null;
  try { return JSON.parse(raw.data); } catch (e) { return raw.data; }
}

(async () => {
  const [orcamentos, kbOs, kbOsFin, finCr, finTx, crmLeads, clientes, stock, stockLog] =
    await Promise.all(['orcamentos', 'kb_os', 'kb_os_fin', 'fin_cr', 'fin_tx', 'crm_leads', 'clientes', 'stock', 'erp_stock_log'].map(getDoc));

  const orc = (orcamentos || []).find(o => (o.cliente || '').indexOf('E2E_GOLIVE_SMOKE_20260816') !== -1 || o.num === '000035' || o.numero === '000035');
  console.log('\n=== ORCAMENTO ===');
  console.log(JSON.stringify(orc, null, 2));

  const osId = orc && orc.osRef;
  console.log('\n=== KB_OS[' + osId + '] ===');
  console.log(JSON.stringify((kbOs || {})[osId], null, 2));

  console.log('\n=== KB_OS_FIN[' + osId + '] ===');
  console.log(JSON.stringify((kbOsFin || {})[osId], null, 2));

  const crMatches = (finCr || []).filter(c => c.orcamentoId === (orc && orc.id) || c.osId === osId);
  console.log('\n=== FIN_CR matches (' + crMatches.length + ') ===');
  console.log(JSON.stringify(crMatches, null, 2));

  const txMatches = (finTx || []).filter(t => String(t.os) === '16' || String(t.osId) === osId);
  console.log('\n=== FIN_TX matches (' + txMatches.length + ') ===');
  console.log(JSON.stringify(txMatches, null, 2));

  const leadEntries = Object.entries(crmLeads || {}).filter(([k, v]) => (v && v.orcamentoId === (orc && orc.id)) || k.indexOf('16') !== -1 && JSON.stringify(v).indexOf('E2E_GOLIVE_SMOKE_20260816') !== -1);
  console.log('\n=== CRM_LEADS matches ===');
  console.log(JSON.stringify(leadEntries, null, 2));

  const cliente = (clientes || []).find(c => (c.nome || '').indexOf('E2E_GOLIVE_SMOKE_20260816') !== -1);
  console.log('\n=== CLIENTE ===');
  console.log(JSON.stringify(cliente, null, 2));

  const stockLogMatches = (stockLog || []).filter(l => l.osId === osId || (l.obs || '').indexOf('16') !== -1 && (l.obs || '').indexOf('E2E') !== -1 || l.finalidade === 'inicio_producao' && l.osId === osId);
  console.log('\n=== ERP_STOCK_LOG matches (heurística osId=' + osId + ') ===');
  console.log(JSON.stringify(stockLogMatches, null, 2));

  console.log('\n=== STOCK snapshot (chaves referenciadas acima) ===');
  const matKeys = [...new Set(stockLogMatches.map(l => l.matKey || l.materialId).filter(Boolean))];
  matKeys.forEach(k => console.log(k, '=>', JSON.stringify((stock || {})[k])));

  process.exit(0);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
