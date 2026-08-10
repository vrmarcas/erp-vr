# Valéria Fase 2A — Guia de Configuração Manual Chatvolt

**Data:** 2026-08-10
**Agente:** Valéria (`cmmmkciwb02j8lcxudbnwv31y`)
**URL:** https://app.chatvolt.ai/pt-BR/agents/cmmmkciwb02j8lcxudbnwv31y?tab=settings&settingTab=tools
**Status atual:** 9 ferramentas. Meta: adicionar 7 HTTP Tools Vitre + atualizar prompt para v0.2.

> **SEGURANÇA:** Nunca compartilhe o bearer em log, relatório ou mensagem.
> O bearer é o valor JSON `secret` de `erp_vr/valeria_config` no Firestore — o mesmo já
> configurado nas 5 tools HTTP existentes. Não precisa gerar um novo.

---

## PARTE 1 — Adicionar 7 HTTP Tools Vitre

Para cada tool: clique **"Adicionar"** ao lado de "HTTP-Tools: Integrar o agente em uma API",
depois preencha os campos conforme descrito abaixo. O bearer deve ser colado manualmente.

---

### Tool 1: buscar_catalogo_vitre

| Campo | Valor |
|---|---|
| **Nome** | `buscar_catalogo_vitre` |
| **Método** | `GET` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreBuscarCatalogo` |
| **Header** | `Authorization: Bearer <secret>` (colar o bearer manualmente) |

**Descrição para o agente:**
```
Execute para buscar produtos prontos do catálogo Vitre.
Use quando o cliente descrever o que precisa por categoria, uso ou palavra-chave.
Parâmetros opcionais: q (palavra-chave), categoria, precoMin, precoMax, limite (máx 30).
NUNCA invente produto, preço, prazo ou disponibilidade — só informe o que esta tool confirmar.
Retorna: {ok, total, produtos:[{sku, nome, categoria, precoVenda, prazoDias, disponibilidade,
descricaoCurta, fotos, personalizacoesPermitidas}]}
```

**Query Parameters:**

| Nome | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `q` | string | Não | Palavra-chave de busca |
| `categoria` | string | Não | Categoria exata (lowercase) |
| `precoMin` | number | Não | Preço mínimo de venda |
| `precoMax` | number | Não | Preço máximo de venda |
| `limite` | number | Não | Máximo de resultados (padrão 10, máx 30) |

---

### Tool 2: consultar_produto_vitre

| Campo | Valor |
|---|---|
| **Nome** | `consultar_produto_vitre` |
| **Método** | `GET` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreConsultarProduto` |
| **Header** | `Authorization: Bearer <secret>` |

**Descrição para o agente:**
```
Execute para consultar um produto Vitre específico por SKU e verificar se está elegível.
Use quando o cliente mencionar um SKU específico ou quando buscar_catalogo_vitre retornar
um candidato e você quiser confirmar a elegibilidade.
Se retornar elegivel:false com motivo:SKU_NAO_ENCONTRADO, não tente aproximar para outro produto.
Retorna: {ok, elegivel, produto?, motivo?}
```

**Query Parameters:**

| Nome | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `sku` | string | **Sim** | SKU exato do produto |

---

### Tool 3: simular_orcamento_vitre

| Campo | Valor |
|---|---|
| **Nome** | `simular_orcamento_vitre` |
| **Método** | `POST` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreSimularOrcamento` |
| **Header** | `Authorization: Bearer <secret>` |

**Descrição para o agente:**
```
Execute para calcular o total de um orçamento Vitre ANTES de criar o rascunho.
Use obrigatoriamente antes de criar_rascunho_vitre — nunca pule esta etapa.
Mostre o total ao cliente e pergunte confirmação antes de criar o rascunho.
Se personalizações pedidas vierem em adicionaisRejeitados, diga claramente ao cliente
que aquela opção não está disponível — nunca finja que foi aplicada.
NÃO persiste: não cria nenhum documento.
Retorna: {ok, itens, subtotal, descontoPct, valorDesconto, frete, total}
  ou {ok:false, error: "PRODUTO_NAO_ENCONTRADO:SKU"|"PRODUTO_NAO_ELEGIVEL:SKU"}
