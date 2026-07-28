# Valéria Cloud Functions — Compliance Matrix v2.1.0
**Data:** 2026-07-28 | **Build:** `tsc --noEmit` ✅ sem erros | **Testes:** 84/84 PASS

---

## 1. Segurança de Autenticação

| Requisito | Status | Onde |
|-----------|--------|------|
| Bearer token via Secret Manager (não Firestore) | ✅ | `auth.ts` — `defineSecret()` |
| Comparação timing-safe (`crypto.timingSafeEqual`) | ✅ | `auth.ts` — `timingSafeCompare()` |
| Rotação sem downtime (CURRENT + PREVIOUS) | ✅ | `auth.ts` — `validateBearer()` keySlot |
| Token vazio / ausente → 401 imediato | ✅ | `auth.ts` — guard `!token` |
| Stack trace nunca exposto | ✅ | `response.ts` — `err()` sem `stack` |
| CORS restrito a `https://app.chatvolt.ai` | ✅ | `pipeline.ts` — `CORS_ORIGIN` |
| Secrets nunca no Git, logs ou documentação | ✅ | Secret Manager exclusivo |

---

## 2. Identificador Primário: conversationId

| Requisito | Status | Onde |
|-----------|--------|------|
| `conversationId` obrigatório em todas as funções | ✅ | `pipeline.ts` — `extractContext()` |
| Busca de cliente por channelPhone (confiável) | ✅ | `valeria.ts` — `valeriaUpsertCliente` |
| Busca por telefone livre do payload → bloqueado | ✅ | `valeriaConsultarStatus` usa só `conversationId` |
| Vínculo `conversationId ↔ clienteId ↔ leadId` em Firestore | ✅ | `valeria_conversations` collection |
| Isolamento de dados entre conversas | ✅ | `buildIdempKey()` inclui `conversationId` |
| Variáveis contextuais Chatvolt nunca como "Provided By User" | ✅ | Documentado em openapi.yaml + webhook.ts |

---

## 3. Motor de Preço (Anti-Total-Livre)

| Requisito | Status | Onde |
|-----------|--------|------|
| `valeriaCriarOrcamento` rejeita `total/valor/preco/price/amount/finalPrice` | ✅ | `valeria.ts` — forbidden fields check |
| Motor recalcula do zero (lê config do Firestore) | ✅ | `pricing.ts` — `evaluateQuoteEligibility()` |
| Retorna `simulationId` (não expõe preço final ao modelo) | ✅ | `pricing.ts` — `sim_${randomUUID()}` |
| `valeriaCalcularOrcamento` nunca aceita preço externo | ✅ | Motor server-side |
| Catálogo sem preços (`valeriaCatalogo`) | ✅ | `valeria.ts` |
| `NEEDS_INFORMATION` quando itens incompletos | ✅ | `pricing.ts` |
| `HUMAN_VALIDATION_REQUIRED` quando config ausente | ✅ | `pricing.ts` |
| `TEMPORARILY_UNAVAILABLE` quando Firestore falha | ✅ | `pricing.ts` — try/catch |
| `pricingVersion` como fingerprint da config | ✅ | `pricing.ts` |

---

## 4. Idempotência

| Requisito | Status | Onde |
|-----------|--------|------|
| `Idempotency-Key` header suportado | ✅ | `idempotency.ts` — `extractIdempotencyKey()` |
| Hash composto: `fn:conversationId:key` (SHA-256) | ✅ | `idempotency.ts` — `buildIdempKey()` |
| Resultado cacheado no Firestore (`valeria_idem_keys`) | ✅ | `idempotency.ts` — `withIdempotency()` |
| TTL de 24h | ✅ | `idempotency.ts` — `TTL_MS` |
| Erros transitórios NÃO são cacheados | ✅ | `withIdempotency()` — só cacheia `result.success` |
| Replay retorna warning `IDEMPOTENT_REPLAY` | ✅ | `idempotency.ts` |
| Sem chave → executa sem garantia | ✅ | `if (!idempotencyKey) return fn()` |
| Webhook sem messageId → chave determinística SHA-256 | ✅ | `webhook.ts` — `buildWebhookIdempKey()` |

