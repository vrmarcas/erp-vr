# Relatório Final — Homologação Guiada (Fase F, Catálogo Vitre, Valéria)
### 2026-08-06 — branch `feat/fase-g-catalogo-vitre`

Este é o relatório de fechamento pedido na instrução "HOMOLOGAÇÃO
HUMANA GUIADA E FECHAMENTO DAS PENDÊNCIAS". Cobre os 25 itens
solicitados. **Nenhum deploy foi feito. Nenhum merge em master foi
feito. O Chatvolt real não foi configurado.** Todos os relatórios
detalhados citados abaixo estão em `scripts/HOMOLOGACAO_P*_*.md`.

---

## 1. Parecer Fase F

**FASE F PRONTA PARA DEPLOY COORDENADO.**
Ver `HOMOLOGACAO_P2_MATRIZ_FASE_F_2026-08-06.md`. 25 itens nomeados
pela instrução, 23 com evidência direta de execução real (Functions
compiladas reais, Rules via REST com idToken genuíno, cliques reais em
sessão autenticada), 2 com justificativa técnica registrada (Functions
indisponíveis — tratado em código, não derrubado ao vivo para não
interromper a homologação; módulos financeiro/fiscal/Dashboard/DRE —
fora do escopo desta branch, já homologados separadamente). Nenhum
bloqueador arquitetural, de segurança ou de integridade de dado em
aberto. "Coordenado" = acompanhar de perto o primeiro uso real do
módulo Vitre (novo) com rollback pronto — não um problema não
resolvido.

## 2. Matriz final de UI

25 linhas (23 itens nomeados + 2 desdobramentos de "login"), universo
teórico reduzido por fronteira de permissão (pairwise), cobertura por
tipo de erro tabulada (`permission-denied`, `failed-precondition`,
`not-found`, `invalid-argument`, `already-exists`, `aborted`,
`unavailable`). Ver `HOMOLOGACAO_P2_MATRIZ_FASE_F_2026-08-06.md`.

## 3. Parecer Fase G (Catálogo Vitre)

**FASE G PRONTA PARA DEPLOY COORDENADO**, com uma pendência humana
explícita e bloqueante para dados reais (item 18 abaixo — os 4
conflitos de SKU). Código, Functions, Rules e UI testados
exaustivamente (ver itens 4-17). Nenhum bug de segurança ou
integridade em aberto. Nenhum dado real foi gravado sem confirmação
humana.

## 4. Logos realmente usados

`assets/brand/` (pasta já existente antes desta Fase G, commitada,
usada pelo login, sidebar, favicon e AMBOS os PDFs de orçamento —
`vr-marcas-logo.png` real e `vitre-logo.png` real, cores reais
extraídas dos arquivos oficiais em `Id visual - VR e Vitre/`).
Achado corrigido nesta rodada: `vitreOrcGerarPDF()` não renderizava
nenhum `<img>` de logo antes (só texto) — corrigido, verificado
visualmente (iframe + screenshot). Ver
`HOMOLOGACAO_P3_IDENTIDADE_VISUAL_2026-08-06.md`.

## 5. Conflitos de SKU

4 conflitos reais (`CPC001`, `MLP001`, `MLR001`, `PPCI001`), tabela
completa com todos os campos das 2 linhas de cada, sugestão de novo
SKU **não aplicada** (decisão humana pendente), prova técnica via
fixture sintética de que a sugestão resolveria o conflito. Ver
`HOMOLOGACAO_P4_CONFLITOS_SKU_2026-08-06.md`.

## 6. Avisos da planilha

86 avisos reais: `peso_ausente` (36), `embalagem_ausente` (27),
`descricao_ausente` (19), `sku_duplicado_conflitante` (4, = item 5).
Classificados por obrigatoriedade (venda manual / Valéria / produção
/ opcional). Achado adicional: os 102 produtos importados estão TODOS
em nível 1 (nenhum chega a nível 2 — falta categoria/fotos, que a
planilha comercial não cobre). Painel "Cadastros Incompletos"
implementado no Catálogo Vitre. Ver
`HOMOLOGACAO_P5_AVISOS_PLANILHA_2026-08-06.md`.

