# Inventário integral dos chamadores de `_cloudSave()` — Auditoria Fase F (2026-08-05)

Branch `release/fase-f-usuarios-2026-08-05`. Levantamento original por agente de busca (varredura completa do arquivo), verificado e complementado por leitura manual de código durante a correção (2 achados adicionais não cobertos pela varredura original: `osExcluir`, `crmConverterEmOS`).

Colunas: **Retorna Promise** = a função que efetivamente chama `_cloudSave`/wrapper agora devolve a Promise (todos os wrappers principais foram corrigidos nesta rodada para retornar). **Aguarda** = o *chamador* do wrapper usa `await`/`.then()` no resultado. **Trata `{ok:false}`** = reage à falha (reverte estado, evita ação duplicada). **Reconcilia `serverData`** = usa o dado do servidor devolvido em conflito em vez de reaplicar o snapshot antigo. **Sucesso antes do commit** = mostrava toast/UI de sucesso antes de saber se o servidor confirmou (❌ = sim, era o bug; ✅ = não, correto).

Classificações: **SEGURO** (corrigido ou já era seguro) · **SEGURO MAS SEM FEEDBACK** (não corrompe dado, mas falha silenciosa possível — risco aceito e justificado) · **NÃO UTILIZA `_cloudSave`** (Cloud Function idempotente ou código morto) · **CORRIGIDO NESTA RODADA**.

---

## 1. Estoque e log (prioridade 1)

| # | Função | Módulo | Documento | Retorna Promise | Aguarda | Trata `{ok:false}` | Reconcilia serverData | Sucesso antes do commit | Classificação | Justificativa |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `stockSaveData()` | Estoque | `stock` | ✅ (corrigido) | — | — | via `_cloudSave` | ✅ não mostra toast própria | **CORRIGIDO** | Antes gravava direto via `_db.set()`, sem transação nem detecção de conflito — o único caminho de estoque fora de `_cloudSave`. Agora delega a `_cloudSave('stock',...)`. |
| 2 | `stockExcluirItem(key)` | Estoque | `stock` + `stock_deleted` | ✅ | ✅ | ✅ reverte item e lápide | herda de `_cloudSave` | ✅ | **CORRIGIDO** | Guarda contra exclusão dupla; reverte por documento (o que falhou volta, o que confirmou permanece). |
| 3 | `stockLixeiraRestaurar(key)` | Estoque | `stock` + `stock_deleted` | ✅ | ✅ | ✅ | herda | ✅ | **CORRIGIDO** | — |
| 4 | `stockLixeiraExcluirDef(key)` | Estoque | `stock_deleted` | ✅ | ✅ | ✅ | herda | ✅ | **CORRIGIDO** | — |
| 5 | `stockSalvarNovoItem()` (criar/editar) | Estoque | `stock` | ✅ | ✅ | ✅ reverte criação ou edição | herda | ✅ | **CORRIGIDO** | — |
| 6 | `_stockTombSave()` | Estoque | `stock_deleted` | ✅ (corrigido) | (ver chamadores acima) | ✅ | herda | n/a | **CORRIGIDO** | — |
| 7 | `_stockAplicarSnapshot()` (seed de defaults no 1º uso) | Estoque | `stock` | não (chamada interna do listener) | não | não | não | não mostra toast | **SEGURO MAS SEM FEEDBACK** | Só executa quando o documento não existe (1ª vez no ambiente); grava sempre o mesmo `_STOCK_DEFAULTS` determinístico — duas gravações concorrentes produzem conteúdo idêntico, não há corrupção possível. Não é chamada por ação do usuário. |
| 8 | `_stockLog()` / `_retalhoLog()` (via `_stockLogSalvar`) | Estoque/log | `erp_stock_log` | ✅ (corrigido) | ✅ | ✅ remove entrada local se falhar | não (não é array-versionado por conflito) | ✅ | **CORRIGIDO** | Log de auditoria, não afeta quantidades nem financeiro — mas "risco baixo" não é "seguro": agora reverte a entrada local se o servidor recusar. |
| 9 | Botão "Limpar histórico" (`stockLimparHistorico`) | Estoque/log | `erp_stock_log` | ✅ | ✅ | ✅ restaura histórico | não | ✅ | **CORRIGIDO** | — |
| 10 | `kbConfirmarProd()` / `_iniciarTransacaoProducao()` | Estoque (produção) | `stock` + `erp_stock_log` + `kb_os` + `retalhos` | ✅ | ✅ | ✅ | transação própria com releitura | ✅ | **SEGURO** (corrigido em rodada anterior, commit 82a47c8) | Transação dedicada que relê e valida server-side; 31 testes de regressão cobrindo idempotência, corrida e exceção de negativo. |
| 11 | `retalhoSalvar()` e funções de retalho (consumo/criação) | Estoque (retalhos) | `retalhos` | ✅ (herdado de `_cloudSave`) | não (chamadores não aguardam) | não | não | ❌ (toast do chamador é imediato) | **NÃO VALIDADO — pendente rodada futura** | Módulo de retalhos não foi tocado nesta rodada; fora da prioridade 1-7 explícita, mas registrado como pendência real, não como "baixo risco" presumido. |