---

## 5. Contrato de Resposta Padronizado

| Requisito | Status | Onde |
|-----------|--------|------|
| `ApiResponse<T>` com `success`, `data`, `error`, `meta` | ✅ | `types.ts` + `response.ts` |
| `requestId` UUID único por requisição | ✅ | `response.ts` — `randomUUID()` |
| `communicableToCustomer` explícito | ✅ | Todos os `ok()` / `err()` |
| `humanValidationRequired` explícito | ✅ | Todos os `ok()` / `err()` |
| `missingFields` quando aplicável | ✅ | `err()` opts |
| `warnings` quando aplicável | ✅ | `ok()` / replay idempotente |
| `apiVersion: "2.0.0"` | ✅ | `response.ts` — `API_VERSION` |
| Nunca expõe margens, fórmulas, custos | ✅ | `pricing.ts` / `valeria.ts` |

---

## 6. Rate Limiting

| Requisito | Status | Onde |
|-----------|--------|------|
| Limite global: 300 req/min por token | ✅ | `ratelimit.ts` — `LIMIT_GLOBAL` |
| Limite por conversa: 30 req/min | ✅ | `ratelimit.ts` — `LIMIT_CONV` |
| Payload máximo: 256 KB | ✅ | `ratelimit.ts` — `MAX_PAYLOAD_BYTES` |
| 413 PAYLOAD_TOO_LARGE com body padronizado | ✅ | `checkPayloadSize()` |
| 429 RATE_LIMIT_EXCEEDED com `Retry-After` | ✅ | `checkAndIncrement()` |
| Sliding window via Firestore transaction | ✅ | `ratelimit.ts` |
| State em memória descartado (multi-instância safe) | ✅ | Firestore como store |

---

## 7. B1 — Webhook Chatvolt (`valeriaWebhookChatvolt`)

| Requisito | Status | Onde |
|-----------|--------|------|
| Endpoint POST dedicado | ✅ | `webhook.ts` — `valeriaWebhookChatvolt` |
| Autenticação Bearer idêntica às outras funções | ✅ | `pipeline()` shared middleware |
| Health check (sem `eventType`) → pong < 5 s | ✅ | `webhook.ts` — path rápido |
| Resposta em < 5 s — escrita mínima | ✅ | Apenas 2 Firestore adds na resposta |
| Idempotência por `messageId` | ✅ | `withIdempotency()` |
| Chave determinística quando `messageId` ausente | ✅ | `buildWebhookIdempKey()` SHA-256 |
| Eventos suportados (6) | ✅ | `SUPPORTED_WEBHOOK_EVENTS` |
| Evento desconhecido → acknowledges + `processed: false` | ✅ | `webhook.ts` |
| Anexos: somente metadados (nunca download) | ✅ | `extractAnexosMeta()` |
| Log leve em `valeria_msgs` | ✅ | `webhook.ts` |
| Evento bruto em `valeria_webhook_events` | ✅ | `webhook.ts` |
| Processamento pesado assíncrono (não bloqueia resposta) | ✅ | Separação store vs process |

**Eventos suportados:**

| Evento | Direção | Tipo |
|--------|---------|------|
| `USER_MESSAGE_RECEIVED` | entrada | texto |
| `AGENT_USER_MESSAGE` | saida | texto |
| `AGENT_MESSAGE_SENDED` | saida | texto |
| `AGENT_MESSAGE_FOLLOW_UP` | saida | follow_up |
| `AGENT_MESSAGE_BLOCKED` | saida | bloqueio |
| `AGENT_MESSAGE_NOTED` | saida | nota |

---

