# VALERIA 2.0 — Fase E.2.6 — Validação da arquitetura orquestrada assíncrona

**Status: SOMENTE AUDITORIA/DESENHO. Nenhuma mudança funcional. Nenhum
deploy. `Agent Query` NÃO foi chamado em conversa real. Nenhuma mensagem
foi enviada via API. Webhook não foi alterado. Automações não foram
desligadas. `data.valeriaV2Enabled=false`. KB continua desconectada.**

---

## 1. Origem da mensagem de boas-vindas — NÃO CONFIRMADA

Investiguei (somente leitura) todos os pontos plausíveis da UI do
agente e não localizei a configuração exata:

- **Geral & Flux → Dados do Agente**: sem campo de mensagem inicial/boas-vindas.
- **Geral & Flux → Mensagens rápidas**: vazio ("Ainda não há mensagens rápidas") — confirmado não é a fonte.
- **Geral & Flux → Integração Flux CRM**: "Cenário Padrão" e "Etapa Padrão" **não configurados** (dropdowns vazios, botão Salvar desabilitado) — descarta a hipótese de um `CRM Scenario Step.initialMessage` como cenário PADRÃO do agente (a API `Get Conversation By Id` documenta esse campo, mas não está em uso aqui).
- **Modelo → Avançadas → Horário de Inatividade**: OFF — não é uma mensagem de "fora de horário".
- **Segurança**: nenhum toggle relacionado a mensagem automática de boas-vindas.
- **Documentação oficial** (`docs.chatvolt.ai`): nenhuma página encontrada sobre "greeting"/"initial message"/"welcome message" como recurso documentado.

**Não desliguei nada, conforme instruído.** Hipótese mais provável, **não
confirmada**: comportamento de plataforma do ChatVolt para o primeiro
contato de um número novo/conversa nova (possivelmente vinculado à
função de Contatos/CRM em outro nível — organização, não agente — ou a
um recurso ainda não exposto na UI investigada). Recomendo, se o
Gabriel quiser resolver isso com certeza, abrir um ticket de suporte
perguntando diretamente "de onde vem essa mensagem quando
`isAiEnabled=false`", já que a auditoria de UI/docs chegou ao limite do
que dá para confirmar sem acesso a configuração administrativa mais
profunda ou resposta do próprio ChatVolt.

## 2. Todos os mecanismos que respondem com AI=false

| Mecanismo | Confirmado que responde com AI=false? | Fonte |
|---|---|---|
| Mensagem de boas-vindas (texto "Olá! Seja bem-vindo...") | **Sim, confirmado empiricamente** (Experimento A, Fase E.2.5) | Teste real |
| Agente LLM principal (`isAiEnabled`) | Não — é exatamente o que esse toggle desliga | Documentação + teste |
| Mensagens rápidas | N/A — vazio, não há o que disparar | UI |
| Follow-up Messages | Não testado, mas por design só dispara após HORAS de inatividade (4h web / 16h WhatsApp) — não afetaria uma medição de segundos | Docs (`/agent/tools`) |
| Respostas com Atraso | Não é uma "resposta" própria, é um agrupador/atraso da resposta do agente — se o agente está OFF, não há o que atrasar | Docs + comportamento observado |
| Horário de Inatividade | Desativado nesta config — não aplicável hoje | UI confirmado OFF |
| CRM Scenario (`initialMessage`) | Não configurado como padrão neste agente — não deveria disparar, mas não 100% descartável para conversas antigas que possam ter sido associadas manualmente no passado | UI (Cenário Padrão vazio) |

**Resposta à pergunta do item 3**: **não posso confirmar "silêncio
total garantido" com `isAiEnabled=false` permanente** — o Experimento A
já prova o contrário na prática (a mensagem de boas-vindas furou o
toggle). Até a origem exata ser identificada e neutralizada (ou até o
suporte do ChatVolt confirmar que dá para desligá-la separadamente),
**qualquer arquitetura que dependa de "ChatVolt completamente
silencioso" (ARCH 2) permanece não comprovada como segura.**

---

## 3. Agent Query — auditoria detalhada (somente documentação, não executado)

`POST https://api.chatvolt.ai/agents/{id}/query`

