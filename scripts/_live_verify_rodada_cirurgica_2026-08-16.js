/**
 * _live_verify_rodada_cirurgica_2026-08-16.js
 *
 * Verificação AO VIVO (Firestore de produção real, erp-vrmarcas) dos itens
 * #2, #4 e #5 da rodada cirúrgica 2026-08-16 — usando as FUNÇÕES REAIS
 * extraídas de index.html (não reimplementações), rodando contra um
 * fixture descartável isTest, com limpeza automática ao final (a própria
 * execução do script cria e remove o fixture — não precisa de script de
 * limpeza separado).
 *
 * Não requer login no navegador (usa a mesma credencial Admin SDK já
 * estabelecida nesta engenharia — ver _prod_admin_credential.js).
 *
 * Cobre:
 *   #2 — kbNormalizarChecklistLegado real, contra 2 OS descartáveis
 *        (uma customizada, uma não), provando independência + persistência
 *        do "sem re-heal" ao simular reload (kbOpen chama esta função a
 *        cada abertura).
 *   #4 — kbSaveKbos real, gravando de fato no documento kb_os de produção
 *        e relendo do zero (bypass de qualquer cache local) para provar
 *        que _marcandoPronto/_liberando NUNCA chegam ao documento
 *        persistido, mesmo estando true em memória no momento do save.
 *   #5 — orcRegistrarSituacaoFinanceira real, gravando de fato no
 *        documento orcamentos de produção, provando que tipo='futuro'
 *        (A Receber) grava pgtoConfirmado exatamente como qualquer outro
 *        tipo — o único campo que orcEnvGerarOS() verifica.
 *
 * Uso: node scripts/_live_verify_rodada_cirurgica_2026-08-16.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();
const COL = 'erp_vr';

let passed = 0, failed = 0;
function ok(desc, cond) {
  if (cond) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc); failed++; }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — script desatualizado?');
  const braceOpen = html.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractVar(name) {
  const marker = 'var ' + name + ' = [';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada');
  const end = html.indexOf('];', start) + 2;
  return html.slice(start, end);
}
function extractSingleLineVar(name) {
  const marker = 'var ' + name + ' = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada');
  const end = html.indexOf(';', start) + 1;
  return html.slice(start, end);
}

const FIXTURE_TAG = 'E2E_RODCIRURGICA_20260816';
const OS_A_ID = 'os_' + FIXTURE_TAG + '_A';
const OS_B_ID = 'os_' + FIXTURE_TAG + '_B';
const ORC_ID = 'orc_' + FIXTURE_TAG;

async function getDoc(key) {
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return { exists: false, data: null };
  const raw = doc.data();
  if (!raw || typeof raw.data === 'undefined') return { exists: false, data: null };
  try { return { exists: true, data: JSON.parse(raw.data) }; }
  catch (e) { return { exists: true, data: raw.data }; }
}
async function setDoc(key, data) {
  await db.collection(COL).doc(key).set({ data: JSON.stringify(data), ts: Date.now() });
}

(async () => {
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICAÇÃO AO VIVO — Firestore de produção real (erp-vrmarcas)');
  console.log('Fixture descartável: ' + FIXTURE_TAG + ' (auto-limpo ao final)');
  console.log('='.repeat(70) + '\n');

  // ══════════════════════════════════════════════════════════════════
  // ITEM #2 — kbNormalizarChecklistLegado real, execução pura (sem I/O)
  // ══════════════════════════════════════════════════════════════════
  console.log('-- Item #2: kbNormalizarChecklistLegado (função real) --');
  {
    const src = [extractVar('OPERACOES_PADRAO'), extractFn('kbNormalizarChecklistLegado'),
      'module.exports = { kbNormalizarChecklistLegado };'].join('\n\n');
    const modPath = path.join(__dirname, '_tmp_live_normalizador.js');
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];
    const mod = require(modPath);

    const osA = { checks: ['Corte', 'Montagem', 'Embalagem'], _ck: [true, false, false], _checklistCustomizado: true };
    const osB = { checks: ['Corte', 'Gravação', 'Montagem', 'Acabamento', 'Embalagem'], _ck: [true, true, true, true, true] };

    // Simula 3 "reaberturas" seguidas (kbOpen chama isto TODA vez) — prova que
    // não é sorte de uma única chamada, o gate se mantém estável no tempo.
    for (let i = 0; i < 3; i++) {
      mod.kbNormalizarChecklistLegado(osA);
      mod.kbNormalizarChecklistLegado(osB);
    }
    ok('OS A (customizada, 3 itens) sobrevive a 3 "reaberturas" simuladas sem ganhar os itens removidos de volta',
      osA.checks.length === 3 && JSON.stringify(osA.checks) === JSON.stringify(['Corte', 'Montagem', 'Embalagem']));
    ok('OS B (não-customizada, 5 itens canônicos) continua intacta e independente da OS A',
      osB.checks.length === 5 && osB._ck.every(v => v === true));
    fs.unlinkSync(modPath);
  }

  // ══════════════════════════════════════════════════════════════════
  // ITEM #4 — kbSaveKbos real, gravação de fato no kb_os de produção
  // ══════════════════════════════════════════════════════════════════
  console.log('\n-- Item #4: kbSaveKbos (função real) gravando no kb_os de produção --');
  {
    const before = await getDoc('kb_os');
    const kbOsBefore = before.data || {};
    ok('Precondição: fixture ainda não existe no kb_os de produção', !kbOsBefore[OS_A_ID]);

    // Monta KB_OS = doc real + 1 OS descartável com os locks TRAVADOS em
    // true (exatamente o padrão que a auditoria da rodada anterior achou
    // travado em produção antes desta correção).
    const KB_OS = Object.assign({}, kbOsBefore);
    KB_OS[OS_A_ID] = {
      id: OS_A_ID, num: 'TESTE-CIRURGICA', status: 'producao', isTest: true,
      cliente: FIXTURE_TAG, checks: ['Corte'], _ck: [true],
      _marcandoPronto: true, _liberando: true,
    };

    const finFieldsSrc = extractSingleLineVar('_KB_OS_FIN_FIELDS');
    const saveSrc = extractFn('kbSaveKbos');
    const runner = new Function('_cloudSave', 'KB_OS', finFieldsSrc + '\n' + saveSrc + '\nreturn kbSaveKbos;');
    let capturedPayload = null;
    const fakeCloudSave = function (key, data) { capturedPayload = data; return setDoc(key, data).then(() => ({ ok: true })); };
    const kbSaveKbos = runner(fakeCloudSave, KB_OS);

    const res = await kbSaveKbos();
    ok('kbSaveKbos() real reporta sucesso ao gravar no documento de produção', res && res.ok === true);
    ok('Payload construído pela própria função já não contém _marcandoPronto', !('_marcandoPronto' in capturedPayload[OS_A_ID]));
    ok('Payload construído pela própria função já não contém _liberando', !('_liberando' in capturedPayload[OS_A_ID]));

    // Prova definitiva: RELÊ do Firestore do zero (nova conexão de leitura,
    // sem nenhum cache local) — exatamente o que um F5/nova aba veria.
    const after = await getDoc('kb_os');
    const osADepoisDoReload = (after.data || {})[OS_A_ID];
    ok('OS existe no documento relido do Firestore', !!osADepoisDoReload);
    ok('Documento relido do Firestore NÃO contém _marcandoPronto (nunca fica "preso")', osADepoisDoReload && !('_marcandoPronto' in osADepoisDoReload));
    ok('Documento relido do Firestore NÃO contém _liberando (nunca fica "preso")', osADepoisDoReload && !('_liberando' in osADepoisDoReload));

    // Limpeza imediata desta parte do fixture — remove OS_A_ID do kb_os real.
    const cleanKbOs = Object.assign({}, (await getDoc('kb_os')).data || {});
    delete cleanKbOs[OS_A_ID];
    await setDoc('kb_os', cleanKbOs);
    const afterCleanup = await getDoc('kb_os');
    ok('Limpeza: OS de teste removida do kb_os de produção — zero resíduo', !(afterCleanup.data || {})[OS_A_ID]);
  }

  // ══════════════════════════════════════════════════════════════════
  // ITEM #5 — orcRegistrarSituacaoFinanceira real, gravação de fato
  // ══════════════════════════════════════════════════════════════════
  console.log('\n-- Item #5: orcRegistrarSituacaoFinanceira (função real) — tipo "futuro" (A Receber) --');
  {
    const orcBefore = await getDoc('orcamentos');
    const arrOrcBefore = orcBefore.data || [];
    ok('Precondição: orçamento de teste ainda não existe em produção', !arrOrcBefore.some(o => o.id === ORC_ID));

    const arrOrcComFixture = arrOrcBefore.concat([{
      id: ORC_ID, num: 'TESTE-CIRURGICA', cliente: FIXTURE_TAG, tel: '',
      marca: 'vr', produto: 'Teste rodada cirúrgica', isTest: true,
    }]);
    await setDoc('orcamentos', arrOrcComFixture);

    const fnSrc = extractFn('orcRegistrarSituacaoFinanceira');
    const runner = new Function(
      '_db', '_COL', 'showToast',
      [
        'var _ORC_ENVIADOS_DATA = [];',
        'var _cloudLastPayload = {};',
        'function orcEnviadosRender(){}',
        fnSrc,
        'return orcRegistrarSituacaoFinanceira;',
      ].join('\n')
    );
    const orcRegistrarSituacaoFinanceira = runner(db, COL, function () {});

    const valorTotal = 106.36;
    const resultado = await orcRegistrarSituacaoFinanceira(ORC_ID, {
      tipo: 'futuro', forma: 'pix', valorEfetivo: valorTotal, valorEntrada: 0,
      restante: valorTotal, obs: 'fixture ' + FIXTURE_TAG, nf: false,
    });
    ok('orcRegistrarSituacaoFinanceira() real reporta sucesso para tipo="futuro" (A Receber)', resultado && resultado.ok === true);
    ok('Não foi um "já confirmado" fantasma — é a primeira confirmação real deste orçamento', resultado && resultado.jaConfirmado === false);
    ok('pgtoConfirmado.tipo gravado é exatamente "futuro"', resultado && resultado.dados && resultado.dados.tipo === 'futuro');
    ok('pgtoConfirmado.valorEntrada = 0 (nada é cobrado agora, como A Receber exige)', resultado && resultado.dados && resultado.dados.valorEntrada === 0);
    ok('pgtoConfirmado.restante = valor total (fica 100% em aberto)', resultado && resultado.dados && resultado.dados.restante === valorTotal);

    // Relê do Firestore do zero — prova que o campo realmente persistiu, não
    // é só o retorno em memória da própria chamada.
    const orcDepois = await getDoc('orcamentos');
    const orcRelido = (orcDepois.data || []).find(o => o.id === ORC_ID);
    ok('Orçamento relido do Firestore tem pgtoConfirmado truthy — EXATAMENTE o único campo que orcEnvGerarOS() checa (`if(!o.pgtoConfirmado)`)', orcRelido && !!orcRelido.pgtoConfirmado);
    ok('orcEnvGerarOS() NÃO bloquearia esta situação: !o.pgtoConfirmado === false', orcRelido && !orcRelido.pgtoConfirmado === false);

    // Idempotência: rodar de novo não deve duplicar o CR nem sobrescrever o registro.
    const resultado2 = await orcRegistrarSituacaoFinanceira(ORC_ID, {
      tipo: 'futuro', forma: 'pix', valorEfetivo: valorTotal, valorEntrada: 0,
      restante: valorTotal, obs: 'segunda tentativa', nf: false,
    });
    ok('Segunda chamada (double-click/retry) é idempotente: jaConfirmado=true, não regrava', resultado2 && resultado2.ok === true && resultado2.jaConfirmado === true);

    const crDepois = await getDoc('fin_cr');
    const crDoFixture = (crDepois.data || []).filter(c => c.orcamentoId === ORC_ID);
    ok('fin_cr tem exatamente 1 lançamento para este orçamento (sem duplicar no retry)', crDoFixture.length === 1);
    ok('Lançamento em fin_cr está com status "pendente" (saldo aberto, nada recebido)', crDoFixture[0] && crDoFixture[0].status === 'pendente');
    ok('Valor do lançamento em fin_cr bate com o valor total do orçamento (não travado num valor estimado antigo)', crDoFixture[0] && crDoFixture[0].valor === valorTotal);

    // ── Limpeza ──
    const cleanOrc = (await getDoc('orcamentos')).data.filter(o => o.id !== ORC_ID);
    await setDoc('orcamentos', cleanOrc);
    const cleanCr = (await getDoc('fin_cr')).data.filter(c => c.orcamentoId !== ORC_ID);
    await setDoc('fin_cr', cleanCr);

    const finalOrc = await getDoc('orcamentos');
    const finalCr = await getDoc('fin_cr');
    ok('Limpeza: orçamento de teste removido de produção — zero resíduo', !finalOrc.data.some(o => o.id === ORC_ID));
    ok('Limpeza: fin_cr sem lançamentos do teste — zero resíduo', !finalCr.data.some(c => c.orcamentoId === ORC_ID));
  }

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('\n❌ ERRO DURANTE A VERIFICAÇÃO AO VIVO:', e);
  console.error('\n⚠️  Verificando/limpando resíduo do fixture antes de sair...');
  try {
    const kb = await getDoc('kb_os');
    if (kb.data && (kb.data[OS_A_ID] || kb.data[OS_B_ID])) {
      const clean = Object.assign({}, kb.data);
      delete clean[OS_A_ID]; delete clean[OS_B_ID];
      await setDoc('kb_os', clean);
      console.error('  kb_os: resíduo removido.');
    }
    const orc = await getDoc('orcamentos');
    if (orc.data && orc.data.some(o => o.id === ORC_ID)) {
      await setDoc('orcamentos', orc.data.filter(o => o.id !== ORC_ID));
      console.error('  orcamentos: resíduo removido.');
    }
    const cr = await getDoc('fin_cr');
    if (cr.data && cr.data.some(c => c.orcamentoId === ORC_ID)) {
      await setDoc('fin_cr', cr.data.filter(c => c.orcamentoId !== ORC_ID));
      console.error('  fin_cr: resíduo removido.');
    }
  } catch (e2) { console.error('  ❌ Falha na limpeza de emergência:', e2); }
  process.exit(1);
});