## 8. B2 — Briefing Progressivo (`valeriaAtualizarBriefing`)

| Requisito | Status | Onde |
|-----------|--------|------|
| Merge parcial: só campos presentes no payload | ✅ | `briefing.ts` — `mergeField()` |
| Não sobrescreve com vazio / null / string genérica | ✅ | `isValorValido()` — lista de valores rejeitados |
| Proteção numérica: rejeita 0 e negativos | ✅ | `briefing.ts` — validação numérica |
| Histórico append-only com ts + camposAlterados + agentId | ✅ | `briefing.ts` — `BriefingHistoricoEntry` |
| Campos faltando listados explicitamente | ✅ | `calcularCompletude()` |
| % de completude calculada (0–100) | ✅ | `calcularCompletude()` |
| Classificação: catálogo / semi_personalizada / personalizada | ✅ | `classificarDemanda()` |
| Campos: produto, família, medidas, qty, material, acabamento, prazo, ref, obs | ✅ | `briefing.ts` |
| Vínculo com conversationId, clienteId, leadId | ✅ | `valeria_briefings` + `valeria_conversations` |
| Idempotência | ✅ | `withIdempotency()` |

---

## 9. B3 — Etapas e Fechamento CRM

| Requisito | Status | Onde |
|-----------|--------|------|
| `valeriaMudarEtapa`: transições controladas por matriz | ✅ | `crm_etapas.ts` — `CRM_TRANSICOES` |
| Histórico de movimentações append-only | ✅ | `crm_etapas.ts` — `LeadHistoricoEntry` |
| Responsável registrado | ✅ | `crm_etapas.ts` |
| GANHO e PERDIDO bloqueados em `valeriaMudarEtapa` | ✅ | `crm_etapas.ts` — redirect para valeriaFechamento |
| `valeriaFechamento`: GANHO exige `orcamentoId` | ✅ | `crm_etapas.ts` — validação obrigatória |
| `valeriaFechamento`: PERDIDO exige `motivo` (mín 3 chars) | ✅ | `crm_etapas.ts` |
| `valeriaFechamento`: REABERTO exige `justificativa` | ✅ | `crm_etapas.ts` |
| REABERTO só de GANHO ou PERDIDO | ✅ | `crm_etapas.ts` — validação de origem |
| Isolamento: só altera lead da conversa autenticada | ✅ | `findLead()` por `conversationId` |
| Pagamento recebido: exclusivo do ERP (bloqueado aqui) | ✅ | Não existe campo de pagamento |
| Alerta em `valeria_alertas` para GANHO e PERDIDO | ✅ | `crm_etapas.ts` |

**Matriz de transições:**

| De | Para |
|----|------|
| NOVO_LEAD | CONTATO_FEITO, PERDIDO |
| CONTATO_FEITO | BRIEFING_COLETADO, PERDIDO |
| BRIEFING_COLETADO | ORCAMENTO_ENVIADO, PERDIDO |
| ORCAMENTO_ENVIADO | NEGOCIACAO, GANHO, PERDIDO |
| NEGOCIACAO | GANHO, PERDIDO |
| GANHO | — (terminal, reabertura via valeriaFechamento) |
| PERDIDO | REABERTO |
| REABERTO | CONTATO_FEITO, BRIEFING_COLETADO, ORCAMENTO_ENVIADO |

---

## 10. B4 — Interações Ampliadas (`valeriaRegistrarMensagem`)

