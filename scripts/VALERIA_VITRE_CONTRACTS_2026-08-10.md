# Valéria × Vitre — Contratos Reais das 7 Functions (2026-08-10)

Base: `functions/src/valeria_vitre.ts` + branch `feat/valeria-chatvolt-assistida-2026-08-06` (funções 6 e 7)
Auth: `Authorization: Bearer <secret>` — mesmo secret de `erp_vr/valeria_config` usado pelas 5 Tools existentes.
CORS: `Access-Control-Allow-Origin: *`

---

## 1. valeriaVitreBuscarCatalogo

**Tool name:** `buscar_catalogo_vitre`
**Method:** GET
**URL:** `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreBuscarCatalogo`

**Query params (todos opcionais):**
- `q` string — palavra-chave (busca em nome, categoria, descrição, usos, palavrasChave)
- `categoria` string — filtro exato de categoria (lowercase)
- `precoMin` number — preço mínimo de venda
- `precoMax` number — preço máximo de venda
- `limite` number — máx 30, default 10

**Output OK:**
```json
{
  "ok": true,
  "total": 2,
  "produtos": [{
    "sku": "...", "nome": "...", "categoria": "...", "familia": null,
    "variante": null, "precoVenda": 90, "prazoDias": 5,
    "disponibilidade": "pronta_entrega", "descricaoCurta": "...",
    "fotos": ["..."], "usos": ["..."], "palavrasChave": ["..."],
    "personalizacoesPermitidas": [{"nome": "impressao_uv", "preco": 25}]
  }]
}
```
**Produto nunca retornado se:** `status ≠ "ativo"` OU `ativoValeria ≠ true` OU `precoVenda ≤ 0` OU `prazoDias` ausente OU `descricaoCurta` ausente OU nível completude < 2.
**Custo/margem/markup:** NUNCA expostos.

**Erros:** 401 (sem auth), 405 (método errado)
**Idempotente:** Sim (leitura)
**Efeito colateral:** Nenhum

---

## 2. valeriaVitreConsultarProduto

**Tool name:** `consultar_produto_vitre`
**Method:** GET
**URL:** `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreConsultarProduto`

**Query params:**
- `sku` string (OBRIGATÓRIO)

**Output — encontrado e elegível:**
```json
{"ok": true, "elegivel": true, "produto": { /* mesmo formato de buscar_catalogo_vitre */ }}
```
**Output — não encontrado:**
```json
{"ok": true, "elegivel": false, "motivo": "SKU_NAO_ENCONTRADO"}
```
**Output — inelegível:**
```json
{"ok": true, "elegivel": false, "motivo": "PRODUTO_ABAIXO_DO_NIVEL_MINIMO_OU_INATIVO"}
```
Nunca retorna erro 5xx para SKU ausente. Nunca aproxima para outro produto.

**Erros:** 400 (sku ausente), 401, 405
**Idempotente:** Sim
**Efeito colateral:** Nenhum

---

## 3. valeriaVitreSimularOrcamento

**Tool name:** `simular_orcamento_vitre`
**Method:** POST
**URL:** `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreSimularOrcamento`

**Body (JSON):**
- `itens` array OBRIGATÓRIO: `[{"sku": "...", "qtd": 2, "adicionais": [{"nome": "impressao_uv"}]}]`
- `descontoPct` number opcional (0–100)
- `frete` number opcional (≥ 0)

**Output OK:**
```json
{
  "ok": true,
  "itens": [{"sku": "...", "nome": "...", "precoVenda": 90, "qtd": 2,
    "adicionais": [{"nome": "impressao_uv", "preco": 25}],
    "adicionaisRejeitados": ["nome_invalido"]}],
  "subtotal": 230, "descontoPct": 0, "valorDesconto": 0, "frete": 0, "total": 230
}
```
**adicionaisRejeitados:** personalizações pedidas que não existem no catálogo do produto — nunca aplicadas silenciosamente.
**Preço dos adicionais:** SEMPRE do catálogo, nunca do que o agente/cliente informar.
**Fail-closed:** se qualquer item for inelegível, a simulação inteira falha.
**NÃO persiste:** nunca cria documento.

**Erros:** 400 (itens ausentes / ITEM_SEM_SKU), 401, 405
**Output de erro:** `{"ok": false, "error": "PRODUTO_NAO_ENCONTRADO:SKU"}` ou `"PRODUTO_NAO_ELEGIVEL:SKU"`
**Idempotente:** Sim (sem escrita)
**Efeito colateral:** Nenhum

---

## 4. valeriaVitreCriarRascunho

**Tool name:** `criar_rascunho_vitre`
**Method:** POST
**URL:** `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreCriarRascunho`

**Body (JSON):**
- `conversationId` string OBRIGATÓRIO (isolamento)
- `organizationId` string OBRIGATÓRIO (isolamento)
- `requestId` string OBRIGATÓRIO (idempotência — gerar único por operação)
- `clienteNome` string OBRIGATÓRIO
- `itens` array OBRIGATÓRIO: `[{"sku": "...", "qtd": 2, "adicionais": [{"nome": "..."}]}]`
- `descontoPct` number opcional
- `frete` number opcional
- `prazoValidadeDias` number opcional (default 7)

