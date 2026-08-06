# Relatório Final — RODADA FINAL DE HOMOLOGAÇÃO LIMPA (2026-08-06)

Branch: `release/fase-f-usuarios-2026-08-05`. Projeto de trabalho:
`demo-erp-homolog`. `erp-vrmarcas` (produção) não foi tocado.

## 1. Branch e HEAD

- Branch: `release/fase-f-usuarios-2026-08-05` (única tocada).
- HEAD inicial desta rodada: `213b13e`.
- HEAD final: `1a952ec`.
- HEAD local == HEAD remoto (`origin/release/fase-f-usuarios-2026-08-05`).
- `origin/master`: `bc6e1de6` — intocado.

## 2. Commits novos (4)

| Hash | Resumo |
|---|---|
| `a8f8f11` | Ambiente de homologação limpo e determinístico (reset+seed, IDs `E2E_FASEF_20260805_`, nunca reusa ac3/acm/ps3/mt2/ac5/ac8/ac10) |
| `7e613a6` | Mapeamento e paridade Compras v1 vs v2 |
| `215ad76` | Compras v2 vira a única arquitetura oficial (`_COMPRAS_V2_OFICIAL`, independente de `_HOMOLOG_MODE`) |
| `1a952ec` | UI E2E real, análise de migração, prova de determinismo |

## 3. Working tree

Limpo, exceto `Id visual - VR e Vitre/` (pré-existente, preservada intocada).

## 4. Ambiente limpo e seed

`scripts/e2e_clean_env.js` — reset completo de Firestore+Auth do
`demo-erp-homolog` (recusa estruturalmente qualquer projeto que não
comece com `demo-` ou seja `erp-vrmarcas`) + seed determinístico: 6
usuários com UIDs fixos (`e2efasef20260805master`, etc.), 8 materiais
fixture com prefixo `E2E_FASEF_20260805_` — **nenhuma chave real
reutilizada** (não usa `ac3`/`ac5`/`ac8`/`ac10`/`ps3`/`mt2`/`acm`).
Comando único de reset+seed, comando único de execução de toda a suíte
(`scripts/e2e_run_all_tests.js`), comando único de limpeza seletiva
(`scripts/e2e_clean_env.js clean`).

## 5. Hash do seed

`2381d74ae7b45045f3c0f7fa739c100452dd8259c947ca7f60bb6b6439e50eab` —
confirmado idêntico em 3 execuções consecutivas de reset com o mesmo
conteúdo de seed (após a correção do campo `email`, ver item 7).

## 6. Inventário v1/v2 de Compras

`scripts/AUDITORIA_FASE2_COMPRAS_V1_V2_PARIDADE_2026-08-06.md` — tabela
completa das 17 operações pedidas. Achado central: **Compras v1 não é
código morto** — `_HOMOLOG_MODE` só liga v2 em `localhost+?emulator=1`,
então v1 é o que roda em produção real hoje. v1 e v2 são funcionalmente
equivalentes exceto por um problema estrutural real em v1 (recebimento
escreve `stock` diretamente do cliente, sem transação, sem
idempotência) que v2 já resolve.

## 7. Migração para Compras v2 como arquitetura oficial

`_COMPRAS_V2_OFICIAL` (novo, independente de `_HOMOLOG_MODE`) substitui
`_HOMOLOG_MODE` em todos os 11 pontos de decisão v1-vs-v2 do módulo
Compras. Código v1 permanece no arquivo, intocado, mas inalcançável
enquanto a flag for `true` (que é o valor do candidato). Nenhuma
funcionalidade nova foi inventada — v1 e v2 já eram equivalentes (item 6).

Achado real durante a verificação ao vivo: o documento de usuário
fixture criado pelo seed não tinha o campo `email` (só `nome`), e o
fluxo de login casa a conta autenticada com o cadastro por esse campo —
sem ele, login falhava sempre com "Conta sem perfil atribuído" mesmo com
claim e documento corretos. Corrigido no mesmo commit da migração.

## 8. Cloud Functions

