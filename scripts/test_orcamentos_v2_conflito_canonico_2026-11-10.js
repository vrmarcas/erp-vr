/**
 * test_orcamentos_v2_conflito_canonico_2026-11-10.js
 *
 * ACHADO REAL (diagnóstico capturado pelo usuário em produção, ORC-000046):
 * o log instrumentado mostrou baseline(aba)/noServidor(real)/tentativaDeGravar
 * com os MESMOS valores de negócio — a única diferença visível era a ORDEM
 * das propriedades (ex.: baseline começando por "dcData, prazoDiasMax,
 * pricingVersion, obs, ..." enquanto o servidor começava por "id, num,
 * cliente, tel, ..."). Confirmado também lendo erp_vr_orcamentos/ORC-000046
 * de produção: a ordem real das chaves armazenadas (id, num, cliente, tel,
 * email, vendedor, produto, ..., versoes, crmLeadId) difere da ordem do
 * literal de construção atual do client (crmLeadId viria logo após obs) —
 * prova direta de que o Firestore NUNCA garantiu preservar a ordem de
 * inserção do client através de leituras/gravações sucessivas.
 *
 * Causa raiz: orcV2SalvarComConflito() comparava baseline/servidor/
 * tentativa por IGUALDADE DE STRING (JSON.stringify), sensível à ordem das
 * chaves de objeto — nunca ao conteúdo. _orcV2CanonJSON() (index.html)
 * agora serializa com as chaves de cada objeto (nunca de arrays — ordem de
 * array é semanticamente relevante) ordenadas recursivamente antes de
 * qualquer comparação/baseline.
 *
 * Testa a função PURA (_orcV2CanonJSON) com a matriz completa pedida, e
 * orcV2SalvarComConflito() de ponta a ponta contra o Firestore Emulator
 * real para os casos que exigem um round-trip de verdade.
 *
 * Uso: node scripts/test_orcamentos_v2_conflito_canonico_2026-11-10.js
 * Pré-requisito: Firestore Emulator rodando em localhost:8080
 * (demo-erp-homolog) para os casos 4-8 (marcados abaixo).
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var src = [
  extractFn('_orcV2CanonJSON'),
  'var _db;', 'var _orcV2LastPayload = {};',
  extractFn('orcV2SalvarComConflito'),
  'module.exports = { canonJSON: _orcV2CanonJSON, orcV2SalvarComConflito: orcV2SalvarComConflito, setDb: function(db){ _db = db; }, setBaseline: function(id, v){ _orcV2LastPayload[id] = v; }, getBaseline: function(id){ return _orcV2LastPayload[id]; } };',
].join('\n\n');

var modPath = path.join(__dirname, '_test_conflito_canonico_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

console.log('\n=== _orcV2CanonJSON / orcV2SalvarComConflito — comparação canônica (achado real ORC-000046) ===\n');

// ── 1. Mesmos objetos, chaves em ordens diferentes → considerados iguais ──
{
  var a = { a: 1, b: 2 };
  var b = { b: 2, a: 1 };
  ok('1. {a:1,b:2} e {b:2,a:1} → mesma string canônica (SEM conflito)', mod.canonJSON(a) === mod.canonJSON(b), mod.canonJSON(a) + ' vs ' + mod.canonJSON(b));
}

// ── 2. Objetos aninhados com ordem diferente → considerados iguais ──
{
  var a = { x: { p: 1, q: 2 }, y: 3 };
  var b = { y: 3, x: { q: 2, p: 1 } };
  ok('2. objetos aninhados com ordem diferente (x.p/x.q trocados) → mesma string canônica', mod.canonJSON(a) === mod.canonJSON(b));
}

// ── 3. itens/pieces semanticamente iguais, propriedades em ordem diferente → iguais ──
{
  var a = { itens: [{ nome: 'Item', qty: 1, esp: 4 }, { nome: 'Item2', qty: 2, esp: 3 }] };
  var b = { itens: [{ esp: 4, qty: 1, nome: 'Item' }, { qty: 2, esp: 3, nome: 'Item2' }] };
  ok('3. itens[] com propriedades em ordem diferente (mesma ordem de array) → mesma string canônica', mod.canonJSON(a) === mod.canonJSON(b));
}

// ── 7. Arrays com ordem REALMENTE diferente (ordem é semanticamente relevante — nunca ordenada) ──
{
  var a = { itens: [{ nome: 'Primeiro' }, { nome: 'Segundo' }] };
  var b = { itens: [{ nome: 'Segundo' }, { nome: 'Primeiro' }] };
  ok('7. itens[] com a ORDEM dos elementos realmente trocada → detectado como diferente (array nunca é reordenado)', mod.canonJSON(a) !== mod.canonJSON(b));
}

// ── 8. Reproduz a forma real do ORC-000046 (campos ausentes + crmLeadId fora de posição) ──
{
  // Ordem como o client constrói HOJE (literal de _orcSalvarOrcamentoImpl).
  var construidoPeloClient = {
    id: 'ORC-000046', num: '000046', cliente: 'Cliente Real', tel: '11999999999',
    email: '', vendedor: 'Vendedor X', produto: 'Produto Y', marca: 'vr',
    valorBase: 500, valorFinal: 500, descCond: 0, dcData: '', descPix: 0,
    parcelas: 1, pgto: 'PIX', status: 'aguardando', dataSalvo: '10/11/2026 10:00',
    obs: '', crmLeadId: 'orc_1', itens: [{ nome: 'Item' }], snapshotCompleto: {},
    ajusteComercialAudit: null, prazo: '', prazoDias: '5', prazoDiasMax: '7',
    prazoTextoPromessa: '', dataPedido: '2026-11-10', pricingVersion: 'abc',
    nfSolicitada: false, statusFiscal: null, nf: null, versoes: []
  };
  // Ordem real observada em produção (snap.data() de ORC-000046) — crmLeadId
  // migrou para o FIM (adicionado numa escrita posterior separada).
  var vindoDoServidor = {
    id: 'ORC-000046', num: '000046', cliente: 'Cliente Real', tel: '11999999999',
    email: '', vendedor: 'Vendedor X', produto: 'Produto Y', marca: 'vr',
    valorBase: 500, valorFinal: 500, descCond: 0, dcData: '', descPix: 0,
    parcelas: 1, pgto: 'PIX', status: 'aguardando', dataSalvo: '10/11/2026 10:00',
    obs: '', itens: [{ nome: 'Item' }], snapshotCompleto: {},
    ajusteComercialAudit: null, prazo: '', prazoDias: '5', prazoDiasMax: '7',
    prazoTextoPromessa: '', dataPedido: '2026-11-10', pricingVersion: 'abc',
    nfSolicitada: false, statusFiscal: null, nf: null, versoes: [], crmLeadId: 'orc_1'
  };
  ok('8. reprodução do ORC-000046 real (crmLeadId fora de posição) → considerados semanticamente iguais', mod.canonJSON(construidoPeloClient) === mod.canonJSON(vindoDoServidor));
}

(async function () {
  // ── 4/5/6 — fim a fim contra o Firestore Emulator real ──
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
  var db = admin.firestore();
  mod.setDb(db);
  var id = 'ORC-CANON-TESTE-' + Date.now();
  var ref = db.collection('erp_vr_orcamentos').doc(id);

  // Caso 6 — meu próprio save, listener reconstrói o objeto numa ordem
  // diferente da que eu enviei — nunca pode ser interpretado como edição externa.
  var v1 = { id: id, num: '000900', cliente: 'Cliente Canon', valorFinal: 100, status: 'aguardando' };
  var r1 = await mod.orcV2SalvarComConflito(id, v1);
  ok('caso 6 (setup) — 1º save sem conflito', r1.ok === true);
  // Simula o "eco do listener": lê de volta o Firestore (ordem real do
  // servidor) e usa ISSO como baseline, em vez do literal client original —
  // exatamente o que _watchOrcamentosV2() faz na vida real.
  var snapEco = await ref.get();
  mod.setBaseline(id, mod.canonJSON(snapEco.data()));
  var r1b = await mod.orcV2SalvarComConflito(id, v1); // mesmo conteúdo, "unchanged"
  ok('caso 6 — próprio save ecoado pelo listener (ordem do Firestore) nunca gera falso conflito', r1b.ok === true && r1b.unchanged === true, JSON.stringify(r1b));

  // Caso 4/5 — valor REAL alterado no servidor (outro usuário) → conflito real continua detectado.
  await ref.set(Object.assign({}, v1, { valorFinal: 999, material: 'Outro material' })); // "outro usuário" escreve direto
  var minhaEdicao = Object.assign({}, v1, { valorFinal: 150 }); // minha própria edição, sem ter visto a de fora
  var r2 = await mod.orcV2SalvarComConflito(id, minhaEdicao);
  ok('caso 4/5 — valor realmente alterado por outra sessão (valorFinal/material) → CONFLITO real detectado', r2.ok === false && r2.reason === 'conflito', JSON.stringify(r2));

  await ref.delete();

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch(function (e) { console.error('ERRO FATAL:', e); process.exit(1); });