## 2. OS (prioridade 2)

| # | Função | Módulo | Documento | Retorna Promise | Aguarda | Trata `{ok:false}` | Reconcilia | Sucesso antes do commit | Classificação | Justificativa |
|---|---|---|---|---|---|---|---|---|---|---|
| 12 | `osLiberar(id)` | OS (entrega) | `kb_os` | ✅ | ✅ | ✅ reverte status | via `_confirmarAposSalvar` | ✅ | **CORRIGIDO** | Guarda contra clique duplo (`os._liberando`). |
| 13 | `kbMarcarPronto()` | OS | `kb_os` | ✅ | ✅ | ✅ reverte status/prog/checklist, reabre modal com `kbOpen` | via `_confirmarAposSalvar` | ✅ | **CORRIGIDO** | Guarda contra clique duplo (`os._marcandoPronto`); revert também chama `kbRender()` para tirar o card da coluna errada. |
| 14 | `kbReceberSaldo()` | OS + financeiro | `kb_os` + `fin_cr` + `fin_tx` + `orcamentos` | ✅ | ✅ | ✅ | leitura fresca dentro da própria transação | ✅ | **CORRIGIDO (atomicidade real)** | Reescrita para transação única multi-documento — ver seção dedicada de atomicidade abaixo. Idempotente: retry/duas abas nunca duplicam. |
| 15 | `osExcluir(id)` | OS (exclusão) | `kb_os` | ✅ | ✅ | ✅ restaura OS e Kanban | herda | ✅ | **CORRIGIDO** | Achado adicional (fora do inventário original do agente) — toast de sucesso incondicional antes do fix. |
| 16 | `kbDrop` (arrastar card entre colunas) | OS | `kb_os` | ✅ (herdado) | não | não | não | não mostra toast | **SEGURO MAS SEM FEEDBACK** | Reordenação de data/coluna; sem impacto financeiro. Falha silenciosa = card volta à posição antiga no próximo `_cloudWatch`. |
| 17 | `kbSalvarTempo()` | OS | `kb_os` | ✅ (herdado) | não | não | não | não mostra toast | **SEGURO MAS SEM FEEDBACK** | Campo de anotação de tempo de produção, não afeta estoque/financeiro. |
| 18 | `kbSalvarPrazo()` | OS | `kb_os` | ✅ (herdado) | não | não | não | ❌ toast "Prazo salvo" incondicional | **NÃO VALIDADO — pendente rodada futura** | Prazo de entrega é client-facing; falha silenciosa pode divergir da promessa feita ao cliente. Não corrigido nesta rodada (fora das prioridades 1-7 explícitas), registrado como pendência real. |
| 19 | `kbPlanAnexar()` | OS (anexo) | `erp_plan_<id>` + `kb_os` | ✅ (herdado) | não | não | não | ❌ toast incondicional | **SEGURO MAS SEM FEEDBACK** | Anexo de arquivo de planificação; falha = anexo não aparece, sem corromper dado de negócio. |
| 20 | `kbPausarProducao()` | OS | `kb_os` | ✅ (herdado) | não | não | não | ❌ toast incondicional | **SEGURO MAS SEM FEEDBACK** | Reverte status para "iniciada"; pior caso é o status voltar ao anterior no próximo listener. |
| 21 | `kbNormalizarDatas()` | OS | `kb_os` | ✅ (herdado) | não | não | não | não mostra toast | **SEGURO MAS SEM FEEDBACK** | Rotina de limpeza de formato de data, roda uma vez, sem efeito financeiro. |
| 22 | `kbToggleEtapa()` | OS | `kb_os` | ✅ (herdado) | não | não | não | não mostra toast | **SEGURO MAS SEM FEEDBACK** | Checklist de produção, visual apenas. |
| 23 | `kbSaveKbos()` (wrapper central) | OS | `kb_os` | ✅ (corrigido) | (ver chamadores) | (ver chamadores) | herda | n/a | **CORRIGIDO (primitiva)** | Agora retorna a Promise de `_cloudSave` em vez de descartá-la — todos os chamadores acima passaram a poder aguardar. |

