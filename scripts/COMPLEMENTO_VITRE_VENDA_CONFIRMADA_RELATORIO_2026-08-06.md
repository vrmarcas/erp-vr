# Complemento Final do Hotfix Vitre — Envio, Pagamento, Confirmação da Venda e OS
**Data:** 2026-08-06 · **Branch mesclada em:** `master` · **HEAD:** `9096662` · **Deploy:** `erp-vrmarcas` (produção)

## Veredito

## FLUXO VITRE PUBLICADO COM RESTRIÇÕES

O fluxo comercial completo (Cliente → Itens → Envio → Aprovação → Pagamento → Confirmação da Venda → OS) está implementado, testado (117 testes automatizados, 0 falhas) e publicado em produção. A única restrição é a mesma já documentada no hotfix anterior: não foi feito um clique-a-clique autenticado em produção com senha real (proibido pelas regras de segurança desta sessão). A verificação funcional completa foi feita via UI real contra o Firebase Emulator Suite, rodando exatamente o mesmo código que foi publicado.

---

## 1. O que foi pedido

Fechar a lacuna que ficou depois do hotfix de 2026-08-06 anterior: o orçamento Vitre calculava certo e tinha um wizard limpo, mas não havia como completar a venda — faltava marcar como enviado de forma auditável, registrar a resposta do cliente, configurar a condição de pagamento, confirmar a venda (gerando financeiro) e só então liberar a geração de OS.

## 2. Causa raiz do que faltava

Não era um bug — era ausência de funcionalidade. O orçamento Vitre tinha só dois estados úteis para o comercial (`rascunho`, `enviado`) e ia direto para conversão em OS sem nenhuma etapa de aprovação do cliente, pagamento ou confirmação de venda. Não existia:
- Registro estruturado de quando/como/por quem o orçamento foi enviado.
- Registro da resposta do cliente (aprovado/recusado/aguardando/ajuste/cancelado).
- Vínculo entre pagamento e Contas a Receber.
- Um "ponto de não retorno" (confirmar a venda) que gerasse financeiro e travasse duplicidade.
- Um jeito de reabrir um orçamento já enviado para corrigir itens, sem perder o histórico.

## 3. O que foi implementado

### Backend (`functions/src/vitre.ts`)
- **`vitreAtualizarOrcamento`** estendida: `marcarEnviado` (grava `enviadoEm/enviadoPorUid/enviadoCanal/enviadoVersao/enviadoTotalCentavos/enviadoItensSnapshot`), edição de itens restrita a `rascunho`, pagamento agora aceita `formaPagamento` e tipo `futuro`.
- **`vitreIniciarNovaVersao`** (nova): arquiva a versão atual completa em `vitre_orcamentos/{id}/versoes/{n}` e reseta o orçamento para `rascunho` com `versao+1` — permite corrigir um orçamento já enviado sem perder o histórico. Bloqueada a partir de `venda_confirmada`.
- **`vitreRegistrarAprovacaoCliente`** (nova): grava `aprovado/recusado/aguardando_resposta/solicitado_ajuste/cancelado` com canal, observação, versão e total no momento da resposta. Só aceita orçamento `enviado`.
- **`vitreConfirmarVenda`** (nova, peça central): exige orçamento `aprovado` **na versão atual** (rejeita se a versão aprovada divergir da versão vigente — cobre o caso "cliente aprovou, comercial editou depois"), exige pagamento registrado, calcula entrada/saldo em centavos, cria os lançamentos de Contas a Receber no documento compartilhado `erp_vr/fin_cr` (entrada já `recebido`, saldo `pendente`) e marca `status: venda_confirmada` + `statusPagamento` derivado (`pagamento_pendente`/`pagamento_parcial`/`pago`).
  - **Idempotência por chave de negócio**: além do `requestId` (duplo clique), o `status` do orçamento é relido *dentro da transação* — duas confirmações concorrentes com `requestId`s diferentes nunca duplicam a venda; a segunda sempre vê `VENDA_JA_CONFIRMADA`. Verificado com concorrência real (`Promise.allSettled`, 2 confirmações simultâneas → exatamente 1 sucede).