## 7. Importação via interface

Fluxo real implementado (não só terminal): seleção de arquivo → leitura
100% no navegador (`XLSX.read`) → dry-run automático via a MESMA
Cloud Function real → preview com válidos/conflitos/avisos → aplicar
só os válidos → histórico em tempo real. Verificado ao vivo. Ver
`HOMOLOGACAO_P6_IMPORTACAO_UI_2026-08-06.md`.

## 8. CRUD

Catálogo Vitre completo (listar, buscar, filtrar, criar, editar,
duplicar, criar variante, desativar/reativar, atualizar preço,
histórico) — construído em rodadas anteriores (NOTURNA B5), Rules e
Functions testadas (28 cenários de Rules, 23 de Functions). Achado
corrigido nesta rodada: botões de topo "＋ Novo Produto"/
"📥 Importar planilha" visíveis para Comercial sem permissão real —
corrigido e verificado ao vivo por perfil (Master/Produção/Comercial/
sem-perfil). Ver `HOMOLOGACAO_P7_E2E_CATALOGO_VITRE_2026-08-06.md`.

## 9. Orçamento VR

Fluxo preservado, código-fonte **inalterado** desde antes desta rodada
(confirmado por diff vazio nas funções `orc*`) — a homologação anterior
(Rodadas E.1/E.2, matriz NOTURNA) continua válida sem necessidade de
re-execução.

## 10. Orçamento Vitre

E2E ao vivo completo: cliente → busca de produto → item → desconto/
frete/validade → salvar (Function real, snapshot) → PDF → WhatsApp →
cancelamento. Paridade de total confirmada entre tela/PDF/WhatsApp.
Separação de marca confirmada. Ver
`HOMOLOGACAO_P8_ORCAMENTO_MULTIMARCA_2026-08-06.md`.

## 11. PDF VR

Template inalterado, já homologado com 13 cenários reais (Chromium)
em rodada anterior.

## 12. PDF Vitre

Corrigido nesta rodada (não renderizava logo real) — agora com logo
real, cores reais, CNPJ/endereço reais, zero custo/margem exposto,
total idêntico ao calculado na tela. Verificado visualmente
(screenshot do iframe renderizado).

## 13. WhatsApp VR

Inalterado, já homologado com 26 cenários em rodada anterior.

## 14. WhatsApp Vitre

Mensagem gerada e decodificada ao vivo, total idêntico ao PDF e à
tela (R$ 2357,50 nos três, no cenário testado), telefone normalizado
corretamente, responsável/marca corretos.

## 15. OS do produto Vitre

Feature nova construída e homologada nesta rodada: classificação
automática por item (pronta_entrega / produzido_apos_pedido /
ficha_incompleta), fail-closed se qualquer item ficar incompleto
(nenhuma baixa parcial, nenhuma OS parcial), snapshot de ficha
técnica/arquivo de corte (nunca aberto/executado automaticamente),
idempotência e concorrência testadas. 12/12 testes + verificado ao
vivo pela UI (botão "Converter em OS"). Ver
`HOMOLOGACAO_P9_OS_PRODUTO_VITRE_2026-08-06.md`.

## 16. Functions da Valéria

5 Functions revisadas e confirmadas: nunca expõem custo/margem/
markup/caminho de arquivo; nunca oferecem produto desativado ou
abaixo do nível mínimo (2); respeitam `conversationId`/
`organizationId`; idempotentes por `requestId`; fail-closed. Achado
corrigido nesta rodada: `simularOrcamento`/`criarRascunho` não tinham
suporte a personalização — implementado com preço sempre resolvido no
servidor (nunca do payload). Ver
`HOMOLOGACAO_P10_VALERIA_2026-08-06.md`.

## 17. Cenários da Valéria

Os 17 cenários nomeados pela instrução — **17/17 cobertos** (25 testes
no total, incluindo os 15 da preparação anterior). PF/PJ×Vitre/VR
confirmado estrutural (nenhuma Function lê CPF/CNPJ). Ver tabela
completa em `HOMOLOGACAO_P10_VALERIA_2026-08-06.md`.

