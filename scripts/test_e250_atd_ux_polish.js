/**
 * test_e250_atd_ux_polish.js — ValerIA 2.0 / ERP, Fase E.2.50 (2026-09-23).
 *
 * Cobre os 4 gaps aprovados na consolidação do Atendimentos com
 * attachments, todos só em index.html (frontend), sem tocar
 * functions/functions-valeria/Storage/ChatVolt/webhook:
 *   1. loading textual no botão Enviar ("Enviar" → "Enviando…" → "Enviar");
 *   2. erros amigáveis (nenhum errorCode técnico chega ao usuário);
 *   3. label do attachment por tipo (imagem/PDF/outro);
 *   4. regra histórica temporal para o placeholder "📸"/"📄" residual.
 *
 * Mesmo padrão de extração-por-contagem-de-chaves já usado nos testes
 * anteriores desta fase (test_e248c_atd_anexo_manual_composer.js etc.).
 *
 * Uso: node scripts/test_e250_atd_ux_polish.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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

function extractVar(src, name) {
  const marker = 'var ' + name + ' =';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('var ' + name + ' não encontrada em index.html');
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

const FN_NAMES = [
  'atdErroAmigavel', 'atdErroAmigavelAnexo', 'atdGerarRequestId',
  'atdEnviar', 'atdEnviarComAnexo', 'atdConfirmarEnvioOrcamentoOficial',
  'atdAnexoHtml', 'atdTextoExibicaoMsg', 'atdRenderMsgs', 'atdFmtHora',
  'blobToBase64', 'cfgEsc',
];
const VAR_NAMES = ['ATD_ERRO_ANEXO_MAPA', 'ATD_ERRO_ANEXO_FALLBACK', 'ATD_INBOUND_ANEXOS_CUTOFF_MS'];

const COMBINED_SRC =
  VAR_NAMES.map((n) => extractVar(INDEX_HTML, n)).join('\n') + '\n\n' +
  FN_NAMES.map((n) => extractFunction(INDEX_HTML, n)).join('\n\n');

function makeFakeDoc() {
  const elements = {};
  function el(id) {
    if (!elements[id]) elements[id] = { value: '', textContent: '', innerHTML: '', style: {}, disabled: false, files: null, click: () => {}, focus: () => {}, scrollTop: 0, scrollHeight: 0 };
    return elements[id];
  }
  return { getElementById: el, _elements: elements };
}

function baseContext(overrides) {
  const calls = { toast: [], callable: [] };
  const document = makeFakeDoc();
  const ctx = {
    document,
    console: { warn: () => {}, error: () => {}, log: () => {} },
    showToast: (msg, type) => calls.toast.push({ msg, type }),
    ATD_CACHE: [{ id: 'atd1', modoAtendimento: 'humano', status: 'aberto' }],
    ATD_SELECTED_ID: 'atd1',
    ATD_SENDING: false,
    ATD_COMPOSER_ANEXO: null,
    ATD_ORC_ENVIO_BUSY: false,
    ATD_ORC_ENVIO_ATENDIMENTO_ID: 'atd1',
    ATD_ORC_ENVIO_ORC: { id: 'orc1' },
    ATD_ORC_ENVIO_PDF: { blob: { fake: true }, fileName: 'orc.pdf' },
    firebase: {
      functions: () => ({
        httpsCallable: (name) => (payload) => {
          calls.callable.push({ name, payload });
          return ctx.__mockCallableResult ? ctx.__mockCallableResult(name, payload) : Promise.resolve({ data: { sent: true, providerMessageId: 'msg123', attachmentSent: true, errorCode: null } });
        },
      }),
    },
    Promise, JSON, Math, Date, String, Number, Array,
    setTimeout,
    FileReader: function FakeFileReader() {
      const self = this;
      this.readAsDataURL = function () {
        self.result = 'data:application/pdf;base64,ZmFrZS1ieXRlcw==';
        setTimeout(function () { if (self.onloadend) self.onloadend(); }, 0);
      };
    },
  };
  Object.assign(ctx, overrides);
  vm.createContext(ctx);
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e250.js' });
  return { ctx, calls, document };
}

(async () => {
  console.log('== Parte 1 — loading textual no botão Enviar ==');
  {
    // Texto puro
    const { ctx, document } = baseContext({});
    document._elements['atdComposerInput'] = { value: 'oi', disabled: false, focus: () => {} };
    const btn = document._elements['atdBtnEnviar'] = { disabled: false, textContent: 'Enviar' };
    const p = ctx.atdEnviar();
    assert(btn.textContent === 'Enviando…', 'texto puro: botão vira "Enviando…" imediatamente após o clique');
    assert(btn.disabled === true, 'texto puro: botão fica disabled durante o envio');
    await new Promise((r) => setTimeout(r, 10));
    assert(btn.textContent === 'Enviar', 'texto puro: botão volta para "Enviar" após sucesso');
    assert(btn.disabled === false, 'texto puro: botão reabilitado após sucesso');
  }
  {
    // Texto puro, falha
    const { ctx, document } = baseContext({ __mockCallableResult: () => Promise.reject(new Error('Erro ao enviar.')) });
    document._elements['atdComposerInput'] = { value: 'oi', disabled: false, focus: () => {} };
    const btn = document._elements['atdBtnEnviar'] = { disabled: false, textContent: 'Enviar' };
    ctx.atdEnviar();
    await new Promise((r) => setTimeout(r, 10));
    assert(btn.textContent === 'Enviar', 'texto puro: botão volta para "Enviar" mesmo após falha');
    assert(btn.disabled === false, 'texto puro: botão reabilitado mesmo após falha');
  }
  {
    // Anexo manual
    const { ctx, document } = baseContext({ ATD_COMPOSER_ANEXO: { base64: 'YQ==', name: 'a.pdf', type: 'application/pdf', size: 100, isImage: false } });
    document._elements['atdComposerInput'] = { value: '', disabled: false, focus: () => {} };
    document._elements['atdComposerAnexoPreview'] = { style: {}, innerHTML: '' };
    const btn = document._elements['atdBtnEnviar'] = { disabled: false, textContent: 'Enviar' };
    ctx.atdEnviar();
    assert(btn.textContent === 'Enviando…', 'anexo manual: botão vira "Enviando…" imediatamente após o clique');
    await new Promise((r) => setTimeout(r, 10));
    assert(btn.textContent === 'Enviar', 'anexo manual: botão volta para "Enviar" após sucesso');
  }
  {
    // double-click bloqueado (texto puro)
    const { ctx, calls, document } = baseContext({});
    document._elements['atdComposerInput'] = { value: 'oi', disabled: false, focus: () => {} };
    document._elements['atdBtnEnviar'] = { disabled: false, textContent: 'Enviar' };
    ctx.atdEnviar();
    ctx.atdEnviar();
    await new Promise((r) => setTimeout(r, 10));
    assert(calls.callable.length === 1, 'double-click imediato nunca dispara uma segunda chamada (texto puro)');
  }

  console.log('\n== Parte 2 — erros amigáveis (mapa fechado + fallback) ==');
  {
    const { ctx } = baseContext({});
    const codigosConhecidos = [
      'ATENDIMENTO_NAO_ENCONTRADO', 'ORCAMENTO_NAO_VINCULADO', 'ORCAMENTO_NAO_ENCONTRADO', 'ORCAMENTO_INCOMPLETO',
      'PDF_BASE64_INVALIDO', 'PDF_VAZIO', 'PDF_MUITO_GRANDE', 'PDF_UPLOAD_FAILED',
      'MIME_NAO_PERMITIDO', 'FILENAME_INVALIDO', 'ARQUIVO_BASE64_INVALIDO', 'ARQUIVO_VAZIO',
      'ARQUIVO_MUITO_GRANDE', 'UPLOAD_FAILED', 'CHATVOLT_SEND_FAILED',
    ];
    codigosConhecidos.forEach((codigo) => {
      const amigavel = ctx.atdErroAmigavelAnexo(codigo);
      assert(amigavel !== codigo, 'código "' + codigo + '" nunca aparece cru — vira mensagem humana');
      assert(!/CHATVOLT|storagePath|provider|Storage/i.test(amigavel) || codigo === 'CHATVOLT_SEND_FAILED', 'mensagem para "' + codigo + '" não vaza termos técnicos internos', amigavel);
    });
    // CHATVOLT_SEND_FAILED é o único caso em que a palavra "WhatsApp" aparece
    // (nome do produto, não termo técnico) — mas nunca "ChatVolt"/"provider"/"storagePath".
    assert(ctx.atdErroAmigavelAnexo('CHATVOLT_SEND_FAILED').indexOf('ChatVolt') < 0, 'CHATVOLT_SEND_FAILED nunca menciona "ChatVolt" (nome do provider) na mensagem ao usuário');
  }
  {
    const { ctx } = baseContext({});
    const desconhecidos = ['ALGO_NUNCA_MAPEADO', undefined, null, '', 'stacktrace: at Object.<anonymous>'];
    desconhecidos.forEach((codigo) => {
      const amigavel = ctx.atdErroAmigavelAnexo(codigo);
      assert(amigavel === ctx.ATD_ERRO_ANEXO_FALLBACK, 'código desconhecido (' + JSON.stringify(codigo) + ') → fallback genérico seguro, nunca o valor cru');
    });
  }
  {
    // atdEnviarComAnexo — toast final nunca contém o errorCode técnico
    const { ctx, calls, document } = baseContext({
      ATD_COMPOSER_ANEXO: { base64: 'YQ==', name: 'a.pdf', type: 'application/pdf', size: 100, isImage: false },
      __mockCallableResult: () => Promise.resolve({ data: { sent: false, errorCode: 'CHATVOLT_SEND_FAILED' } }),
    });
    document._elements['atdComposerInput'] = { value: '', disabled: false, focus: () => {} };
    document._elements['atdComposerAnexoPreview'] = { style: {}, innerHTML: '' };
    document._elements['atdBtnEnviar'] = { disabled: false, textContent: 'Enviar' };
    ctx.atdEnviar();
    await new Promise((r) => setTimeout(r, 10));
    const toastErro = calls.toast.find((t) => t.type === 'err');
    assert(!!toastErro, 'toast de erro exibido');
    assert(toastErro.msg.indexOf('CHATVOLT_SEND_FAILED') < 0, 'toast do anexo manual NUNCA contém o errorCode técnico cru');
  }
  {
    // atdConfirmarEnvioOrcamentoOficial — texto de erro no modal nunca contém o errorCode técnico
    const { ctx, document } = baseContext({
      __mockCallableResult: () => Promise.resolve({ data: { sent: false, errorCode: 'ORCAMENTO_INCOMPLETO' } }),
    });
    document._elements['atdOrcOficialEnvioMensagem'] = { value: 'Segue o orçamento.' };
    document._elements['atdOrcOficialEnvioBtnEnviar'] = { disabled: false, textContent: '' };
    const erroEl = document._elements['atdOrcOficialEnvioErro'] = { style: {}, textContent: '' };
    ctx.blobToBase64 = () => Promise.resolve('ZmFrZQ==');
    ctx.atdFecharModalEnvioOrcamentoOficial = () => {};
    ctx.atdConfirmarEnvioOrcamentoOficial();
    await new Promise((r) => setTimeout(r, 10));
    assert(erroEl.textContent.indexOf('ORCAMENTO_INCOMPLETO') < 0, 'modal de orçamento oficial NUNCA mostra o errorCode técnico cru');
    assert(erroEl.style.display === '', 'bloco de erro do modal fica visível');
  }

  console.log('\n== Parte 3 — label do attachment por tipo ==');
  {
    const { ctx } = baseContext({});
    const msgImagem = { id: 'm1', atendimentoId: 'atd1', attachments: [{ name: 'foto.jpg', mimeType: 'image/jpeg', size: 1000 }] };
    const msgPdf = { id: 'm2', atendimentoId: 'atd1', attachments: [{ name: 'doc.pdf', mimeType: 'application/pdf', size: 1000 }] };
    const msgOutro = { id: 'm3', atendimentoId: 'atd1', attachments: [{ name: 'x.bin', mimeType: 'application/octet-stream', size: 1000 }] };
    assert(ctx.atdAnexoHtml(msgImagem).indexOf('Abrir imagem') >= 0, 'JPEG → rótulo "Abrir imagem"');
    const msgPng = { id: 'm4', atendimentoId: 'atd1', attachments: [{ name: 'foto.png', mimeType: 'image/png', size: 1000 }] };
    assert(ctx.atdAnexoHtml(msgPng).indexOf('Abrir imagem') >= 0, 'PNG → rótulo "Abrir imagem"');
    assert(ctx.atdAnexoHtml(msgPdf).indexOf('Abrir documento') >= 0, 'PDF → rótulo "Abrir documento"');
    assert(ctx.atdAnexoHtml(msgOutro).indexOf('Abrir arquivo') >= 0, 'MIME não-imagem/não-PDF → rótulo "Abrir arquivo"');
    assert(ctx.atdAnexoHtml(msgImagem).indexOf('atdAbrirAnexo') >= 0, 'ação (onclick) preservada — só o rótulo mudou');
  }

  console.log('\n== Parte 4 — regra histórica temporal (placeholder residual) ==');
  {
    const { ctx } = baseContext({});
    const CUTOFF = ctx.ATD_INBOUND_ANEXOS_CUTOFF_MS;
    const HIST = '📎 Mídia recebida anteriormente — anexo indisponível no histórico';

    const antes = CUTOFF - 1000;
    const depois = CUTOFF + 1000;

    assert(ctx.atdTextoExibicaoMsg({ actorType: 'customer', text: '📸', attachments: [], createdAt: antes }) === HIST, '📸 inbound antes do cutoff, sem attachment → mensagem histórica amigável');
    assert(ctx.atdTextoExibicaoMsg({ actorType: 'customer', text: '📄', attachments: [], createdAt: antes }) === HIST, '📄 inbound antes do cutoff, sem attachment → mensagem histórica amigável');
    assert(ctx.atdTextoExibicaoMsg({ actorType: 'customer', text: '📸', attachments: [], createdAt: depois }) === '📸', '📸 depois do cutoff → preservado');
    assert(ctx.atdTextoExibicaoMsg({ actorType: 'customer', text: '📄', attachments: [], createdAt: depois }) === '📄', '📄 depois do cutoff → preservado');
    assert(ctx.atdTextoExibicaoMsg({
      actorType: 'customer', text: '📸', createdAt: antes,
      attachments: [{ name: 'imagem_x.jpg', mimeType: 'image/jpeg', size: 100, storagePath: 'x', providerMessageId: 'x' }],
    }) === '📸', 'antes do cutoff MAS com attachment real → renderer normal (texto preservado, card de anexo renderiza à parte)');
    assert(ctx.atdTextoExibicaoMsg({ actorType: 'customer', text: 'Segue a arte aprovada.', attachments: [], createdAt: antes }) === 'Segue a arte aprovada.', 'texto real antes do cutoff → sempre preservado, nunca escondido');
    assert(ctx.atdTextoExibicaoMsg({ actorType: 'agent_unknown', text: '📸', attachments: [], createdAt: antes }) === '📸', 'outbound (agent_unknown) com 📸 → preservado, nunca tratado como residual');
    assert(ctx.atdTextoExibicaoMsg({ actorType: 'system', text: '📄', attachments: [], createdAt: antes }) === '📄', 'outbound/system com 📄 → preservado, nunca tratado como residual');
  }
  {
    // Nunca reescreve Firestore — atdTextoExibicaoMsg é pura, só decide o que renderizar.
    const { ctx } = baseContext({});
    const msg = { actorType: 'customer', text: '📸', attachments: [], createdAt: ctx.ATD_INBOUND_ANEXOS_CUTOFF_MS - 1 };
    const antes = JSON.stringify(msg);
    ctx.atdTextoExibicaoMsg(msg);
    assert(JSON.stringify(msg) === antes, 'atdTextoExibicaoMsg nunca muta o objeto da mensagem original');
  }

  console.log('\n' + '='.repeat(60));
  console.log(pass + ' passaram, ' + fail + ' falharam.');
  if (fail > 0) process.exit(1);
})();
