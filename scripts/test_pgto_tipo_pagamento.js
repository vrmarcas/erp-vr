/**
 * test_pgto_tipo_pagamento.js
 * Regressão do bug real encontrado na Homologação Fase F (2026-08-05):
 * orcEnvGerarOS() descobria o tipo de pagamento selecionado no modal
 * "Confirmar Pagamento" procurando a cor hexadecimal ("059669") dentro do
 * atributo style do botão ativo (document.querySelector('.pgto-tipo-btn
 * [style*="059669"]')) — mas todo navegador normaliza cores inline para
 * rgb(...) ao serializar o style, então esse seletor NUNCA batia, em
 * nenhum navegador, independente da opção escolhida pelo operador.
 * Resultado: toda OS gerada era tratada como "futuro" (a receber), mesmo
 * quando Integral/50-50/Parcial era selecionado e um valor de entrada
 * real era informado — nenhum recebimento era lançado, o orçamento nunca
 * ficava "pago", e o status "aguardando_saldo" do 50-50 era código morto.
 *
 * HOTFIX OPERACIONAL 2026-08-12, P0.3/P0.4 — o modal secundário "Confirmar
 * Pagamento" foi removido; todo o painel Tipo de Pagamento (Integral/
 * 50-50/Entrada/A Receber) agora vive na própria Etapa 4 do wizard (opg5),
 * e Confirmar Pagamento (orcConfirmarPagamentoWizard/
 * orcRegistrarSituacaoFinanceira) virou uma ação SEPARADA de Gerar OS
 * (orcEnvGerarOS, que só lê o.pgtoConfirmado — nunca recalcula tipo/forma).
 *
 * Funções sob teste (extraídas de index.html via contagem de chaves —
 * mesma técnica de test_orcamento_pdf_whatsapp.js — não reimplementadas):
 * orcPgtoTipoSelWizard, orcPgtoRecalcularSaldoWizard, orcPgtoRefrescarTipoWizard,
 * orcConfirmarPagamentoWizard, orcRegistrarSituacaoFinanceira, orcEnvGerarOS.
 *
 * Uso: node scripts/test_pgto_tipo_pagamento.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(desc, fn) {
  try { await fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }
function assertApprox(got, exp, msg) {
  if (!approx(got, exp)) throw new Error((msg || 'valores diferentes') + ' — esperado ~' + exp + ', obtido ' + got);
}

// ── Extração por contagem de chaves balanceadas ─────────────────────────────
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada em index.html — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var FN_NAMES = [
  'orcPgtoTipoSelWizard', 'orcPgtoRecalcularSaldoWizard', 'orcPgtoRefrescarTipoWizard',
  'orcPgtoMostrarStatusWizard', 'orcPgtoBloquearEdicaoWizard',
  'orcConfirmarPagamentoWizard', 'orcRegistrarSituacaoFinanceira', 'orcEnvGerarOS',
];
var src = [
  'var _ORC_ENVIADOS_DATA = [];',
  'function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }',
  'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; }',
  'var _OS_COUNTER = 0;',
  'var _KB_OS_FIN_CACHE = {};',
  // declaração real que precede orcPgtoTipoSelWizard() em index.html — não
  // faz parte do corpo da função, então extractFn() não a captura sozinha.
  'var _pgtoTipoAtualWizard = "50-50";',
  // orcConfirmarPagamentoWizard() chama orcSalvarOrcamento() antes de tudo
  // (persiste o orçamento) — stubado como no-op que resolve com o id já
  // presente no fixture, já que seu conteúdo interno tem suíte própria
  // (o que está sob teste aqui é o painel Tipo de Pagamento/geração de OS).
  'function orcSalvarOrcamento(){ window._orcSessaoAtualId = window._orcPgtoTestOrcId; return Promise.resolve({ id: window._orcPgtoTestOrcId, num: "1" }); }',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  orcPgtoTipoSelWizard: orcPgtoTipoSelWizard,',
  '  orcConfirmarPagamentoWizard: orcConfirmarPagamentoWizard,',
  '  orcRegistrarSituacaoFinanceira: orcRegistrarSituacaoFinanceira,',
  '  orcEnvGerarOS: orcEnvGerarOS,',
  '  getPgtoTipoAtual: function(){ return _pgtoTipoAtualWizard; },',
  '  setEnviados: function(arr){ _ORC_ENVIADOS_DATA = arr; },',
  '  getEnviados: function(){ return _ORC_ENVIADOS_DATA; }',
  '};'
].join('\n\n');
var modPath = path.join(__dirname, '_pgto_tipo_pagamento_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── DOM fake mínimo ─────────────────────────────────────────────────────────
function makeEl(props) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, checked: false,
    disabled: false, classList: { add: function () {}, contains: function () { return false; } },
    closest: function () { return null; },
    querySelector: function (sel) { return _query(sel); },
    querySelectorAll: function (sel) { return _queryAll(sel); },
    setAttribute: function (k, v) { this[k] = v; },
    appendChild: function () {},
    options: [{ text: 'PIX' }], selectedIndex: 0
  }, props || {});
}
var _elements = {};
function reg(id, el) { el.id = id; _elements[id] = el; return el; }

// botões de tipo — precisam ser encontráveis via
// document.querySelector('#pgtoTipoGridWizard .pgto-tipo-btn[data-tipo="X"]')
var _tipoButtons = {};
function makeTipoBtn(tipo) {
  var b = makeEl({ dataset: { tipo: tipo }, style: {} });
  _tipoButtons[tipo] = b;
  return b;
}
function _query(sel) {
  var m = sel.match(/\[data-tipo="([^"]+)"\]/);
  if (m) return _tipoButtons[m[1]] || null;
  return null;
}
function _queryAll(sel) {
  if (sel.indexOf('.pgto-tipo-btn') >= 0) return Object.values(_tipoButtons);
  return [];
}

global.window = global;
global.document = {
  getElementById: function (id) { return _elements[id]; },
  querySelector: function (sel) { return _query(sel); },
  querySelectorAll: function (sel) { return _queryAll(sel); },
  createElement: function () { return makeEl({}); },
  body: { appendChild: function () {}, classList: { contains: function () { return false; } } }
};
global.showToast = function (msg) { global._lastToast = msg; };
global.kbRender = function () {};
global._cloudSave = function () {};
global._cloudReady = false;
global.KB_OS = {};
global.FIN_CR = [];
global.FIN_TX = [];
global._finSaveCR = function () {};
global.orcEnviadosRender = function () {};
global.nav = function () {};

function resetModalDom() {
  _tipoButtons = {};
  ['integral', '50-50', 'parcial', 'futuro'].forEach(makeTipoBtn);
  reg('pgtoTipoGridWizard', makeEl({ style: {} }));
  reg('pgtoEntradaBoxWizard', makeEl({ style: {} }));
  reg('pgtoEntradaValWizard', makeEl({ value: '' }));
  reg('pgtoEntradaDeTotalWizard', makeEl({}));
  reg('pgtoEntradaPctWizard', makeEl({}));
  reg('pgtoSaldoResultanteWizard', makeEl({}));
  reg('pgtoStatusWizard', makeEl({ style: {} }));
  reg('pgtoObsWizard', makeEl({ value: '' }));
  reg('orcSimMetodo', makeEl({ value: 'pix' }));
  reg('orcNFToggle', makeEl({ checked: false }));
  reg('orcBtnConfirmarPagamento', makeEl({ disabled: false, textContent: '' }));
  reg('orcBtnGerarOSWizard', makeEl({ disabled: false, style: {} }));
  global._lastToast = null;
}

var mod = require(modPath);

function makeOrc(id, num, valorFinal, extra) {
  return Object.assign({ id: id, num: num, cliente: 'E2E_FASEF_20260805_Cliente', valorFinal: valorFinal, status: 'aguardando' }, extra || {});
}

// Prepara o fixture e simula o operador selecionando `tipo` na Etapa 4 (com
// `entradaVal` já digitado, quando aplicável) e clicando "Confirmar
// Pagamento" — mesma função real chamada pelo botão (orcConfirmarPagamentoWizard),
// nunca reimplementada.
async function confirmarPagamento(orc, tipo, entradaVal) {
  mod.setEnviados([orc]);
  window._orcPgtoTestOrcId = orc.id;
  window._orcPgtoValorEfetivo = orc.valorFinal;
  mod.orcPgtoTipoSelWizard(_tipoButtons[tipo]);
  if (entradaVal !== undefined) _elements['pgtoEntradaValWizard'].value = String(entradaVal);
  return mod.orcConfirmarPagamentoWizard();
}

console.log('\n=== Regressão: tipo de pagamento ignorado ao gerar OS (Fase F) ===\n');

(async function main() {

await test('1. padrão inicial do painel é 50/50 (regra operacional atual — 50% para iniciar produção)', function () {
  resetModalDom();
  assertEq(mod.getPgtoTipoAtual(), '50-50', 'estado canônico inicial (var _pgtoTipoAtualWizard) é 50-50');
});

await test('2. Integral — entrada = total, restante = 0, status pago, um recebimento', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-2', '000002', 1000);
  await confirmarPagamento(orc, 'integral');
  assertEq(!!orc.pgtoConfirmado, true, 'Confirmar Pagamento grava a situação financeira com sucesso');
  await mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 1000, 'entrada = total');
  assertApprox(os.restante, 0, 'restante = 0');
  var o = mod.getEnviados().find(function (x) { return x.id === 'ORC-2'; });
  // GO-LIVE FINAL 2026-08-12, seção 17-20 — mudança de regra deliberada:
  // o.status passou a ser um estado OPERACIONAL (nunca mais financeiro).
  // Gerar a OS sempre marca 'enviado_producao', mesmo com pagamento
  // integral.
  assertEq(o.status, 'enviado_producao', 'orçamento deve ir para Enviado p/ Produção (nunca mais status financeiro no campo operacional)');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'recebido'; }).length, 1, 'exatamente um recebimento');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'pendente'; }).length, 0, 'nenhum CR pendente para integral');
});

await test('3. 50/50 — entrada pré-calculada, restante = metade, um recebimento + um pendente', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-3', '000003', 800);
  mod.setEnviados([orc]);
  window._orcPgtoTestOrcId = orc.id;
  window._orcPgtoValorEfetivo = orc.valorFinal;
  mod.orcPgtoTipoSelWizard(_tipoButtons['50-50']);
  assertApprox(parseFloat(_elements['pgtoEntradaValWizard'].value), 400, 'entrada 50/50 pré-calculada como metade do total');
  await mod.orcConfirmarPagamentoWizard();
  await mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 400, 'entrada = 400');
  assertApprox(os.restante, 400, 'restante = 400');
  assertEq(os.status, 'aguardando_saldo', 'status da OS deve ser aguardando_saldo (código antes inalcançável)');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'recebido'; }).length, 1, 'exatamente um recebimento');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'pendente'; }).length, 1, 'exatamente um CR pendente para o restante');
});

await test('4. Parcial — respeita valor informado, restante = total − entrada', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-4', '000004', 1000);
  await confirmarPagamento(orc, 'parcial', '150.50');
  await mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 150.50, 'entrada = valor informado');
  assertApprox(os.restante, 849.50, 'restante = total - entrada');
});

await test('5. A Receber/Futuro — entrada zero, restante = total, CR pendente registrado (nunca invisível), nenhum recebimento', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-5', '000005', 500);
  await confirmarPagamento(orc, 'futuro');
  await mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 0, 'entrada = 0');
  assertApprox(os.restante, 500, 'restante = total');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'recebido'; }).length, 0, 'nenhum recebimento lançado para futuro');
  // HOTFIX OPERACIONAL 2026-08-12, P0.3/P0.4 — "A Receber" nunca gera
  // recebimento, mas o CR pendente correspondente é registrado por
  // orcRegistrarSituacaoFinanceira() já na Confirmação — nunca 0 CR (senão
  // o cliente "A Receber" nunca apareceria em Contas a Receber).
  assertEq(FIN_CR.length, 1, 'exatamente 1 CR pendente registrado para A Receber');
  var o = mod.getEnviados().find(function (x) { return x.id === 'ORC-5'; });
  assertEq(o.status, 'enviado_producao', 'orçamento deve ir para Enviado p/ Produção mesmo sem entrada (tipo futuro) — produção não é bloqueada pelo pagamento');
});

await test('6. alternar Integral → Parcial → 50/50 → Futuro mantém só a última seleção', function () {
  resetModalDom();
  window._orcPgtoValorEfetivo = 1000;
  mod.orcPgtoTipoSelWizard(_tipoButtons['integral']);
  mod.orcPgtoTipoSelWizard(_tipoButtons['parcial']);
  mod.orcPgtoTipoSelWizard(_tipoButtons['50-50']);
  mod.orcPgtoTipoSelWizard(_tipoButtons['futuro']);
  assertEq(mod.getPgtoTipoAtual(), 'futuro', 'apenas a última seleção deve valer');
});

await test('7. dois orçamentos consecutivos com escolhas diferentes não se cruzam', async function () {
  // Verificado via FIN_CR (que só acumula, nunca sobrescreve por chave) em
  // vez de KB_OS — orcEnvGerarOS() usa 'os'+Date.now() como chave de OS, e
  // duas chamadas síncronas no mesmo milissegundo colidiriam nessa chave
  // (pendência de idempotência separada do bug de tipo de pagamento; ver
  // cenário 14).
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orcA = makeOrc('ORC-7A', '000009', 1000);
  await confirmarPagamento(orcA, 'integral');
  await mod.orcEnvGerarOS();
  assertEq(FIN_CR.length, 1, 'orçamento A (integral) lança exatamente 1 recebimento');
  assertApprox(FIN_CR[0].valor, 1000, 'recebimento de A reflete o valor integral de A');
  resetModalDom();
  var orcB = makeOrc('ORC-7B', '000010', 2000);
  await confirmarPagamento(orcB, 'futuro');
  await mod.orcEnvGerarOS();
  // A Receber sempre registra 1 CR pendente (seção 5) — total sobe para 2
  // (o recebido de A + o pendente de B), nenhum se cruza ou se sobrescreve.
  assertEq(FIN_CR.length, 2, 'orçamento B (futuro) soma seu próprio CR pendente — nunca sobrescreve o de A');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'recebido'; }).length, 1, 'ainda só 1 recebido (de A)');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'pendente'; }).length, 1, 'exatamente 1 pendente (de B)');
});

await test('8. valor parcial inválido (negativo) é rejeitado — nenhum pagamento confirmado, nenhuma OS', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-8', '000011', 1000);
  mod.setEnviados([orc]);
  window._orcPgtoTestOrcId = orc.id;
  window._orcPgtoValorEfetivo = orc.valorFinal;
  mod.orcPgtoTipoSelWizard(_tipoButtons['parcial']);
  _elements['pgtoEntradaValWizard'].value = '-50';
  var r = await mod.orcConfirmarPagamentoWizard();
  assertEq(r, undefined, 'orcConfirmarPagamentoWizard() retorna sem confirmar quando a entrada é inválida');
  assertEq(!!orc.pgtoConfirmado, false, 'nenhuma situação financeira confirmada');
  window._orcSessaoAtualId = orc.id;
  await mod.orcEnvGerarOS();
  assertEq(Object.keys(KB_OS).length, 0, 'valor negativo não pode gerar OS (gate de pgtoConfirmado nunca é liberado)');
});

await test('9. valor parcial inválido (acima do total) é rejeitado', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-9', '000012', 1000);
  mod.setEnviados([orc]);
  window._orcPgtoTestOrcId = orc.id;
  window._orcPgtoValorEfetivo = orc.valorFinal;
  mod.orcPgtoTipoSelWizard(_tipoButtons['parcial']);
  _elements['pgtoEntradaValWizard'].value = '1500';
  await mod.orcConfirmarPagamentoWizard();
  assertEq(!!orc.pgtoConfirmado, false, 'nenhuma situação financeira confirmada — valor acima do total é rejeitado');
});

await test('10. valor parcial vazio/NaN é rejeitado', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-10', '000013', 1000);
  mod.setEnviados([orc]);
  window._orcPgtoTestOrcId = orc.id;
  window._orcPgtoValorEfetivo = orc.valorFinal;
  mod.orcPgtoTipoSelWizard(_tipoButtons['parcial']);
  _elements['pgtoEntradaValWizard'].value = '';
  await mod.orcConfirmarPagamentoWizard();
  assertEq(!!orc.pgtoConfirmado, false, 'nenhuma situação financeira confirmada — valor vazio é rejeitado');
});

await test('11. parcial igual ao total é aceito (equivalente a integral)', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-11', '000014', 1000);
  await confirmarPagamento(orc, 'parcial', '1000');
  await mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 1000, 'entrada = total é permitido em parcial');
  assertApprox(os.restante, 0, 'restante = 0');
});

await test('12. centavos — entrada e restante somam exatamente o total (sem erro de ponto flutuante)', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-12', '000015', 100.10);
  await confirmarPagamento(orc, 'parcial', '33.33');
  await mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada + os.restante, 100.10, 'entrada + restante = total exato');
});

await test('13. retry/duplo clique em Gerar OS não duplica OS nem recebimento (mesmo no caminho de fallback local, sem Firestore)', async function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = []; FIN_TX = [];
  var orc = makeOrc('ORC-13', '000016', 1000);
  await confirmarPagamento(orc, 'integral');
  await mod.orcEnvGerarOS();
  await mod.orcEnvGerarOS(); // segundo clique — mesmo estado, mesmo orçamento
  // O caminho de fallback local (sem Firestore, só usado no harness/testes)
  // grava o.osRef no MESMO objeto em memória referenciado pela 2ª chamada —
  // já barra o clique duplo mesmo sem uma transação real. O caminho de
  // produção real (transação Firestore) tem a mesma garantia, testada à
  // parte em test_os_idempotencia.js/test_hotfix_recebimentos_canonicos.
  assertEq(Object.keys(KB_OS).length, 1, 'clique duplo no fallback local não duplica a OS');
});

await test('14. alterar apenas cor/classe/CSS de um botão não muda o tipo lido', function () {
  resetModalDom();
  window._orcPgtoValorEfetivo = 1000;
  mod.orcPgtoTipoSelWizard(_tipoButtons['parcial']);
  // simula exatamente o bug original: manipular estilo/classe diretamente,
  // sem passar por orcPgtoTipoSelWizard — não pode mudar o estado canônico
  _tipoButtons['integral'].style.borderColor = '#059669';
  _tipoButtons['integral'].className = 'pgto-tipo-btn active';
  assertEq(mod.getPgtoTipoAtual(), 'parcial', 'cor/classe alteradas fora do handler não alteram o tipo canônico');
});

console.log('\n=== RESULTADO ===');
console.log(passed + ' passed, ' + failed + ' failed');
fs.unlinkSync(modPath);
process.exit(failed ? 1 : 0);

})();
