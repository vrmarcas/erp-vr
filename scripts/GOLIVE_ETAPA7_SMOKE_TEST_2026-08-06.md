# GO-LIVE Etapa 7 — Smoke Test em Produção

## Limitação explícita e honesta

Não foi possível executar o smoke test autenticado (login real como
Master/Comercial/Produção) porque:
- Não havia nenhuma sessão real já autenticada disponível — a única
  sessão local encontrada (`Gabriel — conta principal`) estava
  **bloqueada por inatividade**, e a própria aplicação já havia
  encerrado o token Firebase real no momento do bloqueio (confirmado:
  `firebase.auth().currentUser === null`) — só resta a tela pedindo a
  senha para desbloquear.
- **Nunca digitei nem usei a senha** — mesmo o campo já tendo um valor
  preenchido (autofill do navegador), clicar em "Desbloquear" seria
  autenticar com uma senha, proibido de forma absoluta independente de
  qualquer autorização desta rodada.
- Criar uma conta nova de teste também é proibido de forma absoluta.
- Usar um UID real de outro funcionário (via `createCustomToken`, que
  tecnicamente não expõe nem altera a senha) foi **deliberadamente
  evitado** — mesmo sendo tecnicamente possível via Admin SDK, seria
  efetivamente personificar uma pessoa real nomeada sem o
  conhecimento/participação dela, o que não é a mesma coisa que "usar
  uma sessão já autenticada".

**Recomendação:** o próprio Gabriel (ou outro Master real) deve fazer
o primeiro login real pós-go-live para validar visualmente os fluxos
autenticados — o guia rápido (Etapa 11) cobre exatamente esse
primeiro-uso.

## O que FOI verificado de verdade nesta etapa

### Infraestrutura (sem login)
- `https://erp-vrmarcas.web.app` carrega, renderiza a tela de
  login/bloqueio corretamente (screenshot confirmado).
- Todos os assets críticos carregam com o conteúdo correto: 4 scripts
  Firebase CDN, `xlsx.full.min.js`, `assets/brands/brand-config.js`
  (real JS, não HTML), logos `assets/brand/*.png`.

### Achado real corrigido nesta etapa
`assets/brands/brand-config.js` estava sendo servido como o
fallback SPA (`index.html`, HTTP 200 mas `content-type: text/html`)
em vez do arquivo JS real — meu padrão de negação `!assets/brands/**/*.js`
no `firebase.json` (Etapa 2) **não funcionou como esperado no Hosting
real** (só validei com simulação local de minimatch, não contra o
comportamento real do Firebase Hosting). Descoberto ao investigar um
`SyntaxError: Unexpected token '<'` no console. Corrigido substituindo
a negação por exclusões específicas dos 2 únicos `.js` soltos na raiz
do repositório (`git_push_valeria.js`, `git_commit_push.js`) em vez de
uma regra ampla `**/*.js` com negação. Redeploy de Hosting confirmado:
`brand-config.js` agora retorna `content-type: text/javascript` com o
conteúdo real.

### Erro de console remanescente — investigado, não bloqueante
Mesmo após a correção acima, um `SyntaxError: Unexpected token '<'`
continua aparecendo no console ao carregar a página deslogado.
Investigado a fundo:
- Não está associado a nenhum recurso `.js` malformado (todos os 6
  scripts carregados retornam conteúdo JS correto, confirmado via
  `fetch()` no próprio navegador).
- A função `_cloudLoad` (candidata mais provável, por disparar
  leituras Firestore mesmo deslogado — confirmado pelos avisos
  `[Stock] permission-denied` corretos e esperados no mesmo log) está
  **byte-a-byte idêntica** entre o bundle antigo (pré-go-live) e o
  novo — `diff` confirma zero diferença no trecho da função.
- **Conclusão: pré-existente, não introduzido por esta rodada.** Não
  bloqueia carregamento nem renderização (tela de login/bloqueio
  aparece perfeitamente). Não corresponde a nenhum critério de
  rollback (login funciona, sem perda de dado, sem duplicação, sem
  indisponibilidade). Registrado como pendência de backlog pós-go-live
  para investigação com uma sessão autenticada real.

### Rules — negação correta sem autenticação (REST direto)
| Chamada | Resultado |
|---|---|
| `GET vitre_produtos/AA001` sem token | **403** ✅ |
| `PATCH vitre_produtos/HACKTEST` sem token | **403** ✅ |

### Functions — negação correta sem autenticação
| Function | Resultado |
|---|---|
| `vitreImportarProdutos` sem Authorization | **401** "Autenticação obrigatória." ✅ |
| `estoqueRegistrarEntrada` sem Authorization | **401** "Autenticação obrigatória." ✅ |
| `valeriaVitreBuscarCatalogo` sem Bearer | **401** "Authorization header ausente" ✅ |

### Catálogo Vitre — conteúdo real confirmado (Etapa 6)
110 produtos reais em `vitre_produtos`, zero conflitos de SKU — já
verificado e documentado na Etapa 6.

## Itens do checklist original NÃO verificados nesta rodada (por perfil/UI)

Login Master/Comercial/Produção pela UI real, CRUD do catálogo por
perfil, criação de orçamento VR/Vitre pela UI, PDF/WhatsApp gerados
pela UI real, conversão de orçamento em OS pela UI, Compras v2/estoque
pela UI — todos **já testados exaustivamente contra o mesmo código
exato via Emulator** ao longo desta sessão (Partes 3-11 da
homologação, com login real de cada perfil, ~217 cenários automatizados
+ dezenas de cliques reais documentados com screenshot). A lacuna aqui
é especificamente "mesmo teste, mas em produção, com uma sessão de
staff real" — que só pode ser fechada por um humano com credencial
real, não por mim.
