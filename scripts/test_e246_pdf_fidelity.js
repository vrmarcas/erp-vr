/**
 * test_e246_pdf_fidelity.js — ValerIA 2.0 / ERP, Fase E.2.46 (2026-09-22),
 * estendido nas Fases E.2.46.1 (renderização direta via html2canvas,
 * substituindo jsPDF.html()), E.2.46.2 (JPEG q=0.92 no lugar de PNG —
 * ~7,9MB → ~128KB no orçamento piloto, sem perda visual perceptível) e
 * E.2.47 (esconder elementos .no-print na captura do PDF).
 *
 * index.html não tem harness de testes (mesmo padrão de
 * scripts/test_e238_*.js / test_e243_*.js). Este script:
 *   (a) extrai por contagem-de-chaves as funções PURAS de geração de HTML
 *       do orçamento Vitre (vitreOrcFmtBRL, vitreOrcNumeroExibicao,
 *       vitreOrcMontarHtmlOrcamento) e testa a SAÍDA real delas — dados
 *       reais do caso piloto (E.2.36) + cenários A-K do pedido (item 15);
 *   (b) checagens estáticas — fonte única de verdade (vitreOrcGerarPDF e
 *       generateVitreQuotePdf chamam a MESMA função, nunca duas
 *       implementações de layout), dependências (html2canvas) presentes,
 *       renderização via html2canvas direto + doc.addImage() (nunca mais
 *       jsPDF.html()), JPEG q=0.92 (nunca mais PNG), nenhum arquivo do
 *       fluxo VR personalizado tocado (item 17 do pedido).
 *
 * A fidelidade visual e o tamanho final do arquivo (piloto ~128KB,
 * cenário multipágina de 24 itens ~523KB/2 páginas reais) foram
 * verificados ao vivo com jsPDF+html2canvas reais num harness temporário
 * (removido) e aprovados visualmente — este script cobre a parte
 * ESTÁTICA/estrutural, não repete a renderização real a cada execução.
 *
 * Uso: node scripts/test_e246_pdf_fidelity.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BRAND_CONFIG_JS = fs.readFileSync(path.join(ROOT, 'assets', 'brands', 'brand-config.js'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, desc, detail) {
  if (cond) { pass++; console.log('  ✅ ' + desc); }
  else { fail++; console.log('  ❌ ' + desc + (detail ? ' — ' + detail : '')); }
}

function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('função ' + name + ' não encontrada em index.html');
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const FN_NAMES = [
  'vitreOrcToCentavos', 'vitreOrcItemBaseCentavos', 'vitreOrcItemAcrescimoCentavos',
  'vitreOrcFmtBRL', 'vitreOrcNumeroExibicao', 'vitreOrcMontarHtmlOrcamento',
];
const COMBINED_SRC = FN_NAMES.map((n) => extractFunction(INDEX_HTML, n)).join('\n\n');

function makeCtx() {
  const ctx = {
    console,
    location: { origin: 'file://root' },
    cfgEsc: (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    orcGetResponsavel: () => 'Equipe Vitre',
    Number, String, Array, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(BRAND_CONFIG_JS, ctx, { filename: 'brand-config.js' });
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e246.js' });
  return ctx;
}

console.log('== Parte 1 — vitreOrcFmtBRL (formatação pt-BR obrigatória) ==');
{
  const ctx = makeCtx();
  assert(ctx.vitreOrcFmtBRL(3300) === 'R$ 3.300,00', 'vitreOrcFmtBRL(3300) === "R$ 3.300,00" (item 7 do pedido — nunca R$ 3300.00)');
  assert(ctx.vitreOrcFmtBRL(165) === 'R$ 165,00', 'vitreOrcFmtBRL(165) === "R$ 165,00"');
  assert(ctx.vitreOrcFmtBRL(8617.5) === 'R$ 8.617,50', 'vitreOrcFmtBRL(8617.5) === "R$ 8.617,50" (milhar + centavos)');
  assert(ctx.vitreOrcFmtBRL(0) === 'R$ 0,00', 'vitreOrcFmtBRL(0) === "R$ 0,00"');
  assert(ctx.vitreOrcFmtBRL(undefined) === 'R$ 0,00', 'vitreOrcFmtBRL(undefined) nunca quebra — "R$ 0,00"');
}

console.log('\n== Parte 2 — vitreOrcNumeroExibicao (item 8 do pedido — sem vazar prefixo interno) ==');
{
  const ctx = makeCtx();
  assert(ctx.vitreOrcNumeroExibicao('valeria2_catalog_cmt95yjqa0dksuvqt63to9tbm') === 'cmt95yjq', 'rascunho V2 → prefixo "valeria2_catalog_" removido antes do truncamento (nunca mostra "valeria2")');
  assert(ctx.vitreOrcNumeroExibicao('abcdef1234567890') === 'abcdef12', 'orçamento manual (id aleatório do Firestore) → mesmo truncamento de sempre, comportamento inalterado');
  assert(!ctx.vitreOrcNumeroExibicao('valeria2_catalog_cmt95yjqa0dksuvqt63to9tbm').includes('valeria2'), 'nunca contém a string "valeria2" — nenhum vazamento de detalhe interno de implementação');
}

console.log('\n== Parte 3 — vitreOrcMontarHtmlOrcamento — caso piloto real (E.2.36) ==');
{
  const ctx = makeCtx();
  const quote = {
    id: 'valeria2_catalog_cmt95yjqa0dksuvqt63to9tbm',
    clienteNome: 'Cliente WhatsApp', clienteTel: null, observacoes: '',
    itens: [{ sku: 'C4TC3M', nome: 'Caixa 4mm, tampa de correr 3mm', precoVenda: 165, qtd: 20, adicionais: [] }],
    total: 3300, subtotal: 3300, frete: 0, valorDesconto: 0, prazoValidadeDias: 7,
  };
  const html = ctx.vitreOrcMontarHtmlOrcamento(quote);
  assert(html.includes('R$ 3.300,00'), 'total formatado em pt-BR aparece no HTML');
  assert(html.includes('R$ 165,00'), 'unitário formatado em pt-BR aparece no HTML');
  assert(html.includes('Nº cmt95yjq'), 'número exibido sem o prefixo interno "valeria2_catalog_"');
  assert(!html.includes('valeria2'), 'HTML final nunca contém a string "valeria2"');
  assert(html.includes('assets/brand/vitre-logo.png'), 'logo real do asset Vitre referenciado (nunca base64 hardcoded nem texto genérico)');
  assert(html.includes('Validade: 7 dias'), 'validade exibida é a REAL do orçamento (7 dias), nunca um valor arbitrário diferente');
  assert(html.includes('C4TC3M'), 'SKU do item aparece');
  assert(!html.includes('Observações'), 'sem observacoes preenchida → bloco de Observações OMITIDO (nunca vazio/inventado — item 6 do pedido)');
}

console.log('\n== Parte 4 — testes funcionais A-K (item 15 do pedido) ==');
{
  const ctx = makeCtx();
  const base = { id: 'abcdef1234567890', clienteNome: 'Cliente Teste', clienteTel: null, observacoes: '', itens: [], total: 0, subtotal: 0, frete: 0, valorDesconto: 0, prazoValidadeDias: 7 };

  // A. 1 item (conta só <tr><td>, exclui a linha de cabeçalho <thead><tr><th>)
  {
    const q = { ...base, itens: [{ sku: 'SKU1', nome: 'Produto Único', precoVenda: 100, qtd: 2, adicionais: [] }], total: 200 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert((html.match(/<tr><td/g) || []).length === 1, 'A. 1 item → exatamente 1 linha de produto na tabela');
  }

  // B. múltiplos itens
  {
    const q = { ...base, itens: [{ sku: 'S1', nome: 'P1', precoVenda: 10, qtd: 1, adicionais: [] }, { sku: 'S2', nome: 'P2', precoVenda: 20, qtd: 2, adicionais: [] }, { sku: 'S3', nome: 'P3', precoVenda: 30, qtd: 3, adicionais: [] }], total: 150 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert((html.match(/<tr><td/g) || []).length === 3, 'B. múltiplos itens → 1 linha por item na tabela');
  }

  // C. nome longo
  {
    const nomeLongo = 'Caixa 4mm, tampa de correr 3mm — modelo reforçado para transporte de longa distância com embalagem extra';
    const q = { ...base, itens: [{ sku: 'S1', nome: nomeLongo, precoVenda: 10, qtd: 1, adicionais: [] }], total: 10 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(html.includes(nomeLongo), 'C. nome longo do produto nunca é truncado/cortado no HTML');
  }

  // D. observações
  {
    const q = { ...base, observacoes: 'Cliente pediu entrega em dois lotes.' };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(html.includes('Observações') && html.includes('Cliente pediu entrega em dois lotes.'), 'D. observações preenchidas → bloco aparece com o texto real');
  }

  // E. personalização cosmética (Fase E.2.42 — chega via observacoes)
  {
    const q = { ...base, observacoes: 'Personalização (ValerIA): Aplicar logo do cliente' };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(html.includes('Aplicar logo do cliente'), 'E. personalização cosmética (via observacoes) aparece no PDF para revisão humana');
  }

  // F. desconto
  {
    const q = { ...base, itens: [{ sku: 'S1', nome: 'P1', precoVenda: 100, qtd: 1, adicionais: [] }], total: 90, valorDesconto: 10 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(html.includes('R$ 90,00'), 'F. desconto → total exibido já reflete o valor com desconto aplicado (mesma regra do template oficial — desconto nunca é uma linha separada mostrada ao cliente)');
  }

  // G. frete
  {
    const q = { ...base, itens: [{ sku: 'S1', nome: 'P1', precoVenda: 100, qtd: 1, adicionais: [] }], total: 110, frete: 10 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(/frete R\$ 10,00 inclu[íi]do/.test(html), 'G. frete > 0 → aparece formatado em pt-BR junto ao total');
  }
  {
    const q = { ...base, itens: [{ sku: 'S1', nome: 'P1', precoVenda: 100, qtd: 1, adicionais: [] }], total: 100, frete: 0 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(!html.includes('frete'), 'G. frete === 0 → nunca menciona frete (omitido, não inventa "frete grátis")');
  }

  // H. validade
  {
    const q = { ...base, prazoValidadeDias: 15 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(html.includes('Validade: 15 dias'), 'H. validade exibida é exatamente o valor salvo no orçamento (nunca um padrão hardcoded diferente)');
  }

  // I. ausência de dados opcionais (sem telefone, sem observações)
  {
    const q = { ...base, clienteTel: null, observacoes: '' };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(!html.includes('📞 null') && !html.includes('📞 undefined'), 'I. clienteTel ausente → nunca renderiza "null"/"undefined" literal');
    assert(!html.includes('Observações'), 'I. observacoes ausente → bloco omitido, nunca aparece vazio');
  }

  // J. quebra de página (comportamento estrutural — ver Parte 5, checagem estática do autoPaging)
  console.log('  ℹ️  J. quebra de página — coberta na Parte 5 (checagem estática do fatiamento manual de canvas em generateVitreQuotePdf, Fase E.2.46.1)');

  // K. formatação pt-BR (cobre valores grandes/decimais em conjunto)
  {
    const q = { ...base, itens: [{ sku: 'S1', nome: 'P1', precoVenda: 1234.5, qtd: 3, adicionais: [] }], total: 3703.5 };
    const html = ctx.vitreOrcMontarHtmlOrcamento(q);
    assert(html.includes('R$ 1.234,50') && html.includes('R$ 3.703,50'), 'K. valores grandes com milhar+centavos formatados corretamente em pt-BR');
  }
}

console.log('\n== Parte 5 — checagens estáticas (fonte única de verdade + dependências + regressão) ==');
{
  // Fonte única — vitreOrcGerarPDF (impressão) e generateVitreQuotePdf (WhatsApp) chamam a MESMA função.
  const idxGerarPDF = INDEX_HTML.indexOf('function vitreOrcGerarPDF()');
  const blocoGerarPDF = INDEX_HTML.slice(idxGerarPDF, idxGerarPDF + 600);
  assert(blocoGerarPDF.includes('vitreOrcMontarHtmlOrcamento(VITRE_ORC_ULTIMO)'), 'vitreOrcGerarPDF() (impressão) usa vitreOrcMontarHtmlOrcamento — fonte única com o PDF do WhatsApp');
  assert(!blocoGerarPDF.includes("+ '<!DOCTYPE"), 'vitreOrcGerarPDF() não monta mais o HTML manualmente (string concatenada) — delega para a função compartilhada');

  const idxGenPdf = INDEX_HTML.indexOf('function generateVitreQuotePdf(quote)');
  const blocoGenPdf = INDEX_HTML.slice(idxGenPdf, idxGenPdf + 6000);
  assert(blocoGenPdf.includes('vitreOrcMontarHtmlOrcamento(quote)'), 'generateVitreQuotePdf() usa vitreOrcMontarHtmlOrcamento — mesma fonte, nunca um segundo layout desenhado à mão');
  assert(!blocoGenPdf.includes("doc.setFillColor") && !blocoGenPdf.includes('doc.rect('), 'generateVitreQuotePdf() não desenha mais tabela/retângulos manualmente com jsPDF (abordagem antiga da Fase E.2.43, causa raiz do bug visual)');
  assert(blocoGenPdf.includes('window.html2canvas('), 'generateVitreQuotePdf() usa html2canvas para renderizar o HTML oficial em vez de redesenhar (chamado direto desde a Fase E.2.46.1, nunca via jsPDF.html())');

  // Fase E.2.46.1 — achado real na aprovação visual: jsPDF.html() calcula
  // sua própria escala e se mostrou pouco confiável com o elemento de
  // origem dentro de um iframe (conteúdo saía comprimido/quebrado).
  // Corrigido chamando html2canvas DIRETAMENTE (nunca mais via jsPDF.html())
  // com width/height/windowWidth/windowHeight explícitos, e inserindo o
  // canvas como imagem via doc.addImage() — nunca mais doc.html().
  assert(!blocoGenPdf.includes('doc.html('), 'E.2.46.1 — regressão: jsPDF.html() (causa raiz do conteúdo comprimido) não reaparece — só html2canvas direto + doc.addImage()');
  assert(blocoGenPdf.includes('doc.addImage('), 'E.2.46.1 — usa doc.addImage() para inserir o canvas renderizado, escala sempre explícita e sob controle');
  assert(/windowWidth:\s*PAGE_WIDTH_PX/.test(blocoGenPdf) && /windowHeight:\s*contentHeightPx/.test(blocoGenPdf), 'E.2.46.1 — width/height/windowWidth/windowHeight são explícitos (medidos do conteúdo real), nunca deixados para o jsPDF calcular sozinho');
  assert(/while\s*\(offsetPx < canvas\.height\)/.test(blocoGenPdf), 'J. multipágina: fatia o canvas por altura de página A4 manualmente (substituiu autoPaging do jsPDF.html(), removido nesta fase)');

  // Fase E.2.46.2 — achado real na aprovação: PNG (sem perdas) gerava PDF
  // de ~7,9MB para 1 item, arriscando estourar MAX_PDF_BYTES do backend em
  // orçamentos maiores. JPEG q=0.92 reduz ~61x sem diferença visual
  // perceptível (mesmo scale:2, mesma resolução) — testado objetivamente
  // contra scale 1.5/2 × PNG/JPEG(0.85/0.92) antes de escolher.
  assert(/scale:\s*2/.test(blocoGenPdf), 'E.2.46.2 — scale:2 preservado (nitidez máxima, tamanho deixou de ser o fator limitante com JPEG)');
  assert((blocoGenPdf.match(/toDataURL\('image\/jpeg',\s*JPEG_QUALITY\)/g) || []).length === 2, 'E.2.46.2 — as DUAS chamadas de exportação (página única E cada fatia multipágina) usam JPEG, nenhuma delas ficou em PNG');
  assert(/var JPEG_QUALITY = 0\.92/.test(blocoGenPdf), 'E.2.46.2 — qualidade JPEG é exatamente 0.92 (aprovada), nunca um valor diferente sem nova aprovação');
  assert(!/toDataURL\('image\/png'\)/.test(blocoGenPdf), 'E.2.46.2 — regressão: PNG (causa do arquivo de 7,9MB) não reaparece em nenhuma exportação de canvas');
  assert(/fillStyle = '#ffffff'/.test(blocoGenPdf) && /fillRect\(0, 0, canvasFatia\.width, canvasFatia\.height\)/.test(blocoGenPdf), 'E.2.46.2 — cada fatia multipágina recebe fundo branco explícito antes de desenhar (JPEG não tem canal alfa, nunca deixa fundo transparente virar preto)');

  // Fase E.2.47 — achado real na aprovação visual: @media print só se
  // aplica numa impressão de verdade, nunca numa captura via html2canvas —
  // sem isso, o botão "Imprimir / Salvar PDF" (.no-print) vazava para
  // dentro do PDF real enviado ao cliente. Confirmado corrigido ao vivo
  // (harness com jsPDF+html2canvas reais, PDF gerado e inspecionado
  // visualmente) — aqui, checagem estática de que a correção existe e
  // roda ANTES da renderização (render()).
  const idxHideNoPrint = blocoGenPdf.indexOf("querySelectorAll('.no-print')");
  const idxRenderCall = blocoGenPdf.indexOf('function render()');
  assert(idxHideNoPrint > 0, 'E.2.47 — generateVitreQuotePdf() esconde elementos .no-print explicitamente antes de renderizar (html2canvas nunca aciona @media print sozinho)');
  assert(idxHideNoPrint > 0 && idxRenderCall > 0 && idxHideNoPrint < idxRenderCall, 'E.2.47 — .no-print é escondido ANTES da função render() ser definida/chamada, nunca depois');

  // Dependência html2canvas presente no <head>.
  assert(INDEX_HTML.includes('cdnjs.cloudflare.com/ajax/libs/html2canvas/'), 'script html2canvas carregado (dependência direta de generateVitreQuotePdf desde a Fase E.2.46.1)');
  assert(INDEX_HTML.includes('cdnjs.cloudflare.com/ajax/libs/jspdf/'), 'script jsPDF continua carregado');

  // Regressão — nenhuma referência antiga a jsPDF desenhando manualmente sobrou em nenhum lugar do arquivo.
  assert(!INDEX_HTML.includes("doc.text('Produto', marginX"), 'regressão: a implementação antiga (desenho manual da tabela) não reaparece em nenhum lugar do arquivo');

  // Item 1/17 — nenhum arquivo de backend/gates tocado (checagem robusta
  // contra o diff de functions/functions-valeria logo abaixo). Não exige
  // "só index.html" no diff total — outros scripts/testes de fases
  // anteriores podem legitimamente ter sido ajustados nesta mesma sessão.
  const diffFiles = execSync('git diff --name-only', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
  console.log('  ℹ️  arquivos alterados no diff atual:', JSON.stringify(diffFiles));
  assert(diffFiles.includes('index.html'), '17. index.html está entre os arquivos alterados (é o escopo desta fase)');
  // Fase E.2.47 (reenvio de homologação) legitimamente estende o escopo para
  // functions/src/vitre_quote_send.ts (campo resendHomologacao). O que esta
  // asserção continua garantindo é que functions-valeria/ (gates/ValerIA V2)
  // e qualquer OUTRO arquivo de functions/ permanecem intocados.
  assert(!diffFiles.some((f) => f.startsWith('functions-valeria/')), '1/17. nenhum arquivo de functions-valeria/ (gates ValerIA V2) foi alterado nesta fase');
  assert(!diffFiles.some((f) => f.startsWith('functions/') && f !== 'functions/src/vitre_quote_send.ts'), '1/17. nenhum arquivo de functions/ além de vitre_quote_send.ts (escopo do reenvio de homologação, Fase E.2.47) foi alterado nesta fase');
  // Só bloqueia se o CÓDIGO dessas funções VR-personalizado for tocado (definição
  // adicionada/removida no diff) — uma MENÇÃO em comentário (ex.: explicando por
  // que parcelamento/PIX não existem no modelo Vitre) é esperada e documentada.
  const diffIndexHtml = execSync('git diff -- index.html', { cwd: ROOT }).toString();
  assert(
    !/^[+-]\s*function (orcImprimirOrcamentoPDF|orcMontarBlocosPagamento|orcObterNumeroOficial)\(/m.test(diffIndexHtml),
    '17. nenhuma DEFINIÇÃO de função do fluxo VR personalizado foi adicionada/removida no diff (menção em comentário é esperada)'
  );
}

console.log('\n' + '='.repeat(60));
console.log(pass + ' passaram, ' + fail + ' falharam.');
if (fail > 0) process.exit(1);
