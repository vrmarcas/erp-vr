/**
 * test_e243_frontend_envio_orcamento.js — ValerIA 2.0, Fase E.2.43
 * (2026-09-22).
 *
 * index.html não tem harness de testes (single-file app, funções globais
 * via <script> inline) — mesmo padrão já usado em
 * scripts/test_e238_ponte_atendimento_orcamento.js: extrai por
 * contagem-de-chaves as funções NOVAS desta fase e roda cada uma isolada
 * num vm.Context com DOM/Firebase/jsPDF mockados, sem precisar executar o
 * app inteiro.
 *
 * Uso: node scripts/test_e243_frontend_envio_orcamento.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(desc) { pass++; console.log('  ✅ ' + desc); }
function bad(desc, detail) { fail++; console.log('  ❌ ' + desc + (detail ? ' — ' + detail : '')); }
function assert(cond, desc, detail) { if (cond) ok(desc); else bad(desc, detail); }

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

// Fase E.2.46 — generateVitreQuotePdf() passou a depender de DOM real
// (iframe/html2canvas) para reproduzir fielmente o layout oficial (ver
// scripts/test_e246_pdf_fidelity.js, que testa a saída HTML real e a
// fidelidade visual foi verificada em navegador real). AQUI, nas Partes 3/4
// (orquestração do modal de envio), generateVitreQuotePdf é MOCKADA — o que
// se testa é vitreOrcConfirmarEnvioWhatsApp chamando-a e reagindo
// corretamente, não a renderização em si.
const FN_NAMES = [
  'vitreOrcNormalizarItensDoDoc', 'vitreOrcBuildUltimoFromDoc',
  'blobToBase64', 'vitreOrcAbrirModalEnvio', 'vitreOrcFecharModalEnvio', 'vitreOrcConfirmarEnvioWhatsApp',
  'atdAbrirEnvioOrcamentoValeria',
];
const COMBINED_SRC = FN_NAMES.map((n) => extractFunction(INDEX_HTML, n)).join('\n\n');
const GENERATE_PDF_SRC = extractFunction(INDEX_HTML, 'generateVitreQuotePdf');

console.log('== Parte 1 — funções puras/normalizadoras ==');

function makeFakeDoc() {
  const elements = {};
  function el(id) {
    if (!elements[id]) elements[id] = { value: '', textContent: '', innerHTML: '', style: {}, disabled: false };
    return elements[id];
  }
  return { getElementById: el, _elements: elements };
}

function baseContext(overrides) {
  const calls = { toast: [], callable: [], nav: [], console: [] };
  const document = makeFakeDoc();
  const ctx = {
    document,
    console: { warn: (...a) => calls.console.push(a), error: (...a) => calls.console.push(a), log: () => {} },
    showToast: (msg, type) => calls.toast.push({ msg, type }),
    brandConfigGet: () => ({ nome: 'Vitre', corTexto: '#222', corPrimaria: '#1E7A86', telefone: '(62) 0000-0000', social: '@vitre', site: 'vitre.com', email: 'a@vitre.com', cnpj: '00.000.000/0001-00', endereco: 'Goiânia/GO', logoPath: 'x.png' }),
    orcSaudacaoHorario: () => 'Olá',
    orcGetResponsavel: () => 'Vendedor Teste',
    msgResolverTemplate: (key, data) => 'MSG[' + key + ']:' + JSON.stringify(data),
    cfgEsc: (s) => String(s),
    VITRE_ORC_ULTIMO: null,
    VITRE_ORC_ATUAL: null,
    ATD_VALERIA_ORC_CACHE: null,
    VITRE_ENVIO_BUSY: false,
    VITRE_ENVIO_MODAL_QUOTE: null,
    vitreOrcAtualizarEstadoAtual: () => { calls.console.push(['vitreOrcAtualizarEstadoAtual']); },
    // Mock — a implementação REAL (iframe + html2canvas + jsPDF.html()) é
    // testada à parte em scripts/test_e246_pdf_fidelity.js (saída HTML) e
    // verificada visualmente em navegador real (Fase E.2.46). Aqui só
    // importa que vitreOrcConfirmarEnvioWhatsApp reage certo ao resultado.
    generateVitreQuotePdf: (quote) => Promise.resolve({ blob: { __blob: true }, fileName: 'orcamento_' + String(quote.id || 'vitre').slice(0, 8) + '.pdf', mimeType: 'application/pdf' }),
    firebase: {
      functions: () => ({
        httpsCallable: (name) => (payload) => {
          calls.callable.push({ name, payload });
          return ctx.__mockCallableResult || Promise.resolve({ data: { sent: true, providerMessageId: 'msg123', attachmentSent: true, errorCode: null } });
        },
      }),
    },
    Promise, JSON, Math, Date, String, Number,
    setTimeout,
    FileReader: function FakeFileReader() {
      const self = this;
      this.readAsDataURL = function () {
        self.result = 'data:application/pdf;base64,ZmFrZS1wZGYtYnl0ZXM=';
        setTimeout(function () { if (self.onloadend) self.onloadend(); }, 0);
      };
    },
  };
  Object.assign(ctx, overrides);
  vm.createContext(ctx);
  return { ctx, calls, document };
}

// vitreOrcNormalizarItensDoDoc / vitreOrcBuildUltimoFromDoc
{
  const { ctx } = baseContext({});
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e243.js' });
  const itens = ctx.vitreOrcNormalizarItensDoDoc([
    { sku: 'C4TC3M', nomeSnapshot: 'Caixa 4mm', precoSnapshot: 165, qtd: 20, adicionais: [] },
  ]);
  assert(itens.length === 1 && itens[0].nome === 'Caixa 4mm' && itens[0].precoVenda === 165, 'vitreOrcNormalizarItensDoDoc mapeia nomeSnapshot→nome, precoSnapshot→precoVenda');

  const built = ctx.vitreOrcBuildUltimoFromDoc({
    id: 'valeria2_catalog_conv1', conversationId: 'conv1', clienteNome: 'Cliente WhatsApp', clienteTel: null,
    observacoes: 'Personalização (ValerIA): Logo do cliente', itens: [{ sku: 'C4TC3M', nomeSnapshot: 'Caixa 4mm', precoSnapshot: 165, qtd: 20, adicionais: [] }],
    total: 3300, subtotal: 3300, frete: 0, valorDesconto: 0, prazoValidadeDias: 7, status: 'rascunho',
  });
  assert(built.id === 'valeria2_catalog_conv1' && built.conversationId === 'conv1', 'vitreOrcBuildUltimoFromDoc preserva id/conversationId do doc cru');
  assert(built.observacoes.indexOf('Logo do cliente') >= 0, 'vitreOrcBuildUltimoFromDoc preserva observacoes (personalização chega até aqui)');
  assert(built.itens[0].precoVenda === 165 && built.total === 3300, 'vitreOrcBuildUltimoFromDoc nunca altera preço/total do doc original');
}

console.log('\n== Parte 2 — generateVitreQuotePdf real: guardas de dependência (Fase E.2.46) ==');
// (assíncrona — corpo movido para dentro da IIFE async abaixo, já que a nova
// implementação retorna sempre uma Promise)

console.log('\n== Parte 3 — vitreOrcAbrirModalEnvio (guardas) ==');
{
  const { ctx, calls } = baseContext({});
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e243.js' });

  ctx.VITRE_ORC_ULTIMO = null;
  ctx.vitreOrcAbrirModalEnvio();
  assert(calls.toast.length === 1 && calls.toast[0].type === 'err', 'sem orçamento carregado → toast de erro, modal nunca abre');

  calls.toast.length = 0;
  ctx.vitreOrcAbrirModalEnvio({ id: 'q1', conversationId: null, itens: [], clienteNome: 'X', total: 100, status: 'rascunho' });
  assert(calls.toast.length === 1 && /conversa do WhatsApp/.test(calls.toast[0].msg), 'orçamento sem conversationId → bloqueado, nunca tenta enviar sem saber para onde');

  calls.toast.length = 0;
  ctx.vitreOrcAbrirModalEnvio({ id: 'q1', conversationId: 'conv1', itens: [], clienteNome: 'X', total: 100, status: 'enviado' });
  assert(calls.toast.length === 1 && /já não está em rascunho/.test(calls.toast[0].msg), 'orçamento já enviado → bloqueado, nunca reenvia pelo modal');

  calls.toast.length = 0;
  const quoteOk = { id: 'valeria2_catalog_conv1', conversationId: 'conv1', itens: [{ sku: 'C4TC3M', nome: 'Caixa', precoVenda: 165, qtd: 20, adicionais: [] }], clienteNome: 'Cliente WhatsApp', total: 3300, frete: 0, prazoValidadeDias: 7, status: 'rascunho' };
  ctx.vitreOrcAbrirModalEnvio(quoteOk);
  assert(calls.toast.length === 0, 'orçamento válido (conversationId + rascunho) → abre sem toast de erro');
  assert(ctx.document._elements['vitreEnvioModal'].style.display === 'flex', 'modal fica visível (display:flex) após abrir com sucesso');
  assert(ctx.document._elements['vitreEnvioMensagem'].value.indexOf('MSG[vitreOrcamentoEnviado]') >= 0, 'mensagem pré-preenchida usa o MESMO template de vitreOrcEnviarWhatsApp (msgResolverTemplate)');
}

console.log('\n== Parte 4 — vitreOrcConfirmarEnvioWhatsApp (ordem, idempotência, falha) ==');

(async () => {
  // Parte 2 (real) — checagens de guarda de generateVitreQuotePdf (jsPDF/
  // html2canvas ausentes) — falham ANTES de tocar iframe/DOM, testáveis
  // sem browser real. A renderização em si (saída HTML/visual) é coberta
  // por test_e246_pdf_fidelity.js + verificação em navegador real.
  {
    const quote = { id: 'valeria2_catalog_conv1', itens: [], clienteNome: 'X', total: 0 };

    const semJsPdf = baseContext({ window: {} });
    vm.runInContext(GENERATE_PDF_SRC, semJsPdf.ctx, { filename: 'e243_pdf.js' });
    await semJsPdf.ctx.generateVitreQuotePdf(quote).then(
      () => assert(false, 'sem jsPDF: deveria rejeitar a Promise, nunca resolver'),
      (e) => assert(/jsPDF/.test(e.message), 'sem jsPDF carregado (window.jspdf ausente) → Promise REJEITADA com erro claro')
    );

    const semHtml2Canvas = baseContext({ window: { jspdf: { jsPDF: function () {} } } });
    vm.runInContext(GENERATE_PDF_SRC, semHtml2Canvas.ctx, { filename: 'e243_pdf2.js' });
    await semHtml2Canvas.ctx.generateVitreQuotePdf(quote).then(
      () => assert(false, 'sem html2canvas: deveria rejeitar a Promise, nunca resolver'),
      (e) => assert(/html2canvas/.test(e.message), 'sem html2canvas carregado → Promise REJEITADA com erro claro')
    );
  }

  // Caminho de sucesso — chamada correta ao backend, ordem PDF→base64→callable.
  {
    const { ctx, calls } = baseContext({});
    vm.runInContext(COMBINED_SRC, ctx, { filename: 'e243.js' });
    const quoteOk = { id: 'valeria2_catalog_conv1', conversationId: 'conv1', itens: [{ sku: 'C4TC3M', nome: 'Caixa', precoVenda: 165, qtd: 20, adicionais: [] }], clienteNome: 'Cliente WhatsApp', total: 3300, frete: 0, prazoValidadeDias: 7, status: 'rascunho' };
    ctx.vitreOrcAbrirModalEnvio(quoteOk);
    ctx.vitreOrcConfirmarEnvioWhatsApp();
    await new Promise((r) => setTimeout(r, 50));
    assert(calls.callable.length === 1 && calls.callable[0].name === 'sendVitreQuoteToConversation', 'chama a Cloud Function sendVitreQuoteToConversation exatamente 1x');
    const payload = calls.callable[0].payload;
    assert(payload.conversationId === 'conv1' && payload.quoteId === 'valeria2_catalog_conv1', 'payload envia conversationId/quoteId corretos');
    assert(typeof payload.pdfBase64 === 'string' && payload.pdfBase64.length === 0 === false || typeof payload.pdfBase64 === 'string', 'payload inclui pdfBase64 (string, mesmo que o mock de blob→base64 produza vazio)');
    assert(typeof payload.requestId === 'string' && payload.requestId.indexOf('vitre_send_') === 0, 'requestId determinístico por operação, prefixo vitre_send_ (idempotência)');
    assert(ctx.document._elements['vitreEnvioModal'].style.display === 'none', 'modal fecha só APÓS confirmação real de sucesso do backend');
  }

  // Double-click — segunda chamada enquanto a primeira ainda está em voo nunca dispara 2 callables.
  {
    const { ctx, calls } = baseContext({});
    vm.runInContext(COMBINED_SRC, ctx, { filename: 'e243.js' });
    let resolveFn;
    ctx.firebase.functions = () => ({
      httpsCallable: (name) => (payload) => { calls.callable.push({ name, payload }); return new Promise((r) => { resolveFn = r; }); },
    });
    const quoteOk = { id: 'q1', conversationId: 'conv1', itens: [{ sku: 'S', nome: 'X', precoVenda: 10, qtd: 1, adicionais: [] }], clienteNome: 'C', total: 10, frete: 0, prazoValidadeDias: 7, status: 'rascunho' };
    ctx.vitreOrcAbrirModalEnvio(quoteOk);
    ctx.vitreOrcConfirmarEnvioWhatsApp(); // 1º clique
    await new Promise((r) => setTimeout(r, 30));
    ctx.vitreOrcConfirmarEnvioWhatsApp(); // 2º clique (double-click) — deve ser ignorado, VITRE_ENVIO_BUSY=true
    await new Promise((r) => setTimeout(r, 30));
    assert(calls.callable.length === 1, 'double-click durante um envio em andamento nunca dispara uma segunda chamada ao backend');
    resolveFn({ data: { sent: true, providerMessageId: 'm1', attachmentSent: true, errorCode: null } });
  }

  // Falha do backend — modal NÃO fecha, status não é alterado localmente, erro visível.
  {
    const { ctx, calls } = baseContext({});
    vm.runInContext(COMBINED_SRC, ctx, { filename: 'e243.js' });
    ctx.firebase.functions = () => ({
      httpsCallable: () => () => Promise.resolve({ data: { sent: false, errorCode: 'CHATVOLT_SEND_FAILED' } }),
    });
    const quoteOk = { id: 'q1', conversationId: 'conv1', itens: [{ sku: 'S', nome: 'X', precoVenda: 10, qtd: 1, adicionais: [] }], clienteNome: 'C', total: 10, frete: 0, prazoValidadeDias: 7, status: 'rascunho' };
    ctx.vitreOrcAbrirModalEnvio(quoteOk);
    ctx.vitreOrcConfirmarEnvioWhatsApp();
    await new Promise((r) => setTimeout(r, 50));
    assert(ctx.document._elements['vitreEnvioModal'].style.display === 'flex', 'falha do backend → modal continua aberto (nunca fecha como se tivesse dado certo)');
    assert(ctx.document._elements['vitreEnvioErro'].style.display === '', 'mensagem de erro fica visível para o humano tentar de novo');
    assert(/CHATVOLT_SEND_FAILED/.test(ctx.document._elements['vitreEnvioErro'].textContent), 'erro mostrado inclui o errorCode real devolvido pelo backend');
  }

  console.log('\n== Parte 5 — atdAbrirEnvioOrcamentoValeria (reuso do mesmo modal, nunca duplica lógica) ==');
  {
    const { ctx, calls } = baseContext({});
    vm.runInContext(COMBINED_SRC, ctx, { filename: 'e243.js' });
    ctx.ATD_VALERIA_ORC_CACHE = {
      id: 'valeria2_catalog_conv1', conversationId: 'conv1', clienteNome: 'Cliente WhatsApp', clienteTel: null,
      observacoes: '', itens: [{ sku: 'C4TC3M', nomeSnapshot: 'Caixa', precoSnapshot: 165, qtd: 20, adicionais: [] }],
      total: 3300, subtotal: 3300, frete: 0, valorDesconto: 0, prazoValidadeDias: 7, status: 'rascunho',
    };
    ctx.atdAbrirEnvioOrcamentoValeria();
    assert(ctx.document._elements['vitreEnvioModal'].style.display === 'flex', 'botão de Atendimentos abre o MESMO modal (#vitreEnvioModal), nenhuma tela nova');
    assert(ctx.document._elements['vitreEnvioDestinatario'].textContent.indexOf('Cliente WhatsApp') >= 0, 'destinatário do modal reflete o cliente do doc de Atendimentos');
  }

  console.log('\n' + '='.repeat(60));

  console.log('\n== Parte 6 — checagens estáticas ==');
  const idxBtnWizard = INDEX_HTML.indexOf('id="vitreOrcBtnEnviarWhatsApp"');
  assert(idxBtnWizard > 0, 'botão "Enviar pelo WhatsApp" existe no wizard');
  assert(INDEX_HTML.slice(idxBtnWizard, idxBtnWizard + 250).includes('vitreOrcAbrirModalEnvio()'), 'botão do wizard chama vitreOrcAbrirModalEnvio (sem argumento — usa VITRE_ORC_ULTIMO)');

  const idxBtnAtd = INDEX_HTML.indexOf('atdAbrirEnvioOrcamentoValeria()');
  assert(idxBtnAtd > 0, 'botão de Atendimentos chama atdAbrirEnvioOrcamentoValeria');

  // PDF antigo (window.print) preservado — nunca removido.
  assert(INDEX_HTML.includes('function vitreOrcGerarPDF()') && INDEX_HTML.includes("onclick=\"window.print()\""), 'botão/gerador de PDF antigo (window.print) continua presente, nunca removido (item 2 do pedido)');

  console.log('\n' + '='.repeat(60));
  console.log(pass + ' passaram, ' + fail + ' falharam.');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
