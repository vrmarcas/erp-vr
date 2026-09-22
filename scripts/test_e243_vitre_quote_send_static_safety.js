/**
 * test_e243_vitre_quote_send_static_safety.js — ValerIA 2.0, Fase E.2.43
 * (2026-09-22).
 *
 * functions/src (codebase V1) não tem harness Jest (confirmado — só
 * scripts/test_*.js ad-hoc, mesmo padrão do resto desta pasta). Este script
 * verifica por texto-fonte a ORDEM SEGURA exigida pelo pedido (item 8):
 * idempotência → validar quote → validar atendimento → decodificar PDF →
 * upload → signed URL → ChatVolt → só com sucesso real → auditoria → status.
 * Mesma disciplina de active_pilot_static_safety.test.ts (functions-valeria),
 * adaptada para um script Node simples nesta pasta sem Jest.
 *
 * Uso: node scripts/test_e243_vitre_quote_send_static_safety.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'functions', 'src', 'vitre_quote_send.ts'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, desc) {
  if (cond) { pass++; console.log('  ✅ ' + desc); }
  else { fail++; console.log('  ❌ ' + desc); }
}

console.log('== vitre_quote_send.ts — ordem segura e contrato ==');

// Restringe as checagens de ORDEM ao corpo do handler exportado (nunca às
// definições dos helpers acima dele no arquivo — senão "uploadQuotePdfAndSign("
// bateria primeiro na própria `async function uploadQuotePdfAndSign(...)`,
// não no CALL SITE real dentro do fluxo).
const handlerStart = SRC.indexOf('export const sendVitreQuoteToConversation');
assert(handlerStart > 0, "handler exportado sendVitreQuoteToConversation encontrado");
const HANDLER = SRC.slice(handlerStart);

// 1. Idempotência é a PRIMEIRA coisa checada após validar entrada.
const idxAcquireIdem = HANDLER.indexOf('acquireIdem(idemKey)');
const idxQuoteGet = HANDLER.indexOf('quoteRef.get()');
assert(idxAcquireIdem > 0 && idxQuoteGet > idxAcquireIdem, 'idempotência (acquireIdem) é checada ANTES de qualquer leitura de quote');

// 2. Validação de quote (existe, conversationId bate, status===rascunho) vem antes do upload.
const idxUpload = HANDLER.indexOf('uploadQuotePdfAndSign(');
assert(idxUpload > 0, 'chamada a uploadQuotePdfAndSign( encontrada dentro do handler');
assert(HANDLER.indexOf('QUOTE_NOT_FOUND') < idxUpload, 'QUOTE_NOT_FOUND é checado antes do upload do PDF');
assert(HANDLER.indexOf('CONVERSATION_MISMATCH') < idxUpload, 'CONVERSATION_MISMATCH é checado antes do upload do PDF');
assert(HANDLER.indexOf('quote.status !== "rascunho"') < idxUpload, 'status !== rascunho bloqueia ANTES do upload do PDF');

// 3. Atendimento validado antes do upload.
const idxAtd = HANDLER.indexOf('ATENDIMENTO_NAO_ENCONTRADO');
assert(idxAtd > 0 && idxAtd < idxUpload, 'ATENDIMENTO_NAO_ENCONTRADO é checado antes do upload do PDF');

// 4. Upload vem antes do envio ChatVolt.
const idxChatvoltSend = HANDLER.indexOf('sendChatvoltMessageWithAttachment(');
assert(idxChatvoltSend > idxUpload, 'upload do PDF acontece ANTES da chamada ChatVolt');

// 5. Só segue com sucesso REAL (providerMessageId) confirmado — nunca otimista.
const idxSendCheck = HANDLER.indexOf('if (!sendResult.ok || !sendResult.providerMessageId)');
assert(idxSendCheck > idxChatvoltSend, 'checagem de sucesso real (ok && providerMessageId) logo após a chamada ChatVolt');

// 6. Auditoria vem ANTES de marcar status:"enviado" (nunca depois).
const idxWriteAudit = HANDLER.indexOf('writeAudit("enviar_orcamento_vitre_whatsapp"');
const idxStatusEnviado = HANDLER.indexOf('status: "enviado"');
assert(idxWriteAudit > 0 && idxStatusEnviado > idxWriteAudit, 'auditoria é persistida ANTES de marcar status:"enviado"');

// 7. status:"enviado" é a ÚLTIMA coisa que a função faz no caminho de sucesso.
assert(idxStatusEnviado > idxSendCheck, 'status só muda para "enviado" DEPOIS da checagem de sucesso do ChatVolt');

// 8. Auditoria nunca inclui bytes do PDF.
const auditoriaBlock = HANDLER.slice(idxWriteAudit, idxWriteAudit + 500);
assert(!/pdfBuffer|pdfBase64/.test(auditoriaBlock), 'bloco de auditoria nunca referencia pdfBuffer/pdfBase64 (só metadados, nunca bytes)');

// 9. Endpoint ChatVolt correto (o NOVO, com suporte a attachments) — checa o
// valor REAL da constante usada na chamada axios, nunca menções em comentário.
assert(SRC.includes('const CHATVOLT_SEND_ENDPOINT = "https://api.chatvolt.ai/conversation/message/conversationId/"'), 'CHATVOLT_SEND_ENDPOINT aponta para o endpoint NOVO (api.chatvolt.ai) — o único documentado com suporte a attachments');
assert(!SRC.includes('axios.post(`https://app.chatvolt.ai'), 'nenhuma chamada axios.post usa o endpoint ANTIGO (app.chatvolt.ai, sem suporte a anexos)');

// 10. Payload de attachment é EXATAMENTE {url, name, mimeType} — nenhum campo extra (aceita ; opcional antes de "}").
const attachmentObjMatch = SRC.match(/attachment:\s*\{\s*url:\s*string;\s*name:\s*string;\s*mimeType:\s*string;?\s*\}/);
assert(!!attachmentObjMatch, 'tipo do attachment tem EXATAMENTE {url, name, mimeType} — schema oficial documentado, nada inventado');

// 11. Nunca CHAMA .makePublic() de verdade (menção em comentário explicando o que evitar é esperada e correta).
assert(SRC.includes('getSignedUrl'), 'usa getSignedUrl (URL assinada de curta duração)');
assert(!/\.makePublic\(/.test(SRC), 'nunca CHAMA .makePublic() — arquivo nunca fica público/indexável (comentário mencionando isso como o que evitar é esperado)');

// 12. Path determinístico por quoteId — nunca acumula versões.
assert(SRC.includes('`${STORAGE_PREFIX}/${quoteId}.pdf`'), 'path do Storage é determinístico por quoteId (sobrescreve, nunca acumula cópias)');

// 13. Requer autenticação/role comercial (mesma disciplina do resto do projeto).
assert(SRC.includes('requireRole(caller, ["comercial"]') , 'exige role comercial (mesma disciplina de atdEnviarMensagemHumano/vitreConfirmarVenda)');

// 14. Reenvio de um quote já "enviado" nunca reenvia — só reporta o que já aconteceu.
const idxJaEnviado = HANDLER.indexOf('quote.status === "enviado"');
assert(idxJaEnviado > 0 && idxJaEnviado < idxUpload, 'quote já enviado é detectado e curto-circuitado ANTES de qualquer novo upload/envio');

console.log('\n' + '='.repeat(60));
console.log(pass + ' passaram, ' + fail + ' falharam.');
if (fail > 0) process.exit(1);
