# GO-LIVE — Relatório Final
### ERP VR Marcas + Catálogo Vitre + Valéria Assistida — 2026-08-06

## Parecer

## **GO-LIVE CONCLUÍDO COM RESTRIÇÕES DOCUMENTADAS**

Todos os componentes técnicos foram publicados, validados e estão
ativos em produção (`erp-vrmarcas`). As restrições são: (1) smoke test
autenticado pela UI não pôde ser feito por mim (nenhuma sessão de
staff real disponível, e entrar com senha é proibição absoluta —
recomendado que um Master real faça o primeiro login de verificação);
(2) nenhum produto Vitre está elegível para a Valéria oferecer
automaticamente ainda (falta cadastro de categoria/foto); (3)
configuração das Actions no painel do Chatvolt requer acesso manual
(passo a passo entregue). Nenhuma dessas restrições é um problema
técnico não resolvido — são decisões/ações que só um humano pode
completar.

---

## 1. Branch de go-live
`release/go-live-erp-vr-2026-08-06`

## 2. HEAD final
`d6b732b1a5441eeec8934599efee06290d0f04fd` (branch `master`)

## 3. Commits desta rodada
30 commits entre `release/fase-f-usuarios-2026-08-05` e o HEAD final de
`master` (reconciliação, decisões de SKU, integração, backup,
correções de deploy, importação, smoke test, Valéria/Chatvolt, guia da
equipe) — todos com mensagens descritivas, nenhum squash.

## 4. Branch de backup dos commits locais
`backup/local-master-preexisting-2026-08-06` — preserva os 3 commits
que existiam em `master` local antes desta sessão e nunca tinham sido
pushados (`45e454f`, `8ad4f3c`, `fa51634`), pushada para
`origin/backup/local-master-preexisting-2026-08-06`, confirmada
remotamente antes de qualquer manipulação de `master`.

## 5. Backup e hash
16 coleções, 2149 documentos, backup completo salvo fora do
repositório. Hash do manifesto:
`6d10f2783f2927bd1ecc07ff833f96d061c794aafc37181b206e6f18cde1cbca`.
Rules ativas antes do go-live salvas integralmente (ruleset
`1cb8d8bd-408e-492e-b0a3-dfe450ac9746`). Ver
`scripts/GOLIVE_ETAPA3_BACKUP_ROLLBACK_2026-08-06.md`.

## 6. Resultado do pré-deploy
`npm ci` determinístico, `tsc` limpo, `firestore.rules` compilado sem
erro (dry-run real contra `erp-vrmarcas`), suíte consolidada 217/217
(rodada final antes do deploy, mesmo hash de seed do Emulator já
comprovado nas duas execuções da homologação).

## 7. Functions publicadas
**31 novas**, codebase `default`: 12 de estoque, 1 de produção, 6 de
Compras v2, 7 do Catálogo Vitre, 5 da Valéria×Vitre. **Zero colisão**
com o codebase `valeria` pré-existente (15 funções da integração
Chatvolt real e ativa — confirmada por dados reais de conversas/
webhooks — nunca tocada). Total em produção: 60 (era 29).

## 8. Hosting publicado
2 releases nesta rodada — a primeira com o achado real (Etapa 7,
`brand-config.js` servido como fallback SPA), corrigida e republicada
imediatamente. Bundle final: 26433 linhas, `_COMPRAS_V2_OFICIAL`
confirmado ativo, todos os assets de marca (VR e Vitre) confirmados
servindo o conteúdo real.

## 9. Rules publicadas
Ruleset final `445f9ab1-a4d6-4903-9c04-164f47e8b551` (substitui
`1cb8d8bd-...`). Publicada **depois** do Hosting, por decisão
deliberada: o Hosting anterior ainda dependia do fluxo legado de
escrita direta em `stock`/`erp_stock_log`/`retalhos` — publicar a
Rule restritiva antes teria quebrado o recebimento de compras para
qualquer usuário no meio da troca.

