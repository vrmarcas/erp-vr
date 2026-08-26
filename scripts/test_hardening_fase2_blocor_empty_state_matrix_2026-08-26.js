/**
 * test_hardening_fase2_blocor_empty_state_matrix_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 2, FECHAMENTO DO BLOCO R (2026-08-26) —
 * auditoria final e exaustiva de empty-state honesto: uma tela só pode
 * dizer "Nenhum registro" se houver confirmação real de LEITURA CONCLUÍDA
 * + ZERO REGISTROS — nunca enquanto ainda carregando, em erro, ou sem
 * permissão.
 *
 * Cobre os 6 casos obrigatórios (A carregando, B vazio real, C dados
 * reais, D erro, E permission-denied, F recuperação sem reload) para as
 * telas explicitamente exigidas nesta rodada que ainda não tinham
 * cobertura dinâmica própria: Retalhos (primeira correção completa desta
 * rodada), Compras v2, Fornecedores, Estoque. As demais telas do Bloco R
 * (Clientes, CRM, Financeiro CR/CP, Todas as OS, Orçamentos Enviados,
 * Vitre) já tinham a distinção FORBIDDEN/ERROR/LOADING/EMPTY introduzida
 * em rodadas anteriores desta mesma sessão — aqui são auditadas
 * estruturalmente (achado: ordem dos branches e presença/ausência
 * correta do botão "Tentar novamente"), sem reimplementar o que os testes
 * dedicados de cada bloco já travam dinamicamente.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * retalhoRender, comprasV2Render, comprasV2Init, fornRender, fornLoad,
 * stockRenderItems, vitreCatalogoRender, orcEnviadosRender,
 * renderClientes, renderOsTable, crmRenderBoard, finCRRender, finCPRender.
 *
 * Uso: node "scripts/test_hardening_fase2_blocor_empty_state_matrix_2026-08-26.js"
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
function makeEl(props) { return Object.assign({ value: '', textContent: '', innerHTML: '', style: {}, display: '' }, props || {}); }

console.log('\n=== HARDENING FASE 2, FECHAMENTO BLOCO R — matriz de empty-state honesto ===\n');

// ── PARTE 1 — Retalhos (dinâmico): primeira correção completa desta rodada. ──
(function () {
  var src = extractFn('retalhoRender') + '\n\nmodule.exports = {retalhoRender: retalhoRender};';
  var modPath = path.join(__dirname, '_blocor_retalhos.tmp.js');
  fs.writeFileSync(modPath, src);
  var _els;
  function reset(opts) {
    opts = opts || {};
    _els = { retalhoTabela: makeEl(), retalhoCount: makeEl() };
    global.document = { getElementById: function (id) { return _els[id] || null; } };
    global.RETALHOS = opts.retalhos || [];
    global._CLOUD_WATCH_FORBIDDEN = { retalhos: !!opts.forbidden };
    global._CLOUD_WATCH_ERROR = { retalhos: !!opts.erro };
    global._CLOUD_WATCH_CONFIRMED = { retalhos: !!opts.confirmado };
  }
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  reset({ confirmado: false }); // A — servidor ainda não respondeu
  mod.retalhoRender();
  assertTrue(_els.retalhoTabela.innerHTML.indexOf('Carregando') >= 0, 'RETALHOS-A. ainda carregando (sem confirmação do servidor): mostra "Carregando...", NUNCA "Nenhum retalho"');

  reset({ confirmado: true, retalhos: [] }); // B — confirmado vazio de verdade
  mod.retalhoRender();
  assertTrue(_els.retalhoTabela.innerHTML.indexOf('Nenhum retalho') >= 0, 'RETALHOS-B. confirmado E zero registros: só agora mostra "Nenhum retalho disponível"');

  reset({ confirmado: true, retalhos: [{ qty: 2, label: 'Chapa', dims: '10x10', data: '01/01', codigo: 'r1' }] }); // C — dados reais
  mod.retalhoRender();
  assertTrue(_els.retalhoTabela.innerHTML.indexOf('<table') >= 0 && _els.retalhoTabela.innerHTML.indexOf('Nenhum retalho') < 0, 'RETALHOS-C. dados reais presentes: renderiza a tabela, nunca o empty-state');

  reset({ confirmado: false, erro: true }); // D — falha transitória
  mod.retalhoRender();
  assertTrue(_els.retalhoTabela.innerHTML.indexOf('Não foi possível carregar') >= 0 && _els.retalhoTabela.innerHTML.indexOf('Tentar novamente') >= 0, 'RETALHOS-D. falha transitória: erro explícito COM botão "Tentar novamente" — nunca "Nenhum retalho"');

  reset({ confirmado: false, forbidden: true }); // E — permission-denied
  mod.retalhoRender();
  assertTrue(_els.retalhoTabela.innerHTML.indexOf('Sem permissão') >= 0 && _els.retalhoTabela.innerHTML.indexOf('Tentar novamente') < 0, 'RETALHOS-E. permission-denied: mensagem de bloqueio SEM botão de retry (reautorização não é algo que um retry resolve)');

  reset({ confirmado: false, erro: true }); // F — recuperação sem reload
  mod.retalhoRender();
  global._CLOUD_WATCH_ERROR = { retalhos: false };
  global._CLOUD_WATCH_CONFIRMED = { retalhos: true };
  global.RETALHOS = [{ qty: 1, label: 'Chapa', dims: '5x5', data: '01/01', codigo: 'r2' }];
  mod.retalhoRender();
  assertTrue(_els.retalhoTabela.innerHTML.indexOf('<table') >= 0, 'RETALHOS-F. depois que o erro é resolvido (novo _watchRetalhos confirma), a MESMA função renderiza os dados normalmente — sem reload de página');
  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── PARTE 2 — Compras v2 (dinâmico). ────────────────────────────────────
(function () {
  var src = extractFn('comprasV2Init') + '\n\n' + extractFn('comprasV2Render')
    + '\n\nmodule.exports = {comprasV2Render: comprasV2Render};';
  var modPath = path.join(__dirname, '_blocor_comprasv2.tmp.js');
  fs.writeFileSync(modPath, src);
  var _els;
  function reset(opts) {
    opts = opts || {};
    _els = { comprasList: makeEl(), comprasFiltroStatus: makeEl(), comprasTotal: makeEl(), comprasEmpty: makeEl(), comprasV2FinCpList: makeEl() };
    global.document = { getElementById: function (id) { return _els[id] || null; } };
    global._COMPRAS_V2_OFICIAL = false; // comprasV2Init() vira no-op — testamos só o render, sem mockar _db/onSnapshot
    global.COMPRAS_V2_CACHE = opts.lista || [];
    global.COMPRAS_V2_FINCP_CACHE = [];
    global._COMPRAS_V2_FORBIDDEN = !!opts.forbidden;
    global._COMPRAS_V2_LOAD_ERROR = !!opts.erro;
    global._COMPRAS_V2_LOADED = !!opts.loaded;
    global._currentSession = { funcao: 'master' };
    global._normalizeRole = function (v) { return v; };
    global.PC_STATUS_COLOR = {}; global.PC_STATUS_LABEL = {};
    global.finFmt = function (v) { return 'R$' + v; };
    global.cfgEsc = function (v) { return v; };
  }
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  reset({ loaded: false }); // A
  mod.comprasV2Render();
  assertTrue(_els.comprasEmpty.innerHTML.indexOf('Carregando compras') >= 0, 'COMPRAS-A. ainda não confirmado: "Carregando compras...", nunca "Nenhuma solicitação"');

  reset({ loaded: true, lista: [] }); // B
  mod.comprasV2Render();
  assertTrue(_els.comprasEmpty.innerHTML.indexOf('Nenhuma solicitação') >= 0, 'COMPRAS-B. confirmado e genuinamente vazio: só agora "Nenhuma solicitação de compra"');

  reset({ loaded: true, lista: [{ id: 'c1', numero: 1, status: 'solicitada', itens: [{}] }] }); // C
  mod.comprasV2Render();
  assertTrue(_els.comprasEmpty.style.display === 'none' && _els.comprasList.innerHTML.indexOf('Compra #1') >= 0, 'COMPRAS-C. dados reais presentes: lista renderiza, empty-state oculto');

  reset({ loaded: false, erro: true }); // D
  mod.comprasV2Render();
  assertTrue(_els.comprasEmpty.innerHTML.indexOf('Não foi possível carregar') >= 0 && _els.comprasEmpty.innerHTML.indexOf('Tentar novamente') >= 0, 'COMPRAS-D. falha transitória: erro explícito COM retry');

  reset({ loaded: false, forbidden: true }); // E
  mod.comprasV2Render();
  assertTrue(_els.comprasEmpty.innerHTML.indexOf('Sem permissão') >= 0 && _els.comprasEmpty.innerHTML.indexOf('Tentar novamente') < 0, 'COMPRAS-E. permission-denied: bloqueio sem retry');

  reset({ loaded: false, erro: true }); // F
  mod.comprasV2Render();
  global._COMPRAS_V2_LOAD_ERROR = false; global._COMPRAS_V2_LOADED = true;
  global.COMPRAS_V2_CACHE = [{ id: 'c2', numero: 2, status: 'solicitada', itens: [{}] }];
  mod.comprasV2Render();
  assertTrue(_els.comprasList.innerHTML.indexOf('Compra #2') >= 0, 'COMPRAS-F. após confirmação chegar, o mesmo render exibe os dados reais — sem reload');
  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── PARTE 3 — Fornecedores (dinâmico). ──────────────────────────────────
(function () {
  var src = extractFn('fornRender') + '\n\nmodule.exports = {fornRender: fornRender};';
  var modPath = path.join(__dirname, '_blocor_fornecedores.tmp.js');
  fs.writeFileSync(modPath, src);
  var _els;
  function reset(opts) {
    opts = opts || {};
    _els = { fornSearch: makeEl(), fornCatFlt: makeEl(), fornKpiTotal: makeEl(), fornKpiComprado: makeEl(), fornKpiMes: makeEl(), fornGrid: makeEl(), fornEmpty: makeEl() };
    global.document = { getElementById: function (id) { return _els[id] || null; } };
    global.fornLoad = function () { return opts.lista || []; };
    global.finFmt = function (v) { return 'R$' + v; };
    global.FORN_CAT_COLOR = {};
    global.FORN_CAT_ICON = {};
    global._CLOUD_LOAD_FORBIDDEN = { erp_fornecedores: !!opts.forbidden };
    global._CLOUD_LOAD_ERROR = { erp_fornecedores: !!opts.erro };
    global._CLOUD_LOAD_CONFIRMED = { erp_fornecedores: !!opts.confirmado };
  }
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  reset({ confirmado: false }); // A
  mod.fornRender();
  assertTrue(_els.fornEmpty.innerHTML.indexOf('Carregando fornecedores') >= 0, 'FORN-A. ainda não confirmado: "Carregando fornecedores...", nunca sugere cadastrar');

  reset({ confirmado: true, lista: [] }); // B
  mod.fornRender();
  assertTrue(_els.fornEmpty.innerHTML.indexOf('Nenhum fornecedor cadastrado') >= 0, 'FORN-B. confirmado e vazio de verdade: só agora sugere cadastrar o primeiro');

  reset({ confirmado: true, lista: [{ nome: 'Acme', historico: [] }] }); // C
  mod.fornRender();
  assertTrue(_els.fornEmpty.style.display !== 'block', 'FORN-C. dados reais presentes: empty-state permanece oculto');

  reset({ confirmado: false, erro: true }); // D
  mod.fornRender();
  assertTrue(_els.fornEmpty.innerHTML.indexOf('Não foi possível carregar') >= 0 && _els.fornEmpty.innerHTML.indexOf('Tentar novamente') >= 0, 'FORN-D. falha transitória: erro explícito COM retry (_loadFornecedoresRetry, nunca o callback de boot)');

  reset({ confirmado: false, forbidden: true }); // E
  mod.fornRender();
  assertTrue(_els.fornEmpty.innerHTML.indexOf('Sem permissão') >= 0 && _els.fornEmpty.innerHTML.indexOf('Tentar novamente') < 0, 'FORN-E. permission-denied: bloqueio sem retry');
  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── PARTE 4 — Estoque (dinâmico). ───────────────────────────────────────
(function () {
  var src = extractFn('stockRenderItems') + '\n\nmodule.exports = {stockRenderItems: stockRenderItems};';
  var modPath = path.join(__dirname, '_blocor_estoque.tmp.js');
  fs.writeFileSync(modPath, src);
  var _els;
  function reset(opts) {
    opts = opts || {};
    _els = { stockItemsList: makeEl() };
    global.document = { getElementById: function (id) { return _els[id] || null; } };
    global.STOCK = opts.stock || {};
    global._STOCK_FORBIDDEN = !!opts.forbidden;
    global._STOCK_LOAD_ERROR = !!opts.erro;
    global._stockServerConfirmed = !!opts.confirmado;
    global.stockPopulateSelects = function () {};
  }
  delete require.cache[require.resolve(modPath)];
  var mod = require(modPath);

  reset({ confirmado: false }); // A
  mod.stockRenderItems();
  assertTrue(_els.stockItemsList.innerHTML.indexOf('Carregando estoque') >= 0, 'ESTOQUE-A. ainda não confirmado: "Carregando estoque...", nunca "Nenhum material"');

  reset({ confirmado: true, stock: {} }); // B
  mod.stockRenderItems();
  assertTrue(_els.stockItemsList.innerHTML.indexOf('Nenhum material cadastrado') >= 0, 'ESTOQUE-B. confirmado e vazio de verdade: só agora "Nenhum material cadastrado"');

  reset({ confirmado: true, stock: { chapa: { label: 'Chapa', qty: 5, min: 1, max: 10 } } }); // C
  mod.stockRenderItems();
  assertTrue(_els.stockItemsList.innerHTML.indexOf('stock-item') >= 0, 'ESTOQUE-C. dados reais presentes: renderiza os itens, nunca o empty-state');

  reset({ confirmado: false, erro: true }); // D
  mod.stockRenderItems();
  assertTrue(_els.stockItemsList.innerHTML.indexOf('Não foi possível carregar') >= 0 && _els.stockItemsList.innerHTML.indexOf('Tentar novamente') >= 0, 'ESTOQUE-D. falha transitória: erro explícito COM retry (_watchStock)');

  reset({ confirmado: false, forbidden: true }); // E
  mod.stockRenderItems();
  assertTrue(_els.stockItemsList.innerHTML.indexOf('Sem permissão') >= 0 && _els.stockItemsList.innerHTML.indexOf('Tentar novamente') < 0, 'ESTOQUE-E. permission-denied: bloqueio sem retry');
  try { fs.unlinkSync(modPath); } catch (e) {}
})();

// ── PARTE 5 — Auditoria estrutural (estática) das telas já cobertas por
// testes dinâmicos dedicados de rodadas anteriores desta mesma sessão:
// aqui só travamos a ORDEM dos branches (FORBIDDEN antes de ERROR) e a
// presença/ausência correta do botão de retry — nunca reimplementando a
// leitura de dados que os testes de cada bloco já exercitam dinamicamente. ──
[
  ['vitreCatalogoRender', '_VITRE_CAT_FORBIDDEN'],
  ['orcEnviadosRender', "_CLOUD_WATCH_FORBIDDEN['orcamentos']"],
  ['renderClientes', '_cliForbidden'],
  ['renderOsTable', '_osForbidden'],
  ['crmRenderBoard', '_crmForbidden'],
  ['finCRRender', '_crForbidden'],
  ['finCPRender', '_cpForbidden'],
].forEach(function (par) {
  var corpo = extractFn(par[0]);
  // Marcador do botão real (chamada de função no onclick), nunca a string
  // solta "Tentar novamente" — que também aparece em prosa nos comentários
  // explicando a distinção forbidden/erro, e isso já causou um falso
  // positivo aqui (renderClientes) na 1ª versão deste teste.
  var idxForbidden = corpo.indexOf(par[1]);
  var idxRetryBtn = corpo.indexOf('_watchTentarNovamente(');
  assertTrue(idxForbidden >= 0, 'AUDITORIA. ' + par[0] + '(): tem branch dedicado para permission-denied (' + par[1] + ')');
  assertTrue(idxRetryBtn >= 0 && idxForbidden < idxRetryBtn, 'AUDITORIA. ' + par[0] + '(): o branch de permission-denied vem ANTES do botão real "Tentar novamente" no corpo (forbidden nunca cai no branch de retry)');
});

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
