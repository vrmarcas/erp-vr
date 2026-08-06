/**
 * test_vitre_sku_conflitos_fixture.js
 *
 * FASE G — Parte 4 da homologação guiada: prova, com SKUs SINTÉTICOS
 * (nunca os 4 SKUs reais em conflito — CPC001/MLP001/MLR001/PPCI001,
 * ainda sem decisão humana), que:
 *   1. Duas linhas com o MESMO sku e dados diferentes continuam
 *      bloqueadas pela Function real (comportamento correto, já provado
 *      em test_vitre_catalogo_server.js — reconfirmado aqui com os
 *      dados reais dos 4 conflitos, só que sob SKU de teste).
 *   2. Se renomeadas para os SKUs sugeridos no relatório (Parte 4), as
 *      mesmas duas linhas importam SEM conflito.
 *
 * Nada disto grava nos SKUs reais nem decide a resolução — é só prova
 * técnica de que a solução sugerida funciona, para o humano decidir com
 * confiança. Usa dry-run apenas (nunca --apply).
 *
 * Uso: node scripts/test_vitre_sku_conflitos_fixture.js
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const { UID, ctx } = require('./e2e_shared_fixtures');
const { vitreImportarProdutos } = require('../functions/lib/vitre.js');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }
function reqId() { return 'req_skufix_' + Date.now() + '_' + Math.random().toString(36).slice(2); }

// Dados REAIS dos 4 conflitos (copiados literalmente do relatório Parte 4),
// só com SKU trocado para um prefixo de teste sintético.
const CONFLITOS = [
  {
    label: 'CPC001 → CPCAP001 (Caixa Porta-chás vs Cubo Porta Cápsulas)',
    skuOriginal: 'E2E_SKUFIX_CPC001',
    linha1: { sku: 'E2E_SKUFIX_CPC001', nome: 'Caixa Porta chás', espessuraMm: 4, comprimentoCm: 25, larguraCm: 15, alturaCm: 9.5, custo: 40.41, precoVenda: 210, embalagem: '28X18X16', pesoKg: 2, descricaoCurta: 'Caixa para sachês de chá' },
    linha2ComNovoSku: { sku: 'E2E_SKUFIX_CPCAP001', nome: 'Cubo Porta Cápsulas', espessuraMm: 4, comprimentoCm: 15, larguraCm: 15, alturaCm: 15.5, custo: 27, precoVenda: 140, embalagem: '20x20x20', pesoKg: 2.5, descricaoCurta: 'Cubo Porta Cápsulas' },
  },
  {
    label: 'MLP001 → MLPT001 (Mesa Lateral Pescara vs Potenza)',
    skuOriginal: 'E2E_SKUFIX_MLP001',
    linha1: { sku: 'E2E_SKUFIX_MLP001', nome: 'Mesa Lateral Pescara', espessuraMm: 10, comprimentoCm: 30, larguraCm: 40, alturaCm: 50, custo: 258.9, precoVenda: 1250, embalagem: '70x50x50', descricaoCurta: 'Mesa lateral 10mm' },
    linha2ComNovoSku: { sku: 'E2E_SKUFIX_MLPT001', nome: 'Mesa Lateral Potenza', custo: 253, precoVenda: 998 },
  },
  {
    label: 'MLR001 → MLRE001 (Mesa Lateral Ragusa vs Rennes)',
    skuOriginal: 'E2E_SKUFIX_MLR001',
    linha1: { sku: 'E2E_SKUFIX_MLR001', nome: 'Mesa Lateral Ragusa', espessuraMm: 5, comprimentoCm: 55, larguraCm: 46, alturaCm: 40, custo: 306.1, precoVenda: 1600, descricaoCurta: 'Mesa lateral 5mm e 8mm' },
    linha2ComNovoSku: { sku: 'E2E_SKUFIX_MLRE001', nome: 'Mesa Lateral Rennes', espessuraMm: 10, comprimentoCm: 50, larguraCm: 40, alturaCm: 55, custo: 237, precoVenda: 1175, embalagem: '70x50x50', pesoKg: 8.5, descricaoCurta: 'Mesa desenvolvida em acrílico cast cristal 10mm' },
  },
  {
    label: 'PPCI001 → PPCAT001 (Placa Pet Cãozinho vs Cats)',
    skuOriginal: 'E2E_SKUFIX_PPCI001',
    linha1: { sku: 'E2E_SKUFIX_PPCI001', nome: 'PLACA PET CÃOZINHO', espessuraMm: 3, comprimentoCm: 35, larguraCm: 22, custo: 37.97, precoVenda: 314, descricaoCurta: 'Aço Carbono 3mm' },
    linha2ComNovoSku: { sku: 'E2E_SKUFIX_PPCAT001', nome: 'PLACA PET CATS', espessuraMm: 3, comprimentoCm: 40, larguraCm: 40, custo: 65, precoVenda: 412, descricaoCurta: 'Aço Carbono 3mm' },
  },
];

console.log('\n=== FASE G — Parte 4: prova de resolução dos 4 conflitos de SKU (fixture sintética, dry-run apenas) ===\n');

(async function main() {
  for (const c of CONFLITOS) {
    await test('BLOQUEIO — ' + c.label + ' — mesmo SKU, dados diferentes → bloqueado', async function () {
      var linha2ComSkuOriginal = Object.assign({}, c.linha2ComNovoSku, { sku: c.skuOriginal });
      var r = await vitreImportarProdutos.run({ linhas: [c.linha1, linha2ComSkuOriginal], dryRun: true, requestId: reqId() }, ctx(UID.master, 'master'));
      assertEq(r.criados, 0, 'nenhum dos dois deve ser criado enquanto o SKU colide');
      var achouConflito = r.listaErros.some(function (e) { return e.tipo === 'sku_duplicado_conflitante' && e.sku === c.skuOriginal; });
      if (!achouConflito) throw new Error('esperava sku_duplicado_conflitante para ' + c.skuOriginal);
    });

    await test('RESOLUÇÃO — ' + c.label + ' — SKUs distintos (sugestão do relatório) → ambos importam sem conflito', async function () {
      var r = await vitreImportarProdutos.run({ linhas: [c.linha1, c.linha2ComNovoSku], dryRun: true, requestId: reqId() }, ctx(UID.master, 'master'));
      assertEq(r.criados, 2, 'com SKUs distintos, as duas linhas devem ser válidas para criação');
      var teveConflito = r.listaErros.some(function (e) { return e.tipo === 'sku_duplicado_conflitante'; });
      assertEq(teveConflito, false, 'não deve haver conflito de SKU depois da renomeação sugerida');
    });
  }

  console.log('\n=== resultado ===');
  console.log('passed=' + passed + ' failed=' + failed);
  console.log('\nNADA foi gravado — todas as chamadas usaram dryRun:true. Os SKUs reais');
  console.log('(CPC001/MLP001/MLR001/PPCI001) seguem bloqueados no catálogo real,');
  console.log('aguardando decisão humana (ver scripts/HOMOLOGACAO_P4_CONFLITOS_SKU_2026-08-06.md).');
  process.exitCode = failed ? 1 : 0;
})();