## 3. Contas a Receber / Contas a Pagar (prioridades 4-5)

| # | Função | Módulo | Documento | Retorna Promise | Aguarda | Trata `{ok:false}` | Reconcilia | Sucesso antes do commit | Classificação | Justificativa |
|---|---|---|---|---|---|---|---|---|---|---|
| 24 | `_finCRBaixaConfirmar(id, dtISO)` | Contas a Receber | `fin_cr` + `fin_tx` | ✅ | ✅ | ✅ reverte status/TX | não aplicável (revert local) | ✅ | **CORRIGIDO** | Bug real corrigido: a guarda de idempotência marcava `status='recebido'` **antes** do commit, bloqueando retry mesmo sem nada salvo. |
| 25 | `_finCPPagarConfirmar(id, dtISO)` | Contas a Pagar | `fin_cp` | ✅ | ✅ | ✅ reverte status/data | via `_confirmarAposSalvar` | ✅ | **CORRIGIDO** | Mesmo padrão de bug do item 24, corrigido. |
| 26 | `finCREstornar()` | Contas a Receber | `fin_cr` | ✅ (herdado) | não | não | não | ❌ toast incondicional | **NÃO VALIDADO — pendente rodada futura** | Reverte um recebimento já confirmado; fora do escopo das prioridades 1-7 explícitas, mas é dinheiro — registrado como pendência real, não "baixo risco". |
| 27 | `finCPEstornar()` | Contas a Pagar | `fin_cp` | ✅ (herdado) | não | não | não | ❌ toast incondicional | **NÃO VALIDADO — pendente rodada futura** | Mesmo padrão do item 26, para pagamentos. |
| 28 | `_finSaveCR()` / `_finSaveCP()` (wrappers) | Financeiro | `fin_cr` / `fin_cp` | ✅ (corrigido) | (ver chamadores) | (ver chamadores) | herda | n/a | **CORRIGIDO (primitiva)** | — |

## 4. Pagamentos / Caixa (`fin_tx`) (prioridade 6)

