# GO-LIVE Etapa 3 — Backup e Ponto de Restauração

## Estado registrado ANTES de qualquer deploy (2026-08-06)

- **Projeto:** `erp-vrmarcas`
- **Hosting live:** última release em `2026-08-05 17:53:15`, URL
  `https://erp-vrmarcas.web.app` — bundle **25047 linhas**, sem
  `_COMPRAS_V2_OFICIAL` (confirmado via `curl` direto do bundle
  publicado) — ou seja, produção está numa versão **anterior a toda
  esta Fase F/G**, ainda 100% no fluxo legado de Compras v1.
- **Firestore Rules ativas:** ruleset
  `projects/erp-vrmarcas/rulesets/1cb8d8bd-408e-492e-b0a3-dfe450ac9746`,
  `createTime: 2026-08-05T15:34:55Z`. Conteúdo completo salvo em
  `_firestore_rules_ATIVAS_antes_do_golive.json` dentro do backup
  (fora do repositório). Já inclui proteções candidatas de Fase F
  para `kb_os`/`erp_os_counter`/`compras` — mas **delibera e
  corretamente NÃO inclui** o `allow write: if false` para
  `stock`/`stock_deleted`/`erp_stock_log`/`retalhos`/`retalhos_seq`,
  porque o Hosting ainda ativo hoje depende do fluxo legado de
  gravação direta nesses documentos.
- **Functions atualmente publicadas:** 29, em dois codebases
  distintos — **`default`** (14: `forceMarketingSync`,
  `getGoogleAuthUrl`, `getMetaAuthUrl`, `handleGoogleCallback`,
  `handleMetaCallback`, `syncMarketingMetricsData`, `adminCreateUser`,
  `adminListUsers`, `adminResendInvite`, `adminRevokeSessions`,
  `adminToggleStatus`, `adminUpdateUserRole`, `valeriaConsultarOS`,
  `valeriaGetCliente`) e **`valeria`** (15: `valeriaAtualizarBriefing`,
  `valeriaCalcularOrcamento`, `valeriaCatalogo`,
  `valeriaConsultarStatus`, `valeriaCriarOportunidade`,
  `valeriaCriarOrcamento`, `valeriaFechamento`, `valeriaGetContexto`,
  `valeriaMudarEtapa`, `valeriaProximaAcao`, `valeriaRegistrarMensagem`,
  `valeriaStatus`, `valeriaTransferirHumano`, `valeriaUpsertCliente`,
  `valeriaWebhookChatvolt`) — deployado separadamente via
  `functions-valeria/` + `firebase-valeria.json`, **fora do escopo
  desta rodada, nunca tocado**.
- **HEAD desta rodada:** `release/go-live-erp-vr-2026-08-06` @
  `9d0c7a2` (após merge de `feat/fase-g-catalogo-vitre` em
  `origin/master`).
- **Data/hora do registro:** 2026-08-06 (horário local do ambiente).

## Achado crítico que definiu a ordem do deploy

`functions/src/valeria.ts` (já existente na branch, não escrito nesta
rodada) define funções com os **mesmos nomes** de 8 funções hoje
publicadas sob o codebase `valeria` (`valeriaCatalogo`,
`valeriaCriarOportunidade`, `valeriaCriarOrcamento`,
`valeriaProximaAcao`, `valeriaRegistrarMensagem`, `valeriaStatus`,
`valeriaTransferirHumano`, `valeriaUpsertCliente`). Um `firebase
deploy --only functions` genérico (sem alvo explícito) tentaria
publicar essas 8 sob o codebase `default`, colidindo com o codebase
`valeria` já dono desses nomes — na melhor hipótese a CLI recusa o
deploy inteiro; na pior, haveria risco de sobrescrever uma integração
Chatvolt real e ativa (confirmado por dados reais: `valeria_conversations`
10 docs, `valeria_webhook_events` 12 docs, `valeria_briefings` 5 docs
— conversas e webhooks reais em andamento).

**Decisão:** o deploy de Functions desta rodada usa uma lista
explícita de 31 nomes (`--only functions:nome1,functions:nome2,...`),
cobrindo exatamente `estoque.ts` (12) + `producao.ts` (1) +
`compras.ts` (6) + `vitre.ts` (7) + `valeria_vitre.ts` (5) —
confirmado sem NENHUMA colisão com os 29 nomes já publicados. Nenhuma
função de `valeria.ts` (a antiga) é tocada nesta rodada — não está no
escopo do objetivo de hoje e evita qualquer risco de colisão de
codebase.

