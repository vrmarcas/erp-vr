/**
 * test_e248c_atd_anexo_manual_composer.js — ValerIA 2.0 / ERP,
 * Fase E.2.48C (2026-09-23).
 *
 * index.html não tem harness de testes (mesmo padrão de
 * scripts/test_e248b_atd_envio_orcamento_oficial.js) — extrai por
 * contagem-de-chaves as funções NOVAS desta fase e roda cada uma isolada
 * num vm.Context com DOM/Firebase/FileReader mockados.
 *
 * Cobertura (item 16 do pedido):
 *  - seleção de arquivo válido (PDF/JPG/PNG), preview com nome/tamanho,
 *    thumbnail para imagem;
 *  - MIME inválido, extensão inválida, arquivo vazio, arquivo > limite —
 *    todos rejeitados NO CLIENTE antes de qualquer upload;
 *  - botão remover limpa o estado;
 *  - atdEnviar(): mensagem+arquivo, somente arquivo, nem mensagem nem
 *    arquivo (bloqueado), double-click;
 *  - payload correto enviado a atdEnviarAnexoManual;
 *  - fail-safe: erro do backend nunca limpa o anexo selecionado.
 *
 * Uso: node scripts/test_e248c_atd_anexo_manual_composer.js
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
  'atdComposerAnexarClique', 'atdComposerAnexoSelecionado', 'atdComposerRemoverAnexo',
  'atdRenderComposerAnexoPreview', 'atdEnviar', 'atdEnviarComAnexo', 'atdGerarRequestId', 'atdErroAmigavel',
  // Fase E.2.50 — atdEnviarComAnexo passou a chamar atdErroAmigavelAnexo().
  'atdErroAmigavelAnexo',
];
// Fase E.2.50 — atdErroAmigavelAnexo depende deste mapa/fallback de módulo.
const VAR_NAMES = ['ATD_ERRO_ANEXO_MAPA', 'ATD_ERRO_ANEXO_FALLBACK'];
const FN_BODIES = {};
FN_NAMES.forEach((n) => { FN_BODIES[n] = extractFunction(INDEX_HTML, n); });
const COMBINED_SRC = VAR_NAMES.map((n) => extractVar(INDEX_HTML, n)).join('\n') + '\n\n' + FN_NAMES.map((n) => FN_BODIES[n]).join('\n\n');

function makeFakeDoc() {
  const elements = {};
  function el(id) {
    if (!elements[id]) elements[id] = { value: '', textContent: '', innerHTML: '', style: {}, disabled: false, files: null, click: () => {}, focus: () => {} };
    return elements[id];
  }
  return { getElementById: el, _elements: elements };
}

function makeFakeFile(overrides) {
  return Object.assign({ name: 'arquivo.pdf', type: 'application/pdf', size: 233 * 1024 }, overrides);
}

function baseContext(overrides) {
  const calls = { toast: [], callable: [] };
  const document = makeFakeDoc();
  const ctx = {
    document,
    console: { warn: () => {}, error: () => {}, log: () => {} },
    showToast: (msg, type) => calls.toast.push({ msg, type }),
    cfgEsc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    ATD_CACHE: [{ id: 'atd1', modoAtendimento: 'humano', status: 'aberto' }],
    ATD_SELECTED_ID: 'atd1',
    ATD_SENDING: false,
    ATD_COMPOSER_ANEXO: null,
    ATD_ANEXO_MIME_EXT: { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'] },
    ATD_ANEXO_MAX_BYTES: 8 * 1024 * 1024,
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
      this.readAsDataURL = function (file) {
        self.result = 'data:' + file.type + ';base64,ZmFrZS1ieXRlcw==';
        setTimeout(function () { if (self.onloadend) self.onloadend(); }, 0);
      };
    },
  };
  Object.assign(ctx, overrides);
  vm.createContext(ctx);
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248c.js' });
  return { ctx, calls, document };
}

console.log('== Parte 1 — seleção de arquivo válido ==');
(async () => {
  {
    const { ctx, calls, document } = baseContext({});
    const inputEl = { files: [makeFakeFile()], value: 'C:\\fakepath\\arquivo.pdf' };
    ctx.atdComposerAnexoSelecionado(inputEl);
    await new Promise((r) => setTimeout(r, 10));

    assert(inputEl.value === '', 'input.value é limpo após selecionar (permite escolher o MESMO arquivo de novo depois)');
    assert(!!ctx.ATD_COMPOSER_ANEXO, 'ATD_COMPOSER_ANEXO é preenchido após seleção válida');
    assert(ctx.ATD_COMPOSER_ANEXO.name === 'arquivo.pdf' && ctx.ATD_COMPOSER_ANEXO.type === 'application/pdf', 'nome/tipo do arquivo armazenados corretamente');
    assert(ctx.ATD_COMPOSER_ANEXO.isImage === false, 'PDF não é marcado como imagem');
    assert(calls.callable.length === 0, 'selecionar um arquivo NUNCA chama nenhuma Cloud Function (só preview local)');

    const preview = document._elements['atdComposerAnexoPreview'];
    assert(preview.style.display === 'flex', 'preview card fica visível após seleção');
    assert(preview.innerHTML.indexOf('arquivo.pdf') >= 0, 'nome do arquivo aparece no preview');
    assert(preview.innerHTML.indexOf('233 KB') >= 0, 'tamanho (KB) aparece no preview');
    assert(preview.innerHTML.indexOf('atdComposerRemoverAnexo()') >= 0, 'botão remover presente no preview');
    assert(preview.innerHTML.indexOf('📄') >= 0, 'ícone de PDF (não thumbnail) para arquivo não-imagem');
  }

  console.log('\n== Parte 2 — seleção de imagem (thumbnail local) ==');
  {
    const { ctx, document } = baseContext({});
    const inputEl = { files: [makeFakeFile({ name: 'foto.jpg', type: 'image/jpeg', size: 50 * 1024 })], value: '' };
    ctx.atdComposerAnexoSelecionado(inputEl);
    await new Promise((r) => setTimeout(r, 10));

    assert(ctx.ATD_COMPOSER_ANEXO.isImage === true, 'JPEG é marcado como imagem');
    assert(ctx.ATD_COMPOSER_ANEXO.previewUrl && ctx.ATD_COMPOSER_ANEXO.previewUrl.indexOf('data:image/jpeg;base64,') === 0, 'previewUrl é um data URL local (nunca depende de rede/upload para mostrar o preview)');
    const preview = document._elements['atdComposerAnexoPreview'];
    assert(preview.innerHTML.indexOf('<img src="data:image/jpeg;base64,') >= 0, 'thumbnail real (<img>) aparece no preview do composer para imagem — item 3 do pedido');
  }

  console.log('\n== Parte 3 — validações client-side (rejeitam ANTES de qualquer upload) ==');
  {
    const { ctx, calls } = baseContext({});
    ctx.atdComposerAnexoSelecionado({ files: [makeFakeFile({ name: 'virus.exe', type: 'application/x-msdownload' })], value: '' });
    assert(calls.toast.some((t) => t.type === 'err'), 'MIME não permitido → toast de erro, nunca aceito');
    assert(!ctx.ATD_COMPOSER_ANEXO, 'MIME inválido → ATD_COMPOSER_ANEXO continua null');
  }
  {
    const { ctx, calls } = baseContext({});
    ctx.atdComposerAnexoSelecionado({ files: [makeFakeFile({ name: 'foto.png', type: 'image/jpeg' })], value: '' });
    assert(calls.toast.some((t) => t.type === 'err'), 'extensão (.png) incompatível com MIME declarado (image/jpeg) → rejeitado no cliente');
  }
  {
    const { ctx, calls } = baseContext({});
    ctx.atdComposerAnexoSelecionado({ files: [makeFakeFile({ size: 0 })], value: '' });
    assert(calls.toast.some((t) => t.type === 'err'), 'arquivo vazio (size=0) → rejeitado no cliente');
  }
  {
    const { ctx, calls } = baseContext({});
    ctx.atdComposerAnexoSelecionado({ files: [makeFakeFile({ size: 9 * 1024 * 1024 })], value: '' });
    assert(calls.toast.some((t) => t.type === 'err'), 'arquivo acima de 8MB → rejeitado no cliente (item 9 do pedido: frontend valida também)');
  }

  console.log('\n== Parte 4 — remover anexo ==');
  {
    const { ctx, document } = baseContext({});
    ctx.atdComposerAnexoSelecionado({ files: [makeFakeFile()], value: '' });
    await new Promise((r) => setTimeout(r, 10));
    assert(!!ctx.ATD_COMPOSER_ANEXO, 'anexo selecionado antes de remover');
    ctx.atdComposerRemoverAnexo();
    assert(ctx.ATD_COMPOSER_ANEXO === null, 'ATD_COMPOSER_ANEXO limpo após remover');
    assert(document._elements['atdComposerAnexoPreview'].style.display === 'none', 'preview card escondido após remover');
  }

  console.log('\n== Parte 5 — atdEnviar(): regras de bloqueio (item 13 do pedido) ==');
  {
    const { ctx, calls } = baseContext({ ATD_COMPOSER_ANEXO: null });
    ctx.document._elements['atdComposerInput'] = { value: '', disabled: false, focus: () => {} };
    ctx.atdEnviar();
    assert(calls.callable.length === 0, 'sem texto E sem anexo → NUNCA chama nenhuma function (bloqueado)');
  }
  {
    // só arquivo, sem texto — válido (item 13).
    const { ctx, calls } = baseContext({ ATD_COMPOSER_ANEXO: { base64: 'YQ==', name: 'a.pdf', type: 'application/pdf', size: 100, isImage: false } });
    ctx.document._elements['atdComposerInput'] = { value: '', disabled: false, focus: () => {} };
    ctx.atdEnviar();
    await new Promise((r) => setTimeout(r, 10));
    assert(calls.callable.length === 1 && calls.callable[0].name === 'atdEnviarAnexoManual', 'somente arquivo (texto vazio) → envia normalmente via atdEnviarAnexoManual');
    assert(calls.callable[0].payload.message === '', 'message enviado é string vazia, nunca inventado');
  }
  {
    // mensagem + arquivo.
    const { ctx, calls } = baseContext({ ATD_COMPOSER_ANEXO: { base64: 'YQ==', name: 'a.pdf', type: 'application/pdf', size: 100, isImage: false } });
    ctx.document._elements['atdComposerInput'] = { value: 'Segue o comprovante', disabled: false, focus: () => {} };
    ctx.atdEnviar();
    await new Promise((r) => setTimeout(r, 10));
    assert(calls.callable[0].payload.message === 'Segue o comprovante', 'mensagem+arquivo → texto enviado corretamente junto com o anexo');
    assert(calls.callable[0].payload.atendimentoId === 'atd1' && calls.callable[0].payload.fileName === 'a.pdf' && calls.callable[0].payload.mimeType === 'application/pdf' && calls.callable[0].payload.fileBase64 === 'YQ==', 'payload completo e correto (atendimentoId/fileName/mimeType/fileBase64)');
    assert(typeof calls.callable[0].payload.requestId === 'string' && calls.callable[0].payload.requestId.length > 0, 'requestId presente e não vazio');
  }

  console.log('\n== Parte 6 — atdEnviar(): anexo só funciona em modo humano ==');
  {
    const { ctx, calls } = baseContext({
      ATD_CACHE: [{ id: 'atd1', modoAtendimento: 'valeria', status: 'aberto' }],
      ATD_COMPOSER_ANEXO: { base64: 'YQ==', name: 'a.pdf', type: 'application/pdf', size: 100, isImage: false },
    });
    ctx.document._elements['atdComposerInput'] = { value: '', disabled: false, focus: () => {} };
    ctx.atdEnviar();
    assert(calls.callable.length === 0, 'modo NÃO-humano (ex.: simulação de cliente) → NUNCA envia anexo real, mesmo com anexo selecionado');
    assert(calls.toast.some((t) => t.type === 'warn'), 'aviso claro mostrado ao usuário');
  }

  console.log('\n== Parte 7 — double-click não duplica envio ==');
  {
    const { ctx, calls } = baseContext({ ATD_COMPOSER_ANEXO: { base64: 'YQ==', name: 'a.pdf', type: 'application/pdf', size: 100, isImage: false } });
    ctx.document._elements['atdComposerInput'] = { value: '', disabled: false, focus: () => {} };
    ctx.document._elements['atdBtnEnviar'] = { disabled: false, textContent: '' };
    ctx.atdEnviar();
    ctx.atdEnviar(); // clique duplo imediato — ATD_SENDING já deveria estar true
    await new Promise((r) => setTimeout(r, 10));
    assert(calls.callable.length === 1, 'double-click durante envio em andamento nunca dispara uma segunda chamada');
  }

  console.log('\n== Parte 8 — fail-safe: erro do backend NUNCA limpa o anexo selecionado ==');
  {
    const { ctx, calls, document } = baseContext({ ATD_COMPOSER_ANEXO: { base64: 'YQ==', name: 'a.pdf', type: 'application/pdf', size: 100, isImage: false } });
    ctx.__mockCallableResult = () => Promise.resolve({ data: { sent: false, errorCode: 'CHATVOLT_SEND_FAILED' } });
    document._elements['atdComposerInput'] = { value: '', disabled: false, focus: () => {} };
    document._elements['atdComposerAnexoPreview'] = { style: {}, innerHTML: '' };
    ctx.atdEnviar();
    await new Promise((r) => setTimeout(r, 10));
    assert(ctx.ATD_COMPOSER_ANEXO !== null, 'falha do backend → anexo continua selecionado (humano não precisa re-selecionar o arquivo para tentar de novo)');
    assert(calls.toast.some((t) => t.type === 'err'), 'erro mostrado ao humano');
  }

  console.log('\n' + '='.repeat(60));
  console.log(pass + ' passaram, ' + fail + ' falharam.');
  if (fail > 0) process.exit(1);
})();
