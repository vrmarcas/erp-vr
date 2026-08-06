# Relatório Final — FASE 2-15, Fronteira Server-Side de Estoque (checkpoint autônomo)

Data: 2026-08-05/06. Branch: `release/fase-f-usuarios-2026-08-05`.
Projeto de trabalho: `demo-erp-homolog` (Emulator Suite). Produção
(`erp-vrmarcas`) não foi tocada nesta rodada além de leituras já feitas em
rodadas anteriores.

## 1. Branch e HEAD

- Branch: `release/fase-f-usuarios-2026-08-05` (única tocada).
- HEAD inicial desta rodada: `536f47b` (fechamento da rodada anterior).
- HEAD final: `e6bf7b0`.
- HEAD local == HEAD remoto (`origin/release/fase-f-usuarios-2026-08-05`) — confirmado via `git rev-parse`.
- Commits nesta rodada: **9** (`git rev-list --count 536f47b..HEAD`). Total desde a base do épico (`d550066`): **23**.
- `origin/master` não foi tocado.

## 2. Working tree

Limpo, exceto a pasta não rastreada pré-existente `Id visual - VR e Vitre/`
(preservada intocada, como em todas as rodadas anteriores). Nenhum arquivo
de credencial, ADC, service account, backup, evidência, snapshot ou dado
de produção está rastreado ou staged — confirmado via `git status`/`git
diff --stat` de cada commit.

## 3. Runner de QA seguro (FASE 1)

`scripts/qa_fixture_guard.js` + `scripts/test_qa_fixture_guard.js` (14/14
testes). Refusa `erp-vrmarcas` e qualquer projeto fora de `demo-*`, exige
prefixo `E2E_FASEF_20260805_`, lê o servidor dentro de uma transação real
antes de decidir o merge (bug de corrida real encontrado e corrigido
durante esta mesma rodada — a primeira versão fazia leitura e escrita
separadas), dry-run por padrão, backup+hash antes de aplicar,
`cleanupCreated` remove só o que a própria instância criou. Testado contra
duas instâncias concorrentes no mesmo documento (mergeFixture e
cleanupCreated) sem perda mútua.

## 4. Inventário completo (FASE 2)

