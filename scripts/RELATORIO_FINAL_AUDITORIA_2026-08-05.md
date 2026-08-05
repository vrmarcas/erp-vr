# Relatório Final — Auditoria PARTE 1-11 (2026-08-05)

Branch `release/fase-f-usuarios-2026-08-05`. Continuação da auditoria de concorrência/`_cloudSave` iniciada no commit `d550066`.

## ⚠️ Achado crítico — leia antes do resto do relatório

**A autorização de estoque negativo por Master NÃO é validada no servidor — apenas no cliente.** Um usuário autenticado como Produção (claim real `role: producao`, verificado ao vivo neste Emulator) conseguiu gravar `stock` com quantidade profundamente negativa (`qty: -996`) reproduzindo exatamente a chamada que `_iniciarTransacaoProducao()` faz quando `prodAutorizado:true` — porque:
- A decisão "sou Master, posso autorizar" (`_souMaster`) é uma variável JavaScript local, nunca reconferida dentro da transação;
- As Firestore Rules liberam `stock`/`kb_os` para qualquer usuário com `role: producao` **sem inspecionar o conteúdo da gravação** (o documento é um blob JSON — Rules não conseguem validar "esta baixa deixou o estoque negativo sem autorização de Master" nesse formato);
- Ou seja: qualquer pessoa com acesso ao console do navegador e uma sessão de Produção pode se autoconceder a exceção que deveria ser exclusiva do Master, sem auditoria, sem justificativa.

Isso **não é o que o item 9 pedia para confirmar** (o fluxo pela UI, com os diálogos `confirm()`, está correto) — é uma descoberta adicional, mais grave, que só apareceu ao testar a fronteira real de autorização, não apenas o caminho feliz da interface. Reproduzido ao vivo, revertido imediatamente (dado de fixture descartável, `e2e_fasef_mat`, nada de produção tocado).

**Correção real exige uma Cloud Function** (mesmo padrão já usado em Compras v2) que reconfirme `request.auth.token.role === 'master'` e a justificativa antes de aceitar uma baixa que deixaria o estoque negativo — não é um ajuste de `_cloudSave`, é uma peça de arquitetura nova. Não implementada nesta rodada (fora do escopo "correção de chamadores de `_cloudSave`", e arriscado demais para ser feito às pressas no fim de uma sessão longa). **Bloqueia o início da Fase 7.**

---

## 1. Commits, HEAD, push

- Branch: `release/fase-f-usuarios-2026-08-05`
- HEAD atual: `d3d5f53`
- `git status`: limpo (exceto a pasta pré-existente `Id visual - VR e Vitre/` e os arquivos `.tmp.js` de extração de teste, ambos não rastreados e esperados)
- 7 commits à frente de `origin/release/fase-f-usuarios-2026-08-05`, 0 atrás — **nada foi enviado ao remoto ainda**:
  1. `44018c1` fix(cloud): chamadores críticos de _cloudSave aguardam e reconciliam
  2. `b7d95b4` test(cloud): regressão unitária (14 testes)
  3. `f8cd662` fix(fin): kbReceberSaldo() atômico via transação única
  4. `f4ee66d` fix(stock): histórico de estoque aguarda e reconcilia
  5. `ec2ff77` fix(orcamento): orcGerarOS() aguarda e reporta falha
  6. `f144672` fix(os): osExcluir() + crmConverterEmOS() (achados adicionais)
  7. `d3d5f53` docs(auditoria): inventário integral
- **Push ainda NÃO recomendado** — ver seção 11 (critério de parada).

## 2. Inventário integral

Entregue em arquivo separado: [`scripts/AUDITORIA_INVENTARIO_CLOUDSAVE_2026-08-05.md`](AUDITORIA_INVENTARIO_CLOUDSAVE_2026-08-05.md). ~70 chamadores, um a um, com classificação e justificativa — nenhum "baixo risco" sem explicação. Resumo:
- 24 corrigidos nesta rodada
- 3 já seguros (`kbConfirmarProd`, `orcSetEnviados`, Compras v2)
- ~25 "seguro mas sem feedback" (justificados individualmente — metadados de CRM, configs de apoio a cálculo, logs)
- 6 explicitamente "não validado — pendente" (não escondidos como seguros)
- Compras v1 (legado) comprovado código morto em `_HOMOLOG_MODE`; 1 declaração de `orcGerarOS` comprovada sombreada/morta

## 3. Atomicidade de `kbReceberSaldo`

