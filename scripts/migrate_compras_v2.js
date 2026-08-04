#!/usr/bin/env node
/**
 * migrate_compras_v2.js
 *
 * Migração idempotente do array legado erp_vr/compras (uma "tabela"
 * inteira num único documento) para a estrutura documento-por-registro
 * erp_vr_compras/{id} (ver functions/src/compras.ts e relatório de
 * homologação — bloqueador arquitetural).
 *
 * SEGURANÇA: só roda contra projectId iniciado por "demo-" (mesma trava
 * fail-closed do app). Recusa-se a rodar contra qualquer outro projeto,
 * mesmo se as credenciais apontarem para ele. Aditiva — nunca apaga ou
 * modifica o documento legado erp_vr/compras; "rollback" é simplesmente
 * apagar os documentos novos criados por esta migração (nenhum dado
 * antigo é tocado).
 *
 * Idempotente: cada compra migrada grava `migradoDe: <id-legado>` no novo
 * documento; uma segunda execução detecta os já migrados (por
 * migradoDe) e pula — não duplica. Testado neste round rodando 2x
 * seguidas contra o mesmo estado do emulador.
 *
 * Uso:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate_compras_v2.js --project demo-erp-homolog [--dry-run]
 */
'use strict';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projIdx = args.indexOf('--project');
const projectId = projIdx >= 0 ? args[projIdx + 1] : null;

if (!projectId || !/^demo-/.test(projectId)) {
  console.error('[ABORTADO] --project deve ser fornecido e começar com "demo-". Recebido: ' + projectId);
  process.exit(1);
}
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('[ABORTADO] FIRESTORE_EMULATOR_HOST não definido — esta migração só roda contra o emulador, nunca contra Firestore real.');
  process.exit(1);
}

process.env.GCLOUD_PROJECT = projectId;
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

const MIGRATION_VERSION = 'compras_v2_2026-08-04';

async function main() {
  console.log('='.repeat(70));
  console.log(' migrate_compras_v2.js — ' + MIGRATION_VERSION);
  console.log(' project: ' + projectId + (dryRun ? '  [DRY-RUN — nenhuma gravação]' : ''));
  console.log('='.repeat(70));

  const legacyDoc = await db.collection('erp_vr').doc('compras').get();
  if (!legacyDoc.exists) {
    console.log('Nenhum documento legado erp_vr/compras encontrado — nada a migrar.');
    return { migrados: 0, jaMigrados: 0, duplicatasDetectadas: 0, erros: 0 };
  }
  let legacyArr = [];
  try { legacyArr = JSON.parse(legacyDoc.data().data || '[]'); } catch (e) {
    console.error('[ERRO] erp_vr/compras não é JSON válido:', e.message);
    return { migrados: 0, jaMigrados: 0, duplicatasDetectadas: 0, erros: 1 };
  }
  console.log('Registros legados encontrados: ' + legacyArr.length);

  const jaMigradosSnap = await db.collection('erp_vr_compras').where('migradoDe', '!=', null).get();
  const jaMigradosIds = new Set(jaMigradosSnap.docs.map((d) => d.data().migradoDe));
  console.log('Já migrados anteriormente (detectado por migradoDe): ' + jaMigradosIds.size);

  let migrados = 0, jaMigrados = 0, duplicatasDetectadas = 0, erros = 0;
  const relatorioLinhas = [];

  for (const pc of legacyArr) {
    if (!pc || !pc.id) { erros++; relatorioLinhas.push(`ERRO: registro sem id — ${JSON.stringify(pc).slice(0,80)}`); continue; }
    if (jaMigradosIds.has(pc.id)) {
      jaMigrados++;
      relatorioLinhas.push(`SKIP (já migrado): ${pc.id} #${pc.numero}`);
      continue;
    }
    // Detecção de duplicidade adicional: mesmo número + mesmo criadoEm já migrado sob outro id legado (defensivo)
    const dupCheck = await db.collection('erp_vr_compras')
      .where('numero', '==', pc.numero || null).limit(5).get();
    const dupReal = dupCheck.docs.some((d) => d.data().migradoDe && d.data().migradoDe !== pc.id);
    if (dupReal) {
      duplicatasDetectadas++;
      relatorioLinhas.push(`DUPLICATA DETECTADA (não migrado): ${pc.id} #${pc.numero} — já existe outro registro com o mesmo número`);
      continue;
    }

    const novoDoc = {
      id: pc.id,
      migradoDe: pc.id,
      migradoEm: Date.now(),
      migracaoVersao: MIGRATION_VERSION,
      numero: pc.numero || null,
      status: pc.status || 'solicitada',
      itens: (pc.itens || []).map((it) => ({
        material: it.material || null, label: it.label || '', qtyNecessaria: it.qtyNecessaria || 0,
        unidade: it.unidade || 'un', matKeyConfianca: it.matKeyConfianca || 'nenhuma',
        precoUnit: it.precoUnit || 0,
      })),
      fornecedorEscolhido: pc.fornecedorEscolhido || null,
      marca: pc.marca || 'vr',
      origem: pc.origem || null,
      criadoPorUid: null, // legado não tinha uid — só nome em pc.responsavel
      criadoPorNomeLegado: pc.responsavel || null,
      criadoEm: pc.criadoEm ? Date.parse(pc.criadoEm) || Date.now() : Date.now(),
      aprovadoPorUid: null,
      aprovadoEm: null,
      canceladoPorUid: null,
      canceladoEm: null,
      motivoCancelamento: pc.cancelJustificativa || null,
      qtyRecebidaTotal: (pc.recebimentos || []).reduce((s, r) => s + (r.qtyRecebida || r.valorRecebido || 0), 0),
      obrigacaoProvisoriaId: pc.obrigacaoProvisoriaId || null,
    };

    if (!dryRun) {
      await db.collection('erp_vr_compras').doc().set(novoDoc);
    }
    migrados++;
    relatorioLinhas.push(`${dryRun ? '[DRY-RUN] MIGRARIA' : 'MIGRADO'}: ${pc.id} #${pc.numero} (status=${novoDoc.status})`);
  }

  console.log('\n' + relatorioLinhas.join('\n'));
  console.log('\n' + '-'.repeat(70));
  console.log(`RELATÓRIO: ${migrados} migrados, ${jaMigrados} já migrados (pulados), ${duplicatasDetectadas} duplicatas detectadas e NÃO migradas, ${erros} erros.`);
  console.log('-'.repeat(70));
  return { migrados, jaMigrados, duplicatasDetectadas, erros };
}

main().then((r) => {
  process.exit(r.erros > 0 ? 1 : 0);
}).catch((e) => {
  console.error('[FALHA FATAL]', e);
  process.exit(1);
});
