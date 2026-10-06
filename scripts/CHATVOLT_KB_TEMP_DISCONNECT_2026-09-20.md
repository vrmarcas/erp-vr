# Desconexão temporária da KB "🧠 Valéria — Conhecimento Validado" do agente Valéria

**Motivo:** bug reproduzido de corrupção de persistência ao salvar o documento
da KB (ver `CHATVOLT_KB_SAVE_CORRUPTION_BUG_2026-09-20.md`). Isolamento
controlado autorizado pelo Gabriel em 20/09/2026, enquanto o bug não é
resolvido pelo suporte do ChatVolt.

## Estado ANTES da desconexão

- Ferramentas Ativas do agente Valéria: 6
  1. Solicitar Humano
  2. valeria_get_catalog
  3. valeria_update_catalog_qualification
  4. buscar_contexto_da_conversa
  5. Respostas com Atraso
  6. 🧠 Valéria — Conhecimento Validado (datastore `cms2g1u512m4vw0qpfz7cgfj7_v3`)

## Ação executada

Removida apenas a conexão da Ferramenta "🧠 Valéria — Conhecimento Validado"
(botão ⊖ em Ferramentas Ativas → Salvar), sem apagar a base de conhecimento
em si e sem tocar no documento "Manual comercial validado — 2026" (que
permanece preservado no estado corrompido registrado no relatório de bug,
para auditoria).

## Estado DEPOIS da desconexão (confirmado via reload completo)

- Ferramentas Ativas do agente Valéria: 5
  1. Solicitar Humano
  2. valeria_get_catalog
  3. valeria_update_catalog_qualification
  4. buscar_contexto_da_conversa
  5. Respostas com Atraso
- A Ferramenta "🧠 Valéria — Conhecimento Validado" não aparece mais em
  Ferramentas Ativas; continua disponível em "Ferramentas Disponíveis" →
  "Conectar Base de Conhecimento" para religar quando decidido.
- A base de conhecimento em si (datastore e documento) não foi alterada nem
  apagada nesta ação.

## Como reverter (reconectar a KB)

1. Ir em Agente Valéria → Configurações → Ferramentas.
2. Em "Ferramentas Disponíveis", localizar "Conectar Base de Conhecimento".
3. Selecionar a base "Valéria — Conhecimento Validado".
4. Clicar em "Salvar" para persistir a reconexão.
5. Recarregar a página inteira e confirmar que "Ferramentas Ativas" volta a
   mostrar 6 itens, com a KB novamente presente.

Isso não requer nenhuma edição do documento em si — apenas restaura a
referência entre o agente e o datastore.
