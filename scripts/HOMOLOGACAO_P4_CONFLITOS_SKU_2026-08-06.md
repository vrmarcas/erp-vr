# Parte 4 — Conflitos de SKU da Planilha Real — DECISÕES APROVADAS (GO-LIVE 2026-08-06)

**Atualização GO-LIVE:** as 4 decisões abaixo foram aprovadas
explicitamente pelo usuário na instrução de go-live de 2026-08-06 e
aplicadas em `scripts/vitre_importar_planilha.js` e
`vitreCatImportNormalizarLinha` (index.html) via mapa
`SKU_DECISOES_APROVADAS` (chave = SKU original + nome exato do
produto). Novo dry-run confirmado: **110/110 linhas válidas, zero
conflito de SKU**, avisos não-bloqueantes preservados (ver
`scripts/HOMOLOGACAO_P5_AVISOS_PLANILHA_2026-08-06.md` para a contagem
original — a contagem sobe de 86 para 93 porque as 8 linhas antes
bloqueadas agora contribuem seus próprios avisos de campo ausente,
diferença 100% explicada, nenhuma linha nova nem dado inventado).

---

## 1. SKU `CPC001`

| Campo | Produto 1 (linha 22) | Produto 2 (linha 29) |
|---|---|---|
| Nome | Caixa Porta chás | Cubo Porta Cápsulas |
| Dimensões (C×L×A cm) | 25 × 15 × 9,5 | 15 × 15 × 15,5 |
| Espessura | 4mm | 4mm |
| Custo | R$ 40,41 | R$ 27,00 |
| Preço de venda | R$ 210,00 | R$ 140,00 |
| Embalagem | 28×18×16 | 20×20×20 |
| Peso | 2 kg | 2,5 kg |
| Descrição | "Caixa para sachês de chá, desenvolvido em acrílico cast cristal 4mm, com 6 nichos e tampa articulada" | "O Cubo Porta Cápsulas é uma peça clean que oferece elegância e praticidade para o seu espaço do café..." |

**Sugestão:** `CPC001` permanece com Caixa Porta-chás (produto 1) · `CPCAP001` para Cubo Porta Cápsulas (produto 2).
**Decisão humana:** ✅ aprovada e aplicada (GO-LIVE 2026-08-06)

---

## 2. SKU `MLP001`

| Campo | Produto 1 (linha 39) | Produto 2 (linha 40) |
|---|---|---|
| Nome | Mesa Lateral Pescara | Mesa Lateral Potenza |
| Dimensões (C×L×A cm) | 30 × 40 × 50 | *(ausente na planilha)* |
| Espessura | 10mm | *(ausente)* |
| Custo | R$ 258,90 | R$ 253,00 |
| Preço de venda | R$ 1.250,00 | R$ 998,00 |
| Embalagem | 70×50×50 | *(ausente)* |
| Peso | *(ausente)* | *(ausente)* |
| Descrição | "Mesa lateral, desenvolvido em acrílico cast cristal 10mm." | *(ausente)* |

**Sugestão:** `MLP001` permanece com Mesa Lateral Pescara (produto 1) · `MLPT001` para Mesa Lateral Potenza (produto 2).
**Observação adicional:** produto 2 (Potenza) já está bem abaixo do nível
mínimo de completude mesmo depois de resolvido o conflito de SKU — falta
dimensões, embalagem, peso e descrição (ver Parte 5).
**Decisão humana:** ✅ aprovada e aplicada (GO-LIVE 2026-08-06)

---

## 3. SKU `MLR001`

| Campo | Produto 1 (linha 41) | Produto 2 (linha 42) |
|---|---|---|
| Nome | Mesa Lateral Ragusa | Mesa Lateral Rennes |
| Dimensões (C×L×A cm) | 55 × 46 × 40 | 50 × 40 × 55 |
| Espessura | 5mm | 10mm |
| Custo | R$ 306,10 | R$ 237,00 |
| Preço de venda | R$ 1.600,00 | R$ 1.175,00 |
| Embalagem | *(ausente)* | 70×50×50 |
| Peso | *(ausente)* | 8,5 kg |
| Descrição | "Mesa lateral, desenvolvido em acrílico cast cristal 5mm e 8mm." | "Mesa desenvolvida em acrílico cast cristal 10mm. Móvel lindo para decorar sua sala..." |

**Sugestão:** `MLR001` permanece com Mesa Lateral Ragusa (produto 1) · `MLRE001` para Mesa Lateral Rennes (produto 2).
**Decisão humana:** ✅ aprovada e aplicada (GO-LIVE 2026-08-06)

---

## 4. SKU `PPCI001`

| Campo | Produto 1 (linha 105) | Produto 2 (linha 107) |
|---|---|---|
| Nome | PLACA PET CÃOZINHO | PLACA PET CATS |
| Dimensões (C×L cm) | 35 × 22 | 40 × 40 |
| Espessura | 3mm | 3mm |
| Custo | R$ 37,97 | R$ 65,00 |
| Preço de venda | R$ 314,00 | R$ 412,00 |
| Descrição | "Aço Carbono 3mm" | "Aço Carbono 3mm" |

**Nota:** a descrição "Aço Carbono 3mm" para ambos parece incorreta/genérica
para um produto de acrílico — provável erro de preenchimento na planilha
original (copy-paste de outra linha). Preservado literalmente, sem
correção silenciosa, conforme instrução de nunca alterar dado comercial
sem decisão humana.
**Sugestão:** `PPCI001` permanece com Placa Pet Cãozinho (produto 1) · `PPCAT001` para Placa Pet Cats (produto 2).
**Decisão humana:** ✅ aprovada e aplicada (GO-LIVE 2026-08-06)

---

## Teste de fixture (prova de que a resolução funciona — nada gravado no catálogo real)

`scripts/test_vitre_sku_conflitos_fixture.js` — usa SKUs sintéticos
prefixados `E2E_SKUFIX_` (nunca os SKUs reais `CPC001`/`MLP001`/`MLR001`/
`PPCI001`) para provar, de forma isolada e sem tocar no catálogo real, que:
1. As duas linhas conflitantes originais (mesmo SKU) continuam bloqueadas
   pela Function real.
2. Se renomeadas para os SKUs sugeridos (usando o mesmo par de dados, mas
   com prefixo de teste), ambas importam com sucesso, sem conflito.

Isso prova a solução tecnicamente **sem aplicá-la** — a aplicação real
exige a confirmação humana marcada acima.
