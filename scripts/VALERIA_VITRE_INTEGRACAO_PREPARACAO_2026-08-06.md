# Preparação da Integração Valéria × Catálogo Vitre — Fase G, Parte C

**Status: PREPARAÇÃO APENAS.** Nada neste documento foi configurado no Chatvolt.
Nenhum agente real foi conectado às Functions descritas aqui. Todo o conteúdo
foi testado apenas via HTTP direto contra o Functions Emulator
(`scripts/test_valeria_vitre_server.js`, 15/15 cenários passando), nunca via
Chatvolt real. Configuração real fica para uma rodada futura, explicitamente
autorizada por escrito.

## C1 — Regra de classificação (VR Personalizado × Vitre Catálogo)

**A regra NÃO é `CPF → Vitre` / `CNPJ → VR`.** CPF/CNPJ é só um sinal comercial
de contexto (pessoa física às vezes quer produto sob medida; empresa às vezes
compra produto pronto de catálogo) — nunca a decisão final.

A decisão real segue esta sequência, nesta ordem:

1. **Entender a necessidade** — o que o cliente quer, para quê, com que urgência.
2. **Buscar no catálogo** (`valeriaVitreBuscarCatalogo`) por nome, sinônimo,
   categoria, uso ou faixa de preço.
3. **Existe SKU compatível?** Se não — vai para VR Personalizado.
4. **Existe variante que atende?** (tamanho, cor, material dentro do que o SKU
   já suporta.)
5. **A personalização pedida está na lista `personalizacoesPermitidas` do
   produto?** Se sim — Vitre com adicional. Se pede algo fora dessa lista
   (gravação num formato não suportado, alteração de material, mudança de
   proporção) — VR Personalizado.
6. **Prazo e disponibilidade são confiáveis?** (`prazoDias` presente,
   `disponibilidade` definida.) Produto sem essas informações nunca é
   oferecido automaticamente (ver C3).
7. **Roteamento final:**
   - `"SKU existe e satisfai"` → **Vitre**, sem adicional.
   - `"SKU existe + personalização permitida"` → **Vitre**, com adicional
     (preço do adicional vem de `personalizacoesPermitidas[].preco`, nunca
     inventado).
   - `"Precisa de algo fora das regras do SKU"` (medida nova, material fora
     do catálogo, alteração não listada, arquivo/projeto exclusivo) →
     **VR Personalizado** — a Valéria chama `valeriaVitreEncaminharVR` e
     para de tentar resolver sozinha.

## C2 — Contratos das Functions (preparadas, não deployadas em produção real)

Todas em `functions/src/valeria_vitre.ts`, exportadas em `functions/src/index.ts`.
Autenticação: `Authorization: Bearer <VALERIA_SECRET>` (mesmo mecanismo já
existente em `valeria.ts` — token comparado com `erp_vr/valeria_config.secret`
no Firestore, não Secret Manager, reaproveitado sem alteração). Nunca expõem
custo, margem, markup, caminho de arquivo, configuração interna, produto
desativado, produto abaixo do nível mínimo, prazo não confiável ou preço não
confirmado — a whitelist de campos (`produtoParaValeria`) é a única porta de
saída de dado de produto.

| Function | Método | Payload | Resposta | Erros |
|---|---|---|---|---|
| `valeriaVitreBuscarCatalogo` | GET | `?q=&categoria=&precoMin=&precoMax=&limite=` | `{ok, total, produtos:[...]}` | 401 sem/token errado |
| `valeriaVitreConsultarProduto` | GET | `?sku=` | `{ok, elegivel, produto?, motivo?}` | nunca 500 para SKU ausente — sempre `elegivel:false` |
| `valeriaVitreSimularOrcamento` | POST | `{itens:[{sku,qtd}], descontoPct?, frete?}` | `{ok, itens, subtotal, total, ...}` ou `{ok:false, error}` | fail-closed no primeiro item inválido, nunca persiste |
| `valeriaVitreCriarRascunho` | POST | `{clienteNome, itens, descontoPct?, frete?, prazoValidadeDias?, requestId, conversationId, organizationId}` | `{ok, id, total}` | 400 sem `conversationId`/`organizationId`/`requestId`; idempotente por `requestId` |
| `valeriaVitreEncaminharVR` | POST | `{clienteNome, clienteTel?, motivo, detalhe?, requestId, conversationId, organizationId}` | `{ok, id}` | motivo inválido normaliza para `"outro"`, nunca quebra |

Idempotência: `acquireIdem` (mesmo helper de `vitre.ts`/`compras.ts`), chave
`valeria_orc:{conversationId}:{requestId}` / `valeria_handoff:{conversationId}:{requestId}`
— um retry do Chatvolt com o mesmo `requestId` nunca duplica.

Isolamento de conversa: `conversationId`+`organizationId` obrigatórios em toda
escrita, gravados no documento — duas conversas simultâneas do mesmo cliente
nunca colidem (testado, cenário 13).

Auditoria: toda escrita chama `writeAudit('valeria_vitre_audit_log', ...)`,
legível só por Master.

## C3 — Regra de elegibilidade automática (nunca inventar, nunca expor incompleto)

Um produto só é retornado/oferecido pela Valéria quando **todos** simultaneamente:

