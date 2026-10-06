# Chamado ao suporte ChatVolt — mensagem automática mesmo com isAiEnabled=false

**Data:** 20/09/2026
**Conta:** gabrieelborges8@gmail.com
**Agente:** Valéria
**Canal:** WhatsApp Official (Embedded Signup)

## Resumo

Desabilitamos a IA de uma conversa específica via
`POST /conversations/{conversationId}/set-ai-enabled` (`{"enabled": false}`)
e confirmamos via `GET /conversation/{conversationId}` que `isAiEnabled`
ficou `false` **antes** de qualquer mensagem chegar. Mesmo assim, o
cliente recebeu uma resposta automática poucos segundos depois — que não
veio do agente principal (o toggle continuou `false` durante e depois
dessa resposta).

## Evidência detalhada

- `isAiEnabled=false` confirmado via GET às **2026-09-20T20:31:19.628Z**,
  antes de qualquer mensagem nova nessa conversa.
- Mensagem do cliente: **"Teste experimento A"**,
  `createdAt = 2026-09-20T20:35:33.288Z` (confirmado via
  `GET /conversation/{id}/messages/{count}`).
- Resposta automática recebida:
  **"Olá! Seja bem-vindo a VR Marcas, Que bom receber seu contato..."**,
  `createdAt = 2026-09-20T20:35:34.000Z` — **~0,7 segundos** depois da
  mensagem do cliente.
- `GET /conversation/{conversationId}` logo depois: `isAiEnabled`
  continuava `false` — ou seja, essa resposta não passou pelo toggle que
  controla o agente principal.
- O mesmo texto de boas-vindas já havia aparecido, de forma idêntica, em
  uma conversa completamente diferente, em teste anterior no mesmo dia —
  sugerindo um texto padrão/template, não uma geração de LLM.

## O que já auditamos (para não repetirmos pergunta já respondida por nós mesmos)

Nas configurações do agente Valéria, verificamos e não encontramos
nenhuma opção relacionada a essa mensagem em:
- **Geral & Flux** (Dados do Agente, Mensagens rápidas — vazio,
  Integração Flux CRM — Cenário/Etapa Padrão não configurados);
- **Segurança** (nenhum toggle de mensagem automática);
- **Modelo → Avançadas** (Horário de Inatividade está desligado).

## Perguntas para o suporte

1. Que mecanismo gera mensagens automáticas mesmo quando
   `isAiEnabled=false`?
2. Onde essa automação é configurada (nível de agente, canal ou conta)?
3. Existe uma forma suportada de deixar uma conversa/canal completamente
   silencioso quando `isAiEnabled=false`, sem nenhuma mensagem
   automática?
4. Existe uma mensagem de welcome/first-contact/channel automation fora
   da configuração visível nas telas do agente que listamos acima?
5. É possível desativar essa automação apenas para este agente/canal,
   sem quebrar a integração WhatsApp existente (Embedded Signup)?

Nenhum dado sensível (token, secret, credencial) está incluído neste
chamado.

---

## ATUALIZAÇÃO — 2026-09-24 — reocorrência confirmada, ocorrência #2

O mesmo comportamento se repetiu, em **outra conversa**, 4 dias depois,
durante um piloto controlado de um agente próprio (backend nosso, fora
do agente "Valéria" do ChatVolt) que responde via API de envio direto.

### Nova evidência

- **Conversa**: `cmt95yjqa0dksuvqt63to9tbm`.
- **Mensagem do cliente** (`from:"human"`): `id=cmuex2voy0p4bt9qp2wce4fy1`,
  texto "Vocês fazem peças sob medida?", `createdAt=2026-09-24T02:32:48.387Z`.
- **Mensagem automática recebida** (`from:"agent"`):
  `id=cmuex2xe40p4ct9qp79sc0ea3`, texto idêntico ao já reportado
  ("Olá! Seja bem-vindo a VR Marcas, Que bom receber seu contato!..."),
  `createdAt=2026-09-24T02:32:49.000Z` — **0,613s** depois da mensagem
  do cliente (mesma ordem de grandeza dos 0,712s já registrados em
  20/09).
