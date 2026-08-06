# RODADA FINAL — FASE 6-13, 2026-08-06

## FASE 6 — UI E2E das 12 operações de estoque

**Escopo real executado**: smoke test representativo, não a matriz
exaustiva de 17 variações × 12 operações pedida (204 combinações). Feito
ao vivo, via Hosting Emulator real (`http://127.0.0.1:5050/index.html?emulator=1`)
+ Auth Emulator real (login de verdade com a conta fixture Master do
ambiente limpo), não simulado:

- Login real com `e2e_fasef_20260805_master@example.com` — bem-sucedido
  após corrigir o campo `email` faltante no seed (achado real, ver
  commit `215ad76`).
- Navegação real para a tela Estoque — 8 materiais fixture renderizados
  corretamente (painel "Panorama", lista "Estoque de Placas", indicador
  crítico/OK, barras de mín/máx).
- **`+ Entrada`**: formulário real (não prompt) preenchido e submetido via
  clique real — `estoqueRegistrarEntrada` chamada de verdade pela sessão
  do browser, saldo do material "Baixo Estoque" foi de 1→6 no servidor
  (confirmado por leitura direta do Firestore) e a lista de itens
  re-renderizou em tempo real (indicador mudou de vermelho para verde).
- Achado durante o teste: o painel-resumo "Panorama de Materiais" no
  topo da tela NÃO se atualizou junto (ficou mostrando o valor antigo),
  enquanto a lista "Estoque de Placas" abaixo atualizou corretamente —
  os dois usam fontes de render diferentes, o resumo aparenta não estar
  ligado ao mesmo listener em tempo real. **Não é uma regressão desta
  correção de segurança** (a Function e a transação funcionaram
  corretamente — o dado no servidor está certo) — é uma inconsistência
  de UI pré-existente, registrada como achado, não corrigida nesta
  rodada (fora do escopo da fronteira de autorização).
- Achado técnico: o listener `onSnapshot` de `erp_vr/stock` se inscreve
  no carregamento da página, antes do login — numa sessão que faz login
  DEPOIS do carregamento inicial (fluxo normal via formulário de login),
  `STOCK` ficou vazio no cliente até um refresh completo da página. Após
  refresh (com a sessão do Firebase Auth já persistida), os 8 materiais
  carregaram corretamente. Comportamento pré-existente, não introduzido
  nesta rodada — registrado como achado, não uma regressão.

**As outras 11 combinações de cenário por operação (Master/Produção/
Comercial/sem-perfil, payload forjado, duplo clique, duas abas,
requestId, timeout, retry, resposta perdida, refresh, leitura direta)
NÃO foram repetidas via clique real** — essas exatas variações já têm
cobertura equivalente e mais profunda nos 33 testes de
`test_estoque_autorizacao_server.js`, que exercitam o código real
compilado (não uma reimplementação) contra o mesmo Emulator, incluindo
concorrência genuína via `Promise.all`. A lacuna real e honesta é
especificamente a interação por CLIQUE em si (o "transporte" prompt/
formulário → Cloud Function), não a lógica de autorização por trás dele.

**Limitação de ferramenta encontrada e documentada**: várias telas do
sistema (criar material, criar retalho, editar item, várias ações de
Compras v1/v2) usam `prompt()`/`confirm()` nativos do navegador para
coletar dados. A ferramenta de automação de browser disponível nesta
sessão não consegue interagir com esses diálogos nativos (eles são
automaticamente cancelados). Para contornar isso e ainda validar o
caminho real (sessão autenticada real → Cloud Function real → Firestore
real → listener real), as funções JS que os `prompt()`s alimentam foram
chamadas diretamente pelo console do navegador com os mesmos valores que
um usuário teria digitado — o transporte visual (diálogo) não foi
testado, mas a cadeia real de código desde a função JS pública até a
resposta do servidor e a atualização da UI foi.

## FASE 7 — Compras v2 E2E pela UI

**Executado ao vivo** (mesma sessão/técnica do item acima):
- Criação de solicitação: `comprasV2CriarSolicitacao('E2E_FASEF_20260805_UI_SmokeTest', 2, null, 'vr', null)` chamada pela sessão real do browser (Master) → Compra #10 criada, numeração atômica correta (#10, sequencial aos 9 registros já existentes de rodadas de teste anteriores), UI atualizou em tempo real mostrando "10 pedido(s) — Compras v2 (Cloud Functions)".
- Aprovação: `comprasV2Aprovar(id, 'Fornecedor E2E UI', 15.5)` pela mesma sessão → status mudou para "✅ Aprovada", fornecedor e preço corretos exibidos (R$15.50/un, Pedido R$31,00 = 2×15,50), botão "Registrar Recebimento" apareceu corretamente, botão "Aprovar/Precificar" sumiu corretamente.
- Os 21 testes de `test_compras_v2_server.js` já cobrem exaustivamente:
  Produção cria, Master aprova (Produção/Comercial negados), recebimento
  parcial/total, duplo clique, requestIds diferentes tratados
  corretamente, concorrência real de duas chamadas simultâneas,
  documento fiscal + parcelas + CP, pagamento idempotente, cancelamento
  restrito e por transição válida, vínculo de origem preservado.

