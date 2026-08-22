/**
 * sync_chatvolt_valeria_tools.js
 *
 * Sincroniza idempotentemente as 7 HTTP Tools Vitre no agente Valéria do
 * Chatvolt, usando os contratos reais documentados em
 * scripts/VALERIA_VITRE_CONTRACTS_2026-08-10.md.
 *
 * NUNCA apaga uma Tool desconhecida. NUNCA duplica. Cria a que faltar,
 * atualiza a que estiver divergente, deixa intacta a que já está correta.
 * Dry-run por padrão — precisa de --apply para gravar de verdade.
 *
 * Requer a variável de ambiente CHATVOLT_API_KEY (gerada em
 * https://app.chatvolt.ai/settings/api-keys — NUNCA impressa por este
 * script, em nenhum log, em nenhuma condição).
 *
 * Uso:
 *   CHATVOLT_API_KEY=xxx node scripts/sync_chatvolt_valeria_tools.js            → dry-run
 *   CHATVOLT_API_KEY=xxx node scripts/sync_chatvolt_valeria_tools.js --apply    → aplica de verdade
 *
 * SCHEMA REAL das Tools HTTP do Chatvolt (descoberto e verificado em
 * produção em 2026-08-22, PATCH /agents/{id} com um array `tools`):
 *   cada tool: { id?, type:"http", config: {
 *     name, description, method, url,
 *     queryParameters: [...],  // GET
 *     body: [...],             // POST
 *     headers: [...],
 *     pathVariables: []
 *   }}
 *   cada item de queryParameters/body/headers:
 *     { key: "<nomeDoParam>", value: "<valor fixo ou '' se isUserProvided>",
 *       properties: { "<nomeDoParam>": { type, value? } },
 *       description, isUserProvided }
 *   parâmetros do tipo "array" exigem properties.<nome>.items com um
 *   JSON Schema completo (não basta {type:"array"} sozinho) — o Chatvolt
 *   valida e rejeita (400 "invalid request body") sem isso.
 * Este schema NÃO está documentado em docs.chatvolt.ai/api-reference —
 * foi reverse-engineered lendo o config de uma Tool HTTP já existente
 * (buscar_contexto_da_conversa) e iterando contra os erros de validação
 * 400 retornados pela própria API até bater. Se o Chatvolt mudar esse
 * schema no futuro, o comportamento defensivo abaixo (ler uma Tool HTTP
 * existente como referência antes de decidir a forma) ainda se aplica.
 */
'use strict';

const AGENT_ID = 'cmmmkciwb02j8lcxudbnwv31y';
const ORGANIZATION_ID = 'cmmmk6oqi02hmlcxugbddv62q';
const API_BASE = 'https://api.chatvolt.ai';
const FUNCTIONS_BASE = 'https://us-central1-erp-vrmarcas.cloudfunctions.net';

const APPLY = process.argv.includes('--apply');

function p(name, type, description, isUserProvided, value) {
  return { name, type, description, isUserProvided, value };
}