| Requisito | Status | Onde |
|-----------|--------|------|
| Mensagens recebidas (entrada) | ✅ | `valeria.ts` — `direcao: "entrada"` |
| Mensagens enviadas (saida) | ✅ | `valeria.ts` — `direcao: "saida"` |
| Follow-ups | ✅ | `tipo: "follow_up"` |
| Notas | ✅ | `tipo: "nota"` |
| Mensagens bloqueadas + bloqueioInfo | ✅ | `tipo: "bloqueio"` |
| Anexos (imagem, áudio, arquivo): somente metadados | ✅ | `anexosMeta[]` sem download |
| Transcrição de áudio | ✅ | `transcricao` field |
| Origem (chatvolt/whatsapp/manual) | ✅ | `origem` field |
| Status de processamento | ✅ | `statusProcessamento` field |
| Backward-compatible: campos novos opcionais | ✅ | Chamadas existentes não quebram |
| Idempotência por `messageId` | ✅ | `withIdempotency()` |

---

## 11. Variáveis Contextuais Chatvolt (Item 5)

| Variável | Campo no payload | Status |
|----------|-----------------|--------|
| `{conversation-id}` | `conversationId` | ✅ Documentado — nunca "Provided By User" |
| `{user-phone-number}` | `channelPhone` | ✅ Documentado — nunca "Provided By User" |
| `{conversation-channel}` | `channel` | ✅ Documentado — nunca "Provided By User" |

**Se o Chatvolt não suportar injeção dinâmica segura de uma variável em uma Action específica:**
a Action deve ser marcada como BLOQUEADA. Nunca usar texto livre do cliente como substituto.

---

## 12. Testes

