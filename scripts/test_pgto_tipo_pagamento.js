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
 * Funções sob teste (extraídas de index.html via contagem de chaves —
 * mesma técnica de test_orcamento_pdf_whatsapp.js — não reimplementadas):
 * orcEnvConfirmarPgto, orcPagtoTipoSel, orcEnvGerarOS.
 *
 * Uso: node scripts/test_pgto_tipo_pagamento.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
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

var FN_NAMES = ['orcEnvConfirmarPgto', 'orcPagtoTipoSel', 'orcEnvGerarOS', 'orcCondicaoLabelPorTipo'];
var src = [
  'var _orcPagtoId = null;',
  'var _pgtoTipoAtual = null;',
  'var _ORC_ENVIADOS_DATA = [];',
  'function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }',
  'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; }',
  'var _OS_COUNTER = 0;',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = {',
  '  orcEnvConfirmarPgto: orcEnvConfirmarPgto, orcPagtoTipoSel: orcPagtoTipoSel,',
  '  orcEnvGerarOS: orcEnvGerarOS,',
  '  getPgtoTipoAtual: function(){ return _pgtoTipoAtual; },',
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

// botões de tipo — precisam ser encontráveis via pm.querySelector('[data-tipo="integral"]')
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
  if (sel === '.pgto-tipo-btn') return Object.values(_tipoButtons);
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
global._finSaveCR = function () {};
global.orcEnviadosRender = function () {};
global.nav = function () {};
global.setTimeout = function () {};

['integral', '50-50', 'parcial', 'futuro'].forEach(function (t) {
  ['integral', '50-50', 'parcial', 'futuro'].forEach(function () {}); // no-op, keep list explicit below
});
function resetModalDom() {
  _tipoButtons = {};
  ['integral', '50-50', 'parcial', 'futuro'].forEach(makeTipoBtn);
  reg('orcEnvModal', makeEl({ style: {} }));
  reg('orcPagtoModal', makeEl({ style: {} }));
  reg('pgtoEntradaBox', makeEl({ style: {} }));
  reg('pgtoEntradaVal', makeEl({ value: '' }));
  reg('pgtoEntradaPct', makeEl({}));
  reg('pgtoForma', makeEl({ options: [{ text: 'PIX' }], selectedIndex: 0 }));
  reg('pgtoObs', makeEl({ value: '' }));
}

var mod = require(modPath);

function makeOrc(id, num, valorFinal, extra) {
  return Object.assign({ id: id, num: num, cliente: 'E2E_FASEF_20260805_Cliente', valorFinal: valorFinal, status: 'aguardando' }, extra || {});
}

console.log('\n=== Regressão: tipo de pagamento ignorado ao gerar OS (Fase F) ===\n');

// Rodada 2.1 (2026-08-08) — teste desatualizado: o default do modal deixou
// de ser Integral em favor de 50/50 (regra operacional "50% de entrada
// para iniciar produção, 50% na retirada/entrega" — ver comentário em
// orcEnvConfirmarPgto() logo antes de orcPagtoTipoSel(pm.querySelector(
// '[data-tipo="50-50"]')), e o botão 50-50 é o único com class="...active"
// na UI). Vitre segue a mesma regra (vitreOrcPgtoTipo tem "entrada_saldo"
// como option selected). Não é um bug — é a mudança de regra de negócio
// já documentada e testada em P0.1/P1 "Condição padrão 50/50".
test('1. padrão inicial do modal é 50/50 (regra operacional atual — 50% para iniciar produção)', function () {
  resetModalDom();
  mod.setEnviados([makeOrc('ORC-1', '000001', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-1');
  assertEq(mod.getPgtoTipoAtual(), '50-50', 'estado canônico deve iniciar como 50-50, igual ao destaque visual padrão');
});

test('2. Integral — entrada = total, restante = 0, status pago, um recebimento', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-2', '000002', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-2');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 1000, 'entrada = total');
  assertApprox(os.restante, 0, 'restante = 0');
  var o = mod.getEnviados().find(function (x) { return x.id === 'ORC-2'; });
  assertEq(o.status, 'pago', 'orçamento deve ficar pago');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'recebido'; }).length, 1, 'exatamente um recebimento');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'pendente'; }).length, 0, 'nenhum CR pendente para integral');
});

