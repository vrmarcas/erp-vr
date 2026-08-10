# Valéria — Snapshot de Configuração Chatvolt (pré-Fase 2A)

**Data:** 2026-08-10
**AgentId:** cmmmkciwb02j8lcxudbnwv31y
**OrganizationId:** cmmmk6oqi02hmlcxugbddv62q
**URL do agente:** https://app.chatvolt.ai/pt-BR/agents/cmmmkciwb02j8lcxudbnwv31y
**Plano:** Pro
**Modelo:** GPT-4.1 Mini
**Visibilidade:** private

---

## Ferramentas Ativas (9) — estado antes da Fase 2A

| # | Nome | Tipo | Descrição (truncada) |
|---|---|---|---|
| 1 | `buscar_contexto_da_conversa` | HTTP Tool | "Execute no início do atendimento e sempre que precisar saber se o cliente e a oportunidade desta con..." |
| 2 | `atualizar_briefing` | HTTP Tool | "Execute sempre que surgir informação nova e confiável sobre a demanda (produto, medidas, material, p..." |
| 3 | `Marcar como Resolvido` | Built-in | "O agente detecta automaticamente quando o usuário está satisfeito, agradece ou se despede, e marca a..." |
| 4 | `Solicitar Humano` | Built-in | "Permite que o usuário solicite atendimento humano. Quando ativado, o agente transfere a conversa par..." |
| 5 | `criar_ou_atualizar_cliente` | HTTP Tool | "Execute para cadastrar ou atualizar dados do cliente (nome, telefone, email, documento) assim que ho..." |
| 6 | `consultar_catalogo` | HTTP Tool | "Execute para consultar produtos e famílias disponíveis no catálogo antes de falar sobre produto, mat..." |
| 7 | `Respostas com Atraso` | Built-in | "O agente aguardará um tempo antes de responder, agrupando mensagens do usuário em uma única resposta..." |
| 8 | `🧠 Valéria — Conhecimento Validado` | Datastore | Base de conhecimento |
| 9 | `abrir_oportunidade` | HTTP Tool | "Execute para criar ou localizar a oportunidade comercial desta demanda antes de salvar o briefing. N..." |

---

## Tools a adicionar na Fase 2A (7 Vitre HTTP Tools)

1. `buscar_catalogo_vitre` → valeriaVitreBuscarCatalogo (GET)
2. `consultar_produto_vitre` → valeriaVitreConsultarProduto (GET)
3. `simular_orcamento_vitre` → valeriaVitreSimularOrcamento (POST)
4. `criar_rascunho_vitre` → valeriaVitreCriarRascunho (POST)
5. `atualizar_rascunho_vitre` → valeriaVitreAtualizarRascunho (POST)
6. `consultar_rascunho_vitre` → valeriaVitreConsultarRascunho (GET)
7. `encaminhar_para_vr_personalizado` → valeriaVitreEncaminharVR (POST)

---

## Rollback

Para reverter à configuração pré-Fase 2A: remover as 7 Vitre HTTP Tools adicionadas acima.
O prompt do agente antes da Fase 2A está documentado na seção C4 de
`scripts/VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md` e no prompt v0.1 em
`scripts/VALERIA_PROMPT_V0.1_2026-08-09.md`.

---

## Outras configurações observadas

- Plano: Pro
- Créditos: 30 / 30.000 (renova em 04/09/2026)
- MM palavras: 0,00 / 60
- Agentes: 1 / 5
- Bases de conhecimento: 1 / 10
- Disp. WhatsApp: 0 / 400 (não conectado — correto para esta fase)
