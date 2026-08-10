# Valéria × ChatVolt — Fundação Fase 0/1 (2026-08-09)

Branch: `feat/valeria-chatvolt-foundation`. Escopo desta rodada: fundação
técnica segura — **nenhuma resposta automática foi ativada no número real**.

---

## 1. Arquitetura (diagrama textual)

```
Cliente (WhatsApp)
   │  mensagem
   ▼
Meta WhatsApp Cloud API  ←── número conectado via Embedded Signup da Meta
   │                         (ChatVolt gerencia o webhook Meta sozinha)
   ▼
ChatVolt (app.chatvolt.ai)
   ├─ Agente "Valéria" (system prompt v0.1 + LLM)
   ├─ Inbox humana (Reply = IA pausa; Enable AI = IA volta; #off/#on no app)
   ├─ HTTP Tools ──────────────┐   Authorization: Bearer <VALERIA_BEARER_SECRET>
   └─ Webhooks (9 eventos) ────┤   corpo sempre com conversationId/agentId/
                               │   organizationId/userPhoneNumber
                               ▼
API/Integration Layer VR  —  Cloud Functions HTTPS (Firebase, projeto erp-vrmarcas)
   │
   ├─ codebase "valeria" (functions-valeria/, Node 22) — 15 Functions:
   │    pipeline por chamada: CORS restrito → Bearer timing-safe (rotação
   │    CURRENT+PREV via Secret Manager) → contexto obrigatório
   │    (conversationId+agentId+organizationId) → allowlist FAIL-CLOSED
   │    (erp_vr/valeria_authorized_agents) → rate limit (300/min token,
   │    30/min conversa, payload 256KB) → observabilidade (valeria_api_log)
   │    → idempotência (Idempotency-Key/messageId, TTL 24h)
   │
   └─ codebase "default" (functions/, Node 20) — Valéria×Vitre (7 Functions
        valeriaVitre*) + valeriaGetCliente/valeriaConsultarOS (legado v1)
   │
   ▼
Firestore (fonte canônica)
   erp_vr/clientes · erp_vr/crm_leads (dict do Kanban) · erp_vr/erp_config
   vitre_produtos · valeria_conversations · valeria_briefings ·
   valeria_msgs · valeria_webhook_events · valeria_alertas ·
   valeria_simulations · valeria_idem_keys · valeria_api_log
```

**O ChatVolt nunca toca o Firestore.** Cada operação tem contrato próprio;
não existe endpoint de query/gravação arbitrária.

## 2. Mecanismos A–F (exigidos pela instrução)

| # | Fluxo | Mecanismo |
|---|---|---|
| A | WhatsApp → ChatVolt → Valéria | Meta Cloud API via Embedded Signup; ChatVolt gerencia o webhook Meta ("no webhook configuration required") |
| B | Valéria consulta ERP | HTTP Tools do agente → Functions `valeriaGetContexto`, `valeriaCatalogo`, `valeriaVitreBuscarCatalogo/ConsultarProduto`, `valeriaCalcularOrcamento`, `valeriaConsultarStatus` |
| C | Valéria grava CRM | HTTP Tools → `valeriaCriarOportunidade` (lead), `valeriaAtualizarBriefing`, `valeriaMudarEtapa`, `valeriaFechamento`, `valeriaRegistrarMensagem`, `valeriaProximaAcao` |
| D | Valéria cria rascunho | `valeriaCalcularOrcamento` (simulationId, motor oficial) → `valeriaCriarOrcamento` (consome a simulação; campos de preço livres REJEITADOS) e `valeriaVitreCriarRascunho` (catálogo) — rascunho nunca gera CR/OS/estoque/pagamento |
| E | Humano assume | Tool nativa `request_human` do ChatVolt + Inbox (Reply pausa a IA; Enable AI devolve) + comandos `#off`/`#on` no WhatsApp Business; lado ERP: `valeriaTransferirHumano` grava motivo + `valeria_alertas` |
| F | ERP associa conversa ao cliente | `valeria_conversations/{conversationId}` guarda clienteId/leadId/orcamentoId/briefingId; matching por telefone E.164 canônico (telefone.ts) |

## 3. Identidade do cliente (matching robusto)

Identificador primário: telefone E.164 do WhatsApp (`userPhoneNumber` no
webhook — `extractContext` agora aceita este campo real, além dos aliases
`channelPhone`/`phone`).

Ordem implementada (`telefone.ts` + `valeriaGetContexto`):
1. **telefone exato** (dígitos idênticos);
2. **telefone normalizado** — chave canônica DDD+últimos 8 dígitos: torna
   equivalentes com/sem `+55`, com/sem `0` de operadora e com/sem o 9º
   dígito da migração nacional; números não-BR só casam por igualdade exata
   (nunca aproximação);
