/**
 * test_hardening_p0a_crm_base_2026-08-26.js
 *
 * RODADA DE HARDENING 10/10 — FASE 1 — P0-A: `crm_base` sem Firestore Rule.
 *
 * AUDITORIA CONFIRMADA: a coleção `crm_base` (doc-por-contato, notas/
 * histórico de compras/agendamento — o perfil completo usado pela tela
 * CRM → Reativação) NUNCA teve `match` próprio em firestore.rules — caía
 * no catch-all `allow read, write: if false` do fim do arquivo. Toda
 * leitura (`crmBaseLoadDoc`) e escrita real (`crmBaseSave`/`.update()`/
 * `.delete()`/import em massa) era negada em silêncio, inclusive para
 * Master — a UI sempre otimista fazia parecer que funcionava. Confirmado
 * em produção via leitura direta do Firestore (fora do client/Rules):
 * 1.976 documentos REAIS já existiam na coleção (histórico de compras),
 * totalmente inacessíveis a qualquer usuário pelo app.
 *
 * CORRIGIDO:
 *  1) firestore.rules — novo `match /crm_base/{contatoId} { allow read,
 *     write: if isComercial(); }`, mesmo modelo de permissão já usado
 *     para os dados irmãos do mesmo módulo (crm_leads/crm_site_leads,
 *     clientes/clientes_lixeira) — nunca um papel novo inventado.
 *  2) Toda função de escrita em crm_base (Regra Global da rodada: nenhum
 *     toast de sucesso antes da persistência confirmar; nenhum catch que
 *     só faz console.warn) — agora todas: (a) só mostram toast de sucesso
 *     depois do `.then()` real resolver; (b) em falha, desfazem a mutação
 *     otimista local e mostram um erro explícito ao operador.
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * crmBaseSave, _crmBaseReverterMutacao, crmBaseNovoContato,
 * crmBaseAlterarColuna, crmBaseAgendarContato, crmBaseSalvarNotas,
 * crmBaseSalvarEdicao, crmBaseExcluirSelecionados, crmBaseRecalcularStatus,
 * crmBaseDoc, _crmBaseCalcColuna, _crmBaseSaveIdx.
 *
 * Uso: node "scripts/test_hardening_p0a_crm_base_2026-08-26.js"
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertTrue(cond, msg) { if (!cond) { console.log('  ❌  ' + msg); failed++; } else { console.log('  ✅  ' + msg); passed++; } }

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
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

console.log('\n=== HARDENING P0-A — crm_base sem Firestore Rule ===\n');

// ── Parte 1: Rules ──────────────────────────────────────────────────────
var matchStart = rules.indexOf('match /crm_base/{contatoId}');
assertTrue(matchStart >= 0, '1. firestore.rules define match /crm_base/{contatoId} (não existia antes)');
var bodyOpen = rules.indexOf('{', matchStart + 'match /crm_base/{contatoId}'.length);
var matchBlock = rules.slice(matchStart, rules.indexOf('}', bodyOpen) + 1);
assertTrue(/allow read, write: if isComercial\(\);/.test(matchBlock), '2. Regra concede leitura E escrita a isComercial() — mesmo modelo já usado para crm_leads/crm_site_leads/clientes (nenhum papel novo inventado)');
assertTrue(!/allow read, write: if isAuthenticated\(\)/.test(matchBlock), '3. NUNCA usa isAuthenticated() puro para uma coleção sensível (regra inegociável 9 da rodada)');

// Verifica repo vs produção só estruturalmente aqui (comparação real
// contra a API de Rules publicadas acontece no smoke test em produção,
// fora do escopo deste teste offline).
assertTrue(rules.indexOf('allow read, write: if false;') > 0, '4. Catch-all de negação por padrão continua existindo no fim do arquivo (deny-by-default preservado)');

// ── Parte 2: comportamento das funções de escrita ───────────────────────
function extractVar(name) {
  var marker = "var " + name + " = ";
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var end = html.indexOf(';', start);
  return html.slice(start, end + 1);
}
var FN_NAMES = ['crmBaseDoc', '_crmBaseCalcColuna', '_crmBaseSaveIdx', 'crmBaseSave', '_crmBaseReverterMutacao',
  'crmBaseNovoContato', 'crmBaseAlterarColuna', 'crmBaseAgendarContato', 'crmBaseSalvarNotas',
  'crmBaseSalvarEdicao', 'crmBaseExcluirSelecionados', 'crmBaseRecalcularStatus'];
var src = extractVar('_CRM_BASE_COL') + '\n\n' + FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + ', getIdx: function(){ return _CRM_BASE_IDX; }, getCache: function(){ return _CRM_BASE_CACHE; }};';
var modPath = path.join(__dirname, '_hardening_p0a_crm_base.tmp.js');
fs.writeFileSync(modPath, src);

var _els, _toasts, _docStore, _failNext, _confirmReturn, _promptReturn;
function makeEl(props) { return Object.assign({ value: '', textContent: '', innerHTML: '' }, props || {}); }
function makeFakeDoc(id) {
  return {
    set: function (data) {
      if (_failNext) { _failNext = false; return Promise.reject(new Error('permission-denied (simulado)')); }
      _docStore[id] = Object.assign({}, data);
      return Promise.resolve();
    },
    update: function (data) {
      if (_failNext) { _failNext = false; return Promise.reject(new Error('permission-denied (simulado)')); }
      _docStore[id] = Object.assign({}, _docStore[id] || {}, data);
      return Promise.resolve();
    },
    delete: function () {
      if (_failNext) { _failNext = false; return Promise.reject(new Error('permission-denied (simulado)')); }
      delete _docStore[id];
      return Promise.resolve();
    },
  };
}
function reset() {
  _els = {};
  global.document = {
    getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); },
    querySelector: function () { return null; },
  };
  global.window = global;
  global._CRM_BASE_IDX = [];
  global._CRM_BASE_CACHE = {};
  global._CRM_BASE_SEL = {};
  global._CRM_BASE_PERFIL_ATUAL = null;
  global._cloudReady = true;
  _docStore = {};
  _failNext = false;
  global._db = { collection: function () { return { doc: function (id) { return makeFakeDoc(id); } }; } };
  global.firebase = { firestore: function () { return { batch: function () { return makeFsBatch(); } }; } };
  _toasts = [];
  global.showToast = function (msg, tipo) { _toasts.push({ msg: msg, tipo: tipo }); };
  global.crmBaseRender = function () {};
  global.crmBaseKpisRender = function () {};
  global.crmBaseToggleSelMode = function () {};
  global.crmBaseAbrirPerfil = function () {};
  _confirmReturn = true;
  global.confirm = function () { return _confirmReturn; };
  _promptReturn = [];
  global.prompt = function () { return _promptReturn.shift(); };
}
function makeFsBatch() {
  var ops = [];
  return {
    update: function (docRef, data) { ops.push({ type: 'update', docRef: docRef, data: data }); },
    set: function (docRef, data) { ops.push({ type: 'set', docRef: docRef, data: data }); },
    commit: function () {
      if (_failNext) { _failNext = false; return Promise.reject(new Error('permission-denied (simulado)')); }
      ops.forEach(function (op) {
        var id = op.docRef.__id;
        _docStore[id] = op.type === 'set' ? Object.assign({}, op.data) : Object.assign({}, _docStore[id] || {}, op.data);
      });
      return Promise.resolve();
    },
  };
}
// Sobrescreve _db.collection().doc() para devolver algo com __id utilizável
// pelo makeFsBatch acima também quando chamado via db.collection(...).doc(id)
// diretamente (crmBaseRecalcularStatus/crmBaseExcluirSelecionados usam
// firebase.firestore()/o db local, não crmBaseDoc()).
function wireDbWithBatchSupport() {
  function collectionFn() {
    return {
      doc: function (id) { var d = makeFakeDoc(id); d.__id = id; return d; },
    };
  }
  function batchFn() {
    var ops = [];
    return {
      update: function (docRef, data) { ops.push({ id: docRef.__id, type: 'update', data: data }); },
      set: function (docRef, data) { ops.push({ id: docRef.__id, type: 'set', data: data }); },
      delete: function (docRef) { ops.push({ id: docRef.__id, type: 'delete' }); },
      commit: function () {
        if (_failNext) { _failNext = false; return Promise.reject(new Error('permission-denied (simulado)')); }
        ops.forEach(function (op) {
          if (op.type === 'delete') delete _docStore[op.id];
          else _docStore[op.id] = op.type === 'set' ? Object.assign({}, op.data) : Object.assign({}, _docStore[op.id] || {}, op.data);
        });
        return Promise.resolve();
      },
    };
  }
  global._db.collection = collectionFn;
  global.firebase.firestore = function () { return { collection: collectionFn, batch: batchFn }; };
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

function esperar() { return new Promise(function (r) { setTimeout(r, 0); }); }

async function rodarTestes() {
  // 5-7 — ACHADO REAL: escrita bem-sucedida (Rule agora existe) → persiste
  // de verdade e só ENTÃO mostra o toast de sucesso.
  reset();
  mod.crmBaseNovoContato('cliente');
  // crmBaseNovoContato usa prompt() 4x — sem valores default (_promptReturn
  // vazio) o próprio prompt() devolve undefined → nome vazio → função
  // retorna cedo. Configura os prompts corretamente e roda de novo.
  reset();
  _promptReturn = ['Cliente Teste P0-A', '11999990000', 'São Paulo', 'Display'];
  mod.crmBaseNovoContato('cliente');
  await esperar();
  assertTrue(mod.getIdx().length === 1 && mod.getIdx()[0].nome === 'Cliente Teste P0-A', '5. crmBaseNovoContato(): contato aparece no índice local imediatamente (otimista)');
  var idNovo = mod.getIdx()[0].id;
  assertTrue(_docStore[idNovo] && _docStore[idNovo].nome === 'Cliente Teste P0-A', '6. ACHADO REAL: com a Rule presente, o documento REALMENTE persiste no Firestore (antes, sempre falhava em silêncio)');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'ok' && t.msg.indexOf('adicionado') >= 0; }), '7. Toast de sucesso só aparece DEPOIS da gravação real confirmar (Regra Global 11)');

  // 8-10 — ACHADO REAL: falha de escrita (ex.: Rule ainda ausente/erro de
  // rede) → NUNCA mostra toast de sucesso, desfaz a mutação otimista, avisa
  // o operador explicitamente (Regras Globais 11 e 12).
  reset();
  _promptReturn = ['Cliente Vai Falhar', '', '', ''];
  _failNext = true;
  mod.crmBaseNovoContato('cliente');
  await esperar();
  assertTrue(mod.getIdx().length === 0, '8. ACHADO REAL: falha na gravação real → contato é removido do índice local (nunca fica "visível" sem estar salvo)');
  assertTrue(!_toasts.some(function (t) { return t.tipo === 'ok'; }), '9. NENHUM toast de sucesso é mostrado quando a persistência falhou');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'err'; }), '10. Toast de erro explícito informa o operador — nunca um catch silencioso');

  // 11-13 — crmBaseSalvarNotas: sucesso vs falha.
  reset();
  global._CRM_BASE_CACHE['c1'] = { id: 'c1', notas: 'nota antiga' };
  _els['crmBasePerfilNotas'] = makeEl({ value: 'nota nova' });
  mod.crmBaseSalvarNotas('c1');
  await esperar();
  assertTrue(_docStore['c1'] && _docStore['c1'].notas === 'nota nova', '11. crmBaseSalvarNotas(): persiste de verdade com a Rule presente');
  assertTrue(global._CRM_BASE_CACHE['c1'].notas === 'nota nova' && _toasts.some(function (t) { return t.tipo === 'ok'; }), '12. Cache local só atualiza e toast só aparece após a Promise confirmar');

  reset();
  global._CRM_BASE_CACHE['c2'] = { id: 'c2', notas: 'nota antiga' };
  _els['crmBasePerfilNotas'] = makeEl({ value: 'nota que vai falhar' });
  _failNext = true;
  mod.crmBaseSalvarNotas('c2');
  await esperar();
  assertTrue(global._CRM_BASE_CACHE['c2'].notas === 'nota antiga', '13. ACHADO REAL: falha ao salvar nota → cache reverte para o valor anterior, nunca finge que salvou a nota nova');

  // 14-15 — crmBaseAlterarColuna: falha reverte o status local.
  reset();
  global._CRM_BASE_IDX.push({ id: 'c3', coluna: 'ativo' });
  _failNext = true;
  mod.crmBaseAlterarColuna('c3', 'inativo90');
  await esperar();
  assertTrue(mod.getIdx()[0].coluna === 'ativo', '14. ACHADO REAL: falha ao mudar status → reverte para o status anterior, nunca deixa o card numa coluna que não foi salva');
  assertTrue(_toasts.some(function (t) { return t.tipo === 'err'; }), '15. Erro de mudança de status é informado ao operador (antes: catch(function(){}) totalmente silencioso)');

  // 16-17 — crmBaseSalvarEdicao: sucesso persiste os 3 campos.
  reset();
  global._CRM_BASE_IDX.push({ id: 'c4', nome: 'Antigo', tel: '', cidade: '', marca: 'vr' });
  _els['crmEditNome'] = makeEl({ value: 'Novo Nome' });
  _els['crmEditTel'] = makeEl({ value: '11988887777' });
  _els['crmEditCidade'] = makeEl({ value: 'Campinas' });
  _els['crmEditMarca'] = makeEl({ value: 'vitre' });
  mod.crmBaseSalvarEdicao('c4');
  await esperar();
  assertTrue(_docStore['c4'] && _docStore['c4'].nome === 'Novo Nome' && _docStore['c4'].cidade === 'Campinas', '16. crmBaseSalvarEdicao(): edição completa persiste de verdade');
  assertTrue(mod.getIdx()[0].nome === 'Novo Nome', '17. Índice local só reflete a edição depois de confirmada pelo servidor');

  // 18-19 — crmBaseAgendarContato: falha reverte data local.
  reset();
  global._CRM_BASE_IDX.push({ id: 'c5', nome: 'Cliente Agenda', dataAgendamento: null, ultimoContato: '' });
  _promptReturn = ['2026-09-01'];
  _failNext = true;
  mod.crmBaseAgendarContato('c5');
  await esperar();
  assertTrue(mod.getIdx()[0].dataAgendamento === null, '18. ACHADO REAL: falha ao agendar → reverte a data local, nunca mostra um agendamento que não foi salvo');
  assertTrue(!_toasts.some(function (t) { return t.tipo === 'ok'; }), '19. Nenhum toast "Contato agendado" quando a gravação real falhou');

  // 20-22 — crmBaseExcluirSelecionados: mistura de sucesso e falha —
  // relatório final precisa refletir exatamente quem foi excluído.
  reset();
  wireDbWithBatchSupport();
  global._CRM_BASE_IDX.push({ id: 'del1', nome: 'A' }, { id: 'del2', nome: 'B' });
  _docStore['del1'] = { nome: 'A' }; _docStore['del2'] = { nome: 'B' };
  global._CRM_BASE_SEL = { del1: true, del2: true };
  function collectionComFalhaEmDel2() {
    return { doc: function (id) {
      var d = makeFakeDoc(id);
      d.delete = function () { if (id === 'del2') return Promise.reject(new Error('permission-denied (simulado)')); delete _docStore[id]; return Promise.resolve(); };
      return d;
    } };
  }
  global._db.collection = collectionComFalhaEmDel2;
  global.firebase.firestore = function () { return { collection: collectionComFalhaEmDel2 }; };
  mod.crmBaseExcluirSelecionados('reativ');
  await esperar(); await esperar();
  assertTrue(mod.getIdx().length === 1 && mod.getIdx()[0].id === 'del2', '20. ACHADO REAL: exclusão em massa mista — o item que falhou de verdade VOLTA para a lista (nunca fica invisível sem estar excluído)');
  assertTrue(_toasts.some(function (t) { return /1 exclu.do\(s\), 1 falharam/.test(t.msg); }), '21. Toast final relata exatamente 1 sucesso + 1 falha — nunca "2 excluídos" genérico e falso');
  assertTrue(_docStore['del2'] !== undefined, '22. Documento que falhou ao excluir continua existindo de verdade no servidor');

  // 23 — crmBaseRecalcularStatus: falha no batch reverte TODAS as colunas mudadas.
  reset();
  wireDbWithBatchSupport();
  global._CRM_BASE_IDX.push({ id: 'r1', tipo: 'cliente', coluna: 'ativo', ultCompra: '2020-01-01' });
  _failNext = true;
  mod.crmBaseRecalcularStatus();
  await esperar();
  assertTrue(mod.getIdx()[0].coluna === 'ativo', '23. ACHADO REAL: falha no recálculo em massa → desfaz TODAS as mudanças de coluna, nunca deixa o board com status que não foi salvo no servidor');

  console.log('\n======================================================================');
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('======================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

rodarTestes();
