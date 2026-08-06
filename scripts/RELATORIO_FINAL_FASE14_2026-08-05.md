# FASE 14 — Relatório Final: Correção Server-Side de Segurança de Estoque (2026-08-05)

## 1. Estado Git reconciliado

- Branch: `release/fase-f-usuarios-2026-08-05`
- HEAD local: `55dd661b8297883b589dac1ab82465b56e161c44`
- HEAD `origin/release/fase-f-usuarios-2026-08-05`: **idêntico** (`55dd661...`)
- `origin/master`: `bc6e1de6...` — **não tocado por nenhuma ação desta rodada**
- `git status`: limpo, exceto a pasta pré-existente `Id visual - VR e Vitre/` (não rastreada, não criada por mim)
- 13 commits exclusivos da branch desde a base anterior (`d550066`), 0 atrás de origin, 0 divergência

## 2. Explicação da divergência "7 vs 8 commits" do relatório anterior

O relatório da rodada anterior afirmou "7 commits" mas **listou 8**. Causa raiz: eu verifiquei "7 commits à frente de origin" **antes** de criar o commit do relatório final daquela rodada (`0aa2bb1`) — e depois, ao escrever o resumo, atualizei a lista de commits mas não recontei o número. Confirmado agora por `git rev-list --count d550066..0aa2bb1` = **8**, batendo com a lista. Peço desculpas pela inconsistência; nesta rodada, toda contagem reportada abaixo foi conferida por comando antes de ser escrita.

## 3. Working tree real

```
?? "Id visual - VR e Vitre/"
```
Único item — pasta pré-existente, não criada nesta auditoria, presente desde o início do engajamento. Os artefatos `scripts/_*_extracted.tmp.js` gerados pelos testes agora têm padrão dedicado no `.gitignore` (commit `c3f7301`) e foram removidos do disco ao final de cada rodada de testes.

## 4. Evidência preservada

`~/erp-vr-fasef-homolog-snapshots/incidente_bypass_autorizacao_estoque_negativo_2026-08-05.json` (+ `.sha256` = `03bb57a6e75b700c2088e2e9a4e744720754b95e4ebe2ce631717e52c2a38609`), fora do Git. Contém: UID mascarado da conta Produção, claim real, payload exato enviado, `stock` antes/depois, quantidade negativa gravada (`-996`), confirmação das ausências (validação server-side, justificativa, auditoria, vínculo de compra, Cloud Function), trecho das Rules que permitiram a escrita, horário, `project ID demo-erp-homolog`, e a restauração subsequente.

## 5. Causa raiz

A decisão "só Master pode autorizar início de produção com estoque insuficiente" vivia inteiramente no cliente: uma variável JavaScript local (`_currentSession.funcao==='master'`) decidia se um `confirm()` do navegador aparecia, e o resultado virava um booleano `prodAutorizado` **enviado pelo próprio cliente** para a transação do Firestore — que só verificava esse booleano, nunca reconferia quem realmente estava autenticado. Firestore Rules liberavam `stock`/`kb_os` para qualquer `role: producao` sem inspecionar o conteúdo da gravação (documento é um blob JSON serializado, Rules não conseguem validar campo a campo). Nenhuma Cloud Function mediava essa decisão — diferente do padrão já adotado em Compras v2.

## 6. Fronteira server-side adotada

Uma única Cloud Function (`producaoIniciarOuEditar`, `functions/src/producao.ts`) cobre início E edição de produção (chapa e retalho), incluindo a exceção de estoque insuficiente. Não foi criada uma arquitetura paralela — reaproveita o padrão já estabelecido em `compras.ts` (`functions.https.onCall`, idempotência via `requestId`, auditoria via coleção dedicada). Mantém o modelo de dados existente (documentos agregados legados `erp_vr/kb_os`, `erp_vr/stock`, `erp_vr/retalhos`, `erp_vr/erp_stock_log`) — não é uma migração para documento-por-registro (isso é o modelo do Compras v2, fora do escopo desta correção pontual).

## 7. Functions criadas ou alteradas

- **Nova**: `producaoIniciarOuEditar` (`functions/src/producao.ts`, 379 linhas)
- **Alterado**: `functions/src/index.ts` — exporta a nova function
- Nenhuma function existente (Compras v2, adminUsers, Valéria, Meta/Google Ads) foi alterada

## 8. Validação de identidade no servidor