**Achado secundário que confirma a ordem A→B→C→D do plano:** o Hosting
ainda ativo é o legado (sem `_COMPRAS_V2_OFICIAL`). As Rules candidatas
mais restritivas (negar escrita client-side em `stock`/`erp_stock_log`/
`retalhos`) só podem ser publicadas com segurança **depois** do
Hosting novo estar no ar (`_COMPRAS_V2_OFICIAL=true` torna o ramo
legado código morto) — publicá-las antes quebraria o recebimento de
compras para qualquer usuário usando o app enquanto o Hosting antigo
ainda estivesse servindo. As Rules atualmente publicadas já são,
coincidentemente, a versão "transitória" correta — não é necessário
publicar uma Rules transitória separada nesta rodada, só pular
diretamente para as Rules finais depois do Hosting.

## Backup realizado

Snapshot completo de **todas as 16 coleções top-level** encontradas em
produção (via `Firestore.listCollections()`, não uma lista
pressuposta) — mais abrangente que a lista mínima pedida na instrução:

| Coleção | Documentos |
|---|---|
| `crm_base` | 1976 |
| `erp` | 6 |
| `erp_backups` | 17 |
| `erp_vr` | 31 |
| `erp_vr_aposentadoria_auditoria` | 1 |
| `erp_vr_criacao_auditoria` | 4 |
| `erp_vr_incidente_auditoria` | 1 |
| `erp_vr_substituicao_auditoria` | 1 |
| `erp_vr_usuarios` | 8 |
| `valeria_alertas` | 5 |
| `valeria_briefings` | 5 |
| `valeria_conversations` | 10 |
| `valeria_idem_keys` | 43 |
| `valeria_msgs` | 11 |
| `valeria_rate_limits` | 18 |
| `valeria_webhook_events` | 12 |
| **Total** | **2149 documentos** |

Nenhuma coleção `vitre_*` ou `erp_vr_compras_*` existe ainda em
produção — confirma que este é, de fato, o primeiro go-live real da
Fase F/G.

- **Local do backup:** diretório temporário fora do repositório
  (nunca commitado) — um `.json` por coleção + `_MANIFESTO.json` com
  contagem e SHA-256 por arquivo.
- **Hash do manifesto:** `6d10f2783f2927bd1ecc07ff833f96d061c794aafc37181b206e6f18cde1cbca`
- **Rules ativas antes do go-live:** salvas integralmente
  (`_firestore_rules_ATIVAS_antes_do_golive.json`, ruleset id acima).
- **Método:** Admin SDK autenticado via ADC do `gcloud` já logado
  (`vrmarcasgithub@gmail.com`) — nenhuma credencial nova criada ou
  baixada, nenhuma service account gerada.

## Rollback exato

1. **Hosting:** `firebase hosting:rollback --project erp-vrmarcas` (ou
   `firebase hosting:clone` para a release de `2026-08-05 17:53:15`
   especificamente) — restaura o bundle de 25047 linhas imediatamente.
2. **Rules:** republicar o conteúdo salvo em
   `_firestore_rules_ATIVAS_antes_do_golive.json` (ruleset
   `1cb8d8bd-...`) via `firebase deploy --only firestore:rules` a
   partir desse conteúdo restaurado num arquivo local temporário.
3. **Functions:** `firebase functions:delete` das 31 funções novas
   listadas acima (nomes exatos, todas sem colisão, portanto seguro
   remover individualmente sem afetar `default`/`valeria` codebase
   pré-existentes).
4. **Dados:** nenhuma migração destrutiva prevista nesta rodada — a
   importação do Catálogo Vitre cria documentos novos numa coleção
   nova (`vitre_produtos`, inexistente hoje); se precisar desfazer,
   basta apagar os documentos criados (nunca afeta `erp_vr`,
   `erp_vr_usuarios`, `crm_base` ou qualquer coleção pré-existente).
5. Em caso de dúvida sobre integridade de qualquer coleção
   pré-existente, os 16 arquivos JSON deste backup permitem
   reconstrução documento-por-documento via Admin SDK.
