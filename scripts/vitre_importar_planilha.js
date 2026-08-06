/**
 * vitre_importar_planilha.js — importador da planilha real de produtos
 * Vitre (FASE G, B4). Lê a planilha, converte para o formato esperado
 * pela Cloud Function real `vitreImportarProdutos` (não reimplementa a
 * lógica de importação — só faz o parsing/normalização de arquivo).
 *
 * Uso:
 *   node scripts/vitre_importar_planilha.js <caminho.xlsx> [--apply]
 *
 * Sem --apply: dry-run (padrão) — nada é gravado, só relatório.
 * Com --apply: grava de verdade contra demo-erp-homolog (nunca produção
 * — a própria Function/ambiente já recusam qualquer projeto que não
 * comece com "demo-").
 */
'use strict';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const XLSX = require(path.join(__dirname, '..', 'functions', 'node_modules', 'xlsx'));
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-erp-homolog' });
const { vitreImportarProdutos } = require('../functions/lib/vitre.js');

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  var s = String(v).trim().replace(/\./g, '').replace(',', '.'); // "1.234,56" -> "1234.56" — só quando vier como texto
  var direto = parseFloat(String(v).replace(',', '.'));
  if (!isNaN(direto)) return direto;
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function str(v) { return (v === null || v === undefined) ? null : String(v).trim() || null; }

function lerPlanilha(caminho) {
  const wb = XLSX.readFile(caminho);
  const nomeAba = wb.SheetNames[0];
  const ws = wb.Sheets[nomeAba];
  const linhas = XLSX.utils.sheet_to_json(ws, { defval: null });
  return { nomeAba, totalLinhas: linhas.length, linhas };
}

// GO-LIVE 2026-08-06 — Etapa 1: decisões humanas aprovadas para os 4
// conflitos de SKU da planilha real (ver
// scripts/HOMOLOGACAO_P4_CONFLITOS_SKU_2026-08-06.md). Chave = SKU
// original + nome EXATO do produto (assim só a linha certa é
// renomeada, nunca a que deveria manter o SKU original). Nenhum outro
// dado comercial da linha é alterado.
const SKU_DECISOES_APROVADAS = {
  'CPC001|Cubo Porta Cápsulas': 'CPCAP001',
  'MLP001|Mesa Lateral Potenza': 'MLPT001',
  'MLR001|Mesa Lateral Rennes': 'MLRE001',
  'PPCI001|PLACA PET CATS': 'PPCAT001',
};

function normalizarLinha(raw) {
  var skuOriginal = str(raw['SKU']);
  var nome = str(raw['Nome dos Produtos']);
  var chaveDecisao = skuOriginal + '|' + nome;
  var sku = SKU_DECISOES_APROVADAS[chaveDecisao] || skuOriginal;
  return {
    sku: sku,
    nome: nome,
    espessuraMm: num(raw['Espessura (mm)']),
    comprimentoCm: num(raw['Comprimento (cm)']),
    larguraCm: num(raw['Largura (cm)']),
    alturaCm: num(raw['Altura (cm)']),
    custo: num(raw['Preço de Custo']),
    precoVenda: num(raw['Preço de Venda']),
    embalagem: str(raw['Tamanho da Caixa de Embalagem']),
    pesoKg: num(raw['Peso (kg)']),
    descricaoCurta: str(raw['Descrição']),
    // Campos só para conferência local (não fazem parte do payload da Function):
    _lucroPlanilha: num(raw['Lucro']),
    _pctLucroPlanilha: num(raw['% Lucro']),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const caminho = args.find((a) => !a.startsWith('--'));
  if (!caminho) {
    console.error('Uso: node scripts/vitre_importar_planilha.js <caminho.xlsx> [--apply]');
    process.exit(1);
  }

  console.log('[vitre-import] lendo planilha:', caminho);
  const { nomeAba, totalLinhas, linhas } = lerPlanilha(caminho);
  console.log('[vitre-import] aba:', nomeAba, '| linhas de dado (excl. cabeçalho):', totalLinhas);

  const normalizadas = linhas.map(normalizarLinha).filter((l) => l.sku || l.nome); // ignora linhas 100% vazias
  console.log('[vitre-import] linhas não-vazias:', normalizadas.length, '(', totalLinhas - normalizadas.length, 'linhas vazias ignoradas)');

  // Conferência local (não bloqueia — a Function faz a validação de verdade):
  const margemDivergente = [];
  normalizadas.forEach((l) => {
    if (l.custo != null && l.precoVenda != null && l._pctLucroPlanilha != null) {
      var margemCalculada = l.precoVenda > 0 ? (l.precoVenda - l.custo) / l.precoVenda : null;
      if (margemCalculada != null && Math.abs(margemCalculada - l._pctLucroPlanilha) > 0.01) {
        margemDivergente.push({ sku: l.sku, margemPlanilha: l._pctLucroPlanilha, margemCalculada: +margemCalculada.toFixed(4) });
      }
    }
  });
  if (margemDivergente.length) {
    console.log('[vitre-import] AVISO: ' + margemDivergente.length + ' linha(s) com % Lucro da planilha divergente do cálculo (lucro/preço) — não bloqueante, registrado para conferência humana:');
    margemDivergente.slice(0, 5).forEach((m) => console.log('   ', JSON.stringify(m)));
  }

  const requestId = 'vitre_import_' + Date.now();
  // UID real de Master do ambiente limpo (node scripts/e2e_clean_env.js
  // reset) — precisa existir em erp_vr_usuarios com funcao:'master',ativo:1.
  const { UID } = require('./e2e_shared_fixtures');
  const ctx = { auth: { uid: UID.master, token: { role: 'master' } } };

  const r = await vitreImportarProdutos.run({ linhas: normalizadas, dryRun: !apply, requestId }, ctx);
  console.log('\n=== RELATÓRIO DE IMPORTAÇÃO (' + (apply ? 'APLICADO' : 'DRY-RUN') + ') ===');
  console.log('Criados:', r.criados, '| Atualizados:', r.atualizados, '| Sem alteração:', r.semAlteracao, '| Erros:', r.erros);
  if (r.listaErros && r.listaErros.length) {
    console.log('\nErros encontrados (bloqueiam a linha, não a importação inteira):');
    r.listaErros.forEach((e) => console.log('  - [' + e.tipo + '] SKU ' + e.sku + ': ' + e.detalhe));
  }
  return r;
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { lerPlanilha, normalizarLinha };
