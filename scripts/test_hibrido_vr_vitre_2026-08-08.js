/**
 * test_hibrido_vr_vitre_2026-08-08.js
 *
 * RODADA 6, seção 10 — Híbrido VR+Vitre ("Ponte de OS vinculadas",
 * decisão explícita do usuário): um pedido continua sendo UM orçamento/
 * venda/lançamento financeiro do lado VR, mas o carrinho pode incluir
 * itens do catálogo Vitre (tipoItem:'vitre_catalogo') junto com os itens
 * personalizados VR (tipoItem:'personalizado_vr'). Testa as funções
 * puras REAIS extraídas de index.html:
 *   orcVitreItensPedidoTotal / orcMontarPayloadVitreParaOS
 *
 * A classificação real de estoque/ficha técnica dos itens Vitre roda no
 * backend (functions/src/vitre.ts, vitreClassificarItensPedidoUnificado)
 * e já foi verificada com chamadas reais contra o Functions Emulator —
 * não reimplementada aqui.
 *
 * Uso: node scripts/test_hibrido_vr_vitre_2026-08-08.js
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

var FN_NAMES = [
  'orcProdutoNomeResolvido','orcVitreItensPedidoTotal', 'orcMontarPayloadVitreParaOS'];
var src = [
  FN_NAMES.map(extractFn).join('\n\n'),
  'module.exports = { total: orcVitreItensPedidoTotal, payload: orcMontarPayloadVitreParaOS };'
].join('\n\n');
var modPath = path.join(__dirname, '_hibrido_vr_vitre_extracted.tmp.js');
fs.writeFileSync(modPath, src);
delete require.cache[require.resolve(modPath)];
var mod = require(modPath);

console.log('\n=== RODADA 6 — Híbrido VR+Vitre: carrinho único (seção 10) ===\n');

// ── orcVitreItensPedidoTotal ─────────────────────────────────────────
{
  test('1. carrinho vazio soma zero', mod.total([]), 0);
  test('2. carrinho undefined nunca quebra', mod.total(undefined), 0);
  test('3. um item soma qty*precoVenda', mod.total([{ sku: 'A', qty: 2, precoVenda: 50 }]), 100);
  test('4. múltiplos itens somam corretamente', mod.total([{ sku: 'A', qty: 2, precoVenda: 50 }, { sku: 'B', qty: 1, precoVenda: 30 }]), 130);
  test('5. qty ausente assume 1', mod.total([{ sku: 'A', precoVenda: 20 }]), 20);
  test('6. precoVenda ausente/inválido conta como 0 (nunca quebra, nunca inventa preço)', mod.total([{ sku: 'A', qty: 3, precoVenda: 'abc' }]), 0);
}

// ── orcMontarPayloadVitreParaOS ──────────────────────────────────────
{
  var carrinho = [
    { tipoItem: 'personalizado_vr', prod: 'Caixa', qty: 1 },
    { tipoItem: 'vitre_catalogo', sku: 'SKU-1', prod: 'Produto Vitre', qty: 2, precoVenda: 99 },
    { tipoItem: 'vitre_catalogo', sku: 'SKU-2', prod: 'Outro Vitre', qty: 1, precoVenda: 50 },
  ];
  test('7. filtra só os itens Vitre do carrinho misto (nunca inclui itens VR)', mod.payload(carrinho), [{ sku: 'SKU-1', qtd: 2 }, { sku: 'SKU-2', qtd: 1 }]);
  test('8. NUNCA envia preço/nome no payload (servidor sempre re-resolve do catálogo — mesmo contrato de vitreCriarOrcamento)', Object.keys(mod.payload(carrinho)[0]).sort(), ['qtd', 'sku']);
  test('9. carrinho só com itens VR devolve payload vazio', mod.payload([{ tipoItem: 'personalizado_vr', prod: 'X' }]), []);
  test('10. carrinho vazio/undefined nunca quebra', mod.payload(undefined), []);
  test('11. item Vitre sem sku é ignorado (nunca envia sku vazio ao backend)', mod.payload([{ tipoItem: 'vitre_catalogo', qty: 1 }]), []);
}

// ── Regressão estrutural: salvar/reabrir/gerar OS preservam o carrinho
//    Vitre no MESMO orçamento (nunca um segundo orçamento/financeiro) ──
{
  var srcSalvar = extractFn('_orcSalvarOrcamentoImpl');
  var srcEditar = extractFn('orcEnvEditar');
  var srcGerarOS = extractFn('orcEnvGerarOS');

  test('12. _orcSalvarOrcamentoImpl() transporta _orcVitreItensPedido para itens[] (tipoItem vitre_catalogo)',
    /_orcVitreItensPedido[\s\S]{0,80}forEach[\s\S]{0,120}tipoItem:\s*'vitre_catalogo'/.test(srcSalvar), true);

  test('13. orcEnvEditar() desvia itens tipoItem=vitre_catalogo de orcAddItem() de volta para _orcVitreItensPedido',
    /it\.tipoItem\s*===\s*'vitre_catalogo'[\s\S]{0,200}_orcVitreItensPedido\.push/.test(srcEditar), true);

  test('14. orcEnvGerarOS() só classifica itens Vitre DEPOIS da transação VR confirmar (nunca dentro dela)',
    (function(){
      var idxCommit = srcGerarOS.indexOf('runTransaction');
      var idxClassif = srcGerarOS.indexOf('vitreClassificarItensPedidoUnificado');
      return idxCommit >= 0 && idxClassif > idxCommit;
    })(), true);

  test('15. orcEnvGerarOS() usa o id do próprio kb_os como grupoPedidoId/kbOsRef (vínculo canônico, sem novo orçamento)',
    /grupoPedidoId:\s*_newIdCaptured,\s*kbOsRef:\s*_newIdCaptured/.test(srcGerarOS), true);

  test('16. orcEnvGerarOS() nunca cria um segundo orçamento/venda para os itens Vitre (payload não referencia vitreCriarOrcamento)',
    srcGerarOS.indexOf('vitreCriarOrcamento') === -1, true);

  test('17. falha na classificação Vitre nunca desfaz a OS/orçamento VR já confirmados (resultado sempre retorna adiante)',
    /catch\(function\(e\)\{[\s\S]{0,300}return resultado;/.test(srcGerarOS), true);
}

// ── RODADA 6, seção 3 — achado real da auditoria de paridade PDF/
//    WhatsApp: orcColetarItensDistribuidos() (fonte única de itens usada
//    por AMBOS) só lia #orcItemBody (linhas VR) — um pedido híbrido saía
//    do PDF/WhatsApp SEM os itens Vitre, mesmo o total já incluindo o
//    valor deles. Testa por EXECUÇÃO real (não só regex) com um DOM fake.
{
  var FN_DIST = ['orcProdutoNomeResolvido', 'orcItemDescricaoComercial', 'orcColetarItensDistribuidos'];
  var srcDist = FN_DIST.map(extractFn).join('\n\n') + '\n\nmodule.exports = { coletar: orcColetarItensDistribuidos };';
  var modPathDist = path.join(__dirname, '_hibrido_vr_vitre_distribuidos_extracted.tmp.js');
  fs.writeFileSync(modPathDist, srcDist);
  delete require.cache[require.resolve(modPathDist)];

  var _elements = {};
  function makeEl(props) { return Object.assign({ value: '', textContent: '' }, props || {}); }
  global.window = { _orcCalc: { finalPrice: 1300 } };
  global.document = {
    getElementById: function (id) { return _elements[id]; },
    querySelectorAll: function (sel) {
      if (sel === '#orcItemBody tr') return [{ dataset: { idx: '1' } }];
      return [];
    }
  };
  _elements = {
    oi_prod_1: makeEl({ value: 'Caixa Acrílico' }),
    oi_qty_1: makeEl({ value: '1' }),
    oi_larg_1: makeEl({ value: '' }),
    oi_alt_1: makeEl({ value: '' }),
    oi_det_1: makeEl({ value: '' }),
    oi_mat_1: { selectedIndex: 0, options: [{ text: '' }] },
    oi_tot_1: makeEl({ textContent: 'R$ 300,00' })
  };
  global._orcVitreItensPedido = [
    { tipoItem: 'vitre_catalogo', sku: 'SKU-1', prod: 'Porta-Retrato Vitre', qty: 2, precoVenda: 500 }
  ];
  var modDist = require(modPathDist);
  var itens = modDist.coletar(1300);

  test('18. achado real corrigido: itens do catálogo Vitre no carrinho aparecem no PDF/WhatsApp (antes saíam de fora)',
    itens.length, 2);
  test('19. item Vitre entra com a descrição do produto (não "—"/vazio)',
    itens[1].desc, 'Porta-Retrato Vitre');
  test('20. soma dos itens distribuídos (VR + Vitre) bate exatamente com o total do pedido — nunca falta o valor Vitre',
    Math.round((itens[0].total + itens[1].total) * 100) / 100, 1300);
  test('21. proporção respeita o peso de catálogo do item Vitre (300 VR : 1000 Vitre, de um total de 1300)',
    Math.round(itens[1].total), 1000);

  global._orcVitreItensPedido = [];
  var itensSoVR = modDist.coletar(300);
  test('22. carrinho sem itens Vitre continua funcionando exatamente como antes (nunca quebra o caso comum)',
    itensSoVR.length, 1);
}

console.log('\n' + '='.repeat(70));
console.log(' RESULTADO: ' + passed + ' passaram, ' + failed + ' falharam (' + (passed + failed) + ' total)');
console.log('='.repeat(70) + '\n');
if (failed > 0) process.exitCode = 1;
