# VALERIA 2.0 — Fase E.2.4 — Desenho do gate determinístico EXPLORATORY × COMMERCIAL_INTENT

**Status: SOMENTE DESENHO. Nenhum código foi alterado. Nenhuma configuração do
ChatVolt foi alterada. `data.valeriaV2Enabled` permanece `false`. Modelo
permanece GPT-4.1 Mini. Prompt permanece congelado (7519 caracteres, últimas
2 edições da Fase E.2.3). KB "🧠 Valéria — Conhecimento Validado" permanece
DESCONECTADA do agente.**

Gatilho: bateria de 6 testes (Fase E.2.3) mostrou que mesmo com KB
desconectada, modelo GPT-4.1 Mini e prompt com regra binária explícita
("responda e pare"), a pergunta exploratória "Vocês fazem peça sob medida?"
ainda recebeu "Sim, fazemos peças sob medida. Pode me passar os detalhes
técnicos do que você precisa?" — uma pergunta de acompanhamento indevida.
Conclusão: prompt engineering sozinho não é suficientemente determinístico
para esta regra. Precisamos de um gate estrutural.

---

## 1-2. Objetivo e exemplos

(Conforme especificado pelo Gabriel — não repetido aqui; ver mensagem
original. Resumo: separar toda mensagem recebida em `EXPLORATORY` ou
`COMMERCIAL_INTENT` antes de qualquer qualificação/Tool/orçamento. A simples
menção de produto/material NÃO implica intenção comercial.)

---

## 5. Fluxo real de entrada e saída — mapeado a partir do código

```
Cliente (WhatsApp)
   │
   ▼
Meta WhatsApp Business Platform (Embedded Signup — 1 número por agente)
   │
   ▼
ChatVolt (plataforma) ─── recebe a mensagem, decide sozinho responder
   │                       automaticamente (function-calling do LLM,
   │                       Tools registradas no agente, RAG na KB se
   │                       conectada) — TUDO interno ao ChatVolt.
   │
   ├──▶ [push assíncrono, pós-fato] webhook valeriaWebhookChatvolt
   │        (nosso backend, Cloud Function)
   │        - USER_MESSAGE_RECEIVED chega ANTES de o ChatVolt already
   │          ter respondido (é a mensagem de entrada, ainda "crua")
   │        - AGENT_USER_MESSAGE / AGENT_MESSAGE_SENDED / FOLLOW_UP /
   │          BLOCKED / NOTED chegam DEPOIS — o ChatVolt já gerou e,
   │          no caso de SENDED, já ENVIOU a resposta ao cliente antes
   │          de disparar o evento.
   │        - Handler responde <5s: valida → persiste evento bruto →
   │          (se allowlist de teste) roda detecção de identidade/
   │          confirmação/complexidade/handoff, tudo GRAVANDO ESTADO
   │          NO FIRESTORE para leitura em um turno FUTURO.
   │        - NÃO existe, em nenhum ponto, uma chamada de volta ao
   │          ChatVolt para vetar/editar a mensagem que já foi (ou
   │          está sendo) enviada.
   │
   ├──▶ (durante a geração, function-calling) Tools HTTP:
   │        valeriaGetCatalog / valeriaUpdateCatalogQualification
   │        - Chamadas SOMENTE se o LLM decidir chamá-las, na ordem
   │          que o LLM decidir, ou NUNCA. Hoje nem estão registradas
   │          como Tool ativa no agente real (pendente de checkpoint
   │          separado). Não há enforcement de que rodem antes do
   │          texto de resposta ser formulado.
   │
   ▼
Resposta enviada ao cliente pelo próprio ChatVolt (fora do nosso controle
direto — a menos que a IA da conversa esteja desabilitada via API, ver
seção 6).
```

### Quem controla cada etapa, e se conseguimos interceptar

