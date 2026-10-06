# Rollback — limpeza de Tools do agente Valéria (Fase E.2, 2026-09-20)

**STATUS: EXECUTADA E CONFIRMADA.** Releitura pós-reload confirmou exatamente
6 Ferramentas Ativas (4 alvo + 2 fora de escopo preservadas). Ver relatório
do checkpoint na conversa para o detalhamento completo.

Registrado ANTES de remover qualquer Tool, por autorização explícita do
Gabriel. Ver também `CHATVOLT_SNAPSHOT_PRE_V2_2026-09-20.md` (snapshot
completo capturado antes de qualquer mudança da Fase E.2, inclusive corpo
V1 do prompt e configuração detalhada das Tools legadas removidas aqui).

## Estado ANTES desta limpeza — 24 Ferramentas Ativas

1. Marcar como Resolvido (nativa) — **REMOVIDA nesta limpeza**
2. Solicitar Humano (nativa) — **MANTIDA** (é a Tool `transferir_para_humano` do prompt V2, após correção)
3. criar_ou_atualizar_cliente — **REMOVIDA**
4. consultar_materiais_vr — **REMOVIDA**
5. simular_orcamento_vitre — **REMOVIDA**
6. valeria_get_catalog — **MANTIDA** (V2)
7. valeria_update_catalog_qualification — **MANTIDA** (V2)
8. consultar_catalogo — **REMOVIDA**
9. buscar_contexto_da_conversa — **MANTIDA** (V2)
10. consultar_prazo_producao — **REMOVIDA**
11. encaminhar_para_vr_personalizado — **REMOVIDA**
12. consultar_produto_vitre — **REMOVIDA**
13. criar_orcamento_vr — **REMOVIDA**
14. calcular_produto_personalizado — **REMOVIDA**
15. preparar_produto_personalizado — **REMOVIDA**
16. verificar_encaixe_producao — **REMOVIDA**
17. Respostas com Atraso (nativa, feature de comportamento — não é uma Tool chamável pelo LLM) — **NÃO TOCADA**, fora do escopo (não é "Tool" no sentido de function-calling; aguardando confirmação explícita do Gabriel se deve ser removida também)
18. 🧠 Valéria — Conhecimento Validado (base de conhecimento/datastore) — **NÃO TOCADA**, fora do escopo pelo mesmo motivo, e remover uma base de conhecimento é uma ação de impacto distinto (perda de grounding), não coberta pela autorização desta etapa
19. buscar_catalogo_vitre — **REMOVIDA**
20. atualizar_rascunho_vitre — **REMOVIDA**
21. consultar_rascunho_vitre — **REMOVIDA**
22. atualizar_briefing_tecnico — **REMOVIDA**
23. abrir_oportunidade — **REMOVIDA**
24. criar_rascunho_vitre — **REMOVIDA**

## Estado ESPERADO depois desta limpeza — 6 itens ativos

- buscar_contexto_da_conversa (Tool V2)
- valeria_get_catalog (Tool V2)
- valeria_update_catalog_qualification (Tool V2)
- Solicitar Humano (Tool nativa, = `transferir_para_humano` do prompt)
- Respostas com Atraso (feature nativa, não removida — fora do escopo desta limpeza)
- 🧠 Valéria — Conhecimento Validado (base de conhecimento, não removida — fora do escopo desta limpeza)

## Como reverter

As 18 Tools HTTP customizadas removidas (`criar_ou_atualizar_cliente`,
`consultar_materiais_vr`, `simular_orcamento_vitre`, `consultar_catalogo`,
`consultar_prazo_producao`, `encaminhar_para_vr_personalizado`,
`consultar_produto_vitre`, `criar_orcamento_vr`,
`calcular_produto_personalizado`, `preparar_produto_personalizado`,
`verificar_encaixe_producao`, `buscar_catalogo_vitre`,
`atualizar_rascunho_vitre`, `consultar_rascunho_vitre`,
`atualizar_briefing_tecnico`, `abrir_oportunidade`, `criar_rascunho_vitre`)
têm sua configuração completa (URL, Body, Headers) documentada em
`CHATVOLT_SNAPSHOT_PRE_V2_2026-09-20.md` (capturado antes de qualquer
mudança desta fase) — recriar manualmente cada uma com os mesmos dados
reverte esta limpeza. `Marcar como Resolvido` é uma feature nativa
(toggle "Adicionar" na lista de Ferramentas Disponíveis), reativável em
1 clique sem precisar de nenhum dado salvo.