| Pergunta | Resposta (da documentação) |
|---|---|
| Aceita `agentId`? | Sim, é parâmetro de path (`{id}`) |
| Aceita `conversationId`? | Sim — se existente, reutiliza; se ausente/inválido, cria nova |
| Usa histórico da conversa? | Implícito, sim — doc diz que passar `conversationId` "agrupa as mensagens numa única conversa", ou seja, o histórico já existente é considerado |
| Usa o prompt atual do agente? | Sim por padrão; pode ser sobrescrito por chamada via `systemPrompt` |
| Usa Tools? | **Provavelmente sim, mas não 100% confirmado pela doc** — o parâmetro `context` é descrito como "dados extras que podem ser usados por Tools ou no prompt", o que só faz sentido se Tools rodarem. Não há, porém, nenhum campo na resposta que confirme quais Tools rodaram nem o resultado delas — só o texto final (`answer`) |
| Usa Knowledge Base? | Sim — `filters.datasource_ids` permite restringir a busca, e a resposta inclui `sources[]` com os trechos usados, confirmando RAG ativo por padrão |
| Executa function calling? | Ver acima — plausível, não garantido pela doc, e sem visibilidade de quais Tools rodaram |
| Retorna só texto ou também tool calls? | **Só texto** (`answer`) + `sources` (RAG) + `metadata` (formato livre, não documentado em detalhe). Nenhum campo estruturado de "tool_calls" |
| Persiste a resposta automaticamente? | A resposta é gravada como mensagem no banco do ChatVolt (`messageId` retornado é "ID da mensagem de resposta do agente **no banco de dados**") — ou seja, ela FICA registrada na conversa, mesmo sem confirmação explícita de envio ao canal |
| Apenas gera e retorna, ou também envia? | A documentação **não menciona envio automático ao canal** (WhatsApp) em nenhum momento — a doc do Make reforça isso ao dizer "para responder mensagens de WhatsApp, siga o guia de integração WhatsApp **separadamente**", sugerindo que Agent Query é pensado para outros canais/integrações que o próprio chamador entrega a resposta. **Não é 100% confirmado sem um teste real controlado** (que não fizemos, conforme instrução) |
| Latência aproximada/documentada? | Não documentada. Suporta `streaming: true` (SSE) e `callbackURL` (processamento assíncrono, retorna 202 e entrega depois via POST) — ambos os mecanismos existem justamente PORQUE a latência pode ser alta o suficiente para justificar não segurar a conexão HTTP aberta |
| Billing/créditos | Não detalhado nesta página; sabemos de fases anteriores que o custo em créditos varia pelo modelo/tier de contexto configurado no agente (visto na UI de seleção de modelo) |
| Limites | Não documentados nesta página |

## 4. Pergunta crítica — Tools (item 5 do pedido)

**Resposta honesta: C — "suporta algumas, mas não sabemos quais, e não
temos confirmação"**, não A nem B com certeza. A evidência textual
(`context` "usado por Tools") aponta para "sim, executa Tools", mas:
- Não há confirmação de que TODAS as 4 Tools da ValerIA
  (`buscar_contexto_da_conversa`, `valeria_get_catalog`,
  `valeria_update_catalog_qualification`, `Solicitar Humano`) seriam
  chamadas da mesma forma que são hoje via WhatsApp nativo.
- Não há visibilidade de QUAIS Tools rodaram numa chamada específica —
  só dá para inferir indiretamente checando efeitos colaterais (ex.:
  conferir se `valeria_technical_briefings/{id}` foi atualizado depois
  da chamada), o que é factível mas não é "confirmação direta da API".
- **Isso é decisivo, como o Gabriel apontou**: se Agent Query não
  disparar as Tools de forma confiável e visível, substituir o
  auto-agent por ele exigiria redesenhar a orquestração (a VARIANTE B
  abaixo), não só trocar o gatilho.

**Não posso responder com certeza sem um teste real controlado — que
não fizemos nesta fase, por instrução explícita.** Se decidirem seguir
adiante, este é o primeiro coisa a confirmar experimentalmente antes de
qualquer PoC maior (ver seção de plano de PoC).

## 5. Histórico de conversa (item 6)

Confirmado pela doc: passar `conversationId` existente reaproveita o
histórico ("agrupa as mensagens numa única conversa"). Isso responde
à preocupação de "não construir um prompt gigante manualmente a cada
turno" — o ChatVolt já cuida disso internamente, do mesmo jeito que
cuida hoje para o auto-reply nativo. Não precisaríamos montar contexto
manualmente, só apontar o `conversationId` certo.

## 6. `send-message` — auditoria (somente documentação, não executado)

`POST https://api.chatvolt.ai/conversation/message/{type}/{value}`