## 18. Pendências que exigem decisão humana

1. **4 conflitos de SKU** (item 5) — nenhuma das 8 linhas envolvidas
   foi importada; sugestão de renomeação documentada, não aplicada.
2. **Novo campo `estoqueProntoUnidades`** (OS Vitre) — nenhum produto
   real tem esse campo preenchido hoje (planilha comercial não cobre
   estoque de peça pronta); todo item cairia em `ficha_incompleta` até
   cadastro manual.
3. **Ficha técnica de produção** (nível 4) — nenhum dos 102 produtos
   importados tem `fichaTecnica`/`arquivoCorte`; cadastro manual
   necessário antes de qualquer conversão real em OS do tipo
   "produzido após o pedido".
4. **Categoria e fotos** — nenhum produto chega a nível 2; sem isso,
   nenhum fica elegível para a Valéria mesmo depois de resolvidos os
   86 avisos.
5. **Achado colateral registrado, não corrigido** (fora de escopo):
   `vitreCriarOrcamento` (o Function usado pelo ERP, não pela Valéria)
   usa o preço de personalização vindo do próprio payload do cliente,
   sem revalidar contra o catálogo — a versão da Valéria já foi
   corrigida; a do ERP fica para decisão humana.
6. **Unificação de telas de produção** — `vitre_os` é uma coleção
   nova e separada do Kanban/`kb_os` legado da produção VR; decisão de
   unificar as duas telas é de produto, não técnica.

## 19. Branches e HEADs

| Branch | HEAD | Sincronizado com origin? |
|---|---|---|
| `feat/fase-g-catalogo-vitre` | `7aa350a3fffabbb0e20ed43e844cb4d4905b5d9d` | ✅ |
| `release/fase-f-usuarios-2026-08-05` | `ba0ecaef7b139a942937bc6f43b53e00fec44974` | ✅ (não tocada) |
| `origin/master` | `bc6e1de629a9cc2ece7573616b450820ec197476` | ✅ (nunca tocado) |

## 20. Commits desta rodada de homologação (13, todos pushados)

`0685240` Parte 3 (identidade visual) · `b54f414` Parte 4 (conflitos
SKU) · `8fd8ca4` Parte 5 (avisos + painel) · `f11509a` Parte 6
(importação UI) · `db1339f` + `556ccd2` Parte 7 (fix + relatório) ·
`8aafa72` Parte 8 (orçamento multimarca) · `ef8622f` Parte 9 (OS
Vitre) · `cbe200f` Parte 10 (Valéria) · `560e7af` Parte 1
(reconciliação) · `0524663` Parte 2 (matriz Fase F) · `2e954b9` +
`7aa350a` Parte 11 (fix de teste + duas execuções limpas).

## 21. Testes por categoria (execução final, duas rodadas idênticas)

| Categoria | passed | failed |
|---|---|---|
| Functions — Produção | 29 | 0 |
| Functions — Estoque (12 comandos) | 33 | 0 |
| Functions — Compras v2 | 21 | 0 |
| Ferramenta — QA fixture guard | 14 | 0 |
| Rules — REST (estoque) | 17 | 0 |
| Functions — Catálogo Vitre | 23 | 0 |
| Rules — bloco vitre_* | 28 | 0 |
| Unitário — parser da planilha | 7 | 0 |
| Fixture — resolução dos 4 conflitos | 8 | 0 |
| Functions — conversão OS Vitre | 12 | 0 |
| Functions — Valéria × Vitre | 25 | 0 |
| **Total (referência)** | **217** | **0** |

## 22. Zero produção alterada

Nenhum `firebase deploy` executado. `.firebaserc`/`firebase.json`
inalterados. Todo trabalho contra `demo-erp-homolog` (Emulator Suite),
com guarda explícita no código que recusa qualquer projeto que não
comece com `demo-`. `origin/master` confirmado ancestral estrito de
`master` local — nunca divergiu, nunca recebeu push desta sessão.