| # | Função | Módulo | Documento | Retorna Promise | Aguarda | Trata `{ok:false}` | Sucesso antes do commit | Classificação | Justificativa |
|---|---|---|---|---|---|---|---|---|---|
| 29 | `finEditTX()` | Caixa | `fin_tx` | ✅ | ✅ | ✅ restaura valor anterior | ✅ | **CORRIGIDO** | — |
| 30 | `finDeleteTX()` | Caixa | `fin_tx` | ✅ | ✅ | ✅ reinsere no índice original | ✅ (agora com toast de sucesso, antes não tinha nenhum) | **CORRIGIDO** | Antes não mostrava toast nenhum em sucesso — comportamento "SEGURO MAS SEM FEEDBACK" virou SEGURO com feedback. |
| 31 | `finAntecipar()` | Caixa | `fin_tx` | ✅ | ✅ | ✅ reverte status/valor | ✅ | **CORRIGIDO** | — |
| 32 | `finBaixaManual()` | Caixa | `fin_tx` | ✅ | ✅ | ✅ remove lançamento | ✅ | **CORRIGIDO** | — |
| 33 | `relSalvarCaixaAnt()` | Dashboard/DRE | `erp_caixa_ant` | ✅ | ✅ | ✅ restaura valor anterior | ✅ | **CORRIGIDO** | — |
| 34 | `orcGerarOS()` → lançamento inicial em `fin_tx` | Orçamento/OS | `fin_tx` (1 de 6 documentos) | ✅ | ✅ (via `Promise.all` consolidado) | ✅ parcial (ver item 41) | ✅ | **CORRIGIDO** | Ver detalhe na seção 6. |

## 5. Estoque de retalhos, fornecedores (baixo volume, não priorizados)

| # | Função | Módulo | Documento | Aguarda | Sucesso antes do commit | Classificação | Justificativa |
|---|---|---|---|---|---|---|---|
| 35 | `fornSaveAll()` | Fornecedores | `erp_fornecedores` | não | não mostra toast própria | **SEGURO MAS SEM FEEDBACK** | Cadastro de fornecedor, sem impacto financeiro direto; falha = próxima edição sobrescreve. |

## 6. Orçamento e conversão em OS (prioridade 8)

| # | Função | Módulo | Documento(s) | Retorna Promise | Aguarda | Trata `{ok:false}` | Sucesso antes do commit | Classificação | Justificativa |
|---|---|---|---|---|---|---|---|---|---|
| 36 | `orcGerarOS()` (`window.orcGerarOS`, versão ativa) | Orçamento → OS | `fin_tx` + `fin_cr` + `stock` + `clientes` + `kb_os` + `orcamentos` | ✅ (todas as 6) | ✅ (`Promise.all` consolidado) | ✅ parcial — `kb_os` é revertido (OS e card removidos) se falhar; os demais 5 documentos não têm rollback automático (fluxo legado com muitos efeitos colaterais de UI já aplicados), mas o operador é avisado com clareza de exatamente quais falharam | ✅ (toast final e navegação automática só depois do `Promise.all`) | **CORRIGIDO (parcial — sem rollback total)** | Alcançável de verdade: Novo Orçamento → item(ns) → "Confirmar Pagamento" → "Gerar Ordem de Serviço". Reescrita para aguardar as 6 gravações antes de qualquer ação de "sucesso"; revert completo dos 6 documentos não foi feito por seria uma reengenharia grande deste fluxo legado (fora do escopo desta auditoria de `_cloudSave`). |
| 37 | `function orcGerarOS()` (declaração antiga, mesma `<script>`) | — | — | — | — | — | — | **CÓDIGO MORTO (comprovado)** | Duas declarações de `orcGerarOS` na mesma tag `<script>`: a `function orcGerarOS(){}` é sombreada pela atribuição posterior `window.orcGerarOS = function(){}` (mesmo bloco de script, sem `</script>` entre as duas) — o `onclick="orcGerarOS()"` do botão sempre resolve para a versão mais recente. A declaração antiga nunca executa. Não removida nesta rodada (risco zero, mudança cosmética fora do escopo). |
| 38 | `orcSetEnviados()` | Orçamento | `orcamentos` | ✅ | ✅ (chamadores relevantes aguardam) | ✅ reconcilia com `serverData` em conflito | ✅ | **SEGURO** (corrigido em rodada anterior) | Vetor confirmado do incidente original de sobrescrita — já corrigido antes desta rodada. |
| 39 | `orcAutoSalvarCliente()` | Orçamento/CRM | `clientes` | ✅ (herdado) | não | não | ❌ não mostra toast própria | **SEGURO MAS SEM FEEDBACK** | Auto-cria cliente a partir de orçamento salvo; falha = cliente não aparece até novo orçamento, sem duplicar nem corromper. |

## 7. CRM (`crm_leads`) — auditados nesta rodada (item 7)

