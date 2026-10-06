# VALERIA 2.0 — Fase M.1 — Recuperação do timestamp real de resposta via API do ChatVolt

**Status: SOMENTE LEITURA. Nenhuma mudança funcional. Nenhuma mensagem
enviada. `data.valeriaV2Enabled=false`. Bateria dos 20 testes da Fase M
NÃO foi repetida — reaproveitada integralmente, conforme instrução.**

## 1-2. A API contém as respostas? Endpoint e campos usados

**Sim.** `GET https://api.chatvolt.ai/conversation/{conversationId}/messages/{count}`
(doc: `docs.chatvolt.ai/api-reference/endpoint/conversation/get-messages`),
chamado com `count=60` para a conversa `cmt95yjqa0dksuvqt63to9tbm`.
Retornou **60 mensagens** (histórico completo do thread reutilizado,
incluindo sessões de semanas anteriores), das quais **40 pertencem à
bateria de hoje** (20 humanas + 20 do agente — 1:1, todas as 20
execuções têm resposta registrada).

Campos usados: `from` (`"human"` | `"agent"`), `createdAt` (ISO 8601,
UTC, precisão de milissegundo), `text`, `id`. Não usei `updatedAt` nem
nenhum timestamp de sincronização do ERP — **todos os deltas abaixo usam
exclusivamente `createdAt` nativo da própria API do ChatVolt**, dos dois
lados (mensagem do cliente e resposta do agente), conforme exigido.

## 3. Validação de relógios

- Todos os `createdAt` vêm em UTC (sufixo `Z`), mesma base que
  `Date.now()` do nosso backend (epoch ms, também UTC) — **sem
  necessidade de correção de timezone**.
- Precisão: milissegundo, consistente nas 40 mensagens de hoje.
- `createdAt` representa **criação da mensagem no ChatVolt**, não
  sincronização — é o mesmo endpoint/campo que a documentação define
  como timestamp de criação da mensagem, não um campo de "última
  atualização" (`updatedAt` é um campo separado, não usado aqui).
- **Não há skew fixo de relógio a corrigir** — o que existe é uma
  diferença *variável* entre nosso `ts` de ingestão e os timestamps
  nativos, e essa diferença tem uma explicação estrutural, não um erro
  de relógio (ver item 5).

## 4. Pareamento (respeitando bursts)

Confirmado: os 6 bursts (D×3, E×3) aparecem na API do ChatVolt como
**UMA ÚNICA mensagem humana** cada (`from:"human"`, texto com quebras de
linha concatenando as mensagens originais do WhatsApp — ex.:
`"Oi / Preciso de uma peça / 35x25"`), pareada com **UMA única resposta
do agente** logo em seguida. Ou seja: o agrupamento observado na Fase M
(a nível do nosso webhook) é o MESMO agrupamento que existe na origem —
o ChatVolt já entrega ao próprio histórico da conversa uma mensagem
humana fundida por burst, não 2-3 mensagens separadas. Pareamento:
20 grupos lógicos (14 mensagens isoladas + 6 bursts), 20 respostas,
1:1, sem ambiguidade.

## 5. Resultado — `agentResponseWindow` NATIVO (ChatVolt: `agent.createdAt − human.createdAt`)

| | n | mínimo | p50 | p95 | máximo | média |
|---|---|---|---|---|---|---|
| Todas as 20 rodadas | 20 | 1.124s | 7.013s | 33.312s | 40.969s | 10.762s |
| Mensagens isoladas (14) | 14 | 1.124s | 4.458s | 33.312s | 33.312s | 8.850s |
| Bursts (6) | 6 | 6.144s | 8.672s | 40.969s | 40.969s | 15.225s |

**Comparação direta com `set-ai-enabled` (p95 ≈ 306ms):** mesmo a
resposta MAIS RÁPIDA observada (1.124s, round "Olá, tudo bem?") é **3,7×
mais lenta** que o p95 do `set-ai-enabled` sozinho — ou seja, em tese,
puramente em termos de "o agente demora para responder", SOBRARIA
margem de sobra para um `set-ai-enabled` vencer a corrida, SE o gatilho
para chamá-lo disparasse no momento certo.

**Mas o achado crítico está em outro lugar — ver item 6.**

## 6. O achado que decide a questão: quando nosso webhook realmente nos avisa

Comparei, para as mesmas 20 rodadas, o `ts` que o NOSSO webhook recebeu
(capturado em `valeria_api_log`/`valeria_webhook_events`, já usado na
Fase M) contra o `createdAt` nativo da **resposta do agente** (não da
mensagem do cliente):

| | n | mínimo | p50 | p95 | máximo | média |
|---|---|---|---|---|---|---|
| nosso `ts` − `agent.createdAt` nativo | 20 | +2.249s | +4.716s | +6.629s | +9.196s | +4.900s |

**Em 20 de 20 rodadas, nosso webhook só foi notificado DEPOIS de o
agente já ter enviado a resposta ao cliente** — nunca antes, sempre
entre ~2,2s e ~9,2s depois. Isto não é uma corrida apertada: **é uma
corrida que já está perdida no momento em que recebemos qualquer aviso
do ChatVolt.** O evento que chega ao nosso webhook (`AGENT_USER_MESSAGE`
carregando `mensagemCliente`) não é uma notificação em tempo real de
"mensagem chegou" — é, na prática, um **eco/digest tardio**, entregue
somente depois que o turno inteiro (pergunta do cliente + resposta do
agente) já foi concluído do lado do ChatVolt.

