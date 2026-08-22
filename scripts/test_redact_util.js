/**
 * test_redact_util.js — reproduz o incidente real de 2026-08-21/22
 * (VALERIA_BEARER_SECRET exposto por um redator que só checava nome de
 * propriedade JS, não o schema real {key,value} do Chatvolt) e prova que
 * o valor do segredo NUNCA aparece em nenhum lugar da saída redigida —
 * nem como substring de outro campo.
 *
 * Uso: node scripts/test_redact_util.js
 */
'use strict';
const { redact } = require('./lib/redact_util');

let passed = 0, failed = 0;
function test(desc, fn) {
  try { fn(); console.log('  ✅  ' + desc); passed++; }
  catch (e) { console.log('  ❌  ' + desc + '\n       ' + (e && e.stack || e)); failed++; }
}
function assertTruthy(v, msg) { if (!v) throw new Error(msg || 'esperado truthy'); }
function assertNaoContem(objOuStr, segredo, msg) {
  const serializado = JSON.stringify(objOuStr);
  if (serializado.indexOf(segredo) >= 0) {
    throw new Error((msg || 'segredo vazou') + ' — encontrado em: ' + serializado);
  }
}

console.log('\n=== redact_util — reprodução do incidente real ===\n');

const SEGREDO = 'SUPER_SECRET_7f35d01ae54eb6585eba09f460458bf7057fb9dc591474687bca0ed33d716923';

test('1. Schema REAL do Chatvolt {key:"Authorization", value:"Bearer <segredo>"} — redigido', () => {
  const input = { key: 'Authorization', value: `Bearer ${SEGREDO}` };
  const out = redact(input);
  assertNaoContem(out, SEGREDO);
  assertTruthy(out.value === '[REDACTED]', 'value deveria ser [REDACTED], obtido: ' + out.value);
});

test('2. Array de headers estilo Chatvolt (Content-Type preservado, Authorization redigido)', () => {
  const input = {
    headers: [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Authorization', value: `Bearer ${SEGREDO}` },
    ],
  };
  const out = redact(input);
  assertNaoContem(out, SEGREDO);
  assertTruthy(out.headers[0].value === 'application/json', 'Content-Type não deveria ser redigido');
  assertTruthy(out.headers[1].value === '[REDACTED]', 'Authorization deveria ser [REDACTED]');
});

test('3. Objeto completo real do incidente (config de Tool com body[] + headers[]) — segredo nunca aparece', () => {
  const configReal = {
    url: 'https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaGetContexto',
    body: [
      { key: 'conversationId', value: '{conversation-id}', properties: { conversationId: { type: 'string', value: '{conversation-id}' } } },
    ],
    name: 'buscar_contexto_da_conversa',
    method: 'POST',
    headers: [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Authorization', value: `Bearer ${SEGREDO}` },
    ],
    rawBody: '[{"conversationId":{"type":"string"}}]',
    description: 'Execute no início do atendimento...',
  };
  const out = redact(configReal);
  assertNaoContem(out, SEGREDO);
  assertTruthy(out.url === configReal.url, 'campos não sensíveis devem ser preservados');
  assertTruthy(out.name === configReal.name);
});

test('4. Schema tipo mapa {Authorization: "Bearer x"} (não-array) — também redigido', () => {
  const input = { Authorization: `Bearer ${SEGREDO}`, 'Content-Type': 'application/json' };
  const out = redact(input);
  assertNaoContem(out, SEGREDO);
  assertTruthy(out.Authorization === '[REDACTED]');
  assertTruthy(out['Content-Type'] === 'application/json');
});

test('5. Defesa em profundidade: valor "Bearer ..." solto sem nenhuma chave suspeita ao redor — ainda redigido', () => {
  const input = { algumCampoNeutro: `Bearer ${SEGREDO}` };
  const out = redact(input);
  assertNaoContem(out, SEGREDO);
});

test('6. Defesa em profundidade: string hex opaca longa (secret sem prefixo Bearer) — redigida mesmo sem chave suspeita', () => {
  const input = { valorMisterioso: SEGREDO.replace('SUPER_SECRET_', '') };
  const out = redact(input);
  assertNaoContem(out, SEGREDO.replace('SUPER_SECRET_', ''));
});

test('7. Campos legítimos não-sensíveis nunca são redigidos por engano', () => {
  const input = { sku: 'ABC123', nome: 'Produto Teste', precoVenda: 90, categoria: 'display' };
  const out = redact(input);
  assertTruthy(out.sku === 'ABC123');
  assertTruthy(out.nome === 'Produto Teste');
  assertTruthy(out.precoVenda === 90);
  assertTruthy(out.categoria === 'display');
});

test('8. Array de tools completo (9 tools, só 1 com Authorization) — só o segredo some, resto intacto', () => {
  const tools = Array.from({ length: 9 }, (_, i) => ({
    id: 'tool_' + i,
    type: i === 4 ? 'http' : 'datastore',
    config: i === 4 ? {
      name: 'buscar_contexto_da_conversa',
      headers: [{ key: 'Authorization', value: `Bearer ${SEGREDO}` }],
    } : { name: 'outra_tool_' + i },
  }));
  const out = redact(tools);
  assertNaoContem(out, SEGREDO);
  assertTruthy(out.length === 9, 'não deve perder nenhuma tool da lista');
  assertTruthy(out[4].config.name === 'buscar_contexto_da_conversa', 'nome da tool preservado');
});

console.log('\n' + '='.repeat(60));
console.log('Resultado: ' + passed + ' passou(aram), ' + failed + ' falhou(aram)');
console.log('='.repeat(60) + '\n');
process.exitCode = failed > 0 ? 1 : 0;