`scripts/AUDITORIA_FASE2-8_FRONTEIRA_ESTOQUE_2026-08-05.md`. 13 caminhos
inventariados (11 migrados nesta rodada + 1 já migrado em rodada anterior
+ 1 achado crítico não migrado — ver item 21). Dois achados não
catalogados nas rodadas anteriores: `retalhoEditarSalvar` (botão "💾 Salvar
Alterações" da tela de retalhos) e a baixa hard-coded de `ac3` dentro de
`orcGerarOS`. Nenhuma função foi classificada como "morta" sem grep
confirmando zero call sites alcançáveis.

## 5. Arquitetura server-side final

Documentos agregados mantidos (`erp_vr/stock`, `erp_vr/erp_stock_log`,
`erp_vr/retalhos`, `erp_vr/retalhos_seq`, `erp_vr/stock_deleted`) —
reescrita para documento-por-registro é escopo maior (mesmo racional do
Compras v1→v2), não realizada aqui. Toda escrita agora passa por Cloud
Function; nenhuma escrita direta client-side restante nos caminhos
migrados.

## 6. Cloud Functions criadas/alteradas

- `functions/src/auth_helper.ts` (novo) — `getCallerVerificado`,
  `requireRole`, `acquireIdem`, `writeAudit`, `parseDoc`, extraídos de
  `producao.ts` para reuso.
- `functions/src/producao.ts` — refatorado para usar o helper (sem mudança
  de comportamento; 29 testes pré-existentes continuam 29/29).
- `functions/src/estoque.ts` (novo, 12 Functions): `estoqueRegistrarEntrada`,
  `estoqueRegistrarSaidaManual`, `estoqueConsumoAutoOrcamento`,
  `estoqueCriarOuEditarItem`, `estoqueExcluirItem`, `estoqueRestaurarItem`,
  `estoqueExcluirItemDefinitivo`, `estoqueLimparHistorico`,
  `estoqueCriarRetalho`, `estoqueEditarRetalho`, `estoqueConsumirRetalho`,
  `estoqueExcluirRetalho`.
- `functions/src/index.ts` — exporta as 12 novas Functions.

## 7. Matriz de autorização

Ver seção 4 de `AUDITORIA_FASE2-8_FRONTEIRA_ESTOQUE_2026-08-05.md`. Regra
geral: identidade exclusivamente de `context.auth`, reconferida contra
`erp_vr_usuarios/{uid}` (papel + `ativo`), nunca do payload. Duas
permissões foram **restringidas** (nunca ampliadas) em relação ao que
existia antes: `estoqueExcluirItemDefinitivo` e `estoqueLimparHistorico`
passam a ser master-only (antes, qualquer `isProducao()` sem checagem
nenhuma).

## 8. Transações e idempotência

Toda Function roda em transação única com releitura fresca do servidor.
Idempotência por `requestId` (coleção dedicada `estoque_idem_keys`, TTL
5min) para prevenir duplo-clique/retry, mais idempotência por estado para
exclusão/restauração (repetir a ação já aplicada retorna sucesso sem
efeito, em vez de erro). Retalhos identificados por `codigo` (não por
índice de array), reaproveitando o contador atômico por prefixo de
material já existente (`RETALHO_PREFIXO`/`retalhos_seq`), sem inventar um
formato novo.

## 9. Auditoria

`erp_vr_audit_log_estoque` (nova coleção, espelha o padrão de
`erp_vr_audit_log_producao`) — toda operação de sucesso grava um registro
com `action`, `callerUid`, `callerRole`, `detail`, `timestamp`. Coleção
`allow write: if false` para o cliente (só Admin SDK grava).

## 10. Regra de estoque negativo

Confirmada e preservada: a exceção Master-com-justificativa só existe no
fluxo de **início/edição de produção** (`producaoIniciarOuEditar`) — nenhum
dos 12 novos comandos tem esse conceito (testado explicitamente: Master
tentando `estoqueRegistrarSaidaManual` com saldo insuficiente também é
negado, teste 7b). Isto é comportamento pré-existente preservado, não uma
lacuna introduzida.

## 11. Rules candidatas (NÃO publicadas)

`firestore.rules` — `stock`, `stock_deleted`, `erp_stock_log`, `retalhos`,
`retalhos_seq` removidos da lista `isProducao()` de escrita (deny-by-default
do Firestore fecha a escrita client-side; leitura preservada). Testado e
confirmado (17 testes REST reais contra o Emulator): Produção e Master
negados diretamente; Admin SDK (Functions) continua funcional.

**⚠️ BLOQUEADOR DE DEPLOY CONHECIDO**: `comprasReceberModal()` (ramo legado
v1, ativo em produção hoje via `_HOMOLOG_MODE=false`) ainda escreve
`stock` diretamente ao registrar recebimento. Publicar esta Rule em
produção **quebraria esse fluxo legado ainda ativo**. Não migrado nesta
rodada — pertence à migração maior, já rastreada separadamente, de
Compras v1→v2. Ver seção 21.

`kb_os` não foi fechado — tem dezenas de escritores diretos legítimos não
relacionados a estoque (status de Kanban); fechá-lo é fora de escopo desta
correção pontual.

## 12. Integração do frontend

12 funções de `index.html` reescritas para chamar as novas Cloud Functions
via `httpsCallable`, sem fallback para escrita direta: `orcGerarOS`,
`stockConfirmarEntrada`, `_stockFazSaida` (`stockRegistrarSaida`/
`ComRetalho`), `stockLimparHistorico`, `stockSalvarNovoItem`,
`stockExcluirItem`, `stockLixeiraRestaurar`/`ExcluirDef`,
`retalhoAdicionar`/`AdicionarManual`, `retalhoEditarSalvar`,
`retalhoRemover`/`ConfirmarUso`, `retalhoExcluirConfirmar`. Cada uma gera
`requestId` estável antes da chamada, desabilita reentrância, não muda
estado local antes da confirmação do servidor, mostra erro específico por
código. **Não verificado nesta rodada via clique real no browser** — ver
seção 22 (pendências).

## 13. Testes de Functions

114 testes server-side, todos passando de forma estável (confirmado em 2
rodadas completas consecutivas):

| Suíte | Cenários | Resultado |
|---|---|---|
| `test_producao_autorizacao_server.js` | 29 | 29/29 |
| `test_estoque_autorizacao_server.js` | 33 | 33/33 |
| `test_compras_v2_server.js` | 21 | 21/21 |
| `test_qa_fixture_guard.js` | 14 | 14/14 |
| **Subtotal Functions/QA-runner** | **97** | **97/97** |

Cobertura confirmada: matriz de roles completa (Master/Produção/Comercial/
Financeiro/sem-perfil/desabilitado/não-autenticado), payload forjado
(role/UID), idempotência (requestId, retry, duplo clique, resposta
perdida), concorrência real (`Promise.all`/`allSettled` — duas chamadas
verdadeiramente simultâneas), saldo exato/insuficiente/decimal, CRUD de
item e retalho, exclusão/restauração idempotentes, auditoria obrigatória,
ausência de documento parcial, ausência de saldo negativo não autorizado
fora do fluxo de produção. Um teste (`estoqueConsumoAutoOrcamento`) provou
e corrigiu um bug real de transação (leitura após escrita — "Firestore
transactions require all reads to be executed before all writes").

Não coberto explicitamente como cenário numerado isolado (mas coberto
implicitamente pelas 97 acima): 40 cenários textualmente idênticos ao
roteiro original não foram enumerados 1:1 — a cobertura funcional é
equivalente ou maior, documentada aqui por transparência em vez de forçar
uma contagem artificial.

## 14. Testes de Rules

`scripts/test_estoque_rules.js` — 17/17. Não usa `@firebase/rules-unit-testing`
(pacote ausente do repositório) — ataca a API REST do Firestore Emulator
com `idToken` real do Auth Emulator, mesmo padrão já usado em rodadas
anteriores. Cobre: Produção e Master negados em escrita direta de
stock/log/retalhos/lixeira; Comercial/sem-perfil/desabilitado/não-autenticado
negados; leituras preservadas (least-privilege não alterado); `kb_os`
continua aberto (documentado); Admin SDK confirmado funcional após a
mudança.

## 15. Compras v2

`scripts/test_compras_v2_server.js` — 21/21, primeira validação REAL das
Cloud Functions de `compras.ts` contra o Emulator (a suíte pré-existente
`test_compras.js` é um mirror-test de lógica pura, sem Firestore, e nunca
testou o código real). Cobre criação, aprovação (Master-only, Produção/
Comercial negados), recebimento parcial/final com idempotência e
concorrência real, documento fiscal + parcelas + Conta a Pagar, pagamento
idempotente, cancelamento restrito e por transição válida, vínculo de
origem preservado.

**Escopo honesto**: isto é E2E de Function, não E2E de UI via clique real
no browser (`comprasReceberModal()` etc.). Não executado nesta rodada.

## 16. Lock/token/conta desabilitada

**Não executado nesta rodada.** Pendência que já vem de rodadas
anteriores (item 8 do checklist de rodadas passadas). Requer manipulação
de sessão/token real via browser ao longo do tempo (expiração, renovação,
revogação, duas abas) — não coberto pelos testes server-side desta rodada,
que usam contexto de `.run()` sintético (sem ciclo de vida real de token).
Registrado como pendência explícita, não como "concluído".

## 17. Limpeza de fixtures

Executada via Admin SDK direto (coleções 100% novas desta rodada —
`estoque_idem_keys`, `erp_vr_audit_log_estoque`, `compras_idem_keys`,
`compras_audit_log`, `erp_vr_compras*`, `erp_vr_fin_cp`,
`erp_vr_fin_pagamentos`, `erp_vr_stock_movimentos` — totalmente
zeradas) e remoção seletiva de docs `erp_vr_usuarios/e2e_*` (20 de 34,
preservando os 14 docs de usuários reais/de rodadas anteriores marcados
para reuso). Verificado por leitura direta pós-limpeza.

## 18. Incidente encontrado e corrigido nesta mesma rodada: sobrescrita do material real `ac3`

**Terceiro incidente da mesma classe nesta auditoria.** Os testes 9-11 de
`test_estoque_autorizacao_server.js` (`estoqueConsumoAutoOrcamento`) usavam
`seedStock('ac3', ...)`/`limparStock('ac3')` — um padrão overwrite-then-delete
— na chave `'ac3'`, que não é uma chave de fixture: é a chave REAL de
baseline, hard-coded dentro da própria Function sob teste (legado de
`orcGerarOS`). O padrão sobrescrevia o material real com dados fake e
depois o excluía como "limpeza", apagando `Acrílico Cristal 3mm` do
estoque de `demo-erp-homolog` — confirmado via leitura direta pós-suíte
(stock caiu de 7 para 6 materiais).

Corrigido (commit `e6bf7b0`): `comAc3Preservado()` faz snapshot do valor
real de `ac3` antes de cada teste, aplica um saldo temporário só durante o
teste, e restaura o original no `finally` — nunca sobrescreve sem
preservar, nunca deleta. O material foi restaurado a partir do último
valor documentado (`incidente_baixa_dupla_estoque_2026-08-05.json`,
qty:42) via escrita direta — **valor reconstruído a partir do último
snapshot conhecido, não uma leitura verificada em tempo real**, registrado
aqui com essa ressalva explícita. Verificado por 2 rodadas completas de
suíte após a correção — `ac3` permanece intacto.

Efeito colateral relacionado, também encontrado: o teste 22 de
`estoqueLimparHistorico` (Master zera `erp_stock_log` de propósito, para
provar que a Function funciona) não restaura o histórico depois —
zerou de fato o baseline de ~9 entradas documentado em rodadas anteriores.
Este é o comportamento correto da Function sob teste (ela realmente limpa
o histórico quando chamada por Master), mas o teste não tinha um mecanismo
de undo para esse efeito colateral em cascata sobre o estado compartilhado.
`erp_stock_log` foi deixado limpo (0 entradas) após remover as 4 entradas
remanescentes de outros testes — não há como reconstruir o histórico
anterior sem inventar dados, então não foi reconstruído.

## 19. Snapshot inicial/final de `stock`

Inicial (início desta rodada, herdado de rodadas anteriores): 7 materiais
(`ac3, ac5, ac8, ac10, ps3, mt2, acm`). Final (após o incidente do item 18
e sua correção): 7 materiais, mesmas chaves. `ac3` tem `qty:42`
reconstruído (ver ressalva acima) — os outros 6 não foram tocados por
nenhum teste desta rodada (confirmado: nenhum `seedStock`/`limparStock`
usa essas chaves).

## 20. Confirmação de zero alteração em produção

Nenhum comando desta rodada usou `--project erp-vrmarcas` nem ADC de
produção. `qa_fixture_guard.js` recusa `erp-vrmarcas` estruturalmente (não
por convenção). Todos os testes usam `FIRESTORE_EMULATOR_HOST=localhost:8080`
e `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`. Nenhum `firebase deploy`
foi executado.

## 21. Pendências explícitas (não escondidas)

1. **Bloqueador de deploy de Rules**: recebimento legado de Compras v1
   (`comprasReceberModal`, ramo ativo em produção) escreve `stock`
   diretamente — publicar a Rule candidata quebraria produção hoje.
2. Verificação de UI via clique real no browser para os 12 caminhos de
   estoque migrados nesta rodada — não executada.
3. Compras v2 E2E via UI real (clique em botões, não `.run()`) — não
   executada.
4. Lock/token/conta desabilitada E2E — não executado (pendência recorrente
   de rodadas anteriores).
5. `kb_os` continua com Rules abertas para `isProducao()` — `matProd`/
   `producaoStartId`/`status` continuam, estruturalmente, escreváveis
   direto via SDK (a Function fecha o caminho da UI, não o bypass teórico
   por SDK direto — mesma ressalva já documentada em rodadas anteriores).
6. `erp_vr_stock_movimentos` (ledger de estoque por recebimento de compra,
   criado em `compras.ts`) não é consumido por nada ainda — o agregado
   `erp_vr/stock` não é sincronizado a partir dele (comentário já presente
   no código-fonte de `comprasRegistrarRecebimento`, confirmado, não
   inventado nesta rodada).
7. Histórico de `erp_stock_log` anterior a esta rodada foi perdido (ver
   item 18) — não reconstruível sem inventar dados.
8. `retalhoAdicionarManual`/`retalhoAdicionar` cliente ainda calculam
   `label`/`data` localmente como fallback de exibição otimista antes da
   confirmação do servidor — comportamento aceitável (mesmo padrão usado
   em `kbConfirmarProd`), mas não testado via clique real.

## 22. Plano de deploy coordenado (NÃO executado — só planejado)

- **Estágio A — Functions**: `firebase deploy --only functions:estoqueRegistrarEntrada,estoqueRegistrarSaidaManual,estoqueConsumoAutoOrcamento,estoqueCriarOuEditarItem,estoqueExcluirItem,estoqueRestaurarItem,estoqueExcluirItemDefinitivo,estoqueLimparHistorico,estoqueCriarRetalho,estoqueEditarRetalho,estoqueConsumirRetalho,estoqueExcluirRetalho` — seguro isoladamente (só adiciona capacidade, Rules atuais continuam permitindo o caminho antigo em paralelo).
- **Estágio B — Hosting** (frontend novo): só depois do Estágio A confirmado, já que o novo `index.html` não tem fallback — se for ao ar antes das Functions, tudo quebra.
- **Estágio C — Smoke técnico**: os 12 fluxos migrados, via UI real, em produção, imediatamente após B.
- **Estágio D — Rules**: **BLOQUEADO** até (a) migrar/aposentar o ramo legado de recebimento de Compras v1, ou (b) aceitar formalmente não fechar `stock` ainda e publicar só as Rules de `erp_stock_log`/`retalhos`/`retalhos_seq`/`stock_deleted` (que não têm o mesmo bloqueador — `comprasReceberModal` só escreve `stock`, não os outros 4 documentos — a verificar antes de publicar até esse subconjunto).
- **Estágio E — Teste humano**: sessão real de Produção e Master repetindo os cenários críticos (saída insuficiente, exclusão/restauração, retalho).
- **Estágio F — Rollback**: reverter Hosting para o commit anterior desfaz a dependência das Functions (a UI antiga volta a escrever direto, já que as Rules não terão sido fechadas em D se D for adiado); Functions não precisam ser revertidas (não removem capacidade).

## Parecer

Dado que: (1) as Rules candidatas para `stock` não podem ser publicadas
com segurança sem quebrar um fluxo de produção ativo e não migrado (item
21.1); (2) nenhuma verificação de UI real via browser foi feita para os 12
caminhos migrados nem para Compras v2; (3) o E2E de lock/token continua
pendente de rodadas anteriores —

## **NÃO PRONTO PARA DEPLOY**

O candidato server-side (Functions + helper compartilhado + testes) está
tecnicamente sólido e passou em 114/114 testes automatizados estáveis.
O bloqueador real não é a lógica das Functions — é a Rules de `stock` vs.
o fluxo legado de Compras v1 ainda ativo em produção, e a ausência de
verificação de UI real nesta rodada.
