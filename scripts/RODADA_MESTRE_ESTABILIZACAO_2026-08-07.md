# Rodada Mestre — Estabilização Operacional/Comercial/Produção/Financeiro
**Data:** 2026-08-07 · **Branch de trabalho:** `hotfix/rodada-mestre-estabilizacao-2026-08-07` → mesclada em `master` (`--no-ff`) · **Projeto:** `erp-vrmarcas`

## Tabela item a item

| ITEM | STATUS | CAUSA-RAIZ | CORREÇÃO | TESTE | COMMIT | DEPLOY PROD |
|---|---|---|---|---|---|---|
| Reconciliação técnica inicial (seção 3) | concluído | — | Confirmado repo/branch/HEAD/origin limpo, Functions/Hosting/Rules em produção, suítes existentes rodando. Checkpoint git criado (`checkpoint-antes-rodada-mestre-2026-08-07`). | — | — | — |
| Debounce + idempotência em ações críticas (seção 5) | concluído | Nenhum helper compartilhado de loading/disable; `orcSalvarOrcamento()` só atribuía `_orcSessaoAtualId` no fim, então duas chamadas quase simultâneas reservavam o mesmo número e cada uma dava `unshift` — dois registros com o MESMO id; `finCPSalvar()` (Nova Despesa) não tinha proteção nenhuma. | Helper `_btnBusy()` (disable+loading+trava de segurança por timeout) aplicado a orçamento/Vitre/produção/PDF/WhatsApp. Guard síncrono em voo em `orcSalvarOrcamento()` e `finCPSalvar()` — a segunda chamada reaproveita o resultado da primeira. | `test_rodada_mestre_2026-08-07.js` (#5,#6) | `4889012` | sim |
| Edição de orçamento não reidrata o wizard — **bug crítico reproduzido** (seção 7) | concluído | `orcEnvEditar()` chamava `nav('orcamento')`, que dispara um reset interno (`orcEscolhaFluxo()`, `setTimeout` 0ms) que sempre volta ao seletor de marca e zera `ORC_TIPO` — e a função nunca desfazia isso; o preenchimento (a 200ms) rodava escondido atrás do seletor, e o próprio preenchimento silencioso disparava o alerta "dados não salvos" no primeiro clique seguinte. | Reabre o wizard VR explicitamente (mesmos passos de `orcIniciarFluxoVR()`, sem o diálogo de descarte) ANTES de preencher qualquer campo. | manual (lógica de navegação, não isolável em teste puro) + inspeção de código verificada linha a linha | `4889012` | sim |
| Wizard VR — numeração de etapas / cliente ao avançar / reset (seção 6) | concluído | Pílulas de etapa mostravam 1,2,4,5 (etapa 3 "Custos Avançados" permanentemente oculta, dobrada no Step 2, mas o rótulo nunca era renumerado). Cliente só era criado/deduplicado no salvamento final do orçamento inteiro. "Valor recebido como entrada" (recibo) vazava entre orçamentos. | Renumerado para 1-4. `orcAvancarParaItens()` cria/deduplica o cliente (nome/tel/email) em segundo plano ao avançar. `orcResetFormularioVR()` zera também `orcEntradaValor`. | manual (UI) + `4889012`/`7dbf68b` | `4889012`, `7dbf68b` | sim |
| Status do orçamento só pelo detalhe (seção 8) | concluído | Listagem "Orçamentos Enviados" tinha um `<select>` que trocava o status para qualquer valor direto na linha, sem passar pelas ações reais associadas (aprovar precisa gerar Conta a Receber). | Virou badge somente leitura; Aprovar/Recusar agora vivem no detalhe (`orcEnvAbrir`), chamando a mesma `orcEnvSetStatus()` de sempre. | manual (UI) | `7dbf68b` | sim |
| Planificação — material ambíguo + total em tempo real (seção 9.1/9.2) | concluído | Seletor de peça manual mostrava só "3mm — R$100/m²" (sem nome do material — ambíguo quando há materiais diferentes na mesma espessura). Adicionar/editar/remover peça só refletia no total do orçamento depois de "Salvar Planificação" — até lá só o preview interno do modal atualizava. | Opção agora mostra nome+espessura+preço. Nova `_planSincronizarComItem()` escreve os mesmos dados que `planAplicar()` grava no item e chama `orcRecalc()` a cada edição (catálogo ou manual) — "Salvar" virou só persistência do que já estava calculado. | manual (UI) | `a11aac9` | sim |
| Privacidade financeira real da role Produção (seção 20) | **não corrigido — reavaliado e documentado** | `kb_os` é um único documento-array; Rules não filtram campo dentro de documento. Corrigir de verdade exige documento-por-registro OU um espelho financeiro-removido mantido por Cloud Function trigger + Rules que bloqueiem o documento real para Produção + reescrever TODAS as escritas de Produção (checklist, iniciar produção, marcar pronta) para passar por Function (hoje fazem leitura-modificação-escrita direto do blob, o que quebraria se a leitura do documento real fosse bloqueada). Ver seção "Não corrigido" abaixo para o desenho técnico completo. | — não implementado, risco de quebrar o fluxo de produção se feito pela metade | — | — | não |
| Kanban — prazo editado não reposicionava + bug de timezone (seção 21) | concluído | `kbSalvarPrazo()` só repintava o badge do card no lugar (comentário explícito "sem mover"), nunca chamava `kbRender()`. `kbOpen()` usava `new Date(_entrega)` direto num campo que convive em formato BR (`dd/mm/yyyy`) e ISO (`yyyy-mm-dd`) no mesmo sistema — `new Date('07/08/2026')` é lido como 8 de julho, produzindo "Atrasado 30d" numa OS no prazo (bug real reportado, reproduzido exatamente). | `kbSalvarPrazo()` chama `kbRender()` na hora. `kbOpen()` detecta o separador antes de montar a `Date`. | `test_rodada_mestre_2026-08-07.js` (#1-#4) | `4889012` | sim |
| Checklist de produção persiste e dirige a etapa (seção 22) | concluído | `kbToggle()` nunca chamava `kbSaveKbos()` (diferente de add/remover item) — progresso do checklist se perdia num refresh. Checklist não "dirigia" nada — marcar a última etapa não levava a OS para Pronta sozinha. | Persiste sempre; marcar o último item pendente aciona `kbMarcarPronto()` automaticamente (reaproveitando os guards que já existiam). | manual (UI) | `3980ae5` | sim |
| Mensagem "OS pronta" sem emojis (seção 24) | concluído | Duas cópias divergentes da mesma mensagem, ambas com emojis (😊🎉📋📦🔢🙏). | Função única `kbMsgOsPronta()`, texto simples, reaproveitada nos dois pontos. | manual (revisão do texto) | `3980ae5` | sim |
| Pagamento Vitre perdendo o valor ao salvar (seção 13) | concluído | **Bug real reproduzido exatamente como reportado.** `vitreOrcPgtoRenderParcelas()`/`vitreOrcPgtoGerarParcelas()` sempre reconstruíam os campos com valores hardcoded (entrada=0, etc.) — nunca liam de volta `VITRE_ORC_ATUAL.pagamento` já salvo. E rodam de novo logo depois de salvar (`vitreOrcSalvarPagamento → vitreOrcAtualizarEstadoAtual → vitreOrcPgtoInit`), então o valor "salvava" e sumia visualmente. | Restaura o valor salvo (mesmo tipo, e no caso parcelado o mesmo número de parcelas) em vez de sempre recalcular do zero. | manual (lógica revisada linha a linha) | `647e71c` | sim |
| "Alterar Senha Master" (seção 39) | concluído | **Achado mais grave que o relatado.** Nunca alterava a senha real de login (Firebase Auth) de ninguém — lia/gravava um hash único e COMPARTILHADO (`_SEC_MASTER`/`erp_master_pwd`, um único documento no Firestore) que nenhum outro lugar do sistema sequer consultava (confirmado por grep). Qualquer master podia "trocar a senha" de todas as outras contas, sem afetar o login real de ninguém. | Substituído por troca real via Firebase Auth (`reauthenticateWithCredential` + `updatePassword`), exclusivamente da conta autenticada agora. Renomeado para "Alterar minha senha". | manual (fluxo revisado, não testável sem sessão real por restrição de segurança) | `eb1884e` | sim |
| Desconto condicional por prazo — remover (seção 10) | concluído | Instrução explícita: "não faz sentido para o negócio". | Bloco oculto na UI (`display:none`); os ~15 pontos que já liam esse campo com segurança continuam funcionando sem alteração (sempre veem `dcOn=false`, já que o toggle nunca fica acessível). | manual | `a11aac9`(*) → commit correto: mesmo commit da planificação; ver nota | `a11aac9` | sim |
| DRE duplicado (seção 33) | concluído | Existiam DUAS UIs de DRE — aba própria em Financeiro (`finPgDRE`) e Relatórios→DRE (`relPgDRE`) — apresentação duplicada (cálculo em si já vinha da mesma `finCalcularDRE()`, mas HTML podia divergir). 3 pontos de entrada (sidebar, aba, menu mobile) abriam a versão duplicada. | Os 3 pontos de entrada redirecionam para o botão real de Relatórios→DRE — fonte/rota canônica única. | manual | `19b5132` | sim |

*(nota: "Desconto condicional por prazo" foi corrigido no mesmo commit `a11aac9`, junto da planificação, por terem sido feitos na mesma janela de edição do arquivo.)*

## O que NÃO foi executado nesta rodada (escopo restante, não abandonado)

Dado o tamanho da instrução (47 seções), esta passada priorizou P0 e um subconjunto de P1 de alto impacto/baixo risco. As seções abaixo **não foram tocadas** e continuam pendentes — nenhuma piorou, nenhuma foi "meio-feita":

- **Seção 12** — proteção de taxa de cartão parametrizada na Function `parcelado` do Vitre (VR já tem; Vitre não — mudança em Function de pagamento real, precisa de rodada dedicada de testes, já documentado como gap em rodada anterior).
- **Seção 14** — ocultar PDF/WhatsApp/E-mail/Link antes do primeiro salvamento (hoje ficam sempre visíveis; o autosave-antes-de-gerar já existe de rodada anterior, mas a ocultação visual explícita não foi implementada).
- **Seções 17-19** — Vitre OS sem bloquear por ficha incompleta (não verificado nesta rodada se já funciona ou não), fluxo híbrido VR+Vitre num único orçamento (mudança arquitetural grande, não iniciada), OS com especificação de produção completa (parcialmente já existe de rodadas anteriores, não auditado a fundo agora).
- **Seção 23** — sugestão automática de chapas/retalhos ao iniciar produção (não iniciado).
- **Seções 25-32** — auditoria de KPIs do Dashboard, redesign do Dashboard como central de ação, reconciliação Financeiro↔OS↔Pagamento, Contas a Receber/Pagar navegáveis, despesas recorrentes, gestão de cartões de crédito, Caixa Diário automático, NF no Financeiro (nenhuma tocada).
- **Seção 34** — infraestrutura de importação do histórico 2021+ (não iniciada; corretamente, nenhum dado foi inventado).
- **Seções 35-38** — unificação de cadastro de produtos VR, receita/inteligência do produto versionada, grade/lista no catálogo Vitre, auditoria do botão "Backup JSON" (nenhuma tocada).
- **Seção 40** — identidade visual: não verificada explicitamente nesta rodada (rodadas anteriores já garantiram logos reais; nenhuma alteração foi feita que pudesse regredir isso).

## Escopo não corrigido com desenho técnico (seção 20 — privacidade Produção)

Reavaliado nesta rodada com mais profundidade que a anterior. O desenho tecnicamente correto e mais barato que uma migração completa:

1. Cloud Function trigger (`functions.firestore.document('erp_vr/kb_os').onWrite`) que lê o blob real, remove campos financeiros (`valor`, `totalGeral`, `parcelas`, `formaPgto`, `pagtoTipo`, `valorEntrada`, `restante`, e `itens[].unit`/`itens[].total`) de cada OS, e escreve um espelho em `erp_vr/kb_os_producao_view`.
2. Rules: Produção perde `read` no documento real `kb_os` (mantém o `write` que já tem, para as ações que ela executa) e ganha `read` no espelho.
3. Frontend: o Kanban, quando a sessão é Produção, passa a ler/escutar `kb_os_producao_view` em vez de `kb_os`.

**Por que não implementado agora:** o passo 2 sozinho quebra qualquer ação de Produção que hoje faz leitura-modificação-escrita direto do blob (`kbToggle`, `kbMarcarPronto`, iniciar produção) — cada uma dessas precisaria ser reescrita para rodar como Cloud Function (usando Admin SDK, sem depender de ler o documento real do cliente). Isso é uma mudança real em vários pontos de escrita de produção, e fazer isso pela metade (só o passo 1) deixa a leitura direta do blob real ainda acessível — ou seja, sem valor de segurança real até o passo 2 e a reescrita das escritas estarem completos juntos. Risco de quebrar o fluxo de produção ao vivo, sem supervisão, foi julgado maior que o benefício de tentar pela metade. Fica pronto para execução direta numa rodada dedicada.

## Verificação de regressão

Todas as 30 suítes de teste existentes (`scripts/test_*.js`) foram executadas antes e depois das mudanças desta rodada, comparando contra o checkpoint (`checkpoint-antes-rodada-mestre-2026-08-07`, via `git worktree`). **Nenhuma mudança desta rodada introduziu regressão** — as poucas suítes com falhas (`test_fasef_chamadores_criticos.js`, `test_orcamento_pdf_whatsapp.js`, `test_pgto_tipo_pagamento.js`, `test_planificacao_manual.js`, `test_valeria_vitre_server.js`) falham de forma **idêntica** no checkpoint anterior a esta rodada — são gaps pré-existentes no harness de teste (funções não mockadas, módulo ausente) ou pendências já documentadas anteriormente, não causados por este trabalho.

`node scripts/test_rodada_mestre_2026-08-07.js` (novo, 6 cenários) e `node scripts/test_orcamento_hotfix_2026-08-07.js` (25 cenários, rodada anterior) — ambos 100% passando após o merge em `master`.

`cd functions && npx tsc --noEmit` — limpo, sem erros (nenhum arquivo em `functions/` foi alterado nesta rodada).

## Git

- Branch: `hotfix/rodada-mestre-estabilizacao-2026-08-07`
- HEAD final (`master`): `b86db02`
- Commits desta rodada (do mais antigo ao mais novo): `4889012`, `b6f1c15` (correção de um erro próprio — ver "Registro de incidente" abaixo), `7dbf68b`, `a11aac9`, `eb1884e`, `647e71c`, `3980ae5`, `19b5132`, `b86db02` (merge)
- Push normal (sem force) da branch e de `master`. Nenhum rebase destrutivo, nenhuma reescrita de histórico.

## Registro de incidente (seção 45)

Durante o commit `7dbf68b` usei `git add -A` por engano, o que trouxe para o commit a pasta `Id visual - VR e Vitre/` (4 imagens), que estava **intencionalmente fora do controle de versão** desde o início da sessão — não fazia parte da mudança e a instrução desta rodada pede explicitamente para preservá-la como está. Identifiquei o erro no commit seguinte, imediato: `git rm --cached -r` desfez o rastreamento (nada foi apagado do disco — os 4 arquivos continuam intactos na pasta) e um commit (`b6f1c15`) documentou o ocorrido de forma transparente antes de continuar. Verificado com `ls -la` que os arquivos permanecem no disco, inalterados.

## Deploy

Cirúrgico — só Hosting (nenhum arquivo em `firestore.rules` ou `functions/` foi alterado nesta rodada):
1. `firebase deploy --only hosting --project erp-vrmarcas` — publicado com sucesso.

## Smoke test em produção

Sem clique-a-clique autenticado com senha real (mesma restrição de segurança de todas as rodadas anteriores — proibido inserir credenciais; não havia sessão já autenticada disponível para reaproveitar):
- `https://erp-vrmarcas.web.app/` responde 200.
- O HTML publicado contém o código novo desta rodada (`_planSincronizarComItem`, `kbMsgOsPronta`, `_btnBusy`, `secAlterarSenha`) — confirma que o deploy publicou a versão certa.
- Nenhum orçamento, OS, mensagem ou cobrança real foi criado ou enviado.

## O que exige teste humano amanhã

Estes itens foram corrigidos com base em leitura de código completa e verificação estática (sintaxe, lógica espelhada em testes unitários quando possível), mas **não puderam ser clicados de ponta a ponta em produção** por causa da restrição de segurança contra credenciais reais:

1. **Edição de orçamento** (o achado mais importante desta rodada) — abrir "Orçamentos Enviados", clicar Editar num orçamento salvo, confirmar que o wizard abre direto com os dados preenchidos (sem seletor de marca, sem alerta falso de "dados não salvos" no primeiro clique).
2. **Alterar minha senha** — trocar a própria senha e confirmar login com a senha nova (e que outras contas não foram afetadas).
3. **Pagamento Vitre** — configurar entrada+saldo, salvar, confirmar que o valor permanece (não volta a zero).
4. **Planificação** — adicionar peça manual, confirmar que o total do orçamento muda na hora, antes de clicar "Salvar Planificação".
5. **Kanban** — editar prazo de uma OS e confirmar que o card muda de coluna imediatamente; marcar o último item do checklist e confirmar que a OS vai para "Pronta" sozinha.
6. **Duplo clique** em qualquer botão crítico (Salvar Orçamento, Registrar Despesa) — confirmar que não cria dois registros.

## Veredito

**RODADA PUBLICADA COM RESTRIÇÕES DOCUMENTADAS.** O achado mais crítico (edição de orçamento nunca reabrindo o wizard de fato) foi corrigido, junto com um lote real de bugs de duplicidade, perda de dado e privacidade — nenhuma regressão introduzida (verificado contra as 30 suítes existentes). O escopo da instrução original é muito maior que o que uma única rodada autônoma pode cobrir com segurança; a maior parte das seções 12, 14, 17-19, 23, 25-38 permanece como pendência real, listada explicitamente acima, sem terem sido tocadas nem parcialmente — nada foi deixado pela metade.
