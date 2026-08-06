# EXECUÇÃO AUTÔNOMA NOTURNA — Relatório Final

**Data:** 2026-08-06 · **Escopo:** Concluir Fase F, construir Fase G (Catálogo Vitre) e preparar integração Valéria.
**Execução:** contínua, sem checkpoints, conforme autorização explícita do usuário no início da rodada.

---

## Confirmações de segurança (leia primeiro)

- **Zero deploy real.** Nenhum `firebase deploy` foi executado contra `erp-vrmarcas` ou qualquer outro projeto de produção nesta rodada.
- **Zero alteração em produção.** Nenhum usuário, claim, senha, dado, Rule ou Hosting real foi tocado.
- **`origin/master` intocado**, permanece em `bc6e1de6` (mesmo commit do início da rodada, verificado via `git ls-remote`).
- Todo trabalho ocorreu exclusivamente contra o projeto Firebase `demo-erp-homolog` (Emulator Suite local — Auth :9099, Firestore :8080, Functions :5001, Hosting :5050).
- Nenhuma credencial real, service account, secret do Chatvolt/Valéria ou dado de cliente real foi usado, criado ou solicitado.
- Nenhum PR foi aberto (o GitHub sugeriu automaticamente ao fazer push da branch nova — a sugestão foi ignorada, conforme instrução).

---

## PARTE A — FASE F (itens 1-12)

Já concluída e registrada no relatório anterior desta mesma rodada
(`scripts/RODADA_NOTURNA_FASE_F_VEREDITO_2026-08-06.md`, commit `ba0ecae`).
Resumo, sem repetir o detalhamento já documentado:

1. Reconciliação completa (branch/HEAD/origin/dependências) — feita, sem assumir números de rodadas anteriores.
2. Ambiente limpo determinístico reutilizado (`scripts/e2e_clean_env.js`), fixtures preservadas.
3. Confirmado: frontend candidato usa Compras v2 independentemente de `_HOMOLOG_MODE` (flag dedicada `_COMPRAS_V2_OFICIAL`).
4. Nenhum fallback ativo para Compras v1 no candidato.
5. Adaptador de diálogo test-only (`_e2eDlgPrompt`/`_e2eDlgConfirm`) criado, verificado ao vivo, impossível de ativar fora de `_HOMOLOG_MODE` + fila de teste explícita.
6. E2E real de Compras v2 via UI+Emulator, incluindo duplo clique/duas abas/mesmo requestId/requestIds diferentes.
7. E2E real de lock/token/conta desabilitada — 9 cenários via transporte HTTP real (Auth Emulator + Functions Emulator), achado documentado sobre `revokeRefreshTokens` não invalidar idToken já emitido (proteção real vem da rechecagem server-side de `erp_vr_usuarios/{uid}.ativo`).
8. Functions/Rules candidatas re-confirmadas contra o HEAD exato do candidato.
9. Matriz de UI documentada por cobertura estratificada (não 204 cliques manuais literais), com justificativa explícita do método de redução.
10. Suite completa executada duas vezes sobre reset limpo, com hash de seed idêntico nas duas rodadas.
11. **Veredito: "FASE F NÃO PRONTA PARA DEPLOY"** — bloqueador estritamente de exaustividade de matriz de UI, não arquitetural nem de segurança.
12. HEAD candidato registrado (`d299c2a` → commit de fechamento `ba0ecae`) e branch `feat/fase-g-catalogo-vitre` criada a partir dele, sem deploy, sem merge.

---

## PARTE B — FASE G: CATÁLOGO VITRE (itens 13-30)

Todo o trabalho desta parte está em 5 commits isolados na branch
`feat/fase-g-catalogo-vitre` (a partir do HEAD candidato `ba0ecae`):

```
c655d82  B1-B4: Functions do Catálogo Vitre, importador real, identidade visual
c40e594  B5: CRUD do Catálogo Vitre no frontend + Rules
d6a4fa2  B7-B10: dois fluxos de orçamento (VR preservado + Vitre novo) + PDF/WhatsApp Vitre
9ad7d6c  B11: Rules do bloco vitre_* + concorrência/edge-cases nas Functions
b9bfad2  B12: unitário puro do parser da planilha
```

