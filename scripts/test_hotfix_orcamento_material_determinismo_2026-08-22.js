/**
 * test_hotfix_orcamento_material_determinismo_2026-08-22.js
 *
 * RODADA 9, BLOCO D (2026-08-22) — bug real: mesmo produto, mesmas
 * medidas, mesmo material/espessura/quantidade/planificação, às vezes
 * retorna custo/preço DIFERENTE (caso observado: Armário, Acrílico
 * Cristal 2mm, 7 peças, ~0,2352 m²).
 *
 * Causa raiz (duas partes, confirmadas lendo o código, não suposição):
 * 1) _matGetRsm2() tinha como fonte PRIMÁRIA um cache no próprio
 *    <select> (selEl.dataset.rsm2), só escrito por orcMatChanged() — mas
 *    itens cujo produto não declara materialPadrao/materiaisPermitidos
 *    NUNCA disparam orcMatChanged() na criação (orcAplicarMaterialReceita
 *    retorna cedo), caindo direto no fallback: reindexar
 *    cfgLoad().materiais POR POSIÇÃO a cada chamada. Se o catálogo for
 *    reordenado/mutado em segundo plano (o listener de erp_config já
 *    dispara auto-migrações que regravam o próprio documento) enquanto o
 *    orçamento está aberto, "cfg_N" passa a apontar para outro material
 *    sem aviso.
 * 2) orcRefreshMatSelects() reconstruía os <select> já abertos com uma
 *    versão PRÓPRIA e mais simples das <option> (só o nome, sem
 *    espessura/preço) sempre que um material era ADICIONADO ao catálogo
 *    com o orçamento aberto, e tentava preservar a seleção comparando
 *    pelo TEXTO completo — que nunca batia (formatos diferentes),
 *    perdendo a seleção do usuário silenciosamente (caía no primeiro
 *    item da lista).
 *
 * Corrigido: _matGetRsm2() lê primeiro o data-rsm2 da PRÓPRIA <option>
 * selecionada (preso ao nó DOM, nunca precisa de orcMatChanged, nunca
 * refaz índice); orcRefreshMatSelects() reusa orcConstruirMatOpts()
 * (fonte canônica, mesma usada em todo o resto do orçamento) e preserva a
 * seleção por data-nome (estável), nunca por texto/posição.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _matGetRsm2, orcConstruirMatOpts, orcRefreshMatSelects, orcMatChanged
 * (stub mínimo — só grava dataset.rsm2/esp no <select>, como o real faz).
 *
 * Uso: node scripts/test_hotfix_orcamento_material_determinismo_2026-08-22.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { console.log('  ✅  ' + msg); passed++; }
  else { console.log('  ❌  ' + msg + '\n       esperado : ' + e + '\n       obtido   : ' + g); failed++; }
}

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

var FN_NAMES = ['_matGetRsm2', 'orcConstruirMatOpts', 'orcRefreshMatSelects'];
global.window = global;
global.cfgEsc = function (v) { return v == null ? '' : String(v).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
global.ORC_MATS = [];
// Stub mínimo de orcMatChanged: o real recalcula preço/UI inteiros; para
// este teste só precisa fazer o que _matGetRsm2/orcRefreshMatSelects
// observam dele — nada, já que a correção do Bloco D é justamente NÃO
// depender mais dele ter rodado.
global.orcMatChanged = function () {};

var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_orcamento_material_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// ── Mock mínimo de <select>/<option>: innerHTML real (parseia as tags),
// options[]/selectedIndex/value com semântica real de DOM — necessário
// porque o bug está exatamente em COMO orcRefreshMatSelects() reconstrói
// innerHTML e tenta preservar a seleção. ──────────────────────────────────
function parseOptionsHtml(htmlStr) {
  var out = [];
  var re = /<option([^>]*)>([^<]*)<\/option>/g;
  var m;
  while ((m = re.exec(htmlStr))) {
    var attrsStr = m[1], text = m[2];
    var attrs = {};
    var attrRe = /([a-zA-Z0-9_-]+)="([^"]*)"/g, am;
    while ((am = attrRe.exec(attrsStr))) attrs[am[1]] = am[2];
    out.push({
      value: attrs.value || '',
      text: text,
      _attrs: attrs,
      getAttribute: function (name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
    });
  }
  return out;
}
function makeSelectEl() {
  var _options = [];
  var _selectedIndex = 0;
  var el = {
    dataset: {},
    get options() { return _options; },
    get selectedIndex() { return _selectedIndex; },
    set selectedIndex(v) { _selectedIndex = v; },
    get value() { return (_options[_selectedIndex] || {}).value || ''; },
    set value(v) {
      for (var i = 0; i < _options.length; i++) { if (_options[i].value === v) { _selectedIndex = i; return; } }
      _selectedIndex = -1;
    },
    set innerHTML(htmlStr) { _options = parseOptionsHtml(htmlStr); _selectedIndex = _options.length ? 0 : -1; },
    get innerHTML() { return ''; }
  };
  return el;
}

var _els = {};
global.document = { getElementById: function (id) { return _els[id] || null; } };

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 9, Bloco D — determinismo de material/custo no orçamento ===\n');

// ── _matGetRsm2: fonte primária é a <option> selecionada, não um índice ──
(function () {
  global.cfgLoad = function () { return { materiais: [
    { nome: 'Acrílico Cristal', esp: 2, rsm2: 45.50 },
    { nome: 'Acrílico Fumê', esp: 3, rsm2: 60.00 },
    { nome: 'x', nome2: '', esp: 0 }, { nome: 'x' }, { nome: 'x' }, { nome: 'x' }, // padding p/ passar do length>5
  ] }; };
  var sel = makeSelectEl();
  sel.innerHTML = mod.orcConstruirMatOpts(null);
  sel.value = 'cfg_0'; // Acrílico Cristal
  _els['oi_mat_1'] = sel;
  var r1 = mod._matGetRsm2('cfg_0', 1);
  assertEq(r1, 45.5, '1. lê o rsm2 direto da <option> selecionada (sem depender de orcMatChanged já ter rodado)');

  // Simula o achado real: o listener de erp_config REORDENA o array de
  // materiais em segundo plano (ex.: auto-migração) — a <option> já
  // montada no <select> não muda, então o resultado tem que continuar
  // sendo o MESMO material (Acrílico Cristal), nunca o que passou a
  // ocupar a posição 0.
  global.cfgLoad = function () { return { materiais: [
    { nome: 'Acrílico Fumê', esp: 3, rsm2: 60.00 },   // agora na posição 0
    { nome: 'Acrílico Cristal', esp: 2, rsm2: 45.50 }, // deslocado para 1
    { nome: 'x' }, { nome: 'x' }, { nome: 'x' }, { nome: 'x' },
  ] }; };
  var r2 = mod._matGetRsm2('cfg_0', 1);
  assertEq(r2, 45.5, '2. MESMAS entradas do usuário (mesma <option> selecionada) → MESMO resultado, mesmo com o catálogo reordenado em segundo plano — achado original corrigido');
})();

(function () {
  // Determinismo: chamar 10x seguidas com o catálogo mudando de ordem a
  // cada chamada — resultado tem que ser idêntico sempre (Teste A do
  // pedido: "mesmo item criado 10 vezes").
  var ordens = [
    [{ nome: 'Acrílico Cristal', esp: 2, rsm2: 45.5 }, { nome: 'Outro', esp: 4, rsm2: 99 }],
    [{ nome: 'Outro', esp: 4, rsm2: 99 }, { nome: 'Acrílico Cristal', esp: 2, rsm2: 45.5 }],
  ];
  var sel = makeSelectEl();
  global.cfgLoad = function () { return { materiais: ordens[0].concat([{nome:'x'},{nome:'x'},{nome:'x'},{nome:'x'}]) }; };
  sel.innerHTML = mod.orcConstruirMatOpts(null);
  sel.value = 'cfg_0';
  _els['oi_mat_1'] = sel;
  var resultados = [];
  for (var i = 0; i < 10; i++) {
    global.cfgLoad = function () { return { materiais: ordens[i % 2].concat([{nome:'x'},{nome:'x'},{nome:'x'},{nome:'x'}]) }; };
    resultados.push(mod._matGetRsm2('cfg_0', 1));
  }
  assertTrue(resultados.every(function (r) { return r === resultados[0]; }), '3. 10 chamadas seguidas com o catálogo reordenando entre elas: resultado idêntico em todas — MESMAS ENTRADAS → MESMO RESULTADO, sempre');
})();

// ── orcRefreshMatSelects: nunca perde a seleção do usuário ao adicionar material ──
(function () {
  global.cfgLoad = function () { return { materiais: [
    { nome: 'Acrílico Cristal', esp: 2, rsm2: 45.5 },
    { nome: 'Acrílico Fumê', esp: 3, rsm2: 60 },
    { nome: 'x' }, { nome: 'x' }, { nome: 'x' }, { nome: 'x' },
  ] }; };
  global.orcItemCount = 1;
  var sel = makeSelectEl();
  sel.innerHTML = mod.orcConstruirMatOpts(null);
  sel.value = 'cfg_1'; // usuário escolheu Acrílico Fumê
  _els['oi_mat_1'] = sel;
  assertEq(sel.options[sel.selectedIndex].getAttribute('data-nome'), 'Acrílico Fumê', 'pré-condição: Acrílico Fumê está selecionado antes do refresh');

  // Um material NOVO é adicionado ao catálogo (ex.: outro vendedor cadastrou
  // um material enquanto este orçamento estava aberto) — dispara o refresh.
  global.cfgLoad = function () { return { materiais: [
    { nome: 'Acrílico Cristal', esp: 2, rsm2: 45.5 },
    { nome: 'Acrílico Fumê', esp: 3, rsm2: 60 },
    { nome: 'MDF Branco', esp: 15, rsm2: 30 }, // novo
    { nome: 'x' }, { nome: 'x' }, { nome: 'x' }, { nome: 'x' },
  ] }; };
  mod.orcRefreshMatSelects();
  assertEq(sel.options[sel.selectedIndex].getAttribute('data-nome'), 'Acrílico Fumê', '4. após um material ser adicionado ao catálogo com o orçamento aberto, a seleção do usuário (Acrílico Fumê) é PRESERVADA — achado original corrigido (antes recaía no primeiro item da lista)');
})();

(function () {
  // Item ainda "pending" (Firebase não tinha respondido quando a linha foi
  // criada) — precisa popular normalmente assim que o catálogo chegar.
  global.cfgLoad = function () { return { materiais: [
    { nome: 'Acrílico Cristal', esp: 2, rsm2: 45.5 },
    { nome: 'x' }, { nome: 'x' }, { nome: 'x' }, { nome: 'x' }, { nome: 'x' },
  ] }; };
  global.orcItemCount = 1;
  var sel = makeSelectEl();
  sel.innerHTML = '<option value="pending">⏳ Carregando materiais...</option>';
  _els['oi_mat_1'] = sel;
  mod.orcRefreshMatSelects();
  assertEq(sel.options[sel.selectedIndex].getAttribute('data-nome'), 'Acrílico Cristal', '5. select "pending" (Firebase ainda não tinha respondido) é populado normalmente assim que o catálogo chega — sem regressão');
})();

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
