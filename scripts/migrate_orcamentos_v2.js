#!/usr/bin/env node
/**
 * migrate_orcamentos_v2.js
 *
 * Migração definitiva do array legado erp_vr/orcamentos (UM documento
 * Firestore contendo TODOS os orçamentos, serializado como string JSON —
 * medido em produção a 1.046.595 de 1.048.576 bytes, 1.981 bytes de
 * margem; causa raiz real de o orçamento #000266 não salvar) para a
 * estrutura documento-por-orçamento erp_vr_orcamentos/{id}, eliminando de
 * vez o limite de 1MiB (mesmo padrão já usado e provado em produção para
 * Compras — ver migrate_compras_v2.js / erp_vr_compras — onde o array
 * legado erp_vr/compras foi completamente aposentado em favor de
 * documento-por-registro).
 *
 * SEGURANÇA / ADITIVIDADE:
 *   - Nunca apaga nem sobrescreve erp_vr/orcamentos (o legado) — só LÊ.
 *   - Nunca apaga um documento de erp_vr_orcamentos (um "órfão" ali —
 *     sem correspondente no array legado — é só REPORTADO, nunca tocado).
 *   - ID determinístico: usa o próprio `orc.id` (já único, 'ORC-'+num)
 *     como id do documento novo — reexecutar é por construção idempotente
 *     (mesmo id = mesmo documento; nunca cria duplicata), diferente do
 *     padrão de id aleatório + `migradoDe` usado em migrate_compras_v2.js.
 *   - Sanitização: Firestore nativo REJEITA campos `undefined` (que o
 *     array legado tolera, pois vai para uma STRING via JSON.stringify,
 *     que já descarta `undefined` silenciosamente) — sanitizarParaFirestore()
 *     faz o mesmo round-trip JSON antes de qualquer gravação, para nunca
 *     divergir da fidelidade que o legado já tinha.
 *   - Projeto travado: só roda contra o projeto de produção real
 *     (erp-vrmarcas, mesma credencial ADC de _prod_admin_credential.js);
 *     aborta se o projeto resolvido for outro.
 *
 * MODOS:
 *   (nenhuma flag)  — DRY-RUN: lê tudo, salva snapshot/export local,
 *                     imprime o plano completo (criar/atualizar/ok/
 *                     órfãos/erros) com diff campo-a-campo. NENHUMA gravação.
 *   --write         — Executa o plano (cria/atualiza em erp_vr_orcamentos).
 *                     Sempre salva snapshot ANTES de gravar.
 *   --verify        — Força modo leitura (mesmo com --write) — útil para
 *                     rodar DEPOIS de um --write e provar paridade (plano
 *                     deve sair com 0 em "criar"/"atualizar").
 *
 * Lógica pura (sanitizarParaFirestore, construirDocAlvo, diffDeep,
 * classificarRegistro, planejarMigracao, executarPlano) é exportada e
 * testada sem Firestore real — ver scripts/test_migracao_orcamentos_v2_2026-11-03.js.
 *
 * Uso:
 *   node scripts/migrate_orcamentos_v2.js                 # dry-run
 *   node scripts/migrate_orcamentos_v2.js --write          # migra de verdade
 *   node scripts/migrate_orcamentos_v2.js --write --verify # só confere paridade
 */
'use strict';

const MIGRATION_VERSION = 'orcamentos_v2_2026-11-03';
const PROJECT_ID_PERMITIDO = 'erp-vrmarcas';

// ───────────────────────── Lógica pura (testável) ─────────────────────────

// Mesma fidelidade do array legado: JSON.stringify já descarta `undefined`
// e converte NaN/Infinity em null — nunca reimplementa essa regra à parte,
// só reaplica o MESMO round-trip que _cloudSave() já faz para o legado.
function sanitizarParaFirestore(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// migradoEm é preservado entre reexecuções (não "pisca" a cada rodada) —
// só nasce na primeira vez que este id é visto; evidência de quando a
// migração de FATO aconteceu para aquele registro, não de quando este
// script rodou por último.
function construirDocAlvo(legadoRecord, existente) {
  var base = sanitizarParaFirestore(legadoRecord);
  base.migradoDe = legadoRecord.id;
  base.migracaoVersao = MIGRATION_VERSION;
  base.migradoEm = (existente && existente.migradoEm) ? existente.migradoEm : Date.now();
  return base;
}

function semCamposAuditoria(doc) {
  if (!doc) return doc;
  var c = Object.assign({}, doc);
  delete c.migradoDe; delete c.migradoEm; delete c.migracaoVersao;
  return c;
}

// Diferença estrutural profunda — ignora ordem de chaves (nunca string-compara
// JSON.stringify direto, que seria falso-positivo por ordem), relata CADA
// campo que diverge (caminho + os dois valores), nunca só "são diferentes".
function diffDeep(a, b, path, out) {
  path = path || ''; out = out || [];
  if (a === b) return out;
  var ta = a === null || a === undefined ? String(a) : typeof a;
  var tb = b === null || b === undefined ? String(b) : typeof b;
  if (ta !== tb || ta !== 'object') {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || '(raiz)', legado: a, v2: b });
    return out;
  }
  var isArrA = Array.isArray(a), isArrB = Array.isArray(b);
  if (isArrA !== isArrB) { out.push({ path: path || '(raiz)', legado: a, v2: b }); return out; }
  var keys = Array.from(new Set(Object.keys(a || {}).concat(Object.keys(b || {}))));
  keys.forEach(function (k) {
    diffDeep((a || {})[k], (b || {})[k], path ? (path + '.' + k) : k, out);
  });
  return out;
}

