# FASE 2-8 (checkpoint) — Fronteira server-side de estoque, 2026-08-05

Este documento substitui/complementa `AUDITORIA_FASE2_FRONTEIRA_ESTOQUE_2026-08-05.md`
(rodada anterior, escopo menor — só produção). Cobre o inventário completo
pedido nesta rodada: toda escrita em `stock`, `erp_stock_log`, `retalhos`,
`retalhos_seq`, `stock_deleted` e campos sensíveis de `kb_os`.

## 1. Método

Inventário produzido por leitura direta do código-fonte (grep exaustivo por
`STOCK[`, `.qty`, `stockSaveData(`, `_stockLog(`, `RETALHOS[`, `retalho`,
`matProd`, `producaoStartId` em todo `index.html`) — nenhuma função é
classificada como "morta" sem grep confirmando zero call sites alcançáveis.

## 2. Inventário completo

| Função | Documento(s) | Perfil (antes) | Direto/Function (antes) | Status após esta rodada |
|---|---|---|---|---|
| `kbConfirmarProd`/`kbEditarMatProd` | `kb_os.matProd/status/producaoStartId`, `stock`, `retalhos`, `erp_stock_log` | Master, Produção | Function (`producaoIniciarOuEditar`) — já corrigido em rodada anterior | **SEGURO** (inalterado nesta rodada) |
| `orcGerarOS` (baixa automática hard-coded de `ac3`) | `stock` | Comercial/Produção/Master (sem checagem) | Direto (`stockSaveData()`) | **SEGURO** — migrado para `estoqueConsumoAutoOrcamento` |
| `stockConfirmarEntrada` | `stock`, `erp_stock_log` | sem checagem | Direto | **SEGURO** — migrado para `estoqueRegistrarEntrada` |
| `_stockFazSaida` (`stockRegistrarSaida`/`ComRetalho`) | `stock`, `erp_stock_log` | sem checagem | Direto | **SEGURO** — migrado para `estoqueRegistrarSaidaManual` |
| `stockSalvarNovoItem` (criar/editar item) | `stock` | sem checagem, aceitava qty negativo | Direto | **SEGURO** — migrado para `estoqueCriarOuEditarItem`, qty negativo agora recusado |
| `stockExcluirItem` | `stock`, `stock_deleted` | sem checagem | Direto | **SEGURO** — migrado para `estoqueExcluirItem` |
| `stockLixeiraRestaurar` | `stock`, `stock_deleted` | sem checagem | Direto | **SEGURO** — migrado para `estoqueRestaurarItem` |
| `stockLixeiraExcluirDef` | `stock_deleted` | sem checagem | Direto | **SEGURO** — migrado para `estoqueExcluirItemDefinitivo`, **endurecido para master-only** |
| `stockLimparHistorico` | `erp_stock_log` (wipe) | sem checagem | Direto | **SEGURO** — migrado para `estoqueLimparHistorico`, **endurecido para master-only** (apagava toda a auditoria sem controle nenhum) |
| `retalhoAdicionar`/`retalhoAdicionarManual` (criar retalho) | `retalhos`, `retalhos_seq` | sem checagem | Direto (com contador atômico pré-existente) | **SEGURO** — migrado para `estoqueCriarRetalho`, reaproveita o mesmo esquema de código |
| `retalhoEditarSalvar` | `retalhos` | sem checagem, aceitava qty negativo | Direto | **SEGURO** — migrado para `estoqueEditarRetalho`, qty negativo agora recusado. **Achado não catalogado na rodada anterior** — descoberto nesta auditoria (botão "💾 Salvar Alterações", linha ~4340) |
| `retalhoRemover`/`retalhoConfirmarUso` | `retalhos`, `erp_stock_log` | sem checagem | Direto | **SEGURO** — migrado para `estoqueConsumirRetalho` |
| `retalhoExcluirConfirmar` | `retalhos` | sem checagem | Direto | **SEGURO** — migrado para `estoqueExcluirRetalho` |
| `kbIniciarProd` (retomada), `kbPausarProd`, `kbMarcarPronto`, `kbReverterProducao`, `osLiberar` | `kb_os.status` apenas | Master, Produção | Direto (`_cloudSave`) | **SEGURO** — confirmado por leitura completa do corpo de cada função: nenhuma toca `STOCK`/`RETALHOS`/`matProd`. Fora de escopo (não é decisão de estoque). Nenhuma função de cancelamento/estorno de produção existe hoje (confirmado via grep de "cancelar produção"/"reverter"/"estornar" — só resultados não relacionados a estoque). |
| **`comprasReceberModal()` — ramo legado (v1)** | `stock` (incremento no recebimento) | sem checagem | Direto | **⚠️ NÃO MIGRADO — achado crítico, ver seção 3** |

