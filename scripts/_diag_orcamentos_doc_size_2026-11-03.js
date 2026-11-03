'use strict';
// Diagnóstico READ-ONLY — mede o tamanho real do documento erp_vr/orcamentos
// em produção, para confirmar/descartar a hipótese de estouro do limite de
// 1MiB por documento do Firestore como causa raiz do erro de save do
// orçamento #000266.
const { getProdApp } = require('./_prod_admin_credential');

async function main() {
  const db = getProdApp().firestore();
  const snap = await db.collection('erp_vr').doc('orcamentos').get();
  if (!snap.exists) { console.log('Documento erp_vr/orcamentos não existe.'); return; }
  const raw = snap.data();
  const dataStr = raw.data;
  const bytes = Buffer.byteLength(dataStr, 'utf8');
  console.log('Tamanho do campo "data" (string JSON):', bytes, 'bytes =', (bytes/1024/1024).toFixed(3), 'MiB');
  console.log('Limite Firestore por documento: 1048576 bytes (1 MiB)');
  console.log('Margem restante:', 1048576 - bytes, 'bytes');

  let arr;
  try { arr = JSON.parse(dataStr); } catch (e) { console.log('Falha ao parsear JSON:', e.message); return; }
  console.log('Quantidade de orçamentos no array:', arr.length);

  // Acha o orçamento #000266 especificamente
  const target = arr.find(function(o){ return String(o && (o.num || o.n)) === '266' || String(o && (o.num || o.n)) === '000266'; });
  if (target) {
    const tStr = JSON.stringify(target);
    console.log('Orçamento #000266 encontrado — tamanho individual:', Buffer.byteLength(tStr,'utf8'), 'bytes');
  } else {
    console.log('Orçamento #000266 NÃO encontrado no array salvo (save real nunca confirmou).');
  }

  // Top 5 maiores orçamentos (para contexto)
  const comTamanho = arr.map(function(o){ return { num: o.num||o.n, bytes: Buffer.byteLength(JSON.stringify(o),'utf8') }; });
  comTamanho.sort(function(a,b){ return b.bytes - a.bytes; });
  console.log('Top 5 maiores orçamentos no array:');
  comTamanho.slice(0,5).forEach(function(o){ console.log('  #'+o.num+':', o.bytes, 'bytes'); });
}

main().then(function(){ process.exit(0); }).catch(function(e){ console.error('ERRO:', e); process.exit(1); });
