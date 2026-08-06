# GO-LIVE Etapa 6 — Importação do Catálogo Vitre em Produção

## Método

Chamada direta (`.run()`) à Cloud Function **já publicada**
`vitreImportarProdutos` (mesma versão exata publicada na Etapa 5),
contra o Firestore real de `erp-vrmarcas`, autenticada via Admin SDK
(sessão gcloud já existente). Identidade de chamador: uma entrada
**temporária e claramente rotulada** em `erp_vr_usuarios`
(`sistema_golive_2026-08-06`, nome "Sistema — Importação Go-Live
2026-08-06 (script administrativo, não é funcionário)"), criada
imediatamente antes da chamada e **removida logo em seguida** —
nenhum funcionário real foi usado, nenhuma conta real foi recriada;
é uma identidade de auditoria de sistema, existente só durante a
própria chamada.

## Dry-run (real, contra produção)

- 116 linhas de dado, 110 não-vazias, **110 criados, 0 conflitos de
  SKU**, 93 avisos não-bloqueantes (`peso_ausente`: 41,
  `embalagem_ausente`: 31, `descricao_ausente`: 20,
  `dimensoes_ausentes`: 1) — **idêntico** ao dry-run mais recente
  contra o Emulator (Etapa 1/Parte 11), confirmando que nada mudou
  entre a verificação e a aplicação real.

## Apply real

- **110 produtos criados** em `vitre_produtos` (produção).
- **0 conflitos de SKU** — as 4 decisões aprovadas (Etapa 1) resolveram
  os 4 pares, confirmado em dados reais.

## Idempotência confirmada duas vezes, contra dados reais

1. Reaplicação com o **mesmo `requestId`** → resposta de
   "já processado" (chave de idempotência), nenhuma escrita nova.
2. Reaplicação com **`requestId` novo** (força a Function a reler cada
   SKU do zero, não só o cache de idempotência) → `criados: 0`,
   `atualizados: 0`, `sem alteração: 110`, mesmos 93 avisos — confirma
   idempotência genuína a nível de SKU, não só de request.

**Contagem final verificada por leitura direta:** `vitre_produtos` =
110 documentos, `vitre_importacoes` = 2 registros de histórico (um por
`--apply`, sem duplicar nenhum produto).

## Produtos incompletos

Todos os 110 produtos permanecem disponíveis para consulta e
orçamento manual (nível de completude ≥ 1, mínimo exigido por
`vitreCriarOrcamento`); nenhum atinge nível 2 ainda (falta
categoria/fotos, que a planilha comercial não cobre — achado já
registrado na Parte 5 da homologação) — portanto nenhum fica elegível
para automação da Valéria ainda, e nenhum tem ficha técnica para OS
automática do tipo "produzido após o pedido". Nenhum produto foi
bloqueado do catálogo por isso — só ficam marcados como incompletos,
exatamente como pedido.
