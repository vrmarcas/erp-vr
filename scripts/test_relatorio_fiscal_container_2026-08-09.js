/**
 * test_relatorio_fiscal_container_2026-08-09.js
 *
 * RODADA 6.1 — achado do smoke de produção (2026-08-09): a aba "Relatório
 * Fiscal" de Relatórios abria completamente em branco. Causa raiz: o
 * painel (#relPgNF / #relNFBody) só existia dentro do container legado
 * #pg-financeiro (permanentemente display:none — nunca visível em tela
 * nem impressão), enquanto o botão da aba vivia no container atual
 * #pg-relatorios. relTab('nf') populava o #relNFBody órfão do container
 * oculto — sem erro no console, mas nada aparecia.
 *
 * Corrigido movendo o painel para dentro de #pg-relatorios (mesma posição
 * relativa das outras abas — Caixa/Mensal/DRE/Contas — logo após "Contas
 * Pagas"), e trocando a formatação monetária manual (.toLocaleString sem
 * maximumFractionDigits, que produzia "R$322,805") pelo finFmt() central,
 * o mesmo já usado pela DRE (relatoriosRender) no mesmo módulo.
 *
 * Uso: node scripts/test_relatorio_fiscal_container_2026-08-09.js
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

function findTagBlock(id) {
  // Localiza <div id="ID" ...> ... </div> correspondente por contagem de chaves <div>/</div>.
  var marker = new RegExp('<div id="' + id + '"');
  var m = marker.exec(html);
  if (!m) return null;
  var start = m.index;
  var i = html.indexOf('>', start) + 1;
  var depth = 1;
  var re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  var mm;
  while ((mm = re.exec(html))) {
    if (mm[0] === '<\/div>') { depth--; if (depth === 0) return { start: start, end: re.lastIndex }; }
    else depth++;
  }
  return null;
}

console.log('\n=== RODADA 6.1 — Relatório Fiscal: container correto + formatação ===\n');

// ── 1-3. Estrutural: relPgNF pertence a #pg-relatorios, não a #pg-financeiro ──
{
  var pgRelatorios = findTagBlock('pg-relatorios');
  var pgFinanceiro = findTagBlock('pg-financeiro');
  if (!pgRelatorios) throw new Error('#pg-relatorios não encontrado — teste desatualizado?');
  if (!pgFinanceiro) throw new Error('#pg-financeiro não encontrado — teste desatualizado?');

  var relPgNFIdx = html.indexOf('<div id="relPgNF"');
  var relNFBodyIdx = html.indexOf('id="relNFBody"');

  test('1. achado real corrigido: #relPgNF agora está DENTRO de #pg-relatorios (container que a página realmente exibe)',
    relPgNFIdx > pgRelatorios.start && relPgNFIdx < pgRelatorios.end, true);

  test('2. #relPgNF não está mais dentro do container legado #pg-financeiro (que nunca é exibido em tela)',
    relPgNFIdx > pgFinanceiro.start && relPgNFIdx < pgFinanceiro.end, false);

  test('3. #relNFBody (onde relFiscalRender() escreve os dados) também está dentro de #pg-relatorios',
    relNFBodyIdx > pgRelatorios.start && relNFBodyIdx < pgRelatorios.end, true);

  // Regressão: as outras abas de Relatórios continuam no lugar certo.
  ['relPgCaixa', 'relPgMensal', 'relPgDRE', 'relPgContas'].forEach(function (id) {
    var idx = html.indexOf('<div id="' + id + '"');
    test('4. regressão — #' + id + ' continua dentro de #pg-relatorios (não regrediu ao mover o painel Fiscal)',
      idx > pgRelatorios.start && idx < pgRelatorios.end, true);
  });
}

// ── 5. Nenhum ID fiscal duplicado no documento inteiro ──────────────────
{
  ['relPgNF', 'relNFBody', 'relTabBtnNF', 'relNFMes', 'relNFMarca'].forEach(function (id) {
    var re = new RegExp('id="' + id + '"', 'g');
    var count = (html.match(re) || []).length;
    test('5. id="' + id + '" aparece exatamente uma vez no documento (sem duplicação ao mover o painel)', count, 1);
  });
}

// ── 6. relFiscalRender() nunca mais usa toLocaleString sem maximumFractionDigits ──
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
{
  var srcFiscalRender = extractFn('relFiscalRender');
  test('6. relFiscalRender() não usa mais toLocaleString sem maximumFractionDigits (achado real: produzia "R$322,805")',
    /toLocaleString\(\s*'pt-BR'\s*,\s*\{\s*minimumFractionDigits\s*:\s*2\s*\}\s*\)/.test(srcFiscalRender), false);
  test('7. relFiscalRender() usa o utilitário central finFmt() (mesmo já usado pela DRE — relatoriosRender — no mesmo módulo)',
    /finFmt\(/.test(srcFiscalRender), true);
}

// ── 8-9. Execução real: valores monetários sempre com 2 casas decimais ──
{
  var FN = ['finFmt', 'FISCAL_STATUS_LABEL', 'relFiscalGetFiltrados', 'relFiscalRecebidoDoOrc', 'relFiscalRender'];
  // FISCAL_STATUS_LABEL é uma variável (var X = {...};), não uma function — extrai por regex simples.
  var srcFiscalLabel = html.match(/var FISCAL_STATUS_LABEL = \{[^}]*\};/)[0];
  var srcCfgEsc = extractFn('cfgEsc');
  var srcFinFmt = 'function finFmt(v){ return \'R$ \'+v.toLocaleString(\'pt-BR\',{minimumFractionDigits:2,maximumFractionDigits:2}); }';
  var srcFiltrados = extractFn('relFiscalGetFiltrados');
  var srcRecebido = extractFn('relFiscalRecebidoDoOrc');
  var srcRender = extractFn('relFiscalRender');
  // HOTFIX BLOCO G/H (Rodada de Hardening, Fase 2, 2026-08-26) — todas as
  // três passaram a normalizar o orçamento via orcEnvNormalizar() (schema
  // legado × ValerIA), nunca reimplementada.
  var srcNormalizar = extractFn('orcEnvNormalizar');

  var src = [srcCfgEsc, srcFinFmt, srcFiscalLabel, srcFiltrados, srcRecebido, srcRender, srcNormalizar].join('\n\n')
    + '\n\nmodule.exports = { relFiscalGetFiltrados, relFiscalRecebidoDoOrc, relFiscalRender };';
  var modPath = path.join(__dirname, '_relatorio_fiscal_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  var _elements = {};
  function makeEl(props) { return Object.assign({ value: '', innerHTML: '' }, props || {}); }
  global.document = { getElementById: function (id) { return _elements[id]; } };

  // achado real: 322805 centavos → 3228.05 reais; ponto flutuante direto
  // de somas sucessivas pode cair no caso-limite ,xx5 e sem
  // maximumFractionDigits o toLocaleString mostra 3 casas.
  var ORC_A = { id: 'ORC-A', nfSolicitada: true, marca: 'vr', dataSalvo: '05/08/2026', cliente: 'Cliente A', valorFinal: 1614.025, statusFiscal: 'pendente' };
  var ORC_B = { id: 'ORC-B', nfSolicitada: true, marca: 'vitre', dataSalvo: '06/08/2026', cliente: 'Cliente B', valorFinal: 1614.025, statusFiscal: 'pendente' };
  global.orcGetEnviados = function () { return [ORC_A, ORC_B]; };
  global.FIN_CR = [];
  global.KB_OS = {};

  _elements = { relNFMes: makeEl({ value: '' }), relNFMarca: makeEl({ value: '' }), relNFBody: makeEl({}) };

  var mod = require(modPath);
  mod.relFiscalRender();

  test('8. achado real (smoke de produção): total do Relatório Fiscal nunca mostra 3 casas decimais (ex.: "R$3.228,05", nunca "R$3.228,050" ou similar)',
    /R\$\s*[\d.]+,\d{2}\D/.test(_elements.relNFBody.innerHTML) && !/,\d{3}\D/.test(_elements.relNFBody.innerHTML), true);

  test('9. total (venda) soma corretamente os dois orçamentos com NF solicitada, sempre em 2 casas: R$ 3.228,05',
    _elements.relNFBody.innerHTML.indexOf('R$ 3.228,05') >= 0, true);
}

// ── 10-11. Filtros não duplicam linhas e respeitam mês/marca ────────────
{
  var srcFiltrados2 = extractFn('relFiscalGetFiltrados');
  // HOTFIX BLOCO G/H (Rodada de Hardening, Fase 2, 2026-08-26) — relFiscalGetFiltrados()
  // passou a normalizar dataSalvo via orcEnvNormalizar(), nunca reimplementada.
  var srcNormalizar2 = extractFn('orcEnvNormalizar');
  var src2 = srcFiltrados2 + '\n\n' + srcNormalizar2 + '\n\nmodule.exports = { relFiscalGetFiltrados };';
  var modPath2 = path.join(__dirname, '_relatorio_fiscal_filtros_extracted.tmp.js');
  fs.writeFileSync(modPath2, src2);
  delete require.cache[require.resolve(modPath2)];

  var _els2 = {};
  global.document = { getElementById: function (id) { return _els2[id]; } };
  var ORC_VR_AGO = { id: 'ORC-1', nfSolicitada: true, marca: 'vr', dataSalvo: '09/08/2026' };
  var ORC_VITRE_AGO = { id: 'ORC-2', nfSolicitada: true, marca: 'vitre', dataSalvo: '10/08/2026' };
  var ORC_VR_JUL = { id: 'ORC-3', nfSolicitada: true, marca: 'vr', dataSalvo: '15/07/2026' };
  var ORC_SEM_NF = { id: 'ORC-4', nfSolicitada: false, marca: 'vr', dataSalvo: '09/08/2026' };
  global.orcGetEnviados = function () { return [ORC_VR_AGO, ORC_VITRE_AGO, ORC_VR_JUL, ORC_SEM_NF]; };

  var mod2 = require(modPath2);

  _els2 = { relNFMes: { value: '' }, relNFMarca: { value: '' } };
  var todos = mod2.relFiscalGetFiltrados();
  test('10. sem filtro: retorna só os com NF solicitada (3 de 4), sem duplicar nenhum',
    todos.map(function (o) { return o.id; }).sort(), ['ORC-1', 'ORC-2', 'ORC-3']);

  _els2 = { relNFMes: { value: '/08/' }, relNFMarca: { value: '' } };
  var soAgo = mod2.relFiscalGetFiltrados();
  test('11. filtro por mês (Agosto): retorna só os 2 de agosto, respeitando o filtro sem duplicar',
    soAgo.map(function (o) { return o.id; }).sort(), ['ORC-1', 'ORC-2']);

  _els2 = { relNFMes: { value: '' }, relNFMarca: { value: 'vitre' } };
  var soVitre = mod2.relFiscalGetFiltrados();
  test('12. filtro por marca (Vitre): retorna só o item Vitre',
    soVitre.map(function (o) { return o.id; }), ['ORC-2']);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
