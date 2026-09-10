/**
 * test_rodada_cirurgica_2026-09-10_historico_writepath.js
 *
 * RODADA CIRÚRGICA 2026-09-10, item 2 — write-path do Histórico de Compras.
 * A rodada anterior (Bug 2) protegeu a LEITURA (clientHistExibir), mas
 * orcSalvarHistoricoCliente() continuava gravando só por telefone/e-mail.
 *
 * Corrigido: orcSalvarHistoricoCliente() agora resolve um clienteId
 * canônico via _histResolveClienteIdSeguro() (CLIENTES_DATA) ANTES de
 * calcular a chave de gravação — clienteId tem prioridade; telefone/e-mail
 * seguem como fallback legado. Regras aplicadas:
 *   - identificação só é usada se INEQUÍVOCA (nome bate com exatamente 1
 *     cliente cadastrado, ou — em caso de nomes duplicados — telefone/
 *     e-mail desempata para exatamente 1);
 *   - nenhuma migração/reatribuição de histórico real é feita sem prova
 *     inequívoca — o fallback legado antigo continua funcionando tal como
 *     antes para quem não tem clienteId resolvível;
 *   - backfill lazy/idempotente: na primeira gravação sob a chave canônica,
 *     se existir um registro legado cujo nome bate com o nome atual, o
 *     histórico é herdado (sem apagar o legado); se o nome não bate
 *     (telefone reciclado de outra pessoa), nada é herdado.
 *
 * Extrai as funções reais ao vivo de index.html (não reimplementa a
 * lógica) e simula o DOM mínimo necessário.
 *
 * Uso: node scripts/test_rodada_cirurgica_2026-09-10_historico_writepath.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'esperado true'); }
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) throw new Error((msg || 'valores diferentes') + ' — esperado ' + e + ', obtido ' + g);
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

var FN_NAMES = ['_clientHistNormNome', '_histResolveClienteIdSeguro', 'clientHistGetKey', 'clientHistLoad', 'clientHistSave', 'orcSalvarHistoricoCliente'];
var src = [
  'var _CLIENT_HIST = global.__CLIENT_HIST__;',
  'var CLIENTES_DATA = global.__CLIENTES_DATA__;',
  'var document = global.__DOC__;',
  'var window = global.__WIN__;',
  'function orcProdutoNomeResolvido(){ return ""; }',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { orcSalvarHistoricoCliente: orcSalvarHistoricoCliente, _histResolveClienteIdSeguro: _histResolveClienteIdSeguro, clientHistGetKey: clientHistGetKey, getHist: function(){ return _CLIENT_HIST; } };'
].join('\n\n');
var modPath = path.join(__dirname, '_rodada_cirurgica_2026-09-10_historico_writepath_extracted.tmp.js');
fs.writeFileSync(modPath, src);

// Fake DOM mínimo: getElementById resolve pelos ids usados por
// orcSalvarHistoricoCliente; querySelectorAll('#orcItemBody tr') vazio
// (itens não são asserted neste teste, só a identidade/chave de gravação).
function fakeDoc(fields) {
  return {
    getElementById: function (id) {
      if (fields.hasOwnProperty(id)) return { value: fields[id] };
      if (id === 'orcDescCondToggle') return { checked: false };
      return null;
    },
    querySelectorAll: function () { return { forEach: function () {} }; },
    body: { classList: { contains: function () { return false; } } }
  };
}

function loadMod(histDb, clientesData, domFields, finalPrice) {
  global.__CLIENT_HIST__ = histDb;
  global.__CLIENTES_DATA__ = clientesData;
  global.__DOC__ = fakeDoc(domFields);
  global.__WIN__ = { _orcCalc: { finalPrice: finalPrice } };
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

console.log('\n=== Histórico de Compras — write-path com identidade canônica (clienteId) ===\n');

// ── Caso A — Cliente A e B com o mesmo telefone → históricos SEPARADOS ──
(function () {
  var CLIENTES_DATA = [
    { id: 'cA', nome: 'Ana Souza', tel: '11900001111', email: '' },
    { id: 'cB', nome: 'Bruno Lima', tel: '11900001111', email: '' }
  ];
  var histDb = {};
  var mod = loadMod(histDb, CLIENTES_DATA,
    { orcClientNome: 'Ana Souza', orcClientTel: '11900001111', orcClientEmail: '' }, 500);
  mod.orcSalvarHistoricoCliente();

  var mod2 = loadMod(mod.getHist(), CLIENTES_DATA,
    { orcClientNome: 'Bruno Lima', orcClientTel: '11900001111', orcClientEmail: '' }, 700);
  mod2.orcSalvarHistoricoCliente();

  test('A — clienteId resolvido corretamente para cada nome, apesar do telefone compartilhado', function () {
    assertEq(mod2._histResolveClienteIdSeguro('Ana Souza', '11900001111', ''), 'cA');
    assertEq(mod2._histResolveClienteIdSeguro('Bruno Lima', '11900001111', ''), 'cB');
  });
  test('A — Cliente A e Cliente B (mesmo telefone) gravam em chaves canônicas DIFERENTES', function () {
    var db = mod2.getHist();
    assertTrue(!!db['cid:cA'], 'esperava chave canônica cid:cA para Ana');
    assertTrue(!!db['cid:cB'], 'esperava chave canônica cid:cB para Bruno');
    assertEq(db['cid:cA'].historico.length, 1);
    assertEq(db['cid:cB'].historico.length, 1);
    assertEq(db['cid:cA'].historico[0].valor, 500);
    assertEq(db['cid:cB'].historico[0].valor, 700);
  });
})();

// ── Caso B — Cliente A muda de telefone → histórico permanece (mesma chave) ──
(function () {
  var CLIENTES_DATA = [{ id: 'cC', nome: 'Carla Dias', tel: '11911112222', email: '' }];
  var mod1 = loadMod({}, CLIENTES_DATA,
    { orcClientNome: 'Carla Dias', orcClientTel: '11911112222', orcClientEmail: '' }, 300);
  mod1.orcSalvarHistoricoCliente();

  // telefone mudou no orçamento novo — CLIENTES_DATA.tel ainda reflete o
  // antigo (não foi atualizado), simulando o cenário real descrito.
  var mod2 = loadMod(mod1.getHist(), CLIENTES_DATA,
    { orcClientNome: 'Carla Dias', orcClientTel: '11999998888', orcClientEmail: '' }, 350);
  mod2.orcSalvarHistoricoCliente();

  test('B — telefone mudou, mas o nome ainda resolve o mesmo clienteId (histórico permanece na mesma chave canônica)', function () {
    var db = mod2.getHist();
    assertTrue(!!db['cid:cC'], 'esperava chave canônica cid:cC');
    assertEq(db['cid:cC'].historico.length, 2, 'as duas compras deveriam estar na MESMA chave canônica');
  });
})();

// ── Caso C — mesmo cliente, telefone formatado diferente → mesma chave ──
(function () {
  var CLIENTES_DATA = [{ id: 'cD', nome: 'Davi Pires', tel: '(11) 93333-4444', email: '' }];
  var mod1 = loadMod({}, CLIENTES_DATA,
    { orcClientNome: 'Davi Pires', orcClientTel: '(11) 93333-4444', orcClientEmail: '' }, 90);
  mod1.orcSalvarHistoricoCliente();

  var mod2 = loadMod(mod1.getHist(), CLIENTES_DATA,
    { orcClientNome: 'Davi Pires', orcClientTel: '11 93333 4444', orcClientEmail: '' }, 95);
  mod2.orcSalvarHistoricoCliente();

  test('C — mesmo cliente, telefone em formato diferente → mesma chave canônica (2 compras)', function () {
    var db = mod2.getHist();
    assertTrue(!!db['cid:cD'], 'esperava chave canônica cid:cD');
    assertEq(db['cid:cD'].historico.length, 2);
  });
})();

// ── Caso D — cliente antigo SEM clienteId resolvível → fallback legado continua funcionando ──
(function () {
  // CLIENTES_DATA vazio/sem esse cliente cadastrado — não há como resolver
  // um clienteId inequívoco, então deve cair no comportamento de sempre
  // (grava por telefone/e-mail).
  var mod = loadMod({}, [], { orcClientNome: 'Eduardo Rocha', orcClientTel: '11955556666', orcClientEmail: '' }, 200);
  mod.orcSalvarHistoricoCliente();

  test('D — cliente sem clienteId resolvível grava no fallback legado (chave por telefone), não trava nem perde a compra', function () {
    var db = mod.getHist();
    assertTrue(!!db['11955556666'], 'esperava fallback legado pela chave de telefone');
    assertEq(db['11955556666'].historico.length, 1);
    assertTrue(!db['cid:'], 'não deveria existir nenhuma chave canônica fantasma');
  });
})();

// ── Caso E — reload/reabertura: duas instâncias "novas" do módulo (como reabrir a página) preservam a mesma chave ──
(function () {
  var CLIENTES_DATA = [{ id: 'cF', nome: 'Fernanda Melo', tel: '11977778888', email: 'fernanda@ex.com' }];
  var histDbCompartilhado = {};

  var sessao1 = loadMod(histDbCompartilhado, CLIENTES_DATA,
    { orcClientNome: 'Fernanda Melo', orcClientTel: '11977778888', orcClientEmail: 'fernanda@ex.com' }, 120);
  sessao1.orcSalvarHistoricoCliente();
  var dbAposSessao1 = sessao1.getHist(); // simula persistência (ex.: Firestore) entre sessões

  // "reload": novo require limpo, mas lendo o MESMO db persistido
  var sessao2 = loadMod(dbAposSessao1, CLIENTES_DATA,
    { orcClientNome: 'Fernanda Melo', orcClientTel: '11977778888', orcClientEmail: 'fernanda@ex.com' }, 130);
  sessao2.orcSalvarHistoricoCliente();

  test('E — reload/reabertura: histórico continua acumulando na mesma chave canônica entre "sessões"', function () {
    var db = sessao2.getHist();
    assertTrue(!!db['cid:cF'], 'esperava chave canônica cid:cF preservada após reload');
    assertEq(db['cid:cF'].historico.length, 2);
  });
})();

// ── Backfill lazy — histórico legado do MESMO cliente é herdado para a chave canônica na primeira gravação ──
(function () {
  var CLIENTES_DATA = [{ id: 'cG', nome: 'Gustavo Lira', tel: '11966665555', email: '' }];
  var histDb = {
    '11966665555': { nome: 'Gustavo Lira', tel: '11966665555', email: '', historico: [{ data: '2026-01-01T00:00:00.000Z', valor: 800, itens: ['1× Placa'], marca: 'VR Marcas' }] }
  };
  var mod = loadMod(histDb, CLIENTES_DATA, { orcClientNome: 'Gustavo Lira', orcClientTel: '11966665555', orcClientEmail: '' }, 150);
  mod.orcSalvarHistoricoCliente();

  test('Backfill — histórico legado do mesmo cliente (nome bate) é herdado para a chave canônica, sem apagar o legado', function () {
    var db = mod.getHist();
    assertTrue(!!db['cid:cG'], 'esperava chave canônica cid:cG criada');
    assertEq(db['cid:cG'].historico.length, 2, 'deveria ter herdado a compra legada + a nova');
    assertTrue(db['cid:cG'].historico.some(function (h) { return h.valor === 800; }), 'deveria conter a compra legada (R$800)');
    assertTrue(!!db['11966665555'], 'BUG: registro legado não deveria ser apagado/movido');
    assertEq(db['11966665555'].historico.length, 1, 'registro legado deveria permanecer intocado');
  });
})();

// ── Backfill NÃO ocorre quando o nome legado não bate (telefone reciclado) ──
(function () {
  var CLIENTES_DATA = [{ id: 'cH', nome: 'Helena Nunes', tel: '11944443333', email: '' }];
  var histDb = {
    '11944443333': { nome: 'Dono Anterior Do Numero', tel: '11944443333', email: '', historico: [{ data: '2026-01-01T00:00:00.000Z', valor: 999, itens: ['1× Expositor'], marca: 'VR Marcas' }] }
  };
  var mod = loadMod(histDb, CLIENTES_DATA, { orcClientNome: 'Helena Nunes', orcClientTel: '11944443333', orcClientEmail: '' }, 60);
  mod.orcSalvarHistoricoCliente();

  test('Backfill — NÃO herda histórico de telefone reciclado quando o nome legado não bate (evita migração indevida)', function () {
    var db = mod.getHist();
    assertTrue(!!db['cid:cH'], 'esperava chave canônica cid:cH criada mesmo assim');
    assertEq(db['cid:cH'].historico.length, 1, 'BUG: não deveria ter herdado a compra de outra pessoa (R$999)');
    assertEq(db['cid:cH'].historico[0].valor, 60);
    assertTrue(!!db['11944443333'], 'registro legado do dono anterior deveria permanecer intocado');
  });
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
