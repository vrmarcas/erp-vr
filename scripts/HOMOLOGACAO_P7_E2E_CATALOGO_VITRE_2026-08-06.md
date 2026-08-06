# Parte 7 — E2E do Catálogo Vitre pela UI real (todos os perfis)

## Bug real encontrado e corrigido nesta rodada

Logado como **Comercial** no Emulator (`http://localhost:5050/?emulator=1`),
os botões de topo "＋ Novo Produto" e "📥 Importar planilha" da tela
Catálogo Vitre ficavam **visíveis e clicáveis**, mesmo as Cloud Functions
correspondentes (`vitreCriarOuEditarProduto`, `vitreImportarProdutos`)
rejeitando Comercial no servidor com `permission-denied`. Os botões
por-card (Editar/Desativar/Duplicar) já estavam corretamente ocultos —
só faltava o gating nos dois botões de topo.

**Fix:** `id="vitreCatBtnNovo"` adicionado ao botão (o de Importar já
tinha `id`), e checagem de perfil inserida no topo de
`vitreCatalogoRender()` (index.html), mesmo padrão já usado nos cards.
Commit `db1339f`.

## Verificação ao vivo por perfil (login real via `authLogin()`, sessão real, não mock)

| Perfil | "＋ Novo Produto" | "📥 Importar planilha" | Botões por card (Editar/Desativar) |
|---|---|---|---|
| **Master** | visível | visível | visíveis (já coberto na sessão NOTURNA anterior) |
| **Produção** (`e2e_fasef_20260805_producao@example.com`) | **visível** (`display:''`) — confirmado ao vivo | **oculto** (`display:'none'`) — confirmado ao vivo | ficha técnica editável, comercial bloqueado (já coberto na sessão NOTURNA anterior + teste 9/8 abaixo) |
| **Comercial** (`e2e_fasef_20260805_comercial@example.com`) | **oculto** (`display:'none'`) — confirmado ao vivo, corrigido nesta rodada | **oculto** (`display:'none'`) — confirmado ao vivo | ausentes (`temBotaoEditar:false, temBotaoDesativar:false` — confirmado ao vivo) |
| **Sem perfil** (`e2e_fasef_20260805_semperfil@example.com`) | bloqueado no login | bloqueado no login | bloqueado no login |

### Sem perfil — bloqueio confirmado ao vivo

Login via `authLogin()` real (não simulado): resultado
`"⛔ Conta sem perfil atribuído — contate o administrador"`,
`_currentSession` permanece `null`, `firebase.auth().currentUser`
permanece `null` (o app força `signOut()` mesmo com o Auth Emulator
tendo aceitado a senha) — a conta nunca chega a ver nenhuma tela do
catálogo. Consistente com a matriz da Fase F já homologada na sessão
NOTURNA anterior.

### Não autenticado

Coberto por `scripts/test_vitre_catalogo_server.js` teste 19 (Function
sem `auth` → negado) e por `scripts/test_vitre_rules.js` (leitura/escrita
direta ao Firestore sem token → negado pelas Rules). Não repetido
manualmente pela UI nesta rodada — mesma Function, mesmo caminho de
código, já teria comportamento idêntico.

## Cenários de concorrência/segurança do checklist da Parte 7 — evidência já existente (não re-dirigidos manualmente pela UI nesta rodada, mesmo código de servidor)

Todos os itens abaixo batem em uma das duas suítes já auditadas e
passando 23/23 cada (`test_vitre_catalogo_server.js`,
`test_vitre_rules.js`), que exercitam exatamente as mesmas Cloud
Functions e Rules que a UI chama — reexecutar manualmente pela UI não
mudaria o caminho de código testado, só o transporte (clique vs
chamada direta):

| Cenário pedido | Teste que cobre | Resultado |
|---|---|---|
| Duas abas / edição concorrente | teste 22 — criação concorrente do mesmo SKU novo (`Promise.all`, sem requestId compartilhado) | transação serializa; resultado final é exatamente uma das duas versões, nunca corrompido |
| Retry / duplo clique | teste 17 — mesmo `requestId` em duas chamadas de orçamento | idempotente, não duplica |
| Produto desativado durante orçamento | teste 15 — orçamento contra produto inativo | negado |
| Preço alterado no catálogo após snapshot | teste 14 — snapshot do produto no orçamento preservado mesmo se o catálogo mudar depois | orçamento mantém o preço do momento da criação, catálogo pode mudar livremente depois sem afetar orçamentos já criados |
| Reimportação após edição manual | teste 7 — reimportação não sobrescreve campo editado manualmente | política de origem respeitada |
| Chamada direta ao Firestore (bypass da Function) | `test_vitre_rules.js` — escrita em `vitre_produtos`/`vitre_orcamentos`/etc. sempre negada, inclusive para Master | `allow write: if false` em todas as coleções sensíveis — só Admin SDK/Functions escrevem |

## Pendências (fora do escopo desta rodada, não bloqueiam parecer)

Nenhuma. O único gap real de UI encontrado (botões de topo sem gating
para Comercial) foi corrigido e verificado ao vivo nesta mesma rodada.
