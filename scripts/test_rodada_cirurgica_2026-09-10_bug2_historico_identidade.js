/**
 * test_rodada_cirurgica_2026-09-10_bug2_historico_identidade.js
 *
 * RODADA CIRÚRGICA 2026-09-10, Bug 2 — "Histórico de Compras" podia
 * aparecer para o cliente errado. Causa raiz: clientHistGetKey(tel,email)
 * usava só telefone/e-mail normalizado como identidade, sem checar nome
 * nem vínculo canônico — reproduzido ao vivo no smoke do Bloco 6 anterior
 * (lead novo "AUDITORIA TESTE WHATSAPP TELEFONE" mostrou a compra de
 * outra pessoa por reutilizar um telefone de teste já usado antes).
 *
 * Corrigido (retrocompatível — assinaturas antigas continuam funcionando):
 *   - clientHistGetKey(tel, email, clienteId): clienteId (vínculo
 *     canônico) tem prioridade absoluta quando informado ("cid:<id>").
 *   - clientHistExibir(tel, email, clienteId, nomeAtual): tenta a chave
 *     canônica primeiro; se não achar, cai no fallback legado por
 *     telefone/e-mail — mas só mostra se o nome de quem pede bater
 *     (normalizado) com o nome gravado no registro. Sem nomeAtual
 *     (chamador antigo), mantém o comportamento de sempre.
 *   - Os 2 call sites reais (crmOpenCard, tela de detalhe do Cliente)
 *     passam clienteId + nome — nenhuma migração de dados foi feita,
 *     `orcSalvarHistoricoCliente()` continua gravando por telefone/e-mail
 *     como sempre (write-path não tocado, por segurança).
 *
 * Extrai as funções reais ao vivo de index.html — falha no código
 * anterior, passa depois da correção (verificado via git stash).
 *
 * Uso: node scripts/test_rodada_cirurgica_2026-09-10_bug2_historico_identidade.js
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

console.log('\n=== Bug 2 — Histórico de Compras: identidade canônica, sem vazar pra telefone reciclado ===\n');

var FN_NAMES = ['clientHistLoad', 'clientHistGetKey', '_clientHistNormNome', 'clientHistExibir'];
var src = [
  'var _CLIENT_HIST = global.__CLIENT_HIST__;',
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { clientHistGetKey: clientHistGetKey, clientHistExibir: clientHistExibir };'
].join('\n\n');
var modPath = path.join(__dirname, '_rodada_cirurgica_2026-09-10_bug2_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function loadMod(histDb) {
  global.__CLIENT_HIST__ = histDb;
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

// ── Teste 1 — dois clientes diferentes, mesmo telefone → históricos separados ──
(function () {
  var mod = loadMod({
    '11900000000': { nome: 'Carlos Antigo', tel: '11900000000', email: '', historico: [{ data: '2026-08-09', valor: 771.65, itens: ['1× Carrinho de Make Patrícia'], marca: 'VR Marcas' }] }
  });
  test('1. cliente NOVO/diferente com o mesmo telefone de um cliente antigo NÃO vê o histórico do outro (nome não bate)', function () {
    var html1 = mod.clientHistExibir('11900000000', '', null, 'Auditoria Teste Whatsapp Telefone');
    assertEq(html1, '', 'BUG: histórico de "Carlos Antigo" vazou para um lead com nome completamente diferente');
  });
  test('1b. REGRESSÃO — o dono LEGÍTIMO do telefone (mesmo nome) continua vendo seu próprio histórico', function () {
    var html2 = mod.clientHistExibir('11900000000', '', null, 'Carlos Antigo');
    assertTrue(html2.indexOf('Carrinho de Make Patrícia') >= 0, 'o próprio dono do telefone/nome deveria continuar vendo seu histórico');
  });
})();

// ── Teste 2 — mesmo cliente, telefone alterado → histórico preservado via clienteId ──
(function () {
  var mod = loadMod({
    'cid:cli_42': { nome: 'Maria Souza', tel: '11911112222', email: '', historico: [{ data: '2026-07-01', valor: 200, itens: ['1× Placa'], marca: 'VR Marcas' }] }
  });
  test('2. cliente com clienteId (vínculo canônico): telefone mudou, histórico continua acessível pelo id', function () {
    var htmlNovoTel = mod.clientHistExibir('11999998888', '', 'cli_42', 'Maria Souza');
    assertTrue(htmlNovoTel.indexOf('Placa') >= 0, 'BUG: histórico deveria continuar acessível via clienteId mesmo com telefone diferente do registrado');
  });
})();

// ── Teste 3 — mesmo cliente, telefone em formatos diferentes (fallback legado) ──
(function () {
  var mod = loadMod({
    '11933334444': { nome: 'João Pereira', tel: '(11) 93333-4444', email: '', historico: [{ data: '2026-06-01', valor: 90, itens: ['1× Display'], marca: 'VR Marcas' }] }
  });
  test('3. mesmo cliente (nome bate), telefone em formato diferente → vínculo continua (normalização de dígitos, já existente)', function () {
    var htmlFormatado = mod.clientHistExibir('(11) 93333-4444', '', null, 'João Pereira');
    assertTrue(htmlFormatado.indexOf('Display') >= 0, 'normalização de telefone deveria continuar funcionando para o mesmo cliente');
  });
})();

// ── Teste 4 — telefone reciclado (cliente novo, nome diferente) → sem herança indevida ──
(function () {
  var mod = loadMod({
    '11955556666': { nome: 'Antigo Dono Do Numero', tel: '11955556666', email: '', historico: [{ data: '2026-01-01', valor: 500, itens: ['1× Troféu'], marca: 'VR Marcas' }] }
  });
  test('4. telefone reciclado — cliente novo com nome diferente NÃO recebe o histórico do dono anterior do número', function () {
    var htmlReciclado = mod.clientHistExibir('11955556666', '', null, 'Pessoa Completamente Nova');
    assertEq(htmlReciclado, '', 'BUG: cliente novo herdou histórico do dono anterior do telefone reciclado');
  });
})();

// ── Teste 5 — cliente com clienteId explícito usa o ID, não telefone/e-mail ──
(function () {
  var mod = loadMod({
    'cid:cli_99': { nome: 'Cliente Canonico', tel: '', email: '', historico: [{ data: '2026-05-01', valor: 300, itens: ['1× Caixa'], marca: 'VR Marcas' }] },
    '11900009999': { nome: 'Pessoa Totalmente Diferente', tel: '11900009999', email: '', historico: [{ data: '2026-04-01', valor: 999, itens: ['1× Placa'], marca: 'VR Marcas' }] }
  });
  test('5. clienteId explícito usa o registro canônico (cid:cli_99), mesmo que o telefone informado colida com outro registro legado', function () {
    var htmlCanonico = mod.clientHistExibir('11900009999', '', 'cli_99', 'Cliente Canonico');
    assertTrue(htmlCanonico.indexOf('Caixa') >= 0, 'deveria mostrar o histórico do registro canônico (Caixa)');
    assertTrue(htmlCanonico.indexOf('Placa') < 0, 'BUG: vazou o histórico do registro legado de telefone (Placa) em vez de usar só o canônico');
  });
})();

// ── Teste 6 — fallback legado ambíguo (sem nomeAtual informado) preserva compat. antiga ──
(function () {
  var mod = loadMod({
    '11977778888': { nome: 'Nome Qualquer', tel: '11977778888', email: '', historico: [{ data: '2026-03-01', valor: 150, itens: ['1× Bandeja'], marca: 'VR Marcas' }] }
  });
  test('6. chamador ANTIGO (sem nomeAtual) mantém o comportamento de sempre — retrocompatibilidade preservada', function () {
    var htmlSemNome = mod.clientHistExibir('11977778888', '');
    assertTrue(htmlSemNome.indexOf('Bandeja') >= 0, 'chamadores que não passam nomeAtual (código legado) não podem quebrar');
  });
})();

// ── Teste 7 — CRM → Cliente → Orçamento: histórico correto usando nome+clienteId ──
(function () {
  var mod = loadMod({
    'cid:cli_500': { nome: 'Fluxo Completo Ltda', tel: '11900005000', email: '', historico: [{ data: '2026-02-01', valor: 700, itens: ['1× Expositor'], marca: 'VR Marcas' }] }
  });
  test('7. lead do CRM já vinculado a um cliente (clienteId) mostra o histórico correto sem misturar terceiros', function () {
    var htmlCrm = mod.clientHistExibir('11900005000', '', 'cli_500', 'Fluxo Completo Ltda');
    assertTrue(htmlCrm.indexOf('Expositor') >= 0, 'histórico do cliente vinculado deveria aparecer corretamente');
  });
})();

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