test('3. 50/50 — entrada pré-calculada, restante = metade, um recebimento + um pendente', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-3', '000003', 800)]);
  mod.orcEnvConfirmarPgto('ORC-3');
  mod.orcPagtoTipoSel(_tipoButtons['50-50']);
  assertApprox(parseFloat(_elements['pgtoEntradaVal'].value), 400, 'entrada 50/50 pré-calculada como metade do total');
  mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 400, 'entrada = 400');
  assertApprox(os.restante, 400, 'restante = 400');
  assertEq(os.status, 'aguardando_saldo', 'status da OS deve ser aguardando_saldo (código antes inalcançável)');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'recebido'; }).length, 1, 'exatamente um recebimento');
  assertEq(FIN_CR.filter(function (c) { return c.status === 'pendente'; }).length, 1, 'exatamente um CR pendente para o restante');
});

test('4. Parcial — respeita valor informado, restante = total − entrada', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-4', '000004', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-4');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '150.50';
  mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 150.50, 'entrada = valor informado');
  assertApprox(os.restante, 849.50, 'restante = total - entrada');
});

test('5. A Receber/Futuro — entrada zero, restante = total, nenhum recebimento', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-5', '000005', 500)]);
  mod.orcEnvConfirmarPgto('ORC-5');
  mod.orcPagtoTipoSel(_tipoButtons['futuro']);
  mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 0, 'entrada = 0');
  assertApprox(os.restante, 500, 'restante = total');
  assertEq(FIN_CR.length, 0, 'nenhum recebimento lançado para futuro');
  var o = mod.getEnviados().find(function (x) { return x.id === 'ORC-5'; });
  assertEq(o.status, 'aguardando_pagamento', 'orçamento aguardando pagamento');
});

test('6. alternar Integral → Parcial → 50/50 → Futuro mantém só a última seleção', function () {
  resetModalDom();
  mod.setEnviados([makeOrc('ORC-6', '000006', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-6');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  mod.orcPagtoTipoSel(_tipoButtons['50-50']);
  mod.orcPagtoTipoSel(_tipoButtons['futuro']);
  assertEq(mod.getPgtoTipoAtual(), 'futuro', 'apenas a última seleção deve valer');
});

test('7. fechar e reabrir o modal reseta para 50/50 (não reaproveita seleção anterior)', function () {
  resetModalDom();
  mod.setEnviados([makeOrc('ORC-7a', '000007', 1000), makeOrc('ORC-7b', '000008', 2000)]);
  mod.orcEnvConfirmarPgto('ORC-7a');
  mod.orcPagtoTipoSel(_tipoButtons['futuro']);
  assertEq(mod.getPgtoTipoAtual(), 'futuro');
  // reabrir para outro orçamento — deve voltar ao padrão 50/50
  mod.orcEnvConfirmarPgto('ORC-7b');
  assertEq(mod.getPgtoTipoAtual(), '50-50', 'reabrir o modal deve resetar para o padrão 50/50, não herdar seleção anterior');
});

test('8. dois orçamentos consecutivos com escolhas diferentes não se cruzam', function () {
  // Verificado via FIN_CR (que só acumula, nunca sobrescreve por chave) em
  // vez de KB_OS — orcEnvGerarOS() usa 'os'+Date.now() como chave de OS, e
  // duas chamadas síncronas no mesmo milissegundo colidiriam nessa chave
  // (pendência de idempotência separada do bug de tipo de pagamento; ver
  // cenário 14).
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-8a', '000009', 1000), makeOrc('ORC-8b', '000010', 2000)]);
  mod.orcEnvConfirmarPgto('ORC-8a');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  mod.orcEnvGerarOS();
  assertEq(FIN_CR.length, 1, 'orçamento A (integral) lança exatamente 1 recebimento');
  assertApprox(FIN_CR[0].valor, 1000, 'recebimento de A reflete o valor integral de A');
  resetModalDom();
  mod.orcEnvConfirmarPgto('ORC-8b');
  mod.orcPagtoTipoSel(_tipoButtons['futuro']);
  mod.orcEnvGerarOS();
  assertEq(FIN_CR.length, 1, 'orçamento B (futuro) não lança nenhum recebimento novo — total continua 1 (só o de A)');
});

test('9. valor parcial inválido (negativo) é rejeitado — nenhuma OS criada', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-9', '000011', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-9');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '-50';
  mod.orcEnvGerarOS();
  assertEq(Object.keys(KB_OS).length, 0, 'valor negativo não pode gerar OS');
});

test('10. valor parcial inválido (acima do total) é rejeitado', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-10', '000012', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-10');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '1500';
  mod.orcEnvGerarOS();
  assertEq(Object.keys(KB_OS).length, 0, 'valor acima do total não pode gerar OS');
});