- `status === 'ativo'`
- `ativoValeria === true` (flag específica — "ativo no ERP" não é suficiente;
  um produto pode estar ativo para venda manual no ERP e ainda não ser
  liberado para o agente)
- `precoVenda` presente e > 0
- `prazoDias` presente (prazo confiável)
- `descricaoCurta` presente
- nível de completude ≥ 2 (`calcularNivelCompletude`, mesma escala 0-4 de
  `vitre.ts` — a Valéria exige nível 2, mais alto que o mínimo 1 que
  `vitre.ts` aceita para orçamento manual, porque aqui não há humano
  revisando antes do envio ao cliente)

Produto abaixo disso: nunca aparece em busca, nunca é oferecido; ao ser
consultado diretamente por SKU, responde `elegivel:false` com o motivo —
a Valéria deve então coletar os dados que faltam e/ou encaminhar para um
humano, nunca inventar preço/prazo/disponibilidade.

## C4 — Mapa de Actions (para configuração futura no Chatvolt)

| Action (nome sugerido) | Function | Quando o agente deve chamar |
|---|---|---|
| `buscar_catalogo_vitre` | `valeriaVitreBuscarCatalogo` | Cliente descreve o que quer — buscar por palavra-chave/categoria/faixa de preço |
| `consultar_produto_vitre` | `valeriaVitreConsultarProduto` | Cliente cita um SKU específico ou o agente já tem um candidato da busca |
| `simular_orcamento_vitre` | `valeriaVitreSimularOrcamento` | Cliente quer saber o total antes de confirmar — nunca fechar sem essa etapa |
| `criar_rascunho_orcamento_vitre` | `valeriaVitreCriarRascunho` | Cliente confirma que quer o orçamento formal — só depois da simulação |
| `encaminhar_para_vr_personalizado` | `valeriaVitreEncaminharVR` | Qualquer sinal de que a necessidade sai das regras do catálogo (C1, passo 7) |

### Prompt base (rascunho — para revisão humana antes de qualquer configuração real)

```
Você é a Valéria, atendente virtual da Vitre (produtos em acrílico prontos,
já cadastrados em catálogo) e da VR Marcas (acrílicos personalizados sob
medida). Seu trabalho é entender o que o cliente precisa e:

1. Se existir um produto Vitre que atende (com ou sem personalização
   permitida), ofereça o produto do catálogo — sempre buscando primeiro
   com buscar_catalogo_vitre ou consultar_produto_vitre, NUNCA inventando
   nome, preço, prazo ou disponibilidade.
2. Antes de fechar qualquer valor, sempre chame simular_orcamento_vitre e
   mostre o total real ao cliente.
3. Se o cliente pedir algo que o catálogo não cobre — medida diferente,
   material não listado, alteração que o produto não permite, arquivo ou
   projeto exclusivo — não tente resolver sozinha: chame
   encaminhar_para_vr_personalizado e explique que um especialista VR
   Marcas vai continuar o atendimento.
4. Nunca decida entre Vitre e VR Personalizado só porque o cliente é pessoa
   física ou jurídica — a decisão é sobre o produto, não sobre o documento
   do cliente.
5. Nunca informe custo, margem, markup ou qualquer dado interno de produção
   — você não tem acesso a isso, e não deve tentar adivinhar.
```

### Perguntas de qualificação sugeridas

- "Você já sabe o modelo/nome do produto, ou quer que eu busque por
  categoria?"
- "Esse produto precisa de alguma personalização (nome, cor, gravação)?"
- "Você precisa de uma medida específica, ou o tamanho padrão do catálogo
  atende?"

### Quando transferir para humano (além do encaminhamento VR)

- Cliente pede desconto além do que a Function autoriza.
- Cliente envia foto/referência visual (a Valéria não processa imagem nesta
  preparação).
- Cliente reclama de pedido anterior / questão de pós-venda.
- Qualquer sinal de urgência incomum (evento no mesmo dia, reclamação
  formal).

## C5 — Cenários testados (`scripts/test_valeria_vitre_server.js`, 15/15 ✅)

PF comprando item Vitre elegível (3, 5, 8, 11); produto abaixo do nível
mínimo nunca oferecido (4, 6, 9); SKU inexistente nunca inventado (7);
autenticação ausente/errada negada (1, 2); isolamento por
`conversationId`/`organizationId` obrigatório (10) e efetivo entre duas
conversas simultâneas do mesmo cliente (13); idempotência por `requestId`
sob retry (12); encaminhamento para humano com motivo válido e motivo
inválido normalizado (14, 15). Cenários adicionais documentados como
próximo passo (não implementados nesta rodada, pois dependem de decisões de
produto ainda não tomadas): cliente enviando foto, cliente pedindo desconto
acima do padrão, produto com múltiplas variantes de tamanho.

## Pendências explícitas para uma rodada futura

- Nenhum agente real foi criado no Chatvolt.
- Nenhuma credencial/API key do Chatvolt foi tocada ou solicitada.
- `VALERIA_SECRET`/`erp_vr/valeria_config.secret` real de produção não foi
  gerado nem substituído — o token usado nos testes desta rodada é
  sintético e local ao Emulator, removido ao final da suíte.
- `families`/`variantes` como entidades de primeira classe (hoje só
  `categoria`/`produtoPaiId` existem no modelo) — se o catálogo crescer,
  vale revisitar antes de configurar buscas por família no Chatvolt.
