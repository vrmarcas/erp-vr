# Parte 5 — Relatório Agrupado dos 86 Avisos da Planilha Real

## Números reais (recalculados nesta rodada, não assumidos)

A planilha real tem **86 avisos não-bloqueantes**, distribuídos em
**apenas 3 tipos reais** (mais os 4 conflitos de SKU já cobertos na Parte
4, que também contam nos 86 mas têm tratamento próprio):

| Tipo de aviso | Ocorrências | % do total |
|---|---|---|
| `peso_ausente` | 36 | 41,9% |
| `embalagem_ausente` | 27 | 31,4% |
| `descricao_ausente` | 19 | 22,1% |
| `sku_duplicado_conflitante` | 4 | 4,7% (já detalhado na Parte 4) |
| **Total** | **86** | 100% |

**Nenhuma outra categoria existe nos dados reais** — não há
`preco_ausente`, `custo_ausente`, `dimensoes_ausentes`, espessuras
múltiplas nem inconsistência de unidade nesta planilha específica (todos
os 102 produtos válidos já têm preço, custo e ao menos uma dimensão
preenchidos). O relatório abaixo reflete os dados reais, não uma lista
teórica de tipos possíveis.

## Classificação por tipo

### `peso_ausente` (36 produtos)
- **Obrigatório para venda manual básica?** Não — nível 1 (venda manual no
  ERP) não exige peso.
- **Obrigatório para Valéria?** Indiretamente sim — a Valéria só oferece
  produtos com nível de completude ≥ 2, e nível 2 exige peso preenchido.
- **Obrigatório para produção automatizada?** Não diretamente (produção
  usa ficha técnica, nível 4, campo separado) — mas afeta cálculo de
  frete/expedição em uma futura integração com transportadora.
- **Classificação final:** opcional para venda manual · **obrigatório
  para nível 2 (portanto para elegibilidade Valéria)**.

### `embalagem_ausente` (27 produtos)
- Mesmo padrão de `peso_ausente`: campo de nível 2, não bloqueia venda
  manual, bloqueia elegibilidade Valéria indiretamente.
- **Classificação final:** opcional para venda manual · obrigatório para
  nível 2 (Valéria).

### `descricao_ausente` (19 produtos)
- **Obrigatório para Valéria?** Sim, **diretamente** — a Function
  `produtoElegivelValeria()` (`functions/src/valeria_vitre.ts`) verifica
  `!!p.descricaoCurta` explicitamente, independente do nível calculado.
- **Obrigatório para venda manual?** Não — nível 1 não exige descrição,
  Comercial pode orçar sem ela.
- **Classificação final:** opcional para venda manual · **obrigatório
  para Valéria (checagem direta, não só via nível)** · obrigatório para
  nível 2.

### `sku_duplicado_conflitante` (4 produtos)
- **Classificação final:** precisa de decisão humana — ver Parte 4
  (relatório dedicado, com sugestão de novo SKU por par).

## O que NÃO apareceu (e por quê)

- **Ficha técnica de produção (nível 4)** — a planilha real não tem
  colunas para componentes/material por componente/tempo de corte/arquivo
  de corte. Nenhum dos 102 produtos importados chega ao nível 4 só pela
  importação — isso é esperado e correto: ficha técnica é sempre
  preenchimento manual posterior, nunca inferido da planilha comercial.
- **Espessuras múltiplas por produto** — o campo `espessuraMm` na
  planilha real é um valor único por linha; produtos com mais de uma
  espessura possível (ex.: "Mesa lateral 5mm e 8mm", visto na descrição
  textual do conflito MLR001) têm isso só na descrição textual, não como
  dado estruturado — fica registrado aqui como limitação do formato da
  planilha, não avaliado como aviso automático nesta rodada.

## Painel "Cadastros Incompletos" — implementado na tela Catálogo Vitre

Novo filtro/seção na tela Catálogo Vitre (`vitreCatalogoRender`,
`index.html`) mostrando, para cada produto abaixo do nível 2, exatamente
quais campos faltam (não só o nível numérico) — implementado nesta
rodada, verificado ao vivo contra os 102 produtos reais importados.

## Achado adicional (real, verificado ao vivo, não estava nos 86 avisos)

**Os 102 produtos importados estão TODOS no nível 1** — nenhum chega ao
nível 2 hoje, porque `categoria` e `fotos` nunca são preenchidos pela
importação (a planilha real não tem colunas para eles, e o importador
não emite nenhum aviso `categoria_ausente` ou `fotos_ausentes` — só
verifica preço/custo/dimensões/peso/embalagem/descrição). Isso significa
que, mesmo depois de resolver os 86 avisos "oficiais" + os 4 conflitos de
SKU, **nenhum produto ficaria elegível para a Valéria** sem que
Categoria e ao menos uma foto sejam preenchidos manualmente — trabalho de
cadastro humano que a planilha comercial atual não cobre e que o
importador hoje não sinaliza como pendência. Painel "Cadastros
incompletos" confirmado ao vivo: 102 de 102 produtos listados, todos com
"categoria" e "fotos" entre os campos faltantes.

**Recomendação (não implementada nesta rodada, decisão de produto):**
adicionar `categoria_ausente` e `fotos_ausentes` à lista de avisos do
importador, para que este gap apareça no relatório de importação em vez
de só no painel do catálogo depois de já importado.