```

**Body Parameters (JSON):**

| Nome | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `itens` | array | **Sim** | `[{"sku":"...","qtd":1,"adicionais":[{"nome":"..."}]}]` |
| `descontoPct` | number | Não | Percentual de desconto (0-100) |
| `frete` | number | Não | Valor do frete |

---

### Tool 4: criar_rascunho_vitre

| Campo | Valor |
|---|---|
| **Nome** | `criar_rascunho_vitre` |
| **Método** | `POST` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreCriarRascunho` |
| **Header** | `Authorization: Bearer <secret>` |

**Descrição para o agente:**
```
Execute para criar um rascunho de orçamento Vitre no sistema, SOMENTE após:
1. simular_orcamento_vitre retornar o total
2. O cliente confirmar que quer seguir com o orçamento
Informe ao cliente que o orçamento foi registrado e que a equipe vai revisar e enviar a proposta formal.
Gere um requestId único para cada chamada (formato: "val_" + 8 chars aleatórios, ex: "val_4k9mXp2z").
Nunca reutilize o mesmo requestId em operações diferentes.
Retorna: {ok, jaProcessado, id, total, adicionaisRejeitados}
```

**Body Parameters (JSON):**

| Nome | Tipo | Obrigatório | isUserProvided | Descrição |
|---|---|---|---|---|
| `conversationId` | string | **Sim** | **false** | Valor fixo: `{conversation-id}` |
| `organizationId` | string | **Sim** | **false** | Valor fixo: `cmmmk6oqi02hmlcxugbddv62q` |
| `requestId` | string | **Sim** | **true** | Gerado pelo modelo (único por operação) |
| `clienteNome` | string | **Sim** | **true** | Nome do cliente |
| `itens` | array | **Sim** | **true** | `[{"sku":"...","qtd":1,"adicionais":[{"nome":"..."}]}]` |
| `descontoPct` | number | Não | **true** | Percentual de desconto |
| `frete` | number | Não | **true** | Valor do frete |
| `prazoValidadeDias` | number | Não | **true** | Prazo de validade (padrão: 7 dias) |

---

### Tool 5: atualizar_rascunho_vitre

| Campo | Valor |
|---|---|
| **Nome** | `atualizar_rascunho_vitre` |
| **Método** | `POST` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreAtualizarRascunho` |
| **Header** | `Authorization: Bearer <secret>` |

**Descrição para o agente:**
```
Execute para atualizar um rascunho Vitre já criado (cliente mudou de ideia antes do envio).
Exige o orcamentoId retornado por criar_rascunho_vitre.
Gere um requestId NOVO (diferente do usado na criação) para cada atualização.
Se retornar ORCAMENTO_NAO_EDITAVEL, informe que o orçamento já saiu de rascunho e
chame Solicitar Humano.
Retorna: {ok, orcamentoId, total, adicionaisRejeitados}
  ou erros: ORCAMENTO_NAO_ENCONTRADO, ORCAMENTO_OUTRA_CONVERSA, ORCAMENTO_NAO_EDITAVEL:status=...
```

**Body Parameters (JSON):**

| Nome | Tipo | Obrigatório | isUserProvided | Descrição |
|---|---|---|---|---|
| `conversationId` | string | **Sim** | **false** | Valor fixo: `{conversation-id}` |
| `organizationId` | string | **Sim** | **false** | Valor fixo: `cmmmk6oqi02hmlcxugbddv62q` |
| `orcamentoId` | string | **Sim** | **true** | ID retornado por criar_rascunho_vitre |
| `requestId` | string | **Sim** | **true** | Novo requestId único (diferente da criação) |
| `itens` | array | **Sim** | **true** | Lista completa de itens (substitui os anteriores) |
| `descontoPct` | number | Não | **true** | Percentual de desconto |
| `frete` | number | Não | **true** | Valor do frete |

---

### Tool 6: consultar_rascunho_vitre

| Campo | Valor |
|---|---|
| **Nome** | `consultar_rascunho_vitre` |
| **Método** | `GET` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreConsultarRascunho` |
| **Header** | `Authorization: Bearer <secret>` |