| Etapa | Quem controla | Ocorre antes/depois da resposta ao cliente | Conseguimos bloquear/modificar? |
|---|---|---|---|
| Recepção da mensagem WhatsApp | Meta + ChatVolt | evento de origem | Não — é o ChatVolt que recebe via Embedded Signup |
| Decisão de responder automaticamente | ChatVolt (motor interno do agente) | é o próprio ato de responder | Não diretamente — só via `set-ai-enabled=false` ANTES disso acontecer (ver seção 6/9) |
| Geração da resposta (LLM + Tools + RAG) | ChatVolt | antes do envio | Não — acontece dentro do ChatVolt, não é exposta como um passo intermediário interceptável |
| Envio da resposta ao cliente | ChatVolt (WhatsApp Business Platform) | é o evento de saída | Não, uma vez que a IA gerou e decidiu enviar |
| `USER_MESSAGE_RECEIVED` → nosso webhook | ChatVolt → nosso backend | **antes** da resposta (mensagem crua) | Recebemos, mas não temos garantia documentada de que temos uma janela de tempo útil antes do ChatVolt responder — ver seção 7 |
| `AGENT_MESSAGE_SENDED` → nosso webhook | ChatVolt → nosso backend | **depois** do envio | Só observamos, não bloqueamos (já foi enviado) |
| Tools HTTP (`valeriaGetCatalog`, `valeriaUpdateCatalogQualification`) | Decisão do LLM (function-calling) | durante a geração, se o LLM decidir chamar | Não force determinístico — o LLM pode não chamar, chamar fora de ordem, ou chamar depois de já ter formulado texto |

---

## 6. Recursos reais do ChatVolt (auditoria só-leitura da documentação oficial em docs.chatvolt.ai)

Confirmado que EXISTEM (com endpoint real documentado):

- **`POST /conversations/{conversationId}/set-ai-enabled`** — liga/desliga a
  IA automática para UMA conversa específica (`{enabled: true|false}`).
  Existe também o equivalente manual para humanos dentro do WhatsApp
  Business App: comandos de texto `#off` / `#on` / `#resolve` ao final de
  uma mensagem enviada pelo operador.
