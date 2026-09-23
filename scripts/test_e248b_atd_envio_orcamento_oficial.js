/**
 * test_e248b_atd_envio_orcamento_oficial.js — ValerIA 2.0 / ERP,
 * Fase E.2.48B (2026-09-23).
 *
 * index.html não tem harness de testes (mesmo padrão de
 * scripts/test_e243_frontend_envio_orcamento.js) — extrai por
 * contagem-de-chaves as funções NOVAS desta fase e roda cada uma isolada
 * num vm.Context com DOM/Firebase mockados.
 *
 * Cobertura (item 16 do pedido):
 *  - atdResolverOrcamentoVinculado: vinculado+completo, vinculado mas
 *    incompleto (podeEnviar=false), sem vínculo (null), vínculo aponta
 *    para orçamento inexistente;
 *  - card: nunca envia sozinho, botão "Enviar" desabilitado quando
 *    podeEnviar=false, nunca aparece quando não há vínculo;
 *  - modal: abre sem enviar automaticamente, gera PDF só como preview
 *    (nome/tamanho), nunca chama o backend ao abrir;
 *  - atdConfirmarEnvioOrcamentoOficial: payload correto, trava double-click,
 *    nunca reenvia com o mesmo requestId, erro nunca fecha o modal;
 *  - thread: attachment renderizado com nome/tamanho, atdAbrirAnexo chama
 *    atdObterUrlAnexo com atendimentoId+messageId (nunca storagePath).
 *
 * Uso: node scripts/test_e248b_atd_envio_orcamento_oficial.js
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
  'atdResolverOrcamentoVinculado', 'atdAbrirModalEnvioOrcamentoOficial', 'atdFecharModalEnvioOrcamentoOficial',
  'atdConfirmarEnvioOrcamentoOficial', 'atdAnexoHtml', 'atdTextoExibicaoMsg', 'atdRenderMsgs', 'atdAbrirAnexo',
  // Fase E.2.50 — atdConfirmarEnvioOrcamentoOficial passou a chamar
  // atdErroAmigavelAnexo(); atdRenderMsgs passou a chamar atdTextoExibicaoMsg()
  // (já listada acima) — nova dependência precisa entrar no combinado.
  'atdErroAmigavelAnexo',
];
// Fase E.2.50 — atdErroAmigavelAnexo/atdTextoExibicaoMsg dependem destas
// constantes de módulo (mapa de erros e cutoff temporal).
const VAR_NAMES = ['ATD_ERRO_ANEXO_MAPA', 'ATD_ERRO_ANEXO_FALLBACK', 'ATD_INBOUND_ANEXOS_CUTOFF_MS'];
const FN_BODIES = {};
FN_NAMES.forEach((n) => { FN_BODIES[n] = extractFunction(INDEX_HTML, n); });
const COMBINED_SRC = VAR_NAMES.map((n) => extractVar(INDEX_HTML, n)).join('\n') + '\n\n' + FN_NAMES.map((n) => FN_BODIES[n]).join('\n\n');

function makeFakeDoc() {
  const elements = {};
  function el(id) {
    if (!elements[id]) elements[id] = { value: '', textContent: '', innerHTML: '', style: {}, disabled: false, scrollTop: 0, scrollHeight: 0 };
    return elements[id];
  }
  return { getElementById: el, _elements: elements };
}

function baseContext(overrides) {
  const calls = { toast: [], callable: [], windowOpen: [] };
  const document = makeFakeDoc();
  const ctx = {
    document,
    window: { open: (url) => { calls.windowOpen.push(url); } },
    console: { warn: () => {}, error: () => {}, log: () => {} },
    showToast: (msg, type) => calls.toast.push({ msg, type }),
    cfgEsc: (s) => String(s),
    orcEnvNormalizar: (o) => ({
      num: o.num != null ? o.num : (o.n != null ? o.n : '—'),
      cliente: o.cliente || o.nomeCliente || '(sem nome)',
      valorFinal: typeof o.valorFinal === 'number' ? o.valorFinal : 0,
    }),
    ATD_CACHE: [],
    _ORC_ENVIADOS_DATA: [],
    ATD_ORC_ENVIO_ATENDIMENTO_ID: null,
    ATD_ORC_ENVIO_ORC: null,
    ATD_ORC_ENVIO_PDF: null,
    ATD_ORC_ENVIO_BUSY: false,
    atdFmtHora: () => '10:00',
    generateErpQuotePdf: (orc) => Promise.resolve({ blob: { size: 245878 }, fileName: 'orcamento_' + (orc.num || orc.id) + '.pdf', mimeType: 'application/pdf' }),
    blobToBase64: () => Promise.resolve('ZmFrZS1wZGYtYnl0ZXM='),
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
  };
  Object.assign(ctx, overrides);
  vm.createContext(ctx);
  return { ctx, calls, document };
}

console.log('== Parte 1 — atdResolverOrcamentoVinculado ==');
{
  const { ctx } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', cliente: 'Claudia', valorFinal: 2607.17, status: 'aguardando', itens: [{ prod: 'Mesa' }] }],
  });
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248b.js' });

  const vinc = ctx.atdResolverOrcamentoVinculado('atd1');
  assert(!!vinc, 'atendimento com orcamentoId + orçamento completo → objeto resolvido');
  assert(vinc.orcamentoId === 'ORC-000163' && vinc.numero === '000163' && vinc.cliente === 'Claudia' && vinc.total === 2607.17, 'campos normalizados corretos (orcamentoId/numero/cliente/total)');
  assert(vinc.podeEnviar === true, 'orçamento com itens+valorFinal>0 → podeEnviar=true');
  assert(vinc.podeRevisar === true, 'podeRevisar sempre true quando há vínculo');

  const semVinculo = ctx.atdResolverOrcamentoVinculado('atd_inexistente');
  assert(semVinculo === null, 'atendimento sem orcamentoId (ou inexistente) → null, NUNCA um objeto inventado');
}

console.log('\n== Parte 2 — atdResolverOrcamentoVinculado: orçamento incompleto/ausente ==');
{
  const { ctx: ctx1 } = baseContext({
    ATD_CACHE: [{ id: 'atd2', orcamentoId: 'ORC-INCOMPLETO' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-INCOMPLETO', num: '999', cliente: 'Teste', valorFinal: 0, itens: [] }],
  });
  vm.runInContext(COMBINED_SRC, ctx1, { filename: 'e248b.js' });
  const vinc1 = ctx1.atdResolverOrcamentoVinculado('atd2');
  assert(!!vinc1 && vinc1.podeEnviar === false, 'orçamento sem itens/valorFinal → resolvido mas podeEnviar=false (nunca oferece enviar PDF vazio)');

  const { ctx: ctx2 } = baseContext({
    ATD_CACHE: [{ id: 'atd3', orcamentoId: 'ORC-FANTASMA' }],
    _ORC_ENVIADOS_DATA: [],
  });
  vm.runInContext(COMBINED_SRC, ctx2, { filename: 'e248b.js' });
  const vinc2 = ctx2.atdResolverOrcamentoVinculado('atd3');
  assert(!!vinc2 && vinc2.podeEnviar === false, 'vínculo aponta para orçamento inexistente no array → resolvido mas podeEnviar=false (nunca oferece enviar)');
  assert(vinc2.numero === null, 'sem orçamento real encontrado → numero null (nunca inventa número)');
}

console.log('\n== Parte 3 — atdAbrirModalEnvioOrcamentoOficial: nunca envia ao abrir ==');
{
  const { ctx, calls, document } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', cliente: 'Claudia', valorFinal: 2607.17, marca: 'vitre', itens: [{ prod: 'Mesa' }] }],
  });
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248b.js' });

  ctx.atdAbrirModalEnvioOrcamentoOficial('atd1');
  assert(calls.callable.length === 0, 'abrir o modal NUNCA chama nenhuma Cloud Function (nem atdEnviarOrcamentoOficial, nem nenhuma outra) — só gera o PDF localmente');
  assert(document._elements['atdOrcOficialEnvioModal'].style.display === 'flex', 'modal fica visível (display:flex) ao abrir');
  assert(document._elements['atdOrcOficialEnvioMensagem'].value === 'Segue o orçamento conforme conversamos.', 'mensagem sugerida pré-preenchida, mas editável (campo é <textarea>, não travado)');
  assert(document._elements['atdOrcOficialEnvioBtnEnviar'].disabled === true, 'botão "Enviar" começa desabilitado (PDF ainda gerando)');

  // orçamento incompleto (podeEnviar=false) nunca abre o modal.
  calls.toast.length = 0;
  const { ctx: ctx2, calls: calls2, document: doc2 } = baseContext({
    ATD_CACHE: [{ id: 'atd2', orcamentoId: 'ORC-INCOMPLETO' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-INCOMPLETO', num: '999', valorFinal: 0, itens: [] }],
  });
  vm.runInContext(COMBINED_SRC, ctx2, { filename: 'e248b.js' });
  ctx2.atdAbrirModalEnvioOrcamentoOficial('atd2');
  assert(!doc2._elements['atdOrcOficialEnvioModal'] || doc2._elements['atdOrcOficialEnvioModal'].style.display !== 'flex', 'orçamento incompleto (podeEnviar=false) → modal NUNCA abre (a função retorna antes de tocar em qualquer elemento do modal)');
  assert(calls2.toast.length === 1 && calls2.toast[0].type === 'warn', 'orçamento incompleto → toast de aviso, nenhuma exceção');
}

(async () => {

console.log('\n== Parte 4 — PDF gerado é só preview (nome/tamanho), nunca envio automático ==');
{
  const { ctx, calls, document } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', valorFinal: 2607.17, marca: 'vitre', itens: [{ prod: 'Mesa' }] }],
  });
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248b.js' });
  ctx.atdAbrirModalEnvioOrcamentoOficial('atd1');
  await new Promise((r) => setTimeout(r, 10)); // deixa a Promise de generateErpQuotePdf resolver
  assert(document._elements['atdOrcOficialEnvioNomeArquivo'].textContent === 'orcamento_000163.pdf', 'nome do arquivo do PDF gerado aparece no modal');
  assert(document._elements['atdOrcOficialEnvioTamanho'].textContent === '(240 KB)', 'tamanho do PDF (KB) aparece no modal');
  assert(document._elements['atdOrcOficialEnvioBtnEnviar'].disabled === false, 'botão "Enviar" é habilitado SÓ depois do PDF pronto');
  assert(calls.callable.length === 0, 'gerar o preview do PDF NUNCA chama nenhuma Cloud Function — só o clique explícito em "Enviar" faz isso (Parte 5)');
}

console.log('\n== Parte 5 — atdConfirmarEnvioOrcamentoOficial: payload, idempotência, fail-safe ==');
{
  const { ctx, calls, document } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', valorFinal: 2607.17, marca: 'vitre', itens: [{ prod: 'Mesa' }] }],
  });
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248b.js' });
  ctx.atdAbrirModalEnvioOrcamentoOficial('atd1');
  await new Promise((r) => setTimeout(r, 10));

  ctx.atdConfirmarEnvioOrcamentoOficial();
  await new Promise((r) => setTimeout(r, 10));

  assert(calls.callable.length === 1, 'exatamente 1 chamada à Cloud Function por clique');
  const call = calls.callable[0];
  assert(call.name === 'atdEnviarOrcamentoOficial', 'chama a Cloud Function atdEnviarOrcamentoOficial (nunca sendVitreQuoteToConversation/atdEnviarMensagemHumano)');
  assert(call.payload.atendimentoId === 'atd1' && call.payload.orcamentoId === 'ORC-000163', 'payload inclui atendimentoId + orcamentoId corretos');
  assert(call.payload.fileName === 'orcamento_000163.pdf' && typeof call.payload.pdfBase64 === 'string' && call.payload.pdfBase64.length > 0, 'payload inclui fileName + pdfBase64 do PDF real gerado (nunca vazio)');
  assert(call.payload.message === 'Segue o orçamento conforme conversamos.', 'payload usa a mensagem editável do textarea (não hardcoded fora dele)');
  assert(typeof call.payload.requestId === 'string' && call.payload.requestId.indexOf('atd_orc_envio_') === 0, 'requestId presente, prefixo distinto (nunca colide com vitre_send_/vitre_resend_homolog_)');
  assert(document._elements['atdOrcOficialEnvioModal'].style.display === 'none', 'modal fecha só APÓS confirmação real de sucesso do backend');

  // double-click não duplica.
  const { ctx: ctx2, calls: calls2 } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', valorFinal: 2607.17, marca: 'vitre', itens: [{ prod: 'Mesa' }] }],
  });
  vm.runInContext(COMBINED_SRC, ctx2, { filename: 'e248b.js' });
  ctx2.atdAbrirModalEnvioOrcamentoOficial('atd1');
  await new Promise((r) => setTimeout(r, 10));
  ctx2.atdConfirmarEnvioOrcamentoOficial();
  ctx2.atdConfirmarEnvioOrcamentoOficial(); // clique duplo imediato
  await new Promise((r) => setTimeout(r, 10));
  assert(calls2.callable.length === 1, 'double-click durante um envio em andamento nunca dispara uma segunda chamada ao backend');

  // falha do backend: modal continua aberto, mensagem preservada.
  const { ctx: ctx3, document: doc3 } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', valorFinal: 2607.17, marca: 'vitre', itens: [{ prod: 'Mesa' }] }],
  });
  ctx3.__mockCallableResult = () => Promise.resolve({ data: { sent: false, errorCode: 'CHATVOLT_SEND_FAILED' } });
  vm.runInContext(COMBINED_SRC, ctx3, { filename: 'e248b.js' });
  ctx3.atdAbrirModalEnvioOrcamentoOficial('atd1');
  await new Promise((r) => setTimeout(r, 10));
  const mensagemDigitada = 'Mensagem customizada do vendedor';
  doc3._elements['atdOrcOficialEnvioMensagem'].value = mensagemDigitada;
  ctx3.atdConfirmarEnvioOrcamentoOficial();
  await new Promise((r) => setTimeout(r, 10));
  assert(doc3._elements['atdOrcOficialEnvioModal'].style.display !== 'none', 'falha do backend → modal continua aberto (nunca fecha como se tivesse dado certo)');
  // Fase E.2.50 — comportamento mudou de propósito: o humano continua
  // sendo avisado do erro, mas o errorCode técnico cru (CHATVOLT_SEND_FAILED)
  // nunca mais aparece na tela; vira mensagem amigável via atdErroAmigavelAnexo.
  assert(doc3._elements['atdOrcOficialEnvioErro'].style.display === '' && doc3._elements['atdOrcOficialEnvioErro'].textContent.indexOf('CHATVOLT_SEND_FAILED') < 0, 'erro real do backend é mostrado ao humano de forma amigável (errorCode técnico nunca aparece cru — Fase E.2.50)');
  assert(doc3._elements['atdOrcOficialEnvioMensagem'].value === mensagemDigitada, 'mensagem digitada pelo vendedor é preservada após falha (nunca perdida/resetada)');
  assert(doc3._elements['atdOrcOficialEnvioBtnEnviar'].disabled === false, 'botão reabilitado após falha — humano pode tentar de novo');

  // mensagem vazia nunca envia.
  const { ctx: ctx4, calls: calls4, document: doc4 } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', valorFinal: 2607.17, marca: 'vitre', itens: [{ prod: 'Mesa' }] }],
  });
  vm.runInContext(COMBINED_SRC, ctx4, { filename: 'e248b.js' });
  ctx4.atdAbrirModalEnvioOrcamentoOficial('atd1');
  await new Promise((r) => setTimeout(r, 10));
  doc4._elements['atdOrcOficialEnvioMensagem'].value = '   ';
  ctx4.atdConfirmarEnvioOrcamentoOficial();
  assert(calls4.callable.length === 0, 'mensagem vazia/só espaços → NUNCA chama o backend');
}

console.log('\n== Parte 6 — atdFecharModalEnvioOrcamentoOficial: limpa estado ==');
{
  const { ctx, document } = baseContext({
    ATD_CACHE: [{ id: 'atd1', orcamentoId: 'ORC-000163' }],
    _ORC_ENVIADOS_DATA: [{ id: 'ORC-000163', num: '000163', valorFinal: 2607.17, marca: 'vitre', itens: [{ prod: 'Mesa' }] }],
  });
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248b.js' });
  ctx.atdAbrirModalEnvioOrcamentoOficial('atd1');
  await new Promise((r) => setTimeout(r, 10));
  ctx.atdFecharModalEnvioOrcamentoOficial();
  assert(document._elements['atdOrcOficialEnvioModal'].style.display === 'none', 'fechar o modal esconde a UI');
  assert(ctx.ATD_ORC_ENVIO_PDF === null && ctx.ATD_ORC_ENVIO_ORC === null && ctx.ATD_ORC_ENVIO_ATENDIMENTO_ID === null, 'estado global do modal é totalmente limpo ao fechar (nunca vaza para a próxima abertura)');
}

console.log('\n== Parte 7 — thread: atdAnexoHtml / atdRenderMsgs / atdAbrirAnexo ==');
{
  const { ctx, document } = baseContext({});
  vm.runInContext(COMBINED_SRC, ctx, { filename: 'e248b.js' });

  const msgComAnexo = {
    id: 'msg1', atendimentoId: 'atd1', actorType: 'human', actorName: 'Gabriel', text: 'Segue o orçamento conforme conversamos.',
    createdAt: Date.now(),
    attachments: [{ name: 'orcamento_000163.pdf', mimeType: 'application/pdf', size: 245878, storagePath: 'atendimentos_orcamentos/atd1/ORC-000163.pdf' }],
  };
  const htmlAnexo = ctx.atdAnexoHtml(msgComAnexo);
  assert(htmlAnexo.indexOf('orcamento_000163.pdf') >= 0, 'nome do arquivo aparece no HTML do anexo');
  assert(htmlAnexo.indexOf('240 KB') >= 0, 'tamanho em KB aparece no HTML do anexo');
  assert(htmlAnexo.indexOf('storagePath') < 0 && htmlAnexo.indexOf('atendimentos_orcamentos/') < 0, 'storagePath NUNCA vaza para o HTML renderizado no client (item 10 do pedido)');
  assert(htmlAnexo.indexOf("atdAbrirAnexo('atd1','msg1')") >= 0, 'clique no anexo chama atdAbrirAnexo com atendimentoId+messageId (nunca um path)');
  assert(htmlAnexo.indexOf('Abrir documento') >= 0, 'texto "Abrir documento" presente (mockup do pedido, item 9)');

  const msgSemAnexo = { id: 'msg2', actorType: 'customer', text: 'Oi', createdAt: Date.now() };
  assert(ctx.atdAnexoHtml(msgSemAnexo) === '', 'mensagem sem attachments → HTML vazio (nunca quebra, nunca mostra bloco vazio)');

  ctx.atdRenderMsgs([msgComAnexo, msgSemAnexo]);
  const threadHtml = document._elements['atdThreadMsgs'].innerHTML;
  assert(threadHtml.indexOf('orcamento_000163.pdf') >= 0, 'atdRenderMsgs inclui o attachment da mensagem com anexo na renderização da thread');
  assert(threadHtml.indexOf('Segue o orçamento') >= 0 && threadHtml.indexOf('Oi') >= 0, 'texto normal das mensagens continua aparecendo (regressão)');

  // atdAbrirAnexo — nunca envia storagePath, sempre atendimentoId+messageId.
  const { ctx: ctx2, calls: calls2 } = baseContext({});
  vm.runInContext(COMBINED_SRC, ctx2, { filename: 'e248b.js' });
  ctx2.atdAbrirAnexo('atd1', 'msg1');
  await new Promise((r) => setTimeout(r, 10));
  assert(calls2.callable.length === 1 && calls2.callable[0].name === 'atdObterUrlAnexo', 'atdAbrirAnexo chama a Cloud Function atdObterUrlAnexo');
  assert(JSON.stringify(calls2.callable[0].payload) === JSON.stringify({ atendimentoId: 'atd1', messageId: 'msg1' }), 'payload é EXATAMENTE {atendimentoId, messageId} — nenhum campo extra, nunca storagePath');
}

console.log('\n== Parte 8 — checagens estáticas: card no atdRenderPainel ==');
{
  const idxRenderPainel = INDEX_HTML.indexOf('function atdRenderPainel(atd)');
  const bodyRenderPainel = extractFunction(INDEX_HTML.slice(idxRenderPainel - 10), 'atdRenderPainel');
  assert(bodyRenderPainel.includes('atdResolverOrcamentoVinculado(atd.id)'), 'atdRenderPainel usa atdResolverOrcamentoVinculado — nunca reimplementa a resolução do vínculo');
  assert(bodyRenderPainel.includes('atdAbrirModalEnvioOrcamentoOficial'), 'card tem botão que abre o modal de envio oficial');
  assert(bodyRenderPainel.includes('orcEnvEditar'), 'card tem botão "Revisar orçamento" reaproveitando orcEnvEditar (editor já existente do ERP, nunca duplicado)');
  assert(bodyRenderPainel.includes('_orcVinc.podeEnviar'), 'botão "Enviar orçamento" é condicionado a podeEnviar (desabilitado quando o orçamento está incompleto)');
  assert(bodyRenderPainel.includes('disabled'), 'existe um estado disabled explícito para o botão de envio quando não pode enviar');
}

console.log('\n== Parte 9 — checagens estáticas: backend genérico, nunca vitre_orcamentos/vitre_audit_log ==');
{
  assert(!INDEX_HTML.slice(INDEX_HTML.indexOf('function atdResolverOrcamentoVinculado'), INDEX_HTML.indexOf('function atdRenderPainel')).includes('vitre_orcamentos'), 'atdResolverOrcamentoVinculado/modal/card nunca referenciam vitre_orcamentos — usam o orçamento oficial (erp_vr/orcamentos)');
}

console.log('\n' + '='.repeat(60));
console.log(pass + ' passaram, ' + fail + ' falharam.');
if (fail > 0) process.exit(1);

})();