**Descrição para o agente:**
```
Execute quando o cliente perguntar como ficou o orçamento ou quiser ver o resumo do rascunho.
Exige o orcamentoId (retornado por criar_rascunho_vitre), conversationId e organizationId.
Retorna: {ok, orcamentoId, status, clienteNome, itens, subtotal, descontoPct,
  valorDesconto, frete, total, prazoValidadeDias, criadoEm, atualizadoEm}
```

**Query Parameters:**

| Nome | Tipo | Obrigatório | isUserProvided | Descrição |
|---|---|---|---|---|
| `orcamentoId` | string | **Sim** | **true** | ID do rascunho |
| `conversationId` | string | **Sim** | **false** | Valor fixo: `{conversation-id}` |
| `organizationId` | string | **Sim** | **false** | Valor fixo: `cmmmk6oqi02hmlcxugbddv62q` |

---

### Tool 7: encaminhar_para_vr_personalizado

| Campo | Valor |
|---|---|
| **Nome** | `encaminhar_para_vr_personalizado` |
| **Método** | `POST` |
| **URL** | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreEncaminharVR` |
| **Header** | `Authorization: Bearer <secret>` |

**Descrição para o agente:**
```
Execute quando a necessidade do cliente sair das regras do catálogo Vitre:
medida fora do padrão, material não catalogado, personalização não permitida,
arquivo/projeto exclusivo, SKU inexistente, produto incompleto, cliente indeciso.
OBRIGATÓRIO: após chamar esta tool, chame também Solicitar Humano para transferir a conversa.
Motivos válidos (usar exatamente): "medida_fora_do_padrao", "material_nao_catalogado",
"alteracao_nao_permitida", "arquivo_projeto_exclusivo", "sku_inexistente",
"produto_incompleto", "cliente_indeciso", "outro".
Retorna: {ok, id} ou {ok:true, jaProcessado:true}
```

**Body Parameters (JSON):**

| Nome | Tipo | Obrigatório | isUserProvided | Descrição |
|---|---|---|---|---|
| `conversationId` | string | **Sim** | **false** | Valor fixo: `{conversation-id}` |
| `organizationId` | string | **Sim** | **false** | Valor fixo: `cmmmk6oqi02hmlcxugbddv62q` |
| `clienteNome` | string | **Sim** | **true** | Nome do cliente |
| `requestId` | string | **Sim** | **true** | Novo requestId único |
| `motivo` | string | **Sim** | **true** | Um dos motivos da lista acima |
| `clienteTel` | string | Não | **true** | Telefone do cliente |
| `detalhe` | string | Não | **true** | Contexto adicional para o especialista VR |

---

## PARTE 2 — Atualizar Prompt para v0.2

Navegue para: Configurações → Geral & Flux → campo de prompt do agente.

Salve o prompt atual antes de substituir (rollback disponível em scripts/VALERIA_PROMPT_V0.1_2026-08-09.md e na seção C4 de VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md).

Substitua pelo conteúdo completo de `scripts/VALERIA_PROMPT_V0.2_2026-08-10.md` (seção "Prompt").

---

## PARTE 3 — Checklist pós-configuração

Antes do E2E, teste cada tool individualmente no chat de teste do Chatvolt:

| # | Tool | Mensagem de teste | Resultado esperado |
|---|---|---|---|
| T1 | buscar_catalogo_vitre | "Quero um aparador de acrílico" | Tool chamada, retorna lista de produtos ou total:0 |
| T2 | consultar_produto_vitre | "Qual o SKU VT-APAR-001?" (usar SKU real) | elegivel:true ou elegivel:false com motivo |
| T3 | simular_orcamento_vitre | "Quero 2 aparadores VT-APAR-001" | Total calculado, sem criar documento |
| T4 | criar_rascunho_vitre | "Pode criar o orçamento" (após T3) | id retornado, rascunho criado |
| T5 | atualizar_rascunho_vitre | "Mudei, quero 3 unidades" (após T4) | orcamentoId + novo total |
| T6 | consultar_rascunho_vitre | "Como ficou meu orçamento?" | Resumo do rascunho |
| T7 | encaminhar_para_vr_personalizado | "Preciso de 50x80cm com logotipo" | handoff_id criado + transfer |

Verificar Firestore após T4, T5, T7:
- `vitre_orcamentos/{id}` existe e tem `origem:"valeria"` e `status:"rascunho"` (T4, T5)
- `valeria_handoffs/{id}` existe e tem `status:"pendente"` (T7)

---

## PARTE 4 — Cenários E2E C1–C15 (Web Chat)

URL do Web Chat: https://app.chatvolt.ai/pt-BR/agents/cmmmkciwb02j8lcxudbnwv31y (tab Chat)

| # | Cenário | Mensagem inicial | O que verificar |
|---|---|---|---|
| C1 | PF, Vitre catálogo | "Oi, sou João, pessoa física. Quero uma caixa de acrílico de catálogo." | Fluxo busca → simulação → rascunho. Não pergunta CPF/CNPJ para decidir. |
| C2 | PJ, Vitre catálogo | "Somos a empresa XYZ Ltda. Preciso de produtos Vitre para loja." | Mesma lógica — decisão por produto, não CNPJ. |
| C3 | PF, VR personalizado | "Quero um painel de 150x80cm sob medida com logotipo." | Encaminha para VR, não tenta resolver sozinha. |
| C4 | PJ, VR personalizado | "Preciso de 200 letreiros em acrílico com nossas medidas: 40x20cm." | Encaminha para VR. |
| C5 | Produto exato por SKU | Citar um SKU real do catálogo Vitre. | consultar_produto_vitre chamado, elegivel:true, detalhes exibidos. |
| C6 | Busca por categoria | "Tem algo na categoria suporte?" | buscar_catalogo_vitre com categoria="suporte". |
| C7 | Produto não encontrado | Citar SKU fictício "VT-XXXX-999". | elegivel:false, motivo SKU_NAO_ENCONTRADO — sem inventar alternativa. |
| C8 | Personalização permitida | Pedir personalização que existe em personalizacoesPermitidas do produto. | simular com adicional, preço do catálogo exibido. |
| C9 | Personalização não permitida | Pedir personalização que não existe no produto. | adicionaisRejeitados explicitado ao cliente, sem fingir que foi aplicada. |
| C10 | Produto inelegível | Pedir produto com nivel < 2 ou inativo (se houver). | elegivel:false — agente não oferece. |
| C11 | Rascunho e atualização | Criar rascunho, depois mudar item/quantidade. | atualizar_rascunho_vitre chamado, novo total correto. |
| C12 | Consulta de rascunho | Após criar rascunho, perguntar "como ficou?" | consultar_rascunho_vitre, resumo exibido. |
| C13 | Pedido de desconto | "Você me dá desconto?" | Nunca negocia — explica que verifica com a equipe e chame Solicitar Humano. |
| C14 | Transferência para humano | "Quero falar com uma pessoa." | Solicitar Humano chamado imediatamente. |
| C15 | Início com contexto existente | Segunda mensagem na mesma conversa. | buscar_contexto_da_conversa retorna dados anteriores, não recomece. |

---

## PARTE 5 — Monitoramento valeria_api_log

Durante os testes, verificar no Firestore (coleção `valeria_api_log`):
```
gcloud firestore documents list valeria_api_log --project=erp-vrmarcas \
  --format="table(name,fields.action,fields.resultado,fields.latenciaMs)"
```

Ou via REST:
```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/erp-vrmarcas/databases/(default)/documents/valeria_api_log?orderBy=criadoEm+desc&pageSize=20" \
  | python3 -c "import sys,json; docs=json.load(sys.stdin).get('documents',[]); [print(d['name'].split('/')[-1], d.get('fields',{}).get('action',{}).get('stringValue',''), d.get('fields',{}).get('resultado',{}).get('stringValue','')) for d in docs]"
```

---

## Ordem de execução recomendada

1. [ ] Adicionar as 7 HTTP Tools (Parte 1) — incluindo bearer em cada uma
2. [ ] Clicar "Enviar" / "Salvar" no painel de Ferramentas
3. [ ] Atualizar o prompt para v0.2 (Parte 2)
4. [ ] Salvar as configurações do agente
5. [ ] Executar testes individuais T1–T7 (Parte 3)
6. [ ] Verificar Firestore (Parte 5) após T4, T5, T7
7. [ ] Executar cenários E2E C1–C15 (Parte 4)
8. [ ] Resultado: GO ou NO-GO para fase WhatsApp
