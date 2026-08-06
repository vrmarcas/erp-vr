# Parte 9 — OS do Produto Vitre (pronta entrega / produzido / ficha incompleta)

## O que foi implementado nesta rodada (feature nova, não existia antes)

Nova Cloud Function `vitreConverterOrcamentoParaOS`
(`functions/src/vitre.ts`), nova coleção `vitre_os` (documento-por-OS,
nunca array agregado), novo campo `estoqueProntoUnidades` em
`vitre_produtos`, novo botão "🏭 Converter em OS" na tela de Orçamento
Vitre (visível só para Comercial/Master, mesma fronteira de quem pode
ler `vitre_orcamentos`).

## Classificação por item (lida no momento da conversão, nunca no
momento em que o orçamento foi salvo — produção pode ter mudado a
ficha técnica ou o estoque depois)

| Caminho | Condição | O que acontece |
|---|---|---|
| **Pronta entrega** | `estoqueProntoUnidades` do produto ≥ quantidade pedida | Baixa de estoque (transação), sem gerar ficha de produção nova. OS marcada `pronta_expedicao` (ou `mista_aguardando_producao` se outro item da mesma OS for produzido). |
| **Produzido após o pedido** | Sem estoque pronto suficiente, mas `fichaTecnica.componentes` E `arquivoCorte` cadastrados | OS gerada com **snapshot** da ficha técnica e do arquivo de corte (caminho/versão/checksum) — o arquivo é só **referenciado**, nunca aberto/executado pela conversão. OS marcada `aguardando_producao`. |
| **Ficha incompleta** | Nem estoque pronto nem ficha técnica completa | **Nada é automatizado.** Nenhum material, tempo ou arquivo é inventado. O item é devolvido com `motivoBloqueio` explicando exatamente o que falta. |

## Fail-closed por design — a exigência mais importante da instrução

Se **qualquer** item do orçamento cair em `ficha_incompleta` (ou o
produto tiver sido removido do catálogo depois do orçamento), a
conversão inteira é **bloqueada**: nenhuma OS é criada, nenhum estoque
é baixado — nem mesmo dos itens que estariam prontos. Testado
explicitamente (teste 4 da suíte, ver abaixo) com um item pronto +
um item incompleto no mesmo orçamento: confirmado que o estoque do
item bom **não** foi tocado quando a conversão foi bloqueada pelo item
ruim.

## Verificação — testes automatizados (Functions reais, Firestore Emulator real)

`scripts/test_vitre_os_server.js` — **12/12 passando**:
1. Pronta entrega — estoque baixado, OS `pronta_expedicao`.
2. Produzido após pedido — ficha técnica copiada por snapshot, arquivo
   de corte referenciado (não executado), OS `aguardando_producao`.
3. Ficha incompleta — bloqueado, motivo explicado, orçamento continua
   `rascunho`, nenhuma OS vinculada.
4. **Fail-closed misto** — pronta_entrega + ficha_incompleta no mesmo
   orçamento → bloqueado por inteiro, estoque do item bom preservado.
5. Misto automatizável (pronta_entrega + produzido_apos_pedido) → OS
   `mista_aguardando_producao`.
6. Produto removido do catálogo depois do orçamento → bloqueado,
   `produto_removido`.
7. Orçamento já convertido → segunda conversão negada
   (`ORCAMENTO_EM_ESTADO_FINAL`).
8. Orçamento cancelado → conversão negada.
9. Produção → **negado** (só Comercial/Master convertem — mesma
   fronteira já testada de quem lê `vitre_orcamentos`; Produção nunca
   lê o orçamento comercial de origem, só vê o resultado em `vitre_os`).
10. Master → permitido.
11. Idempotência — mesmo `requestId` duas vezes (duplo clique) → não
    gera segunda OS, não baixa estoque duas vezes.
12. Concorrência — duas conversões do MESMO orçamento simultâneas, sem
    `requestId` compartilhado → exatamente uma sucede (transação relê
    o status do orçamento dentro da própria transação e serializa),
    estoque baixado uma única vez, nunca duplicado.

`scripts/test_vitre_rules.js` — 5 novos cenários para `vitre_os`
(24-28), suíte completa **28/28 passando**: Master/Comercial/Produção
leem, não-autenticado é negado, escrita direta sempre negada (só a
Function grava).

## Verificação ao vivo pela UI real (Emulator, não só terminal)

Login real como Comercial (`authLogin()`), produto de teste semeado
com `estoqueProntoUnidades:5` (via Admin SDK, fora do orçamento
comercial real), fluxo completo:
1. Orçamento Vitre criado pela tela (`vitreOrcSalvar()`).
2. Botão "🏭 Converter em OS" confirmado **visível só para
   Comercial/Master** (mesmo padrão de gating do achado da Parte 7).
3. Clique real no botão (confirmação interceptada via
   `_e2eDlgConfirm`/`__E2E_DIALOG_QUEUE`, mesmo adaptador de diálogo
   já auditado nas rodadas anteriores) → resultado exibido:
   > OS gerada com sucesso!
   > • 1x UI Teste Pronta Entrega — 📦 Pronta entrega
4. Confirmado por leitura direta do Firestore: orçamento
   `status:'convertido'`, `osId` vinculado; `vitre_os/{id}` com
   `status:'pronta_expedicao'`; produto com `estoqueProntoUnidades`
   decrementado de 5 para 4.

## Decisões de escopo (registradas, não pendências ocultas)

- **Nenhum arquivo de corte foi aberto/executado automaticamente**
  nesta rodada — a OS só guarda a referência (`caminho`, `versao`,
  `checksum`); abrir/processar o arquivo continua sendo ação manual de
  quem for cortar, exatamente como pedido.
- **Não integrado ao Kanban/`kb_os` legado da produção VR** (documento
  agregado `erp_vr/kb_os`, fora de escopo desta correção pontual —
  mesma decisão já registrada em `functions/src/producao.ts` para o
  fluxo VR). `vitre_os` é uma coleção nova, documento-por-registro,
  independente — Produção vê a OS Vitre numa consulta própria
  (`vitre_os`), não dentro do Kanban existente. Unificar as duas telas
  de produção (VR e Vitre) numa única visão é decisão de produto fora
  do pedido desta rodada (converter e homologar a conversão), registrada
  aqui para decisão humana futura.
- **`estoqueProntoUnidades` é campo novo, específico da Vitre** — não
  reaproveita o `stock`/`erp_vr_stock_movimentos` de matéria-prima da
  VR (que é outra grandeza: metros de chapa, não unidades de peça
  pronta). Nenhum produto real importado da planilha tem esse campo
  preenchido hoje (a planilha comercial não tem coluna de estoque) —
  ou seja, com os dados reais atuais, **todo item cairia em
  ficha_incompleta ou precisaria de cadastro manual de estoque/ficha
  técnica antes de qualquer conversão real**, que é exatamente o
  comportamento fail-safe pedido.