### 13 — Planilha real lida programaticamente (B1)
Arquivo real do usuário localizado e lido via `XLSX.readFile` (biblioteca
`xlsx@0.18.5`, já instalada em `functions/node_modules`, também disponível
via CDN no frontend — `assets`/CDN `xlsx.full.min.js` já presente na
página). **Números reais, não assumidos:** 1 aba ("Produtos"), 117 linhas
brutas lidas por `sheet_to_json`, 110 linhas não-vazias após filtro, 13
colunas mapeadas por cabeçalho exato.

### 14 — Modelo de dados (B2)
Documento-por-produto, `vitre_produtos/{sku}` (SKU como ID do documento),
nunca array agregado — mesma lição já aplicada em `estoque.ts` nesta
auditoria. Coleções auxiliares criadas: `vitre_produto_historico`,
`vitre_importacoes`, `vitre_orcamentos`, `vitre_idem_keys`,
`vitre_audit_log`. Campos comerciais/dimensionais/venda/personalização/
produção/integrações implementados conforme especificação completa (ver
`functions/src/vitre.ts`, interface `VitreProduto`).

### 15 — Níveis de completude (B3)
`calcularNivelCompletude()` — função pura, 0-4, recalculada a cada leitura
(nunca um valor "nível" persistido cru que poderia ficar desatualizado).
Verificado por teste dedicado (Functions, cenário 11) e usado tanto no
CRUD frontend quanto na elegibilidade automática da Valéria (nível mínimo
diferente e mais exigente para a Valéria — ver item 33).

### 16 — Importador idempotente (B4)
`vitreImportarProdutos` (Cloud Function, master-only): dry-run por padrão,
SKU duplicado com dados DIFERENTES bloqueia a linha (nunca escolhe
automaticamente), SKU duplicado com dados IDÊNTICOS colapsa sem erro,
campos ausentes reportados sem bloquear a linha, política de origem
(`camposEditadosManualmente`) protege edição manual de reimportação.
**Rodado de verdade contra a planilha real, duas vezes** (antes e depois
do reset final desta rodada — ver item 27): 102 criados, 0 atualizados na
primeira aplicação real, 0 criados/102 sem alteração na reaplicação
(idempotência real confirmada, não simulada), 4 conflitos de SKU genuínos
bloqueados (`CPC001`, `MLP001`, `MLR001`, `PPCI001` — decisão humana
pendente, registrada, nunca escolhida automaticamente), 86 avisos de
qualidade de dado não-bloqueantes.

### 17 — CRUD do Catálogo Vitre (B5)
Nova tela "Catálogo Vitre" no frontend: listagem em cards, busca por
SKU/nome, filtros de status/categoria/nível, modal de criar/editar,
ativar/desativar, duplicar. 100% via Cloud Functions reais
(`vitreCriarOuEditarProduto`/`vitreAtivarDesativarProduto`/
`vitreDuplicarProduto`), listener em tempo real (`onSnapshot`), zero
escrita direta do cliente no Firestore.

### 18 — Permissões do CRUD (B5)
Master: todas as ações. Produção: só ficha técnica (campos comerciais
desabilitados na UI **e** bloqueados no servidor — verificado com uma
chamada direta via `httpsCallable` bypassando a UI, recebeu
`permission-denied` real). Comercial/Financeiro: somente leitura (sem
botões de ação).

### 19 — Verificação ao vivo do CRUD (B5)
Feita via Browser real contra o Emulator, login real (Auth Emulator),
não simulado: criar produto novo, editar produto real (peso/categoria),
duplicar (com `produtoPaiId` correto), ativar/desativar — todas as
escritas confirmadas diretamente no Firestore após cada ação.

### 20 — Identidade visual (B6)
Pasta original `Id visual - VR e Vitre/` inspecionada, **nunca alterada,
nunca movida, nunca versionada** (permanece `??` no `git status`, fora do
controle de versão, conforme instrução explícita). Logos oficiais
copiados (não movidos) para `assets/brands/{vr,vitre}/logo.png` (VR
redimensionado de 8001×4500/344KB para 800px de largura/65KB via `sips`).
`assets/brands/brand-config.js` criado como config central: nome, cores,
logo, textos comerciais por marca. **Dados fiscais/contato reais
(CNPJ/endereço/telefone/Pix) NÃO foram fornecidos nesta rodada** —
placeholders explícitos `"(PENDENTE — não usar em produção)"`, nunca
usados em nenhum PDF/WhatsApp real gerado nesta rodada.

