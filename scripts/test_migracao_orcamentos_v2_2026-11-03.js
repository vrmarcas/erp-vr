/**
 * test_migracao_orcamentos_v2_2026-11-03.js
 *
 * Prova a lógica PURA de scripts/migrate_orcamentos_v2.js (a migração de
 * erp_vr/orcamentos — array legado, um único documento, hoje a 1.981
 * bytes do limite de 1MiB do Firestore — para erp_vr_orcamentos/{id},
 * documento por orçamento) sem precisar de Firestore real nem emulador:
 * as funções sob teste são as REAIS, importadas via require() do script
 * de migração (nunca reimplementadas aqui); a orquestração completa
 * (carregarEstado/executarPlano) é exercida contra um Firestore FALSO em
 * memória (fakeDb), que também é a função real do script, só recebendo
 * um cliente dublê.
 *
 * Cobre a matriz pedida: criar, atualizar (divergência), idempotência
 * (reexecução sem duplicar), órfãos, erro de registro sem id,
 * sanitização de `undefined`/NaN para o formato nativo do Firestore,
 * fidelidade de orçamento histórico com campos aninhados (itens/
 * snapshotCompleto/versoes), e snapshot/export antes de qualquer gravação.
 *
 * Uso: node scripts/test_migracao_orcamentos_v2_2026-11-03.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const mod = require('./migrate_orcamentos_v2.js');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

console.log('\n=== RODADA MIGRAÇÃO ORÇAMENTOS v2 (2026-11-03) ===\n');

// ── Fixtures: orçamentos "reais" (shape completo, campos aninhados) ───────
function orcamentoFixture(id, overrides) {
  return Object.assign({
    id: id, num: id.replace('ORC-', ''), cliente: 'Cliente ' + id, tel: '11999999999', email: '',
    vendedor: 'Vendedor X', produto: 'Placa Acrílico', marca: 'vr',
    valorBase: 1000, valorFinal: 950, valorPrevia: 950,
    valorPendenteComparativo: undefined, // caso real: campo ausente/undefined em orçamento não-comparativo
    regraComparativo: 2, descCond: 0, dcData: '', descPix: 0, parcelas: 3, pgto: 'Cartão',
    status: 'aguardando', dataSalvo: '01/11/2026 10:00', obs: '',
    crmLeadId: undefined, // caso real: nunca setado num orçamento novo
    itens: [{ tipoItem: 'personalizado_vr', prod: 'Item 1', qty: '2', matKey: 'ac3', mat: 'Acrílico 3mm', total: 'R$500,00' }],
    snapshotCompleto: { itens: [{ prod: 'Item 1' }], parametros: { orcMontagem: '0' }, breakdown: { totalCost: 500, finalPrice: 950 }, versaoSnapshot: 2 },
    ajusteComercialAudit: null, prazo: '', prazoDias: '', prazoDiasMax: '', dataPedido: '2026-11-01',
    pricingVersion: 'hash_abc', nfSolicitada: false, statusFiscal: null, nf: null,
    versoes: [], osRef: null, crId: null, condicaoPagamentoTexto: '50% na aprovação, 50% na entrega'
  }, overrides || {});
}

// ── A. sanitizarParaFirestore: fidelidade do round-trip JSON ──────────────
(function () {
  var r = mod.sanitizarParaFirestore({ a: 1, b: undefined, c: NaN, d: Infinity, e: { f: undefined, g: 2 }, h: [1, undefined, 3] });
  ok('A1. remove campos `undefined` no topo (Firestore nativo rejeitaria)', !('b' in r));
  ok('A2. remove `undefined` em objeto aninhado', !('f' in r.e));
  ok('A3. converte NaN em null (mesma fidelidade do JSON.stringify legado)', r.c === null);
  ok('A4. converte Infinity em null', r.d === null);
  ok('A5. `undefined` dentro de array vira null (nunca remove o índice)', r.h.length === 3 && r.h[1] === null);
  ok('A6. preserva valores normais intactos', r.a === 1 && r.e.g === 2);
})();

// ── B. construirDocAlvo: campos de auditoria + migradoEm estável ──────────
(function () {
  var legado = orcamentoFixture('ORC-000100');
  var alvoNovo = mod.construirDocAlvo(legado, null);
  ok('B1. marca migradoDe = id do legado', alvoNovo.migradoDe === 'ORC-000100');
  ok('B2. marca migracaoVersao', alvoNovo.migracaoVersao === mod.MIGRATION_VERSION);
  ok('B3. sem existente anterior: gera um migradoEm novo (número)', typeof alvoNovo.migradoEm === 'number' && alvoNovo.migradoEm > 0);
  ok('B4. nunca grava `undefined` (valorPendenteComparativo sanitizado)', !('valorPendenteComparativo' in alvoNovo));

  var existente = Object.assign({}, alvoNovo, { migradoEm: 12345 });
  var alvoReexec = mod.construirDocAlvo(legado, existente);
  ok('B5. reexecução PRESERVA o migradoEm original (evidência de quando migrou de fato, não de quando o script rodou)', alvoReexec.migradoEm === 12345);
})();

// ── C. diffDeep: divergência estrutural profunda, ordem de chaves não importa ──
(function () {
  ok('C1. objetos idênticos (ordem de chaves diferente): zero diffs', mod.diffDeep({ a: 1, b: 2 }, { b: 2, a: 1 }).length === 0);
  var d1 = mod.diffDeep({ a: 1 }, { a: 2 });
  ok('C2. valor escalar divergente: 1 diff com o caminho certo', d1.length === 1 && d1[0].path === 'a' && d1[0].legado === 1 && d1[0].v2 === 2);
  var d2 = mod.diffDeep({ x: { y: 1 } }, { x: { y: 2 } });
  ok('C3. divergência aninhada: caminho com ponto (x.y)', d2.length === 1 && d2[0].path === 'x.y');
  var d3 = mod.diffDeep({ itens: [{ a: 1 }] }, { itens: [{ a: 1 }, { a: 2 }] });
  ok('C4. array com tamanho diferente: detecta o item extra inteiro (posição itens.1, legado ausente)', d3.length === 1 && d3[0].path === 'itens.1' && d3[0].legado === undefined && JSON.stringify(d3[0].v2) === JSON.stringify({ a: 2 }));
  ok('C5. null vs undefined contam como diferentes (nunca equivalentes)', mod.diffDeep({ a: null }, { a: undefined }).length === 1);
})();

// ── D. classificarRegistro: criar / ok / atualizar / erro ─────────────────
(function () {
  var legado = orcamentoFixture('ORC-000200');
  var cCriar = mod.classificarRegistro(legado, null);
  ok('D1. sem existente em v2: classifica "criar"', cCriar.acao === 'criar');

  var existenteIgual = mod.construirDocAlvo(legado, null);
  var cOk = mod.classificarRegistro(legado, existenteIgual);
  ok('D2. existente idêntico (exceto auditoria): classifica "ok" (idempotente — nenhuma ação)', cOk.acao === 'ok');

  var existenteDivergente = Object.assign({}, existenteIgual, { valorFinal: 1 });
  var cAtualizar = mod.classificarRegistro(legado, existenteDivergente);
  ok('D3. existente com valorFinal diferente: classifica "atualizar" com o diff certo', cAtualizar.acao === 'atualizar' && cAtualizar.diffs.some(function (d) { return d.path === 'valorFinal'; }));

  var cErro = mod.classificarRegistro({ num: '999' }, null); // sem id
  ok('D4. registro legado sem id: classifica "erro" (nunca tenta migrar)', cErro.acao === 'erro');
})();

// ── E. planejarMigracao: bucketing completo + detecção de órfãos ──────────
(function () {
  var legadoArr = [orcamentoFixture('ORC-000301'), orcamentoFixture('ORC-000302'), orcamentoFixture('ORC-000303')];
  var v2PorId = {};
  v2PorId['ORC-000301'] = mod.construirDocAlvo(legadoArr[0], null); // já em paridade
  v2PorId['ORC-000302'] = Object.assign({}, mod.construirDocAlvo(legadoArr[1], null), { status: 'aprovado' }); // divergente
  v2PorId['ORC-999999'] = mod.construirDocAlvo(orcamentoFixture('ORC-999999'), null); // órfão — não existe no legado

  var plano = mod.planejarMigracao(legadoArr, v2PorId);
  ok('E1. ORC-000301 cai em "ok"', plano.ok.some(function (i) { return i.id === 'ORC-000301'; }));
  ok('E2. ORC-000302 cai em "atualizar"', plano.atualizar.some(function (i) { return i.id === 'ORC-000302'; }));
  ok('E3. ORC-000303 (nunca migrado) cai em "criar"', plano.criar.some(function (i) { return i.id === 'ORC-000303'; }));
  ok('E4. ORC-999999 é detectado como órfão, nunca apagado/alterado pelo plano', plano.orfaos.indexOf('ORC-999999') >= 0);
  ok('E5. nenhum registro perdido: soma das categorias = total do legado', plano.ok.length + plano.atualizar.length + plano.criar.length + plano.erros.length === legadoArr.length);
})();

// ── F. Orçamento histórico com campos aninhados: fidelidade total ─────────
(function () {
  var legado = orcamentoFixture('ORC-000400', {
    itens: [{ prod: 'Item complexo', pieces: [{ esp: 3 }, { esp: 5 }], grupoOpcao: { grupoId: 'g1', selecionada: true }, maquinas: { laser: { machineId: 'm1', min: 10 } } }],
    versoes: [{ ts: 1000, usuario: 'a@b.com', acao: 'atualizacao' }]
  });
  var alvo = mod.construirDocAlvo(legado, null);
  var diffsContraOriginal = mod.diffDeep(mod.semCamposAuditoria(alvo), legado);
  ok('F1. itens[].pieces/grupoOpcao/maquinas migram sem perda (zero diffs vs. original)', diffsContraOriginal.length === 0);
  ok('F2. versoes[] (histórico de revisões) preservado integralmente', JSON.stringify(alvo.versoes) === JSON.stringify(legado.versoes));
})();

// ── G. executarPlano: dry-run nunca grava; write grava só criar+atualizar ──
function fakeDb(inicial) {
  var cols = { erp_vr_orcamentos: Object.assign({}, inicial || {}) };
  return {
    _dados: cols,
    collection: function (nome) {
      if (!cols[nome]) cols[nome] = {};
      return {
        doc: function (id) {
          return {
            id: id,
            get: function () { return Promise.resolve({ exists: !!cols[nome][id], data: function () { return cols[nome][id]; } }); },
            set: function (obj) { cols[nome][id] = obj; return Promise.resolve(); }
          };
        },
        get: function () {
          var ids = Object.keys(cols[nome]);
          return Promise.resolve({ docs: ids.map(function (id) { return { id: id, data: function () { return cols[nome][id]; } }; }) });
        }
      };
    }
  };
}

(function () {
  var legadoArr = [orcamentoFixture('ORC-000501'), orcamentoFixture('ORC-000502')];
  var plano = mod.planejarMigracao(legadoArr, {});
  var db = fakeDb();
  mod.executarPlano(db, plano, true).then(function (res) {
    ok('G1. dry-run: NENHUMA gravação real acontece', Object.keys(db._dados.erp_vr_orcamentos).length === 0);
    ok('G2. dry-run: ainda assim conta o que FARIA (sem gravar nada)', res.criados === plano.criar.length && Object.keys(db._dados.erp_vr_orcamentos).length === 0);
  });
})();

(async function () {
  var legadoArr = [orcamentoFixture('ORC-000601'), orcamentoFixture('ORC-000602')];
  var plano = mod.planejarMigracao(legadoArr, {});
  var db = fakeDb();
  var res = await mod.executarPlano(db, plano, false);
  ok('G3. write real: grava os 2 criados', res.criados === 2 && Object.keys(db._dados.erp_vr_orcamentos).length === 2);
  ok('G4. documento gravado tem o id correto como chave (determinístico)', !!db._dados.erp_vr_orcamentos['ORC-000601']);
  ok('G5. documento gravado nunca contém `undefined`', !('valorPendenteComparativo' in db._dados.erp_vr_orcamentos['ORC-000601']));

  // ── H. Idempotência: reexecutar o MESMO plano contra o estado JÁ migrado ──
  var v2Atual = db._dados.erp_vr_orcamentos;
  var plano2 = mod.planejarMigracao(legadoArr, v2Atual);
  ok('H1. reexecução: nada para criar (já migrado)', plano2.criar.length === 0);
  ok('H2. reexecução: nada para atualizar (nada mudou)', plano2.atualizar.length === 0);
  ok('H3. reexecução: os 2 orçamentos aparecem como "ok"', plano2.ok.length === 2);
  var res2 = await mod.executarPlano(db, plano2, false);
  ok('H4. reexecução: zero gravações novas', res2.criados === 0 && res2.atualizados === 0);
  ok('H5. NUNCA duplica — mesma quantidade de documentos antes e depois da reexecução', Object.keys(db._dados.erp_vr_orcamentos).length === 2);

  // ── I. Edição pós-backfill sem dual-write (simula um caminho que ainda não grava v2) ──
  legadoArr[0] = Object.assign({}, legadoArr[0], { status: 'aprovado', valorFinal: 999 });
  legadoArr.push(orcamentoFixture('ORC-000603'));
  var plano3 = mod.planejarMigracao(legadoArr, db._dados.erp_vr_orcamentos);
  ok('I1. detecta a divergência do orçamento editado (status/valorFinal)', plano3.atualizar.some(function (i) { return i.id === 'ORC-000601'; }));
  ok('I2. detecta o orçamento novo (ORC-000603) para criar', plano3.criar.some(function (i) { return i.id === 'ORC-000603'; }));
  var res3 = await mod.executarPlano(db, plano3, false);
  ok('I3. corrige a divergência e cria o novo, sem tocar no que já estava ok', res3.atualizados === 1 && res3.criados === 1);
  ok('I4. total de documentos = 3 (nunca duplicou o ORC-000601 editado)', Object.keys(db._dados.erp_vr_orcamentos).length === 3);

  // ── J. carregarEstado: orquestração completa com o doc legado real ────────
  var dbCompleto = fakeDb();
  dbCompleto.collection('erp_vr').doc('orcamentos').set({ data: JSON.stringify(legadoArr) });
  var estado = await mod.carregarEstado(dbCompleto);
  ok('J1. carregarEstado lê o array legado inteiro a partir do campo "data" (JSON string)', estado.legadoArr.length === legadoArr.length);
  ok('J2. carregarEstado lê o estado v2 (vazio neste dublê novo)', Object.keys(estado.v2PorId).length === 0);

  // ── K. Falha de gravação: não trava o lote, reporta o item ─────────────────
  var dbFalha = fakeDb();
  var planoFalha = mod.planejarMigracao([orcamentoFixture('ORC-000701'), orcamentoFixture('ORC-000702')], {});
  var origSet = dbFalha.collection('erp_vr_orcamentos').doc('ORC-000701').set;
  var colReal = dbFalha._dados.erp_vr_orcamentos;
  dbFalha.collection = (function (orig) {
    return function (nome) {
      var c = orig(nome);
      if (nome !== 'erp_vr_orcamentos') return c;
      var origDoc = c.doc;
      c.doc = function (id) {
        var d = origDoc(id);
        if (id === 'ORC-000701') d.set = function () { return Promise.reject(new Error('falha simulada')); };
        return d;
      };
      return c;
    };
  })(dbFalha.collection);
  var resFalha = await mod.executarPlano(dbFalha, planoFalha, false);
  ok('K1. 1 falha de gravação é reportada, nunca lançada como exceção fatal', resFalha.falhasGravacao.length === 1 && resFalha.falhasGravacao[0].id === 'ORC-000701');
  ok('K2. o OUTRO item do lote ainda é gravado com sucesso (falha isolada)', resFalha.criados === 1 && !!colReal['ORC-000702']);

  // ── L. Snapshot/export: evidência antes de qualquer gravação ──────────────
  var tmpDir = path.join(require('os').tmpdir(), 'test_migracao_orc_v2_' + Date.now());
  var snapPath = mod.salvarSnapshot(tmpDir, { legadoArr: legadoArr, v2PorId: db._dados.erp_vr_orcamentos });
  var lido = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  ok('L1. snapshot gravado em disco com o array legado completo', lido.legadoArr.length === legadoArr.length);
  ok('L2. snapshot inclui o estado v2 no momento da captura', lido.v2Count === Object.keys(db._dados.erp_vr_orcamentos).length);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n' + passed + ' passou(aram), ' + failed + ' falhou(aram)\n');
  process.exit(failed > 0 ? 1 : 0);
})();
