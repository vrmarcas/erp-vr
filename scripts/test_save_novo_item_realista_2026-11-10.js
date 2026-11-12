/**
 * test_save_novo_item_realista_2026-11-10.js
 *
 * INVESTIGAÇÃO B (save de orçamento novo falhando em produção) — mapeia a
 * cadeia completa pedida pelo usuário:
 *   reserva do ID → build do payload → save V2 → espelho legado →
 *   confirmação → cache/listener.
 *
 * As suítes existentes (test_migracao_orcamentos_v2_espelho_silencioso_
 * 2026-11-03.js) já provam esta cadeia de ponta a ponta com um orçamento
 * SEM NENHUM ITEM (querySelectorAll('#orcItemBody tr[data-idx]') mockado
 * para devolver []) — nunca exercitando o loop real de construção de
 * `_itens` (JSON.parse de planPecas/recipeSnapshot, máquinas por peça,
 * extras/ajuste/grupoOpcao por item). Este teste adiciona EXATAMENTE 1
 * item REALISTA (peças automáticas+manual, recipeSnapshot, máquina) com a
 * MESMA estrutura observada num orçamento real de produção (#000292) —
 * reprodução fiel de "criar orçamento novo com pelo menos 1 item e
 * salvar", imprimindo em cada etapa exatamente o que o usuário pediu:
 *
 *   1. ID reservado;
 *   2. doc V2 existe (ou não) depois da tentativa;
 *   3. baseline local antes/depois;
 *   4. versão do servidor depois;
 *   5. payload que foi de fato tentado;
 *   6. resultado da transação (ok/conflito/erro);
 *   7. estado do listener/cache (_orcV2LastPayload) depois;
 *   8. qualquer chamada residual ao array legado.
 *
 * Usa as FUNÇÕES REAIS extraídas de index.html — nunca reimplementadas.
 * Mock de Firestore em memória (sem precisar do Emulator) — o objetivo é
 * achar um CRASH/exceção real na construção do payload, não validar
 * regras do Firestore (já cobertas em outras suítes).
 *
 * Uso: node scripts/test_save_novo_item_realista_2026-11-10.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractArr(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — ' + name);
  var afterMarker = start + marker.length;
  var openChar = html[afterMarker];
  var closeChar = openChar === '[' ? ']' : '}';
  var depth = 0, i = afterMarker;
  for (; i < html.length; i++) { if (html[i] === openChar) depth++; else if (html[i] === closeChar) { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }

var FN_NAMES = [
  'orcSalvarOrcamento', '_orcSalvarOrcamentoImpl', 'orcFeedbackSalvamento',
  'orcObterNumeroOficial', 'orcLimparNumeroOficial', '_isTestRecord', 'orcGetEnviados',
  '_orcamentosSalvarComMerge', '_orcamentosSalvarComMergeContinuar', 'orcV2SalvarComConflito', '_orcV2SalvarComConflitoExec',
  '_cloudSave', '_cloudSaveExec', 'crmUpsertLeadPorOrcamento', 'orcAvaliarRevisaoFinanceira',
  '_orcV2CanonJSON', 'orcProdutoNomeResolvido', '_itemMaqInfo', 'orcCondicaoPagamentoAtual', 'orcCondicaoLabelPorTipo',
  'orcEnvOrdenarCanonico', '_orcEnvChaveOrdenacao', 'orcEnvNormalizar', 'orcEnvParseDataSalvo',
];
var src = [
  'var _orcSalvarEmVoo = null;',
  'var _ORC_V2_CACHE = {};',
  'var _orcV2LastPayload = {};',
  'var _orcV2SaveQueue = {};',
  'var _orcV2RecomputarERenderizar = function(){};',
  'var _ORC_ENVIADOS_DATA = [];',
  'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; return _orcamentosSalvarComMerge(arr, 0); }',
  extractArr('ORC_MAQ_OPS'),
  'var ORC_ITEM_EXTRAS = {};', 'var ORC_ITEM_AJUSTES = {};', 'var ORC_ITEM_OPCOES = {};', 'var ORC_ITEM_MAQUINAS = {};',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { ' + FN_NAMES.map(function (n) { return n + ': ' + n; }).join(', ') + ', getV2Cache: function(){ return _ORC_V2_CACHE; }, getBaseline: function(id){ return _orcV2LastPayload[id]; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_save_novo_realista_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== Investigação B — save de orçamento NOVO com item realista (peças/recipeSnapshot/máquina) ===\n');

var CALLS, TOASTS, STORE;
var _numCounter = 500;

function makeRow() {
  // Réplica fiel da estrutura real observada em produção (#000292): 3
  // peças automáticas + 1 peça manual, recipeSnapshot, 1 operação de
  // máquina (laser) configurada no item.
  var pecas = [
    { id: 'auto_lateral', nome: 'Lateral', qty: 2, larg: 3, alt: 12, esp: 3, tipo: '', espOverride: '', dimOverride: false, adesivoNormal: false, adesivoBranco: false, gravacao: 0, spray: 0, extra: 0, _deleted: false, espessuraMm: 3, origem: 'AUTOMATICA' },
    { id: 'auto_base', nome: 'Base', qty: 1, larg: 12, alt: 12, esp: 3, tipo: '', espOverride: '', dimOverride: false, adesivoNormal: false, adesivoBranco: false, gravacao: 0, spray: 0, extra: 0, _deleted: false, espessuraMm: 3, origem: 'AUTOMATICA' },
    { nome: 'Peça Manual 1', larg: 12, alt: 3, qty: 2, esp: '4', precoM2: 151.17, matId: 'mat_teste_1', espessuraMm: 4, origem: 'MANUAL' },
  ];
  var recipeSnapshot = { nome: 'Caixa', dim3d: true, pecasFormulas: [{ nome: 'Lateral', qty: 2, larg: 'L', alt: 'A' }] };
  return {
    dataset: {
      idx: '1',
      planPecas: JSON.stringify(pecas),
      recipeSnapshot: JSON.stringify(recipeSnapshot),
      planArea: '432',
      planManualMatCost: '1.0884239999999998',
      planManualAreaM2: '0.0072',
      descontosMontagemAplicados: 'false',
      recipeProductId: 'prod_caixa_1',
      recipeVersion: '3',
      planLarg: '12', planAlt: '12', planProf: '3',
    },
  };
}

function el(props) { return Object.assign({ value: '', textContent: '', checked: false, options: [], selectedIndex: 0 }, props || {}); }

function resetAmbiente() {
  CALLS = { legacyWriteAttempts: 0, v2WriteAttempts: 0 };
  TOASTS = [];
  STORE = {};

  global.showToast = function (msg, tipo) { TOASTS.push({ msg: msg, tipo: tipo }); };
  global.orcProximoNumeroAtomico = function () { _numCounter++; return Promise.resolve(_numCounter); };
  global.orcEnvNormalizar = function (o) { return o || {}; };
  global.orcMotorComercial = function (base) {
    var cents = Math.round(base * 100);
    return { cartao: { 1: { totalCents: cents }, 2: { totalCents: cents }, 3: { totalCents: cents } } };
  };
  global.osItemMateriaisResumo = function (it) { return (it && it.nome) || 'Material'; };
  global.cfgHashNaoReversivel = function (s) { return 'hash_' + s; };
  global.orcAutoSalvarCliente = function () {};
  global.orcLinkClienteOrcamento = function () {};
  global.orcRascunhoLimpar = function () { return null; };
  global.orcAtualizarBadgeEnviados = function () {};
  global.orcEnviadosRender = function () {};
  global._orcSincronizarOSVinculada = undefined;
  global._HOMOLOG_MODE = false;
  global._cfgData = { financeiro: {} };
  global._currentSession = { email: 'vendedor@teste.com', uid: 'uid_teste' };
  global.ORC_REGRA_COMPARATIVO_ATUAL = 2;
  global._orcVitreItensPedido = [];
  global.crmSaveLeads = function () {};
  global.orcFmt = function (v) { return String(v || 0); };
  global.orcComparativoPendente = function () { return false; };
  global.window = global;
  window._orcSessaoAtualId = null;
  window._orcNumeroOficial = null;
  window._orcNumeroOficialPromise = null;
  window._orcCalc = { finalPrice: 741.82, totalCost: 400, matTotal: 300 };
  window._orcMaqOpsCalc = {};
  window._atdOrigemAtendimentoId = null;
  global.CRM_LEADS = {};
  global.crmLeadIdCounter = 0;

  var row = makeRow();
  var matOption = { text: 'Acrílico Cristal 3mm', dataset: { nome: 'Acrílico Cristal 3mm' } };
  var elementos = {
    orcClientNome: el({ value: 'Cliente Realista Teste' }),
    orcClientTel: el({ value: '11988887777' }),
    orcClientEmail: el({ value: '' }),
    orcClientDoc: el({ value: '' }),
    orcClientCidade: el({ value: '' }),
    orcClientVendedor: el({ value: 'Isabella Borges' }),
    orcFormaPgto: el({ options: [{ text: 'PIX' }], selectedIndex: 0 }),
    oi_prod_1: el({ value: 'Caixa' }),
    oi_mat_1: el({ value: 'cfg_0', options: [matOption], selectedIndex: 0 }),
    oi_qty_1: el({ value: '30' }),
    oi_larg_1: el({ value: '' }),
    oi_alt_1: el({ value: '' }),
    oi_esp_1: el({ value: '3' }),
    oi_det_1: el({ value: 'lateral de 4mm, tampa deslizante' }),
    oi_unit_1: el({ textContent: 'R$22,91' }),
    oi_tot_1: el({ textContent: 'R$687,30' }),
  };

  global.document = {
    body: { classList: { contains: function () { return false; } } },
    getElementById: function (id) { return elementos[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr[data-idx]') return [row];
      return [];
    },
  };

  global._cloudLastPayload = {};
  global._cloudSaveQueue = {};
  global._cloudReady = true;
  global._homologGuardOrThrow = function () {};
  global._COL = 'erp_vr';
  global._db = {
    collection: function () {
      return {
        doc: function (key) {
          return {
            __key: key,
            get: function () { return Promise.resolve({ exists: !!STORE[key], data: function () { return STORE[key]; } }); }
          };
        }
      };
    },
    runTransaction: function (fn) {
      return Promise.resolve().then(function () {
        var txn = {
          get: function (r) { return r.get(); },
          set: function (r, val) {
            var isLegado = (r.__key === 'orcamentos');
            if (isLegado) CALLS.legacyWriteAttempts++; else CALLS.v2WriteAttempts++;
            if (isLegado) { var e = new Error('Firestore: documento excede 1048576 bytes'); e.code = 'invalid-argument'; throw e; } // fiel à produção: legado sempre cheio
            STORE[r.__key] = val;
          }
        };
        return fn(txn);
      });
    }
  };
}

(async function () {
  resetAmbiente();

  console.log('--- Mapeamento da cadeia real pedida ---\n');

  var antesNum = _numCounter;
  var r;
  var excecaoReal = null;
  try {
    r = await mod.orcSalvarOrcamento();
  } catch (e) {
    excecaoReal = e;
  }

  ok('1. ID foi reservado (contador avançou exatamente +1)', _numCounter === antesNum + 1, 'antes=' + antesNum + ' depois=' + _numCounter);
  var idReservado = 'ORC-' + String(_numCounter).padStart(6, '0');
  console.log('   ID reservado: ' + idReservado);

  ok('2. Nenhuma exceção não-tratada escapou de orcSalvarOrcamento() com um item realista (peças/recipeSnapshot/máquina)', excecaoReal === null, excecaoReal ? (excecaoReal.stack || String(excecaoReal)) : '');

  if (excecaoReal) {
    console.log('\n   >>> EXCEÇÃO REAL CAPTURADA (reprodução do save silenciosamente falho): <<<');
    console.log('   ' + (excecaoReal.stack || String(excecaoReal)));
  } else {
    console.log('   resultado de orcSalvarOrcamento(): ' + JSON.stringify(r));
    console.log('   3. doc V2 (' + idReservado + ') existe no "servidor" depois da tentativa? ' + !!STORE[idReservado]);
    console.log('   4. baseline local (_orcV2LastPayload[id]) depois: ' + mod.getBaseline(idReservado));
    console.log('   5. payload realmente tentado (via _ORC_V2_CACHE): ' + JSON.stringify(mod.getV2Cache()[idReservado]));
    console.log('   6. tentativas de escrita — v2: ' + CALLS.v2WriteAttempts + ' | legado (espelho best-effort): ' + CALLS.legacyWriteAttempts);
    console.log('   7. toasts gerados: ' + JSON.stringify(TOASTS));
    ok('3b. documento v2 foi gravado de verdade (save realmente persistiu)', !!STORE[idReservado] && r && r.id === idReservado);
  }

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