| # | Função | Alcançável? | Documento | Aguarda | Sucesso antes do commit | Classificação | Justificativa |
|---|---|---|---|---|---|---|---|
| 40 | `crmSaveLeads()` (wrapper central) | — | `crm_leads` | (ver chamadores) | n/a | **CORRIGIDO (primitiva)** | Retorna a Promise de `_cloudSave` (antes descartava). |
| 41 | `crmConverterEmOS()` | ✅ sim (botão "Converter em OS" no card do lead) | `crm_leads` (+ tentativa de `kb_os` que nunca existiu) | não | ❌ era o pior caso: **sempre** mostrava "✅ OS criada" e movia o lead para "Fechado", mesmo sem nenhuma OS ter sido criada (referenciava `kbNovaOS`/`KB_DATA`/`kbSave`, nenhum dos quais existe no arquivo) | **CORRIGIDO (bug funcional, não só timing)** | Achado adicional fora do inventário original. Corrigido para não afirmar sucesso nem mover o lead quando a criação de OS é impossível; a implementação real da conversão fica pendente de decisão de regra de negócio em rodada futura. |
| 42 | Edição inline de campo (cidade/segmento) no card do lead | ✅ sim | `crm_leads` | não | não mostra toast própria | **SEGURO MAS SEM FEEDBACK** | Falha = o campo não persiste, listener resincroniza na próxima carga; sem impacto financeiro/estoque. |
| 43 | `crmSimularLead()` / criação via IA (linha 9607) | ✅ sim (botão de simulação/demo) | `crm_leads` | não | ❌ toast incondicional | **SEGURO MAS SEM FEEDBACK** | Cria um card de lead de demonstração; sem impacto financeiro. |
| 44 | `crmMoverEtapa` variantes (congelar, avançar etapa, mover fase) | ✅ sim | `crm_leads` | não | ❌ toast incondicional | **SEGURO MAS SEM FEEDBACK** | Mudança de coluna no funil de vendas; falha = card volta à coluna antiga no próximo `_cloudWatch`. |
| 45 | `crmSalvarNovoLead()` | ✅ sim | `crm_leads` | não | ❌ toast incondicional | **SEGURO MAS SEM FEEDBACK** | Cadastro manual de lead; falha = lead não aparece, usuário percebe pela ausência do card (sem estado "fantasma" enganoso). |
| 46 | `crmPushOrcamento()` | ✅ sim (chamado por `orcGerarOS`) | `crm_leads` | não | não mostra toast própria neste ponto | **SEGURO MAS SEM FEEDBACK** | Cria/atualiza card de CRM a partir da OS recém-criada; efeito secundário de exibição, não afeta o financeiro da OS em si. |
| 47 | `crmBasePushKanban()` | ✅ sim | `crm_leads` | não | ❌ toast incondicional | **SEGURO MAS SEM FEEDBACK** | — |
| 48 | `_crmVincularCliente()` | ✅ sim | `crm_leads` | não | não mostra toast própria | **SEGURO MAS SEM FEEDBACK** | Vincula lead a cliente já cadastrado; metadado de CRM. |
| 49 | Auto-cria lead ao gerar OS pelo fluxo padrão (`orcEnvGerarOS`) | ✅ sim | `crm_leads` | não | não mostra toast própria | **SEGURO MAS SEM FEEDBACK** | — |

**Conclusão sobre `crm_leads`:** nenhum dos 10 chamadores de `crmSaveLeads()` toca dinheiro, estoque ou numeração oficial — todos são metadados do funil de vendas (etapa, campos de contato, cards visuais). O único achado realmente grave no bloco CRM (`crmConverterEmOS` afirmando falsamente ter criado uma OS) foi corrigido. Os demais permanecem "SEGURO MAS SEM FEEDBACK": o pior caso comprovado é uma edição não persistida que o usuário percebe e refaz — não uma perda de dado financeiro/operacional oculta.

## 8. Clientes