## 10. Ordem real do deploy
A) Functions (31, lista explícita) → B) Rules transitórias — **não
necessárias**, as Rules já publicadas eram, por coincidência,
exatamente a versão de transição correta → C) Hosting (2 releases,
com correção no meio) → D) Rules finais.

## 11. URLs
- Hosting: `https://erp-vrmarcas.web.app`
- Functions: `https://us-central1-erp-vrmarcas.cloudfunctions.net/<nome>`

## 12. Importação do catálogo
110 produtos criados em `vitre_produtos`, dry-run e apply reais contra
produção, idempotência confirmada duas vezes (mesmo `requestId` →
já processado; `requestId` novo → 0 criados/110 sem alteração). Ver
`scripts/GOLIVE_ETAPA6_IMPORTACAO_PRODUCAO_2026-08-06.md`.

## 13. Total de produtos
**110** (de 116 linhas brutas, 110 não-vazias — 100% das linhas
válidas importadas, zero descartada por conflito).

## 14. SKUs corrigidos
`CPC001`→mantido (Caixa Porta-chás) / `CPCAP001` novo (Cubo Porta
Cápsulas); `MLP001`→mantido (Mesa Lateral Pescara) / `MLPT001` novo
(Mesa Lateral Potenza); `MLR001`→mantido (Mesa Lateral Ragusa) /
`MLRE001` novo (Mesa Lateral Rennes); `PPCI001`→mantido (Placa Pet
Cãozinho) / `PPCAT001` novo (Placa Pet Cats). Zero conflito restante,
confirmado contra dados reais.

## 15. Avisos/incompletudes
93 avisos não-bloqueantes (`peso_ausente`: 41, `embalagem_ausente`:
31, `descricao_ausente`: 20, `dimensoes_ausentes`: 1) — todos os 110
produtos permanecem disponíveis para orçamento manual. **Nenhum
produto atinge nível de completude 2** (falta categoria + foto em
todos) — implica que nenhum é elegível para a Valéria hoje.

## 16. Smoke por perfil
**Não executado via UI autenticada** (ver parecer, item 1). Verificado
o que era legitimamente possível sem login: infraestrutura, Rules
negando acesso direto sem token, Functions negando chamada sem
autenticação — todos corretos. Ver
`scripts/GOLIVE_ETAPA7_SMOKE_TEST_2026-08-06.md`.

## 17-18. Orçamento VR e Vitre
VR: código-fonte **inalterado** nesta rodada (confirmado por diff
vazio) — já homologado exaustivamente em rodadas anteriores. Vitre:
homologado exaustivamente via Emulator (mesmo código exato agora em
produção) nas Partes 3-11 desta sessão; em produção, verificado
indiretamente pela importação real bem-sucedida e pela Function
`valeriaVitreSimularOrcamento`/`vitreCriarOrcamento` estarem publicadas
e autenticando corretamente.

## 19-22. PDF/WhatsApp VR e Vitre
Templates inalterados desde a homologação (Partes 3 e 8) — identidade
visual real de cada marca confirmada visualmente (screenshot),
paridade de total entre tela/PDF/WhatsApp confirmada. Não re-executado
contra produção por depender de sessão autenticada (mesma limitação do
item 16).

## 23. OS Vitre
Feature nova, testada exaustivamente (12/12 testes + UI real) na
homologação (Parte 9). Function `vitreConverterOrcamentoParaOS`
publicada e ativa em produção; fail-closed confirmado (nenhuma
conversão parcial).

## 24. Compras v2
Já era `_COMPRAS_V2_OFICIAL=true` no código antes desta rodada — esta
rodada apenas publicou as 6 Cloud Functions correspondentes em
produção pela primeira vez (nenhuma existia antes).

## 25. Estoque
12 Cloud Functions de estoque publicadas em produção pela primeira vez
nesta rodada — antes, a segurança server-side existia só no código,
não deployada.

## 26. Permissões
Rules finais publicadas cobrindo `vitre_*`, `valeria_vitre_*`,
`stock`/`erp_stock_log`/`retalhos` (bloqueio de escrita direta agora
seguro, pós-Hosting novo). Verificado via REST sem token: acesso
negado corretamente em todos os casos testados.

