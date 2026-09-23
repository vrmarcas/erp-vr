/**
 * test_e248c_atd_anexo_manual_static_safety.js — ValerIA 2.0 / ERP,
 * Fase E.2.48C (2026-09-23).
 *
 * functions/src (codebase V1) não tem harness Jest (mesmo padrão do resto
 * desta pasta). Este script verifica por texto-fonte a ORDEM SEGURA e o
 * contrato de `atdEnviarAnexoManual` (functions/src/atd_orcamento_send.ts),
 * incluindo sanitização de fileName e validação de MIME/extensão.
 *
 * Cobertura (item 16 do pedido):
 *  - PDF/JPG/PNG válidos (MIME+extensão aceitos);
 *  - MIME inválido, extensão inválida (mismatch MIME×extensão);
 *  - arquivo vazio, arquivo acima do limite;
 *  - mensagem+arquivo, somente arquivo (nunca exige texto);
 *  - idempotência/double-click;
 *  - ChatVolt sucesso/falha (fail-safe);
 *  - persistência (schema do attachment);
 *  - sanitização de fileName (path traversal, slash/backslash, vazio).
 *
 * Uso: node scripts/test_e248c_atd_anexo_manual_static_safety.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'atd_orcamento_send.ts'), 'utf8');
const INDEX_TS = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'index.ts'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, desc, detail) {
  if (cond) { pass++; console.log('  ✅ ' + desc); }
  else { fail++; console.log('  ❌ ' + desc + (detail ? ' — ' + detail : '')); }
}

console.log('== atd_orcamento_send.ts — atdEnviarAnexoManual: ordem segura e contrato ==');
{
  const handlerStart = SRC.indexOf('export const atdEnviarAnexoManual');
  assert(handlerStart > 0, 'handler exportado atdEnviarAnexoManual encontrado');
  const HANDLER = SRC.slice(handlerStart);

  assert(/requireRole\(caller,\s*\["comercial"\]/.test(HANDLER), 'exige role comercial — role sem permissão é rejeitada');

  // MIME/extensão — item 1 e 8 do pedido.
  assert(/"application\/pdf":\s*\["pdf"\]/.test(SRC), 'PDF permitido, extensão pdf');
  assert(/"image\/jpeg":\s*\["jpg",\s*"jpeg"\]/.test(SRC), 'JPEG permitido, extensões jpg/jpeg');
  assert(/"image\/png":\s*\["png"\]/.test(SRC), 'PNG permitido, extensão png');
  assert(!/"image\/gif"|"image\/webp"|"application\/msword"/.test(SRC), 'nenhum outro MIME type é aceito (regressão)');
  const idxMimeCheck = HANDLER.indexOf('ANEXO_MIME_EXTENSOES[mimeType]');
  assert(idxMimeCheck > 0, 'MIME é validado contra a allowlist');
  assert(HANDLER.includes('MIME_NAO_PERMITIDO'), 'MIME fora da allowlist é rejeitado com MIME_NAO_PERMITIDO');

  // 1. idempotência é a PRIMEIRA coisa checada (depois só da validação de MIME/filename, que não toca Firestore).
  const idxAcquireIdem = HANDLER.indexOf('acquireIdem(COL_IDEM, idemKey)');
  const idxAtdGet = HANDLER.indexOf('atdRef.get()');
  assert(idxAcquireIdem > 0 && idxAtdGet > idxAcquireIdem, 'idempotência (acquireIdem) é checada ANTES de qualquer leitura de atendimento');
  assert(/idemKey = `atd_anexo_manual:\$\{atendimentoId\}:\$\{requestId\}`/.test(HANDLER), 'chave de idempotência é distinta (nunca colide com atd_orc_envio:/vitre_quote_send:)');

  // 2. atendimento ausente é tratado.
  assert(HANDLER.indexOf('ATENDIMENTO_NAO_ENCONTRADO') > idxAtdGet, 'ATENDIMENTO_NAO_ENCONTRADO é checado logo após buscar o atendimento');

  // 3. arquivo vazio / acima do limite.
  const idxUpload = HANDLER.indexOf('uploadFileAndSign(');
  assert(idxUpload > 0, 'chamada a uploadFileAndSign( encontrada dentro do handler');
  assert(HANDLER.indexOf('ARQUIVO_VAZIO') < idxUpload, 'ARQUIVO_VAZIO (buffer vazio) é bloqueado ANTES do upload');
  assert(HANDLER.indexOf('ARQUIVO_MUITO_GRANDE') < idxUpload, 'ARQUIVO_MUITO_GRANDE (acima de MAX_ANEXO_BYTES) é bloqueado ANTES do upload');
  assert(/MAX_ANEXO_BYTES = 8 \* 1024 \* 1024/.test(SRC), 'limite de tamanho é 8MB (mesmo limite já homologado)');

  // 4. path do Storage — item 7: NUNCA sobrescreve, diretório próprio por tentativa.
  assert(/storagePath = `\$\{STORAGE_PREFIX_ANEXO\}\/\$\{atendimentoId\}\/\$\{Date\.now\(\)\}_\$\{requestId\}\/\$\{fileName\}`/.test(HANDLER), 'path do Storage inclui timestamp+requestId (nunca sobrescreve um anexo anterior) — item 7 do pedido');
  assert(/STORAGE_PREFIX_ANEXO = "atendimentos_anexos"/.test(SRC), 'prefixo de Storage é atendimentos_anexos/ (diferente de atendimentos_orcamentos/ e orcamentos_pdf/)');

  // 5. upload antes do ChatVolt; sucesso real antes de persistir.
  const idxChatvoltSend = HANDLER.indexOf('sendChatvoltMessageWithAttachment(');
  assert(idxChatvoltSend > idxUpload, 'upload acontece ANTES da chamada ChatVolt');
  const idxSendCheck = HANDLER.indexOf('if (!sendResult.ok || !sendResult.providerMessageId)');
  assert(idxSendCheck > idxChatvoltSend, 'checagem de sucesso real logo após a chamada ChatVolt');
  assert(/return failAnexo\("CHATVOLT_SEND_FAILED"\)/.test(HANDLER.slice(idxSendCheck, idxSendCheck+450)), 'falha do ChatVolt retorna failAnexo() imediatamente');
  assert(HANDLER.indexOf('msgRef.set(') > idxSendCheck, 'mensagem só é persistida DEPOIS do sucesso do ChatVolt — fail-safe (item 10 do pedido)');
  assert(HANDLER.indexOf('writeAudit(COL_AUDIT') > HANDLER.indexOf('msgRef.set('), 'auditoria é gravada DEPOIS da mensagem (nunca sucesso otimista)');

  // 6. texto sempre opcional — item 13 do pedido: nunca exige `message`.
  assert(!/if \(!message\) throw/.test(HANDLER), 'message NUNCA é obrigatório (item 13 — somente arquivo é um envio válido)');
  assert(/text: message,/.test(HANDLER), 'texto persistido é o que veio (pode ser string vazia)');

  // 7. schema do attachment persistido.
  const idxAttachmentsSet = HANDLER.indexOf('attachments: [', HANDLER.indexOf('export const atdEnviarAnexoManual'));
  const attachmentSchemaBlock = HANDLER.slice(idxAttachmentsSet, idxAttachmentsSet + 260);
  ['name:', 'mimeType,', 'size:', 'storagePath,', 'providerMessageId:'].forEach((campo) => {
    assert(attachmentSchemaBlock.includes(campo), 'attachment persistido inclui o campo "' + campo + '"');
  });
  assert(!/signedUrl|fileUrl,/.test(attachmentSchemaBlock), 'signed URL NUNCA é persistida no attachment (sempre gerada sob demanda)');

  // 8. auditoria — action correta, campos pedidos (item 12).
  assert(HANDLER.includes('"enviar_anexo_whatsapp"'), 'action de auditoria é "enviar_anexo_whatsapp"');
  const idxWriteAudit = HANDLER.indexOf('writeAudit(COL_AUDIT', HANDLER.indexOf('export const atdEnviarAnexoManual'));
  const auditDetailBlock = HANDLER.slice(idxWriteAudit, idxWriteAudit + 350);
  ['atendimentoId', 'conversationId', 'providerMessageId', 'fileName', 'mimeType', 'size', 'attachmentSent', 'enviadoPor', 'sentAt'].forEach((campo) => {
    assert(auditDetailBlock.includes(campo), 'detalhe de auditoria inclui "' + campo + '" (item 12 do pedido)');
  });
  assert(!/fileBuffer(?!\.length)|fileBase64/.test(auditDetailBlock), 'bloco de auditoria nunca referencia o CONTEÚDO do arquivo (só metadados)');

  // 9. reutilização de infra — item 6 do pedido, nunca duplica.
  assert(SRC.includes('import { uploadFileAndSign, sendChatvoltMessageWithAttachment } from "./chatvolt_attachment_send"'), 'reusa uploadFileAndSign/sendChatvoltMessageWithAttachment do módulo compartilhado — nunca duplica');
  assert(SRC.match(/COL_AUDIT = "atendimentos_audit_log"/g).length === 1, 'COL_AUDIT (atendimentos_audit_log) é declarado uma única vez — reusado por atdEnviarOrcamentoOficial e atdEnviarAnexoManual');
  assert(SRC.match(/COL_IDEM = "atendimentos_idem"/g).length === 1, 'COL_IDEM (atendimentos_idem) é declarado uma única vez — reusado pelas duas functions');
}

console.log('\n== sanitizeAnexoFileName — sanitização (item 8 do pedido), testada de verdade ==');
{
  const fnStart = SRC.indexOf('function sanitizeAnexoFileName');
  let i = SRC.indexOf('{', fnStart), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i]==='{') depth++; else if (SRC[i]==='}') { depth--; if (depth===0){i++;break;} } }
  const fnBody = SRC.slice(fnStart, i)
    .replace(/^function sanitizeAnexoFileName\(fileNameCru: string, mimeType: string\): string \| null/, 'function sanitizeAnexoFileName(fileNameCru, mimeType)');
  const mimeDictStart = SRC.indexOf('const ANEXO_MIME_EXTENSOES');
  let j = SRC.indexOf('{', mimeDictStart), depth2 = 0;
  for (; j < SRC.length; j++) { if (SRC[j]==='{') depth2++; else if (SRC[j]==='}') { depth2--; if (depth2===0){j++;break;} } }
  const mimeDictSrc = SRC.slice(mimeDictStart, j).replace('const ANEXO_MIME_EXTENSOES: Record<string, string[]> =', 'var ANEXO_MIME_EXTENSOES =');

  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(mimeDictSrc + '\n' + fnBody, ctx, { filename: 'e248c_sanitize.js' });

  assert(ctx.sanitizeAnexoFileName('orcamento.pdf', 'application/pdf') === 'orcamento.pdf', 'nome simples válido passa sem alteração');
  assert(ctx.sanitizeAnexoFileName('foto.jpg', 'image/jpeg') === 'foto.jpg', 'jpg válido passa');
  assert(ctx.sanitizeAnexoFileName('foto.JPEG', 'image/jpeg') === 'foto.jpeg', 'extensão maiúscula é normalizada para minúscula');
  assert(ctx.sanitizeAnexoFileName('logo.png', 'image/png') === 'logo.png', 'png válido passa');
  assert(ctx.sanitizeAnexoFileName('', 'application/pdf') === null, 'nome vazio → rejeitado (null)');
  assert(ctx.sanitizeAnexoFileName('   ', 'application/pdf') === null, 'nome só espaços → rejeitado');
  assert(ctx.sanitizeAnexoFileName('../../etc/passwd.pdf', 'application/pdf') === null, 'path traversal (../) → rejeitado EXPLICITAMENTE (nunca só normalizado em silêncio) — item 8 do pedido');
  assert(ctx.sanitizeAnexoFileName('../secreto.pdf', 'application/pdf') === null, 'path traversal simples → rejeitado');
  assert(ctx.sanitizeAnexoFileName('pasta/../../secreto.pdf', 'application/pdf') === null, 'path traversal no meio do caminho → rejeitado');
  assert(ctx.sanitizeAnexoFileName('/etc/passwd.pdf', 'application/pdf') === '/etc/passwd.pdf'.split('/').pop(), 'barra de diretório → só o último componente é usado (nunca aceita o path completo)');
  assert(ctx.sanitizeAnexoFileName('C:\\\\Windows\\\\arquivo.pdf', 'application/pdf') === 'arquivo.pdf', 'contrabarra de diretório (Windows) → só o nome final é usado');
  assert(ctx.sanitizeAnexoFileName('arquivo', 'application/pdf') === null, 'sem extensão → rejeitado');
  assert(ctx.sanitizeAnexoFileName('arquivo.exe', 'application/pdf') === null, 'extensão incompatível com o MIME declarado (.exe com application/pdf) → rejeitado');
  assert(ctx.sanitizeAnexoFileName('malware.pdf.exe', 'application/pdf') === null, 'extensão real (.exe) escondida atrás de ".pdf." no nome → rejeitado (só a ÚLTIMA extensão conta)');
  assert(ctx.sanitizeAnexoFileName('foto.png', 'application/pdf') === null, 'extensão .png com MIME application/pdf (mismatch) → rejeitado');
  assert(ctx.sanitizeAnexoFileName('nome com espaço.pdf', 'application/pdf') === 'nome com espaço.pdf' || /^nome com espa.o\.pdf$/.test(ctx.sanitizeAnexoFileName('nome com espaço.pdf', 'application/pdf') || ''), 'nome com espaço e acentuação não vira lixo (mantido ou substituído com segurança, nunca rejeitado à toa)');
  const comCaracteresPerigosos = ctx.sanitizeAnexoFileName('nome<script>.pdf', 'application/pdf');
  assert(comCaracteresPerigosos !== null && !/[<>]/.test(comCaracteresPerigosos), 'caracteres fora do allowlist seguro (ex.: < >) são substituídos, nunca preservados cru no path do Storage');
}

console.log('\n== functions/src/index.ts — exportação ==');
{
  assert(INDEX_TS.includes('atdEnviarAnexoManual'), 'atdEnviarAnexoManual é exportada em index.ts');
}

console.log('\n== Escopo — functions-valeria/ intocado ==');
{
  const { execSync } = require('child_process');
  const diffFiles = execSync('git diff --name-only', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
  console.log('  ℹ️  arquivos alterados no diff atual:', JSON.stringify(diffFiles));
  assert(!diffFiles.some((f) => f.startsWith('functions-valeria/')), 'nenhum arquivo de functions-valeria/ foi alterado nesta fase');
}

console.log('\n' + '='.repeat(60));
console.log(pass + ' passaram, ' + fail + ' falharam.');
if (fail > 0) process.exit(1);