**Output OK (novo):**
```json
{"ok": true, "jaProcessado": false, "id": "abc123", "total": 230, "adicionaisRejeitados": []}
```
**Output OK (replay idempotente):**
```json
{"ok": true, "jaProcessado": true, "id": "abc123"}
```
**Criação em Firestore:** `vitre_orcamentos/{id}` com `status:"rascunho"`, `origem:"valeria"`, snapshot completo de itens/preços.

**Erros:** 400 (campos obrigatórios ausentes / produto inelegível), 401, 405
**Idempotente:** Sim (por requestId — chave: `valeria_orc:{conversationId}:{requestId}`)
**Efeito colateral:** Cria `vitre_orcamentos` doc

---

## 5. valeriaVitreAtualizarRascunho

**Tool name:** `atualizar_rascunho_vitre`
**Method:** POST
**URL:** `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreAtualizarRascunho`

**Body (JSON):**
- `conversationId` string OBRIGATÓRIO
- `organizationId` string OBRIGATÓRIO
- `orcamentoId` string OBRIGATÓRIO (ID retornado por criar_rascunho_vitre)
- `requestId` string OBRIGATÓRIO (novo por operação de atualização)
- `itens` array OBRIGATÓRIO (substitui itens anteriores)
- `descontoPct` number opcional
- `frete` number opcional

**Output OK:**
```json
{"ok": true, "orcamentoId": "abc123", "total": 345, "adicionaisRejeitados": []}
```
**Output replay:**
```json
{"ok": true, "jaProcessado": true, "orcamentoId": "abc123"}
```
**Erros semânticos:**
- `ORCAMENTO_NAO_ENCONTRADO` — ID inválido (404)
- `ORCAMENTO_OUTRA_CONVERSA` — ID de outra conversa (403)
- `ORCAMENTO_NAO_EDITAVEL:status=...` — rascunho já aprovado/enviado (400)

**Idempotente:** Sim (por requestId — chave: `valeria_orc_upd:{conversationId}:{requestId}`)
**Efeito colateral:** Atualiza `vitre_orcamentos/{id}` (itens, total, atualizadoEm)

---

## 6. valeriaVitreConsultarRascunho

**Tool name:** `consultar_rascunho_vitre`
**Method:** GET
**URL:** `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreConsultarRascunho`

**Query params (todos OBRIGATÓRIOS):**
- `orcamentoId` string
- `conversationId` string
- `organizationId` string

**Output OK:**
```json
{
  "ok": true, "orcamentoId": "abc123", "status": "rascunho",
  "clienteNome": "João Silva", "itens": [...],
  "subtotal": 230, "descontoPct": 0, "valorDesconto": 0, "frete": 0, "total": 230,
  "prazoValidadeDias": 7, "criadoEm": 1234567890, "atualizadoEm": null
}
```
**Erros:** 400 (params ausentes), 403 (ORCAMENTO_OUTRA_CONVERSA), 404 (ORCAMENTO_NAO_ENCONTRADO), 401

**Idempotente:** Sim (leitura)
**Efeito colateral:** Nenhum

---

## 7. valeriaVitreEncaminharVR (para VR Personalizado)

**Tool name:** `encaminhar_para_vr_personalizado`
**Method:** POST
**URL:** `https://us-central1-erp-vrmarcas.cloudfunctions.net/valeriaVitreEncaminharVR`

**Body (JSON):**
- `conversationId` string OBRIGATÓRIO
- `organizationId` string OBRIGATÓRIO
- `clienteNome` string OBRIGATÓRIO
- `requestId` string OBRIGATÓRIO
- `motivo` string OBRIGATÓRIO — enum: `"medida_fora_do_padrao"` | `"material_nao_catalogado"` | `"alteracao_nao_permitida"` | `"arquivo_projeto_exclusivo"` | `"sku_inexistente"` | `"produto_incompleto"` | `"cliente_indeciso"` | `"outro"`
- `clienteTel` string opcional
- `detalhe` string opcional — contexto adicional

**Output OK (novo):**
```json
{"ok": true, "id": "handoff_xyz"}
```
**Output replay:**
```json
{"ok": true, "jaProcessado": true}
```
**Motivo inválido:** normaliza para `"outro"` (nunca quebra).
**Criação:** `valeria_handoffs/{id}` com `status:"pendente"`.

**Idempotente:** Sim (por requestId — chave: `valeria_handoff:{conversationId}:{requestId}`)
**Efeito colateral:** Cria `valeria_handoffs` doc

---

## Regras comuns a todas as Tools

- Auth: `Authorization: Bearer <secret>` — se ausente/inválido: 401
- Agente não autorizado (allowlist): 403
- CORS: OPTIONS retorna 204 (pré-flight)
- Custo/margem/markup: NUNCA expostos
- Produto abaixo do nível mínimo ou inativo: NUNCA retornado
- Personalização pedida fora do catálogo: vai para `adicionaisRejeitados`, nunca aplicada
- Preço de personalização: SEMPRE do catálogo, nunca do payload do agente/cliente