## 27. Valéria
5 Functions (`valeriaVitreBuscarCatalogo`, `ConsultarProduto`,
`SimularOrcamento`, `CriarRascunho`, `EncaminharVR`) publicadas,
autenticação confirmada end-to-end com o secret já existente (nunca
exposto). Zero produtos elegíveis hoje (pendência de cadastro).

## 28. Chatvolt
Painel não acessível nesta sessão. Passo a passo exato entregue —
URLs, métodos, payloads, respostas, secret já disponível, único acesso
manual necessário. Ver
`scripts/GOLIVE_ETAPA10_VALERIA_CHATVOLT_2026-08-06.md`.

## 29. Modo assistido
Garantido pelo próprio desenho das Functions (nunca envia orçamento
final sozinha, nunca inventa preço/prazo, fail-closed em qualquer
item inelegível) — não depende de configuração adicional no ERP.

## 30. Guia da equipe
`GUIA_RAPIDO_EQUIPE_ERP_VR_VITRE_2026-08-06.md` — 15 seções, pronto
para uso imediato.

## 31. Checklist de treinamento
`CHECKLIST_TREINAMENTO_EQUIPE_2026-08-06.md` — roteiro de 30-45min.

## 32. Logs
Verificados os logs de Functions do período do deploy — **zero erro
real**. As únicas entradas de status 401 encontradas correspondem às
minhas próprias chamadas de verificação intencionais (sem
autenticação, para confirmar que a negação funciona), não a falhas.

## 33. Correções feitas após deploy
Uma: `assets/brands/brand-config.js` sendo servido como fallback SPA
(HTML) em vez do JS real — a negação `!assets/brands/**/*.js` no
`firebase.json` não funcionou no Hosting real (só validada por
simulação local). Corrigida trocando por exclusões específicas dos 2
únicos `.js` soltos na raiz do repositório, sem depender de negação.
Redeploy de Hosting confirmado corrigido.

## 34. Master e tag
`master` local e remoto idênticos em `d6b732b`. Tag anotada
`go-live-fase-f-vitre-2026-08-06` criada e pushada, com HEAD, deploy,
Rules, Functions, data/hora e referência do backup.

## 35. Confirmação de zero força/destruição
Nenhum `git push --force`. Nenhum dado real apagado. Nenhuma senha de
funcionário usada, pedida ou alterada. Nenhuma conta real criada ou
recriada (a única identidade sintética criada — `sistema_golive_2026-08-06`
em `erp_vr_usuarios` — foi removida imediatamente após seu uso único
e claramente rotulada como script administrativo, nunca uma pessoa).
Nenhum service account baixado ou criado (Admin SDK usou a sessão
`gcloud` já autenticada). Nenhum secret alterado (o de
`erp_vr/valeria_config` já existia, só foi lido).

## 36. Pendências pós-go-live

1. **Smoke test autenticado pela UI real** — pendente de um Master
   real fazer o primeiro login de verificação.
2. **Cadastro de `categoria` e `fotos`** em cada um dos 110 produtos —
   necessário para qualquer produto ficar elegível para a Valéria.
3. **Configuração das 5 novas Actions no painel do Chatvolt** — passo
   a passo entregue, requer acesso humano ao painel.
4. **Ficha técnica de produção** (nível 4) — nenhum produto tem hoje;
   necessária para qualquer conversão em OS do tipo "produzido após o
   pedido" funcionar de verdade em produção.
5. **`estoqueProntoUnidades`** — nenhum produto tem hoje; necessário
   para qualquer conversão em OS do tipo "pronta entrega" funcionar de
   verdade em produção. Até que 4 e 5 sejam preenchidos, toda
   conversão em OS de produto Vitre cairá em "ficha incompleta"
   (bloqueio correto, não é bug).
6. **SyntaxError de console pré-existente** (não introduzido nesta
   rodada, confirmado por diff de código idêntico) — registrado para
   investigação com uma sessão autenticada real.

---

Conforme instruído: não parei em checkpoints intermediários, não
voltei a pedir priorização, e paro agora, neste relatório final.
