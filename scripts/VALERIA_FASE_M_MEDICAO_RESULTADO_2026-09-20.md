# VALERIA 2.0 — Fase M — Resultado da medição da janela de interceptação

**Status: MEDIÇÃO CONCLUÍDA. Zero mudança de comportamento. Nenhuma
mensagem foi enviada pelo backend. `set-ai-enabled` só foi chamado na
conversa de teste dormente pré-autorizada, sempre restaurado e confirmado.
`data.valeriaV2Enabled=false` durante toda a fase.**

Conversa real analisada: `cmt95yjqa0dksuvqt63to9tbm` (telefone de teste
`***...6135`, allowlist confirmada), janela 2026-09-20 19:56–20:11 UTC (21
eventos de webhook, 20 execuções reais do roteiro combinado A-E).

---

## 1-2. Timeline real medida / total de rodadas válidas

- **20/20 execuções do roteiro chegaram como eventos de entrada
  (`USER_MESSAGE`/`AGENT_USER_MESSAGE` com `mensagemCliente` preenchido) no
  nosso webhook.** Ingestão do lado de entrada é 100% confiável nesta
  amostra.
- **Achado crítico não previsto**: dos 20 rounds, **apenas 1 evento de
  saída (`AGENT_MESSAGE_SENDED`) chegou ao nosso webhook em toda a
  janela — e esse único evento é anterior à primeira mensagem do
  roteiro (19:56:06.559Z, antes do "Oi" de 19:56:20.101Z), ou seja, não
  pertence a nenhuma das 20 execuções.** Confirmado com janela alargada
  até 21:00Z (1h de margem) — nenhum evento de saída adicional apareceu.
  Cross-checado em 2 fontes independentes (`valeria_webhook_events` e
  `valeria_msgs`, que tem `direcao` computada pela própria lógica de
  produção do `webhook.ts`) — mesmo resultado nas duas.
- Terceira fonte candidata a t0/t2 (`atendimentos/{id}/mensagens`, via
  `sincronizarConversaCompleta` chamando a API real do ChatVolt) estava
  **desatualizada há 20 dias** (última sincronização: 2026-08-31) — não
  foi populada durante a bateria de hoje, então também não serviu como
  fonte alternativa de timestamp de resposta.

## 3-4. Métricas de `webhookIngressDelay` e `agentResponseWindow`

**Não foi possível calcular nenhuma das duas com dado real desta
bateria** — motivo direto do achado do item 1: sem nenhum evento de
saída correlacionável, não existe `t2` para nenhum dos 20 rounds, e sem
sincronização de `atendimentos/mensagens` atualizada, não existe `t0`
nativo confiável.

- `agentResponseWindow`: **n=0** (0 pares casados de 20 rounds).
- `webhookIngressDelay`: **n=0**.

## 5. Mínimo/p50/p95/máximo

Não aplicável — sem amostras válidas (ver acima). Isto é reportado como
está, sem inventar número.

## 6. Comportamento dos 10s de atraso ("Respostas com Atraso")

Confirmado o valor configurado: **10 segundos** (lido diretamente na UI
do ChatVolt antes da bateria, não alterado). Comportamento observado
**indiretamente**, via conteúdo das mensagens agrupadas (ver item 7) —
não foi possível medir diretamente quando a resposta É gerada/enviada
(por causa do achado do item 1), então não dá para confirmar
empiricamente se o atraso ocorre antes da geração ou só antes do envio,
nem se o timer reinicia a cada mensagem nova dentro da janela — **ambas
essas perguntas ficam pendentes**, sem dado suficiente para responder
com confiança.

## 7. Comportamento em bursts — CONFIRMADO EMPIRICAMENTE