Reescrita para transação única do Firestore (kb_os + fin_cr + fin_tx + orcamentos) — commit `f8cd662`. Lê e muta sempre o dado fresco do servidor, nunca a cópia local. 5 testes unitários (`test_kbrecebersaldo_atomicidade.js`) cobrindo os cenários A-E do item 3.

**Confirmado AO VIVO nesta rodada**, duas abas reais (tab-16/tab-17) contra o Emulator, mesma OS fixture (`E2E_FASEF_20260805_Saldo`), disparando `kbReceberSaldo()` quase simultaneamente:
- Resultado no Firestore (leitura direta): exatamente **1** lançamento em `fin_tx`, `kb_os` com `status:'iniciada'`/`restante:0`, `fin_cr` com `status:'recebido'` — sem duplicação, sem estado parcial.

## 4. E2E — Contas a Receber / Contas a Pagar

Confirmado ao vivo contra o Emulator (fixtures `E2E_FASEF_20260805_CR_Duplo` / `E2E_FASEF_20260805_CP_Duplo`):
- **Duplo clique** em `_finCRBaixaConfirmar` (mesma aba, duas chamadas síncronas): exatamente 1 lançamento em `fin_tx`, CR `recebido` — a segunda chamada foi barrada pela guarda `r._baixando`.
- **Duas abas** disputando o mesmo `_finCPPagarConfirmar`: exatamente 1 registro final, `status:'pago'`, valor com centavos preservado (`R$ 12,99`) — sem duplicação.
- **Centavos**: valores fracionários (`33.37`, `12.99`) persistidos corretamente em ambos os testes.
- **Retry após falha**: coberto no nível unitário (`test_fasef_chamadores_criticos.js` CR-2/CP-2) — falha total reverte o estado local, permitindo novo retry sem bloqueio falso.
- **Refresh / resposta atrasada**: não testado ao vivo nesta rodada (tempo) — coberto apenas pelo raciocínio de que o listener em tempo real resincroniza o estado local após qualquer refresh, mesma proteção já provada para o cenário de estoque abaixo.

## 5. E2E — Estoque e OS

Confirmado ao vivo contra o Emulator:
- **`stockSaveData()` detecta conflito real**: aba A congelou seu snapshot (`qty=10`) e `_cloudLastPayload`; aba B gravou `qty=3` de verdade; aba A tentou gravar `qty=9` baseada no snapshot congelado → **recusado com `reason:'conflito'`**; servidor manteve `qty=3` (a mudança de B), confirmado por leitura direta do Firestore.
- **`kbReceberSaldo` duas abas**: ver seção 3.

**Não testado ao vivo nesta rodada** (tempo): criação/edição/exclusão de material via UI real (só via chamada direta de função, não clique na tela), liberação de OS, OS pronta — essas têm cobertura unitária (`test_fasef_chamadores_criticos.js` STK-1 a STK-4) mas não E2E de dois-tabs-na-tela.

## 6. Compras v2

**Não executado ao vivo nesta rodada** (tempo). Mantida a classificação já registrada no inventário (seção 9 do arquivo de inventário): Cloud Functions com `requestId` idempotente, Rules `allow write: if false` nas coleções v2, confirmado por leitura do código-fonte de `functions/src/compras.ts`. **Isso é inspeção de arquitetura, não validação end-to-end — o item 6 pedia explicitamente para não concluir segurança só por isso.** Registrado como pendência real para a próxima rodada: solicitação por Produção, aprovação por Master, Produção tentando aprovar (deve falhar — mas dado o achado da seção "Achado crítico" acima, **não presumir que está protegido sem testar**), duplo clique/duas abas com mesmo e diferentes `requestId`.

## 7. `orcGerarOS` e `crm_leads`

Concluído — ver inventário, seção 6-7. `orcGerarOS` corrigido (commit `ec2ff77`, aguarda os 6 documentos, reverte a criação da OS em falha). `crmConverterEmOS` corrigido (nunca criava OS de verdade, sempre afirmava sucesso — commit `f144672`).

## 8. Lock, token, conta desabilitada

**Parcialmente coberto.** O mecanismo de renovação automática de token (1 retry, nunca mais) já está coberto pela suíte `test_cloudsave_concorrencia.js` (testes 7-8), que prova: token expirado → renova automaticamente 1x → repete a operação; se a renovação falhar, desiste com erro claro, nunca finge sucesso.