// Classifica UM registro legado contra o que (se algo) já existe em v2:
// 'criar' (nunca migrado), 'atualizar' (existe mas diverge — ex.: dual-write
// ao vivo já gravou uma versão mais nova que o backfill precisa alinhar, ou
// vice-versa), 'ok' (já em paridade — reexecução idempotente não faz nada),
// 'erro' (registro legado sem id, nunca migrável).
function classificarRegistro(legadoRecord, existenteV2) {
  if (!legadoRecord || !legadoRecord.id) return { acao: 'erro', motivo: 'registro legado sem id' };
  var alvo = construirDocAlvo(legadoRecord, existenteV2);
  if (!existenteV2) return { acao: 'criar', alvo: alvo, diffs: [] };
  var diffs = diffDeep(semCamposAuditoria(alvo), semCamposAuditoria(existenteV2));
  if (!diffs.length) return { acao: 'ok', alvo: alvo, diffs: [] };
  return { acao: 'atualizar', alvo: alvo, diffs: diffs };
}

// Plano completo: cada registro legado cai em exatamente uma categoria;
// órfãos (em v2 sem par no legado) são listados, NUNCA apagados aqui.
function planejarMigracao(legadoArr, v2PorId) {
  var plano = { criar: [], atualizar: [], ok: [], erros: [] };
  (legadoArr || []).forEach(function (rec) {
    var cls = classificarRegistro(rec, v2PorId[rec && rec.id]);
    if (cls.acao === 'erro') { plano.erros.push({ registro: rec, motivo: cls.motivo }); return; }
    var bucket = cls.acao === 'criar' ? 'criar' : (cls.acao === 'atualizar' ? 'atualizar' : 'ok');
    plano[bucket].push({ id: rec.id, num: rec.num, alvo: cls.alvo, diffs: cls.diffs });
  });
  var idsLegado = {};
  (legadoArr || []).forEach(function (r) { if (r && r.id) idsLegado[r.id] = true; });
  plano.orfaos = Object.keys(v2PorId || {}).filter(function (id) { return !idsLegado[id]; });
  return plano;
}

// Executa o plano contra um `db` (admin SDK real ou dublê de teste com a
// mesma forma mínima: db.collection(name).doc(id).set(obj) retornando Promise).
// dryRun=true nunca chama .set() — só conta o que faria.
async function executarPlano(db, plano, dryRun) {
  var resultado = { criados: 0, atualizados: 0, pulados: plano.ok.length, erros: plano.erros.length, falhasGravacao: [] };
  var acoes = plano.criar.map(function (i) { return { item: i, tipo: 'criar' }; })
    .concat(plano.atualizar.map(function (i) { return { item: i, tipo: 'atualizar' }; }));
  for (var i = 0; i < acoes.length; i++) {
    var item = acoes[i].item, tipo = acoes[i].tipo;
    if (!dryRun) {
      try {
        await db.collection('erp_vr_orcamentos').doc(item.id).set(item.alvo);
      } catch (e) {
        resultado.falhasGravacao.push({ id: item.id, erro: String(e && e.message || e) });
        continue;
      }
    }
    if (tipo === 'criar') resultado.criados++; else resultado.atualizados++;
  }
  return resultado;
}

async function carregarEstado(db) {
  var legadoDoc = await db.collection('erp_vr').doc('orcamentos').get();
  var legadoArr = [];
  if (legadoDoc.exists && legadoDoc.data() && legadoDoc.data().data) {
    try { legadoArr = JSON.parse(legadoDoc.data().data) || []; }
    catch (e) { throw new Error('erp_vr/orcamentos não é JSON válido: ' + e.message); }
  }
  var v2Snap = await db.collection('erp_vr_orcamentos').get();
  var v2PorId = {};
  v2Snap.docs.forEach(function (d) { v2PorId[d.id] = d.data(); });
  return { legadoArr: legadoArr, v2PorId: v2PorId };
}

function salvarSnapshot(dir, estado) {
  const fs = require('fs'); const path = require('path');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  var ts = new Date().toISOString().replace(/[:.]/g, '-');
  var file = path.join(dir, 'snapshot_' + ts + '.json');
  fs.writeFileSync(file, JSON.stringify({
    geradoEm: new Date().toISOString(),
    legadoCount: estado.legadoArr.length,
    v2Count: Object.keys(estado.v2PorId).length,
    legadoArr: estado.legadoArr,
    v2PorId: estado.v2PorId
  }, null, 2));
  return file;
}