| Pergunta | Resposta |
|---|---|
| Aparece normalmente no WhatsApp? | Não documentado explicitamente, mas é o mecanismo oficial de "enviar mensagem" da API — é razoável esperar que sim (é a função que a própria UI/Inbox do ChatVolt usa para operador humano responder manualmente) |
| Aparece no histórico ChatVolt? | Sim — resposta inclui o objeto `message` completo, com `id`, `conversationId`, `createdAt`, etc., igual a qualquer outra mensagem |
| Autoria exibida | **Sempre `"from": "human"`** no schema documentado — não existe opção de marcar como "agent"/bot nesse endpoint |
| Dispara webhook outbound? | **Não documentado, não testado.** Dado que mensagens enviadas por operadores humanos hoje (handoff) certamente passam por esse mesmo mecanismo interno, e sabemos que eventos de webhook chegam com atraso e nem sempre disparam (achado da Fase M.1), não há garantia — precisa ser testado antes de confiar em qualquer lógica que dependa disso |
| Pode causar loop? | Ver desenho na seção 8 abaixo |
| Reativa IA? | Não documentado — são endpoints distintos e independentes (`send-message` vs `set-ai-enabled`); não há indicação de efeito colateral entre eles |
| Interfere em handoff? | Não documentado diretamente, mas como é o mesmo mecanismo que um humano usaria, não deveria quebrar o fluxo de handoff — precisa validação |
| Aceita texto vindo do Agent Query? | Sim, estruturalmente — é só um campo `message: string`, aceitaria qualquer texto, incluindo o `answer` retornado pelo Agent Query |

---

## 7. Desenho anti-loop (item 8)

Regra proposta (desenho, não implementada):

1. **Nunca tratar como inbound processável um evento cujo conteúdo
   already tenha sido originado pelo nosso próprio backend.** Como
   `send-message` sempre marca a mensagem como `from: "human"`, e nosso
   backend nunca deveria aparecer como `from: "human"` organicamente
   (só operadores reais da equipe fazem isso hoje), a regra mais segura
   é: **marcar e reconhecer nossas próprias mensagens por
   `messageId`/`id`**, não por conteúdo nem por `from`.
2. Ao chamar `send-message`, guardar o `message.id` retornado (a API
   devolve o objeto completo) numa lista local de "IDs que nós mesmos
   geramos" (ex.: coleção Firestore `valeria_backend_sent_messages`,
   TTL curto).
3. Se um evento de webhook chegar referenciando esse mesmo `messageId`
   (ou `id` de mensagem coincidente), **descartar sem processar** — é
   eco da nossa própria escrita, não uma mensagem nova do cliente.
4. Reforço adicional: como toda mensagem nossa é `from: "human"`, e o
   webhook.ts já tem lógica de direção baseada em conteúdo
   (`mensagemCliente` vs `respostaAgente`), um evento com `from: human`
   cujo `id` bate com um `messageId` que nós mesmos geramos nunca deve
   ser interpretado como `mensagemCliente`.
5. **Não confiar em texto/heurística de conteúdo para detectar loop** —
   exatamente como o Gabriel pediu — a única base seria o `messageId`
   determinístico devolvido pela própria API no momento do envio.

**Isto ainda depende de confirmar empiricamente que `send-message`
realmente dispara ALGUM evento de webhook identificável** (item 6,
"dispara webhook outbound?" não confirmado) — se não disparar nada, o
risco de loop desaparece sozinho (nada para reprocessar), mas também
perderíamos qualquer confirmação de entrega via webhook (teríamos que
confiar só na resposta HTTP 200 do `send-message` em si).

---

## 8. Comparação Variante A vs Variante B

### Variante A — Agent Query como "cérebro"

Backend: classifica → chama `Agent Query` (usa prompt+Tools+KB do
próprio ChatVolt) → envia resposta via `send-message`.

- **Determinismo**: médio — a classificação de intenção é determinística
  (nossa), mas a geração em si continua sendo o mesmo LLM de sempre,
  com o mesmo risco de não seguir a regra "responda e pare" (o problema
  ORIGINAL que motivou toda a Fase E.2 nunca foi resolvido nessa
  variante — só decidimos QUANDO chamar o LLM, não garantimos O QUE ele
  responde).
- **Reaproveitamento do prompt atual**: total — é o mesmo prompt, mesmo
  agente.
- **Tools**: incerto (item 4 acima) — pode não funcionar como hoje.
- **Complexidade**: baixa-média — poucos endpoints novos a orquestrar.
- **Latência**: soma webhook (~4-9s) + geração do LLM via Agent Query
  (não medida diretamente, mas o "native agentResponseWindow" da Fase
  M.1 é uma proxy razoável do mesmo motor: mediana ~7s, podendo chegar a
  ~41s) + `send-message` (provavelmente rápido, centenas de ms, por
  analogia com `set-ai-enabled`).
- **Custo**: create um Agent Query = consumo de créditos análogo ao
  auto-reply atual (mesmo motor).
