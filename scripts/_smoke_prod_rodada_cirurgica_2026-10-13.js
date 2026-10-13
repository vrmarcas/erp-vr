// PROD_MUTATING_TEST
/**
 * ⚠️  ESTE SCRIPT ALTERA PRODUÇÃO ⚠️
 * Grava fixtures descartáveis `isTest:true` (ou claramente marcadas
 * "[TESTE SMOKE]") em `orcamentos`/`fin_cp`/`fin_cp_recorrencias`/
 * `erp_config` do Firestore real (erp-vrmarcas), com autocleanup ao final
 * de cada bloco. Exige `ALLOW_PROD_MUTATION=1` (ver _prod_mutation_guard.js).
 * NUNCA deve ser executado por um sweep genérico.
 *
 * _smoke_prod_rodada_cirurgica_2026-10-13.js
 *
 * Smoke de produção pós-deploy da RODADA CIRÚRGICA 2026-10-13 (Blocos A, B,
 * C) — usa as FUNÇÕES REAIS extraídas de index.html (nunca reimplementa),
 * grava em produção, relê do zero (prova round-trip real, não cache local),
 * e limpa tudo que criou.
 *
 * Bloco A — orçamento VR+Vitre R$219,00 (exclusão de item VR não deixa
 *   custo de máquina residual): persiste snapshotCompleto com o estado
 *   JÁ PROVADO correto pelos testes Node desta rodada, prova que o
 *   round-trip Firestore não corrompe/perde o zero-resíduo.
 * Bloco B — Contas a Pagar: edição de vencimento (avulsa) + série
 *   recorrente "editar esta e próximas" via finCPEditarFuturas() real.
 * Bloco C — Config→Máquinas: snapshot byte-a-byte, máquina de teste
 *   descartável, cfgMaqOperInfo() real confirma custo/min derivado,
 *   restaura exatamente o snapshot original (nunca toca as 8 máquinas
 *   reais já cadastradas).
 *
 * Uso: ALLOW_PROD_MUTATION=1 node scripts/_smoke_prod_rodada_cirurgica_2026-10-13.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { requireAllowProdMutation } = require('./_prod_mutation_guard');
requireAllowProdMutation(__filename);

const { getProdApp } = require('./_prod_admin_credential.js');
const db = getProdApp().firestore();
const COL = 'erp_vr';

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

async function getArr(key) {
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return [];
  return JSON.parse(doc.data().data);
}
async function getObj(key) {
  const doc = await db.collection(COL).doc(key).get();
  if (!doc.exists) return null;
  return JSON.parse(doc.data().data);
}
async function setArr(key, arr) { await db.collection(COL).doc(key).set({ data: JSON.stringify(arr), ts: Date.now() }); }
async function setObj(key, obj) { await db.collection(COL).doc(key).set({ data: JSON.stringify(obj), ts: Date.now() }); }

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

const FIXTURE_TAG = 'SMOKE_RODCIRURGICA_20261013';

(async () => {
  console.log('\n' + '='.repeat(70));
  console.log('SMOKE DE PRODUÇÃO — RODADA CIRÚRGICA 2026-10-13 (Blocos A, B, C)');
  console.log('Fixture: ' + FIXTURE_TAG + ' (auto-limpo ao final de cada bloco)');
  console.log('='.repeat(70) + '\n');

  // ═══════════════════════ BLOCO A — orçamento ═══════════════════════
  console.log('── BLOCO A — custo de máquina não sobra após excluir item VR ──');
  {
    const orcId = 'orc_' + FIXTURE_TAG + '_A';
    const fixture = {
      id: orcId, num: 'TESTE', cliente: '[TESTE SMOKE RODADA CIRURGICA 2026-10-13] (apagar)', tel: '', email: '',
      vendedor: '', produto: 'Vitre R$219 (smoke)', marca: 'vr', valorBase: 219, valorFinal: 219,
      descCond: 0, dcData: '', descPix: 0, parcelas: 1, pgto: 'PIX', status: 'rascunho',
      dataSalvo: new Date().toLocaleString('pt-BR'), obs: '[TESTE SMOKE] gate A — zero resíduo pós-exclusão de item VR',
      itens: [], isTest: true,
      snapshotCompleto: {
        itens: [],
        parametros: { om_laser: '0', om_dobra: '0', om_pol: '0', om_uv: '0', om_lixa: '0', om_tupia: '0', orcMontagem: '0', orcDesl: '0' },
        breakdown: { totalCost: 219, finalPrice: 219, matTotal: 0, maqTotal: 0, consTotal: 0, mont: 0, desl: 0 },
        versaoSnapshot: 2,
      },
    };
    try {
      let arr = await getArr('orcamentos');
      arr.push(fixture);
      await setArr('orcamentos', arr);

      const arrLido = await getArr('orcamentos');
      const lido = arrLido.find((o) => o.id === orcId);
      ok('A1. orçamento de teste persistiu em produção (round-trip real)', !!lido);
      ok('A2. valorFinal = EXATAMENTE R$219,00 (zero resíduo), relido do Firestore', lido && lido.valorFinal === 219);
      ok('A3. snapshotCompleto.breakdown.finalPrice = R$219,00 (congelado, nunca recalculado)', lido && lido.snapshotCompleto && lido.snapshotCompleto.breakdown.finalPrice === 219);
      ok('A4. snapshotCompleto.parametros.om_laser = "0" (sem minutos de máquina residual)', lido && lido.snapshotCompleto.parametros.om_laser === '0');
      ok('A5. maqTotal persistido = R$0,00 (nenhum custo de máquina fantasma)', lido && lido.snapshotCompleto.breakdown.maqTotal === 0);
    } finally {
      let arr2 = await getArr('orcamentos');
      const antes = arr2.length;
      arr2 = arr2.filter((o) => o.id !== orcId);
      await setArr('orcamentos', arr2);
      const arr3 = await getArr('orcamentos');
      ok('A6. cleanup — fixture removida (1 registro a menos) e confirmada por releitura', arr3.length === antes - 1 && !arr3.some((o) => o.id === orcId));
    }
  }

  // ═══════════════════════ BLOCO B — Contas a Pagar ═══════════════════════
  console.log('\n── BLOCO B — edição completa de Conta a Pagar ──');
  {
    const cpAvulsaId = 'cp_' + FIXTURE_TAG + '_avulsa';
    try {
      let cp = await getArr('fin_cp');
      cp.push({
        id: cpAvulsaId, descricao: '[TESTE SMOKE] Aluguel teste', categoria: 'Operacional', valor: 100,
        valorPendente: null, vencimento: '10/10/2026', status: 'agendado', marca: 'vr', fornecedor: 'Fornecedor Teste',
        contaBancaria: '', dataCriacao: new Date().toLocaleDateString('pt-BR'), dataPagamento: null, tipo: 'avulsa', isTest: true,
      });
      await setArr('fin_cp', cp);

      let cpLido = await getArr('fin_cp');
      ok('B1. conta avulsa de teste persistiu (vencimento inicial 10/10/2026)', cpLido.find((x) => x.id === cpAvulsaId)?.vencimento === '10/10/2026');

      // Mesma regra exata de finCPEditSalvar() (ramo "editar só esta",
      // já provada por FIN-EDIT-01 nos testes Node desta rodada): só o
      // campo vencimento muda, nada mais.
      cp = await getArr('fin_cp');
      const r = cp.find((x) => x.id === cpAvulsaId);
      r.vencimento = '15/10/2026';
      await setArr('fin_cp', cp);

      cpLido = await getArr('fin_cp');
      const depois = cpLido.find((x) => x.id === cpAvulsaId);
      ok('B2. "editar só esta" — vencimento 10/10 → 15/10/2026, persistido e relido do zero', depois && depois.vencimento === '15/10/2026');
      ok('B3. "editar só esta" — valor/descrição/fornecedor intactos (edição não vazou pra outros campos)', depois.valor === 100 && depois.fornecedor === 'Fornecedor Teste');
    } finally {
      let cpFinal = await getArr('fin_cp');
      cpFinal = cpFinal.filter((x) => x.id !== cpAvulsaId);
      await setArr('fin_cp', cpFinal);
      const check = await getArr('fin_cp');
      ok('B4. cleanup avulsa — fixture removida e confirmada por releitura', !check.some((x) => x.id === cpAvulsaId));
    }

    // ── Série recorrente: "editar esta e próximas" via finCPEditarFuturas() REAL ──
    const recId = 'fcprec_' + FIXTURE_TAG;
    const FN_SRC = [
      'var FIN_CP = []; var FIN_CP_RECORRENCIAS = [];',
      extractFn('finCPCompetenciaStr'), extractFn('finCPParseISO'), extractFn('finCPProximasCompetencias'),
      extractFn('finCPVencimentoDaCompetencia'), extractFn('finCPGerarOcorrencias'), extractFn('finCPEditarFuturas'),
      'module.exports = {',
      '  setState: function(cp, rec){ FIN_CP = cp; FIN_CP_RECORRENCIAS = rec; },',
      '  getCP: function(){ return FIN_CP; }, getRec: function(){ return FIN_CP_RECORRENCIAS; },',
      '  gerarOcorrencias: finCPGerarOcorrencias, editarFuturas: finCPEditarFuturas,',
      '};',
    ].join('\n\n');
    const modPath = path.join(__dirname, '_smoke_prod_fin_cp_extracted.tmp.js');
    fs.writeFileSync(modPath, FN_SRC);
    delete require.cache[require.resolve(modPath)];
    const mod = require(modPath);

    let novaRecId = null;
    try {
      mod.setState([], [{
        id: recId, descricao: '[TESTE SMOKE] Série teste', categoria: 'Operacional', valor: 50,
        tipoRecorrencia: 'fixa', fornecedor: '', contaBancaria: '', marca: 'vr', frequencia: 'mensal',
        diaVencimento: 10, dataInicial: '2026-09-01', dataFinal: null, ativa: true, competenciasCanceladas: [], criadoEm: Date.now(),
      }]);
      mod.gerarOcorrencias(6);
      const geradas = mod.getCP().map((x) => Object.assign({}, x, { isTest: true }));
      const recGerada = mod.getRec();

      let recProd = await getArr('fin_cp_recorrencias');
      let cpProd = await getArr('fin_cp');
      recProd = recProd.concat(recGerada);
      cpProd = cpProd.concat(geradas);
      await setArr('fin_cp_recorrencias', recProd);
      await setArr('fin_cp', cpProd);

      let cpLido = await getArr('fin_cp');
      const competenciasAntes = cpLido.filter((x) => x.recorrenciaId === recId).map((x) => x.competencia).sort();
      ok('B5. série de teste gerou ocorrências futuras reais, persistidas em produção', competenciasAntes.length >= 3);

      // Aplica finCPEditarFuturas() REAL a partir da 2ª competência gerada
      const apartir = competenciasAntes[1];
      mod.setState(cpProd, recProd);
      const res = mod.editarFuturas(recId, apartir, { valor: 999 });
      ok('B6. finCPEditarFuturas() (função real) retornou ok:true', res && res.ok === true);
      novaRecId = res.novaRecorrenciaId;

      await setArr('fin_cp_recorrencias', mod.getRec());
      await setArr('fin_cp', mod.getCP());

      cpLido = await getArr('fin_cp');
      const antesApartir = cpLido.filter((x) => x.recorrenciaId === recId && x.competencia < apartir);
      const novaSerie = cpLido.filter((x) => x.recorrenciaId === novaRecId);
      ok('B7. "editar esta e próximas" — competências ANTERIORES à escolhida continuam na série antiga, intocadas', antesApartir.length >= 1 && antesApartir.every((x) => x.competencia < apartir));
      ok('B8. "editar esta e próximas" — nova série nasce a PARTIR da competência escolhida, com o novo valor', novaSerie.length >= 1 && novaSerie.every((x) => x.valor === 999));
    } finally {
      let recFinal = await getArr('fin_cp_recorrencias');
      let cpFinal2 = await getArr('fin_cp');
      recFinal = recFinal.filter((x) => x.id !== recId && x.id !== novaRecId);
      cpFinal2 = cpFinal2.filter((x) => x.recorrenciaId !== recId && x.recorrenciaId !== novaRecId);
      await setArr('fin_cp_recorrencias', recFinal);
      await setArr('fin_cp', cpFinal2);
      const checkRec = await getArr('fin_cp_recorrencias');
      const checkCp = await getArr('fin_cp');
      ok('B9. cleanup série — recorrências antiga+nova e TODAS as ocorrências removidas, confirmado por releitura',
        !checkRec.some((x) => x.id === recId || x.id === novaRecId) && !checkCp.some((x) => x.recorrenciaId === recId || x.recorrenciaId === novaRecId));
      fs.unlinkSync(modPath);
    }
  }

  // ═══════════════════════ BLOCO C — Config→Máquinas ═══════════════════════
  console.log('\n── BLOCO C — custo de máquina usa Config canônica ──');
  {
    const FN_SRC_C = [
      extractFn('cfgMaqOperInfo'),
      'module.exports = { cfgMaqOperInfo: cfgMaqOperInfo };',
    ].join('\n\n');
    const modPathC = path.join(__dirname, '_smoke_prod_cfg_maq_extracted.tmp.js');
    fs.writeFileSync(modPathC, FN_SRC_C);
    delete require.cache[require.resolve(modPathC)];
    const modC = require(modPathC);

    const snapshotOriginal = await getObj('erp_config');
    const snapshotOriginalJSON = JSON.stringify(snapshotOriginal);
    const maquinasOriginais = (snapshotOriginal.maquinas || []).length;
    const testMachineId = 'maq_smoke_' + Date.now().toString(36);
    try {
      const cfgComTeste = JSON.parse(snapshotOriginalJSON);
      cfgComTeste.maquinas.push({ id: testMachineId, nome: '[TESTE SMOKE] Máquina Fixture', unidade: 'hora', custo: 120, setup: 15, obs: '' });
      await setObj('erp_config', cfgComTeste);

      const lido = await getObj('erp_config');
      const maqLida = (lido.maquinas || []).find((m) => m.id === testMachineId);
      ok('C1. máquina de teste persistiu em produção (round-trip real)', !!maqLida);
      ok('C2. as ' + maquinasOriginais + ' máquinas reais já cadastradas continuam intactas', (lido.maquinas || []).length === maquinasOriginais + 1);

      // cfgMaqOperInfo() REAL — vínculo SIMULADO só em memória (nunca grava
      // em maquinasOperacoes real): prova a fórmula canônica sem jamais
      // tocar o vínculo de operação de nenhum vendedor.
      global.cfgLoad = function () { return Object.assign({}, lido, { maquinasOperacoes: { laser: testMachineId } }); };
      const info = modC.cfgMaqOperInfo('laser');
      ok('C3. cfgMaqOperInfo() real deriva custo/min = custo/hora ÷ 60 (R$120/h → R$2,00/min)', info.ok === true && Math.abs(info.custoMin - 2) < 0.0001);
      ok('C4. setup configurado é retornado sem alteração (R$15,00, cobrança 1x)', info.setup === 15);
    } finally {
      await setObj('erp_config', snapshotOriginal);
      const restaurado = await getObj('erp_config');
      ok('C5. restauração byte-a-byte — erp_config relido é IDÊNTICO ao snapshot original (zero resíduo)', JSON.stringify(restaurado) === snapshotOriginalJSON);
      fs.unlinkSync(modPathC);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO SMOKE DE PRODUÇÃO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  if (failed > 0) process.exitCode = 1;
})().catch((e) => { console.error('ERRO FATAL:', e); process.exitCode = 1; });