- **`POST /conversation/message/{type}/{value}`** ("Send Message by
  Channel") — envia uma mensagem para o cliente via um canal
  (`whatsapp` incluso), identificando a conversa por `conversationId`,
  `phone` ou `email`. A mensagem enviada é marcada como `"from": "human"`
  — ou seja, é literalmente uma "escrita manual/operador", não uma
  chamada ao LLM.
- **`POST /conversations/{conversationId}/message-register`** — registra
  uma mensagem/evento no CONTEXTO da conversa **sem enviá-la** ao
  cliente. Útil para auditoria/rastreabilidade, não para responder.
- **`POST /agents/{id}/query`** — chama o agente (LLM + Tools + RAG)
  programaticamente, aceitando overrides por chamada: `systemPrompt`,
  `modelName`, `temperature`, `filters.datasource_ids` (permite restringir
  a KB usada NESSA chamada), `context` (objeto livre), `callbackURL`
  (processamento assíncrono). Isso é uma chamada SÍNCRONA feita por NÓS —
  não é o mecanismo que o ChatVolt usa internamente para responder
  mensagens de WhatsApp recebidas (essas são tratadas 100% internamente,
  conforme o guia de integração: "No webhook configuration is required.
  Chatvolt handles everything automatically").
- **`PATCH /agents/{id}`** ("Update Agent") — atualiza `systemPrompt`,
  `modelName`, `tools`, `temperature` do agente **como um todo** (afeta
  TODAS as conversas dali em diante, não é por-conversa). Não existe
  campo para "prompt ativo desta conversa" — é global ao agente.
- **`PATCH /agents/{id}/webhook`** — liga/desliga o webhook por canal
  (`whatsapp`, `telegram`, `zapi`, `instagram`) — é on/off por canal, não
  um gate condicional por mensagem.
- Endpoints adicionais de conversa confirmados: `assign` (atribuir a um
  humano), `set-priority`, `update-status`, `get-messages`,
  `get-conversation-by-id`, `get/create/update/delete custom variable`
  (variáveis por conversa — poderiam guardar `interactionMode` como
  metadado, mas isso é só armazenamento, não afeta o comportamento do
  LLM automaticamente), notas internas.
- **WhatsApp WhiteList** / **Agent Blacklist** — existem como conceitos
  nativos do ChatVolt (números autorizados/bloqueados a interagir com o
  agente), mas são estáticos (config, não por-mensagem) — não são um
  mecanismo de roteamento condicional por intenção.

Confirmado que **NÃO existe** (nada encontrado na documentação oficial,
mesmo revisando Agents, Conversations, Contacts, Integrations, Webhooks):

- pre-processing / intent routing / conditional routing antes do LLM
  responder;
- classifier nativo;
- workflow/automação condicional embutida no ChatVolt antes do agente
  responder (o único "workflow" documentado é a integração com **Make**
  — automação externa via Make.com/Zapier-like —, mas não há evidência de
  que ChatVolt dispara um webhook para Make/terceiros ANTES de o próprio
  agente responder automaticamente; a documentação da integração
  WhatsApp diz explicitamente que a resposta automática é decidida e
  enviada pelo próprio ChatVolt sem passo intermediário configurável);
- mandatory tool (forçar que uma Tool específica rode sempre antes da
  resposta);
- pre-response webhook / response validator / output guard / middleware
  no caminho crítico da resposta;
- structured output obrigatório imposto pelo ChatVolt (é uma decisão do
  prompt/modelo, não uma imposição de schema pela plataforma);
- múltiplos agentes/rotas dentro de UMA MESMA conversa/número de WhatsApp
  (o vínculo é 1 número de WhatsApp = 1 agente, definido no Deploy);
- conditional prompt nativo (o `PATCH /agents/{id}` troca o prompt do
  agente inteiro, não é condicional por mensagem).

**Conclusão da seção 6**: o ChatVolt não tem, hoje, nenhum ponto de
interceptação SÍNCRONA embutido entre "mensagem chegou" e "IA respondeu"
que possamos configurar. O único jeito de interceptar é via API,
DESABILITANDO a IA da conversa antes que ela responda — o que depende de
uma corrida (race) contra o próprio ChatVolt.

---

## 7. Auditoria do webhook atual — timeline real

- `USER_MESSAGE_RECEIVED`: confirmado no código (`webhook.ts`) que chega
  ANTES de qualquer resposta — é literalmente o evento de "mensagem do
  cliente chegou". Isso é necessário para popular `mensagemCliente` no
  payload.
- `AGENT_MESSAGE_SENDED`: confirmado que chega DEPOIS — é a confirmação
  de que o ChatVolt já enviou a resposta ao cliente.
- **Não existe, na documentação nem no código, nenhum evento
  "intermediário"** entre os dois (ex.: "IA está prestes a responder,
  você tem N segundos para vetar"). A lista completa de eventos
  suportados é: `USER_MESSAGE_RECEIVED`, `AGENT_USER_MESSAGE`,
  `AGENT_MESSAGE_SENDED`, `AGENT_MESSAGE_FOLLOW_UP`,
  `AGENT_MESSAGE_BLOCKED`, `AGENT_MESSAGE_NOTED`.
- **Podemos responder nós mesmos via API sem deixar o agente responder?**
  Tecnicamente sim, SE conseguirmos chamar `set-ai-enabled(false)` antes
  de o ChatVolt terminar de gerar/enviar a resposta automática. Isso
  exige que `USER_MESSAGE_RECEIVED` chegue ao nosso webhook, e que nosso
  handler responda com `set-ai-enabled(false)` **mais rápido que o tempo
  que o ChatVolt leva para gerar+enviar a resposta automática**. A
  documentação não garante nenhuma ordem/latência relativa entre "webhook
  nos avisa" e "IA já respondeu" — isso teria que ser MEDIDO
  empiricamente (não fizemos isso ainda, é fora do escopo desta fase
  "não implementar"). É uma corrida, não uma garantia.
- **Risco de resposta dupla**: real e não-trivial. Se perdermos a corrida
  (ChatVolt já respondeu automaticamente antes de recebermos/
  processarmos `USER_MESSAGE_RECEIVED`) e mesmo assim enviarmos uma
  resposta nossa via `send-message`, o cliente recebe DUAS respostas. Se
  desabilitarmos a IA tarde demais, a IA pode já ter chamado Tools
  (efeitos colaterais) mesmo sem ainda ter enviado texto. Não há, na API
  documentada, nenhum "lock"/"transação" que garanta atomicidade entre
  "verificar se IA já respondeu" e "decidir se eu respondo".

---

## 8. Auditoria da API do ChatVolt (sem executar nada, sem expor credenciais)

Resumo direto às perguntas do Gabriel:

| Capacidade pedida | Existe via API? | Endpoint |
|---|---|---|
| Pausar IA por conversa | **Sim** | `POST /conversations/{id}/set-ai-enabled` |
| Gerar mensagem sem enviar | **Sim** (registra no contexto, não envia) | `POST /conversations/{id}/message-register` |
| Enviar mensagem manualmente | **Sim** (marcada como `from: human`) | `POST /conversation/message/{type}/{value}` |
| Mudar agent/prompt por conversa | **Não** — só existe update do agente INTEIRO (`PATCH /agents/{id}`), afeta todas as conversas, sem escopo por-conversa | `PATCH /agents/{id}` |
| Aplicar tag/estado antes da resposta | **Parcial** — dá para gravar uma "custom variable" por conversa a qualquer momento, mas isso não influencia automaticamente o comportamento da IA (é só armazenamento consultável) | `POST /conversations/{id}/variables` |
| Escolher agente por condição | **Não** — 1 número de WhatsApp está vinculado a 1 agente fixo (Deploy); não há roteamento condicional documentado entre agentes na mesma conversa | — |
| Bloquear resposta automática | **Sim, mas só via `set-ai-enabled(false)`, sujeito à corrida da seção 7** | `POST /conversations/{id}/set-ai-enabled` |

---

## 9. Comparação das opções arquiteturais (A-E)

### A. Gate dentro do próprio ChatVolt antes do LLM
**Não existe esse mecanismo na plataforma** (seção 6). Não é possível
implementar hoje sem que o ChatVolt lance um recurso novo (pre-processing
hook). **Descartada** — não é uma opção real, é uma funcionalidade
inexistente.

### B. Roteamento para dois agentes/prompts (ValerIA Informativa / ValerIA Comercial)
- É possível criar 2 agentes na plataforma, cada um com prompt fixo e
  Tools próprias.
- **Problema estrutural**: 1 número de WhatsApp = 1 agente (vínculo fixo
  no Deploy). Não há "trocar de agente no meio da conversa" documentado
  via API. A única forma de "rotear" seria: (i) ter dois NÚMEROS de
  WhatsApp diferentes (inviável — o cliente já tem um número único
  divulgado), ou (ii) usar `PATCH /agents/{id}` para sobrescrever o
  prompt do agente ÚNICO antes de cada resposta — mas isso é GLOBAL
  (afeta simultaneamente todas as conversas em andamento), criando uma
  condição de corrida entre clientes diferentes conversando ao mesmo
  tempo. **Não é determinística nem segura em produção.**
- Determinismo: baixo (na prática, ainda dependeria do LLM entender o
  prompt certo). Risco de resposta dupla: baixo (não envolve
  desabilitar/reabilitar IA). Latência: não aplicável (não funciona).
- **Descartada** como está — a arquitetura de 1 agente por número
  inviabiliza roteamento limpo entre dois agentes persistentes.

### C. Classificador backend + variável/contexto obrigatória para o agente
- Fluxo: `USER_MESSAGE_RECEIVED` → nosso backend classifica
  (determinística ou modelo leve) → grava `interactionMode` como custom
  variable da conversa via API → conta com o PROMPT já instruído a
  "checar a variável X e obedecer".
- **Problema**: "gravar uma variável" não impede/obriga nada por si só —
  o LLM só vê essa variável se ela for injetada no contexto da próxima
  chamada, e quem decide se o texto de instrução é obedecido continua
  sendo o próprio LLM (mesma classe de problema que já falhou: "seguir
  uma frase no prompt"). Não resolve o problema raiz.
- Determinismo: baixo-médio (mesma fragilidade do prompt engineering
  atual, só que motivado por uma variável em vez de uma regra estática).
- **Descartada como solução única** — mas o classificador em si (a
  PARTE que decide EXPLORATORY vs COMMERCIAL_INTENT) é reaproveitável
  pelas opções D/E.

### D. Backend assume respostas EXPLORATORY; ChatVolt só responde COMMERCIAL_INTENT
- Fluxo: `USER_MESSAGE_RECEIVED` chega no webhook → backend classifica
  IMEDIATAMENTE (regra determinística, ver seção 11) → se
  `EXPLORATORY`: chama `set-ai-enabled(false)` + responde com
  `send-message` (texto canônico/curto, sem chamar LLM nenhum, ou
  opcionalmente via `agents/{id}/query` com um `systemPrompt` restrito
  só-para-perguntas-informativas) → se `COMMERCIAL_INTENT`: NÃO faz
  nada, deixa o `set-ai-enabled` como está (ligado) e o ChatVolt responde
  normalmente com o fluxo atual (Tools, catálogo, etc).
- **É a única opção que remove o LLM de dentro do WhatsApp da decisão
  crítica** ("responder e parar" vira uma regra de código, não uma
  instrução de prompt) — determinismo real para o caso EXPLORATORY.
- **Risco central**: a corrida da seção 7. Se o backend não vencer a
  corrida (processar + `set-ai-enabled(false)` antes do ChatVolt já ter
  respondido automaticamente), o cliente recebe a resposta antiga
  (potencialmente com a mesma falha atual) OU as duas respostas
  (dupla). Precisa ser medido empiricamente antes de confiar nisso —
  não são fornecidas garantias de latência pela documentação.
- Latência adicional para o caminho EXPLORATORY: 1 chamada de
  classificação (rápida, pode ser regra pura, ~ms) + 1-2 chamadas HTTP à
  API do ChatVolt (`set-ai-enabled` + `send-message`), tipicamente
  \<1-2s, mas competindo contra o tempo que o próprio ChatVolt leva para
  gerar sua resposta (desconhecido, provavelmente 2-10s dado que os
  testes anteriores desta fase mostraram respostas em alguns segundos).
- Complexidade: média (precisamos hospedar/manter o texto canônico de
  respostas EXPLORATORY, ou uma chamada `agents/{id}/query` com prompt
  restrito).
- Impacto no legado: baixo — não mexe no fluxo COMMERCIAL_INTENT
  existente.

### E. Pós-processador da resposta antes do envio
- Não é possível: conforme seção 6, não existe hook "resposta gerada,
  ainda não enviada, você pode vetar/editar". O ChatVolt gera E envia
  como uma operação interna. **Descartada** — funcionalidade inexistente
  hoje (mesma limitação da opção A).

### Resumo comparativo

| Opção | Existe hoje? | Determinismo | Risco resp. dupla | Latência | Complexidade | Impacto legado |
|---|---|---|---|---|---|---|
| A. Gate nativo ChatVolt | Não existe | — | — | — | — | — |
| B. Dois agentes/prompts | Parcial, mas sem roteamento por-conversa | Baixo | Baixo | — | Alta (contorna limitação) | Alto (rearquitetura de deploy) |
| C. Classificador + variável | Sim, mas não resolve o problema raiz | Baixo-médio | Baixo | Baixa | Média | Baixo |
| D. Backend responde EXPLORATORY | Sim, via API documentada | **Alto** (para o caso que resolve) | **Médio** (depende da corrida — precisa medição) | Média (compete com tempo do ChatVolt) | Média | Baixo |
| E. Pós-processador | Não existe | — | — | — | — | — |

---

## 10. Critério de escolha aplicado

Dado que A e E não existem na plataforma, e B é inviável pela arquitetura
1-número=1-agente, e C não resolve o problema raiz (mesma classe de falha
do prompt engineering atual): **a única opção real, determinística e
implementável hoje é D — com o risco de corrida como item que PRECISA ser
medido/mitigado antes de qualquer implementação.**

Isso não é uma arquitetura "bonita" — é a única que existe de fato hoje.
Ela não elimina 100% o risco (a corrida contra o auto-reply do ChatVolt),
mas é a única que transforma a regra de "responda e pare" de uma
instrução de prompt (que já falhou 3x com modelos diferentes) em uma
decisão de código antes de qualquer LLM de WhatsApp ser acionado — desde
que vençamos a corrida.

**Mitigação de risco recomendada, a validar em fase de medição (ainda sem
implementar)**: medir empiricamente, em ambiente de teste (allowlist),
qual o tempo entre o `USER_MESSAGE_RECEIVED` chegar ao nosso webhook e o
`AGENT_MESSAGE_SENDED` correspondente chegar. Se a margem for
consistentemente grande (ex.: vários segundos), o risco de corrida é
baixo. Se for estreita ou inconsistente, a Opção D deixa de ser segura
como "gate preventivo" e passaria a ser reclassificada como
"corretora/pós-fato" (ainda útil para telemetria e para acionar handoff
humano em casos de falha repetida, mas não como gate determinístico
pré-resposta).

---

## 11. Onde o classificador ficaria

- **Localização**: novo módulo backend, ex.
  `functions-valeria/src/interaction_classifier.ts`, chamado a partir do
  handler do webhook (`webhook.ts`) assim que `USER_MESSAGE_RECEIVED`
  chega, ANTES de qualquer outra lógica (identidade, confirmação,
  complexidade, handoff).
- **Não palavra-chave simplista** — conforme exigido, precisa capturar
  intenção comunicativa, não a presença de um substantivo de produto. Os
  próprios exemplos do Gabriel provam isso: "Vocês fazem caixas?" vs
  "Quero uma caixa." — mesma palavra, intenção oposta.
- **Abordagem recomendada para desenho (não implementação)**: regra
  determinística baseada em PADRÃO SINTÁTICO/PRAGMÁTICO, não em
  dicionário de palavras-chave — ex.: detectar estrutura interrogativa
  genérica sobre capacidade/política da empresa ("vocês fazem/têm/
  trabalham com/entregam em...?", "qual o prazo/tipo/material...?",
  "como funciona...?") versus estrutura de pedido/especificação em
  primeira pessoa com verbo de posse/desejo + objeto concreto ("quero",
  "preciso de", "gostei do modelo X", presença de quantidade/medida
  explícita amarrada a um pedido). Isso ainda é uma heurística, não
  aprendizado de máquina — mas roda em CÓDIGO, de forma testável com
  suite unitária (como já fizemos para os parsers da Fase E.2), o que é
  qualitativamente diferente de "confiar que o LLM vai obedecer uma
  frase no prompt".
- Alternativa/complemento: modelo pequeno dedicado só para essa
  classificação binária (não o mesmo LLM que conversa com o cliente),
  com poucos exemplos rotulados — mais robusto a variações de
  fraseado que uma regra pura, mas adiciona uma chamada de rede e uma
  nova dependência de custo/latência. A decisão entre "regra pura" vs
  "regra + fallback de modelo pequeno para casos ambíguos" é uma escolha
  de uma fase de implementação futura, não deste desenho.
- Importante: o classificador roda **inteiramente no nosso backend**,
  nunca dependendo do LLM de WhatsApp entender e obedecer uma instrução
  — ele decide ANTES de qualquer chamada ao agente ChatVolt.

## 7 (retomado)/8. Como evitar resposta dupla

- Checar, antes de responder, se `AGENT_MESSAGE_SENDED` já foi recebido
  para aquele `messageId`/`conversationId` (idempotência já existe no
  webhook via `withIdempotency`, reaproveitável).
- Chamar `set-ai-enabled(false)` o mais cedo possível dentro do handler
  de `USER_MESSAGE_RECEIVED`, antes de qualquer outra lógica.
- Se, ao tentar responder, detectarmos que o ChatVolt já enviou uma
  resposta (via `get-messages`/estado da conversa), ABORTAR o envio
  próprio e apenas logar o "quase-erro" para métricas — nunca enviar
  mesmo assim.
- Reabilitar `set-ai-enabled(true)` assim que a classificação terminar
  (COMMERCIAL_INTENT) ou assim que nossa resposta EXPLORATORY for
  enviada — nunca deixar a IA desabilitada além do necessário.

## 9 (retomado)/9. Como manter handoff humano

- Handoff humano já é hoje um comportamento do agente nativo
  (`Solicitar Humano` na lista de Tools ativas) e da lógica de
  `avaliarEPersistirHandoff` no webhook. O gate proposto não interfere
  nisso: mensagens `COMMERCIAL_INTENT` continuam no fluxo atual
  (incluindo a possibilidade de handoff pelo próprio agente). Mensagens
  `EXPLORATORY` respondidas pelo backend também podem, no desenho,
  verificar sinais de handoff (reclamação, pedido de desconto etc.) ANTES
  de decidir responder — se detectado, a ação correta seria chamar
  `set-ai-enabled` mantendo ligado e deixar o fluxo nativo de handoff
  agir, em vez de o backend tentar responder.

## 10 (retomado)/10. Como preservar isTest/allowlist

- O gate, para ser seguro, deveria nascer restrito à MESMA allowlist de
  números de teste já usada em `permitidoParaPipeline` (webhook.ts) —
  ou seja, inicialmente só rodaria para os números de teste do Gabriel,
  exatamente como a lógica de identidade/confirmação/complexidade/
  handoff já faz hoje. Isso precisa ser mantido explicitamente na
  implementação futura: nenhuma mudança de comportamento em produção
  (números reais de clientes) até validação completa.

---

## 12. Plano de implementação em fases (desenho, não execução)

1. **Fase M (medição)** — sem nenhuma mudança de comportamento: adicionar
   só telemetria (timestamp de recebimento de `USER_MESSAGE_RECEIVED` vs
   `AGENT_MESSAGE_SENDED`) para medir a janela real de corrida, só para
   os números de teste. Decide se D é viável como gate PREVENTIVO ou só
   como corretor pós-fato.
2. **Fase G1 (classificador isolado)** — implementar e testar
   unitariamente o classificador EXPLORATORY×COMMERCIAL_INTENT como
   função pura, sem ligá-lo a nada ainda (mesma disciplina de testes A-K
   da Fase E.2).
3. **Fase G2 (gate em modo sombra)** — ligar o classificador no webhook,
   mas em modo "shadow": classifica e loga o que TERIA feito, sem chamar
   `set-ai-enabled` nem `send-message` de verdade. Comparar contra as
   respostas reais que o ChatVolt já deu, para os números de teste.
4. **Fase G3 (gate ativo, allowlist apenas)** — ativar de fato
   `set-ai-enabled`/`send-message` para EXPLORATORY, restrito aos
   números de teste, com STOP automático no primeiro sinal de resposta
   dupla ou erro de classificação.
5. **Fase G4 (expansão gradual)** — só após bateria de testes e
   aprovação explícita, expandir para produção.

## 13. Rollback

- Em qualquer fase G1-G4: desligar é reverter para o comportamento atual
  (não chamar o classificador/gate) — não requer nenhuma mudança no
  ChatVolt, já que o gate vive inteiramente no nosso backend. Um
  feature flag dedicado (análogo ao `valeriaV2Enabled`) controlaria
  isso, resetável a `false` a qualquer momento.
- Se, em algum momento, `set-ai-enabled(false)` for chamado e o processo
  falhar antes de reabilitar, existe risco de deixar a IA
  PERMANENTEMENTE desligada para aquela conversa (o cliente pararia de
  receber qualquer resposta automática). Mitigação a desenhar na
  implementação: try/finally com reabilitação garantida + alerta se
  uma conversa ficar com IA desabilitada por mais que alguns segundos
  sem uma resposta nossa ter sido enviada.

## 14. Estimativa de impacto em latência

- Caminho COMMERCIAL_INTENT: nenhum impacto (gate não interfere).
- Caminho EXPLORATORY: adiciona a chamada de classificação (~ms, é
  código local) + 1-2 chamadas HTTP à API do ChatVolt
  (`set-ai-enabled` + `send-message`), tipicamente somando algo entre
  algumas centenas de ms a 1-2s, mas o fator decisivo é se essa soma fica
  ABAIXO do tempo que o ChatVolt levaria para responder sozinho — isso
  só a Fase M (medição) responde com números reais.

---

## Resumo executivo

- A, E: não existem na plataforma — descartadas.
- B: inviável pela arquitetura 1-número=1-agente do ChatVolt.
- C: não resolve o problema raiz (ainda depende do LLM obedecer uma
  variável/instrução).
- **D é a única opção real hoje**, mas seu determinismo depende de
  vencer uma corrida não documentada/garantida contra o auto-reply do
  ChatVolt — por isso o plano começa com uma Fase M de MEDIÇÃO pura,
  sem nenhuma mudança de comportamento, antes de decidir se D vira gate
  preventivo ou só corretor pós-fato.

**Nenhuma implementação foi feita nesta fase, conforme solicitado. KB
permanece desconectada, prompt congelado, modelo GPT-4.1 Mini, feature
flag `false`.**