3. **cliente existente** (`erp_vr/clientes`);
4. **lead existente** (`erp_vr/crm_leads`, por leadId → conversationId → telefone).

**Lead-first**: `valeriaUpsertCliente` NUNCA cria cliente novo — contato
desconhecido recebe `acao:"nenhum_cliente_criado"` com orientação para
`valeriaCriarOportunidade` (lead). Promoção lead→cliente é decisão humana
no ERP.

## 4. CRM — mapeamento (schema existente reutilizado, nada novo inventado)

`erp_vr/crm_leads` é um dict `{[id]: lead}` — o MESMO documento que o
Kanban do ERP renderiza. Campos de 1º nível = card do Kanban; dados da
Valéria ficam em `lead.valeria{}` sem afetar o board:

| Pedido na instrução | Onde já vive |
|---|---|
| contactId externo / conversationId | `lead.valeria.conversationId` + `valeria_conversations/{id}` |
| telefone / nome / cidade / segmento | `lead.tel/nome/cidade/segmento` (1º nível, Kanban) |
| empresa / PF-PJ / CPF-CNPJ | `cliente.tipo/doc` (só cliente já promovido; lead usa `tipo` B2B/B2C) |
| marca de interesse | `lead.marca` ('vr'/'vitre') |
| produto/categoria/quantidade/medidas/material/prazo | `valeria_briefings/{conversationId}` (briefing progressivo, merge que nunca sobrescreve dado válido com genérico) |
| origem do lead | `lead.origem` ('valeria') |
| estágio do funil | `lead.valeria.status` + `lead.etapa` (coluna Kanban) |
| resumo da necessidade | `lead.resumo_ia` + `briefing.observacoes` |
| objeções / intenção | `lead.dores[]` / `lead.intencao{}` |
| última interação | `lead.valeria.updatedAt` + `valeria_msgs` |
| responsável humano / status IA-humano | `lead.valeria.responsavel` / `lead.valeria.status='aguardando_humano'` |

## 5. Funil — mapeamento (enum existente reutilizado)

Etapas internas já existentes (matriz de transição validada em
`crm_etapas.ts`; GANHO exige orcamentoId, PERDIDO exige motivo, REABERTO
exige justificativa):

| Funil sugerido na instrução | Etapa interna existente | Coluna Kanban ERP |
|---|---|---|
| NOVO LEAD | `NOVO_LEAD` | `ia_novo` |
| QUALIFICAÇÃO | `CONTATO_FEITO` | `qualificando` |
| NECESSIDADE IDENTIFICADA / COLETA DE DADOS | `CONTATO_FEITO` + briefing `completude`/`camposFaltando` | `qualificando` |
| PRONTO PARA ORÇAMENTO | `BRIEFING_COLETADO` | `qualificando` |
| ORÇAMENTO EM PREPARAÇÃO | `BRIEFING_COLETADO` + rascunho criado (origem=valeria) | `qualificando` |
| ORÇAMENTO ENVIADO | `ORCAMENTO_ENVIADO` | `orc_emitido` |
| NEGOCIAÇÃO | `NEGOCIACAO` | `negociacao` |
| GANHO / PERDIDO | `GANHO` / `PERDIDO` | `fechado` |
| ATENDIMENTO HUMANO | `aguardando_humano` | `qualificando` |

Decisão desta rodada: **não criar enum novo** — o granulado extra
(necessidade/coleta/preparação) já é observável por `briefing.completude` +
existência de rascunho, sem quebrar o Kanban.

## 6. Memória da conversa (estruturada, fora do LLM)

- `valeria_conversations/{conversationId}`: clienteId, leadId, orcamentoId,
  briefingId, updatedAt.
- `valeria_briefings/{conversationId}`: campos coletados + `completude`
  (0-100) + `camposFaltando[]` + `classificacao`
  (catalogo/semi_personalizada/personalizada) + histórico append-only.
- **`valeriaGetContexto` devolve tudo numa chamada** (cliente, lead,
  briefing, etapaValeria, etapaKanban, camposFaltando, classificacao,
  telefoneE164) — uma sessão/modelo novo continua o atendimento do ponto
  exato.

## 7. Motor de qualificação (checklist interno, conversa natural)

O checklist NÃO é hardcoded no prompt: `valeriaAtualizarBriefing` devolve
`camposFaltando` a cada atualização e o prompt manda perguntar **um item
por vez**, priorizando o que falta. Campos essenciais atuais: produto,
medidas (largura/altura), quantidade, material, acabamento, prazo,
referência/arte, observações. **Fase 2**: derivar o checklist da própria
receita/ficha do Produto Inteligente por produto (ver §13).

