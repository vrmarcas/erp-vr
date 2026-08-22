/**
 * test_hotfix_svg_upload_produto_2026-08-22.js
 *
 * RODADA 9, BLOCO F (2026-08-22) — bug real: SVG legítimo era rejeitado
 * ao cadastrar produto ("Arquivo(s) rejeitado(s) — não é um SVG
 * válido/seguro"). Caso relatado: "PLANIFICAÇÃO TROFÉU 8MM.svg".
 *
 * Causa raiz (duas partes, confirmadas lendo svgSanitizar(), não
 * suposição):
 * 1) BOM (U+FEFF) no início do arquivo — comum em exports Windows/UTF-8
 *    com BOM — não é removido por String.trim() (categoria Unicode "Cf",
 *    não espaço em branco); o texto "começava" com um caractere invisível
 *    antes de "<?xml"/"<svg", falhando o regex de reconhecimento.
 * 2) Comentário do gerador ANTES de <svg> — ex.: "<!-- Generator: Adobe
 *    Illustrator ... -->" — padrão extremamente comum em exports de
 *    software vetorial (Illustrator/CorelDRAW), nunca era tolerado pelo
 *    regex (só aceitava <?xml?> e <!DOCTYPE> opcionais antes de <svg>).
 *
 * Corrigido: BOM removido explicitamente; regex passa a tolerar
 * comentários XML antes de <svg>. A validação de SEGURANÇA (DOMParser +
 * remoção de tags/atributos perigosos) não foi tocada — continua
 * bloqueando script, on-handlers, javascript:, foreignObject e referências externas.
 *
 * Este teste usa um parser XML minimalista PRÓPRIO (não uma lib externa —
 * o projeto não tem DOMParser/xmldom disponível em Node) suficiente para
 * exercitar a função REAL svgSanitizar() extraída de index.html (nunca
 * reimplementada) ponta a ponta: reconhecimento do prefixo, remoção de
 * tags/atributos perigosos, serialização.
 *
 * Uso: node scripts/test_hotfix_svg_upload_produto_2026-08-22.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }
function assertNull(v, msg) { assertTrue(v === null, msg + (v !== null ? ' (obtido: ' + JSON.stringify(v) + ')' : '')); }
function assertNotNull(v, msg) { assertTrue(v !== null && v !== undefined, msg + ' (obtido: ' + JSON.stringify(v) + ')'); }

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

// ── Parser XML minimalista (só para viabilizar o teste — svgSanitizar()
// em si é a função REAL extraída de index.html) ─────────────────────────
function MiniElement(tagName) {
  this.nodeName = tagName;
  this.localName = tagName;
  this.tagName = tagName;
  this._attrs = [];
  this.childNodes = [];
  this.parentNode = null;
}
Object.defineProperty(MiniElement.prototype, 'attributes', { get: function () { return this._attrs.slice(); } });
MiniElement.prototype.setAttribute = function (name, value) { this._attrs.push({ name: name, value: value }); };
MiniElement.prototype.removeAttribute = function (name) { this._attrs = this._attrs.filter(function (a) { return a.name !== name; }); };
MiniElement.prototype.getAttribute = function (name) { var a = this._attrs.find(function (x) { return x.name === name; }); return a ? a.value : null; };
MiniElement.prototype.appendChild = function (child) { child.parentNode = this; this.childNodes.push(child); };
MiniElement.prototype.removeChild = function (child) {
  var i = this.childNodes.indexOf(child);
  if (i >= 0) this.childNodes.splice(i, 1);
  child.parentNode = null;
};

function miniParse(xmlText) {
  // Remove comentários e declaração/doctype antes de tokenizar — só
  // precisamos montar a árvore de elementos reais.
  var t = xmlText.replace(/<\?xml[^>]*\?>/i, '').replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '').replace(/<!--[\s\S]*?-->/g, '');
  var tagRe = /<\/?([a-zA-Z_][\w:-]*)((?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*"[^"]*")*)\s*(\/?)\s*>/g;
  var stack = [];
  var root = null;
  var m, lastIndex = 0;
  var malformed = false;
  while ((m = tagRe.exec(t))) {
    var full = m[0], tagName = m[1], attrsStr = m[2], selfClose = m[3] === '/';
    var isClose = full.charAt(1) === '/';
    if (isClose) {
      if (!stack.length || stack[stack.length - 1].nodeName !== tagName) { malformed = true; break; }
      stack.pop();
      continue;
    }
    var el = new MiniElement(tagName);
    var attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g, am;
    while ((am = attrRe.exec(attrsStr))) el.setAttribute(am[1], am[2]);
    if (stack.length) stack[stack.length - 1].appendChild(el); else if (root) malformed = true;
    if (!root) root = el;
    if (!selfClose) stack.push(el);
  }
  if (stack.length) malformed = true;
  return { root: root, malformed: malformed };
}
function collectAll(el, out) {
  out.push(el);
  el.childNodes.forEach(function (c) { collectAll(c, out); });
  return out;
}
function serialize(el) {
  var attrs = el.attributes.map(function (a) { return ' ' + a.name + '="' + a.value + '"'; }).join('');
  if (!el.childNodes.length) return '<' + el.tagName + attrs + '/>';
  return '<' + el.tagName + attrs + '>' + el.childNodes.map(serialize).join('') + '</' + el.tagName + '>';
}
global.DOMParser = function () {};
global.DOMParser.prototype.parseFromString = function (text, mime) {
  var r = miniParse(text);
  var errEls = r.malformed ? [new MiniElement('parsererror')] : [];
  return {
    documentElement: r.root,
    getElementsByTagName: function (name) {
      if (name === 'parsererror') return errEls;
      if (!r.root) return [];
      var all = collectAll(r.root, []);
      return name === '*' ? all : all.filter(function (e) { return e.nodeName.toLowerCase() === name.toLowerCase(); });
    }
  };
};
global.XMLSerializer = function () {};
global.XMLSerializer.prototype.serializeToString = function (el) { return serialize(el); };

var FN_NAMES = ['svgSanitizar'];
var src = FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_svg_sanitizar_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 9, Bloco F — SVG legítimo rejeitado no cadastro de produto ===\n');

var SVG_SIMPLES = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="0" y="0" width="10" height="10"/></svg>';

// ── 1-8: variações de SVG legítimo que TÊM que ser aceitas ──────────────
assertNotNull(mod.svgSanitizar(SVG_SIMPLES), '1. SVG simples — aceito');
assertNotNull(mod.svgSanitizar('<?xml version="1.0" encoding="UTF-8"?>\n' + SVG_SIMPLES), '2. SVG com cabeçalho XML — aceito');
assertNotNull(mod.svgSanitizar('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10"/></svg>'), '3. SVG com viewBox — aceito');
assertNotNull(mod.svgSanitizar('<svg xmlns="http://www.w3.org/2000/svg"><g id="camada1"><rect x="0" y="0" width="10" height="10"/></g></svg>'), '4. SVG com groups (<g>) — aceito');
assertNotNull(mod.svgSanitizar('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/><path d="M5 5 L15 15"/><path d="M1 1 L2 2"/></svg>'), '5. SVG com múltiplos <path> — aceito');
assertNotNull(mod.svgSanitizar('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect x="0" y="0" width="10" height="10"/></svg>'), '6. SVG com namespaces (xmlns:xlink) — aceito');
// nome com espaços/acento: o nome do ARQUIVO nunca entra na validação de
// conteúdo (só é usado na mensagem de erro/label) — confirma que
// svgSanitizar() aceita o mesmo conteúdo independentemente do nome do
// arquivo que o chamaria (testes 7/8 documentam essa garantia).
assertNotNull(mod.svgSanitizar(SVG_SIMPLES), '7. mesmo conteúdo que seria salvo com nome "arquivo com espaços.svg" — aceito (nome do arquivo nunca afeta a validação de conteúdo)');
assertNotNull(mod.svgSanitizar(SVG_SIMPLES), '8. mesmo conteúdo que seria salvo com nome "PLANIFICAÇÃO TROFÉU 8MM.svg" — aceito (acento no nome do arquivo nunca afeta a validação de conteúdo)');

// ── 9. Achado real: exportado por software vetorial (BOM + comentário de gerador) ──
(function () {
  var comBom = '﻿<?xml version="1.0" encoding="UTF-8"?>\n' + SVG_SIMPLES;
  assertNotNull(mod.svgSanitizar(comBom), '9a. SVG com BOM (U+FEFF) no início do arquivo — achado original, agora aceito');

  var comComentario = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Adobe Illustrator 24.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n' + SVG_SIMPLES;
  assertNotNull(mod.svgSanitizar(comComentario), '9b. SVG com comentário de gerador (Illustrator) antes de <svg> — achado original, agora aceito');

  var corelStyle = '﻿<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator 19.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' + SVG_SIMPLES;
  assertNotNull(mod.svgSanitizar(corelStyle), '9c. combinação real (BOM + comentário + DOCTYPE, típico de exports Windows) — aceito');
})();

// ── 10. SVG malicioso — continua bloqueado ───────────────────────────────
(function () {
  var comScript = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
  var limpo = mod.svgSanitizar(comScript);
  assertNotNull(limpo, '10a. SVG com <script> não é REJEITADO inteiro (achado: sanitiza, não desliga a feature)');
  assertTrue(limpo.indexOf('<script') === -1, '10b. <script> é removido do conteúdo sanitizado — nunca passa para o DOM');
})();

(function () {
  var comOnload = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>';
  var limpo = mod.svgSanitizar(comOnload);
  assertNotNull(limpo, '11a. SVG com onload não é rejeitado inteiro');
  assertTrue(limpo.indexOf('onload') === -1, '11b. atributo onload é removido — nunca passa para o DOM');
})();

(function () {
  var comHref = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>';
  var limpo = mod.svgSanitizar(comHref);
  assertTrue(limpo.indexOf('javascript:') === -1, '12. href="javascript:..." é removido — nunca passa para o DOM');
})();

(function () {
  var comForeign = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><script>alert(1)</script></foreignObject><rect width="10" height="10"/></svg>';
  var limpo = mod.svgSanitizar(comForeign);
  assertTrue(limpo.indexOf('foreignObject') === -1 && limpo.toLowerCase().indexOf('foreignobject') === -1, '13. <foreignObject> (perigoso, mesmo camelCase real do spec) é removido');
})();

(function () {
  var comExterno = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://evil.example.com/track.png"/></svg>';
  var limpo = mod.svgSanitizar(comExterno);
  assertTrue(limpo.indexOf('evil.example.com') === -1, '14. referência externa (xlink:href http://...) é removida — nunca vaza/carrega recurso externo');
})();

assertNull(mod.svgSanitizar('não é um svg, é só texto qualquer'), '15. conteúdo que não é SVG algum — continua rejeitado');
assertNull(mod.svgSanitizar('<svg><rect></svg>'), '16. SVG malformado (tag não fechada corretamente) — continua rejeitado');
assertNull(mod.svgSanitizar(''), '17. arquivo vazio — continua rejeitado');
assertNull(mod.svgSanitizar(null), '18. entrada nula — continua rejeitado sem lançar exceção');

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
