# GO-LIVE Etapa 10 — Valéria no Chatvolt

## Status de acesso

**Chatvolt (o painel/dashboard em si) não está acessível nesta
sessão** — nenhuma ferramenta, credencial ou sessão de navegador
logada em chatvolt.ai está disponível. Conforme instruído, isso não
interrompeu o restante do go-live — os 5 endpoints estão publicados,
autenticados e validados ponta a ponta contra produção real. Esta
seção entrega o passo a passo exato para quem tiver acesso ao painel
completar a configuração.

## Verificação real feita (sem acessar o Chatvolt)

- **As 5 Functions estão publicadas e ativas** (confirmado na Etapa 5):
  `valeriaVitreBuscarCatalogo`, `valeriaVitreConsultarProduto`,
  `valeriaVitreSimularOrcamento`, `valeriaVitreCriarRascunho`,
  `valeriaVitreEncaminharVR`.
- **O secret de autenticação já existe em produção**
  (`erp_vr/valeria_config`) — é o **mesmo secret já usado** pela
  integração Valéria existente (`valeria.ts`, codebase `default`) e
  pelas Functions do codebase `valeria` (`functions-valeria/`,
  integração Chatvolt real já ativa). **Nada foi criado nem alterado**
  — só confirmado que já está lá (não há "motivo" para mudar um
  secret que já funciona).
- **Chamada real de ponta a ponta, autenticada com esse mesmo secret**
  (nunca impresso em nenhum log/relatório): `valeriaVitreBuscarCatalogo?q=aparador`
  → HTTP 200, `ok:true`. Confirma que autenticação, CORS e a Function
  em si funcionam corretamente em produção.
- **Achado relevante, não é bug:** `total: 0` produtos retornados —
  **nenhum dos 110 produtos importados ainda é elegível para a
  Valéria oferecer automaticamente** (todos estão no nível de
  completude 1; o mínimo exigido é nível 2 — falta `categoria` e ao
  menos 1 foto em cada produto, campos que a planilha comercial não
  cobre — achado já registrado na Parte 5 da homologação). A resposta
  não expõe custo/margem (confirmado). **A Valéria está tecnicamente
  pronta, mas não vai sugerir nenhum produto Vitre até que os
  produtos recebam cadastro de categoria/foto.**

## Passo a passo exato para quem tiver acesso ao Chatvolt

### 1. URLs, métodos e payloads das 5 novas Actions

| Action (nome sugerido) | Method | URL | Headers | Payload/Query |
|---|---|---|---|---|
| `buscar_catalogo_vitre` | GET | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreBuscarCatalogo` | `Authorization: Bearer <secret>` | `?q=&categoria=&precoMin=&precoMax=&limite=` |
| `consultar_produto_vitre` | GET | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreConsultarProduto` | `Authorization: Bearer <secret>` | `?sku=` |
| `simular_orcamento_vitre` | POST | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreSimularOrcamento` | `Authorization: Bearer <secret>`, `Content-Type: application/json` | `{itens:[{sku,qtd,adicionais?:[{nome}]}], descontoPct?, frete?}` |
| `criar_rascunho_orcamento_vitre` | POST | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreCriarRascunho` | `Authorization: Bearer <secret>`, `Content-Type: application/json` | `{clienteNome, itens, descontoPct?, frete?, prazoValidadeDias?, requestId, conversationId, organizationId}` |
| `encaminhar_para_vr_personalizado` | POST | `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreEncaminharVR` | `Authorization: Bearer <secret>`, `Content-Type: application/json` | `{clienteNome, clienteTel?, motivo, detalhe?, requestId, conversationId, organizationId}` |

`<secret>` = valor já armazenado em `erp_vr/valeria_config` (Firestore,
campo `data`, JSON com chave `secret`) — o mesmo já usado pelas Actions
existentes do Chatvolt para esta empresa. Não precisa gerar nada novo.

### 2. Respostas esperadas (formato)

- `buscar_catalogo_vitre` → `{ok, total, produtos:[{sku,nome,categoria,precoVenda,prazoDias,disponibilidade,descricaoCurta,fotos,personalizacoesPermitidas,...}]}`
- `consultar_produto_vitre` → `{ok, elegivel, produto?, motivo?}`
- `simular_orcamento_vitre` → `{ok, itens, subtotal, descontoPct, valorDesconto, frete, total}` ou `{ok:false, error}`
- `criar_rascunho_orcamento_vitre` → `{ok, jaProcessado, id, total, adicionaisRejeitados}`
- `encaminhar_para_vr_personalizado` → `{ok, id}`

### 3. Prompt-base e regras — já revisados e prontos

Ver `scripts/VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md`
(seção C4) — prompt-base completo, perguntas de qualificação
sugeridas, regra explícita de nunca decidir por CPF/CNPJ, regra de
nunca informar custo/margem.

### 4. Único acesso manual necessário

1. Login no painel do Chatvolt com a conta já usada para a integração
   existente desta empresa.
2. Adicionar as 5 Actions acima ao agente Valéria (sem remover as
   Actions existentes — só adicionar).
3. Colar o secret de `erp_vr/valeria_config` no campo de autenticação
   de cada Action nova (mesmo valor, uma vez).
4. Colar/ajustar o prompt-base revisado.
5. Testar os cenários da Parte 10 da homologação
   (`scripts/HOMOLOGACAO_P10_VALERIA_2026-08-06.md`, 17 cenários) numa
   conversa de teste/sandbox do próprio Chatvolt.

## Modo assistido — confirmado pelo desenho já existente

As 5 Functions **nunca enviam orçamento final, nunca prometem prazo
não confirmado, nunca aplicam desconto sem que o agente/humano
explicite, nunca oferecem produto incompleto ou desativado** — isso já
é a arquitetura publicada (ver `produtoElegivelValeria`,
fail-closed em `valeriaVitreSimularOrcamento`/`CriarRascunho`). Não
há necessidade de nenhuma configuração adicional de "modo assistido"
do lado do ERP — o próprio contrato das Functions já impõe isso.
A aprovação humana antes do envio real ao cliente é uma decisão do
prompt/fluxo configurado no Chatvolt (passo 4 acima), fora do controle
deste código.

## Pendência humana registrada (não bloqueia o go-live)

Nenhum produto do Catálogo Vitre está elegível para a Valéria oferecer
hoje — requer cadastro manual de `categoria` e ao menos 1 `foto` por
produto (ver Parte 5 da homologação) antes que a integração tenha
efeito prático em conversas reais.