`getCallerVerificado(context)`:
1. `context.auth` obrigatório (nunca campos do payload) → `unauthenticated` se ausente
2. Custom claim `role` obrigatória e válida → `permission-denied` se ausente/inválida
3. Releitura de `erp_vr_usuarios/{uid}` — documento deve existir → `permission-denied` se não existir
4. `ativo === 1` (ou `true`) obrigatório → `permission-denied` se conta desabilitada
5. `funcao` do documento deve **coincidir** com o claim → `permission-denied` (fail-closed) em qualquer divergência — mesmo que o claim diga "master", se o cadastro real diz "producao", a operação é negada

Nenhum campo do payload (`role`, `uid`, `email`, saldo, status) é lido para decidir identidade ou saldo — confirmado pelos testes 3 e 4 (payload forjado não tem efeito nenhum).

## 9. Modelo transacional

Uma única `db.runTransaction()` relê `kb_os` + `stock` + `retalhos` + `erp_stock_log` do zero, valida status da OS e idempotência (`producaoStartId`), aplica a mutação (baixa de chapa ou retalho, com restauração da baixa anterior em modo edição), grava os 4 documentos atomicamente — ou tudo comita, ou nada é alterado (testes 2, 10, 21 confirmam nenhum efeito parcial em falha).

## 10. Idempotência

- `requestId` do cliente → chave de idempotência de curto prazo (`producao_idem_keys`, TTL 5min) — retry com o mesmo `requestId` retorna `jaProcessado:true` sem repetir a baixa (testes 15, 19, 20).
- `producaoStartId` determinístico por OS (`producao_inicio:<osId>`) → idempotência de negócio de longo prazo, independente de `requestId` — uma segunda tentativa real (`requestId` novo) na mesma OS é barrada por `already-exists` (teste 18).
- Concorrência real (duas chamadas simultâneas via `Promise.allSettled`) testada e confirmada sem duplicação (testes 16, 17, 24).

## 11. Rules candidatas

**Nenhuma alteração de Rules foi feita nesta rodada** — decisão explícita, documentada em `scripts/AUDITORIA_FASE2_FRONTEIRA_ESTOQUE_2026-08-05.md`. Migrar apenas a function de produção sem também migrar as ~7 outras funções que escrevem `stock` (criar/editar/excluir/restaurar item, limpar histórico, entrada manual) quebraria essas funções se `stock` virasse `allow write: if false`. Fechar o bypass teórico por completo é um trabalho de escopo comparável à migração Compras v1→v2 — registrado como pendência real para rodada futura, não escondido como resolvido. **Ver "Achado residual" abaixo.**

## 12. Integração do frontend

`kbConfirmarProd()` (`index.html`) reescrita para chamar `firebase.functions().httpsCallable('producaoIniciarOuEditar')` em vez da transação client-side (removida — `_iniciarTransacaoProducao` e `_buildLogEntry` não existem mais). Sem fallback para escrita direta se a Function falhar. Botão desabilitado durante a chamada. Erros específicos por código (`permission-denied`, `invalid-argument`, `already-exists`, `failed-precondition`, `not-found`, `unavailable`). O diálogo de exceção de Master virou um `prompt()` de justificativa (mínimo 10 caracteres) — antes era um `confirm()` sem nenhum texto coletado. Confirmado ao vivo contra o Emulator real (browser → Function → Firestore) via smoke test.

## 13. Testes de segurança

`scripts/test_producao_autorizacao_server.js` — **29/29 passando**, chamando a Cloud Function real via `.run(data, context)` contra o Firestore Emulator real (não reimplementa lógica). Cobre 27 dos 30 cenários pedidos diretamente; os 3 restantes (token revogado a meio de operação, chamada REST manual, alteração de DOM) são documentados como não aplicáveis a este nível de teste (infraestrutura do Firebase Auth, ou já cobertos pelos testes de payload forjado 3/4) — não escondidos, ver comentários nos testes 13/14, 26, 27-28, 29 do próprio arquivo.

`scripts/test_producao_idempotencia.js` (rodada anterior) foi **removido** — testava exclusivamente a transação client-side que não existe mais; mantê-lo criaria falso sinal de regressão. A proteção original que ele validava (duas abas iniciando produção da mesma OS) está re-verificada nos testes 16/17/24 da nova suíte, contra a implementação real e atual.

## 14. Compras V2 E2E

**NÃO EXECUTADO nesta rodada** (tempo). Permanece como estava documentado na rodada anterior: arquitetura inspecionada (Cloud Functions com `requestId` idempotente, Rules `allow write: if false`), mas sem os 10 cenários E2E ao vivo pedidos (duplo clique, duas abas, mesmo/diferente `requestId`, Produção tentando aprovar, etc.). **Pendência real, registrada — não presumida segura.**

