/**
 * test_rodada_critica_leitura_iniciar_producao_2026-08-26.js
 *
 * RODADA CRÍTICA DE ESTABILIZAÇÃO DE LEITURA E CONFIABILIDADE — bloqueador
 * P0: Kanban → Abrir OS → Iniciar Produção → falha intermitente ao ler
 * Estoque/Retalhos.
 *
 * CAUSA RAIZ (auditoria de código, confirmada por reprodução ao vivo em
 * produção): _kbOpenProdOverlay() lia as variáveis globais STOCK/RETALHOS
 * de forma SÍNCRONA no instante do clique em "Iniciar Produção". STOCK vem
 * de um onSnapshot próprio e RETALHOS de _cloudWatch('retalhos', ...) —
 * nenhum dos dois é bloqueado por _cloudReady (cada coleção resolve seu
 * próprio round-trip de rede de forma independente). Numa sessão recém-
 * aberta (login fresco, navegação rápida), era perfeitamente possível
 * clicar ANTES da 1ª resposta do servidor chegar — STOCK/RETALHOS ainda
 * nos defaults vazios — e nem _STOCK_LOAD_ERROR nem
 * _CLOUD_WATCH_ERROR['retalhos'] ficavam true (não houve erro nenhum, só
 * ainda não chegou), então o aviso de "falha ao carregar" (RODADA 9,
 * Bloco B, 2026-08-22) nunca disparava: o operador só via os dois
 * dropdowns vazios, indistinguível de "não há nada cadastrado". Isso
 * reproduz exatamente o padrão relatado: "funciona depois de visitar
 * Estoque antes" (dava tempo do listener resolver) vs "falha indo direto
 * ao Kanban" (mesma sessão, só que mais rápida).
 *
 * Corrigido diferenciando 3 estados reais — carregando / confirmado (com
 * ou sem erro) / falhou — nunca mais tratando "ainda não respondeu" como
 * "vazio":
 *   - _stockServerConfirmed (já existia, RODADA 9) e o novo
 *     _CLOUD_WATCH_CONFIRMED[key] (aditivo, dentro de _cloudWatch) agora
 *     são a fonte de verdade de "o servidor já respondeu para esta
 *     chave" — nunca inferido pela ausência de erro.
 *   - _kbOpenProdOverlay() abre o modal imediatamente mostrando um estado
 *     de carregamento explícito enquanto aguarda, faz polling curto e
 *     LIMITADO (200ms × 25 = 5s, nunca infinito) até os dados confirmarem,
 *     e só então popula os selects — nunca lê STOCK/RETALHOS antes disso.
 *   - Se esgotar o polling ou já houver erro conhecido, mostra estado de
 *     falha explícito com botão manual "🔄 Tentar novamente" — nunca
 *     mascarado como "nenhum material cadastrado".
 *   - _kbProdOverlayEpoch invalida qualquer polling pendente se o
 *     operador fechar o modal ou abrir outra OS enquanto esperava (mesma
 *     disciplina de token/versão do Objetivo 7/8 da rodada — um ciclo de
 *     espera antigo nunca pode popular a tela de uma OS diferente).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * _cloudWatch, _kbOpenProdOverlay, _kbProdDadosProntos,
 * _kbProdMostrarCarregando, _kbProdMostrarFalhaCarregamento,
 * _kbProdTentarNovamente, _kbProdAguardarDadosERenderizar,
 * _kbProdRenderSelects, kbCloseProd, _kbRetalhoOptionLabel,
 * kbNecessidadesPecasOS.
 *
 * Uso: node "scripts/test_rodada_critica_leitura_iniciar_producao_2026-08-26.js"
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
function extractVar(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}

console.log('\n=== RODADA CRÍTICA — Leitura de Estoque/Retalhos ao Iniciar Produção ===\n');

var FN_NAMES = [
  '_kbOpenProdOverlay', '_kbProdDadosProntos', '_kbProdMostrarCarregando',
  '_kbProdMostrarFalhaCarregamento', '_kbProdTentarNovamente',
  '_kbProdAguardarDadosERenderizar', '_kbProdRenderSelects', 'kbCloseProd',
  '_kbRetalhoOptionLabel', 'kbNecessidadesPecasOS',
];
var src = extractVar('_kbProdOverlayEpoch') + '\n\n'
  + FN_NAMES.map(extractFn).join('\n\n')
  + '\n\nmodule.exports = {' + FN_NAMES.join(',') + ', getEpoch: function(){ return _kbProdOverlayEpoch; }};';
var modPath = path.join(__dirname, '_rodada_critica_iniciar_producao.tmp.js');
fs.writeFileSync(modPath, src);

// ── _cloudWatch: confirma que _CLOUD_WATCH_CONFIRMED é marcado no ponto
// real onde a resposta do servidor chega (sucesso E "documento ainda não
// existe" — nunca em erro), sem alterar nenhum comportamento existente
// (mesmo payload, mesmo callback, mesma assinatura). ──────────────────────
var FN_NAMES_WATCH = ['_homologGuardOrThrow', '_cloudWatch'];
var srcWatch = extractVar('_CLOUD_WATCH_ERROR') + '\n\n'
  + extractVar('_CLOUD_WATCH_CONFIRMED') + '\n\n'
  + extractVar('_CLOUD_WATCH_FORBIDDEN') + '\n\n'
  + FN_NAMES_WATCH.map(extractFn).join('\n\n')
  + '\n\nmodule.exports = {_cloudWatch:_cloudWatch, getErr: function(){return _CLOUD_WATCH_ERROR;}, getConf: function(){return _CLOUD_WATCH_CONFIRMED;}, getForb: function(){return _CLOUD_WATCH_FORBIDDEN;}};';
var modPathWatch = path.join(__dirname, '_rodada_critica_cloudwatch.tmp.js');
fs.writeFileSync(modPathWatch, srcWatch);

function makeFakeDb(behavior) {
  return {
    collection: function () {
      return {
        doc: function () {
          return {
            onSnapshot: function (successCb, errCb) {
              if (behavior.type === 'success') successCb({ exists: true, data: function () { return { data: JSON.stringify(behavior.payload) }; }, metadata: { fromCache: false } });
              else if (behavior.type === 'not-exists') successCb({ exists: false });
              else if (behavior.type === 'error') errCb(new Error('permission-denied (simulado)'));
              return function unsub() {};
            },
          };
        },
      };
    },
  };
}

function resetCloudWatch(behavior) {
  global._HOMOLOG_MODE = false;
  global._HOMOLOG_EMULATORS_CONNECTED = false;
  global._db = makeFakeDb(behavior);
  global._COL = 'erp_vr';
  global._cloudLastPayload = {};
  global._CLOUD_UNSUBS = [];
  delete require.cache[require.resolve(modPathWatch)];
  return require(modPathWatch);
}

var modWatch1 = resetCloudWatch({ type: 'success', payload: [{ codigo: 'r1', qty: 1 }] });
var _watchCbCalled1 = null;
modWatch1._cloudWatch('retalhos', function (d) { _watchCbCalled1 = d; });
assertTrue(modWatch1.getConf()['retalhos'] === true, '15. _cloudWatch marca _CLOUD_WATCH_CONFIRMED no sucesso — a fonte de verdade que o overlay de Iniciar Produção agora consulta');
assertTrue(_watchCbCalled1 && _watchCbCalled1.length === 1, '16. Callback original de _cloudWatch continua recebendo os dados normalmente — nenhuma regressão de comportamento');

var modWatch2 = resetCloudWatch({ type: 'not-exists' });
var _watchCbCalled2 = false;
modWatch2._cloudWatch('retalhos', function () { _watchCbCalled2 = true; });
assertTrue(modWatch2.getConf()['retalhos'] === true, '17. Documento ainda não existe no Firebase: também conta como confirmado (resposta REAL do servidor, nunca "ainda carregando")');
assertTrue(_watchCbCalled2 === false, '18. Documento inexistente nunca chama o callback (mesmo comportamento de sempre — quem depende do watch mantém seu default)');

var modWatch3 = resetCloudWatch({ type: 'error' });
modWatch3._cloudWatch('retalhos', function () {});
assertTrue(modWatch3.getErr()['retalhos'] === true, '19. Erro real de leitura continua marcando _CLOUD_WATCH_ERROR (comportamento pré-existente preservado)');
assertTrue(!modWatch3.getConf()['retalhos'], '20. Erro real NUNCA marca como "confirmado com sucesso" — o overlay deve tratar como falha, não como dado vazio');

function makeEl(props) { return Object.assign({ value: '', textContent: '', innerHTML: '', checked: false, disabled: false, classList: { _open: false, add: function(c){ if(c==='open') this._open=true; }, remove: function(c){ if(c==='open') this._open=false; }, contains: function(c){ return c==='open' ? this._open : false; } }, style: {}, dataset: {} }, props || {}); }

var _els, _timers, _toasts;
function reset(opts) {
  opts = opts || {};
  _els = {
    kbProdSubtitle: makeEl(), kbProdMatSel: makeEl(), kbProdRetalhoSel: makeEl(),
    kbProdQty: makeEl(), kbProdObs: makeEl(), kbProdStockInfo: makeEl({ style: {} }),
    kbProdSugestaoBox: makeEl({ style: {} }),
    kbProdOverlay: makeEl(),
  };
  global.document = {
    getElementById: function (id) { return _els[id] || null; },
    querySelector: function (sel) { if (sel.indexOf('.gen-submit') >= 0) return _els.kbProdOverlay._submitBtn || (_els.kbProdOverlay._submitBtn = makeEl()); return null; },
  };
  global.window = global;
  global.STOCK = opts.stock || {};
  global.RETALHOS = opts.retalhos || [];
  global._stockServerConfirmed = !!opts.stockConfirmed;
  global._STOCK_LOAD_ERROR = !!opts.stockErro;
  global._CLOUD_WATCH_CONFIRMED = { retalhos: !!opts.retalhosConfirmed };
  global._CLOUD_WATCH_ERROR = { retalhos: !!opts.retalhosErro };
  global._kbProdEditMode = false;
  global._kbProdTipo = 'chapa';
  global.KB_OS = opts.kbOs || {};
  global._kbOsId = opts.kbOsId || null;
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  global.kbProdSetTipo = function () {};
  global.kbProdOnMatChange = function () {};
  global.kbProdCheckStock = function () {};
  _timers = [];
  global.setTimeout = function (fn, ms) { _timers.push({ fn: fn, ms: ms }); return _timers.length; };
}
function rodarTimersPendentes(max) {
  max = max || 40;
  var rodados = 0;
  while (_timers.length && rodados < max) {
    var t = _timers.shift();
    rodados++;
    t.fn();
  }
  return rodados;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// 1-3 — CASO FELIZ: dados já confirmados (sem erro) no instante do clique
// → popula os selects imediatamente, nunca mostra estado de carregamento
// travado, submit habilitado.
reset({
  stockConfirmed: true, retalhosConfirmed: true,
  stock: { cfg_1: { label: 'Acrílico Cristal', esp: 3, qty: 5 } },
  retalhos: [{ label: 'Acrílico Cristal', mat: 'cfg_1', dims: '30x40', qty: 2 }],
});
mod._kbOpenProdOverlay({ num: '100', titulo: 'Teste', itens: [] });
assertTrue(_els.kbProdMatSel.innerHTML.indexOf('Acrílico Cristal') >= 0, '1. Dados já confirmados: material aparece no select imediatamente, sem depender de nenhuma navegação prévia');
assertTrue(_els.kbProdRetalhoSel.innerHTML.indexOf('30x40') >= 0, '2. Retalho compatível aparece imediatamente junto com o material');
assertTrue(_els.kbProdOverlay._submitBtn.disabled === false, '3. Botão de confirmar fica habilitado assim que os dados reais chegam');

// 4-6 — ACHADO REAL: dados AINDA NÃO confirmados (sem erro nenhum — só não
// chegaram ainda, o cenário exato que reproduzia a falha intermitente) →
// NUNCA trata como "vazio": mostra carregamento, popula certo assim que
// confirma (simulado via _stockServerConfirmed virando true após alguns
// ticks do polling).
reset({ stockConfirmed: false, retalhosConfirmed: false, stock: {}, retalhos: [] });
mod._kbOpenProdOverlay({ num: '101', titulo: 'Teste', itens: [] });
assertTrue(_els.kbProdMatSel.innerHTML.indexOf('Carregando') >= 0, '4. ACHADO REAL: dados ainda não confirmados (sem erro) → mostra "Carregando…", NUNCA "nenhum material" (a causa raiz da intermitência)');
assertTrue(_els.kbProdOverlay._submitBtn.disabled === true, '5. Submit fica desabilitado enquanto ainda está carregando');
// Simula o servidor respondendo no meio do polling.
global.STOCK = { cfg_2: { label: 'MDF Branco', esp: 6, qty: 3 } };
global._stockServerConfirmed = true;
global._CLOUD_WATCH_CONFIRMED.retalhos = true;
rodarTimersPendentes();
assertTrue(_els.kbProdMatSel.innerHTML.indexOf('MDF Branco') >= 0, '6. Assim que o servidor confirma (durante o polling), o material real aparece automaticamente — sem precisar de refresh nem reabrir o modal');

// 7-8 — dados nunca confirmam dentro do limite (25 tentativas) → estado de
// falha explícito com retry manual, NUNCA loop infinito.
reset({ stockConfirmed: false, retalhosConfirmed: false, stock: {}, retalhos: [] });
mod._kbOpenProdOverlay({ num: '102', titulo: 'Teste', itens: [] });
var tentativas = rodarTimersPendentes(100);
assertTrue(tentativas <= 26, '7. Polling é limitado (no máximo ~25 tentativas) — nunca um loop infinito de timers');
assertTrue(_els.kbProdMatSel.innerHTML.indexOf('Tentar novamente') < 0 && _els.kbProdStockInfo.innerHTML.indexOf('Tentar novamente') >= 0, '8. Esgotado o limite: mostra estado de falha explícito com botão "Tentar novamente", nunca finge que carregou vazio');

// 9-10 — erro conhecido (_STOCK_LOAD_ERROR) desde o início → nunca fica
// preso em "carregando"; mostra falha imediatamente (0 tentativas de
// polling desperdiçadas) com toast explicativo.
reset({ stockConfirmed: false, stockErro: true, retalhosConfirmed: true, stock: {}, retalhos: [] });
mod._kbOpenProdOverlay({ num: '103', titulo: 'Teste', itens: [] });
assertTrue(_els.kbProdStockInfo.innerHTML.indexOf('Tentar novamente') >= 0, '9. Erro de leitura conhecido: mostra falha explícita de imediato, sem esperar o polling esgotar');
assertTrue(_toasts.some(function (t) { return t.tipo === 'err' && t.msg.indexOf('Estoque') >= 0; }), '10. Toast de erro específico do Estoque aparece (mesmo comportamento já validado da Rodada 9, preservado)');

// 11-12 — EPOCH: fechar o modal enquanto aguardava não deixa o polling
// popular uma tela que não está mais aberta (mesma disciplina de listener
// antigo não contaminar tela nova).
reset({ stockConfirmed: false, retalhosConfirmed: false, stock: {}, retalhos: [] });
mod._kbOpenProdOverlay({ num: '104', titulo: 'Teste', itens: [] });
mod.kbCloseProd();
global.STOCK = { cfg_3: { label: 'Nunca deveria aparecer', esp: 1, qty: 1 } };
global._stockServerConfirmed = true; global._CLOUD_WATCH_CONFIRMED.retalhos = true;
rodarTimersPendentes();
assertTrue(_els.kbProdMatSel.innerHTML.indexOf('Nunca deveria aparecer') < 0, '11. ACHADO: fechar o modal (kbCloseProd) invalida o polling pendente — dados que chegam depois nunca populam uma tela já fechada');

reset({ stockConfirmed: false, retalhosConfirmed: false, stock: {}, retalhos: [] });
mod._kbOpenProdOverlay({ num: '105', titulo: 'OS antiga', itens: [] });
var epochAntigo = mod.getEpoch();
// Abre outra OS por cima (mesmo padrão real: trocar de OS reabre o overlay).
mod._kbOpenProdOverlay({ num: '106', titulo: 'OS nova', itens: [] });
global.STOCK = { cfg_4: { label: 'Material da OS nova', esp: 2, qty: 4 } };
global._stockServerConfirmed = true; global._CLOUD_WATCH_CONFIRMED.retalhos = true;
rodarTimersPendentes();
assertTrue(mod.getEpoch() !== epochAntigo, '12. Trocar de OS enquanto a anterior ainda esperava dados gera um novo epoch — o ciclo de espera antigo nunca pode atualizar a OS nova');
assertTrue(_els.kbProdSubtitle.textContent.indexOf('106') >= 0, '13. Subtítulo do modal reflete a OS mais recente, nunca a anterior, mesmo com polling cruzado');

// 14 — botão "Tentar novamente" relê a OS atual do estado global (nunca
// um objeto capturado em closure desatualizado) e reinicia corretamente.
reset({ stockConfirmed: true, stockErro: true, retalhosConfirmed: true, kbOs: { 'osX': { num: '999', titulo: 'Retry', itens: [] } }, kbOsId: 'osX', stock: { cfg_5: { label: 'Depois do retry', esp: 4, qty: 2 } } });
mod._kbOpenProdOverlay({ num: '999', titulo: 'Retry', itens: [] });
assertTrue(_els.kbProdStockInfo.innerHTML.indexOf('Tentar novamente') >= 0, '14a. Estado de falha exibido para a OS de teste do botão de retry');
global._STOCK_LOAD_ERROR = false; // "conexão voltou"
mod._kbProdTentarNovamente();
assertTrue(_els.kbProdMatSel.innerHTML.indexOf('Depois do retry') >= 0, '14b. "Tentar novamente" relê o estado atual e popula corretamente assim que os dados ficam disponíveis');

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
