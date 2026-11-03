/**
 * test_migracao_orcamentos_v2_functions_helper_2026-11-03.js
 *
 * Achado real (investigação do bug do #000268): além do client
 * (index.html), VÁRIAS Cloud Functions server-side (functions/src/finCr.ts:
 * finCrConfirmarPagamento, finCrReceberSaldo, finCrRegistrarRecebimento,
 * finCrAutoAprovarOrcamento; functions/src/producao.ts:
 * producaoIniciarOuEditar) liam/escreviam erp_vr/orcamentos (array legado)
 * via Admin SDK, sem NENHUM conhecimento de erp_vr_orcamentos/{id} — para
 * qualquer orçamento que só existe em v2 (todo orçamento salvo depois da
 * migração client-side, como o próprio #000268), essas funções lançavam
 * "não encontrado" ou silenciosamente nunca atualizavam o status.
 *
 * Este teste prova a lógica PURA e REAL (compilada, nunca reimplementada)
 * de functions/src/orcamentos_v2_helper.ts — lerOrcamentoV2ComFallback(),
 * gravarOrcamentoV2(), espelharOrcamentoNoLegado() — contra um Firestore
 * FALSO em memória. Não precisa de emulador: as 3 funções recebem `db`/
 * `txn` como parâmetro (nunca chamam admin.firestore() internamente),
 * então são testáveis isoladamente sem nenhuma inicialização real do
 * Firebase Admin SDK.
 *
 * Pré-requisito: functions/lib/orcamentos_v2_helper.js existir (gerado por
 * `npm run build` em functions/ — já rodado nesta rodada, build limpo).
 *
 * Uso: node scripts/test_migracao_orcamentos_v2_functions_helper_2026-11-03.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

const libPath = path.join(__dirname, '..', 'functions', 'lib', 'orcamentos_v2_helper.js');
if (!fs.existsSync(libPath)) {
  console.error('functions/lib/orcamentos_v2_helper.js não existe — rode "npm run build" em functions/ primeiro.');
  process.exit(1);
}
delete require.cache[require.resolve(libPath)];
const { lerOrcamentoV2ComFallback, gravarOrcamentoV2, espelharOrcamentoNoLegado } = require(libPath);

console.log('\n=== Cloud Functions — erp_vr_orcamentos/{id} como fonte de verdade (achado real dos #000266/#000268) ===\n');

// ── Fake Firestore: coleções mínimas, bastante para exercitar os 3 helpers ──
function makeFakeDb() {
  const store = { erp_vr: {}, erp_vr_orcamentos: {} };
  const db = {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          const exists = Object.prototype.hasOwnProperty.call(store[name] || {}, id);
          return { exists, data: () => (store[name] || {})[id] };
        },
      }),
    }),
    runTransaction: async (fn) => {
      const txn = {
        get: async (ref) => ref.get(),
        set: (ref, val) => { /* aplicado via proxy abaixo */ ref.__set(val); },
      };
      return fn(txn);
    },
    _store: store,
  };
  // Proxy .doc() para expor __set, que grava direto no store fake.
  const origCollection = db.collection;
  db.collection = (name) => {
    if (!store[name]) store[name] = {};
    return {
      doc: (id) => ({
        get: async () => {
          const exists = Object.prototype.hasOwnProperty.call(store[name], id);
          return { exists, data: () => store[name][id] };
        },
        __set: (val) => { store[name][id] = val; },
      }),
    };
  };
  void origCollection;
  return db;
}

async function runTxn(db, fn) {
  return db.runTransaction(async (txnRaw) => {
    const txn = {
      get: async (ref) => ref.get(),
      set: (ref, val) => ref.__set(val),
    };
    return fn(txn);
  });
}

