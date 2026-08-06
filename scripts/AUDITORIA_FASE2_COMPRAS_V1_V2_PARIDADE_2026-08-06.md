# RODADA FINAL — FASE 2: Compras v1 vs v2, mapeamento e paridade (2026-08-06)

Fonte: leitura direta de `index.html` (bloco `COMPRAS`, linhas ~12100-12834) e
`functions/src/compras.ts`. `_HOMOLOG_MODE` (`index.html:1224`) é `true`
somente em `localhost`/`127.0.0.1` com `?emulator=1` — **em produção real
(`erp-vrmarcas`) é sempre `false`**, portanto **v1 é o que roda em
produção hoje**, não código morto.

## Tabela de paridade

| Operação | Compras v1 | Compras v2 | Paridade | Bloqueio |
|---|---|---|---|---|
| Solicitar compra | `comprasSolicitarDeOS`/`comprasNovaSolicitacaoModal` — array `COMPRAS`, numeração atômica via transação em `erp_compras_counter` (segura) | `comprasCriarSolicitacao` — Cloud Function, coleção `erp_vr_compras`, numeração atômica própria | **Equivalente** | nenhum |
| Aprovar | **Não existe gate real** — `comprasAvancarStatus` avança linearmente, sem role check no código (só Rules de documento, que dão a Produção acesso de escrita irrestrito); sem fornecedor/preço obrigatório | `comprasAprovar` — Master-only real, exige fornecedor+precoUnit | **v2 estritamente superior** — v1 tem o exato gap de autoaprovação já documentado no header do arquivo de Rules | Migrar para v2 fecha o gap; manter v1 o perpetua |
| Rejeitar | **Ausente** (confirmado, zero ocorrências de "rejeitar/reject") | **Ausente** | Equivalente (nenhuma tem) | Pendência de negócio em ambas — não inventada aqui |
| Editar solicitação | **Ausente** — nenhuma função de edição pós-criação; fornecedor só via prompt uma vez | **Ausente** (mesma limitação) | Equivalente | Pendência de negócio em ambas |
| Cancelar | `comprasCancelar` — justificativa obrigatória, preserva histórico, campo `cancelJustificativa` | `comprasCancelar` — justificativa obrigatória, preserva histórico, campo `motivoCancelamento` (nome diferente) | **Equivalente em regra**, campo renomeado | Mapeamento de campo se migrar dados |
| Receber parcial/total | `comprasReceberModal` (ramo v1) — **escreve `stock` diretamente do cliente**, sem transação, guardado só por flag em memória (`_comprasRecebendoIds`) | `comprasRegistrarRecebimento` — Cloud Function transacional, `erp_vr_stock_movimentos`, idempotente por `requestId` | **v2 estritamente superior** | **Este é o bloqueador central**: v1 ainda escreve stock direto, é o que está ativo em produção |
| Atualizar estoque | Direto (`STOCK[item.material].qty +=`) dentro do ramo v1 de `comprasReceberModal` | Via Cloud Function, transação única com o recebimento | v2 superior | mesmo bloqueador acima |
| Gerar Conta a Pagar | `comprasSincronizarObrigacaoProvisoria` — obrigação provisória embutida no array `FIN_CP` | `comprasAdicionarDocumento`/CP em coleção `erp_vr_fin_cp` | **Equivalente conceitualmente**, modelo de dados diferente (array agregado vs. coleção normalizada) | Migração de dados, não de lógica |
| Parcelas | `comprasAdicionarDocumento` (v1) — ids determinísticos `cppar_<documentoId>_p<N>`, idempotente por construção mas só client-side | `comprasAdicionarDocumento` (v2) — coleção `erp_vr_compras_parcelas`, esquema de id próprio (diferente do v1) | Equivalente em regra de negócio (split + resto na última parcela) | Formato de ID diverge — migração precisa remapear |
| Documento fiscal interno | Embutido em `pc.documentos[]` | Coleção própria `erp_vr_compras_documentos` | Equivalente em conteúdo | Migração de dados |
| Fornecedor | **Texto livre**, nunca vinculado a `erp_fornecedores` | **Texto livre também** — mesma limitação | Equivalente (gap em ambas, não é regressão de v2) | Pendência de negócio pré-existente em ambas as versões |
| Auditoria | `comprasLog` (embutido em `pc.historico[]`) + `secAuditLog` (→ `erp_vr/erp_audit_log`) | `writeAudit` → coleção dedicada `compras_audit_log` | Equivalente em cobertura, sink diferente | Nenhum — v2 é mais robusto (append-only dedicado vs. array legado) |
| Idempotência | **Nenhuma no servidor** — só flags em memória por aba (`_comprasRecebendoIds`, `_comprasSolicitandoOS`); document/parcela dedupe é client-side por conteúdo | `requestId` + `compras_idem_keys` (Admin-SDK-only) + transação | **v2 estritamente superior** | Fechar v1 é a única forma de ter idempotência real |
| Vínculo com OS | `comprasSolicitarDeOS(os, matKey, qtdFalta)` — cria registro v1 ou v2 conforme `_HOMOLOG_MODE`; dedupe checa só o próprio array (v1 não vê registros v2 e vice-versa) | idem, campo `origem` | Equivalente em intenção; **os dois arrays/coleções são cegos um ao outro** — um mesmo shortage pode gerar 1 solicitação v1 E 1 v2 se o ambiente alternar | Migração precisa reconciliar duplicatas cross-arquitetura antes de trocar a fonte oficial |
| Falta de material | Mesma função acima (`comprasSolicitarDeOS`) | idem | Equivalente | idem acima |
| Permissões | Enforced só por Rules de documento (grosseiro — Produção tem acesso total ao array inteiro) | Enforced por Cloud Function (`requireRole` por operação) | **v2 estritamente superior** | — |

