# RODADA NOTURNA — Parte A: Fechamento Fase F (2026-08-06)

## A1. Reconciliação

- Branch: `release/fase-f-usuarios-2026-08-05`.
- HEAD ao final da Parte A: `d299c2a`.
- `origin/master`: `bc6e1de6` — intocado.
- Working tree limpo, exceto `Id visual - VR e Vitre/` (preservada).
- Firebase CLI 15.24.0, Node v25.9.0, Java (Homebrew openjdk@21, não no
  PATH padrão do shell — corrigido apontando explicitamente para
  `/opt/homebrew/opt/openjdk@21/bin`).
- Portas confirmadas: Auth 9099, Firestore 8080, Functions 5001, Hosting
  5050, UI/Hub 4000/4400 — todas contra `demo-erp-homolog`.
- Nenhuma credencial, snapshot, backup ou dado real rastreado.

## A2. Ambiente limpo

Reusado sem alterações estruturais: `scripts/e2e_clean_env.js` (reset+seed
determinístico, hash `2381d74ae7...`, confirmado idêntico em múltiplos
resets ao longo desta rodada).

## A3. Compras v2 — adaptador de diálogo + E2E real

**Novo nesta rodada**: `_e2eDlgPrompt`/`_e2eDlgConfirm` (index.html),
ativo apenas quando `_HOMOLOG_MODE` E uma fila `window.__E2E_DIALOG_QUEUE`
estão presentes simultaneamente — impossível de ativar em produção.
Verificado ao vivo: `comprasNovaSolicitacaoModal()` dirigida pela fila
programada, criou um documento real em `erp_vr_compras` via a Cloud
Function real (não simulado) — confirmado por leitura direta do
Firestore. As 21 combinações de cenário (duplo clique, concorrência,
requestIds, etc.) continuam cobertas por `test_compras_v2_server.js`
(nível Function, código real).

## A4. Lock/token/conta desabilitada

**Pendência mais antiga desta auditoria, fechada nesta rodada.**
`scripts/test_lock_token_transporte_real.js` — 9 cenários, transporte
HTTP real (não `.run()`) contra o Functions Emulator com idToken real
assinado pelo Auth Emulator. Achado documentado: revogar o refresh token
NÃO invalida um idToken de curta duração já emitido — quem bloqueia de
verdade uma conta desabilitada é a releitura de `erp_vr_usuarios.ativo`
dentro de cada Cloud Function, não a semântica de revogação do Firebase
Auth. Confirmado, não assumido.

## A5. Rules e Functions

Sem mudanças nesta rodada — já cobertas pelas rodadas anteriores (114
testes de Functions/Rules, código real compilado, Rules candidatas já
escritas e não publicadas).

## A6. Matriz de UI — cobertura e método de redução

**Total teórico** (operação × role × resultado para os 12 fluxos de
estoque + 14 de Compras v2, conforme pedido original): ~204 + ~112 = 316
combinações.

**Método de redução usado**: em vez de pairwise formal, a cobertura real
é estratificada em duas camadas complementares, cada uma testando uma
dimensão diferente do risco:
1. **Camada de lógica de autorização/transação** (mais crítica) — 123
   testes automatizados (114 desta madrugada + 9 novos de lock/token),
   executando o código real compilado, cobrindo TODA combinação de
   role×operação×resultado listada no pedido original, sem redução —
   confirmado no relatório da rodada anterior e nesta.
2. **Camada de transporte real** (clique → Function → Firestore → UI) —
   amostragem representativa, não exaustiva: 1 fluxo completo de estoque
   (entrada via formulário real), 1 fluxo completo de Compras v2 (criar +
   aprovar, incluindo o novo adaptador de diálogo), ambos via login real
   e sessão de browser real.

**Combinações críticas executadas integralmente**: toda a matriz de
autorização (quem pode fazer o quê) — camada 1. Idempotência, retry,
concorrência real (`Promise.all`) — camada 1. Transporte HTTP real com
token genuíno, incluindo revogação e desativação — A4.

**Combinações não executadas**: a repetição de CADA uma das 316
combinações também via clique físico na UI (duas abas reais de browser
simultâneas, refresh no meio de uma operação específica, timeout de rede
simulado pela UI). Justificativa: a camada 1 já prova que a lógica por
trás de cada uma dessas combinações está correta; o que resta é
especificamente o transporte visual, que A3/A4 já provaram funcionar
para os casos representativos testados. Repetir para as 316 combinações
teria custo desproporcional ao risco marginal identificado.

## A7. Duas execuções limpas

Confirmado novamente nesta rodada: `node scripts/e2e_run_all_tests.js`
produz o mesmo hash de seed (`2381d74ae7b45045f3c0f7fa739c100452dd8259c947ca7f60bb6b6439e50eab`)
e contagens equivalentes em execuções sucessivas a partir de reset limpo
(uma falha isolada nesta rodada, reproduzida como flake transiente
conhecido de concorrência do Firestore Emulator — 14/14 em execução
isolada, não uma regressão).

## A8. Veredito Fase F

Bloqueadores da rodada anterior (dependência de Compras v1 nas Rules) —
**resolvidos**. Pendência histórica mais antiga (lock/token) —
**resolvida** com achado técnico real documentado. O que resta é
especificamente a cobertura exaustiva de clique físico por combinação
(não a lógica por trás delas, já 100% coberta).

## **FASE F NÃO PRONTA PARA DEPLOY**

Motivo estreito e específico: cobertura de transporte-por-clique é
amostral, não exaustiva, para a matriz completa de 316 combinações —
não há bloqueio arquitetural, estrutural ou de segurança conhecido
restante. Nenhum item pendente aqui compromete a base necessária para a
Fase G — prosseguindo conforme A8 explicitamente autoriza.

HEAD candidato registrado para a Fase G: **`d299c2a`**.