## Conclusão sobre a Opção D

**Arriscada → na verdade, com os dados desta bateria, mais grave que
"arriscada": estruturalmente tarde demais, 20 de 20 vezes, com margem
negativa de vários segundos, não fração de segundo.** Não é uma questão
de otimizar a latência do nosso lado (o `set-ai-enabled` já é rápido,
~207ms de mediana) — o problema é que o ÚNICO gatilho disponível hoje
(`USER_MESSAGE_RECEIVED`/`AGENT_USER_MESSAGE` via webhook) não dispara
a tempo, porque ele só é entregue depois que a IA já respondeu.

Isso não decide sozinho que D seja definitivamente inviável para
sempre — mas decide que **D não é viável usando o webhook atual como
gatilho**. Restam duas perguntas em aberto, propositalmente NÃO testadas
nesta fase (ver item 8, M.2, não executado):
1. Existe algum OUTRO gatilho (não descoberto ainda na documentação) que
   dispare de fato em tempo real, antes da resposta? Não encontrado até
   agora (ver auditoria da Fase E.2.4, seção 6 — nenhum
   pre-processing/routing documentado).
2. O padrão de "nosso webhook chega ~2-9s depois da resposta" é uma
   característica ESTRUTURAL fixa da integração (sempre vai ser assim),
   ou é um comportamento específico desta configuração/canal que
   poderia mudar? Não sabemos — não há base para especular.

## 7. Explicação para a ausência de `AGENT_MESSAGE_SENDED`

Não confirmada com certeza (não alterei nenhuma configuração para
testar isso), mas o padrão observado sugere fortemente uma explicação
coerente com o achado do item 6: se o evento que chega ao nosso webhook
já é disparado **depois** que o turno completo (pergunta+resposta) foi
processado, faz sentido que o ChatVolt não dispare um evento
`AGENT_MESSAGE_SENDED` **separado** — o único "aviso" que fizemos por
webhook (`AGENT_USER_MESSAGE`, carregando o texto do cliente) já chega
tarde o bastante para ser, na prática, uma notificação pós-fato de todo
o turno, tornando um evento de confirmação de envio redundante do ponto
de vista do ChatVolt. Isso é uma **hipótese, não um fato confirmado** —
para confirmar de verdade seria preciso inspecionar a configuração de
Webhooks do agente na UI do ChatVolt (não feito nesta fase, por ser
fora do escopo "somente leitura de dados", embora fosse leitura de
configuração — posso fazer isso como próximo passo se autorizado) ou
abrir um ticket de suporte perguntando diretamente.

Meu placar do item 10 do pedido, respondido só com o que os dados
mostram (não inventando o resto):
- depende do canal: **não sabemos** — testamos só WhatsApp nesta
  bateria;
- mudou de nome: **não parece** — os nomes de evento batem com os já
  documentados no código (`types.ts`);
- o agente usa `AGENT_USER_MESSAGE` para outbound: **não neste caso** —
  aqui `AGENT_USER_MESSAGE` carregou consistentemente o texto do
  CLIENTE (`mensagemCliente`), nunca do agente, nesta bateria — a
  resposta do agente em si nunca apareceu em nenhum campo de nenhum
  evento de webhook recebido;
- diferença entre Chat interno e WhatsApp: **não testamos** nesta
  bateria (só WhatsApp);
- a documentação garante esse evento: **não** — a lista de eventos
  suportados é conhecida (`types.ts`), mas nenhuma página de
  `docs.chatvolt.ai` encontrada até agora documenta a SEMÂNTICA/timing
  exato de entrega de cada `eventType` (nenhuma garantia de latência ou
  de que todos os eventos sempre disparam).

## 8. Desenho do M.2 (NÃO executado, conforme instrução)

Mantido no desenho original do pedido (seção 7-9 da mensagem do
Gabriel), sem alteração — só um adendo importante à luz do achado do
item 6: dado que o gatilho que M.2 usaria (o mesmo webhook) já se provou
estruturalmente tardio nesta amostra, a expectativa realista para M.2,
SE for executado, é de que ele confirme 0 de N rodadas bloqueadas antes
da resposta (não 10/10 nem parcial) — isso não substitui rodar o teste
de verdade (não estou tratando essa expectativa como resultado), só
está registrado aqui para calibrar a decisão de se vale a pena gastar
uma nova bateria controlada em M.2 ou se o achado do M.1 já é suficiente
para encerrar a via "gate reativo ao webhook atual" e redirecionar a
investigação para descobrir se existe ALGUM outro gatilho mais rápido
(pergunta em aberto, não respondida ainda).

## 9-10. Nenhuma mudança funcional / feature flag final

Confirmado: nenhuma escrita em produção nesta fase, exceto as leituras
já registradas (script `scripts/fase_m_medicao_janela_intercepcao_2026-09-20.js`,
que é local e read-only, e a chamada `GET .../messages/60`, que é uma
leitura pura na API do ChatVolt). `data.valeriaV2Enabled` permanece
**`false`**. Nenhum `set-ai-enabled` foi chamado nesta fase M.1 (só a
leitura via `GET messages`).
