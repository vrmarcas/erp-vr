/**
 * test_estabilizacao_bloco4b_mensagens_restantes_2026-09-05.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-05 — continuação do Bloco 4
 * (test_estabilizacao_bloco4_mensagens_automaticas_2026-09-04.js cobriu só
 * os 4 disparos "operacionais" mais diretos; ficaram mapeados e FORA do
 * escopo 9 outros pontos: Vitre catálogo, orçamento pós-OS, CRM
 * follow-up/orçamento/fechamento/pós-venda/entrega, 3 variantes de
 * reativação de base, e o pedido de produção ao fornecedor).
 *
 * Este arquivo cobre a migração desses 9+2 pontos (11 chaves novas) para a
 * mesma fonte única `msgResolverTemplate()`:
 *   vitreOrcamentoEnviado, orcamentoPosOsEnviado, crmFollowup,
 *   crmOrcamentoDisponivel, crmFechamento, crmPosvenda, crmEntrega,
 *   crmReativSaudade, crmReativNovidade, crmReativOferta,
 *   fornecedorPedidoOs
 *
 * Uso: node scripts/test_estabilizacao_bloco4b_mensagens_restantes_2026-09-05.js
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
function extractVar(name, decl) {
  var marker = (decl || 'var ') + name + ' = {';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Variável ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) throw new Error('Chaves desbalanceadas extraindo ' + name);
  return html.slice(start, i + 1) + ';';
}

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-05, BLOCO 4b — Mensagens restantes ===\n');

var NOVAS_CHAVES = [
  'vitreOrcamentoEnviado', 'orcamentoPosOsEnviado',
  'crmFollowup', 'crmOrcamentoDisponivel', 'crmFechamento', 'crmPosvenda', 'crmEntrega',
  'crmReativSaudade', 'crmReativNovidade', 'crmReativOferta',
  'fornecedorPedidoOs'
];

var FN_NAMES = ['msgTemplatesDefault', 'msgValidarPlaceholders', 'msgResolverTemplate'];
var src = [
  extractVar('MSG_TEMPLATES_PLACEHOLDERS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { msgTemplatesDefault, msgValidarPlaceholders, msgResolverTemplate, MSG_TEMPLATES_PLACEHOLDERS };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_bloco4b_mensagens_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);
global.cfgLoad = function () { return {}; };

// ══════════════════════════════════════════════════════════════════════
// As 11 chaves novas foram registradas de verdade na whitelist/defaults
// ══════════════════════════════════════════════════════════════════════
test('1. As 11 chaves novas existem em MSG_TEMPLATES_PLACEHOLDERS', function () {
  NOVAS_CHAVES.forEach(function (chave) {
    assertTrue(Array.isArray(mod.MSG_TEMPLATES_PLACEHOLDERS[chave]), 'chave "' + chave + '" ausente da whitelist');
  });
});

test('2. Cada uma das 11 chaves novas tem default não-vazio e só usa placeholders da própria whitelist (nunca gera envio quebrado)', function () {
  var defaults = mod.msgTemplatesDefault();
  NOVAS_CHAVES.forEach(function (chave) {
    assertTrue(!!defaults[chave] && defaults[chave].length > 5, 'default de "' + chave + '" não pode ser vazio');
    var invalidos = mod.msgValidarPlaceholders(chave, defaults[chave]);
    assertEq(invalidos, [], 'default de "' + chave + '" não pode usar placeholder fora da própria whitelist — achou: ' + invalidos.join(','));
  });
});

test('3. Interpolação real de cada chave nova com todos os campos preenchidos não deixa nenhum {placeholder} literal sobrando', function () {
  var amostras = {
    vitreOrcamentoEnviado: { saudacao: 'Olá', cliente: 'Ana', marca: 'VR', itens: '1x Item', ofertas: '', valor: 'R$ 10', validade: '5 dias', responsavel: 'Vend' },
    orcamentoPosOsEnviado: { cliente: 'Ana', numero_os: '5', marca: 'VR', produto: 'Placa', valor: 'R$ 10' },
    crmFollowup: { nome: 'Ana', produto: 'Placa' },
    crmOrcamentoDisponivel: { nome: 'Ana', valor: 'R$ 10' },
    crmFechamento: { nome: 'Ana' },
    crmPosvenda: { nome: 'Ana' },
    crmEntrega: { nome: 'Ana' },
    crmReativSaudade: { nome: 'Ana', tempo: 'meses' },
    crmReativNovidade: { nome: 'Ana', produtos: 'Acrílico' },
    crmReativOferta: { nome: 'Ana' },
    fornecedorPedidoOs: { os_ref: '10', detalhes: '\nCliente: Ana', arquivo: '' }
  };
  NOVAS_CHAVES.forEach(function (chave) {
    var texto = mod.msgResolverTemplate(chave, amostras[chave]);
    assertTrue(texto.indexOf('{') < 0, 'chave "' + chave + '" deixou placeholder literal sobrando: ' + texto);
  });
});

test('4. Template customizado em Configurações substitui o default também para as 11 chaves novas (mesma fonte única, sem exceção)', function () {
  global.cfgLoad = function () { return { mensagensAutomaticas: { crmFechamento: { texto: 'Oi {nome}, custom!' } } }; };
  var texto = mod.msgResolverTemplate('crmFechamento', { nome: 'Zé' });
  assertEq(texto, 'Oi Zé, custom!', 'deve usar o texto customizado, não o default');
  global.cfgLoad = function () { return {}; };
});

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — os pontos de disparo reais usam msgResolverTemplate(),
// nunca mais string fixa concatenada no próprio ponto.
// ══════════════════════════════════════════════════════════════════════
test('5. vitreOrcEnviarWhatsApp() usa msgResolverTemplate(\'vitreOrcamentoEnviado\', ...)', function () {
  var s = extractFn('vitreOrcEnviarWhatsApp');
  assertTrue(/msgResolverTemplate\(['"]vitreOrcamentoEnviado['"]/.test(s), 'deve chamar msgResolverTemplate');
});

test('6. orcEnviarWhatsApp() usa msgResolverTemplate(\'orcamentoPosOsEnviado\', ...)', function () {
  var s = extractFn('orcEnviarWhatsApp');
  assertTrue(/msgResolverTemplate\(['"]orcamentoPosOsEnviado['"]/.test(s), 'deve chamar msgResolverTemplate');
});

test('7. crmAbrirWhatsApp() usa msgResolverTemplate(\'crmFollowup\', ...) — unificado com CRM_MSG_TEMPLATES.followup (elimina duplicação)', function () {
  var s = extractFn('crmAbrirWhatsApp');
  assertTrue(/msgResolverTemplate\(['"]crmFollowup['"]/.test(s), 'deve chamar msgResolverTemplate');
});

test('8. crmMsgSelecionarTemplate() usa msgResolverTemplate() com a chave dinâmica do template (tpl.chave), não mais .replace() manual', function () {
  var s = extractFn('crmMsgSelecionarTemplate');
  assertTrue(/msgResolverTemplate\(\s*tpl\.chave/.test(s), 'deve resolver via msgResolverTemplate(tpl.chave, ...)');
  assertTrue(!/\.replace\(['"]\{nome\}/.test(s), 'não pode mais usar .replace(\'{nome}\', ...) manual (bug de só substituir a 1ª ocorrência)');
});

test('9. CRM_MSG_TEMPLATES: as 5 entradas apontam para uma chave canônica registrada, nunca mais têm texto hardcoded próprio', function () {
  var s = extractVar('CRM_MSG_TEMPLATES');
  ['followup', 'orcamento', 'fechamento', 'posvenda', 'entrega'].forEach(function (tipo) {
    assertTrue(s.indexOf(tipo + ':') >= 0, 'deve conter a entrada "' + tipo + '"');
  });
  assertTrue(!/texto\s*:/.test(s), 'não pode mais ter propriedade "texto" hardcoded — só "chave" apontando pro template canônico');
  assertTrue(/chave\s*:\s*['"]crmFollowup['"]/.test(s), 'followup deve apontar para a chave crmFollowup');
  assertTrue(/chave\s*:\s*['"]crmOrcamentoDisponivel['"]/.test(s), 'orcamento deve apontar para a chave crmOrcamentoDisponivel');
  assertTrue(/chave\s*:\s*['"]crmFechamento['"]/.test(s), 'fechamento deve apontar para a chave crmFechamento');
  assertTrue(/chave\s*:\s*['"]crmPosvenda['"]/.test(s), 'posvenda deve apontar para a chave crmPosvenda');
  assertTrue(/chave\s*:\s*['"]crmEntrega['"]/.test(s), 'entrega deve apontar para a chave crmEntrega');
});

test('10. crmBaseReativacaoIA() usa as 3 chaves canônicas de reativação (não mais texto fixo concatenado)', function () {
  var s = extractFn('crmBaseReativacaoIA');
  assertTrue(/msgResolverTemplate\(['"]crmReativSaudade['"]/.test(s), 'deve chamar msgResolverTemplate com crmReativSaudade');
  assertTrue(/msgResolverTemplate\(['"]crmReativNovidade['"]/.test(s), 'deve chamar msgResolverTemplate com crmReativNovidade');
  assertTrue(/msgResolverTemplate\(['"]crmReativOferta['"]/.test(s), 'deve chamar msgResolverTemplate com crmReativOferta');
});

test('11. _kbFornOsMsgText() usa msgResolverTemplate(\'fornecedorPedidoOs\', ...) — mensagem ao fornecedor também migrada', function () {
  var s = extractFn('_kbFornOsMsgText');
  assertTrue(/msgResolverTemplate\(['"]fornecedorPedidoOs['"]/.test(s), 'deve chamar msgResolverTemplate');
});

test('12. _kbFornOsMsgText() continua SEM vazar valor de venda/custo/margem (guarda de confidencialidade do Bloco J pré-go-live preservada pela migração)', function () {
  var s = extractFn('_kbFornOsMsgText');
  assertTrue(!/os\.valor|os\.total|os\.preco|os\.custo|os\.margem/.test(s), 'a função não pode voltar a referenciar campos financeiros da OS');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
