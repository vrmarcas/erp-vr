# Guia Rápido — ERP VR Marcas + Catálogo Vitre (2026-08-06)

## 1. Como acessar

`https://erp-vrmarcas.web.app` — mesmo endereço de sempre. Faça login
com seu e-mail e senha cadastrados.

## 2. Perfis

- **Master** — acesso total, inclui cadastro de usuários, configurações.
- **Comercial** — orçamentos (VR e Vitre), CRM, clientes.
- **Produção** — estoque, OS, ficha técnica.
- **Financeiro** — DRE, contas a pagar/receber, relatórios.

Cada perfil só vê e edita o que faz sentido pra ele — se um botão não
aparece ou dá erro de permissão, é o esperado, não é bug.

## 3. Criar cliente

Menu → CRM → Novo Cliente. Preencha nome e telefone no mínimo.

## 4. Orçamento VR (produto sob medida)

Menu → Novo Orçamento → **Personalizado — VR Marcas**. Fluxo de
sempre: cliente, itens/planificação, envio, pagamento → gera OS.

## 5. Orçamento Vitre (produto do catálogo)

Menu → Novo Orçamento → **Catálogo — Vitre**. Novo fluxo:
1. Nome e telefone do cliente.
2. Buscar produto por nome ou SKU — os produtos já cadastrados
   aparecem automaticamente (110 produtos importados hoje).
3. Adicionar item, ajustar quantidade.
4. Desconto/frete se precisar.
5. Salvar rascunho → gera PDF e mensagem de WhatsApp com a marca
   Vitre (logo, cores e dados da Vitre — nunca misturado com VR).
6. Quando o cliente confirmar, use **"🏭 Converter em OS"** no
   histórico do orçamento — o sistema decide sozinho se é peça pronta,
   se precisa produzir, ou se falta cadastro (ver item 11 abaixo).

## 6. Pesquisar catálogo

Menu → Catálogo Vitre. Busca por nome/SKU, filtro por status/categoria
e por nível de cadastro.

## 7. Produtos incompletos

Botão **"📋 Cadastros incompletos"** no topo do Catálogo Vitre mostra
exatamente quais produtos ainda precisam de dado (peso, embalagem,
descrição, foto, categoria) e o que falta em cada um. Um produto
incompleto ainda pode ser orçado — só não fica disponível pra Valéria
oferecer sozinha nem pra gerar OS automática enquanto faltar dado.

## 8. PDF

Botão de PDF em cada orçamento (VR ou Vitre) abre uma nova aba pronta
pra imprimir/salvar. Confira sempre a logo e os dados antes de mandar
pro cliente.

## 9. WhatsApp

Botão de WhatsApp monta a mensagem automaticamente e abre o WhatsApp
Web/App já com o texto pronto — você só confere e envia.

## 10. Converter para OS

No histórico de orçamentos Vitre, "🏭 Converter em OS" classifica cada
item automaticamente:
- **📦 Pronta entrega** — já tem estoque de peça pronta, dá baixa e
  segue pra expedição.
- **🏭 Produzido após o pedido** — não tem estoque pronto mas tem
  ficha técnica completa, gera OS de produção.
- **⚠️ Ficha incompleta** — não tem estoque nem ficha técnica
  suficiente. **Nada é feito automaticamente** — aparece o motivo
  exato, e alguém precisa completar o cadastro antes de converter.

Se **qualquer** item do orçamento cair em "ficha incompleta", a
conversão inteira é bloqueada (nenhuma peça é baixada, nenhuma OS
parcial é criada) — resolva o item incompleto e tente de novo.

## 11. Estoque

Sem mudança de uso — as telas de estoque continuam as mesmas. Por
trás, agora toda gravação passa por validação no servidor (mais
seguro, sem mudar o que você vê na tela).

## 12. Compras v2

Fluxo de sempre — solicitar, aprovar, receber, pagar. Agora é o único
fluxo oficial (o antigo foi desativado).

## 13. O que NÃO alterar

- Não edite `assets/`, `functions/`, `scripts/` ou qualquer arquivo
  técnico diretamente — fale com quem administra o sistema.
- Não tente resolver um conflito de SKU sozinho — 4 produtos da
  planilha original ainda aguardam decisão (já resolvidos nesta
  rodada, mas se aparecer um caso novo, avise).
- Não desative o próprio usuário nem mude sua própria função.

## 14. Como reportar erro

Anote: seu perfil, a tela onde aconteceu, o que você tentou fazer, e
se possível um print da mensagem de erro. Mande pra quem administra o
sistema — não tente "consertar" mexendo em configurações.

## 15. Procedimento de contingência

Se o sistema ficar fora do ar ou algo parecer muito errado (dado
sumindo, valor errado, duplicidade), **pare de usar aquela tela
imediatamente** e avise quem administra — pode ser algo que precisa de
rollback rápido, e continuar usando pode complicar a correção.
