/**
 * test_orcamentos_v2_conflito_mesmo_usuario_2026-11-04.js
 *
 * Achado do smoke de produção pós-migração (2026-11-04): usuário relatou
 * "outro usuário editou o orçamento" durante criar→editar→salvar, SEM
 * nenhuma concorrência real. Investigação desta rodada (ver relatório):
 * reproduzi com fidelidade total (funções reais extraídas de index.html,
 * nunca reimplementadas; listener onSnapshot assíncrono como o real
 * _watchOrcamentosV2) os dois candidatos mais fortes —
 *   1. a 2ª gravação disparada por crmUpsertLeadPorOrcamento (persistir
 *      orc.crmLeadId, ver index.html:31229) correndo contra o próprio
 *      listener que acabou de ecoar a 1ª gravação;
 *   2. "contaminação cruzada": meusIds (_orcamentosSalvarComMergeContinuar)
 *      inclui quase TODOS os orçamentos carregados (achado separado: o
 *      array legado está permanentemente desatualizado em relação ao v2
 *      por causa dos campos de auditoria da migração) — testei se uma
 *      edição concorrente real em OUTRO orçamento qualquer vazava como
 *      falso conflito no save do usuário.
 * Nenhum dos dois reproduziu o falso conflito — ambos passam aqui como
 * regressão (Casos A/B/D). Caso C prova que o conflito REAL continua
 * detectado (nunca "mascarado" pela correção). Instrumentação de
 * diagnóstico (console.error com baseline/servidor/tentativa completos)
 * foi adicionada em orcV2SalvarComConflito para a PRÓXIMA ocorrência ter
 * evidência real, caso recorra por um mecanismo ainda não identificado.
 *
 * Uso: node scripts/test_orcamentos_v2_conflito_mesmo_usuario_2026-11-04.js
 * Não precisa de Firestore Emulator — mock de Firestore em memória com
 * onSnapshot assíncrono fiel (nunca síncrono com quem escreveu).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — ' + name);
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

var FN_NAMES = [
  'orcV2MergeComLegado', '_orcV2RecomputarERenderizar', 'orcGetEnviados',
  'orcSetEnviados', '_orcamentosSalvarComMerge', '_orcamentosSalvarComMergeContinuar',
  'orcV2SalvarComConflito', '_orcV2SalvarComConflitoExec', '_isTestRecord', 'orcReidratarGruposDoServidor',
  'crmUpsertLeadPorOrcamento', '_watchOrcamentosV2', '_orcV2CanonJSON',
  'orcEnvOrdenarCanonico', '_orcEnvChaveOrdenacao', 'orcEnvNormalizar', 'orcEnvParseDataSalvo',
];

var src = [
  'var _ORC_ENVIADOS_DATA = [];',
  'var _ORC_V2_CACHE = {};',
  'var _ORC_LEGADO_CACHE = [];',
  'var _orcV2LastPayload = {};',
  'var _orcV2SaveQueue = {};',
  'var _cloudLastPayload = {};',
  'var _cloudReady = true;',
  'var CRM_LEADS = {};',
  'var crmLeadIdCounter = 0;',
  'function orcEnviadosRender(){}',
  'function orcAtualizarBadgeEnviados(){}',
  'function crmSaveLeads(){}',
  'function orcFmt(v){ return String(v); }',
  "global.document = { getElementById: function(){ return null; } };",
  FN_NAMES.map(extractFn).join('\n\n'),
  // espelho legado SEMPRE falha — fiel à produção real (doc > 1MiB, nunca mais grava).
  'function _cloudSave(key, arr, opts){ return Promise.resolve({ok:false, reason:"erro"}); }',
  'module.exports = {',
  '  orcSetEnviados: orcSetEnviados, orcGetEnviados: orcGetEnviados,',
  '  crmUpsertLeadPorOrcamento: crmUpsertLeadPorOrcamento,',
  '  iniciarListenerV2: function(){ _watchOrcamentosV2(); },',
  '  setState: function(s){ _ORC_LEGADO_CACHE=s.legado||[]; _cloudLastPayload={orcamentos: JSON.stringify(s.legado||[])}; _ORC_V2_CACHE=s.v2||{}; _orcV2LastPayload=s.baseline||{}; _ORC_ENVIADOS_DATA=s.enviados||[]; },',
  '  canonJSON: _orcV2CanonJSON,',
  '};',
].join('\n\n');

var modPath = path.join(__dirname, '_test_conflito_mesmo_usuario_extracted.tmp.js');

let passed = 0, failed = 0;
function ok(desc, cond, extra) { if (cond) { console.log('  ✅  ' + desc); passed++; } else { console.log('  ❌  ' + desc + (extra ? ' — ' + extra : '')); failed++; } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Mock Firestore FIEL: onSnapshot SEMPRE dispara de forma assíncrona
// (nunca no mesmo tick de quem escreveu) — mesmo comportamento real do SDK.
function mockDb(delayListenerMs) {
  var store = {};
  var listeners = [];
  function notificar() {
    var snap = Object.keys(store).map(function (id) { return { id: id, data: function () { return store[id]; } }; });
    listeners.forEach(function (fn) { setTimeout(function () { fn({ docs: snap }); }, delayListenerMs); });
  }
  return {
    _store: store,
    collection: function () {
      return {
        doc: function (key) { return { _key: key, get: function () { var e = store[key]; return Promise.resolve({ exists: !!e, data: function () { return e; } }); } }; },
        onSnapshot: function (fn) { listeners.push(fn); },
      };
    },
    runTransaction: function (fn) {
      var txn = { get: function (ref) { return ref.get(); }, set: function (ref, val) { store[ref._key] = val; } };
      return Promise.resolve().then(function () { return fn(txn); }).then(function (r) { notificar(); return r; });
    },
  };
}

function montarCenarioBase(canonJSON) {
  // RODADA 2026-11-10 — baseline precisa ser construído com a MESMA forma
  // canônica que _watchOrcamentosV2() real agora usa (_orcV2CanonJSON) —
  // um JSON.stringify crú aqui não é mais fiel ao que o código real
  // armazena em _orcV2LastPayload desde o fix do falso conflito por ordem
  // de chaves.
  var canon = canonJSON || JSON.stringify;
  var legadoArr = [];
  var v2PorId = {};
  var baseline = {};
  for (var i = 1; i <= 50; i++) {
    var num = String(i).padStart(6, '0');
    var id = 'ORC-' + num;
    var base = { id: id, num: num, cliente: 'Cliente ' + i, valorFinal: 100 + i, status: 'aguardando' };
    legadoArr.push(base);
    var v2obj = Object.assign({}, base, { migradoDe: 'erp_vr/orcamentos', migracaoVersao: 1 });
    v2PorId[id] = v2obj;
    baseline[id] = canon(v2obj);
  }
  return { legadoArr: legadoArr, v2PorId: v2PorId, baseline: baseline };
}

(async function () {
  console.log('\n=== Casos A/B/C/D — falso conflito "mesmo usuário" vs. conflito real (funções reais, nunca reimplementadas) ===\n');

  // ── Caso A — 1 usuário: cria orçamento (com cliente real, dispara 2ª
  // gravação de crmLeadId), depois EDITA e salva de novo. Esperado: zero
  // conflito em nenhuma das 3 gravações. ──
  {
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];
    var mod = require(modPath);
    var cenario = montarCenarioBase(mod.canonJSON);
    var db = mockDb(25); // listener chega ~25ms depois do commit — nunca síncrono, igual produção real
    global._db = db;
    global.showToast = function () {};
    var mesclado = cenario.legadoArr.map(function (o) { return cenario.v2PorId[o.id] || o; });
    mod.setState({ legado: cenario.legadoArr, v2: cenario.v2PorId, baseline: cenario.baseline, enviados: mesclado });
    mod.iniciarListenerV2();

    var orc = { id: 'ORC-000300', num: '000300', cliente: 'Cliente Caso A', valorFinal: 500, status: 'aguardando' };
    var lista = mod.orcGetEnviados(); lista.unshift(orc);
    var r1 = await mod.orcSetEnviados(lista);
    ok('A1. criar — 1ª gravação (principal) sem conflito', r1 && r1.ok === true, JSON.stringify(r1));

    var criouAgora = mod.crmUpsertLeadPorOrcamento(orc, orc.num);
    ok('A2. CRM cria lead agora (orçamento novo com cliente real)', criouAgora === true);
    if (criouAgora) {
      var r2 = await mod.orcSetEnviados(lista); // EXATAMENTE index.html:31229
      ok('A3. criar — 2ª gravação (persistindo crmLeadId) sem conflito, mesmo correndo contra o próprio listener', r2 && r2.ok === true, JSON.stringify(r2));
    }

    await sleep(60); // deixa os listeners pendentes resolverem antes de editar
    orc.valorFinal = 777; // "edita"
    var r3 = await mod.orcSetEnviados(mod.orcGetEnviados());
    ok('A4. editar e salvar de novo — sem conflito (Caso A completo, zero conflito em nenhuma das 3 gravações)', r3 && r3.ok === true, JSON.stringify(r3));
  }

  // ── Caso B — o próprio listener recebe o doc recém-salvo por ESTA aba
  // (nenhum delay entre commit e snapshot) — nunca deve ser interpretado
  // como edição externa. ──
  {
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];
    var modB = require(modPath);
    var db2 = mockDb(0); // listener o mais rápido possível — pior caso para uma corrida espúria
    global._db = db2;
    global.showToast = function () {};
    modB.setState({ legado: [], v2: {}, baseline: {}, enviados: [] });
    modB.iniciarListenerV2();

    var orcB = { id: 'ORC-000301', num: '000301', cliente: 'Cliente Caso B', valorFinal: 200, status: 'aguardando' };
    var listaB = [orcB];
    var rB1 = await modB.orcSetEnviados(listaB);
    ok('B1. 1ª gravação sem conflito (listener local, delay 0)', rB1 && rB1.ok === true);
    await sleep(20); // deixa o listener ecoar o próprio write
    orcB.valorFinal = 999;
    var rB2 = await modB.orcSetEnviados(modB.orcGetEnviados());
    ok('B2. o eco do próprio listener (delay 0) NUNCA é interpretado como edição externa — 2ª gravação sem conflito', rB2 && rB2.ok === true, JSON.stringify(rB2));
  }

  // ── Caso C — conflito REAL (2 "usuários" editando o MESMO orçamento)
  // continua detectado — a correção nunca pode mascarar isto. ──
  {
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];
    var modC = require(modPath);
    var db3 = mockDb(10);
    global._db = db3;
    global.showToast = function (msg) { global.__ultimoToastC = msg; };
    var orcC = { id: 'ORC-000302', num: '000302', cliente: 'Cliente Caso C', valorFinal: 300, status: 'aguardando' };
    modC.setState({ legado: [], v2: { 'ORC-000302': orcC }, baseline: { 'ORC-000302': JSON.stringify(orcC) }, enviados: [orcC] });
    modC.iniciarListenerV2();
    await sleep(15);

    // "Outro usuário" escreve DIRETO no servidor (processo real diferente) — esta aba ainda não observou.
    db3._store['ORC-000302'] = Object.assign({}, orcC, { valorFinal: 888, editadoPorOutroUsuario: true });

    var minhaEdicao = Object.assign({}, orcC, { valorFinal: 444 });
    var rC = await modC.orcSetEnviados([minhaEdicao]);
    ok('C. conflito REAL (outra sessão editou o MESMO orçamento) continua detectado — nunca mascarado', rC && rC.ok === false && rC.reason === 'conflito_orcamento' && rC.orcId === 'ORC-000302', JSON.stringify(rC));
  }

  // ── Caso D — dois orçamentos DIFERENTES, cada "usuário" só editando o
  // seu: zero conflito cruzado entre eles. ──
  {
    fs.writeFileSync(modPath, src);
    delete require.cache[require.resolve(modPath)];
    var modD = require(modPath);
    var cenarioD = montarCenarioBase(modD.canonJSON); // 50 orçamentos com divergência legado×v2 real (migradoDe etc.)
    var db4 = mockDb(10);
    global._db = db4;
    global.showToast = function () {};
    var mescladoD = cenarioD.legadoArr.map(function (o) { return cenarioD.v2PorId[o.id] || o; });
    modD.setState({ legado: cenarioD.legadoArr, v2: cenarioD.v2PorId, baseline: cenarioD.baseline, enviados: mescladoD });
    modD.iniciarListenerV2();
    await sleep(15);

    // outro usuário real edita um orçamento diferente (ORC-000010) direto no servidor.
    db4._store['ORC-000010'] = Object.assign({}, cenarioD.v2PorId['ORC-000010'], { valorFinal: 55555 });

    var orcNovoD = { id: 'ORC-000303', num: '000303', cliente: 'Cliente Caso D', valorFinal: 400, status: 'aguardando' };
    var listaD = modD.orcGetEnviados(); listaD.unshift(orcNovoD);
    var rD = await modD.orcSetEnviados(listaD);
    ok('D. orçamentos DIFERENTES — minha gravação (ORC-000303) não sofre nenhum conflito cruzado por causa da edição real em ORC-000010', rD && rD.ok === true, JSON.stringify(rD));
  }

  console.log('\n' + '='.repeat(70));
  console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
  console.log('='.repeat(70) + '\n');
  try { fs.unlinkSync(modPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})().catch(function (e) { console.error('ERRO FATAL:', e); process.exit(1); });