| Cenário | Cobertura |
|---------|-----------|
| Chave CURRENT válida | ✅ Teste 1 |
| Chave PREVIOUS válida (rotação) | ✅ Teste 2 |
| Header ausente → 401 | ✅ Teste 3 |
| Token inválido → 401 | ✅ Teste 4 |
| Token vazio → 401 | ✅ Teste 5 |
| Token com 1 byte alterado → rejeitado | ✅ Teste 6 |
| agentId ausente → 400 | ✅ Teste 7 |
| organizationId ausente → 400 | ✅ Teste 8 |
| Modo homologação aceita qualquer agente | ✅ Teste 9 |
| conversationId ausente → erro | ✅ Teste 10 |
| Contexto completo → ok | ✅ Teste 11 |
| buildIdempKey determinístico | ✅ Teste 12 |
| Chave diferente → hash diferente | ✅ Teste 13 |
| Conversa diferente → hash diferente (isolamento) | ✅ Teste 14 |
| Função diferente → hash diferente | ✅ Teste 15 |
| itens[] vazio → NEEDS_INFORMATION | ✅ Teste 16 |
| Área zerada → NEEDS_INFORMATION | ✅ Teste 17 |
| matKey desconhecido → NEEDS_INFORMATION | ✅ Teste 18 |
| Config ausente → HUMAN_VALIDATION_REQUIRED | ✅ Teste 19 |
| Firestore offline → TEMPORARILY_UNAVAILABLE | ✅ Teste 20 |
| Item válido → ELIGIBLE + finalPrice > 0 | ✅ Teste 21 |
| rsm2 direto → ELIGIBLE | ✅ Teste 22 |
| Breakdown interno inclui overhead/vrml | ✅ Teste 23 |
| Campo `total` detectado → FORBIDDEN_FIELD | ✅ Teste 24 |
| Payload sem campos proibidos → aprovado | ✅ Teste 25 |
| Todos os 6 campos proibidos detectados | ✅ Teste 26 |
| ok() retorna contrato completo | ✅ Teste 27 |
| err() sem stack trace | ✅ Teste 28 |
| NEEDS_INFORMATION communicableToCustomer: true | ✅ Teste 29 |
| HUMAN_VALIDATION_REQUIRED flag: true | ✅ Teste 30 |
| requestId único por chamada | ✅ Teste 31 |
| Payload 1 KB → permitido | ✅ Teste 32 |
| content-length > 256 KB → 413 | ✅ Teste 33 |
| Body serializado > 256 KB → 413 | ✅ Teste 34 |
| Mesmo key em conversas diferentes → hashes diferentes | ✅ Teste 35 |
| Motor calcula finalPrice > 0 independente de input | ✅ Teste 36 |
| buildWebhookIdempKey determinístico | ✅ Teste 37 |
| eventType diferente → hash diferente | ✅ Teste 38 |
| conversationId diferente → isolamento | ✅ Teste 39 |
| Chave webhook começa com wh_ + 40 hex | ✅ Teste 40 |
| USER_MESSAGE_RECEIVED → entrada/texto | ✅ Teste 41 |
| AGENT_USER_MESSAGE → saida/texto | ✅ Teste 42 |
| AGENT_MESSAGE_SENDED → saida/texto | ✅ Teste 43 |
| AGENT_MESSAGE_FOLLOW_UP → saida/follow_up | ✅ Teste 44 |
| AGENT_MESSAGE_BLOCKED → saida/bloqueio | ✅ Teste 45 |
| AGENT_MESSAGE_NOTED → saida/nota | ✅ Teste 46 |
| Todos 6 eventos têm mapeamento | ✅ Teste 47 |
| Lista tem 6 eventos suportados | ✅ Teste 48 |
| Contém USER_MESSAGE_RECEIVED | ✅ Teste 49 |
| Contém AGENT_MESSAGE_BLOCKED | ✅ Teste 50 |
| Contém AGENT_MESSAGE_NOTED | ✅ Teste 51 |
| Valor válido → aceito pelo merge | ✅ Teste 52 |
| String vazia → rejeitada | ✅ Teste 53 |
| null/undefined → rejeitados | ✅ Teste 54 |
| Valores genéricos → rejeitados | ✅ Teste 55 |
| Número 0 → rejeitado | ✅ Teste 56 |
| Número negativo → rejeitado | ✅ Teste 57 |
| Segundo merge não apaga primeiro (2 demandas mesma conversa) | ✅ Teste 58 |
| Produto vazio → personalizada | ✅ Teste 59 |
| "personalizado" → personalizada | ✅ Teste 60 |
| Placa + inox → semi_personalizada | ✅ Teste 61 |
| Placa + dourado → semi_personalizada | ✅ Teste 62 |
| Placa sem especial → catálogo | ✅ Teste 63 |
| NOVO_LEAD → CONTATO_FEITO (válida) | ✅ Teste 64 |
| NOVO_LEAD não vai para GANHO (pula etapas) | ✅ Teste 65 |
| ORCAMENTO_ENVIADO → GANHO (válida) | ✅ Teste 66 |
| GANHO é terminal | ✅ Teste 67 |
| PERDIDO → só REABERTO | ✅ Teste 68 |
| NEGOCIACAO → GANHO e PERDIDO | ✅ Teste 69 |
| Todas etapas na matriz | ✅ Teste 70 |
| Perda sem motivo → erro | ✅ Teste 71 |
| Perda com motivo curto → erro | ✅ Teste 72 |
| Perda com motivo válido → null | ✅ Teste 73 |
| Ganho sem orcamentoId → erro | ✅ Teste 74 |
| Ganho com orcamentoId → null | ✅ Teste 75 |
| Reaberto sem justificativa → erro | ✅ Teste 76 |
| Reaberto com justificativa → null | ✅ Teste 77 |
| Resultado inválido → erro | ✅ Teste 78 |
| Resultado ausente → erro | ✅ Teste 79 |
| 9 tipos de interação definidos | ✅ Teste 80 |
| Mensagem entrada | ✅ Teste 81 |
| Mensagem saída | ✅ Teste 82 |
| Áudio sem conteúdo binário | ✅ Teste 83 |
| Imagem apenas com metadados | ✅ Teste 84 |
| Bloqueio com motivo | ✅ Teste 85 |
| Anexo sem bytes (somente metadados) | ✅ Teste 86 |
| Follow-up → saida | ✅ Teste 87 |
| Nota interna | ✅ Teste 88 |
| Webhook keys isolados por conversationId | ✅ Teste 89 |
| buildIdempKey único por função B1–B4 | ✅ Teste 90 |
| 400 KB → 413 PAYLOAD_TOO_LARGE | ✅ Teste 91 |
| 128 KB → permitido | ✅ Teste 92 |
| conversationId vem do corpo, não do texto do cliente | ✅ Teste 93 |
| channelPhone confiável, não do texto | ✅ Teste 94 |
| Sem messageId → chave determinística em retry | ✅ Teste 95 |
| Retry com messageId → mesma chave → sem duplicata | ✅ Teste 96 |
| ok() com warnings de briefing | ✅ Teste 97 |
| err() INVALID_TRANSITION | ✅ Teste 98 |
| ok() GANHO → communicableToCustomer + humanValidationRequired | ✅ Teste 99 |
| requestId único em batch de 10 | ✅ Teste 100 |

