/**
 * cleanup_orc000035_os16_2026-08-16.js
 *
 * HOTFIX PLANIFICAÇÃO/OS/KANBAN/SINCRONIZAÇÃO/ENTREGA-FINANCEIRO 2026-08-16
 * — remove o fixture de smoke em produção real "E2E_GOLIVE_SMOKE_20260816"
 * (Orçamento #000035 / OS #16), usado para validar os 12 cenários do
 * hotfix, incluindo os 2 bugs reais encontrados e corrigidos nesta rodada
 * (Kanban×TodasOS checklist desync e Recebido inflado por desconto PIX).
 *
 * Achados da auditoria read-only (script _audit_orc000035_os16_readonly_2026-08-16.js):
 *   - orcamentos: ORC-000035 (num "000035"), status 'entregue', osRef
 *     'os1786910845541_16'.
 *   - kb_os: os1786910845541_16 (num "16"), status implícito 'entregue'
 *     (entregueEm/entreguePor preenchidos), pronto:true.
 *     Contém também um campo órfão `_etapas:{corte:true}` — resíduo do
 *     próprio teste (reprodução do bug ANTES do fix, quando o clique no
 *     card ainda gravava em _etapas); não é lido por nenhum código (index.html
 *     não tem mais nenhuma referência a `_etapas`) e some junto com a
 *     remoção do documento — não precisa de tratamento à parte.
 *   - kb_os_fin[os1786910845541_16]: valor 116.72, totalGeral 116.72,
 *     valorEntrada 58.36, restante 0 (saldo já quitado).
 *   - fin_cr: 2 lançamentos por orcamentoId ORC-000035 — cr1786910828899
 *     (Entrada, recebido) e cr1786914182796_pgtosaldo (Pagamento do saldo,
 *     recebido).
 *   - fin_tx: 2 lançamentos por os='16' + marca='vr' (entrada R$58,36 PIX +
 *     saldo R$58,36 PIX) — sem id próprio, casados por heurística.
 *   - crm_leads: 2 chaves ligadas a ORC-000035 — orc_101 (orc_emitido) e
 *     orc_102 (fechado).
 *   - clientes: c1786909383999 — criado automaticamente só para este
 *     teste (único orçamento vinculado é ORC-000035).
 *   - retalhos: nenhum vinculado (a OS consumiu 1 chapa nova, não retalho).
 *   - erp_stock_log: 1 saída real de estoque (matKey acr_lico_17 —
 *     "Acrílico Branco — 3mm", qty 1, finalidade inicio_producao,
 *     idempotencyKey producao_inicio:os1786910845541_16).
 *     stock.acr_lico_17.qty atual = 12 (era 13 antes do teste).
 *
 * Este script NÃO apenas apaga os registros — primeiro ESTORNA a saída de
 * estoque com uma entrada compensatória auditável (nunca edita/apaga o log
 * original), depois remove os artefatos do cenário de teste:
 *   - orcamentos: entrada ORC-000035
 *   - kb_os / kb_os_fin: os1786910845541_16
 *   - fin_cr: 2 lançamentos
 *   - fin_tx: 2 lançamentos
 *   - crm_leads: orc_101 + orc_102
 *   - clientes: c1786909383999
 *
 * Modo: snapshot → dry-run (mostra o que seria alterado) → apply (só se
 * chamado com --apply) → auditoria pós-apply.
 *
 * Uso:
 *   node scripts/cleanup_orc000035_os16_2026-08-16.js            # dry-run
 *   node scripts/cleanup_orc000035_os16_2026-08-16.js --apply    # aplica
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();

const APPLY = process.argv.includes('--apply');
const ORC_ID = 'ORC-000035';
const OS_ID = 'os1786910845541_16';
const CRM_LEAD_IDS = ['orc_101', 'orc_102'];
const CLIENTE_ID = 'c1786909383999';
const STOCK_MAT_KEY = 'acr_lico_17';
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
  const snapshotPath = path.join(__dirname, '_snapshot_pre_limpeza_orc000035_2026-08-16.json');
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
  console.log('kb_os: remove', OS_ID, '(status atual:', (objOs[OS_ID] || {}).status, '| entregue:', !!(objOs[OS_ID] || {}).entregueEm, ')');
  const novoObjOs = Object.assign({}, objOs); delete novoObjOs[OS_ID];

  const objOsFin = snapshot.kb_os_fin || {};
  console.log('kb_os_fin: remove', OS_ID, '(restante atual:', (objOsFin[OS_ID] || {}).restante, ')');
  const novoObjOsFin = Object.assign({}, objOsFin); delete novoObjOsFin[OS_ID];

  // ── fin_cr ──
  const arrCr = snapshot.fin_cr || [];
  const crMatches = arrCr.filter(c => c.orcamentoId === ORC_ID || c.osId === OS_ID);
  console.log('fin_cr: remove', crMatches.length, 'lançamento(s) —', crMatches.map(c => c.id).join(', '));
  const novoArrCr = arrCr.filter(c => !(c.orcamentoId === ORC_ID || c.osId === OS_ID));

  // ── fin_tx (sem id próprio — casa por heurística os+marca) ──
  const arrTx = snapshot.fin_tx || [];
  const txMatches = arrTx.filter(t => String(t.os) === '16' && t.marca === 'vr');
  console.log('fin_tx: remove', txMatches.length, 'lançamento(s) (os=16, marca=vr) — valores:', txMatches.map(t => t.valor).join(', '));
  const novoArrTx = arrTx.filter(t => !(String(t.os) === '16' && t.marca === 'vr'));

  // ── crm_leads ──
  const objLeads = snapshot.crm_leads || {};
  CRM_LEAD_IDS.forEach(id => console.log('crm_leads: remove', id, '(existe:', !!objLeads[id] + ')'));
  const novoObjLeads = Object.assign({}, objLeads); CRM_LEAD_IDS.forEach(id => delete novoObjLeads[id]);

  // ── clientes ──
  const arrClientes = snapshot.clientes || [];
  const cliente = arrClientes.find(c => c.id === CLIENTE_ID);
  console.log('clientes: remove', CLIENTE_ID, '(existe:', !!cliente + ', nome:', cliente && cliente.nome, ')');
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
    obs: 'Estorno automático — limpeza do cenário de teste ORC-000035/OS#16 (HOTFIX PLANIFICAÇÃO/OS 2026-08-16)',
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
    ['fin_tx sem lançamentos do teste', !(txDepois.data || []).some(t => String(t.os) === '16' && t.marca === 'vr')],
    ['crm_leads sem orc_101/orc_102', CRM_LEAD_IDS.every(id => !(leadsDepois.data || {})[id])],
    ['cliente removido', !(clientesDepois.data || []).some(c => c.id === CLIENTE_ID)],
    ['stock.' + STOCK_MAT_KEY + '.qty restaurado (' + (qtyAtual + STOCK_QTY_ESTORNAR) + ')', (stockDepois.data || {})[STOCK_MAT_KEY] && (stockDepois.data[STOCK_MAT_KEY].qty === qtyAtual + STOCK_QTY_ESTORNAR)],
    ['erp_stock_log tem original + estorno', (logDepois.data || []).filter(l => l.osId === OS_ID || l.estornoDe === 'producao_inicio:' + OS_ID).length === 2],
  ];
  let allOk = true;
  checks.forEach(([label, ok]) => { console.log((ok ? '✅' : '❌'), label); if (!ok) allOk = false; });
  console.log('\n' + (allOk ? '✅ AUDITORIA: 9/9 PASS — resíduo zero.' : '❌ AUDITORIA: alguma checagem falhou — revisar.'));
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