function formatarRelatorio(plano, resultadoExec, dryRun) {
  var linhas = [];
  linhas.push('='.repeat(70));
  linhas.push(' migrate_orcamentos_v2.js — ' + MIGRATION_VERSION + (dryRun ? '  [DRY-RUN — nenhuma gravação]' : '  [GRAVANDO]'));
  linhas.push('='.repeat(70));
  linhas.push('Já em paridade (nenhuma ação necessária): ' + plano.ok.length);
  linhas.push((dryRun ? 'Seriam criados' : 'Criados') + ': ' + (dryRun ? plano.criar.length : resultadoExec.criados));
  linhas.push((dryRun ? 'Seriam atualizados' : 'Atualizados') + ': ' + (dryRun ? plano.atualizar.length : resultadoExec.atualizados));
  linhas.push('Órfãos em v2 (sem registro legado — NÃO tocados): ' + plano.orfaos.length);
  linhas.push('Erros de classificação: ' + plano.erros.length);
  if (resultadoExec.falhasGravacao && resultadoExec.falhasGravacao.length) {
    linhas.push('Falhas de gravação: ' + resultadoExec.falhasGravacao.length);
  }
  if (plano.atualizar.length) {
    linhas.push('\n--- Divergências detalhadas (legado × v2 existente) ---');
    plano.atualizar.forEach(function (item) {
      linhas.push('  Orçamento ' + item.id + ' (#' + item.num + '):');
      item.diffs.slice(0, 10).forEach(function (d) {
        linhas.push('    campo "' + d.path + '": legado=' + JSON.stringify(d.legado) + '  v2=' + JSON.stringify(d.v2));
      });
      if (item.diffs.length > 10) linhas.push('    ... e mais ' + (item.diffs.length - 10) + ' campo(s) divergente(s)');
    });
  }
  if (plano.orfaos.length) {
    linhas.push('\n--- Órfãos em erp_vr_orcamentos (sem correspondente no array legado) ---');
    plano.orfaos.forEach(function (id) { linhas.push('  ' + id); });
  }
  if (plano.erros.length) {
    linhas.push('\n--- Erros de classificação ---');
    plano.erros.forEach(function (e) { linhas.push('  ' + e.motivo + ': ' + JSON.stringify(e.registro).slice(0, 120)); });
  }
  if (resultadoExec.falhasGravacao && resultadoExec.falhasGravacao.length) {
    linhas.push('\n--- Falhas de gravação ---');
    resultadoExec.falhasGravacao.forEach(function (f) { linhas.push('  ' + f.id + ': ' + f.erro); });
  }
  return linhas.join('\n');
}

module.exports = {
  MIGRATION_VERSION, PROJECT_ID_PERMITIDO,
  sanitizarParaFirestore, construirDocAlvo, semCamposAuditoria, diffDeep,
  classificarRegistro, planejarMigracao, executarPlano, carregarEstado,
  salvarSnapshot, formatarRelatorio
};

// ──────────────────────────────── CLI ────────────────────────────────────
if (require.main === module) {
  (async function () {
    var args = process.argv.slice(2);
    var write = args.indexOf('--write') >= 0;
    var verify = args.indexOf('--verify') >= 0;
    var dryRun = !write || verify;

    var path = require('path');
    var { getProdApp, PROJECT_ID } = require('./_prod_admin_credential');
    if (PROJECT_ID !== PROJECT_ID_PERMITIDO) {
      console.error('[ABORTADO] projeto inesperado: ' + PROJECT_ID + ' (esperado ' + PROJECT_ID_PERMITIDO + ')');
      process.exit(1);
    }
    var db = getProdApp().firestore();

    console.log('Carregando estado atual (erp_vr/orcamentos + erp_vr_orcamentos)...');
    var estado = await carregarEstado(db);
    console.log('Legado: ' + estado.legadoArr.length + ' orçamento(s). v2 atual: ' + Object.keys(estado.v2PorId).length + ' documento(s).');

    var snapDir = path.join(__dirname, '_migracao_orcamentos_snapshots');
    var snapPath = salvarSnapshot(snapDir, estado);
    console.log('Snapshot/export salvo em: ' + snapPath);

    var plano = planejarMigracao(estado.legadoArr, estado.v2PorId);
    var resultadoExec = { criados: 0, atualizados: 0, pulados: plano.ok.length, erros: plano.erros.length, falhasGravacao: [] };
    if (!dryRun) {
      console.log('Gravando...');
      resultadoExec = await executarPlano(db, plano, false);
    }

    console.log('\n' + formatarRelatorio(plano, resultadoExec, dryRun));

    var houveProblema = plano.erros.length > 0 || plano.orfaos.length > 0 ||
      (resultadoExec.falhasGravacao && resultadoExec.falhasGravacao.length > 0);
    process.exit(houveProblema ? 1 : 0);
  })().catch(function (e) {
    console.error('[FALHA FATAL]', e);
    process.exit(1);
  });
}