### 21 — Dois fluxos de orçamento (B7)
Nova tela de escolha (`opg0`) no início de "Novo Orçamento": "Personalizado
— VR Marcas" vs "Catálogo — Vitre", decisão nunca baseada em CPF/CNPJ
(texto explicativo na própria tela). `orcEscolhaFluxo()` substitui a
chamada direta a `orcStep(1)` no hook de navegação. **Fluxo VR
verificado intocado**: `orcStep()`/`orcAddItem()`/PDF/WhatsApp VR não
sofreram nenhuma alteração de código, e a navegação para o fluxo VR
(`orcStep(1)`) continua funcionando exatamente como antes (confirmado ao
vivo).

### 22 — Fluxo Vitre — orçamento de catálogo (B8-B9)
Container próprio (`#vitreOrcWrap`), fora do grupo `.orc-pg` — não
interfere com `orcStep()` nem é afetado por ele. Cliente, busca de produto
ativo do catálogo (reaproveita o mesmo cache/listener da tela Catálogo
Vitre — sem segundo listener redundante), carrinho de itens com
quantidade, desconto %, frete, validade, resumo calculado, salvar
rascunho via `vitreCriarOrcamento` (snapshot imutável de nome/preço no
momento da criação), histórico em tempo real, cancelar via
`vitreAtualizarOrcamento`.

### 23 — Diferenciação catálogo vs. pronta-entrega (B8, parcial)
O campo `disponibilidade` (`pronta_entrega`/`sob_encomenda`/
`sob_encomenda_opcoes_limitadas`/`indisponivel`) já existe no modelo de
dados e é retornado nas consultas (inclusive para a Valéria). **Não
implementado nesta rodada**: geração automática de OS a partir da ficha
técnica para o caso "produzido após pedido" — registrado como pendência
explícita (ver "Pendências", item 30).

### 24 — Verificação ao vivo do fluxo Vitre (B9)
Via Browser real: cliente preenchido, busca real retornando produtos reais
do catálogo importado, item adicionado ao carrinho, desconto 10% + frete
R$25 sobre subtotal R$1290 conferido manualmente (R$1186,00 — bate com o
cálculo do servidor), rascunho salvo com escrita real confirmada no
Firestore, histórico atualizado em tempo real, cancelamento real via
Function.

### 25 — PDF e WhatsApp Vitre (B10)
`vitreOrcGerarPDF`/`vitreOrcEnviarWhatsApp`, completamente separados das
funções VR (`orcImprimirOrcamentoPDF`/`orcEnviarOrcamentoWA` — zero
alteração), parametrizados por `BRAND_CONFIG.vitre`. **Conteúdo
inspecionado diretamente** (interceptando `document.write`/
`location.href`, já que `window.open()` é bloqueado no ambiente de teste
headless — mesma limitação que já existe nas funções VR equivalentes,
não uma regressão desta rodada): nome do cliente, SKU, total corretos;
**confirmada ausência total de "custo"/"margem" tanto no HTML do PDF
quanto na mensagem de WhatsApp**.

### 26 — Rules do bloco `vitre_*` (B11)
`firestore.rules`: leitura por perfil (Master/Comercial/Produção/
Financeiro conforme a função de cada coleção), escrita **sempre negada ao
cliente**, inclusive para Master, em todas as 6 coleções
(`vitre_produtos`/`vitre_produto_historico`/`vitre_importacoes`/
`vitre_orcamentos`/`vitre_idem_keys`/`vitre_audit_log`) — só o Admin SDK
(Cloud Functions) escreve. 23 cenários automatizados via API REST do
Firestore Emulator com idToken real (não mockado), incluindo tentativa
direta de forjar preço/total/idempotência — todos negados como esperado.

### 27 — Concorrência e edge-cases (B11)
Além dos 23 cenários de Rules: conta sem cadastro em `erp_vr_usuarios`
negada; **criação concorrente real** do mesmo SKU novo via duas chamadas
simultâneas (`Promise.all`, sem requestId compartilhado) — confirmado que
a transação do Firestore serializa e o documento final é exatamente uma
das duas versões, nunca um dado corrompido; orçamento com item de SKU
inexistente misturado a item válido bloqueia o orçamento inteiro
(fail-closed, zero documento parcial criado).

