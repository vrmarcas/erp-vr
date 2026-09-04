/**
 * test_estabilizacao_bloco4_mensagens_automaticas_2026-09-04.js
 *
 * RODADA DE ESTABILIZAÇÃO 2026-09-04, BLOCO 4 — Configurações → Mensagens
 * Automáticas. Antes desta rodada, o texto de cada disparo automático
 * (OS pronta, cobrança, pagamento confirmado, orçamento enviado) estava
 * hardcoded no próprio ponto de disparo — sem nenhum lugar para editar,
 * e (achado do mapeamento desta rodada) com duplicação/divergência real
 * entre PDF/WhatsApp/CRM.
 *
 * Implementado: msgResolverTemplate() — fonte canônica única — usa o
 * template customizado salvo em Configurações
 * (cfgLoad().mensagensAutomaticas[chave].texto) quando existir, cai no
 * default (msgTemplatesDefault()) caso contrário. msgValidarPlaceholders()
 * bloqueia salvar um placeholder fora da whitelist (nunca "inventa" um
 * placeholder nem envia texto quebrado). Os 4 disparos mais diretamente
 * "mensagem automática operacional" (kbMsgOsPronta, cobrança inline,
 * orcPagtoSucessoWhatsApp, orcEnviarOrcamentoWA) foram reconectados para
 * usar msgResolverTemplate() em vez de string fixa.
 *
 * Uso: node scripts/test_estabilizacao_bloco4_mensagens_automaticas_2026-09-04.js
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

console.log('\n=== RODADA ESTABILIZAÇÃO 2026-09-04, BLOCO 4 — Mensagens Automáticas ===\n');

var FN_NAMES = ['msgTemplatesDefault', 'msgValidarPlaceholders', 'msgResolverTemplate'];
var src = [
  extractVar('MSG_TEMPLATES_PLACEHOLDERS'),
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { msgTemplatesDefault, msgValidarPlaceholders, msgResolverTemplate, MSG_TEMPLATES_PLACEHOLDERS };'
].join('\n\n');
var modPath = path.join(__dirname, '_estabilizacao_bloco4_mensagens_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

// ══════════════════════════════════════════════════════════════════════
// msgResolverTemplate() — motor de templates
// ══════════════════════════════════════════════════════════════════════
test('1. Sem template customizado (cfgLoad vazio): usa o default e interpola os placeholders corretamente', function () {
  global.cfgLoad = function () { return {}; };
  var texto = mod.msgResolverTemplate('osPronta', { cliente: 'Maria', numero_os: '42', produto: 'Caixa' });
  assertTrue(texto.indexOf('Maria') >= 0, 'deve interpolar {cliente}');
  assertTrue(texto.indexOf('42') >= 0, 'deve interpolar {numero_os}');
  assertTrue(texto.indexOf('Caixa') >= 0, 'deve interpolar {produto}');
  assertTrue(texto.indexOf('{') < 0, 'não pode sobrar nenhum {placeholder} literal quando todos são válidos e fornecidos');
});

test('2. COM template customizado salvo: usa o texto customizado, nunca o default', function () {
  global.cfgLoad = function () { return { mensagensAutomaticas: { osPronta: { texto: 'Oi {cliente}, seu pedido {numero_os} chegou!' } } }; };
  var texto = mod.msgResolverTemplate('osPronta', { cliente: 'João', numero_os: '99', produto: 'X' });
  assertEq(texto, 'Oi João, seu pedido 99 chegou!', 'deve usar o template customizado, não o default');
});

test('3. Template customizado VAZIO ("") cai no default (nunca envia mensagem em branco)', function () {
  global.cfgLoad = function () { return { mensagensAutomaticas: { osPronta: { texto: '' } } }; };
  var texto = mod.msgResolverTemplate('osPronta', { cliente: 'Ana', numero_os: '1', produto: 'Y' });
  assertTrue(texto.indexOf('Ana') >= 0 && texto.length > 10, 'template vazio deve cair no default, nunca mandar mensagem vazia');
});

test('4. Placeholder FORA da whitelist do template nunca é interpolado — fica literal (visível), nunca inventado nem apagado em silêncio', function () {
  global.cfgLoad = function () { return { mensagensAutomaticas: { osPronta: { texto: 'Olá {cliente}, seu {campo_inexistente} está pronto.' } } }; };
  var texto = mod.msgResolverTemplate('osPronta', { cliente: 'Zé', numero_os: '1', produto: 'Y' });
  assertTrue(texto.indexOf('{campo_inexistente}') >= 0, 'placeholder desconhecido deve permanecer literal, nunca virar vazio/undefined silenciosamente');
});

test('5. Cada um dos 4 templates tem default não-vazio e usa só placeholders da própria whitelist', function () {
  global.cfgLoad = function () { return {}; };
  var defaults = mod.msgTemplatesDefault();
  Object.keys(mod.MSG_TEMPLATES_PLACEHOLDERS).forEach(function (chave) {
    assertTrue(!!defaults[chave] && defaults[chave].length > 5, 'default de "' + chave + '" não pode ser vazio');
    var invalidos = mod.msgValidarPlaceholders(chave, defaults[chave]);
    assertEq(invalidos, [], 'default de "' + chave + '" não pode usar placeholder fora da própria whitelist — achou: ' + invalidos.join(','));
  });
});

// ══════════════════════════════════════════════════════════════════════
// msgValidarPlaceholders() — validação usada pela UI de Configurações
// ══════════════════════════════════════════════════════════════════════
test('6. msgValidarPlaceholders() detecta placeholder inválido (usado pela UI para bloquear "Salvar")', function () {
  var invalidos = mod.msgValidarPlaceholders('cobranca', 'Olá {cliente}, sua fatura {numero_nota_fiscal} venceu.');
  assertEq(invalidos, ['numero_nota_fiscal'], 'deve listar exatamente o placeholder inválido');
});

test('7. msgValidarPlaceholders() não acusa nada quando todos os placeholders usados são válidos', function () {
  var invalidos = mod.msgValidarPlaceholders('cobranca', 'Olá {cliente}! Sua conta {valor} venceu em {vencimento}.');
  assertEq(invalidos, [], 'nenhum placeholder inválido deveria ser encontrado');
});

// ══════════════════════════════════════════════════════════════════════
// PROVA ESTÁTICA — os 4 disparos reais usam msgResolverTemplate(), nunca
// mais uma string fixa concatenada no próprio ponto de disparo.
// ══════════════════════════════════════════════════════════════════════
test('8. kbMsgOsPronta() usa msgResolverTemplate(\'osPronta\', ...)', function () {
  var src = extractFn('kbMsgOsPronta');
  assertTrue(/msgResolverTemplate\(['"]osPronta['"]/.test(src), 'deve chamar msgResolverTemplate');
});

test('9. orcPagtoSucessoWhatsApp() usa msgResolverTemplate(\'pagamentoConfirmado\', ...)', function () {
  var src = extractFn('orcPagtoSucessoWhatsApp');
  assertTrue(/msgResolverTemplate\(['"]pagamentoConfirmado['"]/.test(src), 'deve chamar msgResolverTemplate');
});

test('10. orcEnviarOrcamentoWA() usa msgResolverTemplate(\'orcamentoEnviado\', ...)', function () {
  var src = extractFn('orcEnviarOrcamentoWA');
  assertTrue(/msgResolverTemplate\(['"]orcamentoEnviado['"]/.test(src), 'deve chamar msgResolverTemplate');
});

test('11. Configurações → Mensagens Automáticas é gated a Master (cfgMsgAutoRender)', function () {
  var src = extractFn('cfgMsgAutoRender');
  assertTrue(/_normalizeRole.*===\s*['"]master['"]/.test(src), 'deve checar role master antes de liberar edição');
});

test('12. cfgMsgAutoSalvar() bloqueia salvar quando há placeholder inválido (nunca persiste texto quebrado)', function () {
  var src = extractFn('cfgMsgAutoSalvar');
  assertTrue(/msgValidarPlaceholders/.test(src), 'deve validar antes de chamar cfgSave');
  var idxValida = src.indexOf('msgValidarPlaceholders');
  var idxSave = src.indexOf('cfgSave(');
  assertTrue(idxValida >= 0 && idxSave > idxValida, 'a validação deve vir ANTES do cfgSave()');
});

console.log('\n' + '─'.repeat(60));
console.log('Total: ' + (passed + failed) + '  |  ✅ ' + passed + '  |  ❌ ' + failed);
if (failed > 0) { console.log('\n❌ FALHOU\n'); process.exit(1); }
console.log('\n✅ PASSOU\n');
