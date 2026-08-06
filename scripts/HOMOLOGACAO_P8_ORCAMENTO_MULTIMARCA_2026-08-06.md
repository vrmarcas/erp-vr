# Parte 8 — E2E Multimarca do Orçamento (VR + Vitre)

## VR — fluxo personalizado (preservado)

**Evidência de que o código não foi tocado nesta rodada de homologação**
(nem nas rodadas NOTURNA anteriores desta branch): diff de
`git diff b9bfad2..HEAD -- index.html` filtrado por definições de
função `orc*`/`orcImprimir*`/`orcEnviarWhatsApp` retorna **vazio** — a
única mudança relacionada foi uma nova CHAMADA a `orcGetResponsavel()`
a partir do código Vitre (`vitreOrcEnviarWhatsApp`), a função em si
não mudou. O fluxo VR (wizard de 5 passos, planificação, PDF de 13
cenários, WhatsApp de 26 cenários, bloqueio de numeração oficial,
persistência de rascunho, refresh, duas abas) já foi homologado
exaustivamente nas Rodadas E.1/E.2 e na matriz pairwise da sessão
NOTURNA (Fase F) — sem alteração de código, essa homologação continua
válida. Não redirigido manualmente pela UI nesta rodada por ser
exatamente o mesmo código já testado.

## Vitre — fluxo de catálogo (novo, E2E real ao vivo nesta rodada)

Executado como Master, login real (`authLogin()`), Emulator real:

1. **Cliente:** nome + telefone preenchidos.
2. **Item:** busca "Aparador Ancona" → autocomplete real (`SKU AA001 —
   R$ 1290.00`) → selecionado → quantidade 2.
3. **Cálculo:** desconto 10%, frete R$ 35,50 →
   subtotal R$ 2.580,00, desconto R$ 258,00, **total R$ 2.357,50**
   (conferido por `vitreOrcRecalcular()` ao vivo).
4. **Validade:** 15 dias.
5. **Salvar (draft → servidor):** `vitreOrcSalvar()` chama a Cloud
   Function real `vitreCriarOrcamento` — grava direto no Firestore com
   `status:'rascunho'` (não é rascunho local-only como o wizard VR;
   cada "salvar" já é uma chamada de servidor autenticada e
   idempotente por `requestId`). Confirmado: documento criado com todos
   os campos corretos, itens armazenados como **snapshot**
   (`nomeSnapshot`/`precoSnapshot`, nunca referência viva ao catálogo).
6. **PDF:** `vitreOrcGerarPDF()` interceptado (o Browser pane não
   permite `window.open` real) e renderizado num iframe — confirmado
   visualmente: logo real da Vitre (dark-teal, verificado na Parte 3),
   CNPJ real `37.855.285/0001-52`, total **R$ 2357.50** idêntico ao
   calculado na tela, **zero menção a custo/margem/markup**, zero
   referência à marca VR.
7. **WhatsApp:** `vitreOrcEnviarWhatsApp()` interceptado — mensagem
   decodificada:
   > Olá, E2E HOMOL P8 Cliente VITRE! Segue o orçamento *Vitre*: · 2x
   > Aparador Ancona — R$ 2580.00 · Desconto: 10% · Frete: R$ 35.50 ·
   > **Total: R$ 2357.50** · Válido por 15 dias. · *Equipe Vitre* ·
   > *Vitre*

   Telefone normalizado corretamente para `5562999991234`. **Total
   idêntico entre tela, PDF e WhatsApp — paridade confirmada.**
8. **Cancelamento:** `vitreAtualizarOrcamento({status:'cancelado'})`
   chamado ao vivo → `status` no Firestore mudou para `cancelado`,
   confirmado por leitura direta do documento.

## Separação de marca — confirmada

- Cores: Vitre usa `corPrimaria:#134F57` (dark-teal); VR usa
  `corPrimaria:#1EB8D8` (cyan) — nunca compartilhadas no mesmo
  template.
- Logo: cada template usa `brandConfigGet('vitre')`/`brandConfigGet('vr')`
  exclusivamente — sem fallback cruzado.
- Contato/CNPJ: mesma pessoa jurídica (`37.855.285/0001-52`,
  endereço, telefone — ver Parte 3), mas e-mail/site/social são
  distintos por marca (`vitre@email.com`/`vitre.com.br`/`@vitre` vs
  `vrmarcas@hotmail.com`/`vrmarcas.com`/`@vrmarcas`) e nunca aparecem
  misturados no mesmo PDF/WhatsApp.
- **Vitre não executa planificação técnica** — confirmado por leitura
  do código-fonte: `vitreCriarOrcamento` (functions/src/vitre.ts:313)
  só lê `precoVenda`/`nome` do produto para o snapshot; nunca lê nem
  grava `fichaTecnica`/componentes/arquivo de corte. Planificação só
  existe no fluxo VR (`orcGerarOS` → Kanban de produção).

## Achados (não-bloqueantes, registrados para decisão humana)

1. **Sem campo de "prazo de entrega" visível no orçamento Vitre** — o
   produto tem `prazoDias` cadastrado no catálogo (usado na
   elegibilidade Valéria), mas essa informação não aparece na tela, no
   PDF nem no WhatsApp do orçamento Vitre. O cliente recebe o orçamento
   sem saber o prazo. Diferente do VR, que tem campo explícito
   (`orcPrazoDias`/`orcPrazoDiasMax`) exibido no orçamento.
2. **Sem etapa de "forma de pagamento" nem conversão em OS para
   Vitre** — o VR tem um passo final "Pgto → OS" (modal com opções
   integral/50-50/parcial/futuro) que gera a Ordem de Serviço após a
   confirmação do pagamento. O fluxo Vitre hoje **para no rascunho
   salvo/PDF/WhatsApp** — não converte em OS. Isto é **esperado nesta
   rodada**: a conversão em OS do produto Vitre é exatamente o escopo
   da Parte 9 (ainda não implementada), não uma regressão.

Ambos os achados alimentam a Parte 9 e ficam registrados como
pendência de produto, não como bug desta parte.
