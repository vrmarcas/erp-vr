# VALERIA 2.0 — Fase E.2.7 — PoC Shadow da orquestração backend (Variante B)

**Status: implementação local do SHADOW MODE concluída e testada.
NENHUM DEPLOY foi feito. Nenhuma mensagem real foi enviada. Nenhuma
automação do ChatVolt foi alterada. `Agent Query` não foi chamado.
`send-message` não foi chamado. Prompt/Tools do ChatVolt não foram
tocados. KB continua desconectada. `data.valeriaV2Enabled=false`.**

---

## 1. Texto pronto do chamado ao ChatVolt

Ver [`CHATVOLT_SUPPORT_REPORT_BOAS_VINDAS_2026-09-20.md`](CHATVOLT_SUPPORT_REPORT_BOAS_VINDAS_2026-09-20.md)
— pronto para envio, sem nenhum dado sensível.

---

## 2. Desenho final da Variante B (como foi implementado)

```
INBOUND (texto da mensagem, modoAtendimento, flags)
   │
   ▼
Gate 1: eco da nossa própria escrita?  → SYSTEM_IGNORE (não processa)
   │ não
   ▼
Gate 2: modoAtendimento === "humano"?  → HUMAN (não processa)
   │ não
   ▼
classifyIntent(texto)                  → EXPLORATORY | COMMERCIAL_INTENT | AMBIGUOUS
   │
   ├─ EXPLORATORY/AMBIGUOUS:
   │     fatos pré-aprovados (tabela backend, NUNCA a KB corrompida)
   │     → redactionInput{questionAllowed:false}
   │     → redator → validador (nunca deixa pergunta passar)
   │
   └─ COMMERCIAL_INTENT:
         resolveProductMatch (só se houver sinal de produto NOVO no turno)
         → mergeSignalsIntoDraft → computeQualificationState → computeNextAction
         → redactionInput{questionAllowed:true, nextAction, questionContext}
         → redator → validador
   │
   ▼
ShadowResult { ..., sideEffectsExecuted:false }  → NUNCA enviado, só logado/observado
```

---

## 3. Implementação (arquivos novos, nenhum arquivo de produção alterado)

| Arquivo | Papel |
|---|---|
| `functions-valeria/src/interaction_classifier.ts` | Classificador puro EXPLORATORY×COMMERCIAL_INTENT×AMBIGUOUS (regras estruturais, não palavra-chave isolada) |
| `functions-valeria/src/shadow_output_validator.ts` | Validador determinístico de saída — barra pergunta/pedido de briefing quando `questionAllowed=false` |
| `functions-valeria/src/shadow_redactor.ts` | "Redator" — template determinístico (ver nota abaixo), interface `Redactor` plugável |
| `functions-valeria/src/shadow_pipeline.ts` | Orquestrador — função **pura** (zero import de Firestore/HTTP), reaproveita `product_resolution.ts`/`catalog_draft.ts`/`qualification_engine.ts` já existentes e testados |
| `functions-valeria/src/__tests__/interaction_classifier.test.ts` | Matriz de casos do item 9 do pedido |
| `functions-valeria/src/__tests__/shadow_output_validator.test.ts` | Prova de que o validador barra saída ruim mesmo simulando um "LLM que erra" |
| `functions-valeria/src/__tests__/shadow_pipeline.test.ts` | Integração completa, idempotência, prova estática de zero I/O, replay das 20 mensagens reais da Fase M.1 |

**Nenhuma Cloud Function nova foi exportada em `index.ts`** — o código
existe, compila, passa nos testes, mas não está "pronto para receber
tráfego real" ainda (isso seria o próximo passo, não feito nesta fase —
ver seção 12/Plano de deploy shadow).

**Nota sobre o redator (transparência, não é lacuna escondida)**:
implementei `defaultTemplateRedactor` como um **template determinístico**,
não uma chamada real a LLM/Agent Query. Motivo: (1) zero credencial
nova nesta fase, (2) 100% testável offline, sem custo, sem rede, (3) o
objetivo desta fase é provar a ORQUESTRAÇÃO e o VALIDATOR — um LLM real
entra depois, atrás da mesma interface `Redactor`, sem tocar em mais
nada. Isso está documentado no próprio cabeçalho do arquivo.

