# Parte 10 — Revisão Final Valéria + Execução dos 17 Cenários

## Não configurado no Chatvolt real

Nada nesta rodada tocou credenciais/API key do Chatvolt nem criou um
agente real — todas as verificações abaixo usam chamadas HTTP diretas
contra as Cloud Functions reais no Emulator, o mesmo transporte que o
Chatvolt usaria numa configuração futura (ver plano na Parte 12).

## O que mudou nesta rodada (correção real, não só teste)

Ao mapear o cenário "personalização permitida/não permitida" contra o
código existente, encontrei que `valeriaVitreSimularOrcamento` e
`valeriaVitreCriarRascunho` **não tinham nenhum suporte a
personalização/adicional** — o campo simplesmente não existia nessas
duas Functions, mesmo a Function irmã usada pelo ERP
(`vitreCriarOrcamento`, `functions/src/vitre.ts`) já suportando. Sem
isso, não havia como testar de verdade os cenários 8 e 9 da instrução.

Implementado: as duas Functions agora aceitam `adicionais:[{nome}]`
por item. O preço da personalização **sempre vem do catálogo**
(`produto.personalizacoes`), nunca do valor que o agente/cliente
informar no payload — testado explicitamente (teste 19: payload pede
preço `0.01`, resposta usa o preço real `25` cadastrado no produto).
Uma personalização pedida que não existir na lista do produto é
**rejeitada explicitamente** em `adicionaisRejeitados` (nunca aplicada
em silêncio) — o agente precisa saber disso para explicar ao cliente,
em vez de calcular um total que finge incluir algo que não foi
adicionado.

**Achado registrado, não corrigido nesta rodada (fora de escopo — é
código pré-existente de `vitre.ts`, usado pelo ERP, não pela
Valéria):** a Function real `vitreCriarOrcamento` também aceita
`adicionais` por item, mas usa o **preço que o próprio cliente
(payload) informou** para cada adicional, só validando o `nome` contra
`prod.personalizacoes` — nunca revalidando o `preco`. Um Comercial mal-
intencionado (ou um bug no frontend) poderia gravar uma personalização
por um preço menor que o cadastrado. Como a Valéria é uma superfície
externa (fala com o público, não com staff autenticado), implementei a
versão correta lá (preço sempre do servidor); o mesmo ajuste em
`vitre.ts` fica registrado aqui como pendência de decisão humana, já
que exige revisão de quem mais depende desse comportamento hoje.

## Os 17 cenários — mapeamento completo

Ver tabela detalhada em
`scripts/VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md` (seção C5,
atualizada nesta rodada). Resumo:

| # | Cenário | Resultado |
|---|---|---|
| 1 | PF → Vitre | ✅ estrutural — nenhuma Function lê CPF/CNPJ |
| 2 | PJ → Vitre | ✅ estrutural — idem |
| 3 | PF → VR | ✅ estrutural — motivo do handoff é sempre sobre o produto, nunca sobre o documento |
| 4 | PJ → VR | ✅ estrutural — idem |
| 5 | Produto exato | ✅ testado |
| 6 | Produto semelhante | ✅ testado (busca por sinônimo/uso) |
| 7 | Tamanho inexistente | ✅ testado (nunca aproxima para outro produto) |
| 8 | Personalização permitida | ✅ testado (implementado nesta rodada) |
| 9 | Personalização não permitida | ✅ testado (implementado nesta rodada) |
| 10 | Produto incompleto | ✅ testado (5 variações: nível insuficiente, preço/prazo/foto isolados) |
| 11 | Produto desativado | ✅ testado |
| 12 | Preço ausente | ✅ testado |
| 13 | Prazo ausente | ✅ testado |
| 14 | Desconto | ✅ testado |
| 15 | Foto | ✅ testado |
| 16 | Pedido misto | ✅ testado (rascunho + handoff separados, nunca no mesmo registro) |
| 17 | Transferência humana | ✅ testado |

**17/17 cobertos.** Suíte completa: `scripts/test_valeria_vitre_server.js`,
**25/25 passando** (15 originais da preparação + 10 novos desta
rodada).

## Regras C1-C4 revisadas e confirmadas nesta rodada

- **C1 (CPF/CNPJ nunca decide):** confirmado estruturalmente — nenhuma
  das 5 Functions em `valeria_vitre.ts` tem qualquer campo, leitura ou
  branch relacionado a CPF/CNPJ/tipo de pessoa (`grep` confirma a única
  ocorrência da palavra é no comentário que EXPLICA a regra).
- **C2 (nunca expõe custo/margem/markup/caminho de arquivo):**
  confirmado — `produtoParaValeria` é whitelist explícita, testado
  (teste 3: resposta inteira verificada por `indexOf('custo') < 0`).
- **C3 (elegibilidade automática):** confirmado e agora testado
  isoladamente para cada critério (status, preço, prazo, foto,
  descrição, nível) em vez de só coletivamente.
- **C4 (Actions map + prompt base):** revisado e atualizado nesta
  rodada — payload de `simular_orcamento_vitre`/
  `criar_rascunho_orcamento_vitre` documentado com o novo campo
  `adicionais`, prompt base ganhou uma frase explícita sobre como
  comunicar personalização rejeitada ao cliente.

## Isolamento, idempotência, rate limit, fail-closed — reconfirmados

- `conversationId`+`organizationId` obrigatórios em toda escrita
  (teste 10), efetivos entre conversas simultâneas do mesmo cliente
  (teste 13).
- Idempotência por `requestId` via `acquireIdem` — mesmo padrão de
  `vitre.ts`/`compras.ts` (teste 12).
- Rate limit: reaproveita o `checkAuth` já existente de `valeria.ts`
  (não há um limitador dedicado nesta preparação — mesma decisão já
  registrada na sessão anterior, pendência para a configuração real do
  Chatvolt, que tem seu próprio controle de taxa).
- Fail-closed: qualquer item inválido bloqueia a simulação/rascunho
  inteiro (testes 9, 25), nunca cria/calcula parcialmente.
