/**
 * seed_contas_bancarias_bradesco_itau_2026-08-08.js
 *
 * RODADA 3 — seção 8: cadastra Bradesco e Itaú na fonte canônica única de
 * contas bancárias já existente no ERP (erp_vr/erp_bank_config, lida pelo
 * frontend via bankListFor()/_BANK_DATA — ver index.html). Não cria um
 * sistema novo: essa infraestrutura já existe e já alimenta os seletores de
 * Contas a Receber/Pagar (finPopularContas) e o gateway PIX do orçamento
 * (orcPopularBancos/orcGetBancoPrincipal).
 *
 * NÃO inventa agência, número de conta, titular, CNPJ ou saldo — esses
 * campos ficam vazios ('') e null (saldoInicial), significando "não
 * informado", nunca "zero real". A marca alvo é 'vr' (o pacote histórico é
 * exclusivamente da VR Marcas — ver manifesto_importacao.json).
 *
 * Idempotente: se já existir uma conta com nome 'Bradesco' ou 'Itaú' (case-
 * insensitive) em erp_bank_config.vr, não duplica.
 *
 * Uso:
 *   node scripts/seed_contas_bancarias_bradesco_itau_2026-08-08.js                                        → dry-run
 *   node scripts/seed_contas_bancarias_bradesco_itau_2026-08-08.js --apply --confirm-project=erp-vrmarcas → aplica em produção
 *   node scripts/seed_contas_bancarias_bradesco_itau_2026-08-08.js --mock                                 → contra o Emulator
 */
'use strict';
const path = require('path');

const APPLY = process.argv.includes('--apply');
const MOCK = process.argv.includes('--mock');
const CONFIRM_PROJECT = process.argv.includes('--confirm-project=erp-vrmarcas');
const EXPECTED_PROJECT = 'erp-vrmarcas';

if (MOCK) process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) {
  admin.initializeApp({ projectId: MOCK ? 'demo-erp-homolog' : EXPECTED_PROJECT });
}
const db = admin.firestore();

function bankUid(seed) { return 'seed_' + seed + '_' + Date.now().toString(36); }

async function main() {
  if (APPLY && !MOCK && !CONFIRM_PROJECT) {
    console.error('[seed_contas_bancarias] --apply exige também --confirm-project=erp-vrmarcas (proteção contra rodar no projeto errado).');
    process.exitCode = 1;
    return;
  }

  const ref = db.collection('erp_vr').doc('erp_bank_config');
  const snap = await ref.get();
  const data = (snap.exists && snap.data() && snap.data().data) ? JSON.parse(snap.data().data) : {};
  const vrLista = Array.isArray(data.vr) ? data.vr.slice() : [];

  const existentes = vrLista.map(function (b) { return (b.nome || '').trim().toLowerCase(); });
  const faltando = ['Bradesco', 'Itaú'].filter(function (nome) { return existentes.indexOf(nome.toLowerCase()) < 0; });

  console.log('[seed_contas_bancarias] contas VR já cadastradas: ' + (vrLista.map(function (b) { return b.nome; }).join(', ') || '(nenhuma)'));
  console.log('[seed_contas_bancarias] faltando adicionar: ' + (faltando.join(', ') || '(nenhuma — já completo, idempotente)'));

  if (!faltando.length) {
    console.log('[seed_contas_bancarias] nada a fazer.');
    return;
  }

  faltando.forEach(function (nome) {
    vrLista.push({
      id: bankUid(nome.toLowerCase()),
      nome: nome,
      tipo: 'corrente',
      agencia: '',
      conta: '',
      titular: '',
      doc: '',
      pix: '',
      pixTipo: 'cpf',
      principal: false,
      saldoInicial: null, // null = não informado (nunca declarar saldo real 0 sem confirmação)
    });
  });

  data.vr = vrLista;

  if (!APPLY) {
    console.log('[seed_contas_bancarias] DRY-RUN — nada foi gravado. Rode com --apply' + (MOCK ? ' --mock' : ' --confirm-project=erp-vrmarcas') + ' para aplicar.');
    console.log(JSON.stringify(faltando.map(function (n) { return vrLista.find(function (b) { return b.nome === n; }); }), null, 2));
    return;
  }

  await ref.set({ data: JSON.stringify(data), ts: Date.now() });
  console.log('[seed_contas_bancarias] APLICADO — ' + faltando.length + ' conta(s) adicionada(s): ' + faltando.join(', '));
}

main().catch(function (e) { console.error('[seed_contas_bancarias] ERRO:', e); process.exitCode = 1; });