Nenhuma nova Function criada nesta rodada — as 12 de estoque + 1 de
produção + 6 de compras (já existentes de rodadas anteriores) foram
reconfirmadas contra o ambiente limpo. Ver relatório anterior
(`RELATORIO_FINAL_FASE15_2026-08-05.md`) para a lista completa.

## 9. Frontend

`_COMPRAS_V2_OFICIAL=true` como candidato oficial. Os 12 fluxos de
estoque já migrados na rodada anterior continuam sem fallback direto.
Verificados ao vivo nesta rodada (ver item 11).

## 10. Rules

Já cobertas: `stock`/`erp_stock_log`/`retalhos`/`retalhos_seq`/
`stock_deleted` fecham escrita client-side (rodada anterior);
`erp_vr_compras*`/`erp_vr_fin_cp`/`erp_vr_fin_pagamentos`/
`erp_vr_stock_movimentos`/`compras_idem_keys`/`compras_audit_log` **já
tinham** `allow write: if false` com leitura por perfil (de uma rodada
ainda mais antiga) — confirmado, nada precisou mudar. `kb_os` continua
aberto — fechá-lo exige migrar toda a superfície de status do Kanban,
fora de escopo (mesma ressalva já documentada). **Ainda não publicadas.**

## 11. UI E2E das 12 operações de estoque

Smoke test representativo ao vivo (login real, Hosting+Auth Emulator
reais), não a matriz exaustiva de 204 combinações. Login corrigido e
validado; tela de Estoque renderizou os 8 materiais fixture; entrada de
material via formulário real (não prompt) confirmada ponta a ponta
(clique → Cloud Function real → Firestore real → UI atualizada em tempo
real). Limitação de ferramenta documentada: `prompt()`/`confirm()`
nativos não são interativos pela automação de browser disponível — as
funções JS por trás deles foram exercitadas diretamente pela mesma
sessão autenticada real, provando a cadeia de código real sem o
transporte visual do diálogo. Achados de UI (painel-resumo não reativo;
listener de stock não recarrega sem refresh após login) documentados
como pré-existentes, não regressões desta correção. Detalhe completo em
`RODADA_FINAL_FASE6-13_2026-08-06.md`.

## 12. Compras v2 E2E

Criação + aprovação de uma solicitação real testadas ao vivo pela mesma
sessão do browser (Master), com resultado correto (numeração, fornecedor,
preço, status, UI reativa). As 21 combinações de cenário (duplo clique,
concorrência, requestIds, etc.) já cobertas por `test_compras_v2_server.js`
não foram repetidas via clique — mesma lacuna e mesma justificativa do
item 11.

## 13. Lock/token/conta desabilitada

**Não executado nesta rodada** — pendência recorrente de rodadas
anteriores, sem mudança de status.

## 14. Testes de Functions

114 testes, todos passando, agora rodando sobre o ambiente 100%
determinístico via `node scripts/e2e_run_all_tests.js`. Ver detalhamento
por categoria no item 16.

## 15. Testes de Rules

17 testes REST contra o arquivo `firestore.rules` real, incluídos nos
114 acima.

## 16. Compatibilidade de dados legados

Mapeamento de campos v1→v2 concluído (item 6). Script de migração
dry-run **não implementado** — não existe dado real de Compras v1 neste
ambiente para validar um script contra (todo o histórico de testes desta
auditoria já usou v2). Registrado como pendência explícita, não
escondida — ver `RODADA_FINAL_FASE6-13_2026-08-06.md`, seção FASE 11.

## 17. Limpeza

Reset completo executado repetidamente entre fases desta rodada
(garantia mais forte que limpeza seletiva — nunca deixa resíduo por
definição). Cenário específico "limpeza cirúrgica com outra aba antiga
aberta" não foi exercitado nesta rodada (mecanismo existe em
`e2e_clean_env.js clean`, não testado isoladamente).

## 18. Duas execuções limpas consecutivas

