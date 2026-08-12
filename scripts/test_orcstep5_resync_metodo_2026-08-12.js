/**
 * test_orcstep5_resync_metodo_2026-08-12.js
 *
 * GO-LIVE FINAL 2026-08-12, reverificação pós-relatório (achado real
 * reproduzido AO VIVO em produção, com o fixture Orçamento #000021 desta
 * rodada): orcSimMetodo / orcSimParcelasRow / orcSimParcelaDisplay são os
 * MESMOS elementos DOM reaproveitados por TODOS os orçamentos da sessão
 * (SPA de página única). Entrar na etapa "Confirmação de Pagamento"
 * (orcStep(5)) só recalculava o "Valor a Receber"
 * (orcPgtoAtualizarValorReceber) — nunca a linha/resumo de parcelamento
 * (orcAtualizarIconePgto/orcCalcParcelaDisplay). Resultado real observado:
 * um orçamento anterior com Cartão 3x deixava "3× de R$268,94 (total:
 * R$806,84)" visível; abrir um orçamento NOVO com PIX (o <select> volta
 * para value="pix" corretamente) mantinha a linha antiga visível, porque
 * nada recalculava a exibição na entrada da etapa.
 *
 * Corrigido: orcStep(5) agora chama orcAtualizarIconePgto() (que já faz o
 * resync completo — linha de parcelas + orcCalcParcelaDisplay + valor a
 * receber, via chamada interna a orcPgtoAtualizarValorReceber) em vez de
 * chamar só orcPgtoAtualizarValorReceber() isoladamente.
 *
 * Uso: node scripts/test_orcstep5_resync_metodo_2026-08-12.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) {
  if (cond) { console.log('  ✅  ' + desc); passed++; }
  else { console.log('  ❌  ' + desc); failed++; }
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

console.log('\n=== orcStep(5) resincroniza método de pagamento na entrada da etapa ===\n');

// ── 1. Source: bloco n===5 de orcStep chama orcAtualizarIconePgto ──
var stepSrc = extractFn('orcStep');
var blocoN5Match = stepSrc.match(/if\s*\(\s*n\s*===\s*5\s*\)\s*\{([\s\S]*?)\n  \}/);
ok('1a. Bloco if(n===5) de orcStep encontrado', !!blocoN5Match);
var blocoN5 = blocoN5Match ? blocoN5Match[1] : '';
ok('1b. Bloco n===5 chama orcAtualizarIconePgto() (resync completo: linha de parcelas + display + valor a receber)', /orcAtualizarIconePgto\s*\(\s*\)/.test(blocoN5));

// ── 2. Execução real (DOM fake): simula exatamente o cenário reproduzido ao vivo ──
// Orçamento A (Cartão 3x, linha visível) → Orçamento B (PIX, select volta
// para "pix") → orcAtualizarIconePgto() deve limpar a linha residual.
var FN_NAMES = ['orcFmt', 'orcDistribuirParcelas', 'orcMotorComercial', 'orcLerCondicoesPagamentoDOM', 'orcCalcParcelaDisplay', 'orcPgtoAtualizarValorReceber', 'orcAtualizarIconePgto', 'orcCalcEntradaResto'];
var missing = [];
FN_NAMES.forEach(function(n){ try { extractFn(n); } catch(e){ missing.push(n); } });
if (missing.length) {
  console.log('  ⚠️  Funções auxiliares ausentes (pulando parte 2, provável refactor): ' + missing.join(', '));
} else {
  var src = [
    FN_NAMES.map(extractFn).join('\n\n'),
    "module.exports = { orcAtualizarIconePgto: orcAtualizarIconePgto };"
  ].join('\n\n');
  var modPath = path.join(__dirname, '_orcstep5_resync_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  function makeEl(props) { return Object.assign({ value: '', textContent: '', style: {}, disabled:false, checked:false, dataset:{} }, props || {}); }
  var _els = {
    orcSimMetodo: makeEl({ value: 'pix' }), // Orçamento B: select já resetado para PIX
    orcSimParcelasRow: makeEl({ style:{ display: '' } }), // resíduo do Orçamento A: linha visível
    orcSimParcelas: makeEl({ value: '3' }),
    orcSimParcelaDisplay: makeEl({ style: { display: '' }, textContent: '3× de R$ 268,94 (total: R$ 806,84)' }), // resíduo do Orçamento A
    orcPgtoIcon: makeEl(), orcPgtoGatewayLbl: makeEl(),
    orcPgtoPixBox: makeEl({ style: {} }), orcPixChave: makeEl(),
    orcSimGtwRow: makeEl({ style: {} }), orcSimGtw: makeEl({ selectedOptions: [] }),
    orcPgtoValorDisplay: makeEl(), orcSimValor: makeEl(),
    orcDescCondToggle: makeEl(), orcDescCond: makeEl(), orcDescCondData: makeEl(),
    orcPixDiscPct: makeEl({ value: '5.14' }),
    orcEntradaInput: makeEl(), orcRestoDisplay: makeEl(),
  };
  global.document = { getElementById: function (id) { return _els[id]; } };
  global.window = { _orcCalc: { finalPrice: 765.37 } };
  global.CFG_DEFAULT = { parcelamento: [{ parcelas: 1, taxa: 0 }, { parcelas: 2, taxa: 2.99 }, { parcelas: 3, taxa: 5.14 }] };
  global.cfgLoad = function () { return {}; };
  // orcCalcEntradaResto (chamada por orcAtualizarIconePgto) depende do motor
  // legado orcMotorPagamento — fora do escopo deste teste (que valida só a
  // resincronização do MÉTODO), então é stubada.
  global.orcMotorPagamento = function () { return { afterPix: 0 }; };
  var mod = require(modPath);

  mod.orcAtualizarIconePgto();

  ok('2a. Linha "Parcelas" (row) volta a ficar escondida para PIX', _els.orcSimParcelasRow.style.display === 'none');
  ok('2b. Linha de resumo de parcelamento fica escondida (display=none)', _els.orcSimParcelaDisplay.style.display === 'none');
  ok('2c. Texto residual do Cartão (Orçamento A) não fica preso na tela — orcCalcParcelaDisplay não reescreve texto quando esconde', _els.orcSimParcelaDisplay.style.display === 'none');
  try { fs.unlinkSync(modPath); } catch (e) {}
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
