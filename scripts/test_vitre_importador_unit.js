/**
 * test_vitre_importador_unit.js
 *
 * FASE G — B12: teste UNITÁRIO puro (sem Firestore, sem Emulator) do
 * parser de planilha (scripts/vitre_importar_planilha.js) — normalizarLinha()
 * mapeia os cabeçalhos exatos da planilha real para o formato esperado
 * pela Cloud Function, incluindo números com vírgula decimal (padrão
 * brasileiro) e campos ausentes/vazios. Usa uma fixture SINTÉTICA
 * mínima criada em memória — nunca a planilha real do usuário (que não é
 * versionada por política de privacidade, ver README/relatório final).
 *
 * Uso: node scripts/test_vitre_importador_unit.js
 */
'use strict';
const { normalizarLinha } = require('./vitre_importar_planilha');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) { var g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g); }

console.log('\n=== FASE G B12 — Unitário: parser da planilha (normalizarLinha) ===\n');

test('1. Linha completa com números com ponto decimal (formato já numérico da lib XLSX)', function () {
  var r = normalizarLinha({
    'SKU': 'ABC001', 'Nome dos Produtos': 'Produto Teste', 'Espessura (mm)': 8,
    'Comprimento (cm)': 30, 'Largura (cm)': 20, 'Altura (cm)': 5,
    'Preço de Custo': 45.5, 'Preço de Venda': 99.9, 'Tamanho da Caixa de Embalagem': '35x25x10',
    'Peso (kg)': 1.2, 'Descrição': 'Descrição teste',
  });
  assertEq(r.sku, 'ABC001');
  assertEq(r.nome, 'Produto Teste');
  assertEq(r.custo, 45.5);
  assertEq(r.precoVenda, 99.9);
  assertEq(r.pesoKg, 1.2);
  assertEq(r.embalagem, '35x25x10');
});

test('2. Números vindos como texto com vírgula decimal (padrão BR) são convertidos corretamente', function () {
  var r = normalizarLinha({ 'SKU': 'DEC001', 'Nome dos Produtos': 'x', 'Preço de Custo': '45,50', 'Preço de Venda': '99,90', 'Peso (kg)': '1,2' });
  assertEq(r.custo, 45.5);
  assertEq(r.precoVenda, 99.9);
  assertEq(r.pesoKg, 1.2);
});

test('3. Campos ausentes viram null, não undefined nem NaN nem string vazia (contrato exato com a Function)', function () {
  var r = normalizarLinha({ 'SKU': 'MIN001', 'Nome dos Produtos': 'Produto Mínimo' });
  assertEq(r.custo, null);
  assertEq(r.precoVenda, null);
  assertEq(r.pesoKg, null);
  assertEq(r.embalagem, null);
  assertEq(r.descricaoCurta, null);
  assertEq(r.comprimentoCm, null);
});

test('4. Linha 100% vazia (todas as colunas null) → sku e nome ambos null (o importador real descarta essa linha antes de enviar à Function)', function () {
  var r = normalizarLinha({});
  assertEq(r.sku, null);
  assertEq(r.nome, null);
});

test('5. Espaços em branco ao redor do SKU/nome são removidos (str() faz trim)', function () {
  var r = normalizarLinha({ 'SKU': '  ESP001  ', 'Nome dos Produtos': '  Produto com espaços  ' });
  assertEq(r.sku, 'ESP001');
  assertEq(r.nome, 'Produto com espaços');
});

test('6. String "n/a" ou vazia em campo numérico não quebra o parser (vira null, não NaN)', function () {
  var r = normalizarLinha({ 'SKU': 'NA001', 'Nome dos Produtos': 'x', 'Preço de Custo': 'n/a', 'Peso (kg)': '' });
  assertEq(r.custo, null, 'texto não-numérico deve virar null, nunca NaN (NaN quebraria cálculos downstream silenciosamente)');
  assertEq(r.pesoKg, null);
});

test('7. Campos de conferência local (_lucroPlanilha/_pctLucroPlanilha) são capturados mas não fazem parte do contrato enviado à Function', function () {
  var r = normalizarLinha({ 'SKU': 'MRG001', 'Nome dos Produtos': 'x', 'Preço de Custo': 10, 'Preço de Venda': 20, 'Lucro': 10, '% Lucro': 0.5 });
  assertEq(r._lucroPlanilha, 10);
  assertEq(r._pctLucroPlanilha, 0.5);
});

console.log('\n=== resultado ===');
console.log('passed=' + passed + ' failed=' + failed);
process.exitCode = failed ? 1 : 0;