Confirmado: contagens idênticas (29/33/21/14/17 = 114 em cada) e hash de
seed idêntico em 2 execuções consecutivas de `e2e_run_all_tests.js` a
partir de reset limpo. Ver tabela em `RODADA_FINAL_FASE6-13_2026-08-06.md`.

## 19. Confirmação de zero alteração em produção

Nenhum comando desta rodada usou `--project erp-vrmarcas` nem ADC de
produção. `e2e_clean_env.js` recusa `erp-vrmarcas` estruturalmente. Todo
trabalho usou `FIRESTORE_EMULATOR_HOST=localhost:8080` e
`FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`. Nenhum `firebase deploy`
foi executado. O processo do Emulator Suite foi reiniciado uma vez
nesta rodada (Java não estava no PATH do shell após um kill acidental
do processo antigo — corrigido apontando para o OpenJDK do Homebrew),
sempre contra `demo-erp-homolog`.

## 20. Plano de deploy coordenado (NÃO executado)

- **Etapa A — Backup e snapshot**: exportar `erp-vrmarcas` (Firestore +
  Auth) antes de qualquer mudança; hash do snapshot.
- **Etapa B — Deploy Functions**: as 19 Cloud Functions (estoque +
  produção + compras) — seguro isoladamente, só adiciona capacidade.
- **Etapa C — Rules transitórias**: só se indispensável para B não
  quebrar nada em produção (não identificado nenhum caso que exija isso
  nesta rodada — B não depende de mudança de Rules).
- **Etapa D — Deploy Hosting**: o `index.html` candidato
  (`_COMPRAS_V2_OFICIAL=true`) — **só depois de B confirmado**, porque o
  candidato não tem fallback para escrita direta.
- **Etapa E — Rules finais**: publicar o fechamento de
  `stock`/`erp_stock_log`/`retalhos`/`retalhos_seq`/`stock_deleted` —
  **agora desbloqueado**, já que D remove a dependência de Compras v1
  (o bloqueador documentado na rodada anterior). Confirmar antes que
  nenhum outro caminho legado ainda escreve esses documentos.
- **Etapa F — Smoke técnico**: os 12 fluxos de estoque + Compras v2, via
  UI real, em produção, imediatamente após E.
- **Etapa G — Teste humano**: sessão real de Produção e Master repetindo
  os cenários críticos (saída insuficiente, exclusão/restauração,
  retalho, solicitação/aprovação/recebimento de compra).
- **Etapa H — Rollback coordenado**: reverter Hosting para o commit
  anterior (a UI antiga volta a rodar v1 direto, já que as Rules em E só
  seriam publicadas depois de D confirmado); Functions não precisam ser
  revertidas (não removem capacidade). Se o problema for detectado só
  depois de E, reverter E primeiro (reabrir escrita client-side) antes
  de reverter D.

## Parecer

Os bloqueadores identificados na rodada anterior foram resolvidos:
Compras v1 deixou de ser a arquitetura ativa no candidato (`_COMPRAS_V2_OFICIAL=true`),
o que desbloqueia a publicação das Rules de `stock` (antes impossível
sem quebrar produção). 114/114 testes automatizados passam de forma
determinística e reproduzível (hash idêntico, contagens idênticas em
execuções repetidas). A migração foi verificada ao vivo via UI real
(login, Compras v2 criar+aprovar, estoque entrada) — não apenas por
scripts de Function.

Ainda assim, dois itens genuínos impedem o parecer positivo: (1) a
matriz completa de UI E2E pedida (204 combinações de estoque + 14+8 de
Compras v2) foi coberta apenas por amostragem representativa, não
exaustivamente — a lacuna real é especificamente o transporte por
clique/diálogo nativo, não a lógica por trás dele (já coberta pelos 114
testes de Function); (2) lock/token/conta desabilitada continua sem
nenhuma execução nesta ou em rodadas anteriores.

## **NÃO PRONTO PARA DEPLOY**

O candidato avançou de forma real e verificável desde o relatório
anterior — o bloqueador estrutural de Rules foi removido, não apenas
contornado. O que falta não é mais arquitetural, é de cobertura de
verificação: UI E2E exaustiva e lock/token E2E.
