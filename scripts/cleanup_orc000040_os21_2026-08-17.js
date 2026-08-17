/**
 * cleanup_orc000040_os21_2026-08-17.js
 *
 * RODADA DE VALIDAÇÃO OPERACIONAL 2026-08-17 — remove o fixture de teste
 * "E2E_VALIDACAO_20260817 Planificacao" (Orçamento #000040), criado ao
 * vivo pela UI real para validar os Fluxos 1-8 do checklist de validação
 * (Planificação, Espessuras, Sincronização Orçamento→OS, Prazo, A Receber,
 * Pagamento Posterior, Checklist, Exclusão).
 *
 * A OS #21 (os1786937304817_21) já foi excluída pela UI durante o próprio
 * Fluxo 8 (Exclusão) — confirmado ao vivo via KB_OS (só restam os#19/os#20).
 * Este script remove o restante do resíduo: o orçamento de origem
 * (ORC-000040, que não tem opção de exclusão na UI) e os lançamentos
 * financeiros/CRM/cliente/estoque gerados durante o teste.
 *
 * Modo: snapshot → dry-run (mostra o que seria alterado) → apply (só se
 * chamado com --apply) → auditoria pós-apply. Detecção DINÂMICA por
 * orcamentoId/osId/cliente (não por índice fixo), para pegar tudo que
 * ficou vinculado ao teste mesmo que eu não tenha antecipado o registro.
 *
 * Uso:
 *   node scripts/cleanup_orc000040_os21_2026-08-17.js            # dry-run
 *   node scripts/cleanup_orc000040_os21_2026-08-17.js --apply    # aplica
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();

const APPLY = process.argv.includes('--apply');
const ORC_ID = 'ORC-000040';
const OS_ID = 'os1786937304817_21';
const CLIENTE_NOME = 'E2E_VALIDACAO_20260817 Planificacao';
const STOCK_MAT_KEY = 'acr_lico_2'; // Acrílico Cristal — 4mm (1 chapa retirada em "Iniciar Produção")
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

  const keys = ['orcamentos', 'kb_os', 'fin_cr', 'fin_tx', 'crm_leads', 'clientes', 'stock', 'erp_stock_log'];
  const [orcamentosDoc, kbOsDoc, finCrDoc, finTxDoc, crmLeadsDoc, clientesDoc, stockDoc, stockLogDoc] =
    await Promise.all(keys.map(getDoc));

  const snapshot = {
    orcamentos: orcamentosDoc.data,
    kb_os: kbOsDoc.data,
    fin_cr: finCrDoc.data,
    fin_tx: finTxDoc.data,
    crm_leads: crmLeadsDoc.data,
    clientes: clientesDoc.data,
    stock: stockDoc.data,
    erp_stock_log: stockLogDoc.data,
  };
  const snapshotPath = path.join(__dirname, '_snapshot_pre_limpeza_orc000040_2026-08-17.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log('\nSnapshot salvo em:', snapshotPath);

  // ── orcamentos ──
  const arrOrc = snapshot.orcamentos || [];
  const orc = arrOrc.find(o => o.id === ORC_ID);
  if (!orc) { console.log('\n⚠️  Orçamento ' + ORC_ID + ' não encontrado — já foi limpo, nada a fazer.'); process.exit(0); }
  console.log('\norcamentos: remove', ORC_ID, '(status atual:', orc.status + ', crmLeadId:', orc.crmLeadId, ', crId:', orc.crId, ')');
  const novoArrOrc = arrOrc.filter(o => o.id !== ORC_ID);

  // ── kb_os: confirma que já não existe (removido pela própria UI no Fluxo 8) ──
  const objOs = snapshot.kb_os || {};
  console.log('kb_os: OS', OS_ID, objOs[OS_ID] ? '⚠️ AINDA EXISTE (inesperado — UI deveria já ter excluído)' : 'já ausente (confirmado — excluída pela UI no Fluxo 8)');
  const novoObjOs = objOs[OS_ID] ? (() => { const o = Object.assign({}, objOs); delete o[OS_ID]; return o; })() : objOs;

  // ── fin_cr — detecção dinâmica por orcamentoId/osId/osRef ──
  const arrCr = snapshot.fin_cr || [];
  const crMatches = arrCr.filter(c => c.orcamentoId === ORC_ID || c.osId === OS_ID || c.osRef === 'OS #21');
  console.log('fin_cr: remove', crMatches.length, 'lançamento(s) —', crMatches.map(c => c.id + ':' + c.status).join(', ') || '(nenhum)');
  const novoArrCr = arrCr.filter(c => !(c.orcamentoId === ORC_ID || c.osId === OS_ID || c.osRef === 'OS #21'));

  // ── fin_tx — detecção dinâmica por os=21 + marca=vr ──
  const arrTx = snapshot.fin_tx || [];
  const txMatches = arrTx.filter(t => String(t.os) === '21' && t.marca === 'vr');
  console.log('fin_tx: remove', txMatches.length, 'lançamento(s) (os=21, marca=vr) — valores:', txMatches.map(t => t.valor).join(', ') || '(nenhum)');
  const novoArrTx = arrTx.filter(t => !(String(t.os) === '21' && t.marca === 'vr'));

  // ── crm_leads — detecção dinâmica por orçamento vinculado ──
  const objLeads = snapshot.crm_leads || {};
  const leadIdsAlvo = Object.keys(objLeads).filter(id => {
    const l = objLeads[id];
    return l && (l.orcId === ORC_ID || l.orcamentoId === ORC_ID || l.id === orc.crmLeadId);
  });
  console.log('crm_leads: remove', leadIdsAlvo.length, 'lead(s) —', leadIdsAlvo.join(', ') || '(nenhum)');
  const novoObjLeads = Object.assign({}, objLeads); leadIdsAlvo.forEach(id => delete novoObjLeads[id]);

  // ── clientes — detecção dinâmica por nome do fixture ──
  const arrClientes = snapshot.clientes || [];
  const clientesAlvo = arrClientes.filter(c => c.nome === CLIENTE_NOME);
  console.log('clientes: remove', clientesAlvo.length, 'cliente(s) —', clientesAlvo.map(c => c.id).join(', ') || '(nenhum)');
  const novoArrClientes = arrClientes.filter(c => c.nome !== CLIENTE_NOME);

  // ── stock + erp_stock_log (estorno da chapa retirada em Iniciar Produção) ──
  const objStock = snapshot.stock || {};
  const qtyAtual = (objStock[STOCK_MAT_KEY] || {}).qty;
  const arrLog = snapshot.erp_stock_log || [];
  const jaTemSaida = arrLog.some(l => l.osId === OS_ID || (l.obs && String(l.obs).includes(OS_ID)));
  const jaTemEstorno = arrLog.some(l => l.estornoDe === 'producao_inicio:' + OS_ID);
  console.log('stock[' + STOCK_MAT_KEY + '].qty atual:', qtyAtual, '| saída original encontrada no log:', jaTemSaida, '| estorno já existe:', jaTemEstorno);

  let novoObjStock = objStock;
  let novoArrLog = arrLog;
  let faraEstorno = false;
  if (jaTemSaida && !jaTemEstorno) {
    faraEstorno = true;
    console.log('stock[' + STOCK_MAT_KEY + '].qty:', qtyAtual, '→', (qtyAtual || 0) + STOCK_QTY_ESTORNAR, '(estorno)');
    novoObjStock = Object.assign({}, objStock);
    if (novoObjStock[STOCK_MAT_KEY]) {
      novoObjStock[STOCK_MAT_KEY] = Object.assign({}, novoObjStock[STOCK_MAT_KEY], { qty: (novoObjStock[STOCK_MAT_KEY].qty || 0) + STOCK_QTY_ESTORNAR });
    }
    novoArrLog = arrLog.concat([{
      tipo: 'entrada',
      matKey: STOCK_MAT_KEY,
      matLabel: (objStock[STOCK_MAT_KEY] || {}).label || 'Acrílico Cristal 4mm',
      qty: STOCK_QTY_ESTORNAR,
      materialId: STOCK_MAT_KEY,
      quantidade: STOCK_QTY_ESTORNAR,
      finalidade: 'estorno_limpeza_teste',
      obs: 'Estorno automático — limpeza do fixture de teste ORC-000040/OS#21 (rodada de validação operacional 2026-08-17, Fluxos 1-8)',
      estornoDe: 'producao_inicio:' + OS_ID,
      dt: new Date().toLocaleString('pt-BR'),
      ts: Date.now(),
      usuario: 'cleanup-script',
    }]);
  } else if (!jaTemSaida) {
    console.log('⚠️  Nenhuma saída de estoque encontrada no log para esta OS — nenhum estorno necessário (a chapa pode ter sido registrada de outra forma, ou o log não está mais disponível).');
  } else {
    console.log('⚠️  Estorno já existe — não duplicando.');
  }

  console.log('\n' + '='.repeat(70));
  if (!APPLY) {
    console.log('DRY-RUN concluído — nada foi gravado. Rode com --apply para aplicar.');
    process.exit(0);
  }

  console.log('APLICANDO alterações...');
  await setDoc('orcamentos', novoArrOrc);
  if (objOs[OS_ID]) await setDoc('kb_os', novoObjOs);
  await setDoc('fin_cr', novoArrCr);
  await setDoc('fin_tx', novoArrTx);
  await setDoc('crm_leads', novoObjLeads);
  await setDoc('clientes', novoArrClientes);
  if (faraEstorno) { await setDoc('stock', novoObjStock); await setDoc('erp_stock_log', novoArrLog); }
  console.log('✅ Alterações gravadas.');

  // ── auditoria pós-apply ──
  console.log('\n' + '='.repeat(70));
  console.log('AUDITORIA PÓS-APPLY');
  console.log('='.repeat(70));
  const [orcDepois, osDepois, crDepois, txDepois, leadsDepois, clientesDepois, stockDepois, logDepois] =
    await Promise.all(keys.filter(k => k !== 'kb_os' || true).map(getDoc));

  const checks = [
    ['orçamento removido', !(orcDepois.data || []).some(o => o.id === ORC_ID)],
    ['OS ausente', !(osDepois.data || {})[OS_ID]],
    ['fin_cr sem lançamentos do teste', !(crDepois.data || []).some(c => c.orcamentoId === ORC_ID || c.osId === OS_ID || c.osRef === 'OS #21')],
    ['fin_tx sem lançamentos do teste', !(txDepois.data || []).some(t => String(t.os) === '21' && t.marca === 'vr')],
    ['crm_leads sem leads do teste', leadIdsAlvo.every(id => !(leadsDepois.data || {})[id])],
    ['clientes sem o fixture', !(clientesDepois.data || []).some(c => c.nome === CLIENTE_NOME)],
  ];
  if (faraEstorno) {
    checks.push(['stock.' + STOCK_MAT_KEY + '.qty restaurado (' + ((qtyAtual || 0) + STOCK_QTY_ESTORNAR) + ')', (stockDepois.data || {})[STOCK_MAT_KEY] && (stockDepois.data[STOCK_MAT_KEY].qty === (qtyAtual || 0) + STOCK_QTY_ESTORNAR)]);
    checks.push(['erp_stock_log tem estorno registrado', (logDepois.data || []).some(l => l.estornoDe === 'producao_inicio:' + OS_ID)]);
  }
  let allOk = true;
  checks.forEach(([label, ok]) => { console.log((ok ? '✅' : '❌'), label); if (!ok) allOk = false; });
  console.log('\n' + (allOk ? '✅ AUDITORIA: ' + checks.length + '/' + checks.length + ' PASS — resíduo zero.' : '❌ AUDITORIA: alguma checagem falhou — revisar.'));
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