## 8. Preço — nunca matemática paralela

- Catálogo Vitre: preço/prazo SEMPRE do documento `vitre_produtos`
  (whitelist `produtoParaValeria`; custo/margem jamais saem).
- Personalizado VR: `valeriaCalcularOrcamento` roda o motor oficial
  server-side (config real `erp_vr/erp_config`) e devolve `simulationId`
  com TTL 1h; `valeriaCriarOrcamento` só aceita `simulationId` (transação
  anti-double-spend) e **rejeita** qualquer campo `total/valor/preco/
  price/amount/finalPrice` com `FORBIDDEN_FIELD`.
- ERP indisponível/config ausente → `HUMAN_VALIDATION_REQUIRED` ou
  `TEMPORARILY_UNAVAILABLE` — nunca um número inventado (cenário 9 ✅).

## 9. Segurança

- **Auth**: Bearer via Secret Manager (`VALERIA_BEARER_SECRET` +
  `_PREV` para rotação sem downtime), comparação timing-safe. Rotação:
  gravar o novo em CURRENT, mover o antigo para PREV, atualizar o valor nas
  tools do ChatVolt, depois esvaziar PREV. Revogação: trocar CURRENT e
  esvaziar PREV. **Nenhum secret em git/frontend/logs** (teste OBS1 prova
  que `valeria_api_log` não contém o token).
- **Allowlist fail-closed**: `erp_vr/valeria_authorized_agents`
  (`agents:[{agentId, organizationId, allowedFunctions?}]`) — lista
  vazia/ausente bloqueia TUDO (403). Editável no console sem redeploy.
- **Rate limit**: 300/min por token, 30/min por conversa, payload ≤256KB.
- **Idempotência**: header `Idempotency-Key` (ou `messageId` do webhook);
  chave composta hash(fn+conversationId+key), TTL 24h, reserva atômica via
  `create()`. Webhook sem messageId usa hash determinístico. ChatVolt NÃO
  documenta retry de webhook (bloqueia endpoint com falhas consecutivas) —
  a idempotência protege de reenvios manuais/duplos mesmo assim.
- **Isolamento**: toda escrita carrega conversationId; simulação de outra
  conversa → `SIMULATION_MISMATCH`.

## 10. Observabilidade

`valeria_api_log` (novo): requestId, action, conversationId, agentId,
organizationId, resultado (HTTP), sucesso, latenciaMs, ts — só em chamadas
autenticadas, fire-and-forget, sem token e sem conteúdo de mensagem.
Complementa `valeria_webhook_events` (evento bruto) e
`valeria_vitre_audit_log`/`valeria_alertas`.

## 11. Guia passo-a-passo ChatVolt (com base na doc oficial atual)

> Base API: `https://us-central1-erp-vrmarcas.cloudfunctions.net/`
> Auth de TODAS as tools: header `Authorization: Bearer <VALERIA_BEARER_SECRET>`
> Em todo body de tool, incluir como valores FIXOS (isUserProvided:false):
> `agentId` e `organizationId` do agente; e `conversationId` via prompt
> variable `{conversation-id}`; `userPhoneNumber` via `{user-phone-number}`.

1. **Agente**: Agents → New Agent "Valéria" → colar o prompt v0.1
   (`VALERIA_PROMPT_V0.1_2026-08-09.md`), português BR.
2. **Tools nativas**: ativar `request_human` (handoff) e opcionalmente
   Delayed Responses (respostas mais humanas).
3. **HTTP Tools** (Agents → Tools → HTTP Tool), na ordem de prioridade:
   | Tool | Método | Function | Parâmetros que o LLM preenche |
   |---|---|---|---|
   | `obter_contexto` | POST | `valeriaGetContexto` | — (IDs fixos/variáveis) |
   | `registrar_lead` | POST | `valeriaCriarOportunidade` | nome, observacoes |
   | `atualizar_briefing` | POST | `valeriaAtualizarBriefing` | produto, larguraMm, alturaMm, quantidade, material, acabamento, prazo, referencia, observacoes |
   | `buscar_catalogo_vitre` | GET | `valeriaVitreBuscarCatalogo` | q, categoria, precoMin, precoMax |
   | `consultar_produto_vitre` | GET | `valeriaVitreConsultarProduto` | sku |
   | `simular_orcamento_vitre` | POST | `valeriaVitreSimularOrcamento` | itens |
   | `calcular_orcamento_vr` | POST | `valeriaCalcularOrcamento` | itens (larg, alt, qty, matKey) |
   | `criar_rascunho_orcamento` | POST | `valeriaCriarOrcamento` | simulationId, nomeCliente, descricao |
   | `criar_rascunho_vitre` | POST | `valeriaVitreCriarRascunho` | clienteNome, itens, requestId |
   | `mudar_etapa_crm` | POST | `valeriaMudarEtapa` | etapa, observacao |
   | `transferir_humano` | POST | `valeriaTransferirHumano` | motivo |
   | `consultar_status_pedido` | POST | `valeriaConsultarStatus` | — |
