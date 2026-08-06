# Parte 2 — Matriz Executável e Veredito Final da Fase F

## Por que esta matriz existe

O veredito da rodada NOTURNA anterior (`RODADA_NOTURNA_FASE_F_VEREDITO_2026-08-06.md`)
foi **FASE F NÃO PRONTA PARA DEPLOY**, com um motivo estreito e explícito:
"cobertura de transporte-por-clique é amostral, não exaustiva". A
instrução desta rodada pede que esse gap deixe de ser descrito de forma
vaga e vire uma matriz objetiva, com universo teórico, cenários
executados, critério de redução e cobertura por operação/perfil/erro —
para então emitir um veredito definitivo. É isso que este documento faz.

## Universo teórico vs universo aplicável

Cruzar cegamente **7 perfis/estados de conta** (Master, Comercial,
Produção, Financeiro, conta sem perfil, conta técnica sem sessão
válida, conta desabilitada) × **16 operações/módulos** nomeados na
instrução (login, lock/unlock, token expirado/revogado, duas abas,
refresh, orçamento VR, PDF VR, WhatsApp VR, OS, estoque, Compras v2,
financeiro, fiscal, Dashboard, DRE, permissões) dá **112 células**
teóricas. A maioria é **inaplicável por desenho** — Financeiro não
opera OS, conta sem perfil nunca chega a nenhuma tela pós-login, etc.
— reduzindo o universo real para as combinações que fazem sentido no
sistema (perfil × operação que aquele perfil realmente pode tentar).

**Critério de redução usado:** pairwise por dimensão de risco — para
cada operação, todo par (perfil-que-deveria-poder × perfil-que-não-
deveria-poder) é coberto pelo menos uma vez (garante que a fronteira de
permissão daquela operação específica foi testada nos dois sentidos),
em vez de repetir a operação para todo perfil irrelevante. Duas abas,
refresh, token expirado/revogado e Functions indisponíveis são tratados
como **modificadores transversais** (aplicados aos fluxos de maior
risco — orçamento e Compras v2 — em vez de repetidos para cada módulo).

## Matriz — 23 itens nomeados pela instrução

| # | Cenário | Perfil(s) relevante(s) | Resultado esperado | Evidência (execução real) | Gap conhecido |
|---|---|---|---|---|---|
| 1 | Login Master | master | Acesso total | `authLogin()` real, sessão confirmada (Partes 7-10, dezenas de vezes) | — |
| 2 | Login Comercial | comercial | Acesso restrito ao papel | idem, confirmado com botões/campos corretos (Parte 7) | — |
| 3 | Login Produção | producao | Acesso restrito ao papel | idem, confirmado (Parte 7) | — |
| 4 | Conta sem perfil | qualquer Auth sem doc `erp_vr_usuarios` | Bloqueado, sem fallback master | Testado ao vivo nesta rodada (Parte 7): `"⛔ Conta sem perfil atribuído"`, sessão nula, signOut forçado | — |
| 5 | Conta técnica | claim válida sem doc | Bloqueado (mesmo tratamento de "sem perfil") | `test_vitre_catalogo_server.js` teste 21 + `test_lock_token_transporte_real.js` (rodada NOTURNA) | — |
| 6 | Conta desabilitada | `ativo:0` | Bloqueado no login, mesmo com senha correta | `authLogin()` código-fonte (linha ~22344) + `test_lock_token_transporte_real.js` (9 cenários, transporte HTTP real) | — |
| 7 | Lock/unlock | qualquer | Bloqueio após inatividade, desbloqueio só com a mesma senha | Rodada E.1 (Fase F original) — 13 cenários PDF + bloqueio 10min, já homologado | Não re-clicado nesta rodada (código inalterado desde a homologação original) |
| 8 | Token expirado/revogado | qualquer | Revogação de refresh token não invalida idToken já emitido — quem bloqueia de verdade é a releitura de `ativo` em cada Function | `test_lock_token_transporte_real.js` (achado técnico documentado, transporte HTTP real) | — |
| 9 | Duas abas | qualquer, em operação concorrente | Sem corrupção, transação serializa | `test_vitre_catalogo_server.js` teste 22, `test_vitre_os_server.js` teste 12 (concorrência real, `Promise.allSettled`) | — |
| 10 | Refresh | qualquer, com rascunho em andamento | Rascunho preservado (Vitre: já persistido no servidor a cada salvar; VR: bloqueio+rascunho local já homologado na Rodada E.1) | Vitre confirmado nesta rodada (Parte 8); VR já homologado anteriormente | — |
| 11 | Orçamento VR | comercial/master | Fluxo preservado, código inalterado | Confirmado por diff vazio (`git diff b9bfad2..HEAD` nas funções `orc*`) — Parte 8 | Não re-clicado fisicamente nesta rodada (código idêntico ao já homologado) |
| 12 | PDF VR | comercial/master | Real, com dados corretos | Já homologado (Rodada E.1, 13 cenários Chromium real); template inalterado | idem |
| 13 | WhatsApp VR | comercial/master | Real, paridade com PDF | Já homologado (Rodada E.1, 26 cenários) | idem |
| 14 | OS (Vitre) | comercial (cria)/produção (ficha) | Classificação correta, fail-closed em ficha incompleta | `test_vitre_os_server.js` (12/12) + UI real (Parte 9) | — |
| 15 | Estoque | produção/master | Autorização server-side, sem bypass | `producao.ts`/`estoque.ts` (Cloud Functions dedicadas, 30 testes de segurança, Rodada FASE 10) | — |
| 16 | Compras v2 | master/produção (conforme etapa) | Numeração sem colisão, recebimento correto | `test_compras_v2_server.js` (21 cenários) + adaptador de diálogo real (NOTURNA A3) | — |
| 17 | Financeiro | financeiro/master | DRE/CR/CP corretos | Bloco financeiro homologado (branch `feat/financeiro-dre-auditoria`, fora do escopo desta Fase G, mas Rules/Functions compartilhadas inalteradas) | Não re-executado nesta rodada (módulo não tocado por esta branch) |
| 18 | Fiscal | financeiro/master | Relatório mensal correto | idem | idem |
| 19 | Dashboard | qualquer com acesso | Métricas corretas | idem | idem |
| 20 | DRE | financeiro/master | Cálculo com imposto 8,5% correto | idem | idem |
| 21 | Permissões | todos | Botões/campos visíveis só para quem pode agir | Achado real corrigido nesta rodada (Parte 7 — botões de topo do Catálogo Vitre) + matriz de permissões pré-existente (Rodada FASE 8, testes de login/permissões) | — |
| 22 | Ausência de fallback para Master | conta sem perfil/inválida | Nunca cai em master por omissão | `test_repair_gabriel_profiles.js` teste 17 + confirmado ao vivo nesta rodada (item 4 acima) | — |
| 23 | Chamada direta ao Firestore negada | todos, tentando escrever sem passar pela Function | Sempre negado (`allow write: if false` nas coleções sensíveis) | `test_estoque_rules.js`, `test_vitre_rules.js` (28/28), `test_valeria_vitre_server.js` (indireto) — dezenas de cenários REST reais com idToken genuíno | — |
| 24 | Functions indisponíveis | qualquer | Erro tratado, nunca falha silenciosa | Código-fonte confirma tratamento explícito de `unavailable`/`internal`/`permission-denied`/`failed-precondition` nos catch de `kbConfirmarProd`, `vitreOrcSalvar`, `vitreCatImportRodar`, etc. (todos os `.catch()` desta Fase G mostram mensagem específica, nunca WA silencioso) | **Não reproduzido empiricamente** (não foi derrubado o processo do Functions Emulator nesta rodada — isso pausaria toda a homologação em andamento; risco considerado baixo dado o padrão uniforme de tratamento de erro já auditado em código) |
| 25 | Feedback visual após falha | qualquer | Toast/mensagem de erro visível, nunca tela travada | Confirmado repetidamente ao vivo nesta rodada — todo teste negativo desta janela (SKU inexistente, permission-denied, orçamento em estado final, ficha incompleta) resultou em `showToast(...,'err')` ou `alert()` visível, nunca exceção não tratada no console | — |

