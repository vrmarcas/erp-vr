/**
 * test_estabilizacao_2026-09-09_espessura_item_novo.js
 *
 * ACHADO NO SMOKE MANUAL EM PRODUÇÃO (2026-09-09), durante a verificação
 * dos Blocos 1/2 desta rodada — reprodução ao vivo em erp-vrmarcas.web.app:
 * um item NOVO (orcAddItem) nascia com oi_esp_<idx> hardcoded em "3", mas
 * oi_mat_<idx> nasce selecionado no PRIMEIRO material do catálogo
 * (orcConstruirMatOpts(null)) — "Acrílico Cristal 2mm" no catálogo real.
 * Resultado: Caixa criada do zero, nunca tocando o dropdown de material,
 * ficava com material=2mm mas esp=3mm — a MESMA divergência dos Blocos
 * 1/2 (WhatsApp/PDF/layout mostrando 3mm com cálculo em 2mm), só que na
 * origem do dado (criação da linha), não em um dos pontos de consumo já
 * corrigidos nesta rodada.
 *
 * Corrigido: orcAddItem() chama orcMatChanged(idx) uma vez ao criar a
 * linha — mesma sincronização que já acontece quando o vendedor troca o
 * material manualmente.
 *
 * Uso: node scripts/test_estabilizacao_2026-09-09_espessura_item_novo.js
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

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var lineStart = html.lastIndexOf('\n', start) + 1;
  var decl = html.slice(lineStart, start);
  if (/\basync\s*$/.test(decl)) start = lineStart + decl.search(/async/);
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1);
}

var FN_NAMES = [
  'orcAddItem', 'orcMatChanged', 'orcConstruirMatOpts', '_cfgMateriaisReais',
  'orcProdutosCanonicos', 'planProdLoad', '_planResincronizarPecasHerdadas'
];
var src = [
  'var orcItemCount = 0;',
  'var ORC_PRODUTOS = ["Caixa"];',
  'var ORC_MATS = [];',
  'var _PLAN_PROD_DATA = [];',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcAddItem: orcAddItem, getItemCount: function(){ return orcItemCount; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_2026-09-09_espessura_item_novo_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    disabled: false, options: [], selectedIndex: 0,
    getAttribute: function (k) { return this.dataset ? this.dataset[k.replace('data-', '')] : null; },
    setAttribute: function (k, v) { this[k] = v; }
  }, props || {});
}
var _elements = {};
function reg(id, el) { _elements[id] = el; return el; }
global.window = global;
global.document = {
  getElementById: function (id) { return _elements[id]; },
  createElement: function () {
    var el = makeEl({ appendChild: function () {} });
    // orcAddItem constrói a linha via innerHTML de uma <tr> fake — como
    // não temos DOM real, interceptamos innerHTML para "registrar" os
    // elementos oi_*_<idx> que o resto do teste precisa consultar.
    Object.defineProperty(el, 'innerHTML', {
      set: function (html) {
        var re = /id="(oi_\w+_\d+)"/g, m;
        while ((m = re.exec(html))) { if (!_elements[m[1]]) reg(m[1], makeEl()); }
        // Extrai cada <select id="oi_mat_N">...</select> e popula .options
        // com dados reais (value/data-esp/etc) a partir do HTML gerado por
        // orcConstruirMatOpts() — sem isso, orcMatChanged() (chamado por
        // orcAddItem() nesta rodada) não teria nenhuma option real pra ler.
        var selRe = /<select id="(oi_mat_\d+)"[^>]*>([\s\S]*?)<\/select>/g, sm;
        while ((sm = selRe.exec(html))) {
          var selId = sm[1], inner = sm[2];
          var opts = [];
          var optRe = /<option([^>]*)>([^<]*)<\/option>/g, om;
          while ((om = optRe.exec(inner))) {
            var attrs = om[1], text = om[2];
            var ds = {};
            var attrRe = /([\w-]+)="([^"]*)"/g, am;
            while ((am = attrRe.exec(attrs))) {
              var key = am[1];
              if (key === 'value') continue;
              ds[key.replace(/^data-/, '').replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = am[2];
            }
            var valM = /value="([^"]*)"/.exec(attrs);
            opts.push({ value: valM ? valM[1] : text, text: text, dataset: ds, getAttribute: function (k) { return this.dataset[k.replace('data-', '')]; } });
          }
          var selEl = _elements[selId] || reg(selId, makeEl());
          selEl.options = opts;
          selEl.selectedIndex = 0;
          if (opts.length) selEl.value = opts[0].value;
        }
      },
      get: function () { return ''; }
    });
    return el;
  }
};
reg('orcItemBody', makeEl({ appendChild: function () {} }));
global.showToast = function () {};
global.cfgEsc = function (v) { return v == null ? '' : String(v); };
global._cfgDataLoaded = true;
global._cfgData = {
  materiais: [
    { id: 'm2', nome: 'Acrílico Cristal', esp: 2, rsm2: 120 },
    { id: 'm3', nome: 'Acrílico Cristal 3mm', esp: 3, rsm2: 150 }
  ]
};
global.cfgLoad = function () { return global._cfgData; };
global.orcRecalc = function () {};
global.orcAutoLaserSeNecessario = function () {};
global.ORC_MATS = [];

var mod = require(modPath);

console.log('\n=== ACHADO NO SMOKE 2026-09-09 — espessura de item novo bate com o material default ===\n');

test('item novo (orcAddItem): oi_esp_<idx> bate com a espessura do material JÁ selecionado por padrão (nunca fica travado em 3 hardcoded)', function () {
  mod.orcAddItem();
  var idx = mod.getItemCount();
  var matEl = _elements['oi_mat_' + idx];
  var espEl = _elements['oi_esp_' + idx];
  // Primeiro material do catálogo é "Acrílico Cristal" (2mm) — mesmo
  // cenário reproduzido ao vivo em produção.
  var matOpt = matEl.options[matEl.selectedIndex];
  assertEq(matOpt.dataset.esp, '2', 'pré-condição: material default selecionado é 2mm');
  assertEq(espEl.value, 2, 'BUG: oi_esp_ deveria bater com a espessura do material default (2), não ficar hardcoded em 3');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