| # | Função | Documento(s) | Aguarda | Classificação | Justificativa |
|---|---|---|---|---|---|
| 50 | `cliExcluir()` | `clientes` + `clientes_lixeira` | ✅ | **CORRIGIDO** | Guarda contra clique duplo; reverte ambos os documentos se qualquer um falhar. |
| 51 | `cliRestaurar()` | `clientes` + `clientes_lixeira` | ✅ | **CORRIGIDO** | — |
| 52 | `cliExcluirPermanente()` | `clientes_lixeira` | ✅ | **CORRIGIDO** | — |
| 53 | `cliEsvaziarLixeira()` | `clientes_lixeira` | ✅ | **CORRIGIDO** | — |
| 54 | `cliConfirmarNovo()` (criar/editar) | `clientes` | ✅ | **CORRIGIDO** | — |
| 55 | `cliImportConfirm()` (importação em lote) | `clientes` | não | **NÃO VALIDADO — pendente rodada futura** | Importação em lote sobrescreve o array inteiro; risco real de conflito com edição concorrente, não corrigido nesta rodada (fora das prioridades 1-7 explícitas). |
| 56 | `cliSaveLixeira()` / `cliSaveClientes()` (wrappers) | `clientes_lixeira` / `clientes` | (ver chamadores) | **CORRIGIDO (primitiva)** | Retornam a Promise de `_cloudSave`. |

## 9. Compras (legado v1 vs v2)

| # | Módulo | Mecanismo | Alcançável em `_HOMOLOG_MODE`? | Classificação | Justificativa |
|---|---|---|---|---|---|
| 57 | `comprasSave()` + ~6 call sites (`COMPRAS` array legado) | `_cloudSave('compras', COMPRAS)` | **Não** — comprovado por leitura de código: toda função de negócio de Compras (`comprasAvancarStatus`, `comprasCancelar`, `comprasNovaSolicitacaoModal`, `comprasGerarNecessidades`) começa com `if(_HOMOLOG_MODE) return comprasV2...(...)`, redirecionando para v2 antes de qualquer código do array legado rodar | **NÃO UTILIZA `_cloudSave` (efetivamente) — código morto no modo homologado** | `comprasSave()` foi corrigido para retornar Promise (item de higiene), mas nenhum caminho de UI ativo no modo homologado chega a chamá-la. Mantida só por retrocompatibilidade com instalações fora de `_HOMOLOG_MODE`. |
| 58 | `comprasV2CriarSolicitacao`, `comprasV2Aprovar`, `comprasV2RegistrarRecebimento`, `comprasV2AdicionarDocumento`, `comprasV2RegistrarPagamento`, `comprasV2Cancelar` | `firebase.functions().httpsCallable(...)` com `requestId` idempotente | **Sim — é o fluxo ativo** | **NÃO UTILIZA `_cloudSave` (por design, mais seguro)** | Escrita acontece 100% em Cloud Functions server-side (`functions/src/compras.ts`), com Rules explícitas `allow write: if false` nas coleções `erp_vr_compras`/`erp_vr_fin_cp` — cliente nunca escreve direto. Confirmado por inspeção do código-fonte das Functions nesta rodada; **validação end-to-end real no Emulator (duplo clique, duas abas, mesmo/diferente `requestId`) ainda pendente — ver item 6 do relatório de E2E**, não é uma alegação de segurança apenas por arquitetura. |

## 10. Configurações, segurança, auditoria (baixo volume)

