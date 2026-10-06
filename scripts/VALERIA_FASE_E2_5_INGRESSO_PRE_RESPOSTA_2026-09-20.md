# VALERIA 2.0 — Fase E.2.5 — Existe algum ingresso pré-resposta?

**Status: SOMENTE DESENHO/INVESTIGAÇÃO. Nenhum rollout. Nenhuma mudança
funcional em produção (código, prompt, Tools, whitelist, webhook,
modelo). `data.valeriaV2Enabled=false` durante toda a fase. KB continua
desconectada. `set-ai-enabled` só foi usado na mesma conversa de teste
dormente já autorizada em fases anteriores, sempre restaurado e
confirmado ao final.**

---

## 1-3. Experimento A — resultado

Conversa usada: `cmtatdbeh0eokvyqtbfxv6bz2` (mesma conversa dormente,
allowlist, `isTeste=true`, sem humano, sem orçamento/produção, já
verificada em fases anteriores).

Sequência real executada:
1. `set-ai-enabled(false)` → confirmado via GET (`isAiEnabled: false`)
   às 20:31:19.628Z, **antes** de qualquer mensagem ser enviada.
2. Gabriel enviou "Teste experimento A" pelo WhatsApp real.
3. Mensagem chegou (nativo ChatVolt): `createdAt = 2026-09-20T20:35:33.288Z`.

**Achado inesperado #1**: apesar de `isAiEnabled=false` confirmado
ANTES do envio, **uma resposta automática foi enviada mesmo assim**:
`"Olá! Seja bem-vindo a VR Marcas, Que bom receber seu contato..."`,
`createdAt = 2026-09-20T20:35:34.000Z` — **0,712s** depois da mensagem
do cliente. Reconferido via GET logo depois: `isAiEnabled` continuava
`false` no momento da resposta e continuou `false` depois dela — ou
seja, **essa resposta não veio do agente LLM principal** (que
`set-ai-enabled` controla), veio de algum outro fluxo automatizado do
ChatVolt (provavelmente uma mensagem de boas-vindas/primeira interação,
não documentada como distinta do "agente" na API, mas
comportamentalmente independente do toggle `isAiEnabled`).

**inboundNotificationDelay** (nosso webhook vs `createdAt` nativo da
mensagem do cliente, usando `valeria_api_log.ts` como ponto mais próximo
do ingresso HTTP real):

```
nosso webhook (USER_MESSAGE_RECEIVED): 2026-09-20T20:35:37.531Z
mensagem nativa (ChatVolt):             2026-09-20T20:35:33.288Z
inboundNotificationDelay ≈ 4.243s
```

**Isto é o achado decisivo da fase**: mesmo com a IA desabilitada
(portanto SEM nenhum processamento de LLM em andamento), nosso webhook
ainda chegou **~4,2 segundos depois** da mensagem ter sido de fato
recebida pelo ChatVolt. Isso prova que o atraso do webhook **não é
causado pelo tempo de geração da resposta da IA** — é uma
característica própria do mecanismo de push do ChatVolt, presente
independentemente do estado da IA.

