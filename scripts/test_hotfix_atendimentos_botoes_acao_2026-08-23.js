/**
 * test_hotfix_atendimentos_botoes_acao_2026-08-23.js
 *
 * RODADA 9, FECHAMENTO (2026-08-23) — Bloqueador 2 (frontend): os botões
 * "Criar/Abrir cliente"/"Criar/Abrir oportunidade"/"Revisar e criar
 * orçamento" abriam um modal pré-preenchido mas nunca chamavam nenhum
 * backend — achado real reportado em produção ("nenhum botão executa a
 * ação de verdade"). Corrigido: os dois primeiros agora chamam as Cloud
 * Functions dedicadas (atdVincularCliente/atdVincularOportunidade) e
 * atualizam o painel com o vínculo real e persistido; o terceiro continua
 * pré-preenchendo o Novo Orçamento (fluxo já correto), mas agora marca a
 * origem para o orçamento REAL, uma vez salvo pelo motor oficial, ser
 * vinculado de volta à conversa (atdVincularOrcamentoAposSalvar, chamado
 * por um hook aditivo em orcSalvarOrcamento() — _orcSalvarOrcamentoImpl(),
 * Bloco D/E já estabilizado, permanece intocada).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * atdRenderPainel, atdBriefingHtml, atdCriarOuAbrirCliente,
 * atdCriarOuAbrirOportunidade, atdRevisarCriarOrcamento,
 * atdVincularOrcamentoAposSalvar, orcSalvarOrcamento, atdErroAmigavel.
 *
 * Uso: node scripts/test_hotfix_atendimentos_botoes_acao_2026-08-23.js
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

var FN_NAMES = ['atdRenderPainel', 'atdBriefingHtml', 'atdCriarOuAbrirCliente', 'atdCriarOuAbrirOportunidade', 'atdRevisarCriarOrcamento', 'atdVincularOrcamentoAposSalvar', 'orcSalvarOrcamento', 'atdErroAmigavel', '_atdBtnBusy'];
global.window = global;
global.cfgEsc = function (v) { return v == null ? '' : String(v).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };

var src = 'var ATD_ACAO_EM_VOO = {};\n\n' + FN_NAMES.map(extractFn).join('\n\n') + '\n\nmodule.exports = {' + FN_NAMES.join(',') + '};';
var modPath = path.join(__dirname, '_atd_botoes_acao_extracted.tmp.js');
fs.writeFileSync(modPath, src);

function makeEl(props) { return Object.assign({ value: '', textContent: '', checked: false, style: {}, innerHTML: '', disabled: false, options: [] }, props || {}); }

var _els, _toasts, _calls;
function fakeCallable(name) {
  return function (payload) {
    _calls.push({ name: name, payload: payload });
    var behavior = global._CF_BEHAVIOR[name];
    if (!behavior) return Promise.reject(new Error('CF não mockada: ' + name));
    return behavior(payload);
  };
}
function reset() {
  _els = { atdColPainel: makeEl() };
  global.document = { getElementById: function (id) { return _els[id] || (_els[id] = makeEl()); } };
  _toasts = [];
  global.showToast = function (msg, kind) { _toasts.push({ msg: msg, kind: kind }); };
  _calls = [];
  global._CF_BEHAVIOR = {};
  global.firebase = { functions: function () { return { httpsCallable: fakeCallable }; } };
  global.cliOpenDetalhe = function (id) { global._cliAbriu = id; };
  global.crmOpenCard = function (id) { global._crmAbriu = id; };
  global.orcEnvEditar = function (id) { global._orcAbriu = id; };
  global._cliAbriu = null; global._crmAbriu = null; global._orcAbriu = null;
  global._ORC_ENVIADOS_DATA = [];
  global.ATD_BRIEFING_CACHE = null;
  global.ATD_SELECTED_ID = null;
  global.window._atdOrigemAtendimentoId = null;
}

delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 9, FECHAMENTO — botões de ação do painel de Atendimentos ===\n');

(async function main(){

// RODADA 9, FECHAMENTO (2026-08-23) — achado real de smoke test AUTENTICADO
// em produção: os 3 botões abaixo usavam JSON.stringify(atd.id) dentro de
// um atributo onclick="..." (aspas duplas) — o próprio JSON.stringify
// também envolve a string em aspas duplas, quebrando o HTML no meio
// ("onclick=\"fn(\"" + atributo bogus solto). O botão NUNCA disparava
// nada ao clicar de verdade — só passava despercebido porque os testes
// anteriores checavam a STRING com regex (que ainda contém o nome da
// função), nunca se o onclick resultante é HTML válido. Este teste
// verifica explicitamente que o valor de onclick, uma vez extraído do
// HTML como um atributo real, está bem formado (aspas fechadas
// corretamente, sem fragmento solto) — teria pego o bug original.
function assertOnclickBemFormado(html, nomeFuncao, msg) {
  var re = new RegExp('onclick="(' + nomeFuncao + '\\([^"]*\\))"', '');
  var m = html.match(re);
  assertTrue(!!m, msg + ' — onclick="' + nomeFuncao + '(...)" bem formado (aspas fechadas corretamente, sem HTML quebrado)');
  if (m) assertTrue(/\)$/.test(m[1]), msg + ' — a chamada termina com ")" fechado (nunca um fragmento truncado)');
}

// ── atdRenderPainel: botões chamam as funções corretas E o onclick é HTML válido ──
(function () {
  reset();
  var atd = { id: 'atd1', nome: 'Cliente Teste', telefoneE164: '+5562999990000' };
  mod.atdRenderPainel(atd);
  var out = _els.atdColPainel.innerHTML;
  assertTrue(/atdCriarOuAbrirCliente/.test(out), '1. botão de cliente aponta para a ação real (atdCriarOuAbrirCliente)');
  assertTrue(/atdCriarOuAbrirOportunidade/.test(out), '2. botão de oportunidade aponta para a ação real (atdCriarOuAbrirOportunidade)');
  assertOnclickBemFormado(out, 'atdCriarOuAbrirCliente', '2b. Criar/Abrir cliente');
  assertOnclickBemFormado(out, 'atdCriarOuAbrirOportunidade', '2c. Criar/Abrir oportunidade');
  assertOnclickBemFormado(out, 'atdRevisarCriarOrcamento', '2d. Revisar e criar orçamento');
})();

// ── atdCriarOuAbrirCliente: já vinculado → só abre, nunca chama a Function ──
(function () {
  reset();
  global.ATD_CACHE = [{ id: 'atd2', clienteId: 'cli_existente' }];
  mod.atdCriarOuAbrirCliente('atd2');
  test('3. cliente já vinculado: abre direto (cliOpenDetalhe)', global._cliAbriu, 'cli_existente');
  test('4. nenhuma chamada à Cloud Function quando já vinculado', _calls.length, 0);
})();

// ── atdCriarOuAbrirCliente: faltando dados → avisa, nunca chama a Function ──
(function () {
  reset();
  global.ATD_CACHE = [{ id: 'atd3', nome: '', telefoneE164: '' }];
  mod.atdCriarOuAbrirCliente('atd3');
  assertTrue(_toasts.some(function (t) { return t.kind === 'warn' && /nome/.test(t.msg) && /telefone/.test(t.msg); }), '5. faltando nome E telefone: avisa claramente o que falta, nunca tenta criar');
  test('6. nenhuma chamada à Cloud Function quando faltam dados mínimos', _calls.length, 0);
})();

// ── atdCriarOuAbrirCliente: caminho real — cria e persiste ───────────────
reset();
global.ATD_CACHE = [{ id: 'atd4', nome: 'Maria Souza', telefoneE164: '+5562988887777' }];
global._CF_BEHAVIOR.atdVincularCliente = function (payload) {
  test('7. chama atdVincularCliente com o atendimentoId correto', payload.atendimentoId, 'atd4');
  return Promise.resolve({ data: { ok: true, clienteId: 'cli_novo_123', criado: true } });
};
await mod.atdCriarOuAbrirCliente('atd4');
test('8. clienteId persistido no cache local após a Cloud Function confirmar', global.ATD_CACHE[0].clienteId, 'cli_novo_123');
test('9. abre o cliente recém-criado', global._cliAbriu, 'cli_novo_123');
assertTrue(_toasts.some(function (t) { return t.kind === 'ok' && /criado/i.test(t.msg); }), '10. toast confirma que foi CRIADO (distingue de "já existia")');

// ── atdCriarOuAbrirCliente: dedupe — Function encontrou existente ────────
reset();
global.ATD_CACHE = [{ id: 'atd5', nome: 'João Silva', telefoneE164: '+5511988887777' }];
global._CF_BEHAVIOR.atdVincularCliente = function () {
  return Promise.resolve({ data: { ok: true, clienteId: 'cli_ja_existia', criado: false, encontrado: true } });
};
await mod.atdCriarOuAbrirCliente('atd5');
assertTrue(_toasts.some(function (t) { return /já existente/i.test(t.msg); }), '11. toast deixa claro que o cliente JÁ existia — nunca duplicado');

// ── Duplo clique — nunca duas chamadas simultâneas ───────────────────────
reset();
global.ATD_CACHE = [{ id: 'atd6', nome: 'Cliente X', telefoneE164: '+5562911112222' }];
var chamadas = 0;
global._CF_BEHAVIOR.atdVincularCliente = function () {
  chamadas++;
  return new Promise(function (resolve) { setTimeout(function () { resolve({ data: { ok: true, clienteId: 'c1', criado: true } }); }, 20); });
};
mod.atdCriarOuAbrirCliente('atd6');
mod.atdCriarOuAbrirCliente('atd6'); // clique duplo, ainda em voo
await new Promise(function (r) { setTimeout(r, 40); });
test('12. duplo clique nunca dispara duas chamadas à Cloud Function (mesmo padrão de proteção já usado no resto do ERP)', chamadas, 1);

// ── atdCriarOuAbrirOportunidade: mesmas garantias ─────────────────────────
(function () {
  reset();
  global.ATD_CACHE = [{ id: 'atd7', leadId: 'lead_existente' }];
  mod.atdCriarOuAbrirOportunidade('atd7');
  test('13. oportunidade já vinculada: abre direto (crmOpenCard)', global._crmAbriu, 'lead_existente');
})();

reset();
global.ATD_CACHE = [{ id: 'atd8', nome: 'Ana Paula', telefoneE164: '+5562933334444' }];
global.ATD_BRIEFING_CACHE = { produto: 'Troféu' };
global._CF_BEHAVIOR.atdVincularOportunidade = function (payload) {
  test('14. envia o produto identificado no briefing junto com o vínculo', payload.produto, 'Troféu');
  return Promise.resolve({ data: { ok: true, leadId: 'lead_novo', clienteId: 'cli_novo', criado: true } });
};
await mod.atdCriarOuAbrirOportunidade('atd8');
test('15. leadId persistido no cache local', global.ATD_CACHE[0].leadId, 'lead_novo');
test('16. clienteId também é aproveitado (a Function garante o cliente por trás)', global.ATD_CACHE[0].clienteId, 'cli_novo');
test('17. abre a oportunidade recém-criada', global._crmAbriu, 'lead_novo');

// ── atdRevisarCriarOrcamento: marca a origem (sem navegar de verdade aqui) ──
(function () {
  reset();
  global.ATD_CACHE = [{ id: 'atd9', nome: 'Pedro', telefoneE164: '+5562955556666' }];
  global.nav = function () {};
  mod.atdRevisarCriarOrcamento('atd9');
  test('18. marca a origem do orçamento para vincular de volta após salvar (achado explícito do pedido)', window._atdOrigemAtendimentoId, 'atd9');
})();

// ── atdVincularOrcamentoAposSalvar: persiste e nunca vincula duas vezes ──
reset();
global.ATD_CACHE = [{ id: 'atd10' }];
global.ATD_SELECTED_ID = 'atd10';
window._atdOrigemAtendimentoId = 'atd10';
global._CF_BEHAVIOR.atdVincularOrcamento = function (payload) {
  test('19. chama atdVincularOrcamento com atendimentoId e orcamentoId corretos', payload, { atendimentoId: 'atd10', orcamentoId: 'orc_555' });
  return Promise.resolve({ data: { ok: true, orcamentoId: 'orc_555', numero: '42', total: 350.5 } });
};
await mod.atdVincularOrcamentoAposSalvar('atd10', 'orc_555');
test('20. consome a origem imediatamente — nunca vincula duas vezes por engano', window._atdOrigemAtendimentoId, null);
test('21. orcamentoId persistido no cache local', global.ATD_CACHE[0].orcamentoId, 'orc_555');
test('22. número do orçamento fica disponível para exibição imediata', global.ATD_CACHE[0].orcamentoNum, '42');
assertTrue(_toasts.some(function (t) { return /#42/.test(t.msg); }), '23. toast confirma o vínculo com o número do orçamento');

// ── atdRenderPainel: exibe "Orçamento #N — R$X" quando já vinculado ──────
(function () {
  reset();
  var atd = { id: 'atd11', orcamentoId: 'orc_1', orcamentoNum: '7', orcamentoTotal: 199.9 };
  mod.atdRenderPainel(atd);
  var out = _els.atdColPainel.innerHTML;
  assertTrue(/#7/.test(out) && /199,90/.test(out), '24. painel mostra "Orçamento #N — R$X" quando o vínculo já existe (achado explícito do pedido)');
})();

// ── atdRenderPainel: após reload (sem cache local), busca fallback em _ORC_ENVIADOS_DATA ──
(function () {
  reset();
  var atd = { id: 'atd12', orcamentoId: 'orc_2' }; // sem orcamentoNum/orcamentoTotal — simula reload
  global._ORC_ENVIADOS_DATA = [{ id: 'orc_2', num: '9', valorFinal: 88.0 }];
  mod.atdRenderPainel(atd);
  var out = _els.atdColPainel.innerHTML;
  assertTrue(/#9/.test(out) && /88,00/.test(out), '25. após reload, o número/valor do orçamento são recuperados do array global — o vínculo em si (botão funcionando) não depende disso');
})();

// ── orcSalvarOrcamento(): hook aditivo — nunca refatora _orcSalvarOrcamentoImpl ──
reset();
global.ATD_CACHE = [{ id: 'atd13' }];
window._atdOrigemAtendimentoId = 'atd13';
global._orcSalvarEmVoo = null;
global._orcSalvarOrcamentoImpl = function () { return Promise.resolve({ id: 'orc_novo_777', num: '55', total: 120 }); };
global._CF_BEHAVIOR.atdVincularOrcamento = function (payload) {
  test('26. orcSalvarOrcamento() dispara o vínculo com o orcamentoId REAL retornado pelo motor oficial (nunca antes de salvar)', payload.orcamentoId, 'orc_novo_777');
  return Promise.resolve({ data: { ok: true, orcamentoId: 'orc_novo_777', numero: '55', total: 120 } });
};
var orcResolvido = await mod.orcSalvarOrcamento();
test('27. orcSalvarOrcamento() continua devolvendo o orçamento salvo normalmente (comportamento original preservado)', orcResolvido, { id: 'orc_novo_777', num: '55', total: 120 });
await new Promise(function (r) { setTimeout(r, 10); }); // deixa o vínculo assíncrono terminar
test('28. o orçamento fica vinculado à conversa que o originou', global.ATD_CACHE[0].orcamentoId, 'orc_novo_777');

// ── orcSalvarOrcamento(): sem origem de Atendimento → nunca chama a Function à toa ──
reset();
window._atdOrigemAtendimentoId = null;
global._orcSalvarEmVoo = null;
global._orcSalvarOrcamentoImpl = function () { return Promise.resolve({ id: 'orc_normal', num: '1', total: 50 }); };
var chamouSemOrigem = false;
global._CF_BEHAVIOR.atdVincularOrcamento = function () { chamouSemOrigem = true; return Promise.resolve({ data: { ok: true } }); };
await mod.orcSalvarOrcamento();
await new Promise(function (r) { setTimeout(r, 10); });
test('29. orçamento salvo SEM vir de Atendimentos: nunca tenta vincular nada (regressão — fluxo normal de orçamento intocado)', chamouSemOrigem, false);

try { fs.unlinkSync(modPath); } catch (e) {}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;

})();
