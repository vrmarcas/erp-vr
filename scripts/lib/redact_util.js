/**
 * redact_util.js — utilitário de redação de segredos para qualquer objeto
 * de configuração de Tool retornado pela API do Chatvolt (ou similar).
 *
 * Causa raiz do incidente de 2026-08-21/22: um redator anterior só
 * verificava o NOME da propriedade JS (`k` em `Object.entries`) contra uma
 * regex de credencial. Isso falha justamente no schema real do Chatvolt,
 * que representa headers como um ARRAY de pares
 * `{key: "Authorization", value: "Bearer <secret>"}` — aqui a propriedade
 * JS que carrega o segredo se chama literalmente "value", não "key"/
 * "secret"/"token"/etc., então a checagem por nome de propriedade nunca
 * pega o campo certo. O nome "key" nesse schema é um VALOR ("Authorization"),
 * não uma chave de credencial.
 *
 * Este utilitário corrige isso com DUAS camadas independentes (qualquer
 * uma sozinha já bastaria, as duas juntas cobrem o caso real e variações
 * futuras de schema):
 *
 *  1. Par {key, value}: se `obj.key` (o VALOR dessa propriedade, não o
 *     nome) for uma string que parece nome de credencial
 *     (Authorization/Bearer/secret/token/apiKey/cookie/password/
 *     credential), redige `obj.value` inteiro.
 *  2. Defesa em profundidade, independente de contexto/schema: qualquer
 *     valor-string em QUALQUER lugar da árvore que pareça ser um bearer
 *     token ("Bearer <algo>") ou um segredo opaco longo (hex/base64 de
 *     20+ caracteres) é redigido, mesmo que a camada 1 não tenha pego.
 *  3. Mantém também a checagem por NOME de propriedade (schema tipo mapa
 *     `{Authorization: "Bearer xxx"}`), para não perder esse caso comum.
 */
'use strict';

const CREDENCIAL_KEY_RE = /auth|bearer|secret|token|apikey|api[_-]?key|cookie|password|credential/i;
const BEARER_VALUE_RE = /^bearer\s+\S+/i;
const OPAQUE_SECRET_VALUE_RE = /^[a-f0-9]{24,}$|^[A-Za-z0-9_-]{32,}$/;

function pareceSegredo(valor) {
  if (typeof valor !== 'string') return false;
  if (BEARER_VALUE_RE.test(valor)) return true;
  if (OPAQUE_SECRET_VALUE_RE.test(valor)) return true;
  return false;
}

function redact(node) {
  if (Array.isArray(node)) return node.map(redact);
  if (node && typeof node === 'object') {
    // Camada 1 — schema real do Chatvolt: {key: "Authorization", value: "Bearer ..."}
    if (typeof node.key === 'string' && CREDENCIAL_KEY_RE.test(node.key) && 'value' in node) {
      const out = { ...node };
      out.value = '[REDACTED]';
      // Ainda assim, percorre o resto do objeto (exceto value, já tratado)
      // para o caso de estruturas aninhadas dentro do mesmo par.
      for (const k of Object.keys(out)) {
        if (k === 'value' || k === 'key') continue;
        out[k] = redact(out[k]);
      }
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (CREDENCIAL_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else if (pareceSegredo(v)) {
        // Camada 2 — defesa em profundidade: o valor em si parece um
        // segredo, redige independente do nome da propriedade que o carrega.
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  if (pareceSegredo(node)) return '[REDACTED]';
  return node;
}

module.exports = { redact, pareceSegredo };