**Confirmação adicional (não destrutiva, incidental)**: reativei
`set-ai-enabled(true)` ao final (restauração exigida pelo experimento) e
aguardei — **nenhuma resposta nova foi gerada** para a mensagem "Teste
experimento A" já existente. Isso responde à pergunta do item 6A
("reativar AI faz o agente processar a mensagem anterior
automaticamente?"): **não, não processou retroativamente**, pelo menos
neste caso observado.

Estado final confirmado: `isAiEnabled=true` (original), restaurado e
reconfirmado via GET.

## Critério do item 3 (aplicado)

> "Se o webhook continuar chegando vários segundos atrasado mesmo com
> AI=false: considerar esse webhook inadequado para orquestração em
> tempo real."

**Confirmado — o webhook continuou atrasado (~4,2s) mesmo com AI=false.
`valeriaWebhookChatvolt` é inadequado como gatilho de orquestração em
tempo real, independentemente do estado da IA.** Isso é mais forte que
o achado da Fase M.1 (que já mostrava atraso de +2,2 a +9,2s com IA
ligada) — agora sabemos que o atraso não é efeito colateral do tempo de
resposta da IA, é uma propriedade própria da entrega do webhook.

---

## 4. Mapa real do provedor WhatsApp

Confirmado por auditoria de código (read-only, `functions/` e
`functions-valeria/`):

```
WhatsApp (Meta) → ChatVolt (Embedded Signup — "handles everything
                    automatically", conforme doc oficial)
                     │
                     ├─ decide e gera resposta internamente
                     ├─ envia resposta ao cliente diretamente
                     │
                     └─ [push assíncrono, ~4-9s de atraso, PÓS-FATO]
                          → valeriaWebhookChatvolt (nosso único receptor)
```

- **Não existe nenhuma integração direta nossa** com Meta WhatsApp Cloud
  API, Z-API ou Zapper no código (`functions/src/`,
  `functions-valeria/src/`) — buscas por `Z-API`, `graph.facebook.com`
  (mensagens, distinto do Meta Ads), `WABA`, `verify_token` não
  encontraram nada.
- `functions/src/chatvolt_provider.ts` é **100% outbound** (nós →
  ChatVolt, via `POST /agents/{id}/query`) — não recebe nada do
  WhatsApp.
- **100% do tráfego de WhatsApp vai Meta → ChatVolt sem nenhum
  intermediário nosso.** O único ponto em que nosso código vê qualquer
  coisa é o push pós-fato do próprio ChatVolt.

## 5. Existência de webhook upstream (provedor)

**Não existe hoje.** Construí-lo do zero significaria: (a) desconectar
o número do Embedded Signup atual e reconfigurar como integração direta
Meta Cloud API (ou Z-API), OU (b) rodar em paralelo — mas a Embedded
Signup do ChatVolt, segundo a própria doc oficial, "handles everything
automatically" sem webhook configurável, então não há como "escutar
também" sem tirar o controle do ChatVolt. Ou seja: um webhook direto do
provedor **hoje excluiria o uso do ChatVolt para esse número**, não
coexistiria com ele. Isso é uma mudança de infraestrutura muito maior
que um "gate" — é trocar a plataforma de canal.

## 6. Capacidades do ChatVolt para disparar o agente sob demanda

Confirmado, via documentação oficial (`docs.chatvolt.ai`), sem inventar:

- **Não existe nenhum mecanismo de pre-processing/workflow/router antes
  do agente responder** — confirmado tanto na auditoria da Fase E.2.4
  quanto revisitado agora na página `/agent/tools` (catálogo completo
  de Tools: Datastore, Request Human, Mark as Resolved, HTTP Tool,
  Delayed Responses, Follow-up Messages — nenhuma é um roteador/gate).
- **A. Reativar AI processa mensagem pendente automaticamente?**
  **Não** — confirmado empiricamente no Experimento A (ver acima).
- **B. Existe endpoint para solicitar uma resposta do agente?** **Sim**
  — `POST /agents/{id}/query` ("Agent Query"), aceita `conversationId`
  existente, `systemPrompt`/`modelName`/`temperature` por chamada,
  retorna `{answer, conversationId, messageId, sources, ...}`.
- **C. Existe endpoint para injetar mensagem e disparar o agente?**
  Mesmo endpoint do item B — ele já injeta (`query`) e gera
  (`answer`) numa única chamada.
- **D. Só existe `send-message`, sem geração?** **Não** — `send-message`
  (`POST /conversation/message/{type}/{value}`) é para enviar TEXTO
  JÁ PRONTO (marcado como `from: human`), distinto de `Agent Query`
  (que GERA o texto via LLM). São capacidades **separadas e
  compostas**: gerar (Agent Query) ≠ enviar (Send Message) ≠ reativar
  auto-reply (`set-ai-enabled`).

**Ponto de atenção não confirmado (não testado, para não ser
destrutivo)**: a documentação do Make ("Ask an Agent Module") sugere
que `Agent Query` é pensado para canais **externos ao WhatsApp nativo**
("If you want to use Chatvolt to respond to WhatsApp messages, follow
the WhatsApp Integration Guide **separately**") — ou seja, é plausível
(mas não 100% confirmado sem um teste real) que chamar `Agent Query`
sobre um `conversationId` de WhatsApp gere a resposta e a devolva PARA
NÓS, sem reenviá-la automaticamente ao cliente pelo WhatsApp — o que
seria bom (controle total), mas precisaria de um teste dedicado e
autorizado à parte para confirmar, já que enviar uma resposta em
duplicidade seria um efeito colateral real.

## 7. Resposta à pergunta crítica (seção 6 do pedido)

> "AI OFF → COMMERCIAL_INTENT → como a ValerIA responderia?"

Com base no que foi confirmado: o backend chamaria `Agent Query`
(`POST /agents/{id}/query`, com o `conversationId` real e o texto do
cliente) para gerar a resposta usando o motor da ValerIA (LLM + Tools +
RAG do ChatVolt), e então **precisaria enviar essa resposta
explicitamente** via `send-message` (não é automático) — mantendo
`isAiEnabled=false` o tempo todo, exceto se decidirmos reabilitar por
outro motivo. Isso é tecnicamente viável pela API, mas com duas
ressalvas que travam a decisão final: (1) o comportamento de
auto-envio do `Agent Query` sobre uma conversa WhatsApp real não foi
confirmado com um teste dedicado (ver item 6 acima); (2) mesmo que
funcione, **o inboundNotificationDelay de ~4,2s continua existindo**
para o CAMINHO EXPLORATORY também, então a resposta do backend sempre
chegaria pelo menos ~4-9s mais tarde que uma resposta síncrona teria
chegado — isso é aceitável para uma resposta assíncrona bem projetada,
mas é uma restrição de UX a assumir conscientemente, não uma
"interceptação em tempo real".

---

## 8. Comparação ARCH 1-5

### ARCH 1 — ChatVolt AI sempre ON, gate reativo
**Descartada.** Não existe ingress pré-agent (confirmado Fase E.2.4 +
E.2.5). O único webhook disponível chega ~2-9s DEPOIS da resposta já
enviada (Fase M.1) — não há nada para "interceptar".

### ARCH 2 — ChatVolt AI sempre OFF, backend responde tudo
**Descartada nesta forma.** Pressupõe "backend recebe inbound rápido" —
**refutado empiricamente pelo Experimento A**: mesmo com AI=false, o
webhook de entrada chegou ~4,2s atrasado. Além disso, existe pelo menos
um fluxo de resposta automática (mensagem de boas-vindas) que **não é
desligado por `isAiEnabled=false`** — "AI OFF" não significa silêncio
garantido, é uma premissa falsa nesta arquitetura.

### ARCH 3 — ChatVolt AI sempre OFF, backend classifica, EXPLORATORY respondido pelo backend, COMMERCIAL_INTENT dispara ValerIA sob demanda
**Tecnicamente possível, mas não em tempo real** — herda o mesmo atraso
de ~4-9s do webhook para QUALQUER caminho (não é mais rápido para
EXPLORATORY que para COMMERCIAL_INTENT, já que ambos dependem do mesmo
webhook de entrada). Também herda o risco do fluxo de boas-vindas não
controlado por `isAiEnabled` (precisaria ser investigado/desligado à
parte). Viável como arquitetura **assíncrona** (responder em alguns
segundos, não instantaneamente), não como gate de baixa latência.
Depende de confirmar o comportamento do `Agent Query` sobre
`conversationId` de WhatsApp (item 6, ressalva).

### ARCH 4 — Webhook direto do provedor WhatsApp, classificador backend, controla ChatVolt antes do auto-reply
**Não existe hoje e não é uma adição incremental** — exigiria abrir mão
da Embedded Signup atual do ChatVolt para esse número (a doc oficial
confirma que ela administra tudo automaticamente, sem webhook
configurável em paralelo). Seria, na prática, reconstruir a integração
WhatsApp do zero (Meta Cloud API ou Z-API diretamente), perdendo Inbox
nativo do ChatVolt, handoff humano nativo, histórico unificado, etc. —
mudança de infraestrutura de outra ordem de grandeza, não um ajuste de
arquitetura da ValerIA.

### ARCH 5 — Migrar só a orquestração/inteligência para backend próprio, ChatVolt como canal/UI/handoff
Variante mais moderada de ARCH 4: manteria o WhatsApp conectado ao
ChatVolt (Embedded Signup intacto), mas usaria `set-ai-enabled=false`
permanentemente + `Agent Query`/lógica própria para gerar respostas,
com `send-message` para entregar. Sofre da MESMA limitação de latência
de ~4-9s no ingresso (não resolve o problema de "tempo real"), mas não
depende de reconstruir a integração WhatsApp — é essencially a ARCH 3
com o entendimento explícito de que "backend responde tudo" (não seria
mais EXPLORATORY-only). Mais simples de operar que ARCH 4, mesma
limitação estrutural de latência que ARCH 2/3.

### Tabela resumo

| Arquitetura | Existe hoje? | Determinismo | Latência real | Risco de dupla resposta | Mudança de infra | Viabilidade |
|---|---|---|---|---|---|---|
| 1 — gate reativo | Não | — | — | — | Nenhuma | Descartada |
| 2 — AI sempre OFF, backend tudo | Parcial (API existe) | Baixo (AI OFF não é silêncio garantido) | ~4-9s | Alto (fluxo de boas-vindas não controlado) | Nenhuma | Descartada nesta forma |
| 3 — AI OFF + classificador + Agent Query sob demanda | Parcial | Médio (assíncrono, não tempo real) | ~4-9s | Médio (depende de confirmar Agent Query) | Nenhuma | Possível como assíncrono, não como gate |
| 4 — webhook direto do provedor | Não existe | Alto, em tese | Baixa, em tese | Baixo, em tese | Altíssima (reconstruir integração) | Fora de escopo desta fase |
| 5 — orquestração própria, ChatVolt só canal | Parcial | Médio | ~4-9s | Médio | Baixa-média | Melhor opção realista, ainda limitada por latência |

---

## 9. Arquitetura recomendada (só como direção, sem implementar)

Nenhuma das opções entrega um "gate preventivo em tempo real" com a
infraestrutura atual do ChatVolt — essa ambição específica (interceptar
ANTES da resposta, em milissegundos) está descartada com boa confiança
depois de duas fases de medição (M.1 e E.2.5). A direção mais realista,
SE o Gabriel quiser seguir adiante, é uma variante de **ARCH 5**:
aceitar que qualquer resposta do backend chega de forma **assíncrona**
(alguns segundos depois, como um "handoff silencioso" em vez de uma
interceptação instantânea), desligar a IA nativa permanentemente
(depois de entender e neutralizar o fluxo de boas-vindas não controlado
por `isAiEnabled`), e usar `Agent Query` + `send-message` para toda
resposta — o que devolveria controle total sobre EXPLORATORY vs
COMMERCIAL_INTENT, ao custo de abrir mão da resposta "instantânea" que
a IA nativa do ChatVolt dá hoje.

Isso é uma mudança de arquitetura bem maior que um "gate" pontual — é
essencialmente assumir toda a orquestração de resposta, usando o
ChatVolt só como canal/API de WhatsApp + Inbox. Não é uma decisão para
tomar nesta fase; fica registrada como a única direção tecnicamente
sustentada pelos dados coletados até agora.

---

## 10-11. Nenhum rollout / feature flag final

Confirmado: nenhuma mudança de código, prompt, Tools, whitelist,
modelo ou webhook foi feita. `set-ai-enabled` foi usado só na conversa
de teste dormente pré-autorizada, restaurado e confirmado
(`isAiEnabled=true`, estado original). `data.valeriaV2Enabled`
permanece **`false`**.