## 15. Lock/Token E2E

**Parcialmente coberto**, sem mudança desde a rodada anterior: a renovação automática de token (1 retry, nunca mais) está coberta por `test_cloudsave_concorrencia.js` (testes 7-8) para `_cloudSave()`. Não testado nesta nem na rodada anterior: duas abas renovando simultaneamente, revogação durante operação em andamento, comportamento específico da nova `producaoIniciarOuEditar` sob token expirado (Cloud Functions callable tem seu próprio ciclo de reautenticação via SDK, não herda automaticamente o retry de `_cloudSave`). **Pendência real.**

## 16. Limpeza

Confirmado por leitura direta e independente do Firestore, com uma aba real (`tab-16`) mantida aberta durante toda a limpeza e recarregada ao final (navegação + resync de listener) sem que nada reaparecesse:

| Coleção | Esperado | Confirmado após limpeza |
|---|---|---|
| `erp_vr/orcamentos` | 9 | 9 ✅ |
| `erp_vr/kb_os` | 4 | 4 ✅ |
| `erp_vr/fin_cr` | 5 | 5 ✅ |
| `erp_vr/fin_cp` | 0 | 0 ✅ |
| `erp_vr/fin_tx` | 1 | 1 ✅ |
| `erp_vr/compras` | 2 | 2 ✅ |
| `erp_vr/stock` | 7 | 7 ✅ (ver nota) |
| `erp_vr/clientes` | 18 | 18 ✅ |
| `erp_vr/erp_stock_log` | 9 | 9 ✅ (ver nota) |
| `producao_idem_keys` (nova, só teste) | 0 | 0 ✅ |
| `erp_vr_audit_log_producao` (nova) | 0 | 0 ✅ |

**Nota de transparência — segundo incidente de setup, autocorrigido:** durante um smoke test do novo fluxo via browser (chamando `stockSaveData()` a partir de uma aba recém-logada, cujo `STOCK` em memória ainda não tinha sido totalmente populado pelo listener), `stock` foi **novamente** sobrescrito parcialmente — mesma classe de erro da rodada anterior. Detectado na verificação final desta limpeza (contagem de `stock` batendo 0), restaurado imediatamente a partir do mesmo snapshot documentado. `erp_stock_log` também acumulou 82 entradas de teste (73 ligadas a fixtures `e2e_srv_*`/`e2e_smoke_*`) durante a suíte de 29 testes; filtradas de volta às 9 entradas de baseline. **Lição registrada para rodadas futuras:** nunca fazer round-trip de um documento agregado inteiro a partir do estado em memória de uma aba recém-carregada sem antes confirmar que o listener já sincronizou — preferir sempre leitura+merge parcial via Admin SDK para esse tipo de manipulação de fixture.

Nenhum contador foi reduzido abaixo do baseline nem nenhum ID reutilizado — os documentos de teste foram removidos por filtro de conteúdo (prefixo/padrão de fixture), não por reset de índice.

## 17. Suíte integral (separada por categoria)

| Categoria | Arquivos | Testes | Resultado |
|---|---|---|---|
| Unitários/integração de lógica (mock de Firestore) | 15 arquivos `scripts/test_*.js` | ~382 | 100% verde |
| **Servidor real (Cloud Function + Firestore Emulator real)** | `test_producao_autorizacao_server.js` | 29 | 100% verde |
| Rules (dedicado, `@firebase/rules-unit-testing`) | — | **0** | **não existe no repositório — nem antes, nem depois desta rodada** |
| Functions (E2E via Functions Emulator + HTTP) | — | **0 automatizado** — validado manualmente via smoke test no browser real | ver item 12 |
| E2E (browser real contra Emulator) | ad-hoc via `javascript_tool`, não é um script repetível | ~15 cenários ao vivo (rodada anterior) + 1 smoke desta rodada | verde, não repetível automaticamente |
| Visuais (screenshot/diff) | — | 0 nesta rodada | não aplicável ao escopo |

Total de testes automatizados repetíveis: **411 (rodada anterior, ajustado: -31 removidos +29 novos) = 411**. Não reporto isso como "toda a suíte" sem qualificar — Rules e Functions-via-emulador-HTTP continuam sem cobertura automatizada dedicada neste repositório, uma lacuna pré-existente ao projeto, não introduzida nem fechada por esta correção.

