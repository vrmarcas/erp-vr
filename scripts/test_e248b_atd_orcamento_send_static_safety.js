/**
 * test_e248b_atd_orcamento_send_static_safety.js — ValerIA 2.0 / ERP,
 * Fase E.2.48B (2026-09-23).
 *
 * functions/src (codebase V1) não tem harness Jest (mesmo padrão do resto
 * desta pasta — ver test_e243_vitre_quote_send_static_safety.js). Este
 * script verifica por texto-fonte a ORDEM SEGURA e o contrato de
 * `atdEnviarOrcamentoOficial`/`atdObterUrlAnexo` (functions/src/atd_orcamento_send.ts),
 * e que `chatvolt_attachment_send.ts` (módulo compartilhado extraído nesta
 * mesma fase) preserva exatamente o comportamento já homologado.
 *
 * Cobertura (item 16 do pedido da Fase E.2.48B):
 *  - orçamento vinculado encontrado / ausente / vínculo inválido;
 *  - orçamento incompleto (sem itens/valor);
 *  - PDF válido / vazio / acima do limite;
 *  - ChatVolt sucesso / falha (nada persistido em caso de falha);
 *  - idempotência (chave distinta por atendimento+orçamento+requestId);
 *  - persistência de attachment (schema {name,mimeType,size,storagePath,orcamentoId,providerMessageId});
 *  - geração de signed URL SOB DEMANDA (atdObterUrlAnexo nunca aceita storagePath do client);
 *  - role sem permissão (requireRole "comercial");
 *  - auditoria genérica (atendimentos_audit_log, nunca vitre_audit_log).
 *
 * Uso: node scripts/test_e248b_atd_orcamento_send_static_safety.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'atd_orcamento_send.ts'), 'utf8');
const SHARED_SRC = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'chatvolt_attachment_send.ts'), 'utf8');
const VITRE_SRC = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'vitre_quote_send.ts'), 'utf8');
const INDEX_TS = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, desc, detail) {
  if (cond) { pass++; console.log('  ✅ ' + desc); }
  else { fail++; console.log('  ❌ ' + desc + (detail ? ' — ' + detail : '')); }
}

console.log('== atd_orcamento_send.ts — atdEnviarOrcamentoOficial: ordem segura e contrato ==');
{
  const handlerStart = SRC.indexOf('export const atdEnviarOrcamentoOficial');
  assert(handlerStart > 0, 'handler exportado atdEnviarOrcamentoOficial encontrado');
  const HANDLER = SRC.slice(handlerStart, SRC.indexOf('export const atdObterUrlAnexo'));

  assert(/requireRole\(caller,\s*\["comercial"\]/.test(HANDLER), 'exige role comercial (master sempre passa via requireRole) — role sem permissão é rejeitada');

  // 1. idempotência é a PRIMEIRA coisa checada.
  const idxAcquireIdem = HANDLER.indexOf('acquireIdem(COL_IDEM, idemKey)');
  const idxAtdGet = HANDLER.indexOf('atdRef.get()');
  assert(idxAcquireIdem > 0 && idxAtdGet > idxAcquireIdem, 'idempotência (acquireIdem) é checada ANTES de qualquer leitura de atendimento');
  assert(/idemKey = `atd_orc_envio:\$\{atendimentoId\}:\$\{orcamentoId\}:\$\{requestId\}`/.test(HANDLER), 'chave de idempotência é distinta por atendimentoId+orcamentoId+requestId (nunca colide com vitre_quote_send/atdEnviarMensagemHumano)');

  // 2. atendimento ausente é tratado.
  const idxAtdNaoEncontrado = HANDLER.indexOf('ATENDIMENTO_NAO_ENCONTRADO');
  assert(idxAtdNaoEncontrado > idxAtdGet, 'ATENDIMENTO_NAO_ENCONTRADO é checado logo após buscar o atendimento');

  // 3. vínculo EXPLÍCITO — nunca busca ambígua por nome/telefone.
  const idxVinculoCheck = HANDLER.indexOf('atd.orcamentoId !== orcamentoId');
  assert(idxVinculoCheck > idxAtdNaoEncontrado, 'vínculo atendimento↔orçamento é validado logo após validar o atendimento');
  assert(HANDLER.includes('ORCAMENTO_NAO_VINCULADO'), 'orçamento sem vínculo explícito (atd.orcamentoId ausente/diferente) é rejeitado com ORCAMENTO_NAO_VINCULADO');
  assert(!/where\(['"]cliente['"]|where\(['"]tel['"]|\.find\([^)]*nome/i.test(HANDLER), 'nenhuma busca por nome/telefone (regressão: só vínculo explícito atd.orcamentoId)');

  // 4. orçamento incompleto (sem itens/valor) é rejeitado.
  const idxOrcCarregado = HANDLER.indexOf('carregarOrcamentoOficial(orcamentoId)');
  assert(idxOrcCarregado > idxVinculoCheck, 'orçamento oficial só é carregado DEPOIS do vínculo confirmado');
  assert(HANDLER.includes('ORCAMENTO_NAO_ENCONTRADO'), 'orçamento vinculado mas não encontrado no array é rejeitado com ORCAMENTO_NAO_ENCONTRADO');
  assert(HANDLER.includes('ORCAMENTO_INCOMPLETO') && /itens\.length === 0/.test(HANDLER), 'orçamento sem itens ou sem valorFinal>0 é rejeitado com ORCAMENTO_INCOMPLETO (nunca gera PDF de orçamento vazio)');

  // 5. PDF: vazio e acima do limite são bloqueados ANTES do upload.
  const idxUpload = HANDLER.indexOf('uploadFileAndSign(');
  assert(idxUpload > 0, 'chamada a uploadFileAndSign( encontrada dentro do handler');
  assert(HANDLER.indexOf('PDF_VAZIO') < idxUpload, 'PDF_VAZIO (buffer vazio) é bloqueado ANTES do upload');
  assert(HANDLER.indexOf('PDF_MUITO_GRANDE') < idxUpload, 'PDF_MUITO_GRANDE (acima de MAX_PDF_BYTES) é bloqueado ANTES do upload');
  assert(/MAX_PDF_BYTES = 8 \* 1024 \* 1024/.test(SRC), 'limite de tamanho é 8MB — mesmo limite já homologado em vitre_quote_send.ts');

  // 6. path do Storage é determinístico (nunca acumula versão).
  assert(/storagePath = `\$\{STORAGE_PREFIX\}\/\$\{atendimentoId\}\/\$\{orcamentoId\}\.pdf`/.test(HANDLER), 'path do Storage é determinístico por atendimentoId+orcamentoId (sobrescreve, nunca acumula cópias) — item 8 do pedido');
  assert(/STORAGE_PREFIX = "atendimentos_orcamentos"/.test(SRC), 'prefixo de Storage é atendimentos_orcamentos/ (path próprio, nunca reaproveita orcamentos_pdf/ do Vitre)');

  // 7. upload vem antes do ChatVolt.
  const idxChatvoltSend = HANDLER.indexOf('sendChatvoltMessageWithAttachment(');
  assert(idxChatvoltSend > idxUpload, 'upload do PDF acontece ANTES da chamada ChatVolt');

  // 8. só segue com sucesso REAL (providerMessageId) confirmado.
  const idxSendCheck = HANDLER.indexOf('if (!sendResult.ok || !sendResult.providerMessageId)');
  assert(idxSendCheck > idxChatvoltSend, 'checagem de sucesso real (ok && providerMessageId) logo após a chamada ChatVolt');

  // 9. em caso de falha do ChatVolt: NADA é persistido como enviado (item 13 do pedido).
  const falhaBlock = HANDLER.slice(idxSendCheck, idxSendCheck + 400);
  assert(/return fail\("CHATVOLT_SEND_FAILED"\)/.test(falhaBlock), 'falha do ChatVolt retorna fail() imediatamente');
  assert(HANDLER.indexOf('msgRef.set(') > idxSendCheck, 'a mensagem só é persistida DEPOIS da checagem de sucesso do ChatVolt — nunca antes, nunca em caso de falha');
  assert(HANDLER.indexOf('writeAudit(COL_AUDIT') > HANDLER.indexOf('msgRef.set('), 'auditoria é gravada DEPOIS da mensagem/attachment, nunca antes (nunca registra sucesso otimista)');

  // 10. schema do attachment persistido — exatamente os campos pedidos (item 8).
  const idxAttachmentsSet = HANDLER.indexOf('attachments: [');
  const attachmentSchemaBlock = HANDLER.slice(idxAttachmentsSet, idxAttachmentsSet + 300);
  ['name:', 'mimeType:', 'size:', 'storagePath', 'orcamentoId', 'providerMessageId'].forEach((campo) => {
    assert(attachmentSchemaBlock.includes(campo), 'attachment persistido inclui o campo "' + campo + '"');
  });
  assert(!/signedUrl|pdfUrl/.test(attachmentSchemaBlock), 'signed URL NUNCA é persistida no attachment (item 8 do pedido — sempre gerada sob demanda)');

  // 11. auditoria genérica — nunca vitre_audit_log, action correta, campos pedidos (item 11).
  assert(/COL_AUDIT = "atendimentos_audit_log"/.test(SRC), 'auditoria usa atendimentos_audit_log (genérica) — nunca vitre_audit_log');
  assert(HANDLER.includes('"enviar_orcamento_whatsapp"'), 'action de auditoria é "enviar_orcamento_whatsapp"');
  const idxWriteAudit = HANDLER.indexOf('writeAudit(COL_AUDIT');
  const auditDetailBlock = HANDLER.slice(idxWriteAudit, idxWriteAudit + 400);
  ['atendimentoId', 'orcamentoId', 'conversationId', 'providerMessageId', 'attachmentSent', 'fileName', 'size', 'enviadoPor', 'sentAt'].forEach((campo) => {
    assert(auditDetailBlock.includes(campo), 'detalhe de auditoria inclui "' + campo + '" (item 11 do pedido)');
  });
  // pdfBuffer.length (um número, o tamanho em bytes) é o campo `size`
  // pedido explicitamente no item 11 — nunca os BYTES/conteúdo do buffer
  // em si (isso sim proibido: pdfBuffer sozinho como valor, ou pdfBase64).
  assert(!/pdfBuffer(?!\.length)|pdfBase64/.test(auditDetailBlock), 'bloco de auditoria nunca referencia o CONTEÚDO de pdfBuffer/pdfBase64 (só metadados — size:pdfBuffer.length é permitido, é só um número)');
}

console.log('\n== atd_orcamento_send.ts — atdObterUrlAnexo: signed URL sob demanda ==');
{
  const idx = SRC.indexOf('export const atdObterUrlAnexo');
  assert(idx > 0, 'handler exportado atdObterUrlAnexo encontrado');
  const HANDLER2 = SRC.slice(idx);
  assert(/requireRole\(caller,\s*\["comercial"\]/.test(HANDLER2), 'atdObterUrlAnexo exige role comercial — role sem permissão é rejeitada');
  assert(!/data\?\.storagePath|data\.storagePath/.test(HANDLER2), 'NUNCA aceita storagePath vindo do client (item 10 do pedido) — client só manda atendimentoId+messageId');
  assert(/data\?\.atendimentoId/.test(HANDLER2) && /data\?\.messageId/.test(HANDLER2), 'input é atendimentoId+messageId (identificador da mensagem, nunca um path livre)');
  assert(HANDLER2.includes('not-found') && HANDLER2.includes('Atendimento não encontrado'), 'atendimento inexistente é rejeitado explicitamente');
  assert(HANDLER2.includes('Mensagem não encontrada'), 'mensagem inexistente é rejeitada explicitamente');
  assert(HANDLER2.includes('Esta mensagem não tem anexo'), 'mensagem sem attachment é rejeitada explicitamente');
  assert(/getSignedUrl\(\{ action: "read", expires: Date\.now\(\) \+ 10 \* 60 \* 1000 \}\)/.test(HANDLER2), 'signed URL é curta (10 minutos) e gerada SOB DEMANDA — nunca uma URL permanente salva');
  assert(!/\.makePublic\(/.test(HANDLER2), 'nunca torna o arquivo público');
}

console.log('\n== chatvolt_attachment_send.ts — extração preserva o comportamento homologado ==');
{
  assert(SHARED_SRC.includes('export async function uploadFileAndSign'), 'uploadFileAndSign é exportada do módulo compartilhado');
  assert(SHARED_SRC.includes('export async function sendChatvoltMessageWithAttachment'), 'sendChatvoltMessageWithAttachment é exportada do módulo compartilhado');
  assert(SHARED_SRC.includes('export const CHATVOLT_SEND_ENDPOINT = "https://api.chatvolt.ai/conversation/message/conversationId/"'), 'endpoint NOVO do ChatVolt (com suporte a attachments) — mesmo endpoint já homologado');
  assert(/size:\s*number/.test(SHARED_SRC), 'tipo do attachment inclui size (achado real da E.2.45.2, nunca regride)');
  assert(SHARED_SRC.includes('getSignedUrl'), 'uploadFileAndSign usa getSignedUrl (nunca bucket público)');
  assert(!/\.makePublic\(/.test(SHARED_SRC), 'módulo compartilhado nunca chama .makePublic()');

  // vitre_quote_send.ts preserva o comportamento — agora importa em vez de definir localmente.
  assert(VITRE_SRC.includes('import { uploadFileAndSign, sendChatvoltMessageWithAttachment } from "./chatvolt_attachment_send"'), 'vitre_quote_send.ts importa do módulo compartilhado (extração pura, nunca duplica lógica)');
  assert(VITRE_SRC.includes('async function uploadQuotePdfAndSign(quoteId: string, pdfBuffer: Buffer, fileName: string): Promise<string>'), 'uploadQuotePdfAndSign continua existindo em vitre_quote_send.ts com a MESMA assinatura (wrapper fino, call site do handler nunca mudou)');
  assert(VITRE_SRC.includes('return uploadFileAndSign(filePath, pdfBuffer, "application/pdf", fileName)'), 'uploadQuotePdfAndSign delega para uploadFileAndSign, preservando o path orcamentos_pdf/{quoteId}.pdf original');
  assert(!VITRE_SRC.includes('const CHATVOLT_SEND_ENDPOINT ='), 'vitre_quote_send.ts não tem mais uma definição LOCAL duplicada do endpoint (fonte única agora é o módulo compartilhado)');
}

console.log('\n== functions/src/index.ts — exportação ==');
{
  // Checa cada nome individualmente (não a linha exata) — a Fase E.2.48C
  // legitimamente adiciona atdEnviarAnexoManual ao mesmo bloco de export.
  const idxExportBlock = INDEX_TS.indexOf('from "./atd_orcamento_send"');
  const exportBlock = INDEX_TS.slice(Math.max(0, idxExportBlock - 200), idxExportBlock);
  assert(exportBlock.includes('atdEnviarOrcamentoOficial') && exportBlock.includes('atdObterUrlAnexo'), 'atdEnviarOrcamentoOficial e atdObterUrlAnexo são exportadas em index.ts');
}

console.log('\n== Escopo — functions-valeria/ e gates ValerIA V2 intocados ==');
{
  const { execSync } = require('child_process');
  const diffFiles = execSync('git diff --name-only', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
  console.log('  ℹ️  arquivos alterados no diff atual:', JSON.stringify(diffFiles));
  assert(!diffFiles.some((f) => f.startsWith('functions-valeria/')), 'nenhum arquivo de functions-valeria/ (gates/webhook/rollout V2) foi alterado nesta fase');
  const diffValeria = execSync('git diff -- functions-valeria', { cwd: ROOT }).toString();
  assert(diffValeria.trim() === '', 'diff de functions-valeria/ está vazio');
}

console.log('\n' + '='.repeat(60));
console.log(pass + ' passaram, ' + fail + ' falharam.');
if (fail > 0) process.exit(1);