| # | Função | Documento | Classificação | Justificativa |
|---|---|---|---|---|
| 59 | `cfgSave()` | `erp_config` | **SEGURO MAS SEM FEEDBACK** | Config de precificação (materiais/mão de obra/margem) — usada para CALCULAR preços futuros, não altera pedidos já fechados; falha = próxima edição sobrescreve. |
| 60 | `mkSalvarNoERP()` | `erp_config` | **SEGURO MAS SEM FEEDBACK** | Parâmetros de comissão/imposto/margem — mesmo raciocínio do item 59. |
| 61 | `usrSalvarPerms()`, `usrSalvar()`, `usrDel()`, `usrRecriarAcesso()` | `erp_permissoes` / `erp_usuarios` | **NÃO TOCADO — fora do escopo desta auditoria** | Usuários/permissões/senhas reais são explicitamente proibidos de alterar nesta rodada (restrição permanente do engajamento). Auditados apenas para leitura, não modificados. |
| 62 | `secAlterarSenha()` | `erp_master_pwd` | **NÃO TOCADO — fora do escopo desta auditoria** | Senha mestre — mesma restrição do item 61. |
| 63 | `secAuditLog()` / `secLimparAudit()` | `erp_audit_log` | **SEGURO MAS SEM FEEDBACK** | Log de auditoria — mesmo raciocínio do log de estoque, mas de risco ainda menor (não referenciado por nenhuma regra de negócio). |
| 64 | `comissaoSalvarMetas()`, `vendedorAdicionar/Remover()`, `secSaveInactTime()` | `erp_metas_vendedor` / `erp_vendedores` / `erp_inact_mins` | **SEGURO MAS SEM FEEDBACK** | Configuração administrativa de baixo volume. |
| 65 | `posvSave()` | `erp_posvendas` | **SEGURO MAS SEM FEEDBACK** | Follow-up de pós-venda, informativo. |
| 66 | `cfgSalvarMatPrecos()`, `orcSalvarPreset()`, `cfgDeleteMachPreset()`, `planProdSalvar()`, `planProdSaveList()`, `_prodSave()` | `erp_mat_prices` / `erp_mach_presets` / `erp_orc_produtos` / `erp_plan_produtos` | **SEGURO MAS SEM FEEDBACK** | Tabelas de apoio a cálculo de preço — usadas para cotações futuras, não alteram pedidos já fechados. |
| 67 | `siteSaveLeads()`, `siteSalvarConfig()`, `siteShopifySync()` | `crm_site_leads` / `shopify_cfg` | **SEGURO MAS SEM FEEDBACK** | Integração de site/Shopify — fora do fluxo financeiro/estoque principal. |
| 68 | `chatvoltSalvar()` | `chatvolt_*` | **NÃO TOCADO — explicitamente fora do escopo (Chatvolt/Valéria)** | Restrição permanente do engajamento. |

---

## Resumo por classificação

| Classificação | Quantidade aproximada | Observação |
|---|---|---|
| **CORRIGIDO nesta rodada** | 24 funções/pontos (estoque, OS, CR/CP, caixa, clientes, orçamento parcial, CRM) | Todos com suíte de regressão associada (57 testes unitários novos/atualizados, 100% verde) |
| **SEGURO** (já corrigido antes desta rodada ou por Cloud Function idempotente) | 3 (`kbConfirmarProd`, `orcSetEnviados`, Compras v2 via Functions) | — |
| **SEGURO MAS SEM FEEDBACK** (justificado, não é "baixo risco" presumido) | ~25 (metadados de CRM, configurações de apoio a cálculo, logs de auditoria, campos não-financeiros de OS) | Cada linha tem justificativa própria na tabela acima — nenhuma foi classificada apenas por "parecer" de baixo risco |
| **NÃO VALIDADO — pendente rodada futura** | 6 (`kbSalvarPrazo`, `finCREstornar`, `finCPEstornar`, `cliImportConfirm`, retalhos, orçamento — rollback total de `orcGerarOS`) | Fora das prioridades 1-7 explícitas desta rodada; registrados como dívida real, não descartados |
| **NÃO UTILIZA `_cloudSave`** | 2 (Compras v1 legado — código morto; Compras v2 — Cloud Functions) | Compras v1 comprovado inalcançável por leitura de código, não por suposição |
| **CÓDIGO MORTO comprovado** | 1 (`function orcGerarOS()` antiga, sombreada) | — |

**Nenhum chamador classificado como INSEGURO permanece sem correção ou justificativa registrada.** Os 6 itens "NÃO VALIDADO" são explicitamente reconhecidos como pendência real (não presumidos seguros) e ficam bloqueados para tratamento em rodada futura antes de qualquer expansão de escopo (Fase 7).