// ── As 7 Tools — contrato fiel a VALERIA_VITRE_CONTRACTS_2026-08-10.md ─────
const DESIRED_TOOLS = [
  {
    name: 'buscar_catalogo_vitre',
    method: 'GET',
    url: `${FUNCTIONS_BASE}/valeriaVitreBuscarCatalogo`,
    description: 'Busca produtos prontos do catálogo Vitre por palavra-chave/categoria/faixa de preço. NUNCA invente produto, preço, prazo ou disponibilidade.',
    params: [
      p('q', 'string', 'Palavra-chave de busca', true),
      p('categoria', 'string', 'Categoria do produto', true),
      p('precoMin', 'number', 'Preço mínimo', true),
      p('precoMax', 'number', 'Preço máximo', true),
      p('limite', 'number', 'Máximo de resultados (padrão 10, máx 30)', true),
    ],
  },
  {
    name: 'consultar_produto_vitre',
    method: 'GET',
    url: `${FUNCTIONS_BASE}/valeriaVitreConsultarProduto`,
    description: 'Consulta um produto Vitre específico por SKU e verifica elegibilidade. Nunca aproxima para outro SKU.',
    params: [p('sku', 'string', 'SKU exato do produto', true)],
  },
  {
    name: 'simular_orcamento_vitre',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreSimularOrcamento`,
    description: 'Calcula o total de um orçamento Vitre ANTES de criar rascunho. Obrigatório antes de criar_rascunho_vitre. Não persiste nada.',
    params: [
      p('itens', 'array', 'Lista de itens [{sku,qtd,adicionais?}]', true),
      p('descontoPct', 'number', 'Percentual de desconto (0-100)', true),
      p('frete', 'number', 'Valor do frete', true),
    ],
  },
  {
    name: 'criar_rascunho_vitre',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreCriarRascunho`,
    description: 'Cria rascunho de orçamento Vitre, só após simular_orcamento_vitre e confirmação do cliente.',
    params: [
      p('conversationId', 'string', 'ID da conversa atual', false, '{conversation-id}'),
      p('organizationId', 'string', 'ID da organização autorizada fixo', false, ORGANIZATION_ID),
      p('requestId', 'string', 'ID único gerado pelo modelo (formato val_ + 8 chars)', true),
      p('clienteNome', 'string', 'Nome do cliente', true),
      p('itens', 'array', 'Lista de itens [{sku,qtd,adicionais?}]', true),
      p('descontoPct', 'number', 'Percentual de desconto', true),
      p('frete', 'number', 'Valor do frete', true),
      p('prazoValidadeDias', 'number', 'Prazo de validade do orçamento (padrão 7)', true),
    ],
  },
  {
    name: 'atualizar_rascunho_vitre',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreAtualizarRascunho`,
    description: 'Atualiza um rascunho Vitre já criado. requestId deve ser NOVO a cada chamada.',
    params: [
      p('conversationId', 'string', 'ID da conversa atual', false, '{conversation-id}'),
      p('organizationId', 'string', 'ID da organização autorizada fixo', false, ORGANIZATION_ID),
      p('orcamentoId', 'string', 'ID do rascunho a atualizar', true),
      p('requestId', 'string', 'ID único gerado pelo modelo, novo a cada chamada', true),
      p('itens', 'array', 'Lista completa de itens (substitui a anterior)', true),
      p('descontoPct', 'number', 'Percentual de desconto', true),
      p('frete', 'number', 'Valor do frete', true),
    ],
  },
  {
    name: 'consultar_rascunho_vitre',
    method: 'GET',
    url: `${FUNCTIONS_BASE}/valeriaVitreConsultarRascunho`,
    description: 'Consulta o resumo de um rascunho Vitre já criado (cliente pergunta "como ficou meu orçamento?").',
    params: [
      p('orcamentoId', 'string', 'ID do rascunho', true),
      p('conversationId', 'string', 'ID da conversa atual', false, '{conversation-id}'),
      p('organizationId', 'string', 'ID da organização autorizada fixo', false, ORGANIZATION_ID),
    ],
  },
  {
    name: 'encaminhar_para_vr_personalizado',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreEncaminharVR`,
    description: 'Encaminha para VR Personalizado quando a necessidade sai das regras do catálogo. Sempre seguido de "Solicitar Humano".',
    params: [
      p('conversationId', 'string', 'ID da conversa atual', false, '{conversation-id}'),
      p('organizationId', 'string', 'ID da organização autorizada fixo', false, ORGANIZATION_ID),
      p('clienteNome', 'string', 'Nome do cliente', true),
      p('requestId', 'string', 'ID único gerado pelo modelo', true),
      p('motivo', 'string', 'Motivo do encaminhamento (enum fechado)', true),
      p('clienteTel', 'string', 'Telefone do cliente', false),
      p('detalhe', 'string', 'Contexto adicional para o especialista', false),
    ],
  },
];

// JSON Schema dos itens de `itens` (array de linhas de pedido Vitre) —
// exigido pelo Chatvolt para qualquer parâmetro type:"array".
const ITENS_SCHEMA = {
  type: 'object',
  properties: {
    sku: { type: 'string' },
    qtd: { type: 'number' },
    adicionais: { type: 'array', items: { type: 'object', properties: { nome: { type: 'string' } } } },
  },
};

function buildParamsArray(params) {
  return params.map((param) => ({
    key: param.name,
    value: param.value !== undefined ? param.value : '',
    properties: {
      [param.name]: {
        type: param.type,
        ...(param.value !== undefined ? { value: param.value } : {}),
        ...(param.type === 'array' ? { items: param.name === 'itens' ? ITENS_SCHEMA : { type: 'object', properties: {} } } : {}),
      },
    },
    description: param.description,
    isUserProvided: param.isUserProvided,
  }));
}

function log(msg) { console.log(msg); }

// Este script já não loga config/headers/valores de nenhuma Tool — só
// nomes e rótulos de ação (CRIAR/ATUALIZAR/INTACTA). Se um modo de debug
// que precise inspecionar o objeto completo de uma Tool for adicionado no
// futuro, SEMPRE passar por scripts/lib/redact_util.js (redact()) antes de
// logar — ver scripts/test_redact_util.js para o incidente real que
// motivou isso (2026-08-21/22: um redator que só olhava nome de
// propriedade JS não pegava o schema real {key,value} do Chatvolt).