## 3. Achado crítico não corrigido nesta rodada: recebimento de Compras v1 ainda escreve `stock` diretamente

`comprasReceberModal(id)` (index.html) tem dois ramos, selecionados por
`_HOMOLOG_MODE` (`hostname===localhost/127.0.0.1 && ?emulator=1`):

- Se `_HOMOLOG_MODE` — usa `comprasV2RegistrarRecebimento` (Cloud Function
  `comprasRegistrarRecebimento`, já `allow write: if false` nas Rules).
- **Senão** (ou seja, em produção real, já que `_HOMOLOG_MODE` só liga em
  localhost+query param) — usa o ramo legado: incrementa
  `STOCK[item.material].qty` diretamente e chama `stockSaveData()`/
  `_stockLog()`, sem transação, sem idempotência, sem checagem de papel.

**Isto significa que o caminho que roda em produção HOJE ainda escreve
`stock` diretamente**, fora do perímetro desta correção. Não foi migrado
nesta rodada porque pertence à migração maior, já rastreada separadamente
neste projeto, de Compras v1 (documento-por-registro dentro do blob
`erp_vr/compras`) → Compras v2 (`erp_vr_compras*`, Cloud Functions
dedicadas). Migrar só o recebimento sem migrar o resto de Compras v1
criaria uma arquitetura híbrida inconsistente.

**Consequência direta para a Rules candidata (commit `8ed253b`)**: publicar
`allow write: if false` em `stock` em produção **quebraria** este fluxo
legado ainda ativo. A Rules candidata só pode ser publicada com segurança
depois que: (a) Compras v1→v2 estiver completo e ativo em produção, ou
(b) este ramo específico for migrado para uma Cloud Function equivalente
a `estoqueRegistrarEntrada`, preservando o vínculo com o pedido de compra.

Este achado é registrado como pendência de negócio explícita, não
escondido — ver relatório final desta rodada.

## 4. Matriz de autorização final (comandos migrados nesta rodada)

| Comando | Master | Produção | Comercial | Sem perfil/desabilitado/não-autenticado |
|---|---|---|---|---|
| `estoqueRegistrarEntrada` | ✅ | ✅ | ❌ | ❌ |
| `estoqueRegistrarSaidaManual` | ✅ (sem exceção de saldo negativo — nunca existiu aqui) | ✅ | ❌ | ❌ |
| `estoqueConsumoAutoOrcamento` | ✅ | ✅ | ✅ (é quem fecha orçamento) | ❌ |
| `estoqueCriarOuEditarItem` | ✅ | ✅ | ❌ | ❌ |
| `estoqueExcluirItem` / `estoqueRestaurarItem` | ✅ | ✅ | ❌ | ❌ |
| `estoqueExcluirItemDefinitivo` | ✅ | ❌ (endurecido) | ❌ | ❌ |
| `estoqueLimparHistorico` | ✅ | ❌ (endurecido) | ❌ | ❌ |
| `estoqueCriarRetalho` / `estoqueEditarRetalho` / `estoqueConsumirRetalho` / `estoqueExcluirRetalho` | ✅ | ✅ | ❌ | ❌ |
| `producaoIniciarOuEditar` (já existente) | ✅ (com exceção de saldo negativo + justificativa ≥10 chars) | ✅ (sem exceção) | ❌ | ❌ |

Nenhuma permissão foi ampliada em relação ao que a UI já oferecia — as
duas mudanças (`estoqueExcluirItemDefinitivo` e `estoqueLimparHistorico`
endurecidas para master-only) são **restrições**, documentadas
explicitamente como tal, não mantidas "como estava" porque eram claramente
incompatíveis com o objetivo desta auditoria (descarte irreversível e
destruição de auditoria, respectivamente, sem controle algum antes).
