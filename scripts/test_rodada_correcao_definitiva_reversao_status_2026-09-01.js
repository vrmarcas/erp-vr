/**
 * test_rodada_correcao_definitiva_reversao_status_2026-09-01.js
 *
 * RODADA DE CORREÇÃO DEFINITIVA, Bloco 8 — bug real: orçamento marcado
 * "Cliente aprovou" (status='aprovado') por engano não tinha NENHUM
 * caminho de volta para "Aguardando Cliente" — orcEnvSetStatus() aceitava
 * qualquer transição (sem guard de código), mas a UI (orcEnvAbrir()) só
 * renderizava os botões Aprovar/Recusar quando status==='aguardando';
 * uma vez 'aprovado', não sobrava nenhum botão para reverter.
 *
 * Regra implementada: AGUARDANDO→APROVADO→AGUARDANDO é permitido só
 * quando ainda não houver efeito irreversível:
 *   - BLOQUEADO se já existe OS gerada (orc.osRef) — nunca criar
 *     inconsistência entre status comercial e produção já iniciada.
 *   - BLOQUEADO se já existe pagamento confirmado (orcFinanceiroReal().
 *     recebidoCents>0) — nunca apagar dinheiro real recebido.
 *   - PERMITIDO no caso comum (só o CR pendente criado na aprovação,
 *     sem OS, sem pagamento) — reverte o status E cancela o CR pendente
 *     (nunca deixa um CR órfão divergente do status comercial real).
 *
 * Funções sob teste extraídas de index.html (nunca reimplementadas):
 * orcEnvSetStatus, orcEnvReverterParaAguardando, orcEnvNormalizar.
 *
 * Uso: node scripts/test_rodada_correcao_definitiva_reversao_status_2026-09-01.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assertEq(got, exp, msg) {
  var g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) { console.log('  ❌  ' + msg + '\n       esperado ' + e + '\n       obtido   ' + g); failed++; }
  else { console.log('  ✅  ' + msg); passed++; }
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

console.log('\n=== RODADA DE CORREÇÃO DEFINITIVA — Reversão segura Aprovado→Aguardando ===\n');

var FN_NAMES = ['orcEnvSetStatus', 'orcEnvReverterParaAguardando', 'orcEnvNormalizar'];
var src = [
  "var _ORC_ENVIADOS_DATA = [];",
  "function orcGetEnviados(){ return _ORC_ENVIADOS_DATA; }",
  "function orcSetEnviados(arr){ _ORC_ENVIADOS_DATA = arr; return Promise.resolve({ok:true}); }",
  "var FIN_CR = [];",
  "var _toasts = []; function showToast(msg,tipo){ _toasts.push({msg:msg,tipo:tipo}); }",
  "function orcAtualizarBadgeEnviados(){}",
  "function _finSaveCR(){ return Promise.resolve({ok:true}); }",
  "var _finReal = {recebidoCents:0}; function orcFinanceiroReal(){ return _finReal; }",
  FN_NAMES.map(extractFn).join('\n\n'),
  [
    'module.exports = {',
    '  setStatus: orcEnvSetStatus,',
    '  reverter: orcEnvReverterParaAguardando,',
    '  addOrc: function (orc) { _ORC_ENVIADOS_DATA.push(orc); },',
    '  getOrc: function (id) { return _ORC_ENVIADOS_DATA.find(function (o) { return o.id === id; }); },',
    '  getCR: function () { return FIN_CR; },',
    '  getToasts: function () { return _toasts; },',
    '  clearToasts: function () { _toasts = []; },',
    '  setFinReal: function (v) { _finReal = v; },',
    '};',
  ].join('\n'),
].join('\n\n');
var modPath = path.join(__dirname, '_rodada_correcao_definitiva_reversao_status.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

function novoOrc(id) {
  return { id: id, status: 'aguardando', num: id, cliente: 'Cliente Teste', valorFinal: 500, marca: 'vr', pgto: 'PIX' };
}

// ══════════════════════════════════════════════════════════════════════════
// 1 — caso comum: Aguardando → Aprovado → Aguardando, sem OS/pagamento.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  mod.addOrc(novoOrc('orc1'));
  mod.setFinReal({ recebidoCents: 0 });
  mod.setStatus('orc1', 'aprovado');
  assertEq(mod.getOrc('orc1').status, 'aprovado', '1a. Aprovar orçamento: status vira "aprovado"');
  assertTrue(!!mod.getOrc('orc1').crId, '1b. Aprovar cria um CR (crId presente no orçamento)');
  assertEq(mod.getCR().length, 1, '1c. Um CR pendente foi criado em Contas a Receber');

  mod.clearToasts();
  mod.reverter('orc1');
  assertEq(mod.getOrc('orc1').status, 'aguardando', '2. TESTE OBRIGATÓRIO — Aguardando→Aprovado→Aguardando: status volta para "aguardando" sem pagamento/OS');
  assertEq(mod.getCR().length, 0, '3. O CR pendente criado na aprovação é cancelado junto com a reversão — nunca fica órfão');
  assertEq(mod.getOrc('orc1').crId, undefined, '4. orc.crId é limpo depois da reversão (permite aprovar de novo mais tarde sem herdar um crId morto)');
  assertTrue(mod.getToasts().some(function (t) { return t.tipo === 'ok'; }), '5. Toast de sucesso exibido');
})();

// ══════════════════════════════════════════════════════════════════════════
// 6 — ida e volta repetida: reload simulado (novo módulo) continua
// "aguardando" — nunca CR/OS órfão.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  assertEq(mod.getOrc('orc1').status, 'aguardando', '6. Após reversão, status persiste como "aguardando" (mesmo objeto, sem re-fetch — a persistência real via orcSetEnviados()/_cloudSave já é testada em outras suítes)');
})();

// ══════════════════════════════════════════════════════════════════════════
// 7-8 — BLOQUEIO: OS já gerada (orc.osRef) — reversão recusada, nada muda.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var orc2 = novoOrc('orc2');
  mod.addOrc(orc2);
  mod.setFinReal({ recebidoCents: 0 });
  mod.setStatus('orc2', 'aprovado');
  mod.getOrc('orc2').osRef = 'ORC-orc2'; // OS já gerada
  var crAntes = mod.getCR().length;
  mod.clearToasts();
  mod.reverter('orc2');
  assertEq(mod.getOrc('orc2').status, 'aprovado', '7. TESTE OBRIGATÓRIO — com OS gerada (osRef): status NÃO é revertido, permanece "aprovado"');
  assertEq(mod.getCR().length, crAntes, '8. Nenhum CR foi tocado quando a reversão é bloqueada por OS já gerada');
  assertTrue(mod.getToasts().some(function (t) { return t.tipo === 'err'; }), '8b. Toast de erro explicando o bloqueio (nunca falha silenciosa)');
})();

// ══════════════════════════════════════════════════════════════════════════
// 9-10 — BLOQUEIO: pagamento já confirmado (orcFinanceiroReal().
// recebidoCents>0) — reversão recusada, CR intacto, dinheiro real nunca
// apagado.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var orc3 = novoOrc('orc3');
  mod.addOrc(orc3);
  mod.setFinReal({ recebidoCents: 0 });
  mod.setStatus('orc3', 'aprovado');
  mod.setFinReal({ recebidoCents: 25000 }); // pagamento real já confirmado
  var crAntes = mod.getCR().length;
  mod.clearToasts();
  mod.reverter('orc3');
  assertEq(mod.getOrc('orc3').status, 'aprovado', '9. TESTE OBRIGATÓRIO — com pagamento confirmado: status NÃO é revertido, permanece "aprovado"');
  assertEq(mod.getCR().length, crAntes, '10. CR permanece intacto — dinheiro real nunca apagado por uma reversão de status');
  assertTrue(mod.getToasts().some(function (t) { return t.tipo === 'err' && /pagamento/i.test(t.msg); }), '10b. Toast de erro menciona explicitamente o pagamento confirmado (mensagem clara, não genérica)');
})();

// ══════════════════════════════════════════════════════════════════════════
// 11 — reverter um orçamento que já está "aguardando" (não é 'aprovado')
// não faz nada além de avisar — nunca corrompe estado.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var orc4 = novoOrc('orc4'); // já nasce 'aguardando'
  mod.addOrc(orc4);
  mod.clearToasts();
  mod.reverter('orc4');
  assertEq(mod.getOrc('orc4').status, 'aguardando', '11. Reverter um orçamento que já está "aguardando" não altera nada');
  assertTrue(mod.getToasts().some(function (t) { return t.tipo === 'warn'; }), '11b. Toast de aviso (não é um "aprovado", nada a reverter)');
})();

// ══════════════════════════════════════════════════════════════════════════
// 12 — aprovar de novo depois de uma reversão bem-sucedida cria um NOVO CR
// (o antigo foi cancelado, não reaproveitado) — nunca duplica nem
// referencia um CR morto.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  mod.setFinReal({ recebidoCents: 0 });
  var crIdAntesDaSegundaAprovacao = mod.getOrc('orc1').crId;
  assertEq(crIdAntesDaSegundaAprovacao, undefined, '12a. (sanity) orc1 não tem crId depois da reversão do teste 1');
  mod.setStatus('orc1', 'aprovado');
  assertTrue(!!mod.getOrc('orc1').crId, '12b. Aprovar de novo cria um crId novo');
  var crsDoOrc1 = mod.getCR().filter(function (c) { return c.orcamentoId === 'orc1'; });
  assertEq(crsDoOrc1.length, 1, '12c. Exatamente um CR pendente de orc1 existe (o antigo cancelado não ressuscitou, não há duplicata)');
})();

console.log('\n======================================================================');
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('======================================================================\n');
process.exit(failed > 0 ? 1 : 0);
