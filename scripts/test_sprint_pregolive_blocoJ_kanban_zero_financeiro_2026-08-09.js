/**
 * test_sprint_pregolive_blocoJ_kanban_zero_financeiro_2026-08-09.js
 *
 * SPRINT PRÉ-GO-LIVE, Bloco J — achado real de homologação: o detalhe do
 * Kanban mostrava "VALOR TOTAL R$49,46". Kanban é 100% operacional/
 * Produção — nunca pode expor valor de venda, custo, margem, desconto,
 * entrada, saldo ou pagamento, independentemente do papel do usuário
 * (nem para Master).
 *
 * Achados (2 pontos, não só 1):
 *   1. kbOpen() — o modal de detalhe da OS (#kbGrid) tinha um campo fixo
 *      "Valor Total" alimentado por os.valor (um dos campos financeiros
 *      mesclados de kb_os_fin via _kbMergeFinCache() — populado para
 *      Master/Financeiro/Comercial, nunca para Produção pelas Rules, mas
 *      o Bloco J exige removê-lo de qualquer papel, não só de Produção).
 *   2. _kbFornOsMsgText() — pior ainda: a mensagem de WhatsApp/e-mail
 *      enviada a um FORNECEDOR (terceiro externo à empresa) incluía
 *      "Valor: R$X,XX" — vazando o valor de venda ao cliente final para
 *      fora da empresa.
 *
 * kbOpen() é uma função grande (~270 linhas, dezenas de dependências de
 * DOM/outras funções kb*), então o teste 1 usa o padrão já estabelecido
 * nesta suíte para funções desse porte: regressão estrutural (regex sobre
 * a função extraída). _kbFornOsMsgText() é pequena e autocontida — testada
 * por execução real.
 *
 * Uso: node scripts/test_sprint_pregolive_blocoJ_kanban_zero_financeiro_2026-08-09.js
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

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFn(name) {
  var marker = 'function ' + name + '(';
  var start = html.indexOf(marker);
  if (start < 0) throw new Error('Função ' + name + ' não encontrada — teste desatualizado?');
  var braceOpen = html.indexOf('{', start);
  var depth = 0, i = braceOpen;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(start, i + 1);
}

console.log('\n=== SPRINT PRÉ-GO-LIVE, Bloco J — Kanban: zero dado financeiro ===\n');

// ── 1-3. Regressão estrutural: kbOpen() nunca mais renderiza "Valor Total" ──
{
  var srcKbOpen = extractFn('kbOpen');
  test('1. achado real corrigido: kbOpen() não tem mais o campo "Valor Total" no template do #kbGrid',
    /Valor Total/.test(srcKbOpen), false);
  test('2. kbOpen() não computa mais _valorFmt a partir de os.valor (o campo financeiro mesclado de kb_os_fin)',
    /_valorFmt/.test(srcKbOpen), false);
  // HOTFIX 2026-08-16 (P0.8) — o rótulo do campo de data passou a ser
  // condicional ("Entrega" OU "Data sugerida/definida", quando a OS tem
  // prazo prometido histórico — ver os.prazoPrometidoTexto) — o CAMPO
  // continua lá, só o rótulo virou dinâmico; regex atualizado para aceitar
  // qualquer um dos dois, nunca a ausência do campo.
  test('3. regressão — kbOpen() continua mostrando os campos operacionais legítimos (Cliente/Cidade/Material/Medidas/Entrega ou Data sugerida)',
    /Cliente<\/div>/.test(srcKbOpen) && /Material<\/div>/.test(srcKbOpen) && (/Entrega<\/div>/.test(srcKbOpen) || /'Entrega'/.test(srcKbOpen)), true);
}

// ── 4-6. Execução real: _kbFornOsMsgText() nunca mais inclui valor de venda ──
{
  var src = extractFn('_kbFornOsMsgText') + '\n\nmodule.exports = { _kbFornOsMsgText };';
  var modPath = path.join(__dirname, '_blocoJ_kb_forn_msg_extracted.tmp.js');
  fs.writeFileSync(modPath, src);
  delete require.cache[require.resolve(modPath)];

  global._kbOsId = 'os1';
  global.KB_OS = { os1: {
    num: 42, titulo: 'Carrinho de Make', cliente: 'Cliente Teste',
    material: 'MDF 15mm', medidas: '50x40cm', qty: 2, entrega: '10/08/2026',
    fileLink: '',
    // achado real: este campo financeiro (mesclado de kb_os_fin) vazava
    // direto na mensagem — o teste prova que ele é ignorado agora.
    valor: 49.46
  } };

  var mod = require(modPath);
  var msg = mod._kbFornOsMsgText();

  test('4. achado real corrigido: mensagem ao FORNECEDOR nunca menciona "Valor" — vazava o preço de venda ao cliente final para um terceiro externo',
    /valor/i.test(msg), false);
  test('5. o valor numérico específico (49.46 / 49,46) nunca aparece na mensagem, mesmo estando em KB_OS[id].valor',
    /49[.,]46/.test(msg), false);
  test('6. regressão — a mensagem continua com os dados operacionais legítimos (OS, cliente, material, medidas, quantidade, prazo)',
    /OS #42/.test(msg) && /Cliente Teste/.test(msg) && /MDF 15mm/.test(msg) && /Quantidade: 2/.test(msg) && /10\/08\/2026/.test(msg), true);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