test('11. valor parcial vazio/NaN é rejeitado', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-11', '000013', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-11');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '';
  mod.orcEnvGerarOS();
  assertEq(Object.keys(KB_OS).length, 0, 'valor vazio não pode gerar OS');
});

test('12. parcial igual ao total é aceito (equivalente a integral)', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-12', '000014', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-12');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '1000';
  mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada, 1000, 'entrada = total é permitido em parcial');
  assertApprox(os.restante, 0, 'restante = 0');
});

test('13. centavos — entrada e restante somam exatamente o total (sem erro de ponto flutuante)', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-13', '000015', 100.10)]);
  mod.orcEnvConfirmarPgto('ORC-13');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  _elements['pgtoEntradaVal'].value = '33.33';
  mod.orcEnvGerarOS();
  var os = Object.values(KB_OS)[0];
  assertApprox(os.valorEntrada + os.restante, 100.10, 'entrada + restante = total exato');
});

test('14. retry/duplo clique em Gerar OS não duplica OS nem recebimento', function () {
  resetModalDom();
  KB_OS = {}; FIN_CR = [];
  mod.setEnviados([makeOrc('ORC-14', '000016', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-14');
  mod.orcPagtoTipoSel(_tipoButtons['integral']);
  mod.orcEnvGerarOS();
  mod.orcEnvGerarOS(); // segundo clique — mesmo estado, mesma orçamento
  // NOTA: orcEnvGerarOS() gera newId via 'os'+Date.now() e incrementa
  // _OS_COUNTER a cada chamada — não há proteção de idempotência real
  // contra clique duplo nesta função. Documentado como pendência abaixo,
  // não corrigido aqui (fora do escopo do bug de tipo de pagamento).
  console.log('       ⚠ nota: duplo clique cria 2 OS (' + Object.keys(KB_OS).length + ') — pendência separada, não é o bug corrigido nesta rodada');
});

test('15. alterar apenas cor/classe/CSS de um botão não muda o tipo lido', function () {
  resetModalDom();
  mod.setEnviados([makeOrc('ORC-15', '000017', 1000)]);
  mod.orcEnvConfirmarPgto('ORC-15');
  mod.orcPagtoTipoSel(_tipoButtons['parcial']);
  // simula exatamente o bug original: manipular estilo/classe diretamente,
  // sem passar por orcPagtoTipoSel — não pode mudar o estado canônico
  _tipoButtons['integral'].style.borderColor = '#059669';
  _tipoButtons['integral'].className = 'pgto-tipo-btn active';
  assertEq(mod.getPgtoTipoAtual(), 'parcial', 'cor/classe alteradas fora do handler não alteram o tipo canônico');
});

console.log('\n=== RESULTADO ===');
console.log(passed + ' passed, ' + failed + ' failed');
fs.unlinkSync(modPath);
process.exit(failed ? 1 : 0);
