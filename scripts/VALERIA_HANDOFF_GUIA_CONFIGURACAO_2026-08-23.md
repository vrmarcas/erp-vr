# Valéria — Guia de Configuração Manual Chatvolt (Handoff automático → ERP)

**Data:** 2026-08-23
**Agente:** Valéria (`cmmmkciwb02j8lcxudbnwv31y`)
**URL:** https://app.chatvolt.ai/pt-BR/agents/cmmmkciwb02j8lcxudbnwv31y?tab=settings&settingTab=tools
**Base:** prompt atualmente publicado (v0.3, `VALERIA_PROMPT_V0.3_2026-08-22.md`) — este guia é um
**PATCH aditivo**, não substitui o prompt inteiro.

> **SEGURANÇA:** Nunca compartilhe o bearer em log, relatório ou mensagem. O bearer é o valor
> JSON `secret` de `erp_vr/valeria_config` no Firestore — o MESMO já usado pelas Tools Vitre
> (buscar_catalogo_vitre etc.). Não precisa gerar um novo.

---

## Causa raiz (por que o badge nunca acendia sozinho)

O prompt v0.3 já decide corretamente **quando** escalar para humano — a seção "QUANDO CHAMAR
SOLICITAR HUMANO" tem 10 condições bem calibradas (evita falso positivo). O problema nunca foi a
decisão: é que a Tool chamada nesse momento, **"Solicitar Humano"**, é um recurso *nativo do
Chatvolt* (pausa o bot dentro do painel do Chatvolt) — não escreve nada no Firestore do ERP.
Por isso o `atendimentos/{id}.status` nunca virava `aguardando_humano` e o badge do sidebar nunca
reagia, mesmo com a IA "escalando" corretamente do ponto de vista dela.

A solução: **manter** a chamada a "Solicitar Humano" (built-in) como está — ela pode continuar
útil dentro do próprio Chatvolt — e **adicionar** uma chamada à Tool nova abaixo, no MESMO turno,
sempre que "Solicitar Humano" for chamada. É estritamente aditivo: nenhuma condição de
escalonamento muda, nenhum comportamento existente é removido.

---

## PARTE 1 — Adicionar 1 HTTP Tool nova

### Tool: solicitar_atendimento_humano

| Campo | Valor |
|---|---|
| **Nome** | `solicitar_atendimento_humano` |
| **Método** | `POST` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/atdSolicitarHumanoValeria` |
| **Header** | `Authorization: Bearer <secret>` (colar o bearer manualmente — mesmo valor das Tools Vitre) |

**Descrição para o agente:**
```
Execute SEMPRE que você chamar "Solicitar Humano" — no mesmo turno, nunca depois.
Registra no ERP que este atendimento precisa de um humano (acende o badge da equipe).
motivo: uma frase curta e específica do que está acontecendo, ex.: "Cliente pediu para
falar com uma pessoa." ou "Pedido de desconto especial." Nunca invente um motivo genérico
se não souber o real — descreva o que de fato levou à transferência.
Se retornar jaSolicitado:true, o atendimento já está aguardando humano — não é erro, não
repita a chamada, apenas continue normalmente (não responda mais nada como se fosse
resolver sozinha).
```

**Body Parameters (JSON):**

| Nome | Tipo | Obrigatório | isUserProvided | Descrição |
|---|---|---|---|---|
| `conversationId` | string | **Sim** | **true** | Valor do marcador `[ID_ATENDIMENTO: X]` — mesmo valor usado em TODAS as outras Tools |
| `organizationId` | string | **Sim** | **false** | Valor fixo: `cmmmk6oqi02hmlcxugbddv62q` |
| `requestId` | string | **Sim** | **true** | Novo requestId único (mesmo padrão de geração das outras Tools) |
| `motivo` | string | **Sim** | **true** | Frase curta e específica do motivo real da transferência |

**Retorna:** `{ok:true, jaSolicitado:false}` (primeira vez, handoff efetivado) ou
`{ok:true, jaSolicitado:true}` (já estava aguardando humano/já era humano/já resolvido — não é erro).

---

## PARTE 2 — Patch no prompt (v0.3 → aditivo, não substitui)

### 2.1 — Na lista "Tools configuradas" (topo do documento), adicionar:

```
- solicitar_atendimento_humano (NOVA — acende o badge do ERP, chamar junto com Solicitar Humano)
```

### 2.2 — Localizar este trecho exato no prompt (seção "QUANDO CHAMAR SOLICITAR HUMANO"):

```
- Após encaminhar VR personalizado (sempre transfira também para humano).
```

Substituir por (adiciona 3 linhas, mantém a linha original):

```
- Após encaminhar VR personalizado (sempre transfira também para humano).

IMPORTANTE: toda vez que você chamar "Solicitar Humano" por qualquer um dos
motivos acima, chame TAMBÉM solicitar_atendimento_humano no mesmo turno,
com um motivo curto e específico (nunca genérico) do que está acontecendo.
As duas chamadas juntas, sempre — nunca uma sem a outra.
```

Nenhuma outra condição da lista muda — as 10 condições já calibradas continuam exatamente as
mesmas (evita falso positivo, como já pedido no prompt original).

---

## PARTE 3 — Teste manual pós-configuração (antes de considerar concluído)

No painel de teste do Chatvolt (ou numa conversa de WhatsApp de teste):

1. Envie "Quero falar com uma pessoa" → confirme que a Valéria chama **as duas** Tools
   ("Solicitar Humano" + `solicitar_atendimento_humano`) no mesmo turno.
2. Confirme no ERP (Atendimentos) que o atendimento correspondente virou "⏳ Aguardando humano"
   e o contador do sidebar aumentou.
3. Envie uma segunda mensagem qualquer na mesma conversa → confirme que NÃO dispara um segundo
   handoff (a Tool deve responder `jaSolicitado:true`, sem duplicar).

---

## Rollback

Basta remover as 3 linhas adicionadas na seção "QUANDO CHAMAR SOLICITAR HUMANO" e desativar/
remover a Tool `solicitar_atendimento_humano` no Chatvolt. Nenhuma outra parte do prompt v0.3 é
afetada — é um patch isolado e reversível.