### 28 — Cobertura de testes automatizados do Catálogo Vitre
| Suíte | Categoria | Cenários | Resultado |
|---|---|---|---|
| `test_vitre_catalogo_server.js` | Functions (Admin SDK, `.run()`) | 23 | 23/23 ✅ |
| `test_vitre_rules.js` | Firestore Rules (REST + idToken real) | 23 | 23/23 ✅ |
| `test_vitre_importador_unit.js` | Unitário puro (sem Firestore) | 7 | 7/7 ✅ |
| **Total Catálogo Vitre** | | **53** | **53/53 ✅** |

Categorias mantidas **separadas**, nunca somadas de forma enganosa (lição
já registrada em rodadas anteriores desta auditoria).

### 29 — Dupla execução limpa (Fase G)
Ambiente resetado (`e2e_clean_env.js reset`) e planilha reimportada duas
vezes nesta rodada, com verificação de determinismo:
- **Hash SHA-256 do seed inicial idêntico** nas duas rodadas:
  `2381d74ae7b45045f3c0f7fa739c100452dd8259c947ca7f60bb6b6439e50eab`.
- **Contagem de importação idêntica**: 102 criados / 0 atualizados / 0 sem
  alteração / 86 erros não-bloqueantes, nas duas rodadas.
- **Resultado dos testes idêntico**: 23+23+7 = 53/53 nas duas rodadas
  (mais 15/15 da suíte Valéria×Vitre — ver Parte C).
- **Zero dependência de estado da rodada anterior** — cada rodada partiu
  de um reset completo.

### 30 — Pendências explícitas do Fase G (documentadas, não escondidas)
- **B5 (frontend) — importação em massa via UI não implementada.** O
  botão "Importar planilha" na tela Catálogo Vitre abre um modal
  informativo explicando que a importação real é feita pelo script
  `vitre_importar_planilha.js` (já testado e usado de verdade nesta
  rodada), em vez de reimplementar upload+parse+preview no navegador.
  Decisão deliberada de escopo — o parser client-side (`xlsx.full.min.js`
  via CDN) já está disponível na página para uma iteração futura, se
  desejado.
- **B8 — geração automática de OS a partir de ficha técnica** (para
  produtos "produzidos após pedido") não implementada — o campo
  `disponibilidade` existe e é exposto, mas o fluxo operacional de
  produção-a-partir-do-catálogo fica para uma rodada futura.
- **B12 — testes de E2E-UI automatizados (scriptados) não foram
  escritos** para o Catálogo Vitre/orçamento Vitre — toda a verificação
  E2E desta rodada foi feita ao vivo via Browser real contra o Emulator
  (documentada nos itens 19, 24), mas não capturada em um script
  repetível de E2E-UI (diferente dos 53 testes de Functions/Rules/
  unitário, que são scriptados e repetíveis). Registrado honestamente
  como lacuna, não escondido.
- **Vulnerabilidades conhecidas do pacote `xlsx@0.18.5`** (prototype
  pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9) — avaliadas e
  aceitas como baixo risco para o uso específico desta rodada (script
  administrativo local, parseando um arquivo que o próprio usuário já
  possui, nunca um endpoint público recebendo upload de terceiros). Não
  corrigidas nem substituídas nesta rodada — decisão de risco registrada,
  não escondida.
- **Famílias/variantes como entidades de primeira classe** não foram
  implementadas como coleções separadas — hoje `categoria` e
  `produtoPaiId` cobrem parcialmente essa necessidade; se o catálogo
  crescer, vale revisitar.

---

## PARTE C — PREPARAÇÃO VALÉRIA (itens 31-37)

**Nenhum destes itens configura o Chatvolt real ou conecta um agente
real.** Tudo foi testado exclusivamente via HTTP direto contra o Functions
Emulator local, com um secret sintético removido ao final da suíte.
Documentação completa em
`scripts/VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md`.

### 31 — Regra de classificação (C1)
Documentada e implementada nas Functions: CPF/CNPJ nunca é a regra de
decisão (é só um sinal comercial). Sequência real: entender necessidade →
buscar catálogo → SKU compatível? → variante? → personalização permitida?
→ prazo/disponibilidade confiáveis? → oferecer Vitre (com ou sem
adicional) quando o catálogo satisfaz → encaminhar para VR Personalizado
quando exige medida nova/material fora do padrão/alteração não
permitida/arquivo exclusivo.