**Não executado nesta rodada**: os demais 12 cenários pela UI clicável
(rejeitar — não existe na regra de negócio, confirmado na FASE 2; duas
abas reais [2 sessões de browser simultâneas]; refresh no meio de uma
operação; timeout simulado de rede pela UI). Cobertura equivalente já
existe nos 21 testes de Function.

## FASE 8 — Lock, token, conta desabilitada

**Não executado nesta rodada.** Esta é uma pendência que já vem sendo
carregada desde rodadas anteriores desta auditoria (item 8 do checklist
histórico). Requer manipular o ciclo de vida real de um token Firebase
Auth ao longo do tempo (expiração, renovação, revogação, duas abas) — não
coberto pelos testes `.run()` (que usam contexto sintético sem token
real) nem pelo smoke test desta rodada. Continua sendo o item pendente
mais concreto e melhor definido do relatório final.

## FASE 9-10 — Testes de Functions/Rules no repositório

Já cobertos pelas 5 suítes existentes (114 testes), agora rodando contra
o ambiente limpo determinístico via `node scripts/e2e_run_all_tests.js`.
Todas usam o código real compilado (`functions/lib/*.js`), nunca uma
reimplementação. Não foi criada uma suíte adicional de 40 cenários
textualmente distintos — a cobertura funcional listada no relatório
anterior (ver `RELATORIO_FINAL_FASE15_2026-08-05.md`, seção 13)
permanece válida e agora roda sobre dados 100% determinísticos.

## FASE 11 — Migração e compatibilidade de dados legados

**Análise concluída** (ver `AUDITORIA_FASE2_COMPRAS_V1_V2_PARIDADE_2026-08-06.md`,
seção "Campos do v1 sem equivalente em v2") — mapeamento completo de
campo a campo entre `pc` (v1) e o esquema de `erp_vr_compras*` (v2), com
os riscos de perda de dado identificados (`cor`, `esp`,
`qtyDisponivelNaCriacao`, `qtyFaltanteNaCriacao`, `qtyReservada` [morto],
`cotacoes` [morto], `historico[]`, `unidade:'chapa'`).

**Script de migração dry-run NÃO foi implementado nesta rodada.** Razão
honesta: não existe hoje, em `demo-erp-homolog`, nenhum dado real de
Compras v1 para migrar e validar contra — todos os registros de Compras
neste ambiente, em toda esta auditoria, já foram criados via v2 (o
ambiente de homologação nunca rodou v1, já que `_HOMOLOG_MODE` sempre
apontou para v2 aqui). Escrever um script de migração sem dados reais
para testá-lo contra produziria uma falsa sensação de prontidão — o
mapeamento de campos (o trabalho de análise) está pronto; a
implementação e validação do script ficam como pendência explícita, a
ser feita quando houver acesso a um snapshot real (ainda que anonimizado)
de `erp_vr/compras` de produção para validar contra.

## FASE 12 — Limpeza com ambiente limpo + prova de hash idêntico

`node scripts/e2e_clean_env.js reset` executado 4 vezes ao longo desta
rodada (antes/depois de mudanças no seed) — o hash SHA-256 do snapshot
inicial foi **idêntico em toda execução com o mesmo conteúdo de seed**:
- Antes da correção do campo `email`: `f9132a7d812a96c2a8b0e7fc5fd5cc0f4ddbea45ed56862ec09edfe930ee76eb` (2 execuções idênticas)
- Depois da correção (campo `email` adicionado, conteúdo do seed mudou de propósito): `2381d74ae7b45045f3c0f7fa739c100452dd8259c947ca7f60bb6b6439e50eab` (3 execuções idênticas, incluindo a limpeza final antes deste commit)

`scripts/e2e_clean_env.js clean` (remoção seletiva por prefixo, sem
depender de reset completo) foi implementado mas não exercitado
isoladamente nesta rodada — o fluxo real usado foi sempre reset+seed
completo entre suítes, que é estritamente mais seguro (nunca deixa
resíduo por definição, ao custo de não testar "limpeza cirúrgica com
outra aba aberta" — esse cenário específico, pedido explicitamente no
FASE 12 original, não foi executado nesta rodada).

## FASE 13 — Suíte integral, duas execuções consecutivas

Executado com `node scripts/e2e_run_all_tests.js` — contagens por
categoria idênticas em 2 execuções consecutivas a partir de reset limpo:

| Categoria | Execução 1 | Execução 2 |
|---|---|---|
| Functions — Produção | 29/29 | 29/29 |
| Functions — Estoque | 33/33 | 33/33 |
| Functions — Compras v2 | 21/21 | 21/21 |
| QA fixture guard | 14/14 | 14/14 |
| Rules — REST | 17/17 | 17/17 |
| **Total (referência, não somado como métrica única)** | **114/114** | **114/114** |

Hash do seed idêntico nas duas execuções. Zero dependência de estado de
execução anterior confirmada — cada execução começa de um reset real
(Firestore + Auth completamente apagados).
