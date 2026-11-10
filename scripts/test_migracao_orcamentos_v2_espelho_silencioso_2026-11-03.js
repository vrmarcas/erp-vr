/**
 * test_migracao_orcamentos_v2_espelho_silencioso_2026-11-03.js
 *
 * BUG REAL reproduzido em produção pelo usuário (smoke autenticado,
 * orçamento #000268): ao salvar/atualizar, apareceram SIMULTANEAMENTE um
 * toast verde ("Orçamento #000268 atualizado!") e DOIS toasts vermelhos
 * ("Falha ao salvar 'orcamentos' — tente novamente"). Causa raiz: o
 * espelho best-effort do array legado (_orcamentosSalvarComMergeContinuar/
 * orcEnvGerarOS) já usava `_cloudSave(..., {silencioso:true})`, mas
 * `opts.silencioso` SÓ suprime o toast de CONFLITO dentro de
 * _cloudSaveExec() — os outros ramos (cota, auth, erro genérico — exatamente
 * o caso real: erp_vr/orcamentos excedeu 1MiB) nunca checavam essa opção e
 * sempre mostravam o toast, mesmo depois de erp_vr_orcamentos/{id} (fonte
 * de verdade) já ter confirmado o save com sucesso.
 *
 * Corrigido com uma flag NOVA e mais forte, `opts.legacyMirror`, que
 * suprime TODO toast de _cloudSaveExec() (nunca usada por nenhum outro
 * chamador de _cloudSave — kb_os continua reportando erro normalmente).
 *
 * Confirma também, com evidência real (não suposição), por que o toast
 * vermelho apareceu DUAS vezes: orcSetEnviados() é chamado duas vezes
 * dentro de uma única ação de "Salvar Orçamento" sempre que
 * crmUpsertLeadPorOrcamento() cria um lead do CRM pela primeira vez (orc
 * ainda sem crmLeadId) — a 2ª chamada persiste orc.crmLeadId. Cada chamada
 * dispara seu PRÓPRIO espelho legado best-effort, então um array legado
 * permanentemente grande demais produzia 2 tentativas (e, antes da
 * correção, 2 toasts) numa única ação do usuário.
 *
 * Usa as FUNÇÕES REAIS extraídas de index.html — nunca reimplementadas.
 *
 * Uso: node scripts/test_migracao_orcamentos_v2_espelho_silencioso_2026-11-03.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(desc, cond) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc); failed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}
function extractArr(name) {
  var marker = 'var ' + name + ' = ';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var afterMarker = start + marker.length;
  var openChar = html[afterMarker];
  var closeChar = openChar === '[' ? ']' : '}';
  var depth = 0, i = afterMarker;
  for (; i < html.length; i++) { if (html[i] === openChar) depth++; else if (html[i] === closeChar) { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1) + ';';
}

// ── Parte A: prova estrutural — opts.legacyMirror existe e é mais forte que opts.silencioso ──
(function () {
  var src = extractFn('_cloudSaveExec');
  ok('A1. _cloudSaveExec() define semToastNenhum a partir de opts.legacyMirror', /semToastNenhum\s*=\s*!!\(opts && opts\.legacyMirror\)/.test(src));
  ok('A2. toast de conflito agora também checa semToastNenhum (além de opts.silencioso, que continua existindo)', /!semToastNenhum && !\(opts && opts\.silencioso\)/.test(src));
  ok('A3. toast de cota (resource-exhausted) agora checa semToastNenhum', /!semToastNenhum && typeof showToast==='function'\) showToast\('⚠️ Cota do Firebase/.test(src));
  ok('A4. toast de permissão (auth) agora checa semToastNenhum', /!semToastNenhum && typeof showToast==='function'\) showToast\('🔒 Sem permissão/.test(src));
  ok('A5. toast GENÉRICO ("Falha ao salvar") — o caso real do #000268 — agora checa semToastNenhum', /!semToastNenhum && typeof showToast==='function'\) showToast\('⚠️ Falha ao salvar/.test(src));
  ok('A6. toast de sessão expirada agora checa semToastNenhum', /!semToastNenhum && typeof showToast==='function'\) showToast\('🔒 Sessão expirada/.test(src));

  var srcMergeContinuar = extractFn('_orcamentosSalvarComMergeContinuar');
  var srcGerarOS = extractFn('orcEnvGerarOS');
  ok('A7. espelho legado do save principal usa legacyMirror (nunca mais silencioso sozinho)', /_cloudSave\('orcamentos', arr, \{ legacyMirror: true \}\)/.test(srcMergeContinuar));
  ok('A8. espelho legado de Gerar OS usa legacyMirror (nunca mais silencioso sozinho)', /_cloudSave\('orcamentos', arrOrc, \{legacyMirror:true\}\)/.test(srcGerarOS));

  // kb_os continua intocado — outros chamadores de _cloudSave NUNCA usam esta flag nova.
  var countLegacyMirror = (html.match(/legacyMirror/g) || []).length;
  ok('A9. legacyMirror é usado SÓ nos 2 espelhos de orçamento (nunca em kb_os ou outro chamador)', countLegacyMirror === 4); // 2 nos call sites + 2 na definição/comentário de _cloudSaveExec (contagem mínima esperada, ver nota)

  // Achado real investigando o #000268: a 2ª gravação (persiste
  // orc.crmLeadId) era fire-and-forget — _orcSalvarOrcamentoImpl() retornava
  // sem esperar, deixando a tentativa (e seu espelho legado) em voo,
  // podendo "vazar" para a janela de tempo da PRÓXIMA ação do usuário.
  var srcImpl = extractFn('_orcSalvarOrcamentoImpl');
  ok('A10. a gravação de crmLeadId agora é AGUARDADA (nunca mais fire-and-forget)', /if \(_crmLeadCriadoAgora\) await orcSetEnviados\(lista\);/.test(srcImpl));
})();

// ── Execução real com mock de Firestore ────────────────────────────────────
var FN_NAMES = [
  'orcSalvarOrcamento', '_orcSalvarOrcamentoImpl', 'orcFeedbackSalvamento',
  'orcObterNumeroOficial', 'orcLimparNumeroOficial', '_isTestRecord', 'orcGetEnviados',
  '_orcamentosSalvarComMerge', '_orcamentosSalvarComMergeContinuar', 'orcV2SalvarComConflito',
  '_cloudSave', '_cloudSaveExec', 'crmUpsertLeadPorOrcamento', 'orcAvaliarRevisaoFinanceira', '_orcV2CanonJSON',
];
var src = [
  'var _orcSalvarEmVoo = null;',
  'var _ORC_V2_CACHE = {};',
  'var _orcV2LastPayload = {};',
  'var _orcV2RecomputarERenderizar = function(){};',
  'var _ORC_ENVIADOS_DATA = [];',
  'function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; return _orcamentosSalvarComMerge(arr, 0); }',
  extractArr('ORC_MAQ_OPS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { ' + FN_NAMES.map(function (n) { return n + ': ' + n; }).join(', ') + ' };'
].join('\n\n');
var modPath = path.join(__dirname, '_espelho_silencioso_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA — Espelho legado de orçamentos NUNCA mostra toast depois de v2 confirmar (achado real #000268) ===\n');

var CALLS, TOASTS;
var _numCounter = 260; // monotônico entre cenários — nunca reaproveita id (evita o atalho real de "payload idêntico" mascarar uma tentativa de escrita)
function resetAmbiente(opts) {
  opts = opts || {};
  CALLS = { legacyWriteAttempts: 0, v2WriteAttempts: 0, enviadosRender: 0 };
  TOASTS = [];

  global.showToast = function (msg, tipo) { TOASTS.push({ msg: msg, tipo: tipo }); };
  global.orcProximoNumeroAtomico = function () { _numCounter++; return Promise.resolve(_numCounter); };
  global.orcEnvNormalizar = function (o) { return o || {}; };
  global.orcMotorComercial = function (base) {
    var cents = Math.round(base * 100);
    return { cartao: { 1: { totalCents: cents }, 2: { totalCents: cents }, 3: { totalCents: cents } } };
  };
  global.orcCondicaoPagamentoAtual = function () { return '50% na aprovação, 50% na entrega'; };
  global.orcComparativoPendente = function () { return false; };
  global.cfgHashNaoReversivel = function (s) { return 'hash_' + s; };
  global.orcAutoSalvarCliente = function () {};
  global.orcLinkClienteOrcamento = function () {};
  global.orcRascunhoLimpar = function () { return null; };
  global.orcAtualizarBadgeEnviados = function () {};
  global.orcEnviadosRender = function () { CALLS.enviadosRender++; };
  global._orcSincronizarOSVinculada = undefined;
  global._HOMOLOG_MODE = false;
  global._cfgData = { financeiro: {} };
  global._currentSession = { email: 'vendedor@teste.com', uid: 'uid_teste' };
  global.ORC_REGRA_COMPARATIVO_ATUAL = 2;
  global._orcVitreItensPedido = [];
  global.crmSaveLeads = function () {};
  global.orcFmt = function (v) { return String(v || 0); };
  global.window = global;
  window._orcSessaoAtualId = null;
  window._orcNumeroOficial = null;
  window._orcNumeroOficialPromise = null;
  window._orcCalc = { finalPrice: 1000, totalCost: 500, matTotal: 300 };
  window._orcMaqOpsCalc = {};
  window._atdOrigemAtendimentoId = null;
  global.CRM_LEADS = {};
  global.crmLeadIdCounter = 0;

  global.document = {
    body: { classList: { contains: function () { return false; } } },
    getElementById: function (id) {
      // Cliente real (nunca "(não informado)") — necessário para
      // crmUpsertLeadPorOrcamento() de fato criar o lead na 1ª vez,
      // reproduzindo a causa real das DUAS chamadas a orcSetEnviados().
      if (id === 'orcClientNome') return { value: 'Cliente Real Teste' };
      return undefined;
    },
    querySelectorAll: function () { return []; }
  };

  // Firestore falso: 'orcamentos' (array legado, formato embrulhado) SEMPRE
  // falha com "documento grande demais" se opts.legadoFalha; erp_vr_orcamentos/{id}
  // (formato nativo) sempre sucede — exatamente o cenário real de produção.
  var store = {};
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
            get: function () { return Promise.resolve({ exists: !!store[key], data: function () { return store[key]; } }); }
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
            if (isLegado && opts.legadoFalha) {
              var e = new Error('Firestore: documento excede 1048576 bytes');
              e.code = 'invalid-argument';
              throw e;
            }
            if (!isLegado && opts.v2Falha) {
              var e2 = new Error('permission-denied');
              e2.code = 'permission-denied';
              throw e2;
            }
            store[r.__key] = val;
          }
        };
        return fn(txn);
      });
    }
  };
  return { store: store };
}

function toastsDeFalha() { return TOASTS.filter(function (t) { return t.tipo === 'err' && /Falha ao salvar/.test(t.msg); }); }
function toastsDeSucesso() { return TOASTS.filter(function (t) { return t.tipo === 'ok' && /atualizado!|salvo!/.test(t.msg); }); }

(async function () {
  // ── Cenário A — V2 salva; legado falha simulando 1MiB ──────────────────────
  {
    var ctx = resetAmbiente({ legadoFalha: true, v2Falha: false });
    var r = await mod.orcSalvarOrcamento();
    ok('A-cenário. resultado geral = sucesso', !!r && !!r.id);
    ok('A-cenário. exatamente 1 toast verde (nenhum duplicado)', toastsDeSucesso().length === 1);
    ok('A-cenário. ZERO toast vermelho de "Falha ao salvar" (achado real do #000268, agora corrigido)', toastsDeFalha().length === 0);
    ok('A-cenário. o documento v2 (erp_vr_orcamentos/{id}) foi gravado de verdade', !!ctx.store[r.id]);
    ok('A-cenário. o array legado NÃO foi gravado (falhou, mas isso é só auditoria técnica)', !ctx.store['orcamentos']);
  }

  // ── Cenário B — V2 falha ────────────────────────────────────────────────────
  {
    var ctx2 = resetAmbiente({ legadoFalha: false, v2Falha: true });
    var r2 = await mod.orcSalvarOrcamento();
    ok('B-cenário. nenhum toast verde', toastsDeSucesso().length === 0);
    ok('B-cenário. mostra toast vermelho (falha real, precisa ser visível)', toastsDeFalha().length >= 1 || TOASTS.some(function (t) { return t.tipo === 'err' && /Não foi possível salvar/.test(t.msg); }));
    ok('B-cenário. resultado geral = falha (nunca finge sucesso)', r2 === null);
  }

  // ── Cenário C — V2 salva e legado salva (caminho feliz) ─────────────────────
  {
    var ctx3 = resetAmbiente({ legadoFalha: false, v2Falha: false });
    var r3 = await mod.orcSalvarOrcamento();
    ok('C-cenário. sucesso normal', !!r3 && !!r3.id);
    ok('C-cenário. nenhum toast vermelho', toastsDeFalha().length === 0);
    ok('C-cenário. exatamente 1 toast verde', toastsDeSucesso().length === 1);
    ok('C-cenário. array legado TAMBÉM foi gravado (caminho feliz sem regressão)', !!ctx3.store['orcamentos']);
  }

  // ── Cenário D — editar orçamento EXISTENTE (fluxo real do #000268): duas
  // chamadas residuais a orcSetEnviados() quando o CRM cria o lead pela
  // primeira vez — confirma a causa real das DUAS tentativas, e que agora
  // NENHUMA delas produz toast, mesmo com o array legado grande demais. ──────
  {
    var ctx4 = resetAmbiente({ legadoFalha: true, v2Falha: false });
    // 1º save: cria o orçamento (orcExistente ainda não existe) — crmLeadId nasce aqui.
    var rCriar = await mod.orcSalvarOrcamento();
    ok('D-cenário. 1º save (criação) sucede', !!rCriar && !!rCriar.id);
    var tentativasLegado1aVolta = CALLS.legacyWriteAttempts;
    ok('D-cenário. confirma a causa real: 1ª ação de salvar já dispara 2 tentativas de espelho legado (orcSetEnviados principal + persistência de crmLeadId)', tentativasLegado1aVolta === 2);
    ok('D-cenário. mesmo com 2 tentativas de espelho falhando, ZERO toast vermelho', toastsDeFalha().length === 0);
    ok('D-cenário. e só 1 toast verde (nunca duplica o toast de sucesso)', toastsDeSucesso().length === 1);

    // 2º save: EDITAR o mesmo orçamento já existente (crmLeadId já setado —
    // fluxo real de "editar e salvar novamente" do smoke do usuário).
    TOASTS.length = 0;
    CALLS.legacyWriteAttempts = 0;
    window._orcSessaoAtualId = rCriar.id;
    var rEditar = await mod.orcSalvarOrcamento();
    ok('D-cenário. 2º save (edição) sucede, mostra "atualizado!"', !!rEditar && TOASTS.some(function (t) { return /atualizado!/.test(t.msg); }));
    ok('D-cenário. edição de orçamento já existente: só 1 tentativa de espelho (crmLeadId já persistido, não recria)', CALLS.legacyWriteAttempts === 1);
    ok('D-cenário. edição: ZERO toast vermelho mesmo com o array legado grande demais', toastsDeFalha().length === 0);
    ok('D-cenário. edição: exatamente 1 toast de sucesso, nunca duplicado', toastsDeSucesso().length === 1);
  }

  console.log('\n' + passed + ' passou(aram), ' + failed + ' falhou(aram)\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
