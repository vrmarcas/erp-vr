/**
 * test_nf_financeiro_2026-08-08.js
 *
 * RODADA 4 — seção 6: Nota Fiscal completada no Financeiro. Testa as
 * funções REAIS extraídas de index.html (relFiscalDivergeValor/
 * relFiscalRegistrarEmissao/relFiscalRecebidoDoOrc), cobrindo: venda ×
 * recebido × NF como três valores distintos, divergência exige
 * justificativa + audita, a NF nunca altera o valor da venda.
 *
 * Uso: node scripts/test_nf_financeiro_2026-08-08.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, got, expected) {
  var g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

// HOTFIX BLOCO G (Rodada de Hardening, Fase 2, 2026-08-26) — ambas passaram
// a normalizar o orçamento via orcEnvNormalizar() (schema legado × ValerIA), nunca reimplementada.
var FN_NAMES = ['relFiscalDivergeValor', 'relFiscalRegistrarEmissao', 'relFiscalRecebidoDoOrc', 'orcEnvNormalizar'];
var src = [
  'var FIN_CR = []; var KB_OS = {};',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  diverge: relFiscalDivergeValor, registrarEmissao: relFiscalRegistrarEmissao, recebidoDoOrc: relFiscalRecebidoDoOrc,',
  '  setCR: function(v){ FIN_CR = v; }, setKbOs: function(v){ KB_OS = v; },',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_nf_financeiro_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 4 — Nota Fiscal no Financeiro: venda × recebido × NF, divergência auditada ===\n');

// ── divergência ─────────────────────────────────────────────────────────
test('1. mesmo valor não é divergência', mod.diverge(1000, 1000), false);
test('2. diferença de 1 centavo (arredondamento) não é divergência', mod.diverge(1000, 1000.004), false);
test('3. diferença real (R$50) é divergência', mod.diverge(1000, 950), true);
test('4. valorEmitido não numérico nunca é divergência (guarda defensiva)', mod.diverge(1000, NaN), false);

// ── registrar emissão — validações ─────────────────────────────────────
{
  var orc = { id: 'orc1', num: '10', valorFinal: 1000 };
  var r1 = mod.registrarEmissao(orc, { numero: '', valorEmitido: 1000 });
  test('5. número da NF é obrigatório', r1.ok, false);
  test('6. erro correto para número ausente', r1.erro, 'NUMERO_OBRIGATORIO');

  var r2 = mod.registrarEmissao(orc, { numero: '123', valorEmitido: 'abc' });
  test('7. valor emitido inválido (não numérico) é rejeitado', r2.ok, false);

  var r3 = mod.registrarEmissao(orc, { numero: '123', valorEmitido: 800 });
  test('8. valor emitido divergente SEM justificativa é rejeitado', r3.ok, false);
  test('9. erro correto para divergência sem justificativa', r3.erro, 'JUSTIFICATIVA_DIVERGENCIA_OBRIGATORIA');
  test('10. rejeitar por falta de justificativa NÃO grava nada no orçamento (nunca decide sozinho)', orc.numeroNF, undefined);
}

// ── registrar emissão — sucesso sem divergência ────────────────────────
{
  var orc = { id: 'orc2', num: '11', valorFinal: 2000 };
  var r = mod.registrarEmissao(orc, { numero: 'NF-001', valorEmitido: 2000, chave: '', observacao: '', usuario: 'financeiro@vr.com' });
  test('11. emissão sem divergência é aceita', r.ok, true);
  test('12. NF não é marcada como divergente', orc.divergenciaNF, false);
  test('13. valor da VENDA nunca é alterado pela emissão da NF', orc.valorFinal, 2000);
  test('14. valorSolicitadoNF grava o valor da venda no momento da emissão', orc.valorSolicitadoNF, 2000);
  test('15. valorEmitidoNF grava o valor informado', orc.valorEmitidoNF, 2000);
}

// ── registrar emissão — sucesso COM divergência (auditada) ────────────
{
  var orc = { id: 'orc3', num: '12', valorFinal: 5000 };
  var r = mod.registrarEmissao(orc, { numero: 'NF-002', valorEmitido: 4500, justificativaDivergencia: 'desconto comercial não refletido na NF por erro do contador', chave: 'CHAVE123', observacao: 'nota corrigida manualmente', usuario: 'master@vr.com' });
  test('16. emissão divergente COM justificativa é aceita', r.ok, true);
  test('17. flag de divergência fica marcada', orc.divergenciaNF, true);
  test('18. justificativa é gravada (auditoria)', orc.divergenciaNFJustificativa, 'desconto comercial não refletido na NF por erro do contador');
  test('19. auditoria grava o usuário responsável', orc.divergenciaNFAuditoria.usuario, 'master@vr.com');
  test('20. auditoria grava timestamp', typeof orc.divergenciaNFAuditoria.ts, 'number');
  test('21. venda (R$5000) permanece intacta mesmo com NF divergente (R$4500)', orc.valorFinal, 5000);
  test('22. chave de acesso da NF-e é gravada', orc.chaveNF, 'CHAVE123');
  test('23. observação é gravada', orc.observacaoNF, 'nota corrigida manualmente');
}

// ── venda × recebido × NF — três valores distintos ─────────────────────
{
  mod.setKbOs({});
  mod.setCR([
    { id: 'cr1', orcamentoId: 'orcX', status: 'recebido', valor: 300 },
    { id: 'cr2', orcamentoId: 'orcX', status: 'pendente', valor: 200 }, // não conta — só recebido
    { id: 'cr3', orcamentoId: 'orcOutro', status: 'recebido', valor: 999 }, // de outro orçamento — nunca soma aqui
  ]);
  var orc = { id: 'orcX', num: '20', valorFinal: 500 };
  test('24. Recebido soma só os registros DESTE orçamento com status=recebido (R$300, ignora pendente e outro orçamento)', mod.recebidoDoOrc(orc), 300);
  var rEmissao = mod.registrarEmissao(orc, { numero: 'NF-X', valorEmitido: 500, usuario: 'financeiro@vr.com' });
  test('25. Venda (500) × Recebido (300) × NF (500) continuam três valores DISTINTOS após emitir a NF', { venda: orc.valorFinal, recebido: mod.recebidoDoOrc(orc), nf: orc.valorEmitidoNF }, { venda: 500, recebido: 300, nf: 500 });
}

// ── fallback legado por osRef (lançamentos antigos sem orcamentoId) ────
{
  mod.setKbOs({ os9: { id: 'os9', num: '77' } });
  mod.setCR([{ id: 'crLeg', status: 'recebido', valor: 150, osRef: 'ORC-30' }]);
  var orcLegado = { id: 'orcLeg', num: '30', valorFinal: 150 };
  test('26. Recebido usa fallback "ORC-N" para lançamentos antigos sem orcamentoId gravado', mod.recebidoDoOrc(orcLegado), 150);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