async function chatvoltFetch(path, opts) {
  const apiKey = process.env.CHATVOLT_API_KEY;
  if (!apiKey) {
    throw new Error('CHATVOLT_API_KEY não definida no ambiente. Nunca imprima esse valor — apenas exporte-o antes de rodar este script.');
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(opts && opts.headers ? opts.headers : {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  if (!res.ok) {
    throw new Error(`Chatvolt API respondeu ${res.status} em ${path}: ${text ? text.slice(0, 500) : '(sem corpo)'}`);
  }
  return json;
}

function nomeReal(t) {
  return t && t.config && t.config.name;
}

function encontrarTemplateHttpTool(agentData) {
  const tools = Array.isArray(agentData && agentData.tools) ? agentData.tools : [];
  return tools.find((t) => t && t.type === 'http' && t.config);
}

function buildToolPayload(desired, existing) {
  const isPost = desired.method === 'POST';
  const payload = {
    ...(existing ? { id: existing.id } : {}),
    type: 'http',
    config: {
      name: desired.name,
      description: desired.description,
      method: desired.method,
      url: desired.url,
      queryParameters: isPost ? [] : buildParamsArray(desired.params),
      body: isPost ? buildParamsArray(desired.params) : [],
      headers: (existing && existing.config && existing.config.headers) || [],
      pathVariables: (existing && existing.config && existing.config.pathVariables) || [],
    },
  };
  return payload;
}

function diffTool(desired, existing) {
  if (!existing) return 'CRIAR';
  const existingUrl = existing.config && existing.config.url;
  const existingMethod = existing.config && existing.config.method;
  if (existingUrl !== desired.url || (existingMethod || '').toUpperCase() !== desired.method) {
    return 'ATUALIZAR';
  }
  return 'INTACTA';
}

async function main() {
  log(`Modo: ${APPLY ? 'APLICAR (--apply)' : 'DRY-RUN (padrão — nada será gravado)'}`);
  log(`Agente: ${AGENT_ID}`);
  log('');

  let agentData;
  try {
    agentData = await chatvoltFetch(`/agents/${AGENT_ID}`, { method: 'GET' });
  } catch (e) {
    log(`ERRO ao ler o agente: ${e.message}`);
    log('');
    log('Nada foi alterado. Verifique CHATVOLT_API_KEY e a conectividade.');
    process.exitCode = 1;
    return;
  }

  const existingTools = Array.isArray(agentData && agentData.tools) ? agentData.tools : [];
  const template = encontrarTemplateHttpTool(agentData);
  if (!template) {
    log('AVISO: nenhuma HTTP Tool existente encontrada para servir de molde de headers.');
    log('As Tools novas nascerão sem headers de autenticação — configure manualmente após aplicar.');
  }

  const plano = DESIRED_TOOLS.map((desired) => {
    const existing = existingTools.find((t) => nomeReal(t) === desired.name);
    const acao = diffTool(desired, existing);
    return { desired, existing, acao };
  });

  log('Plano de sincronização:');
  plano.forEach((p) => {
    log(`  [${p.acao.padEnd(9)}] ${p.desired.name}`);
  });
  const desconhecidas = existingTools.filter((t) => nomeReal(t) && !DESIRED_TOOLS.some((d) => d.name === nomeReal(t))).map((t) => nomeReal(t));
  if (desconhecidas.length) {
    log('');
    log(`Tools existentes NÃO tocadas (fora do escopo deste sync, preservadas): ${desconhecidas.join(', ')}`);
  }

  const precisaMudar = plano.some((p) => p.acao !== 'INTACTA');
  if (!precisaMudar) {
    log('');
    log('Nada a fazer — as 7 Tools já estão corretas e presentes.');
    return;
  }

  if (!APPLY) {
    log('');
    log('Dry-run concluído. Rode novamente com --apply para gravar estas mudanças.');
    return;
  }

  const novoArrayTools = existingTools
    .filter((t) => !DESIRED_TOOLS.some((d) => d.name === nomeReal(t))) // preserva as não tocadas
    .concat(plano.map((p) => buildToolPayload(p.desired, p.existing)));

  try {
    await chatvoltFetch(`/agents/${AGENT_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ tools: novoArrayTools }),
    });
    log('');
    log('Aplicado com sucesso. Reconfira no painel do Chatvolt (Ferramentas Ativas) e cole o bearer');
    log('correto (erp_vr/valeria_config.secret) em cada Tool nova, se ainda não estiver herdado.');
  } catch (e) {
    log('');
    log(`ERRO ao aplicar: ${e.message}`);
    log('Nenhuma tool anterior foi apagada — o PATCH falhou antes de qualquer confirmação de sucesso.');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Falha inesperada:', e.message);
    process.exitCode = 1;
  });
}

module.exports = { DESIRED_TOOLS, diffTool, buildToolPayload, buildParamsArray };