4. **Webhook** (Agents → Settings → Webhooks): URL
   `.../valeriaWebhookChatvolt`, header `Authorization: Bearer <secret>`,
   marcar os eventos de mensagem (o handler responde 200 a todos e ignora
   com aviso os não suportados).
5. **Firestore**: criar `erp_vr/valeria_authorized_agents` com o
   `agentId`/`organizationId` reais do agente criado (sem isso, TUDO
   responde 403 — proposital).
6. **WhatsApp** (Deploy → WhatsApp → Settings → Add WhatsApp Account):
   PRIMEIRO com **número de teste da Meta** (opção "Test number") ou
   conversa controlada — **não conectar o número oficial nesta fase**.

### Checklist do que VOCÊ precisa fazer manualmente (painel ChatVolt/Meta)
- [ ] Login no painel ChatVolt (conta da empresa).
- [ ] Criar/gerar API key e os secrets: definir `VALERIA_BEARER_SECRET` no
      Secret Manager do Firebase (`firebase functions:secrets:set
      VALERIA_BEARER_SECRET` — valor novo, forte) e colar o MESMO valor no
      header das tools/webhook do ChatVolt.
- [ ] Criar o agente Valéria + colar prompt v0.1.
- [ ] Configurar as 12 HTTP tools + webhook conforme §11.
- [ ] Copiar `agentId` e `organizationId` do painel e gravar em
      `erp_vr/valeria_authorized_agents` (console Firebase).
- [ ] Login Facebook/Meta no Embedded Signup **(pausa aqui: exige sua
      conta Meta)** — usar número de TESTE da Meta nesta fase.
- [ ] (Só Fase 2, com autorização explícita) conectar o número oficial e
      cadastrar meio de pagamento no Meta Billing Hub para templates.

## 12. Cenários testados (18/18 ✅ — `scripts/test_valeria_foundation_e2e_2026-08-09.js`)

C1 qualificação natural · C2 cliente existente sem duplicar + lead-first ·
C3 catálogo Vitre · C4 medidas VR · C5 estado persiste (3 provas) ·
C6 webhook 10x → 1 interação · C7 handoff com motivo · C8 preço livre
rejeitado · C9 ERP indisponível sem inventar · C10 SKU inexistente sem
alucinar · SEC1 401 · SEC2 403 fail-closed · OBS1 api_log sem secret.

O C6 encontrou e provou **2 bugs reais de produção** (webhook rejeitado em
mensagens sem anexo; registro idempotente rejeitado por `undefined`),
ambos corrigidos nesta branch.

## 13. Plano Fase 2 — orçamento automatizado

1. **Checklist dinâmico por produto**: nova Function
   `valeriaChecklistProduto(produtoId)` lendo a receita/ficha do Produto
   Inteligente (campos obrigatórios reais: medidas, material, espessura,
   peças) → substitui os CAMPOS_ESSENCIAIS fixos do briefing.
2. **Rascunho VR no fluxo oficial**: migrar `valeriaCriarOrcamento` do
   agregado legado `orcamentos` para o fluxo `orcamentoTipo` híbrido atual
   (mesmo formato que `_orcSalvarOrcamentoImpl`), sempre `status='rascunho'`
   + `origem='valeria'` + revisão humana antes do envio.
3. **Envio assistido**: humano revisa no ERP → dispara PDF/WhatsApp pelos
   fluxos existentes; `valeriaMudarEtapa(ORCAMENTO_ENVIADO)` fecha o ciclo.
4. **Follow-ups**: Follow-up Messages Tool do ChatVolt + `proximaAcao`.
5. **Conexão do número oficial** (autorização explícita + janela de
   monitoramento + rollback = desligar webhook/tools no painel).

## 14. Fora do escopo desta rodada (explícito)

Número real de WhatsApp; templates Meta pagos; imagem/áudio (registram
metadados e transferem para humano); promoção automática lead→cliente;
qualquer ação da lista "NÃO PODE AINDA" (aprovação, pagamento, OS,
estoque, financeiro, NF, exclusões, configurações).