(async function () {
  // ── 1. v2 existe: lerOrcamentoV2ComFallback() usa v2, nunca olha o legado ──
  {
    const db = makeFakeDb();
    db._store.erp_vr_orcamentos['ORC-000268'] = { id: 'ORC-000268', num: '000268', status: 'aguardando', cliente: 'Isabella Borges' };
    const orc = await runTxn(db, (txn) => lerOrcamentoV2ComFallback(db, txn, 'ORC-000268'));
    ok('1. orçamento #000268 (só em v2, nunca no array legado) é encontrado de verdade', !!orc && orc.cliente === 'Isabella Borges');
  }

  // ── 2. v2 não existe, mas está no array legado: fallback funciona ──────────
  {
    const db = makeFakeDb();
    db._store.erp_vr.orcamentos = { data: JSON.stringify([{ id: 'ORC-000100', num: '000100', status: 'aprovado' }]) };
    const orc = await runTxn(db, (txn) => lerOrcamentoV2ComFallback(db, txn, 'ORC-000100'));
    ok('2. orçamento só no array legado (nunca migrado): fallback encontra mesmo assim — "rollback de leitura"', !!orc && orc.status === 'aprovado');
  }

  // ── 3. Não existe em nenhum dos dois: null, nunca lança exceção ────────────
  {
    const db = makeFakeDb();
    const orc = await runTxn(db, (txn) => lerOrcamentoV2ComFallback(db, txn, 'ORC-INEXISTENTE'));
    ok('3. orçamento inexistente em ambos: devolve null (quem chama decide o not-found), nunca lança', orc === null);
  }

  // ── 4. gravarOrcamentoV2() grava em erp_vr_orcamentos/{id}, nunca no legado ──
  {
    const db = makeFakeDb();
    await runTxn(db, (txn) => { gravarOrcamentoV2(db, txn, { id: 'ORC-000268', status: 'pago' }); });
    ok('4. grava o documento v2 com o id correto', db._store.erp_vr_orcamentos['ORC-000268'] && db._store.erp_vr_orcamentos['ORC-000268'].status === 'pago');
    ok('4b. NUNCA toca o array legado (continua vazio)', !db._store.erp_vr.orcamentos);
  }

  // ── 5. gravarOrcamentoV2() sanitiza `undefined` (Firestore nativo rejeitaria) ──
  {
    const db = makeFakeDb();
    await runTxn(db, (txn) => { gravarOrcamentoV2(db, txn, { id: 'ORC-1', status: 'pago', valorPendenteComparativo: undefined, crmLeadId: undefined }); });
    const gravado = db._store.erp_vr_orcamentos['ORC-1'];
    ok('5. campos `undefined` (valorPendenteComparativo/crmLeadId) são removidos antes de gravar', !('valorPendenteComparativo' in gravado) && !('crmLeadId' in gravado));
  }

  // ── 6. espelharOrcamentoNoLegado(): best-effort, nunca lança mesmo se o array "estourar" ──
  {
    const db = makeFakeDb();
    db._store.erp_vr.orcamentos = { data: JSON.stringify([{ id: 'ORC-A', num: '1' }]) };
    // Simula o array legado "grande demais" — runTransaction sempre falha.
    db.runTransaction = async () => { const e = new Error('Firestore: documento excede 1048576 bytes'); e.code = 'invalid-argument'; throw e; };
    let lancou = false;
    try { await espelharOrcamentoNoLegado(db, { id: 'ORC-B', num: '2' }); } catch (e) { lancou = true; }
    ok('6. espelho legado NUNCA lança, mesmo quando o array está grande demais para gravar (best-effort real)', lancou === false);
  }

  // ── 7. espelharOrcamentoNoLegado(): quando funciona, atualiza/insere corretamente ──
  {
    const db = makeFakeDb();
    db._store.erp_vr.orcamentos = { data: JSON.stringify([{ id: 'ORC-A', num: '1', status: 'aguardando' }]) };
    await espelharOrcamentoNoLegado(db, { id: 'ORC-A', num: '1', status: 'pago' });
    const arrDepois = JSON.parse(db._store.erp_vr.orcamentos.data);
    ok('7a. atualiza um registro já existente no array legado (nunca duplica)', arrDepois.length === 1 && arrDepois[0].status === 'pago');
    await espelharOrcamentoNoLegado(db, { id: 'ORC-NOVO', num: '2', status: 'aguardando' });
    const arrDepois2 = JSON.parse(db._store.erp_vr.orcamentos.data);
    ok('7b. insere um registro novo (nunca estava no legado) quando o espelho de fato funciona', arrDepois2.length === 2 && arrDepois2.some((o) => o.id === 'ORC-NOVO'));
  }

  console.log('\n' + passed + ' passou(aram), ' + failed + ' falhou(aram)\n');
  process.exit(failed > 0 ? 1 : 0);
})();
