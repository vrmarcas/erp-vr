/**
 * test_retalho_caminho_positivo_2026-08-11.js
 *
 * Item 2 da correção pós-smoke GO-LIVE: o smoke anterior só provou "nenhum
 * retalho compatível" (caminho negativo). Falta homologar o caminho
 * POSITIVO completo — pedido explícito do usuário:
 *   - criar material compatível
 *   - criar pelo menos 2 retalhos (via a Cloud Function real de criação)
 *   - criar planificação que caiba nos dois
 *   - validar material/espessura/cor
 *   - validar margem de segurança
 *   - provar qual retalho é recomendado (melhor-fit)
 *   - aceitar sugestão (consumir via a Cloud Function real)
 *   - reservar/consumir
 *   - provar que uma segunda OS NÃO consegue consumir o mesmo retalho
 *   - testar recusa da sugestão e escolha manual
 *   - cleanup completo
 *
 * Roda 100% contra o Firestore Emulator (demo-erp-homolog) chamando as
 * Cloud Functions REAIS compiladas (functions/lib/estoque.js,
 * functions/lib/producao.js) via .run(data, context) — mesmo mecanismo já
 * usado por test_producao_autorizacao_server.js. Nunca reimplementa a
 * lógica de negócio aqui; só monta o cenário e verifica o resultado real.
 * O algoritmo de sugestão/melhor-fit (kbSugerirMaterial,
 * kbRetalhoCabeGeometricamente) é 100% client-side (index.html) — extraído
 * e testado com a função REAL, não reimplementada.
 *
 * Não toca produção: roda inteiramente no projeto demo-*, isolado por
 * `assertProjetoSeguro()` do harness (recusa qualquer projectId que não
 * comece com "demo-"). Dados somem quando o emulador para (sem
 * --import/--export); mesmo assim, o próprio teste remove tudo que criou
 * ao final, para rodar limpo em execuções repetidas.
 *
 * Pré-requisito: Firestore Emulator rodando em localhost:8080
 * (demo-erp-homolog).
 *
 * Uso: node scripts/test_retalho_caminho_positivo_2026-08-11.js
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const fs = require('fs');
const path = require('path');
const functionsNodeModules = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(functionsNodeModules, 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const db = admin.firestore();
const { producaoIniciarOuEditar } = require('../functions/lib/producao.js');
const { estoqueCriarRetalho } = require('../functions/lib/estoque.js');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado valor truthy'); }
async function assertThrows(fn, codeOuTrecho, msg) {
  try { await fn(); throw new Error('__NENHUM_ERRO__'); }
  catch (e) {
    if (e.message === '__NENHUM_ERRO__') throw new Error((msg || 'esperava erro') + ' — nenhum erro lançado');
    var code = e.code || (e.httpErrorCode && e.httpErrorCode.canonicalName) || '';
    var texto = (e.message || '') + ' ' + code;
    if (texto.indexOf(codeOuTrecho) < 0) throw new Error((msg || 'erro inesperado') + ' — esperava conter "' + codeOuTrecho + '", obtido: ' + texto);
  }
}
function ctx(uid, role) { return { auth: { uid: uid, token: { role: role } } }; }
const RUN_ID = 'r' + Date.now(); // sufixo único por execução — evita colisão com a chave de idempotência (producao_idem_keys) de execuções anteriores

const UID_MASTER = 'rethmg20260811master';
const UID_PROD1 = 'rethmg20260811prod1';
const UID_PROD2 = 'rethmg20260811prod2';
const MAT_KEY = 'RETHMG_AC3'; // material fictício de teste — nunca reusa chave real de produção
const OS1_ID = 'RETHMG_OS_1';
const OS2_ID = 'RETHMG_OS_2';
const OS3_ID = 'RETHMG_OS_3';
const OS4_ID = 'RETHMG_OS_4';

async function getDoc(key) {
  const snap = await db.collection('erp_vr').doc(key).get();
  if (!snap.exists) return null;
  const raw = snap.data().data;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
async function setDoc(key, data) {
  await db.collection('erp_vr').doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

// ── extração da lógica REAL de sugestão/melhor-fit do index.html (pura,
// client-side) — nunca reimplementada, só isolada para rodar em Node ──
function extractFn(name) {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function buildSugestaoModule(stockGlobal, retalhosGlobal) {
  var src = [
    'var STOCK = ' + JSON.stringify(stockGlobal) + ';',
    'var RETALHOS = ' + JSON.stringify(retalhosGlobal) + ';',
    "function cfgLoad(){ return { producao: { margemSegurancaRetalhoCm: 5 } }; }",
    extractFn('kbMargemSegurancaRetalhoCm'),
    extractFn('kbNecessidadeDimsOS'),
    extractFn('kbRetalhoCabeGeometricamente'),
    extractFn('kbParseDimsWH'),
    extractFn('kbParseDimsArea'),
    extractFn('kbCalcAreaOS'),
    extractFn('kbSugerirMaterial'),
    'module.exports = { sugerir: kbSugerirMaterial, cabeGeometricamente: kbRetalhoCabeGeometricamente, margemCm: kbMargemSegurancaRetalhoCm() };',
  ].join('\n\n');
  var modPath = path.join(__dirname, '_retalho_sugestao_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);
  try { fs.unlinkSync(modPath); } catch (e) {}
  return mod;
}

(async () => {
  console.log('\n=== Retalho — homologação do caminho POSITIVO (Emulator, Cloud Functions reais) ===\n');

  // ── Setup: usuários (master + 2 produção), material compatível ──
  await db.collection('erp_vr_usuarios').doc(UID_MASTER).set({ nome: 'RETHMG Master', funcao: 'master', ativo: 1 });
  await db.collection('erp_vr_usuarios').doc(UID_PROD1).set({ nome: 'RETHMG Produção 1', funcao: 'producao', ativo: 1 });
  await db.collection('erp_vr_usuarios').doc(UID_PROD2).set({ nome: 'RETHMG Produção 2', funcao: 'producao', ativo: 1 });

  var stock = (await getDoc('stock')) || {};
  stock[MAT_KEY] = { label: 'Acrílico Cristal (teste homologação)', cor: 'Cristal', esp: 3, qty: 10, min: 1, max: 50, chapLarg: 200, chapComp: 300 };
  await setDoc('stock', stock);

  var kb = (await getDoc('kb_os')) || {};
  // OS #1: peça 45×35cm — cabe em QUALQUER retalho ≥ 50×40 (com margem 5cm).
  // planLarg/planAlt alimentam a checagem geométrica (kbNecessidadeDimsOS);
  // larg/alt (mesmos valores) alimentam a área total da OS (kbCalcAreaOS) —
  // ambos os campos existem juntos numa OS real (snapshot da planificação).
  kb[OS1_ID] = { id: OS1_ID, num: 'RETHMG-1', status: 'iniciada', cliente: 'RETHMG Cliente Teste', itens: [{ prod: 'Peça Teste', mat: 'Acrílico Cristal (teste homologação)', planLarg: '45', planAlt: '35', larg: '45', alt: '35' }] };
  // OS #2: mesma necessidade — usada para tentar consumir o retalho já usado por OS#1
  kb[OS2_ID] = { id: OS2_ID, num: 'RETHMG-2', status: 'iniciada', cliente: 'RETHMG Cliente Teste 2', itens: [{ prod: 'Peça Teste', mat: 'Acrílico Cristal (teste homologação)', planLarg: '45', planAlt: '35', larg: '45', alt: '35' }] };
  // OS #3: usada para o teste de recusa da sugestão + escolha manual do segundo retalho
  kb[OS3_ID] = { id: OS3_ID, num: 'RETHMG-3', status: 'iniciada', cliente: 'RETHMG Cliente Teste 3', itens: [{ prod: 'Peça Teste', mat: 'Acrílico Cristal (teste homologação)', planLarg: '45', planAlt: '35', larg: '45', alt: '35' }] };
  // OS #4: peça 46×36cm — com margem 5cm precisa de 51×41, NÃO cabe no retalho 50×40 (só no 60×50)
  kb[OS4_ID] = { id: OS4_ID, num: 'RETHMG-4', status: 'iniciada', cliente: 'RETHMG Cliente Teste 4', itens: [{ prod: 'Peça Teste', mat: 'Acrílico Cristal (teste homologação)', planLarg: '46', planAlt: '36', larg: '46', alt: '36' }] };
  await setDoc('kb_os', kb);

  // ── 1. Criar 2 retalhos via a Cloud Function REAL (estoqueCriarRetalho) ──
  var codigoMenor = null, codigoMaior = null;
  await test('1a. cria o 1º retalho (50×40cm) via estoqueCriarRetalho real', async () => {
    var res = await estoqueCriarRetalho.run({ mat: MAT_KEY, dims: '50x40', obs: 'RETHMG retalho menor', requestId: RUN_ID + '-criar-1' }, ctx(UID_PROD1, 'producao'));
    assertTruthy(res.ok, 'esperava ok=true');
    assertTruthy(res.codigo, 'esperava código gerado');
    codigoMenor = res.codigo;
  });
  await test('1b. cria o 2º retalho (60×50cm) via estoqueCriarRetalho real', async () => {
    var res = await estoqueCriarRetalho.run({ mat: MAT_KEY, dims: '60x50', obs: 'RETHMG retalho maior', requestId: RUN_ID + '-criar-2' }, ctx(UID_PROD1, 'producao'));
    assertTruthy(res.ok, 'esperava ok=true');
    codigoMaior = res.codigo;
    assertTruthy(codigoMaior !== codigoMenor, 'códigos devem ser distintos');
  });
  await test('1c. os 2 retalhos aparecem em RETALHOS com qty=1, mesmo material/espessura/cor do estoque', async () => {
    var ret = await getDoc('retalhos');
    var r1 = ret.find(r => r.codigo === codigoMenor), r2 = ret.find(r => r.codigo === codigoMaior);
    assertTruthy(r1 && r2, 'os 2 retalhos devem existir');
    assertEq(r1.mat, MAT_KEY, 'retalho menor — mesmo matKey (mesmo material/espessura/cor por construção, já que mat referencia o item do estoque)');
    assertEq(r2.mat, MAT_KEY, 'retalho maior — mesmo matKey');
    assertEq(r1.qty, 1, 'retalho menor — qty inicial 1');
    assertEq(r2.qty, 1, 'retalho maior — qty inicial 1');
  });

  // ── 2. Sugestão/melhor-fit (lógica client-side real) ──
  var stockAtual = await getDoc('stock');
  var retAtual = await getDoc('retalhos');
  var sugMod = buildSugestaoModule(stockAtual, retAtual);

  await test('2a. margem de segurança configurada é 5cm (Config → Produção)', () => {
    assertEq(sugMod.margemCm, 5);
  });
  await test('2b. peça 45×35 + margem 5cm cabe no retalho menor (50×40) na orientação exata', () => {
    assertTruthy(sugMod.cabeGeometricamente({ w: 45, h: 35 }, { w: 50, h: 40 }, 5));
  });
  await test('2c. peça 45×35 + margem 5cm também cabe no retalho maior (60×50)', () => {
    assertTruthy(sugMod.cabeGeometricamente({ w: 45, h: 35 }, { w: 60, h: 50 }, 5));
  });
  await test('2d. sugestão para OS#1 (peça cabe nos dois retalhos) recomenda o MENOR — melhor-fit, nunca desperdiça o maior', () => {
    var sug = sugMod.sugerir(kb[OS1_ID], MAT_KEY);
    assertTruthy(sug, 'esperava uma sugestão');
    assertEq(sug.tipo, 'retalho');
    assertEq(sug.retalho.codigo, codigoMenor, 'deve sugerir o retalho menor (50×40), não o maior (60×50)');
  });
  await test('2e. peça 46×36 + margem 5cm (precisa 51×41) NÃO cabe no retalho menor (50×40)', () => {
    assertTruthy(!sugMod.cabeGeometricamente({ w: 46, h: 36 }, { w: 50, h: 40 }, 5));
  });
  await test('2f. peça 46×36 + margem 5cm CABE no retalho maior (60×50)', () => {
    assertTruthy(sugMod.cabeGeometricamente({ w: 46, h: 36 }, { w: 60, h: 50 }, 5));
  });
  await test('2g. sugestão para OS#4 (só cabe no maior) pula o menor e recomenda o maior — margem de segurança respeitada, não sugere o que não cabe', () => {
    var sug = sugMod.sugerir(kb[OS4_ID], MAT_KEY);
    assertTruthy(sug, 'esperava uma sugestão');
    assertEq(sug.tipo, 'retalho');
    assertEq(sug.retalho.codigo, codigoMaior, 'deve sugerir o retalho maior, já que o menor não cabe com a margem');
  });

  // ── 3. Aceitar a sugestão — reservar/consumir via a Cloud Function REAL ──
  await test('3. OS#1 aceita a sugestão (retalho menor) — producaoIniciarOuEditar real consome e muda status', async () => {
    var res = await producaoIniciarOuEditar.run(
      { osId: OS1_ID, editMode: false, tipo: 'retalho', retalhoCodigo: codigoMenor, obs: '', requestId: RUN_ID + '-prod-os1' },
      ctx(UID_PROD1, 'producao')
    );
    assertTruthy(res.ok);
    assertEq(res.osStatus, 'producao');
    assertTruthy(res.matProd.isRetalho);
    assertEq(res.matProd.retalhoCodigo, codigoMenor);
  });
  await test('3b. retalho menor foi consumido — qty caiu para 0 no documento real', async () => {
    var ret = await getDoc('retalhos');
    var r1 = ret.find(r => r.codigo === codigoMenor);
    assertEq(r1.qty, 0, 'retalho consumido deve ter qty=0 (reservado/consumido, não mais disponível)');
  });
  await test('3c. retalho maior continua intacto (qty=1) — só o consumido foi afetado', async () => {
    var ret = await getDoc('retalhos');
    var r2 = ret.find(r => r.codigo === codigoMaior);
    assertEq(r2.qty, 1);
  });

  // ── 4. Segunda OS NÃO consegue consumir o mesmo retalho (concorrência/exclusividade real) ──
  await test('4. OS#2 tentando consumir o MESMO retalho (já em qty=0) é rejeitada pela Function com RETALHO_INDISPONIVEL', async () => {
    await assertThrows(
      () => producaoIniciarOuEditar.run(
        { osId: OS2_ID, editMode: false, tipo: 'retalho', retalhoCodigo: codigoMenor, obs: '', requestId: RUN_ID + '-prod-os2-tentativa' },
        ctx(UID_PROD2, 'producao')
      ),
      'RETALHO_INDISPONIVEL'
    );
  });
  await test('4b. OS#2 continua SEM produção iniciada após a rejeição (nada foi baixado por engano)', async () => {
    var kbAtual = await getDoc('kb_os');
    assertTruthy(!kbAtual[OS2_ID].matProd, 'OS#2 não deve ter matProd após a tentativa rejeitada');
    assertEq(kbAtual[OS2_ID].status, 'iniciada', 'status da OS#2 não deve ter mudado');
  });

  // ── 5. Recusar a sugestão e escolher manualmente o outro retalho ──
  await test('5. OS#3 recusa a sugestão (que seria o retalho menor, mas está esgotado) e escolhe MANUALMENTE o retalho maior', async () => {
    var res = await producaoIniciarOuEditar.run(
      { osId: OS3_ID, editMode: false, tipo: 'retalho', retalhoCodigo: codigoMaior, obs: 'Escolha manual — operador preferiu o retalho maior', requestId: RUN_ID + '-prod-os3-manual' },
      ctx(UID_PROD1, 'producao')
    );
    assertTruthy(res.ok);
    assertEq(res.matProd.retalhoCodigo, codigoMaior, 'deve usar exatamente o retalho escolhido manualmente, não o sugerido');
  });
  await test('5b. retalho maior foi consumido pela escolha manual — qty caiu para 0', async () => {
    var ret = await getDoc('retalhos');
    var r2 = ret.find(r => r.codigo === codigoMaior);
    assertEq(r2.qty, 0);
  });
  await test('5c. agora NENHUM dos 2 retalhos está mais disponível — OS#4 (que só cabia no maior) não pode mais ser atendida por retalho', async () => {
    var ret = await getDoc('retalhos');
    var disponiveis = ret.filter(r => r.mat === MAT_KEY && r.qty > 0);
    assertEq(disponiveis.length, 0, 'os 2 retalhos de teste devem estar totalmente consumidos');
    var stockPosRetalhos = await getDoc('stock');
    var sugMod2 = buildSugestaoModule(stockPosRetalhos, ret);
    var sug = sugMod2.sugerir(kb[OS4_ID], MAT_KEY);
    assertTruthy(sug && sug.tipo === 'chapa', 'sem retalho disponível, a sugestão deve cair para chapa nova (comportamento correto, não trava)');
  });

  // ── cleanup completo (scoped só ao que este teste criou) ──
  console.log('\n--- Cleanup ---');
  var stockFinal = await getDoc('stock'); delete stockFinal[MAT_KEY]; await setDoc('stock', stockFinal);
  var retFinal = await getDoc('retalhos'); retFinal = retFinal.filter(r => r.mat !== MAT_KEY); await setDoc('retalhos', retFinal);
  var kbFinal = await getDoc('kb_os'); [OS1_ID, OS2_ID, OS3_ID, OS4_ID].forEach(id => delete kbFinal[id]); await setDoc('kb_os', kbFinal);
  await db.collection('erp_vr_usuarios').doc(UID_MASTER).delete();
  await db.collection('erp_vr_usuarios').doc(UID_PROD1).delete();
  await db.collection('erp_vr_usuarios').doc(UID_PROD2).delete();
  var logDoc = await getDoc('erp_stock_log');
  if (logDoc) { logDoc = logDoc.filter(e => !(e && (e.osId === OS1_ID || e.osId === OS3_ID))); await setDoc('erp_stock_log', logDoc); }

  var kbCheck = await getDoc('kb_os');
  var auditCheck = {
    stockLimpo: !(await getDoc('stock'))[MAT_KEY],
    retalhosLimpos: (await getDoc('retalhos')).filter(r => r.mat === MAT_KEY).length === 0,
    kbLimpo: [OS1_ID, OS2_ID, OS3_ID, OS4_ID].every(id => !kbCheck[id]),
  };
  console.log('  Resíduo pós-cleanup:', JSON.stringify(auditCheck));
  if (!auditCheck.stockLimpo || !auditCheck.retalhosLimpos || !auditCheck.kbLimpo) {
    console.log('  ❌  Resíduo encontrado após cleanup!'); failed++;
  } else {
    console.log('  ✅  Zero resíduo confirmado.'); passed++;
  }

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})().catch(e => { console.error('ERRO FATAL:', e.stack || e); process.exit(1); });