### 32 — Functions server-side preparadas, sem deploy (C2)
`functions/src/valeria_vitre.ts` (novo), 5 endpoints `onRequest`,
reaproveitando a autenticação Bearer já existente em `valeria.ts`
(`checkAuth`, agora exportado — mudança de zero risco, só adiciona a
palavra-chave `export`, comportamento idêntico) e `acquireIdem`/
`writeAudit` de `auth_helper.ts` (mesmos helpers usados por `vitre.ts`/
`compras.ts`/`estoque.ts`): `valeriaVitreBuscarCatalogo`,
`valeriaVitreConsultarProduto`, `valeriaVitreSimularOrcamento`,
`valeriaVitreCriarRascunho`, `valeriaVitreEncaminharVR`. Nenhum foi
exposto ao Chatvolt — só existem no código e no Emulator local.

### 33 — Regra de elegibilidade automática (C3)
Um produto só é oferecido automaticamente pela Valéria quando: ativo,
`ativoValeria === true` (flag distinta de "ativo no ERP" — permite
liberar um produto para venda manual sem liberá-lo para o agente), preço
válido, prazo confiável, descrição presente, nível de completude ≥ 2
(mais exigente que o mínimo 1 aceito pelo CRUD manual do ERP, porque aqui
não há humano revisando antes do envio ao cliente). Verificado por teste
dedicado (cenários 4, 6, 9 — produto abaixo do nível nunca aparece em
busca nem é oferecido).

### 34 — Whitelist de campos — nunca expõe dado sensível (C2/C3)
`produtoParaValeria()` é o único ponto de saída de dado de produto —
whitelist explícita (sku/nome/categoria/família/variante/preço/prazo/
disponibilidade/descrição/fotos/usos/palavras-chave/personalizações
permitidas). **Nunca**: custo, margem, markup, caminho de arquivo/rede,
ficha técnica interna, configuração do sistema. Verificado por teste
automatizado que varre o JSON de resposta procurando literalmente as
strings "custo"/"margem" (cenário 3).