- **Manutenção**: baixa — não precisa manter lógica de negócio duplicada.
- **Risco**: médio-alto — depende de duas incertezas não confirmadas
  (Tools funcionam? envio automático não duplica?).

### Variante B — Backend como orquestrador completo

Backend: classifica → chama `valeria_get_catalog`/
`buscar_contexto_da_conversa` diretamente (nossas próprias Cloud
Functions, já existentes e testadas) → monta estado/decisão
determinística (reaproveitando `product_resolution.ts`,
`catalog_draft.ts`, `qualification_engine.ts` já existentes) → usa o
modelo (via chamada direta a uma API de LLM, ou via `Agent Query` só
para REDIGIR o texto final com base num resultado já decidido
deterministicamente) → envia via `send-message`.

- **Determinismo**: **alto** — a decisão de negócio (o que fazer, que
  produto, que próxima ação) já é 100% determinística hoje
  (`qualification_engine.ts`/`resolveProductMatch`), o LLM entraria
  só para redigir a frase final a partir de uma decisão já tomada — o
  mesmo padrão de "LLM só interpreta linguagem, backend decide" que já
  é o princípio arquitetural da ValerIA 2.0 desde o início.
- **Reaproveitamento do prompt atual**: parcial — precisaria de um
  prompt MENOR e mais restrito, só para redação, não para decisão
  (o prompt atual de 7519 chars mistura as duas coisas).
- **Tools**: não é um problema — não dependemos de Tools rodando dentro
  de uma chamada de LLM externa; nós MESMOS chamamos as funções
  determinísticas diretamente, como Cloud Functions internas.
- **Complexidade**: **alta** — precisaria reimplementar/adaptar todo o
  fluxo de decisão para rodar fora do ciclo de function-calling do
  ChatVolt, incluindo geração de texto final coerente com o rascunho
  já calculado.
- **Latência**: webhook (~4-9s) + chamadas às nossas próprias Cloud
  Functions (rápidas, já medidas em fases anteriores, tipicamente
  \<1-2s) + eventual redação via LLM (se usada, mais rápida que um
  Agent Query completo porque o prompt seria menor e mais focado) +
  `send-message`. Provavelmente **menor e mais previsível** que a
  Variante A.
- **Custo**: potencialmente menor (chamadas de LLM mais curtas/focadas,
  se optar por usar LLM só para redação).
- **Manutenção**: alta — mais código nosso para manter, testar e evoluir.
- **Risco**: menor no âmbito comportamental (decisão determinística),
  maior no âmbito de engenharia (mais superfície nova para construir e
  errar).

### Recomendação entre as duas