## 23. Plano de deploy coordenado (não executado)

1. **Pré-requisito humano:** decisão sobre os 4 conflitos de SKU
   (item 18.1) — sem isso, esses 8 produtos continuam de fora do
   catálogo publicado.
2. Publicar `firestore.rules` (inclui blocos `vitre_*` e `valeria_vitre_*`
   já testados) — sozinho, sem Hosting/Functions juntos, para permitir
   rollback isolado das Rules se algo quebrar.
3. Deploy das Cloud Functions novas (`vitreConverterOrcamentoParaOS`,
   personalização em `valeria_vitre.ts`, e todo o bloco `vitre.ts`
   já existente de rodadas anteriores).
4. Deploy do Hosting (novo `index.html` com Catálogo Vitre, orçamento
   multimarca, conversão em OS).
5. Importar a planilha real em produção **só depois** dos passos 1-4,
   via a mesma tela de importação já homologada (Parte 6) — nunca via
   script direto em produção.
6. Monitorar de perto (primeiras 48h): audit logs
   (`vitre_audit_log`, `vitre_produto_auditoria`), taxa de erro das
   novas Functions, e especificamente a conversão de orçamento em OS
   (feature mais nova, sem histórico de uso real).
7. Cadastro manual gradual de `categoria`/`fotos`/ficha técnica pelos
   produtos que a operação quiser realmente elegíveis para venda mais
   completa e, futuramente, para a Valéria.

## 24. Plano de configuração do Chatvolt (não executado)

1. Revisão humana do prompt base e do mapa de Actions em
   `VALERIA_VITRE_INTEGRACAO_PREPARACAO_2026-08-06.md` (C4) — ajustar
   tom/idioma conforme a marca decidir.
2. Criar as 5 Actions no Chatvolt apontando para as URLs reais das
   Functions publicadas (passo 23.3), com o mesmo Bearer token já
   usado por `valeria.ts` (`erp_vr/valeria_config.secret`) — trocar
   esse secret antes de ligar ao agente real (o usado nos testes é
   só de teste).
3. Configurar rate limit e monitoramento de erro no próprio Chatvolt
   (a Function reaproveita `checkAuth` existente, sem limitador
   dedicado nesta preparação).
4. Rodar os 17 cenários (item 17) manualmente com o agente real antes
   de liberar para clientes de verdade.
5. Definir quem recebe os handoffs (`valeria_handoffs`, hoje legível
   por Comercial/Master) e o SLA de resposta humana.

## 25. Plano de rollback

- **Rules:** reverter para a versão anterior via
  `firebase deploy --only firestore:rules` apontando pro commit
  anterior — isolado, não depende de reverter Functions/Hosting.
- **Functions:** `firebase functions:delete` das novas
  (`vitreConverterOrcamentoParaOS` e as 5 da Valéria) reverte para o
  estado sem essas capacidades; o restante do Catálogo Vitre (CRUD,
  orçamento) já estava em produção de rodadas anteriores, não é novo
  desta rodada.
- **Hosting:** `firebase hosting:rollback` (mantém histórico de
  versões do Firebase) — reverte a UI para antes desta rodada.
- **Dado:** nenhuma migração destrutiva foi feita — os 4 SKUs em
  conflito nunca foram gravados, então não há nada para desfazer ali.
  Se a importação real já tiver rodado em produção antes de um
  rollback, os produtos importados (documento-por-SKU) podem ser
  desativados individualmente (`status:'inativo'`) sem apagar
  histórico.
- **Critério de acionamento:** taxa de erro anormal nas novas
  Functions, reclamação de cliente sobre orçamento/PDF/WhatsApp
  incorreto, ou qualquer sinal de dado de produção alterado fora do
  esperado.

---

## Encerramento

Conforme instruído: **não foi feito deploy, não foi feito merge em
master, o Chatvolt real não foi configurado.** Todos os commits desta
rodada estão em `feat/fase-g-catalogo-vitre`, pushados. Paro aqui,
neste relatório final.
