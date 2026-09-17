/**
 * fix_precos_vitre_moldura_buques_2026-09-17.js — Rodada funcional (Bloco 5).
 *
 * Remove dos preços-base da categoria "Moldura Buquês" (coleção
 * `vitre_produtos`) os 5,14% de taxa de maquininha que já estavam embutidos
 * (gross-up: precoAtual = precoOriginal / (1 - 0.0514)), substituindo
 * diretamente pelos 20 valores originais do catálogo informados pelo
 * usuário em 2026-09-17. NÃO faz `precoAtual * 0.9486` — os valores abaixo
 * são os originais do catálogo físico, usados como fonte de verdade.
 *
 * Validado por dry-run: 19 dos 20 batem com precisão de centavos contra a
 * fórmula reversa (preçoBase / 0.9486 ≈ preço salvo hoje). O item #8
 * (30×25×10 + bordas + placa espelhada, ID MM30X25X10FBE) estava gravado
 * com R$442,76 — o MESMO valor do item #11 (outra variante, 35×30×13),
 * sugerindo erro de cadastro pré-existente, não gross-up. Usuário confirmou
 * usar o valor-base informado (R$324,00) diretamente.
 *
 * Também corrige 2 pares de SKUs duplicados (CSM001≡CSM40X30X13 e
 * CSM002≡CSM30X25X10, mesmo nome/preço nos 2 documentos) — usuário
 * confirmou corrigir os 2 IDs de cada par, não deixar um desatualizado.
 *
 * Uso:
 *   node scripts/fix_precos_vitre_moldura_buques_2026-09-17.js dry-run
 *   node scripts/fix_precos_vitre_moldura_buques_2026-09-17.js apply
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getProdApp } = require('./_prod_admin_credential');

const SNAPSHOT_DIR = '/private/tmp/claude-501/-Users-gbsgabriel-Desktop-ERP-VR---go-live/3943a008-ec85-42d9-b1d9-fe0d28818a3e/scratchpad';

// id → { nome (p/ conferência), precoBaseNovo }
const PRECOS_BASE = {
  CSM002:          { nome: 'Caixa sem moldura 30×25×10',                                   novo: 105.00 },
  CSM30X25X10:     { nome: 'Caixa sem moldura 30×25×10 (SKU duplicado)',                    novo: 105.00 },
  CSM001:          { nome: 'Caixa sem moldura 40×30×13',                                   novo: 168.00 },
  CSM40X30X13:     { nome: 'Caixa sem moldura 40×30×13 (SKU duplicado)',                    novo: 168.00 },
  MM25X20X10:      { nome: 'Moldura Minimalista 25×20×10',                                 novo: 192.00 },
  MM25X20X10FE:    { nome: '25×20×10 + placa espelhada',                                   novo: 225.00 },
  MM25X20X10FBE:   { nome: '25×20×10 + bordas + placa espelhada',                          novo: 235.00 },
  MM30X25X10:      { nome: 'Moldura Minimalista 30×25×10',                                 novo: 269.00 },
  MM30X25X10FE:    { nome: '30×25×10 + placa espelhada',                                   novo: 317.00 },
  MM30X25X10FBE:   { nome: '30×25×10 + bordas + placa espelhada (preço anterior divergente)', novo: 324.00 },
  MM35X30X13:      { nome: 'Moldura Minimalista 35×30×13',                                 novo: 335.00 },
  MM35X30X13FE:    { nome: '35×30×13 + placa espelhada',                                   novo: 410.00 },
  MM35X30X13FBE:   { nome: '35×30×13 + bordas + placa espelhada',                          novo: 420.00 },
  MM40X30X13:      { nome: 'Moldura Minimalista 40×30×13',                                 novo: 342.00 },
  MM40X30X13FE:    { nome: '40×30×13 + placa espelhada',                                   novo: 416.00 },
  MM40X30X13FBE:   { nome: '40×30×13 + bordas + placa espelhada',                          novo: 426.00 },
  RCFELD4030138:   { nome: 'Redoma cristal fundo espelhado + laterais diferentes 40×30×13×8', novo: 386.00 },
  RC272732:        { nome: 'Redoma cristal 27×27×32A',                                     novo: 398.00 },
  RC242428:        { nome: 'Redoma cristal 24×24×28A',                                     novo: 327.00 },
  RC202030:        { nome: 'Redoma cristal 20×20×30A',                                     novo: 270.00 },
  RCFE403013:      { nome: 'Redoma cristal fundo espelhado 40×30×13',                      novo: 392.00 },
  RCFE302510:      { nome: 'Redoma cristal fundo espelhado 30×25×10',                      novo: 274.00 },
};

async function main() {
  const mode = process.argv[2];
  if (mode !== 'dry-run' && mode !== 'apply') {
    console.log('Uso: node scripts/fix_precos_vitre_moldura_buques_2026-09-17.js <dry-run|apply>');
    process.exitCode = 1;
    return;
  }

  const db = getProdApp().firestore();
  const col = db.collection('vitre_produtos');

  const ids = Object.keys(PRECOS_BASE);
  const docs = {};
  for (const id of ids) {
    const snap = await col.doc(id).get();
    if (!snap.exists) { console.log('[fix-vitre] AVISO: documento ' + id + ' não existe mais — pulando.'); continue; }
    docs[id] = snap.data();
  }

  if (mode === 'apply') {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const snapPath = path.join(SNAPSHOT_DIR, 'snapshot_pre_fix_vitre_moldura_buques_2026-09-17.json');
    fs.writeFileSync(snapPath, JSON.stringify(docs, null, 2));
    console.log('[fix-vitre] snapshot de rollback salvo em: ' + snapPath + '\n');
  }

  console.log('SKU'.padEnd(16) + 'NOME ERP'.padEnd(50) + 'PRECO ATUAL'.padEnd(14) + 'PRECO NOVO'.padEnd(12) + 'VARIACAO');
  let algumaDivergenciaInesperada = false;
  ids.forEach((id) => {
    const d = docs[id];
    if (!d) return;
    const atual = Number(d.precoVenda);
    const novo = PRECOS_BASE[id].novo;
    const variacao = atual ? (((novo - atual) / atual) * 100).toFixed(1) + '%' : '—';
    console.log(
      id.padEnd(16) + String(d.nome || '').slice(0, 48).padEnd(50) +
      ('R$' + atual.toFixed(2)).padEnd(14) + ('R$' + novo.toFixed(2)).padEnd(12) + variacao
    );
  });

  if (mode === 'dry-run') {
    console.log('\n[fix-vitre] dry-run OK — nada foi escrito.');
    return;
  }

  console.log('\n[fix-vitre] APLICANDO...');
  for (const id of ids) {
    if (!docs[id]) continue;
    await col.doc(id).update({ precoVenda: PRECOS_BASE[id].novo });
    console.log('  ' + id + ' → R$' + PRECOS_BASE[id].novo.toFixed(2));
  }
  console.log('[fix-vitre] gravação concluída.\n');

  console.log('[fix-vitre] auditoria pós-apply...');
  for (const id of ids) {
    const snap = await col.doc(id).get();
    if (!snap.exists) continue;
    const d = snap.data();
    const ok = Number(d.precoVenda) === PRECOS_BASE[id].novo;
    console.log('  ' + id + ': ' + d.precoVenda + (ok ? ' OK' : ' *** DIVERGENTE ***'));
  }
  console.log('\n[fix-vitre] CONCLUÍDO.');
}

main().catch((e) => { console.error('[fix-vitre] ERRO:', e); process.exitCode = 1; });