**Variante B é mais alinhada ao princípio arquitetural que já rege a
ValerIA 2.0 desde o início desta reconstrução** ("LLM só interpreta
linguagem, backend sempre decide") — a Variante A ainda delega a
decisão comportamental crítica ("responda e pare" vs "continue
perguntando") ao mesmo LLM que já provou 3 vezes não seguir essa regra
de forma confiável via prompt. A Variante A só resolve "QUANDO" chamar
o LLM, não "COMO ele se comporta" — o problema original permanece.

---

## 9. Handoff humano (item 12) — desenho

- Preservar `modoAtendimento` como fonte de verdade: se
  `modoAtendimento === "humano"`, o backend **nunca chama Agent Query
  nem gera resposta própria** — nem para EXPLORATORY nem para
  COMMERCIAL_INTENT. Isso já é uma verificação que existe hoje em
  `webhook.ts` (`atd.modoAtendimento !== "humano"` já gate o pipeline
  determinístico atual) — reaproveitável sem mudança de conceito.
- `Solicitar Humano` continuaria existindo como Tool, mas só seria
  relevante nos casos em que decidíssemos delegar a redação ao Agent
  Query (Variante A) — na Variante B, o próprio backend já teria essa
  decisão de handoff embutida na classificação (`HUMAN` como um dos 4
  modos do item 9 do pedido).
- Ao humano assumir (`aguardando_humano`/takeover), nenhuma chamada
  nossa (Agent Query nem geração própria) deve ocorrer — reaproveitar o
  mesmo gate `modoAtendimento`.
- Retorno à ValerIA: quando o humano devolve o atendimento
  (`modoAtendimento` volta a `valeria`), o backend retoma o
  processamento normal a partir da PRÓXIMA mensagem — não haveria
  reprocessamento retroativo (mesmo comportamento confirmado no
  Experimento A: reativar não reprocessa o passado).

## 10. isTest / allowlist / feature flag (item 13)

Sem mudança de princípio: a nova arquitetura, se implementada, entraria
sob os MESMOS gates que já existem hoje (`permitidoParaPipeline`,
`isTeste`, `data.valeriaV2Enabled`) — só passaria a controlar também
"deve o backend chamar Agent Query/enviar resposta" em vez de só
"deve rodar a lógica determinística de bastidor". Nenhum gate novo é
necessário, os existentes já cobrem o rollout controlado.

---

## 11. Estimativa de latência ponta a ponta (item 10)

Dados reais (Fase M.1 + E.2.5) + estimativas rotuladas como tal:

| Etapa | Tempo (medido ou estimado) |
|---|---|
| Mensagem do cliente → nosso webhook | **Medido**: ~4,2s a 9,2s (mediana ~4,9s) |
| Classificação EXPLORATORY×COMMERCIAL_INTENT (código puro) | Estimado: \<50ms, desprezível |
| Geração via Agent Query (Variante A) | **Não medido diretamente** — proxy via `agentResponseWindow` nativo (Fase M.1): mediana ~7s, min 1,1s, máx ~41s |
| Chamadas às nossas Cloud Functions (Variante B) | Estimado, por analogia com Tools já medidas em fases anteriores: \<1-2s |
| `send-message` (entrega) | Não medido, estimado por analogia com `set-ai-enabled` (~200-300ms): poucas centenas de ms |

**Total estimado, cenário típico (mediana)**:
- Variante A: ~4,9s + ~7s + ~0,3s ≈ **~12s**
- Variante B: ~4,9s + ~1,5s + ~0,3s ≈ **~7s**

**Total estimado, cenário de cauda (p95/pior caso observado)**: pode
chegar a **~45-50s** na Variante A (herdando o máximo de 41s observado
no `agentResponseWindow` nativo), bem mais contido na Variante B
(chamadas próprias já são rápidas e previsíveis).

Isso está na faixa que o Gabriel considerou aceitável (6-12s) **no caso
típico**, mas com uma cauda longa preocupante especialmente na Variante
A — reforça a recomendação pela Variante B, que tem menor variância.

---

## 12. Arquitetura recomendada

**Variante B (backend como orquestrador completo), com Agent Query
reservado apenas para a etapa de REDAÇÃO final (não de decisão), se é
que será usado LLM nessa etapa.** Isso preserva o princípio "backend
decide, LLM só interpreta/redige" que já rege a ValerIA 2.0, evita
depender de um comportamento não confirmado (Tools dentro de Agent
Query), e tem latência mais previsível.

**Mas — importante — nenhuma arquitetura assíncrona resolve o problema
da mensagem de boas-vindas não identificada (item 1/2).** Antes de
qualquer PoC, essa lacuna precisa ser fechada (identificada e, se
possível, desligada), porque sem isso não há garantia de "silêncio até
o backend responder" — premissa básica de toda a Fase E.2.6.

## 13. Plano de PoC mínimo (não executar ainda)

1. Identificar a origem da mensagem de boas-vindas (suporte ChatVolt ou
   nova investigação de UI mais profunda) e confirmar como
   desativá-la sem afetar outros canais.
2. Testar, numa conversa de teste isolada e `isAiEnabled=false`
   permanente, se o silêncio agora é total (repetir uma versão do
   Experimento A, várias vezes, tipos de mensagem variados).
3. SÓ ENTÃO testar `Agent Query` uma única vez, em conversa de teste
   isolada, com uma pergunta simples, para confirmar empiricamente:
   Tools rodam? A resposta é auto-enviada ao WhatsApp ou fica só
   retida? `sources`/KB aparecem?
4. Testar `send-message` uma única vez na mesma conversa de teste,
   confirmar entrega, aparição no histórico, e SE dispara webhook
   outbound identificável.
5. Só com esses 4 pontos confirmados, desenhar a PoC funcional mínima
   (1 cenário EXPLORATORY completo, ponta a ponta, allowlist apenas).

## 14. Rollback

Em qualquer etapa: `data.valeriaV2Enabled=false` continua sendo o
interruptor mestre; adicionalmente, `set-ai-enabled(true)` reverte
qualquer conversa de teste ao comportamento nativo do ChatVolt a
qualquer momento — nenhuma mudança desta arquitetura é permanente ou
difícil de desfazer, já que tudo vive em toggles reversíveis por API.

## 15. Nenhuma mudança funcional / feature flag final

Confirmado: nenhuma automação foi desligada, nenhum Agent Query foi
chamado, nenhuma mensagem foi enviada via API, webhook não foi
alterado. `data.valeriaV2Enabled` permanece **`false`**.