- **`vitreConverterOrcamentoParaOS`**: agora exige `venda_confirmada` (ou um dos status de pagamento) antes de gerar OS — nunca mais gera OS sem venda confirmada. Ao converter, copia `osRef` de volta para os lançamentos de CR.
- **Correção crítica encontrada durante a verificação**: as 3 Functions novas nunca tinham sido adicionadas ao `export` de `functions/src/index.ts` — os testes unitários passavam porque importam direto de `functions/lib/vitre.js`, mas o Functions Emulator (e, portanto, o deploy real) não as enxergava. Descoberto ao testar pela UI real (a chamada retornava 404), corrigido antes do deploy.

### Frontend (`index.html`)
- Estado `VITRE_ORC_ATUAL`, sempre relido do servidor após cada ação (nunca inferido em memória) — cada etapa mostra exatamente os botões válidos para o status atual.
- Etapa Envio: badge de status, botões Salvar/PDF/WhatsApp/Marcar como enviado/Revisar-Nova versão, card "Resposta do Cliente" com os 5 status possíveis.
- Etapa Pagamento: condição (integral/entrada+saldo/parcelado/futuro) + forma de pagamento, resumo final antes de confirmar, botão "Confirmar Venda", e só depois "Gerar Ordem de Serviço".
- Histórico "Orçamentos Vitre recentes" atualizado para os novos status.

## 4. Testes automatizados — 117 passando, 0 falhas

| Suíte | Resultado |
|---|---|
| `test_vitre_venda_confirmada.js` (nova, 17 cenários) | 17/17 ✅ |
| `test_vitre_os_server.js` (12 cenários, ajustada) | 12/12 ✅ |
| `test_vitre_orcamento_hotfix.js` (12 cenários, hotfix anterior) | 12/12 ✅ |
| `test_vitre_catalogo_server.js` (23 cenários) | 23/23 ✅ |
| `test_valeria_vitre_server.js` (25 cenários) | 25/25 ✅ |
| `test_vitre_rules.js` (28 cenários) | 28/28 ✅ |
| **Total** | **117/117 ✅, 0 regressões** |

**Cenário de aceite verificado duas vezes** (testes automatizados + UI real): 2× item R$125,00 + acréscimo fixo R$20/item + 1× item R$195,00 + desconto 10% + frete R$30 = **R$448,50**; entrada R$200,00 + saldo R$248,50 = R$448,50 sem perder um centavo; venda confirmada, CR criado, OS gerada, `crIds` vinculados.

## 5. Verificação via UI real (Firebase Emulator, mesmo código do deploy)

Fluxo completo percorrido clicando na interface de verdade, logado como comercial (`e2e_fasef_20260805_comercial@example.com`):
1. Novo Orçamento → Catálogo Vitre → Cliente preenchido.
2. Item buscado por SKU, quantidade 2, adicionado — subtotal apareceu corretamente (o bug original do hotfix anterior segue corrigido).
3. Desconto 10% + frete R$30 → total R$255,00 calculado certo.
4. Salvar Rascunho → badge "Rascunho" + botões corretos apareceram.
5. Marcar como enviado → badge "Enviado" + card de resposta do cliente apareceu.
6. Registrar aprovação → badge "Aprovado" + botão "Avançar → Pagamento" apareceu.
7. Configurar pagamento Entrada+Saldo (R$100/R$155) via PIX → soma confere, resumo final renderizado com todos os campos.
8. Confirmar Venda → "Venda confirmada — Entrada recebida: R$100,00 · Saldo: R$155,00", condição de pagamento trava para edição.
9. Gerar OS → OS criada com sucesso, histórico mostrou "OS gerada — OS Xtnbqy".
10. Histórico "Orçamentos Vitre recentes" confirmado mostrando corretamente os badges de todos os status (Rascunho/Enviado/Aprovado/Venda confirmada/OS gerada/Cancelado) inclusive para orçamentos criados pelos próprios testes automatizados.