---

## 4. Testes — resultado

```
Test Suites: 36 passed, 36 total
Tests:       630 passed, 630 total  (verificado 2x, estável)
```

49 testes novos (interaction_classifier + shadow_output_validator +
shadow_pipeline), 581 testes pré-existentes intactos — **nada foi
quebrado**, `npx tsc --noEmit` limpo.

---

## 5. Matriz de casos e resultados (item 9)

Todos os casos EXPLORATORY, COMMERCIAL_INTENT e AMBIGUOUS do item 9 do
pedido foram implementados como testes automatizados e **passam** —
inclusive o par de prova "mesma palavra, intenção oposta":

| Frase | Classificação |
|---|---|
| "Vocês fazem caixas?" | EXPLORATORY |
| "Quero uma caixa." | COMMERCIAL_INTENT |

Casos AMBIGUOUS ("Preciso de uma peça.", "Estou vendo uma caixa.",
"Queria saber de troféu.", "Tenho interesse em uma placa.") **nunca**
viram COMMERCIAL_INTENT — comportamento seguro confirmado por teste
(`expect(...).not.toBe("COMMERCIAL_INTENT")`).

---

## 6. Output validator — resultado

Testado explicitamente simulando um redator que **desrespeita** a
instrução (ex.: `"Sim, fazemos peças sob medida. Pode me passar as
medidas?"`) — o validador rejeita e substitui pela recitação literal dos
fatos pré-aprovados, nunca deixando a pergunta passar. Também testado:
pedidos de quantidade/material/prazo/foto sem `?` explícito são
igualmente barrados. Achado corrigido durante a implementação: o
primeiro desenho do validador tinha falso-positivo (a palavra "medida"
dentro de "fazemos peças **sob medida**" disparava a regra) — corrigido
para exigir moldura de PEDIDO ("quais as medidas", "me diga a
quantidade"), não a palavra-tópico isolada. Suite de regressão cobre
esse caso especificamente.

---

## 7. Comportamento de ambiguidades (item 9)

Confirmado por teste: mensagens ambíguas nunca iniciam qualificação
(`resolution` permanece `null`), nunca fazem pergunta
(`outputValidation.valid===true` e texto sem `?`), respondem só com um
fato genérico seguro. Comportamento "seguro" concretizado como pedido:
não forçar para comercial, não fingir estar em EXPLORATORY puro também
— é seu próprio modo, com a mesma restrição de saída do EXPLORATORY.

---

## 8. Idempotência (item 9 da entrega / item 13 do pedido)

`runShadowPipeline` é uma função pura e determinística — testado
explicitamente (`shadow_pipeline.test.ts`, describe "idempotência"):
mesma entrada → `toEqual` na segunda chamada. Como a função nunca faz
I/O, reprocessar o mesmo evento de webhook (retry) nunca duplica nada,
por construção — não é uma garantia de runtime a confiar, é uma
propriedade do código, verificável por leitura (nenhuma função aqui
recebe client de escrita) e reforçada por um teste automatizado que lê
o próprio arquivo-fonte e falha se alguém um dia importar
`firebase-admin`/`fetch`/`axios` nele.

---

## 9. Replay sobre transcrição real (item 10 do pedido)

Rodei o shadow sobre as **20 mensagens reais** da bateria da Fase M.1
(conversationId `cmt95yjqa0dksuvqt63to9tbm`, texto exato capturado via
API do ChatVolt). Resultado:

```
Distribuição: { EXPLORATORY: 13, COMMERCIAL_INTENT: 7 }
```

Confirmado por teste: nenhuma das 20 processou com exceção,
`sideEffectsExecuted=false` em todas, nenhuma resposta
EXPLORATORY/AMBIGUOUS contém pergunta de acompanhamento — inclusive as
que, na bateria REAL, o agente do ChatVolt respondeu incorretamente
(ex.: "Vocês fazem peça sob medida?" → resposta real do ChatVolt incluiu
"Pode me passar os detalhes técnicos..."; a mesma mensagem, pelo shadow,
produz só "Sim, fazemos peças sob medida.", sem pergunta).

---

## 10. Latência local medida (item 11 do pedido)

Medida real, em ambiente local, das 5 mensagens EXPLORATORY/AMBIGUOUS +
15 COMMERCIAL_INTENT do replay (execução síncrona, sem rede — todo o
pipeline é CPU-bound e local):

- **Total do pipeline shadow por mensagem: sub-milissegundo** (a suíte
  inteira de 49 testes, incluindo as 20 mensagens do replay × 3
  execuções cada, roda em ~2,5s no total, a maior parte sendo overhead
  do Jest/ts-jest, não do pipeline em si).
- Isso é esperado: classificação é regex puro, resolução de catálogo é
  busca em array pequeno, geração é template — nada aqui envolve rede
  ou I/O.
- **Conforme instruído, não somei o atraso do ChatVolt (~4-9s, medido
  nas Fases M.1/E.2.5) como se fosse processamento nosso** — ele
  continua sendo o gargalo real e externo, documentado separadamente.
- Estimativa ponta a ponta (mensagem → webhook → pipeline → futuro
  send-message), reaproveitando os números já medidos: **~4-9s de
  atraso do webhook + <10ms de pipeline local + latência de rede do
  `send-message` (não medida nesta fase, estimada em poucas centenas de
  ms por analogia com `set-ai-enabled`)** — o pipeline backend em si
  não é o gargalo; o webhook do ChatVolt continua sendo.

---

## 11. Arquivos alterados (item 11 da entrega)

Só arquivos **novos**, nenhum arquivo de produção existente foi
modificado:

```
functions-valeria/src/interaction_classifier.ts        (novo)
functions-valeria/src/shadow_output_validator.ts        (novo)
functions-valeria/src/shadow_redactor.ts                 (novo)
functions-valeria/src/shadow_pipeline.ts                  (novo)
functions-valeria/src/__tests__/interaction_classifier.test.ts   (novo)
functions-valeria/src/__tests__/shadow_output_validator.test.ts  (novo)
functions-valeria/src/__tests__/shadow_pipeline.test.ts           (novo)
```

Nenhuma collection nova do Firestore foi criada (o shadow não persiste
nada — se/quando formos além desta fase, um log de diagnóstico
`valeria_shadow_results` seria a próxima peça, ainda não criada).
`index.ts`, `functions.yaml`, `webhook.ts`, `catalog_tools.ts` — **nenhum
tocado**.

---

## 12. Plano de deploy shadow (não executado — só desenho para aprovação futura)

Se/quando autorizado a ir além desta fase local:
1. Criar `valeriaShadowEvaluate` (Cloud Function `onRequest`), reusando
   `pipeline()` (mesma auth/allowlist/rate-limit já existentes) — chama
   `runShadowPipeline` e só GRAVA o resultado em
   `valeria_shadow_results` (diagnóstico, TTL curto) — nunca em
   `atendimentos`/`valeria_catalog_drafts` reais.
2. Restringir por `permitidoParaPipeline`/`isTeste` — mesmos gates de
   sempre.
3. Ligar essa function como um listener A MAIS dentro de
   `valeriaWebhookChatvolt` (chamada fire-and-forget, nunca bloqueando a
   resposta HTTP ao ChatVolt), só para os números de teste.
4. Rodar por um período de observação, comparando `hypotheticalText`
   contra o que o ChatVolt realmente respondeu, sem nenhum envio nosso.
5. Só depois desse período — e só com nova autorização — discutir
   ligar de fato o `send-message`/desligar a IA nativa permanentemente.

## 13. Rollback

Trivial: como nada foi deployado nem exportado, "reverter" hoje é só
não fazer o deploy do item 12. Se um dia o `valeriaShadowEvaluate` for
deployado e precisar ser revertido, é uma function isolada, sem nenhum
efeito colateral em `atendimentos`/produção — remover o export de
`index.ts` e reimplantar é suficiente.

## 14. Feature flag final

`data.valeriaV2Enabled` permanece **`false`**, confirmado, não tocado
nesta fase.