**Não testado ao vivo nesta rodada**: duas abas renovando simultaneamente, token revogado/conta desabilitada durante uma operação em andamento, comportamento de UI durante o lock. Fixture de Produção criada nesta rodada (`e2e.fasef.producao@example.com`, mantida para rodadas futuras) prova que múltiplos perfis reais funcionam no Emulator — mas o teste específico de revogação-durante-operação fica pendente.

## 9. Exceção de estoque negativo

**Executado — resultado misto.** O fluxo pela UI (Produção vê prompt de solicitar compra, não pode autorizar; Master vê `confirm()` de autorização + justificativa registrada em `secAuditLog`) está implementado corretamente no código, e a mecânica de auditoria (`secAuditLog('producao_autorizada', ...)`) existe. **Porém, ver "Achado crítico" no topo deste relatório: essa proteção existe só no cliente.** Uma sessão de Produção real, manipulando o payload da transação diretamente (sem passar pela UI), grava estoque negativo sem qualquer autorização de Master, sem justificativa, sem bloqueio do servidor. **Não é uma autorização silenciosa pela UI normal — é uma ausência de validação servidor-side que permite bypass total do controle.**

## 10. Limpeza de fixtures

Confirmado por leitura direta do Firestore ao final da rodada — estado igual ao início da sessão (exceto os 7 materiais de `stock`, ver nota abaixo):

| Documento | Esperado | Confirmado |
|---|---|---|
| orcamentos | 9 | 9 ✅ |
| kb_os | 4 | 4 ✅ |
| fin_cr | 5 | 5 ✅ |
| fin_cp | 0 | 0 ✅ |
| fin_tx | 1 | 1 ✅ |
| compras | 2 | 2 ✅ |
| clientes | 18 | 18 ✅ |
| stock | 7 | 7 (restaurado, ver nota) |

**Nota de transparência — erro próprio cometido e corrigido:** ao criar a fixture de estoque (`e2e_fasef_mat`) para o teste de conflito da seção 5, gravei `stock` a partir de um `STOCK` local que, sem eu verificar antes, estava vazio na aba naquele momento — isso sobrescreveu os 7 materiais reais por um único material de teste. Percebido na limpeza final (contagem de `stock` batendo 0 em vez de 7), restaurado a partir do último snapshot documentado desta mesma auditoria (`incidente_baixa_dupla_estoque_2026-08-05.json`, capturado numa rodada anterior). As quantidades restauradas são as últimas conhecidas e documentadas, não inventadas — mas não há garantia de que sejam bit-a-bit idênticas ao estado imediatamente anterior ao meu erro, já que outras rodadas de teste podem ter alterado quantidades entre a captura do snapshot e agora. Dado tratar-se de dados de Emulator/homologação (nunca produção), o impacto é limitado a testes futuros nesta mesma sessão de Emulator.

Não foi mantida uma aba efetivamente "antiga" (com snapshot pré-limpeza) durante a remoção — as duas abas usadas neste segmento already refletiam o estado corrente por estarem com listeners ativos. O teste de "aba desatualizada não ressuscita fixture" já foi coberto estruturalmente pelo teste de conflito de estoque da seção 5 (mesmo mecanismo).

## 11. Critério de parada

- ✅ Suíte completa: **62/62** (31 produção + 12 concorrência + 14 chamadores críticos + 5 atomicidade), separada por arquivo/categoria, todos verdes.
- ✅ Diff revisado: só `index.html` + 3 arquivos novos de teste/documentação. Nenhuma mudança em Rules, Functions, `firebase.json`, usuários, claims, precificação, Valéria/Chatvolt.
- ⚠️ E2E: substancialmente cobertos (kbReceberSaldo, CR/CP, conflito de estoque) — **não** 100% dos 6 cenários nomeados do item 6 nem a matriz completa do item 8.
- ✅ Zero escrita em produção (`erp-vrmarcas`) — toda a sessão rodou contra `demo-erp-homolog`.
- ✅ Commits isolados (7, um por mudança lógica).
- ❌ **Push**: as condições do usuário ("suíte completa passa + E2E pendentes passam + diff auditado") estão **parcialmente** atendidas — suíte e diff sim, E2E não 100%. Aguardando decisão explícita antes de enviar ao remoto (ver pergunta ao final da mensagem de resposta).
- 🛑 **Fase 7: NÃO recomendada.** O achado crítico da autorização de estoque negativo é, por definição, um "chamador crítico inseguro" (a rigor, uma ausência de validação server-side na mesma família de problemas que toda esta auditoria investiga) e bloqueia o critério do próprio usuário ("só recomendar Fase 7 se não houver chamador crítico inseguro").
