/**
 * cleanup_preexistente_teste_2026-08-11.js
 *
 * Item 3 da correção pós-smoke GO-LIVE: remover os dados de homologação
 * pré-existentes que eu tinha deliberadamente preservado no smoke anterior
 * (cartão "TESTE", CP recorrente "Salário Teste", compra "Teste de
 * Compra") — auditados e confirmados sem QUALQUER vínculo real:
 *   - nenhuma fatura paga (3 faturas do cartão TESTE, todas 'aberta')
 *   - nenhuma CP paga (6 CPs, todas 'agendado', nenhuma dataPagamento)
 *   - FIN_CR e FIN_TX (livro-caixa) não têm NENHUM registro — confirma
 *     que nenhum desses itens jamais gerou um evento financeiro real
 *
 * Modo: snapshot → dry-run (mostra o que seria removido) → apply (só se
 * chamado com --apply) → auditoria pós-apply.
 *
 * Uso:
 *   node scripts/cleanup_preexistente_teste_2026-08-11.js            # dry-run
 *   node scripts/cleanup_preexistente_teste_2026-08-11.js --apply    # aplica
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();

const APPLY = process.argv.includes('--apply');
const CARTAO_ID = 'fcartao_mso3w0wnwqjw';
const RECORRENCIA_ID = 'fcprec_mso3gqrz6pkb';

async function getData(key) {
  const doc = await db.collection('erp_vr').doc(key).get();
  if (!doc.exists) return null;
  return JSON.parse(doc.data().data);
}
async function setData(key, data) {
  await db.collection('erp_vr').doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

(async () => {
  console.log('\n=== LIMPEZA — dados de homologação pré-existentes (cartão TESTE + Salário Teste) ===\n');
  console.log('Modo:', APPLY ? 'APPLY (grava no Firestore)' : 'DRY-RUN (só mostra, não grava)');

  const snapshot = {};
  const keys = ['fin_cartoes', 'fin_cartao_compras', 'fin_faturas', 'fin_cp', 'fin_cp_recorrencias', 'fin_cr', 'fin_tx'];
  for (const k of keys) snapshot[k] = await getData(k);

  const snapshotPath = path.join(__dirname, '_snapshot_pre_limpeza_teste_2026-08-11.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log('Snapshot salvo em:', snapshotPath);

  // Safety gate: assert nenhum vínculo real antes de decidir remover
  const faturasCartao = snapshot.fin_faturas.filter(f => f.cartaoId === CARTAO_ID);
  const cpCartao = snapshot.fin_cp.filter(c => c.origemCartaoId === CARTAO_ID);
  const cpRecorrencia = snapshot.fin_cp.filter(c => c.recorrenciaId === RECORRENCIA_ID);
  const faturasPagas = faturasCartao.filter(f => f.pago || f.status === 'paga');
  const cpPagas = [...cpCartao, ...cpRecorrencia].filter(c => c.status === 'pago' || c.dataPagamento);

  console.log('\nVerificação de segurança:');
  console.log('  Faturas do cartão TESTE:', faturasCartao.length, '— pagas:', faturasPagas.length);
  console.log('  CP do cartão TESTE:', cpCartao.length, '— pagas:', cpCartao.filter(c => c.status === 'pago').length);
  console.log('  CP da recorrência Salário Teste:', cpRecorrencia.length, '— pagas:', cpRecorrencia.filter(c => c.status === 'pago').length);
  console.log('  FIN_CR (livro de recebimentos) total:', snapshot.fin_cr.length);
  console.log('  FIN_TX (livro-caixa) total:', snapshot.fin_tx.length);

  if (faturasPagas.length > 0 || cpPagas.length > 0) {
    console.log('\n❌ ABORTADO — encontrado vínculo financeiro real (fatura ou CP paga). Não é seguro remover automaticamente.');
    process.exit(1);
  }
  console.log('\n✅ Confirmado: nenhum vínculo financeiro real (nenhuma fatura/CP paga).');

  const novoFinCartoes = snapshot.fin_cartoes.filter(c => c.id !== CARTAO_ID);
  const novoFinCartaoCompras = snapshot.fin_cartao_compras.filter(c => c.cartaoId !== CARTAO_ID);
  const novoFinFaturas = snapshot.fin_faturas.filter(f => f.cartaoId !== CARTAO_ID);
  const novoFinCp = snapshot.fin_cp.filter(c => c.origemCartaoId !== CARTAO_ID && c.recorrenciaId !== RECORRENCIA_ID);
  const novoFinCpRecorrencias = snapshot.fin_cp_recorrencias.filter(r => r.id !== RECORRENCIA_ID);

  console.log('\n--- DRY-RUN: o que seria removido ---');
  console.log('  fin_cartoes:', snapshot.fin_cartoes.length, '→', novoFinCartoes.length, '(remove cartão "TESTE")');
  console.log('  fin_cartao_compras:', snapshot.fin_cartao_compras.length, '→', novoFinCartaoCompras.length, '(remove "Teste de Compra")');
  console.log('  fin_faturas:', snapshot.fin_faturas.length, '→', novoFinFaturas.length, '(remove 3 faturas do cartão TESTE)');
  console.log('  fin_cp:', snapshot.fin_cp.length, '→', novoFinCp.length, '(remove 3 CP do cartão TESTE + 3 CP da recorrência Salário Teste)');
  console.log('  fin_cp_recorrencias:', snapshot.fin_cp_recorrencias.length, '→', novoFinCpRecorrencias.length, '(remove recorrência "Salário Teste")');

  if (!APPLY) {
    console.log('\nDry-run concluído — nada foi gravado. Rode novamente com --apply para aplicar.\n');
    return;
  }

  await setData('fin_cartoes', novoFinCartoes);
  await setData('fin_cartao_compras', novoFinCartaoCompras);
  await setData('fin_faturas', novoFinFaturas);
  await setData('fin_cp', novoFinCp);
  await setData('fin_cp_recorrencias', novoFinCpRecorrencias);
  console.log('\n✅ Aplicado.');

  // Auditoria pós-apply
  console.log('\n--- AUDITORIA PÓS-APPLY ---');
  const cartoesDepois = await getData('fin_cartoes');
  const comprasDepois = await getData('fin_cartao_compras');
  const faturasDepois = await getData('fin_faturas');
  const cpDepois = await getData('fin_cp');
  const recDepois = await getData('fin_cp_recorrencias');
  console.log('  fin_cartoes:', JSON.stringify(cartoesDepois.map(c => c.nome)));
  console.log('  fin_cartao_compras total:', comprasDepois.length);
  console.log('  fin_faturas total:', faturasDepois.length);
  console.log('  fin_cp total:', cpDepois.length, '—', JSON.stringify(cpDepois.map(c => c.descricao)));
  console.log('  fin_cp_recorrencias total:', recDepois.length);
  const residuoCartao = comprasDepois.some(c => c.cartaoId === CARTAO_ID) || faturasDepois.some(f => f.cartaoId === CARTAO_ID) || cpDepois.some(c => c.origemCartaoId === CARTAO_ID);
  const residuoRecorrencia = cpDepois.some(c => c.recorrenciaId === RECORRENCIA_ID) || recDepois.some(r => r.id === RECORRENCIA_ID);
  console.log('\n  Resíduo do cartão TESTE:', residuoCartao ? 'ENCONTRADO — FALHA' : 'ZERO — OK');
  console.log('  Resíduo da recorrência Salário Teste:', residuoRecorrencia ? 'ENCONTRADO — FALHA' : 'ZERO — OK');
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