Este é o achado mais sólido da fase. As 6 execuções de burst (D×3, E×3)
**chegaram ao nosso webhook como UM ÚNICO evento de entrada cada**, com
o texto das mensagens originais concatenado por quebras de linha —
prova direta de que o **ChatVolt agrupa as mensagens do cliente antes
mesmo de nos notificar** (opção B do item 15 do pedido: "agrupar e
gerar uma só"), não dispara um evento por mensagem individual:

| Execução | Mensagens enviadas (roteiro) | Evento de entrada recebido (texto real) |
|---|---|---|
| D#1 | "Oi" + "Vocês fazem troféus?" | `"Oi\n\nVocês fazem troféus?"` (1 evento, 20:05:16.891Z) |
| D#2 | "Boa tarde" + "Quero uma caixa" | `"Boa tarde\n\nQuero uma caixa"` (1 evento, 20:05:46.972Z) |
| D#3 | "Olá" + "Qual o prazo de vocês?" | `"Olá\n\nQual o prazo de vocês?"` (1 evento, 20:06:17.076Z) |
| E#1 | "Oi" + "Preciso de uma peça" + "35x25" | `"Oi\n\nPreciso de uma peça\n\n35x25"` (1 evento, 20:07:32.656Z) |
| E#2 | "Boa tarde" + "Vocês fazem sob medida?" + "Em acrílico" | `"Boa tarde\n\nVocês fazem sob medida?\n\nEm acrílico"` (1 evento, 20:09:17.898Z) |
| E#3 | "Olá" + "Quero 5 troféus" + "Pra dia 10" | `"Olá\n\nQuero 5 troféus\n\nPra dia 10"` (1 evento, 20:10:08.105Z) |

6 de 6 execuções de burst confirmam agrupamento total (nenhuma gerou
mais de um evento de entrada). Os 14 rounds de mensagem única (A+B+C)
geraram exatamente 14 eventos de entrada distintos, 1:1 — sem
agrupamento entre rounds diferentes (o espaçamento de ~20-90s entre eles
foi suficiente).

**O que isso significa para a arquitetura do gate**: como o próprio
ChatVolt já entrega o burst como uma mensagem única concatenada, o
classificador EXPLORATORY×COMMERCIAL_INTENT da Fase E.2.4 precisaria
lidar com uma única entrada que mistura múltiplas intenções (ex.:
"Oi" + "Preciso de uma peça" + "35x25" = uma saudação, uma
intenção comercial e uma medida, tudo junto) — isso é MAIS simples para
o gate (uma decisão por evento, não por mensagem), mas exige que o
classificador saiba lidar com texto multi-linha/multi-intenção.

## 8. Latência do `set-ai-enabled` (medida com segurança, conversa dormente isolada)

Já reportado e confirmado nesta sessão, repetido aqui para consolidar:
conversa `cmtatdbeh0eokvyqtbfxv6bz2` (dormente ~24 dias, sem vínculos),
10 amostras (5 rodadas enable+disable), estado restaurado e confirmado:

| | min | p50 | p95 | máximo | média |
|---|---|---|---|---|---|
| combinado | 182.8ms | 206.9ms | 305.9ms | 305.9ms | 221.7ms |

## 9. Menor margem real observada (MINIMUM SAFETY WINDOW)

**Não determinável com os dados desta bateria** — n=0 pares
entrada→saída (item 3-5). Isto é diferente de "a margem é pequena": é
"não temos visibilidade nenhuma, via webhook, de quando ou se a IA
respondeu" para 19 dos 20 rounds testados.

## 10. Classificação VERDE / AMARELO / VERMELHO

**VERMELHO — mas por um motivo diferente do antecipado no desenho da
Fase E.2.4.** O risco não é "a corrida é apertada" — é que **o sinal que
a Opção D precisaria para decidir e para se auto-avaliar
(`AGENT_MESSAGE_SENDED` via webhook) não chegou de forma confiável nesta
amostra controlada** (1 evento espúrio em 20 rounds, 5% de cobertura
efetiva, e esse 1 evento nem pertence a nenhum round testado). Isso é
um problema anterior ao problema da corrida: não é só "não sabemos se
vencemos a corrida com confiança suficiente" — é "não temos hoje
telemetria confiável nem para medir a corrida depois do fato".

## 11. Conclusão: D é viável / arriscada / inviável?

**D está hoje BLOQUEADA por uma lacuna de instrumentação, não decidida
como inviável por arquitetura.** Antes de qualquer decisão sobre
viabilidade do gate preventivo, é preciso entender POR QUE
`AGENT_MESSAGE_SENDED` (ou qualquer evento de saída equivalente) não
chegou em 19 de 20 rounds — hipóteses a investigar, sem inventar
resposta:
- o tipo de evento `AGENT_MESSAGE_SENDED` pode não estar habilitado /
  configurado corretamente para o canal WhatsApp deste agente
  especificamente (verificar `PATCH /agents/{id}/webhook` — estado
  atual do webhook por canal, hoje não conferido nesta fase);
- pode haver uma condição na plataforma ChatVolt que só dispara esse
  evento em certas circunstâncias (ex.: só a primeira resposta de uma
  sessão, ou só quando não há resposta anterior recente) — não
  documentada;
- pode ser um problema pontual desta janela específica (falha
  transitória do lado do ChatVolt) — só repetir a medição em outra
  bateria futura descarta ou confirma isso.

Enquanto essa lacuna não for entendida, a Opção D não pode ser
considerada "medida como seguindo VERDE ou AMARELO" — está, na prática,
**sem dado suficiente para decidir**, o que por definição classifica
como VERMELHO/bloqueada para avançar à Fase G (implementação), por mais
que a latência do `set-ai-enabled` (item 8) tenha sido excelente
(sub-300ms) — essa parte boa da equação não compensa a ausência total
do outro lado da medição.

## 12-13. Nenhuma mudança funcional feita / feature flag final

Confirmado: nenhum código de produção foi alterado nesta fase (só o
script de análise, local, read-only, em `scripts/`). Nenhuma mensagem
foi enviada pelo backend em nenhuma conversa. `set-ai-enabled` só foi
usado na conversa de teste dormente pré-autorizada, com estado
restaurado e reconfirmado. `data.valeriaV2Enabled` permanece **`false`**
— confirmado, não tocado durante toda a Fase M.

---

## Próximo passo sugerido (não autorizado ainda, só recomendação)

Antes de repetir a bateria de 20 execuções (que tem custo operacional
real — 20 mensagens manuais), recomendo investigar SOMENTE LEITURA por
que `AGENT_MESSAGE_SENDED` não chegou: checar a configuração de webhook
por canal do agente (`PATCH /agents/{id}/webhook` GET equivalente, se
existir, ou a UI de Configurações → Webhooks já visitada em fases
anteriores) e comparar com o que os 4 rounds das fases E.2.1/E.2.3 (via
aba de Chat de teste, não WhatsApp) mostraram — se aquelas rodadas
também nunca geraram `AGENT_MESSAGE_SENDED`, o problema é estrutural e
anterior a esta bateria específica.