## 18. Commits e HEAD

13 commits desde `d550066`, HEAD `55dd661`, todos pushados e idênticos a `origin/release/fase-f-usuarios-2026-08-05`. Os 5 desta rodada (FASE 0-13): `c3f7301` (gitignore), `fb3ff5e` (Function), `cb4bc61` (frontend), `d23f46f` (testes), `55dd661` (docs FASE 2).

## 19. Confirmação de zero alteração em produção

Todas as ações desta rodada — leitura/escrita de Firestore, criação de contas Auth, chamadas de Cloud Function — ocorreram exclusivamente contra `demo-erp-homolog` (Emulator Suite local). Nenhum comando `firebase deploy` foi executado. `erp-vrmarcas` (produção) não foi tocado.

## 20. Plano coordenado de deploy (NÃO EXECUTADO — só o plano)

1. **Functions**: `cd functions && npm run build && firebase deploy --only functions:producaoIniciarOuEditar --project erp-vrmarcas`. Pré-requisito: revisão humana do código de `producao.ts` (identidade, transação, idempotência) antes do deploy — esta correção nunca rodou contra o projeto de produção real.
2. **Rules**: nenhuma mudança de Rules está pronta para deploy nesta rodada (ver item 11) — não incluir no mesmo lote.
3. **Hosting**: só depois de Functions estar no ar (o `index.html` atualizado chama `producaoIniciarOuEditar` — publicá-lo antes da Function existir em produção quebraria o início de produção para todo mundo). `firebase deploy --only hosting --project erp-vrmarcas`.
4. **Smoke pós-deploy**: login real de Master + Produção, iniciar produção com saldo suficiente (deve funcionar), tentar com saldo insuficiente sem ser Master (deve pedir solicitação de compra, não travar), Master autorizar com justificativa curta (deve ser rejeitado pela Function, não pela UI) e com justificativa válida (deve funcionar e criar auditoria em `erp_vr_audit_log_producao` real).
5. **Rollback**: reverter Hosting para a release anterior (`firebase hosting:rollback` ou republicar o build anterior) reverte o frontend para a versão sem a Function — mas como a Function em si é aditiva (não remove nem quebra nada que já funcionava, só adiciona uma nova fronteira), não precisa ser removida em caso de rollback do Hosting; pode ficar publicada sem uso.

## Achado residual (não resolvido nesta rodada, não escondido)

O bypass teórico por chamada direta ao Firestore (fora da UI/Function) **continua possível** para as demais funções de estoque (criar/editar/excluir/restaurar item, entrada manual) — ver item 11 e `scripts/AUDITORIA_FASE2_FRONTEIRA_ESTOQUE_2026-08-05.md`. A vulnerabilidade especificamente demonstrada e corrigida (autorização Master-vs-Produção no início/edição de produção) está fechada tanto na UI legítima quanto na Function. Fechar o bypass teórico por completo é trabalho de escopo maior, registrado para rodada futura.

## Parecer

# NÃO PRONTO PARA DEPLOY

Apesar da correção server-side estar implementada, testada (29/29) e integrada ao frontend, os seguintes pontos impedem recomendar o deploy coordenado agora:

1. **Nenhum deploy de Functions/Rules/Hosting foi autorizado para execução nesta rodada** (instrução explícita: "não fazer deploy").
2. **Achado residual não fechado**: bypass teórico ainda possível nas demais funções de estoque — se o objetivo é fechar TODO o vetor "chamada direta ao Firestore", esta rodada resolve só a fatia demonstrada, não a superfície inteira.
3. **Compras v2 E2E e lock/token E2E permanecem pendentes**, sem validação ao vivo completa.
4. **Cobertura de Rules e Functions-via-HTTP-Emulator continua em zero** neste repositório — risco pré-existente, mas relevante para qualquer decisão de "pronto para produção".
5. **Dois incidentes de setup de fixture (sobrescrita de `stock`) ocorreram e foram autocorrigidos nesta auditoria** — não afetam a correção em si, mas reforçam que o padrão de escrita de documentos agregados a partir de estado de memória de browser é frágil e caberia revisão de processo antes de operações reais de produção.

A correção em si (Function + integração de frontend) está pronta para revisão humana e, após essa revisão, para deploy — mas não deve ser publicada sem essa revisão explícita, sem fechar (ou aceitar conscientemente) o achado residual, e sem autorização direta do usuário para o deploy coordenado descrito no item 20.