- `isAiEnabled` confirmado `false` via `GET /conversations/{id}` antes,
  durante e depois desse envio (nossa própria automação interna também
  garante isso desde antes da mensagem chegar).
- **Nossa própria resposta real** (via API de envio direto, backend
  próprio, não o agente principal do ChatVolt):
  `id=cmuex33te0p4dt9qp5ti6cqo6`, "Sim, fazemos peças sob medida.",
  `createdAt=2026-09-24T02:32:58.907Z` — chegou **depois** da mensagem
  automática, então o cliente recebeu 2 respostas para 1 pergunta.

### Campos correlacionados entre as duas ocorrências (20/09 e 24/09)

| Campo | 20/09 (`cmua9zxn42tc4vzqpd6rwejl4`) | 24/09 (`cmuex2xe40p4ct9qp79sc0ea3`) |
|---|---|---|
| `agentId` | `cmmmkciwb02j8lcxudbnwv31y` | `cmmmkciwb02j8lcxudbnwv31y` (idêntico) |
| `contactId` | preenchido (`cmta9g9gm016wr2gb7nn6no8f`) | preenchido (`cmt95yjq00ag6rfmvag2sx5ie`) — sempre presente, nunca null |
| `sources` | `[]` | `[]` (idêntico — array vazio, nunca `null`) |
| Delay após inbound | 0,712s | 0,613s (mesma ordem de grandeza) |
| Texto | idêntico (início) | idêntico (início) |

Para comparação: nossas PRÓPRIAS mensagens (enviadas via API de envio
direto, sem passar pelo pipeline do agente) sempre têm `contactId:null`
e `sources:null` — nunca `[]`. Isso sugere fortemente que a mensagem
automática passa pelo MESMO pipeline interno de resposta do agente
"Valéria" (que popula `sources` mesmo vazio, e associa `contactId`),
mas de alguma forma **ignora o toggle `isAiEnabled`**.

### O que já verificamos via API nesta atualização (sem sucesso em achar a config)

- `GET /agents/{agentId}` — nenhum campo relacionado a
  welcome/greeting/first-message/auto-reply em nenhuma das chaves
  retornadas (`quickMessages: null`, `interfaceConfig: {}`,
  `enableInactiveHours: false`, `inactiveHours: {}`,
  `createNewConversationOnResolved: false`).
- `tools` do agente: só 4 configurados — `request_human`, 2 tools HTTP
  próprias (`valeriaGetCatalog`, `valeriaUpdateCatalogQualification`),
  e um `delayed_responses` (`delay: 10`) — nenhum deles é, pelo nome ou
  config, uma mensagem de boas-vindas.
- `GET /channels`, `/channel-credentials`, `/automations`, `/workflows`
  — todos retornam `404` com esta API key (não existem/não expostos).

**Conclusão**: com o acesso disponível (API key do agente), não existe
nenhum endpoint que exponha a automação responsável. A causa raiz só
pode ser identificada/desativada pelo suporte do ChatVolt ou por acesso
direto ao painel (Geral & Flux / Segurança / Modelo → Avançadas já
foram auditados em 20/09, sem achado).

### Perguntas atualizadas para o suporte

1. Qual configuração dispara essa mensagem automática (mesmo texto, duas
   conversas diferentes, mesmo `agentId`, delay sub-segundo)?
2. Onde ela é configurada — nível de agente, canal (WhatsApp) ou conta?
3. Por que ela ignora `isAiEnabled=false`, mesmo quando esse valor é
   confirmado `false` antes da mensagem do cliente chegar?
4. Existe uma automação de greeting/welcome/contact-trigger
   estruturalmente separada do "agente"/IA principal? O padrão
   `contactId` sempre preenchido e `sources:[]` sugere um pipeline
   interno específico — é isso mesmo?
5. Existe um endpoint de API para desativar essa automação
   especificamente, sem desconectar a integração WhatsApp (Embedded
   Signup) já em uso?