## Achados adicionais (não pedidos explicitamente na tabela, mas relevantes)

- **Campos do v1 sem equivalente em v2** (perda potencial se migrar sem ajuste): `item.cor`, `item.esp`, `item.qtyDisponivelNaCriacao`, `item.qtyFaltanteNaCriacao`, `item.qtyReservada` (nunca implementada, vestigial), `pc.cotacoes` (nunca populada, morta), `pc.historico[]` (precisa virar linhas em `compras_audit_log`), `item.unidade:'chapa'` (v2 só conhece `'un'`).
- **`comprasAvancarStatus`, `comprasCancelar`, `comprasReceberModal`, `comprasAdicionarDocumento`, `comprasRender`** — cada uma tem sua PRÓPRIA checagem interna de `_HOMOLOG_MODE`, redundante com o roteamento de render — padrão "defesa em profundidade", mas espalha a decisão em 5+ lugares em vez de 1 só. Isso é o que a FASE 3 precisa eliminar.
- **`comprasV2RequerHomolog()`** (index.html ~12422) hoje **bloqueia ativamente** qualquer chamada v2 fora de `_HOMOLOG_MODE` — este guard PRECISA ser removido/invertido como parte da FASE 3, senão o candidato final não consegue usar v2 em produção.
- Nenhuma função de v1 tem "reject" nem "editar após criar" — confirmado ausente em AMBAS as versões; não é uma lacuna introduzida por v2, é uma decisão de negócio nunca tomada. Registrado como pendência, não inventado aqui.

## Conclusão da FASE 2

Compras v1 **não é código morto** — é o que roda em produção hoje, e tem
exatamente um problema estrutural que v2 resolve (escrita direta de stock
+ ausência de idempotência/autorização server-side no recebimento e na
"aprovação"). Fora isso, os dois sistemas são funcionalmente equivalentes,
com v1 tendo alguns campos de snapshot (`cor`/`esp`/etc.) que v2 não
captura — de baixo risco para descartar (uso apenas informativo, não
afeta saldo/autorização). A migração (FASE 3) é tecnicamente viável sem
inventar regra de negócio nova.