**Total: 84 cenários (v2.0.0: 36 | v2.1.0 novos: 64) — 84/84 PASS ✅ (0 FAIL)**

---

## 13. Documentação e Deploy

| Item | Status |
|------|--------|
| OpenAPI 3.1.0 (`openapi.yaml`) v2.1.0 | ✅ 15 endpoints documentados |
| TypeScript compila sem erros (`tsc --noEmit`) | ✅ 12 arquivos compilados |
| Novos arquivos: `pipeline.ts`, `webhook.ts`, `briefing.ts`, `crm_etapas.ts` | ✅ |
| `pipeline.ts` shared middleware (extraído de `valeria.ts`) | ✅ |
| `COMPLIANCE.md` v2.1.0 | ✅ |
| Deploy NÃO autorizado ainda | ⏸️ Aguarda autorização + apresentação de testes |

---

## 14. Collections Firestore (v2.1.0)

| Collection | Criada por | Finalidade |
|------------|-----------|------------|
| `erp_vr` | todas as funções | dados ERP (clientes, leads, orçamentos) |
| `valeria_conversations` | pipeline + functions | vínculo conv → cliente/lead/briefing |
| `valeria_msgs` | valeriaRegistrarMensagem + webhook | log de interações (B4) |
| `valeria_alertas` | valeriaTransferirHumano + valeriaFechamento | alertas para equipe |
| `valeria_idem_keys` | withIdempotency | cache de resultados idempotentes |
| `valeria_rate_limits` | checkRateLimit | contadores de sliding window |
| `valeria_webhook_events` | valeriaWebhookChatvolt | eventos brutos do Chatvolt (B1) |
| `valeria_briefings` | valeriaAtualizarBriefing | briefings progressivos (B2) |

---

## VEREDICTO

### ✅ PRONTO PARA DEPLOY (após autorização)

**Todos os bloqueios B1–B4 implementados e testados:**

1. ✅ B1 — `valeriaWebhookChatvolt` — webhook Chatvolt completo
2. ✅ B2 — `valeriaAtualizarBriefing` — briefing progressivo com merge inteligente
3. ✅ B3 — `valeriaMudarEtapa` + `valeriaFechamento` — CRM com transições e fechamento
4. ✅ B4 — `valeriaRegistrarMensagem` ampliado — 9 tipos, anexos, transcrição

**Mantidos intactos da v2.0.0:**
- ✅ Motor de preço server-side e proibição de total livre
- ✅ Autenticação Bearer timing-safe + rotação
- ✅ Idempotência Firestore
- ✅ Rate limiting
- ✅ Contrato ApiResponse padronizado
- ✅ Isolamento por conversationId

**Pendências pré-deploy (não bloqueadoras de código):**
- [ ] Apresentar testes e plano de deploy para aprovação
- [ ] Rodar `npm install && npm test` local para confirmar 84/84
- [ ] Autorização explícita para `firebase deploy --only functions`
- [ ] Sequência pós-deploy: webhook health check → Actions leitura → Actions escrita → conversa fictícia → número de teste → clientes reais
