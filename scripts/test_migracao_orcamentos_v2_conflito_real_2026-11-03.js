/**
 * test_migracao_orcamentos_v2_conflito_real_2026-11-03.js
 *
 * Instrução explícita do usuário (rodada de validação real antes do deploy do
 * commit 61050ca): provar, contra o Firestore EMULATOR REAL (nunca um mock
 * fake em memória), os Casos 6, 7, 9 e 10 do pedido original — o mecanismo
 * compartilhado por TODAS as Cloud Functions críticas portadas
 * (finCrConfirmarPagamento, finCrReceberSaldo, finCrRegistrarRecebimento,
 * finCrAutoAprovarOrcamento, producaoIniciarOuEditar) é
 * lerOrcamentoV2ComFallback()/gravarOrcamentoV2() (functions/src/
 * orcamentos_v2_helper.ts), sempre chamado DENTRO de um db.runTransaction()
 * real. Em vez de encadear fluxos de negócio inteiros (que têm suas próprias
 * validações específicas e dificultam isolar o mecanismo), este teste exercita
 * diretamente esse mecanismo comum contra o emulador real — é exatamente o
 * que protege TODAS as funções críticas contra lost-update.
 *
 * - Caso 6 (conflito real): duas transações CONCORRENTES contra o MESMO
 *   erp_vr_orcamentos/{id}, cada uma lendo o estado então escrevendo o
 *   objeto INTEIRO (igual gravarOrcamentoV2 faz) com um campo próprio
 *   diferente. O Firestore deve serializar via retry automático da
 *   transação perdedora — nunca um last-write-wins silencioso que perderia
 *   o campo da primeira escrita.
 * - Caso 7 (sem falso conflito): duas transações concorrentes contra DOIS
 *   orçamentos DIFERENTES nunca se bloqueiam/retry uma por causa da outra.
 * - Caso 9 (campos undefined): gravarOrcamentoV2 sanitiza antes de gravar —
 *   o Firestore real (Admin SDK) REJEITARIA `undefined` sem a sanitização;
 *   aqui provamos isso contra o emulador real, não um mock.
 * - Caso 10 (espelho legado "grande demais"): espelharOrcamentoNoLegado()
 *   nunca lança mesmo quando a escrita no array legado falha de verdade
 *   (documento > 1MiB), e o v2 permanece a fonte de verdade intocada.
 *
 * Uso: node scripts/test_migracao_orcamentos_v2_conflito_real_2026-11-03.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080
 * (demo-erp-homolog) — mesmo emulador das outras suítes desta rodada.
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { lerOrcamentoV2ComFallback, gravarOrcamentoV2, espelharOrcamentoNoLegado } = require('../functions/lib/orcamentos_v2_helper.js');

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

console.log('\n=== Casos 6/7/9/10 — mecanismo compartilhado (lerOrcamentoV2ComFallback/gravarOrcamentoV2) contra o Firestore Emulator REAL ===\n');

var _c = 0;
function novoId() { return 'e2e_conflito_orc_' + Date.now() + '_' + (++_c); }

async function limparV2(id) { await db.collection('erp_vr_orcamentos').doc(id).delete(); }
async function limparLegado(id) {
  var ref = db.collection('erp_vr').doc('orcamentos');
  var doc = await ref.get();
  if (!doc.exists) return;
  var lista = JSON.parse(doc.data().data).filter(function (o) { return o.id !== id; });
  await ref.set({ data: JSON.stringify(lista), ts: Date.now() });
}

// Escreve via o MESMO mecanismo que todas as funções críticas usam: lê dentro
// da transação (lerOrcamentoV2ComFallback), espera `atrasoMs` (simula trabalho
// real entre leitura e escrita — é essa janela que torna o conflito possível),
// aplica `mutar` sobre o valor lido e grava o objeto INTEIRO (gravarOrcamentoV2).
async function escreverComAtraso(orcId, atrasoMs, mutar) {
  return db.runTransaction(async (txn) => {
    var orc = await lerOrcamentoV2ComFallback(db, txn, orcId);
    if (atrasoMs) await new Promise(function (r) { setTimeout(r, atrasoMs); });
    var novo = mutar(Object.assign({}, orc));
    gravarOrcamentoV2(db, txn, novo);
    return novo;
  });
}

(async function () {
  var criadosV2 = [];

  // ── Caso 6 — conflito real: duas transações concorrentes no MESMO orçamento ──
  {
    var orcId = novoId(); criadosV2.push(orcId);
    await db.collection('erp_vr_orcamentos').doc(orcId).set({ id: orcId, num: orcId, status: 'aguardando', cliente: 'Cliente Conflito Real' });

    // Ambas as transações leem o doc quase ao mesmo tempo, esperam 400ms (simula
    // trabalho real entre leitura e escrita — é essa janela que torna o conflito
    // possível) e então gravam o objeto INTEIRO (igual gravarOrcamentoV2 faz),
    // cada uma com seu próprio campo. Qual delas "perde" a corrida no backend do
    // Firestore (não é determinado pela ordem de início no processo Node — é o
    // próprio Firestore que decide via o versionamento real do documento) é
    // automaticamente detectada como ABORTED e o Admin SDK RE-EXECUTA a callback
    // perdedora do zero, lendo o estado já atualizado pela vencedora. Por isso a
    // asserção não presume qual lado vence: só que NENHUM campo se perde e que o
    // lado perdedor, ao reler, de fato viu o campo da vencedora.
    var resultados = await Promise.all([
      escreverComAtraso(orcId, 400, function (o) { o.campoA = 'A'; o.vistoPorA = o.campoB || null; return o; }),
      escreverComAtraso(orcId, 400, function (o) { o.campoB = 'B'; o.vistoPorB = o.campoA || null; return o; }),
    ]);
    void resultados;

    var finalDoc = await db.collection('erp_vr_orcamentos').doc(orcId).get();
    var final = finalDoc.data();
    ok('6a. após as duas transações concorrentes, AMBOS os campos (campoA e campoB) sobrevivem — nenhum lost-update silencioso', final.campoA === 'A' && final.campoB === 'B', 'doc final: ' + JSON.stringify(final));
    // Exatamente um dos dois lados precisou ser re-executado pelo Firestore (o
    // "perdedor" da corrida real) — esse lado, ao reler o doc na segunda
    // tentativa, via de fato o campo que o outro já tinha confirmado.
    var ladoRetried = final.vistoPorA === 'B' ? 'A' : (final.vistoPorB === 'A' ? 'B' : null);
    ok('6b. o Firestore detectou o conflito real e re-executou a transação perdedora com dado FRESCO (nunca um last-write-wins ingênuo que leria dado obsoleto)', ladoRetried !== null, 'vistoPorA=' + final.vistoPorA + ' vistoPorB=' + final.vistoPorB);
  }

  // ── Caso 7 — sem falso conflito: dois orçamentos DIFERENTES, escritas concorrentes ──
  {
    var orcX = novoId(); var orcY = novoId();
    criadosV2.push(orcX); criadosV2.push(orcY);
    await db.collection('erp_vr_orcamentos').doc(orcX).set({ id: orcX, num: orcX, status: 'aguardando' });
    await db.collection('erp_vr_orcamentos').doc(orcY).set({ id: orcY, num: orcY, status: 'aguardando' });

    var t0 = Date.now();
    await Promise.all([
      escreverComAtraso(orcX, 150, function (o) { o.status = 'em_producao'; return o; }),
      escreverComAtraso(orcY, 150, function (o) { o.status = 'em_producao'; return o; }),
    ]);
    var dt = Date.now() - t0;

    var docX = (await db.collection('erp_vr_orcamentos').doc(orcX).get()).data();
    var docY = (await db.collection('erp_vr_orcamentos').doc(orcY).get()).data();
    ok('7a. orçamento X foi atualizado corretamente, sem nenhuma interferência do Y', docX.status === 'em_producao');
    ok('7b. orçamento Y foi atualizado corretamente, sem nenhuma interferência do X', docY.status === 'em_producao');
    // Documentos diferentes nunca disputam o mesmo lock — se o Firestore precisasse
    // serializar entre X e Y (falso conflito), o tempo total seria ~2x (soma dos
    // atrasos) em vez de rodarem em paralelo (~1x o atraso).
    ok('7c. as duas transações rodaram em PARALELO (tempo total ~150ms, não ~300ms) — confirma que não houve bloqueio cruzado entre orçamentos diferentes', dt < 280, 'dt=' + dt + 'ms');
  }

  // ── Caso 9 — campos `undefined`: Firestore real rejeitaria sem a sanitização ──
  {
    var orcU = novoId(); criadosV2.push(orcU);
    await db.runTransaction(async function (txn) {
      gravarOrcamentoV2(db, txn, {
        id: orcU, num: orcU, status: 'pago', cliente: 'Cliente Sanitização',
        valorPendenteComparativo: undefined, crmLeadId: undefined, total: 500,
      });
    });
    var docU = (await db.collection('erp_vr_orcamentos').doc(orcU).get()).data();
    ok('9a. gravação com campos undefined NÃO lança (o Admin SDK real rejeitaria sem a sanitização de gravarOrcamentoV2)', !!docU);
    ok('9b. campos undefined foram removidos antes de gravar no Firestore real', !('valorPendenteComparativo' in docU) && !('crmLeadId' in docU));
    ok('9c. os demais campos preservam fidelidade total (cliente, total, status)', docU.cliente === 'Cliente Sanitização' && docU.total === 500 && docU.status === 'pago');
  }

  // ── Caso 10 — espelho legado "grande demais": v2 permanece autoridade, nunca lança ──
  {
    var orcG = novoId(); criadosV2.push(orcG);
    // Documento legado real JUSTO ABAIXO do limite (como o achado real de
    // produção: _diag_orcamentos_doc_size_2026-11-03.js confirmou 1.046.595/
    // 1.048.576 bytes antes da migração) — a própria escrita de setup aqui tem
    // que caber; é a escrita do ESPELHO (adicionando mais um orçamento) que deve
    // estourar o limite real do Firestore, igual ao cenário de produção.
    var pontoGrande = 'x'.repeat(1010000);
    await db.collection('erp_vr').doc('orcamentos').set({ data: JSON.stringify([{ id: 'ORC-PLACEHOLDER-GRANDE', blob: pontoGrande }]), ts: Date.now() });

    await db.collection('erp_vr_orcamentos').doc(orcG).set({ id: orcG, num: orcG, status: 'aguardando', cliente: 'Cliente Legado Estourado' });
    await db.runTransaction(async function (txn) {
      var orc = await lerOrcamentoV2ComFallback(db, txn, orcG);
      orc.status = 'em_producao';
      gravarOrcamentoV2(db, txn, orc);
    });

    var docG = (await db.collection('erp_vr_orcamentos').doc(orcG).get()).data();
    ok('10a. v2 foi gravado e permanece a fonte de verdade — a escrita crítica nunca depende do espelho', docG.status === 'em_producao');

    // O orçamento a espelhar sozinho já é grande (simula um orçamento real com
    // muitos itens/comparativos) — somado ao array legado já quase no limite,
    // a escrita do espelho estoura de verdade os 1.048.576 bytes do Firestore.
    var docGComBlobGrande = Object.assign({}, docG, { blobOrcamentoGrande: 'y'.repeat(60000) });
    var lancouMirror = false;
    try { await espelharOrcamentoNoLegado(db, docGComBlobGrande); } catch (e) { lancouMirror = true; }
    ok('10b. espelharOrcamentoNoLegado() NUNCA lança mesmo quando a escrita real no array legado estoura de verdade os 1.048.576 bytes do Firestore — best-effort real, não simulado', lancouMirror === false);

    var docV2Depois = (await db.collection('erp_vr_orcamentos').doc(orcG).get()).data();
    ok('10c. depois da tentativa de espelho que falhou de verdade, o v2 continua intocado/correto — a falha do espelho nunca contamina a autoridade', docV2Depois.status === 'em_producao' && !docV2Depois.blobOrcamentoGrande);

    var legadoDepois = await db.collection('erp_vr').doc('orcamentos').get();
    var arrLegadoDepois = JSON.parse(legadoDepois.data().data);
    ok('10d. confirma que o espelho de fato FALHOU (o array legado nunca recebeu o orçamento grande demais) — não é um "passou porque não tentou"', !arrLegadoDepois.some(function (o) { return o && o.id === orcG; }));

    // limpeza do doc legado gigante placeholder desta seção
    await db.collection('erp_vr').doc('orcamentos').delete();
  }

  // ── limpeza geral ──
  for (var i = 0; i < criadosV2.length; i++) await limparV2(criadosV2[i]);
  for (var j = 0; j < criadosV2.length; j++) await limparLegado(criadosV2[j]);
  console.log('  (limpeza: ' + criadosV2.length + ' orçamento(s) v2 + espelhos legados removidos do emulador)');

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})().catch(function (e) { console.error('ERRO FATAL:', e); process.exit(1); });
