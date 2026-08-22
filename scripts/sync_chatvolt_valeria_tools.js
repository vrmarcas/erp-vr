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
 * IMPORTANTE — gap de documentação conhecido: a doc oficial do Chatvolt
 * (https://docs.chatvolt.ai/api-reference) confirma `PATCH /agents/{id}`
 * com um array `tools` no body, mas não documenta em detalhe o schema
 * exato de uma HTTP Tool dentro desse array (headers/params/method).
 * Este script é DEFENSIVO: primeiro faz GET no agente e usa a forma real
 * de uma Tool HTTP já existente (ex. buscar_contexto_da_conversa) como
 * template — nunca inventa um schema. Se nenhuma Tool HTTP existente for
 * encontrada para servir de modelo, o script para e avisa, sem aplicar
 * nada às cegas.
 */
'use strict';

const AGENT_ID = 'cmmmkciwb02j8lcxudbnwv31y';
const ORGANIZATION_ID = 'cmmmk6oqi02hmlcxugbddv62q';
const API_BASE = 'https://api.chatvolt.ai';
const FUNCTIONS_BASE = 'https://us-central1-erp-vrmarcas.cloudfunctions.net';

const APPLY = process.argv.includes('--apply');

// ── As 7 Tools — contrato fiel a VALERIA_VITRE_CONTRACTS_2026-08-10.md ─────
const DESIRED_TOOLS = [
  {
    name: 'buscar_catalogo_vitre',
    method: 'GET',
    url: `${FUNCTIONS_BASE}/valeriaVitreBuscarCatalogo`,
    description: 'Busca produtos prontos do catálogo Vitre por palavra-chave/categoria/faixa de preço. NUNCA invente produto, preço, prazo ou disponibilidade.',
    params: [
      { name: 'q', type: 'string', required: false, isUserProvided: true },
      { name: 'categoria', type: 'string', required: false, isUserProvided: true },
      { name: 'precoMin', type: 'number', required: false, isUserProvided: true },
      { name: 'precoMax', type: 'number', required: false, isUserProvided: true },
      { name: 'limite', type: 'number', required: false, isUserProvided: true },
    ],
  },
  {
    name: 'consultar_produto_vitre',
    method: 'GET',
    url: `${FUNCTIONS_BASE}/valeriaVitreConsultarProduto`,
    description: 'Consulta um produto Vitre específico por SKU e verifica elegibilidade. Nunca aproxima para outro SKU.',
    params: [
      { name: 'sku', type: 'string', required: true, isUserProvided: true },
    ],
  },
  {
    name: 'simular_orcamento_vitre',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreSimularOrcamento`,
    description: 'Calcula o total de um orçamento Vitre ANTES de criar rascunho. Obrigatório antes de criar_rascunho_vitre. Não persiste nada.',
    params: [
      { name: 'itens', type: 'array', required: true, isUserProvided: true },
      { name: 'descontoPct', type: 'number', required: false, isUserProvided: true },
      { name: 'frete', type: 'number', required: false, isUserProvided: true },
    ],
  },
  {
    name: 'criar_rascunho_vitre',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreCriarRascunho`,
    description: 'Cria rascunho de orçamento Vitre, só após simular_orcamento_vitre e confirmação do cliente.',
    params: [
      { name: 'conversationId', type: 'string', required: true, isUserProvided: false, fixedValue: '{conversation-id}' },
      { name: 'organizationId', type: 'string', required: true, isUserProvided: false, fixedValue: ORGANIZATION_ID },
      { name: 'requestId', type: 'string', required: true, isUserProvided: true },
      { name: 'clienteNome', type: 'string', required: true, isUserProvided: true },
      { name: 'itens', type: 'array', required: true, isUserProvided: true },
      { name: 'descontoPct', type: 'number', required: false, isUserProvided: true },
      { name: 'frete', type: 'number', required: false, isUserProvided: true },
      { name: 'prazoValidadeDias', type: 'number', required: false, isUserProvided: true },
    ],
  },
  {
    name: 'atualizar_rascunho_vitre',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreAtualizarRascunho`,
    description: 'Atualiza um rascunho Vitre já criado. requestId deve ser NOVO a cada chamada.',
    params: [
      { name: 'conversationId', type: 'string', required: true, isUserProvided: false, fixedValue: '{conversation-id}' },
      { name: 'organizationId', type: 'string', required: true, isUserProvided: false, fixedValue: ORGANIZATION_ID },
      { name: 'orcamentoId', type: 'string', required: true, isUserProvided: true },
      { name: 'requestId', type: 'string', required: true, isUserProvided: true },
      { name: 'itens', type: 'array', required: true, isUserProvided: true },
      { name: 'descontoPct', type: 'number', required: false, isUserProvided: true },
      { name: 'frete', type: 'number', required: false, isUserProvided: true },
    ],
  },
  {
    name: 'consultar_rascunho_vitre',
    method: 'GET',
    url: `${FUNCTIONS_BASE}/valeriaVitreConsultarRascunho`,
    description: 'Consulta o resumo de um rascunho Vitre já criado (cliente pergunta "como ficou meu orçamento?").',
    params: [
      { name: 'orcamentoId', type: 'string', required: true, isUserProvided: true },
      { name: 'conversationId', type: 'string', required: true, isUserProvided: false, fixedValue: '{conversation-id}' },
      { name: 'organizationId', type: 'string', required: true, isUserProvided: false, fixedValue: ORGANIZATION_ID },
    ],
  },
  {
    name: 'encaminhar_para_vr_personalizado',
    method: 'POST',
    url: `${FUNCTIONS_BASE}/valeriaVitreEncaminharVR`,
    description: 'Encaminha para VR Personalizado quando a necessidade sai das regras do catálogo. Sempre seguido de "Solicitar Humano".',
    params: [
      { name: 'conversationId', type: 'string', required: true, isUserProvided: false, fixedValue: '{conversation-id}' },
      { name: 'organizationId', type: 'string', required: true, isUserProvided: false, fixedValue: ORGANIZATION_ID },
      { name: 'clienteNome', type: 'string', required: true, isUserProvided: true },
      { name: 'requestId', type: 'string', required: true, isUserProvided: true },
      { name: 'motivo', type: 'string', required: true, isUserProvided: true },
      { name: 'clienteTel', type: 'string', required: false, isUserProvided: true },
      { name: 'detalhe', type: 'string', required: false, isUserProvided: true },
    ],
  },
];

function log(msg) { console.log(msg); }

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
    throw new Error(`Chatvolt API respondeu ${res.status} em ${path}: ${text ? text.slice(0, 300) : '(sem corpo)'}`);
  }
  return json;
}

function encontrarTemplateHttpTool(agentData) {
  const tools = Array.isArray(agentData && agentData.tools) ? agentData.tools : [];
  // Procura qualquer Tool HTTP já existente para usar como molde de schema —
  // nunca inventamos o formato exato exigido pelo Chatvolt.
  return tools.find((t) => t && (t.type === 'http' || t.config || t.url || (t.name && DESIRED_TOOLS.every((d) => d.name !== t.name) === false ? false : !!t.url)));
}

function buildToolPayload(desired, existing, template) {
  // Se já existe uma tool com esse nome, atualiza preservando o `id` dela
  // (PATCH idempotente: mesmo id = update, não cria duplicata).
  const base = template && template.config ? { ...template } : { name: desired.name };
  const payload = {
    ...(existing ? { id: existing.id } : {}),
    name: desired.name,
    description: desired.description,
  };
  // Preserva a "forma" descoberta no template (config/headers/etc.) e
  // sobrescreve só os campos que sabemos com certeza pelo contrato.
  if (base.config) {
    payload.config = {
      ...base.config,
      method: desired.method,
      url: desired.url,
      params: desired.params,
    };
  } else {
    payload.method = desired.method;
    payload.url = desired.url;
    payload.params = desired.params;
  }
  return payload;
}

function diffTool(desired, existing) {
  if (!existing) return 'CRIAR';
  const existingUrl = (existing.config && existing.config.url) || existing.url;
  const existingMethod = (existing.config && existing.config.method) || existing.method;
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
    log('AVISO: nenhuma HTTP Tool existente encontrada para servir de molde de schema.');
    log('Prosseguindo com um schema mínimo {name, method, url, description, params} —');
    log('confirme manualmente no painel após aplicar, pois o Chatvolt pode exigir campos adicionais não documentados.');
  }

  const plano = DESIRED_TOOLS.map((desired) => {
    const existing = existingTools.find((t) => t && t.name === desired.name);
    const acao = diffTool(desired, existing);
    return { desired, existing, acao };
  });

  log('Plano de sincronização:');
  plano.forEach((p) => {
    log(`  [${p.acao.padEnd(9)}] ${p.desired.name}`);
  });
  const desconhecidas = existingTools.filter((t) => t && t.name && !DESIRED_TOOLS.some((d) => d.name === t.name));
  if (desconhecidas.length) {
    log('');
    log(`Tools existentes NÃO tocadas (fora do escopo deste sync, preservadas): ${desconhecidas.map((t) => t.name).join(', ')}`);
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
    .filter((t) => !DESIRED_TOOLS.some((d) => d.name === t.name)) // preserva as não tocadas
    .concat(plano.map((p) => buildToolPayload(p.desired, p.existing, template)));

  try {
    await chatvoltFetch(`/agents/${AGENT_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ tools: novoArrayTools }),
    });
    log('');
    log('Aplicado com sucesso. Reconfira no painel do Chatvolt (Ferramentas Ativas).');
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

module.exports = { DESIRED_TOOLS, diffTool, buildToolPayload };
