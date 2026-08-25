/**
 * test_hotfix_pagamento_congelado_2026-08-25.js
 *
 * HOTFIX CRÍTICO — orçamento zera ao passar de APROVAÇÃO para PAGAMENTO.
 *
 * BUG relatado: no fluxo ORÇAMENTO → ENVIADO → APROVADO → CONFIRMAR
 * PAGAMENTO, reabrir o orçamento aprovado e confirmar o pagamento zerava
 * itens/cliente/total, e "Valor a Receber" mostrava R$0,00 mesmo com um
 * orçamento real de valor positivo.
 *
 * CAUSA RAIZ (achada por auditoria de código, não só reprodução): a Rodada
 * de Estabilização (Bloco B, 2026-08-23) já tinha corrigido a EXIBIÇÃO do
 * valor congelado (orcAplicarSnapshotCongelado sobrepõe o TEXTO das
 * células oi_unit_/oi_tot_/orcRsmCusto/orcRsmTotal com os valores
 * realmente enviados) — mas essa correção nunca tocou em
 * window._orcCalc (o objeto de cálculo AO VIVO, produzido por
 * orcRecalc() ao reabrir o orçamento para hidratação). Dois pontos
 * downstream continuavam lendo window._orcCalc.finalPrice diretamente:
 *
 *  1) orcPgtoAtualizarValorReceber() (index.html) — calculava "Valor a
 *     Receber" a partir do recálculo AO VIVO, nunca do valorBase
 *     realmente enviado/aprovado. Se o recálculo ao vivo divergisse do
 *     que foi enviado (config/material mudou, ou o motor de cálculo
 *     simplesmente não reproduz bit-a-bit o valor histórico), a tela
 *     mostrava um valor errado — inclusive R$0,00.
 *  2) orcConfirmarPagamentoWizard() — chamava orcSalvarOrcamento()
 *     incondicionalmente ANTES de registrar o pagamento.
 *     orcSalvarOrcamento()/_orcSalvarOrcamentoImpl() reconstrói
 *     valorFinal/valorBase/snapshotCompleto.breakdown INTEIROS a partir
 *     de window._orcCalc — ou seja, confirmar pagamento sem mudar nada
 *     sobrescrevia SILENCIOSAMENTE o orçamento já aprovado pelo cliente
 *     com os números do recálculo ao vivo. Isto é exatamente "aprovação/
 *     pagamento escrevendo por cima de campos anteriores" — não um bug de
 *     merge do Firestore, mas a etapa de pagamento persistindo de volta
 *     um recálculo que nunca deveria ter substituído o valor congelado.
 *
 * Ambos os pontos agora respeitam window._orcMostrandoCongelado (mesma
 * flag já usada por orcAplicarSnapshotCongelado/orcRecalc, Bloco B):
 * enquanto nada foi alterado desde a reabertura, usam o registro já
 * persistido (orc.valorBase para o cálculo de "Valor a Receber"; o
 * próprio registro, sem resalvar, para orcConfirmarPagamentoWizard) — só
 * voltam a recalcular/resalvar quando o operador de fato edita algo
 * (o que já quebra a flag em orcRecalc(), disparando o fluxo de revisão
 * financeira explícita já existente — orcAvaliarRevisaoFinanceira).
 *
 * Regra "ABRIR ≠ RECALCULAR" preservada: abrir um orçamento aprovado e
 * confirmar pagamento sem editar nada NUNCA muda o valor/itens
 * persistidos.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * orcPgtoAtualizarValorReceber, orcMotorComercial, orcDistribuirParcelas,
 * orcFmt, orcConfirmarPagamentoWizard.
 *
 * Uso: node "scripts/test_hotfix_pagamento_congelado_2026-08-25.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}
function extractAsyncFn(name) {
  var marker = 'async function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função async ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

console.log('\n=== HOTFIX CRÍTICO — Orçamento zera ao passar de Aprovação para Pagamento ===\n');

var FN_SRC = [
  extractFn('orcDistribuirParcelas'),
  extractFn('orcMotorComercial'),
  extractFn('orcFmt'),
  extractFn('orcPgtoAtualizarValorReceber'),
].join('\n\n') + '\n\nmodule.exports = {orcDistribuirParcelas,orcMotorComercial,orcFmt,orcPgtoAtualizarValorReceber};';
var modPath1 = path.join(__dirname, '_hotfix_pgto_congelado_valorreceber.tmp.js');
fs.writeFileSync(modPath1, FN_SRC);

function makeEl(props) { return Object.assign({ value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {} }, props || {}); }

var ORC_APROVADO_REAL = {
  id: 'ORC-57', num: '000057', cliente: 'Cliente SEBRAE', valorBase: 806.84, valorFinal: 806.84,
  status: 'aprovado', crId: 'cr123', itens: [{ prod: 'Troféu', qty: '2' }]
};

var _els1;
function reset1(opts) {
  opts = opts || {};
  _els1 = {
    orcSimMetodo: makeEl({ value: opts.metodo || 'cartao' }),
    orcSimParcelas: makeEl({ value: String(opts.nParc || 1) }),
    orcPgtoValorDisplay: makeEl(), orcSimValor: makeEl(),
    orcDescCondToggle: makeEl({ checked: false }),
    orcDescCond: makeEl({ value: '0' }),
    orcPixDiscPct: makeEl({ value: '0' }),
    orcParcSel: makeEl({ value: '1' }),
  };
  global.document = { getElementById: function (id) { return _els1[id] || null; } };
  global.window = global;
  global.orcLerCondicoesPagamentoDOM = function () { return { dcOn: false, dcPct: 0, pxOn: false, pxPct: 0 }; };
  global.orcGetEnviados = function () { return [Object.assign({}, ORC_APROVADO_REAL)]; };
  window._orcSessaoAtualId = 'ORC-57';
  // Simula o recálculo AO VIVO ter divergido/falhado ao reabrir — exatamente
  // o cenário real relatado (config mudou / material não bateu / recálculo
  // não reproduz o valor histórico).
  window._orcCalc = { finalPrice: opts.liveFinalPrice != null ? opts.liveFinalPrice : 0 };
  window._orcMostrandoCongelado = !!opts.congelado;
}

delete require.cache[require.resolve(modPath1)];
var mod1 = require(modPath1);

// 1-2 — achado real: congelado=true e recálculo ao vivo zerado (0) →
// "Valor a Receber" usa o valorBase REAL do orçamento aprovado (806.84),
// nunca R$0,00 inventado pelo recálculo ao vivo quebrado.
reset1({ congelado: true, liveFinalPrice: 0, metodo: 'cartao', nParc: 1 });
mod1.orcPgtoAtualizarValorReceber();
assertTrue(_els1.orcPgtoValorDisplay.textContent.indexOf('0,00') < 0, '1. ACHADO REAL: recálculo ao vivo zerado (0) + orçamento congelado NUNCA mostra R$0,00 — usa o valorBase real aprovado');
assertTrue(_els1.orcPgtoValorDisplay.textContent.indexOf('806,84') >= 0, '2. "Valor a Receber" reflete o valorBase realmente enviado/aprovado (R$806,84), não o recálculo ao vivo');

// 3 — mesmo cenário, mas orçamento NÃO está em modo congelado (usuário já
// editou algo) — usa o recálculo ao vivo normalmente (comportamento
// pré-existente preservado para revisão explícita).
reset1({ congelado: false, liveFinalPrice: 500, metodo: 'cartao', nParc: 1 });
mod1.orcPgtoAtualizarValorReceber();
assertTrue(_els1.orcPgtoValorDisplay.textContent.indexOf('500,00') >= 0, '3. Fora do modo congelado (edição real feita pelo operador): usa o recálculo ao vivo normalmente — nunca trava no valor antigo');

// 4 — congelado=true mas sem sessão ativa (nunca deveria acontecer nesta
// tela, mas não pode lançar exceção) — cai no recálculo ao vivo como
// fallback seguro.
reset1({ congelado: true, liveFinalPrice: 300, metodo: 'cartao', nParc: 1 });
window._orcSessaoAtualId = null;
mod1.orcPgtoAtualizarValorReceber();
assertTrue(_els1.orcPgtoValorDisplay.textContent.indexOf('300,00') >= 0, '4. Sem sessão ativa: nunca lança exceção, cai no recálculo ao vivo como fallback');

// 5 — congelado=true, orçamento aprovado tem valorBase real positivo, e o
// recálculo ao vivo TAMBÉM está correto (806.84) — resultado idêntico,
// nenhuma regressão para o caso feliz.
reset1({ congelado: true, liveFinalPrice: 806.84, metodo: 'cartao', nParc: 1 });
mod1.orcPgtoAtualizarValorReceber();
assertTrue(_els1.orcPgtoValorDisplay.textContent.indexOf('806,84') >= 0, '5. Caso feliz (recálculo ao vivo bate com o valor congelado): resultado idêntico, sem regressão');

// ── orcConfirmarPagamentoWizard — nunca resalva (recalcula) um orçamento
// aprovado quando nada foi alterado desde a reabertura ───────────────────
var FN_SRC2 = extractAsyncFn('orcConfirmarPagamentoWizard')
  + '\n\nmodule.exports = {orcConfirmarPagamentoWizard};';
var modPath2 = path.join(__dirname, '_hotfix_pgto_congelado_confirmar.tmp.js');
fs.writeFileSync(modPath2, FN_SRC2);

var _els2, _orcSalvarChamado, _registrarChamadoCom;
function reset2(opts) {
  opts = opts || {};
  _els2 = {
    orcBtnConfirmarPagamento: makeEl({ disabled: false, textContent: '' }),
    orcSimMetodo: makeEl({ value: 'pix' }),
    pgtoEntradaValWizard: makeEl({ value: '' }),
    pgtoObsWizard: makeEl({ value: '' }),
    orcNFToggle: makeEl({ checked: false }),
    orcBtnGerarOSWizard: makeEl({ disabled: true, style: {} }),
  };
  global.document = { getElementById: function (id) { return _els2[id] || null; } };
  global.window = global;
  window._orcSessaoAtualId = 'ORC-57';
  window._orcMostrandoCongelado = !!opts.congelado;
  window._orcPgtoValorEfetivo = opts.valorEfetivo != null ? opts.valorEfetivo : 806.84;
  global._pgtoTipoAtualWizard = 'integral';
  global.orcGetEnviados = function () { return [Object.assign({}, ORC_APROVADO_REAL)]; };
  _orcSalvarChamado = false;
  global.orcSalvarOrcamento = function () {
    _orcSalvarChamado = true;
    // Simula o comportamento real: reconstrói a partir do recálculo ao
    // vivo, que no cenário do bug pode divergir/zerar.
    return Promise.resolve({ id: 'ORC-57', num: '000057', valorFinal: opts.valorSeResalvar != null ? opts.valorSeResalvar : 0 });
  };
  _registrarChamadoCom = null;
  global.orcRegistrarSituacaoFinanceira = function (id, dados) {
    _registrarChamadoCom = { id: id, dados: dados };
    return Promise.resolve({ ok: true, jaConfirmado: false, dados: dados });
  };
  global.showToast = function () {};
  global.orcPgtoMostrarStatusWizard = function () {};
  global.orcPgtoBloquearEdicaoWizard = function () {};
}

delete require.cache[require.resolve(modPath2)];
var mod2 = require(modPath2);

// 6-7 — ACHADO REAL: orçamento aprovado reaberto, nada editado (congelado
//=true) → confirmar pagamento NUNCA chama orcSalvarOrcamento() (que
// resalvaria com o recálculo ao vivo, potencialmente zerado) — usa o
// registro já persistido, e registra a situação financeira com o valor
// real aprovado (806.84), nunca 0.
reset2({ congelado: true, valorEfetivo: 806.84 });
mod2.orcConfirmarPagamentoWizard().then(function () {
  assertTrue(_orcSalvarChamado === false, '6. ACHADO REAL: orçamento aprovado + nada alterado → orcSalvarOrcamento() NUNCA é chamada (não resalva/recalcula um orçamento aprovado só por confirmar o pagamento)');
  assertTrue(_registrarChamadoCom && _registrarChamadoCom.id === 'ORC-57' && _registrarChamadoCom.dados.valorEfetivo === 806.84, '7. Situação financeira é registrada com o valor real aprovado (R$806,84), nunca um valor recalculado/zerado');

  // 8-9 — quando o operador REALMENTE editou algo (congelado quebrado por
  // orcRecalc()), o comportamento de salvar/revisar continua existindo —
  // nenhuma regressão no fluxo de revisão financeira explícita.
  reset2({ congelado: false, valorEfetivo: 900, valorSeResalvar: 900 });
  return mod2.orcConfirmarPagamentoWizard().then(function () {
    assertTrue(_orcSalvarChamado === true, '8. Com edição real do operador (congelado=false): orcSalvarOrcamento() continua sendo chamada normalmente — fluxo de revisão preservado');
    assertTrue(_registrarChamadoCom && _registrarChamadoCom.dados.valorEfetivo === 900, '9. Situação financeira reflete o novo valor revisado explicitamente pelo operador');

    console.log('\n======================================================================');
    console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
    console.log('======================================================================\n');
    process.exit(failed > 0 ? 1 : 0);
  });
}).catch(function (e) {
  console.log('  ❌  Exceção inesperada no teste: ' + (e && e.stack || e));
  process.exit(1);
});