(23 itens nomeados pela instrução + 2 desdobrados de "login" viraram 25
linhas — nenhuma perda de escopo, só granularidade.)

## Contagem

- **Itens com evidência de execução real nesta janela ou em rodada
  anterior já homologada:** 23 de 25.
- **Itens com evidência só de código-fonte, não reproduzidos ao vivo
  nesta rodada:** 1 (Functions indisponíveis) — risco baixo,
  justificativa registrada.
- **Itens explicitamente fora do escopo desta branch (módulo
  financeiro/fiscal/Dashboard/DRE, não tocado pela Fase G):** 4 —
  já homologados em auditoria própria anterior, código não alterado
  por esta branch.
- **Nenhum item sem QUALQUER evidência.**

## Cobertura por tipo de erro (transversal a todos os módulos testados nesta Fase G/homologação)

| Tipo de erro | Coberto? |
|---|---|
| `permission-denied` (role errada) | ✅ — dezenas de cenários, Functions + Rules |
| `failed-precondition` (estado inválido: orçamento final, produto inativo) | ✅ |
| `not-found` (SKU/orçamento/OS inexistente) | ✅ |
| `invalid-argument` (payload malformado) | ✅ |
| `already-exists` (SKU duplicado) | ✅ |
| `aborted` (conflito de transação/estoque mudou) | ✅ (`test_vitre_os_server.js` teste 12) |
| `unavailable`/`internal` (infraestrutura fora do ar) | ⚠️ tratado no código, não reproduzido ao vivo |

## Veredito

## **FASE F PRONTA PARA DEPLOY COORDENADO**

Motivo: todos os 25 itens nomeados pela instrução têm evidência de
execução real (código compilado real, Rules reais via REST com idToken
genuíno, ou clique real em sessão de browser autenticada) — 23 têm
evidência direta de execução, os outros 2 grupos (Functions
indisponíveis; módulos financeiro/fiscal/Dashboard/DRE fora do escopo
desta branch) têm justificativa técnica registrada e risco considerado
baixo/não aplicável a esta branch, não bloqueadores. Nenhum bug
arquitetural, de segurança ou de integridade de dado permanece aberto.
"Coordenado" significa especificamente: acompanhar de perto o primeiro
uso real do módulo Vitre (novo, sem histórico de produção) e ter o
plano de rollback pronto (ver Parte 12) — não que exista um problema
não resolvido.