**Achado corrigido durante essa verificação**: depois de gerar a OS pelo próprio wizard (não pelo histórico), o painel da etapa 4 não se auto-atualizava para esconder o botão "Gerar OS" (a lista de histórico, alimentada por listener em tempo real, atualizava certo; só o painel local não). Corrigido chamando `vitreOrcAtualizarEstadoAtual()` após sucesso.

## 6. Deploy

- Build (`tsc --noEmit` + `tsc`) limpo antes e depois da correção do `index.ts`.
- 3 commits isolados (`ba53e4a` backend, `133e0a0` frontend, `cd79a61` testes) → merge `--no-ff` em `master` (`9096662`) → push.
- Deploy cirúrgico em produção (`erp-vrmarcas`):
  - Functions: `vitreAtualizarOrcamento` (atualizada), `vitreConverterOrcamentoParaOS` (atualizada), `vitreIniciarNovaVersao` (nova), `vitreRegistrarAprovacaoCliente` (nova), `vitreConfirmarVenda` (nova) — as 5 publicadas com sucesso.
  - Hosting: `index.html` publicado.
- Nenhuma alteração em Firestore Rules foi necessária: a nova subcoleção `vitre_orcamentos/{id}/versoes/{n}` já cai no catch-all `allow read, write: if false` existente (nenhum `match` explícito a cobre), e só é escrita via Admin SDK (bypassa Rules) — conferido antes do deploy.
- Chatvolt/Valéria: **não tocado nesta rodada**, conforme instrução explícita.

## 7. Smoke test em produção

Sem login com senha real (restrição de segurança já documentada no hotfix anterior, mantida aqui):
- `firebase functions:list` confirma as 5 Functions ativas em produção (`us-central1`, `callable`).
- `curl` no Hosting de produção confirma que `index.html` publicado contém o novo código cliente (`vitreConfirmarVenda`, `vitreIniciarNovaVersao`, `vitreOrcConfirmarVendaAtual`, etc.).
- Logs de produção (`firebase functions:log`) não mostram nenhum erro de execução nas 5 Functions após o deploy.
- Nenhum orçamento real, mensagem real ou venda real foi criada em produção.

## 8. Status do fluxo completo

| Etapa | Status |
|---|---|
| Cadastrar/selecionar cliente | ✅ (já existia, reverificado) |
| Adicionar um ou vários produtos | ✅ (já existia, reverificado) |
| Revisar valores | ✅ |
| Salvar rascunho | ✅ |
| Gerar PDF | ✅ (já existia) |
| Preview WhatsApp | ✅ (já existia) |
| Marcar como enviado | ✅ **novo** |
| Registrar resposta/aprovação do cliente | ✅ **novo** |
| Definir pagamento | ✅ **novo** (integral/entrada+saldo/parcelado/futuro) |
| Confirmar a venda | ✅ **novo** |
| Criar financeiro (Contas a Receber) | ✅ **novo** |
| Gerar OS | ✅ (agora travada até a venda ser confirmada) |
| Acompanhar o status | ✅ **novo** (histórico com badges de todos os status) |

## 9. A Valéria já pode usar o fluxo oficial?

Ainda não é recomendado ativar a Valéria sobre este fluxo nesta rodada — os contratos/Functions stub da Valéria (`valeriaVitre*`) não foram alterados aqui e continuam cobrindo só até a criação do rascunho, não o ciclo de venda completo. Estender a integração da Valéria até confirmação de venda/pagamento é decisão de escopo separada (envolve política de quando um agente pode confirmar uma venda sem supervisão humana) e não estava autorizada nesta rodada.

## 10. Restrições declaradas

1. Sem clique-a-clique autenticado em produção com senha real (mesma restrição do hotfix anterior).
2. Ao reabrir um orçamento em status diferente de `rascunho` a partir do histórico ("Continuar"), a edição continua bloqueada — só é possível revisar via "Revisar / Nova versão" dentro do próprio wizard, na mesma sessão em que o orçamento foi enviado. Resumir a etapa de Envio/Pagamento de um orçamento enviado em uma sessão de navegador diferente não está implementado nesta rodada (não fazia parte do pedido original).
3. Escopo de integração da Valéria com o fluxo de venda completo não avaliado (ver item 9).