### 35 — Mapa de Actions, prompt base e cenários (C4)
Tabela completa de Actions → Function → payload → resposta → quando
chamar, prompt base rascunho (marcado como "para revisão humana antes de
qualquer configuração real"), perguntas de qualificação sugeridas, lista
de quando transferir para humano além do encaminhamento VR. Tudo em
`scripts/VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md`.

### 36 — Testes reais dos endpoints (C5)
`scripts/test_valeria_vitre_server.js` — 15 cenários via HTTP real contra
o Functions Emulator (não Chatvolt): auth ausente/errada negada (401);
busca por palavra-chave retorna produto elegível sem expor custo/margem;
produto abaixo do nível mínimo nunca aparece; SKU inexistente nunca
inventado (`SKU_NAO_ENCONTRADO` explícito); simulação de orçamento
calcula corretamente e **nunca persiste**; simulação com produto
inelegível falha fail-closed; rascunho real grava em `vitre_orcamentos`
com `origem='valeria'` e snapshot correto; **isolamento obrigatório**
(`conversationId`+`organizationId` — sem eles, 400); idempotência real sob
retry (mesmo `requestId` não duplica); **duas conversas simultâneas do
mesmo cliente isoladas corretamente** (não colidem); encaminhamento para
VR grava handoff auditável com motivo válido e motivo inválido
normalizado. **15/15 passando**, repetido nas duas rodadas de reset (item
29) com resultado idêntico.

### 37 — Rules do bloco Valéria e pendências explícitas (C2/C5)
`valeria_vitre_idem_keys` (negado a todos, uso interno), 
`valeria_vitre_audit_log` (leitura master-only), `valeria_handoffs`
(leitura Comercial+Master) — mesma arquitetura `write:false` do resto do
arquivo. **Pendências explícitas, documentadas no próprio arquivo de
preparação**: nenhum agente real criado no Chatvolt; nenhuma credencial
do Chatvolt tocada; `VALERIA_SECRET` real de produção não foi gerado nem
substituído (só um secret sintético local, removido ao final);
cenários adicionais não implementados (cliente enviando foto, desconto
acima do padrão, múltiplas variantes de tamanho) registrados como próximo
passo, não escondidos como "feito".

---

## Confirmações finais (itens 38-44)

**38 — Zero deploy.** Nenhum comando `firebase deploy` foi executado
contra nenhum projeto real nesta rodada. Confirmável via histórico de
comandos desta sessão — todos os comandos de escrita usaram
`FIRESTORE_EMULATOR_HOST=localhost:8080` / `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`
explicitamente, ou o Functions Emulator local (`localhost:5001`).

**39 — Zero produção alterada.** Nenhum usuário, claim, senha, Rule,
Hosting ou dado do projeto `erp-vrmarcas` foi lido, criado, editado ou
removido nesta rodada.

**40 — `origin/master` intacto.** `git ls-remote origin refs/heads/master`
retorna `bc6e1de629a9cc2ece7573616b450820ec197476` — mesmo commit do
início da rodada (confirmado por comparação direta, não assumido).

**41 — Working trees.** `git status --short` em `feat/fase-g-catalogo-vitre`
mostra **zero arquivo modificado não commitado** — o único item não
versionado é `"Id visual - VR e Vitre/"`, deliberadamente fora do
controle de versão (instrução explícita: nunca versionar a pasta
original).

**42 — HEADs remotos após esta rodada:**
- `origin/release/fase-f-usuarios-2026-08-05` → `ba0ecaef7b139a942937bc6f43b53e00fec44974` (já estava sincronizado, push confirmou "Everything up-to-date").
- `origin/feat/fase-g-catalogo-vitre` → `a2834c6b6c9a65d124d43cf3c23096b58391855f` (branch nova, criada e enviada nesta rodada — 6 commits: `c655d82`, `c40e594`, `d6a4fa2`, `9ad7d6c`, `b9bfad2`, `a2834c6`).
- `origin/master` → `bc6e1de6...` (intocado).
- Nenhum PR aberto (GitHub sugeriu automaticamente ao criar a branch nova — sugestão ignorada, conforme instrução explícita de não auto-abrir PR).

**43 — Untracked files finais:** apenas `"Id visual - VR e Vitre/"` (pasta
original de identidade visual, preservada intacta e nunca versionada).
Nenhum outro arquivo temporário, fixture, credencial, snapshot ou backup
ficou pendente de commit ou de remoção.

**44 — Próximos comandos exatos (se o usuário quiser continuar
manualmente):**
```bash
# Ver o diff completo da Fase G:
git log --stat ba0ecae..feat/fase-g-catalogo-vitre

# Rodar a suíte completa de novo (ambiente limpo):
node scripts/e2e_clean_env.js reset
node scripts/vitre_importar_planilha.js "<caminho da planilha>" --apply
node scripts/test_vitre_catalogo_server.js
node scripts/test_vitre_rules.js
node scripts/test_vitre_importador_unit.js
node scripts/test_valeria_vitre_server.js

# Ver a tela Catálogo Vitre / fluxo de orçamento Vitre ao vivo:
# abrir http://localhost:5050/?emulator=1 com os Emulators rodando

# Quando o usuário decidir seguir para configuração real do Chatvolt:
# revisar scripts/VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md
# ANTES de gerar um VALERIA_SECRET real e configurar Actions no Chatvolt.
```

---

## Pareceres finais

- **Fase F:** `FASE F NÃO PRONTA PARA DEPLOY` (mantido do relatório
  anterior desta rodada — bloqueador de exaustividade de matriz de UI,
  não arquitetural).
- **Fase G (Catálogo Vitre):** `FASE G PRONTA PARA HOMOLOGAÇÃO HUMANA` —
  todas as camadas server-side (Functions, Rules, importador) e o
  frontend (CRUD, dois fluxos de orçamento, PDF/WhatsApp Vitre) estão
  implementados, testados automaticamente (53 cenários Functions+Rules+
  unitário, 100% passando, dupla execução determinística) e verificados
  ao vivo via UI real contra o Emulator. As pendências explícitas do
  item 30 (importação via UI, geração de OS automática, E2E-UI
  scriptado) são lacunas de escopo conhecidas e documentadas, não
  bloqueadores de segurança ou de integridade de dado — adequado para
  um humano revisar e decidir a priorização da próxima rodada.
- **Integração Valéria:** `INTEGRAÇÃO VALÉRIA COM PENDÊNCIAS` — a camada
  de backend (Functions, regras de elegibilidade, isolamento, idempotência,
  auditoria) está pronta e testada (15/15), mas a configuração real no
  Chatvolt (Actions, agente, prompt final revisado por humano, secret de
  produção) não foi feita nesta rodada, por decisão de escopo — exige
  autorização explícita e configuração manual numa rodada futura.

---

*Fim do relatório. Nenhuma ação adicional será tomada até o usuário
revisar este relatório e decidir os próximos passos.*
