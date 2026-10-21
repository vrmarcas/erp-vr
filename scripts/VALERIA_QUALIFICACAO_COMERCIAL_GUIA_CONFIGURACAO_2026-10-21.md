# Guia de Configuração Manual Chatvolt — Qualificação Comercial (2026-10-21)

Mesmo padrão dos guias anteriores (`VALERIA_FASE2A_GUIA_CONFIGURACAO_2026-08-10.md`,
`VALERIA_HANDOFF_GUIA_CONFIGURACAO_2026-08-23.md`): o prompt e o schema das
Tools da Valéria vivem no dashboard do Chatvolt, fora deste repositório —
nenhum deploy aplica isso automaticamente. Dois passos manuais, nesta ordem:

## 1. Colar o novo prompt

Copie o conteúdo inteiro de
[`VALERIA_PROMPT_V2_CORPO_PARA_COLAR_2026-09-20.md`](VALERIA_PROMPT_V2_CORPO_PARA_COLAR_2026-09-20.md)
(já reescrito nesta rodada) e cole no campo de instruções do agente no
dashboard do Chatvolt, substituindo o texto atual.

## 2. Adicionar o parâmetro novo na Tool `valeria_update_catalog_qualification`

A Tool já existe e não muda de nome/URL/método — só precisa de UM
parâmetro novo, opcional, do tipo objeto. Nos campos de parâmetro da Tool
no dashboard, adicione:

- **Nome**: `categoryQualificationSignals`
- **Tipo**: `object`
- **Obrigatório**: não
- **Descrição** (cole exatamente ou equivalente): "Sinais específicos por
  tipo de produto (caixa/troféu/placa), extraídos da mensagem do cliente.
  Todos os campos internos são opcionais e independentes — inclua só os
  que você identificou nesta mensagem."
- **Sub-campos** (todos opcionais):
  - `finalidadeUso` (string) — caixa: para que vai usar
  - `temTampa` (boolean) — caixa: vai ter tampa?
  - `tampaModelo` (string) — caixa: modelo/tipo de tampa
  - `modeloReferencia` (string) — troféu/placa: descrição do modelo/referência, ou `"sem_modelo"` quando o cliente diz que não tem nenhum
  - `arquivoRecebido` (boolean) — troféu/placa: cliente mandou imagem/arquivo
  - `arquivoEhProdutivo` (boolean) — troféu/placa: o arquivo é pronto para produção (true) ou só referência visual (false)
  - `conteudoDesejado` (string) — placa sem arte: o que colocar na peça
  - `temArte` (boolean) — placa: já tem arte pronta?
  - `catalogoReferenciaOferecido` (boolean) — troféu: já oferecemos o catálogo de referência nesta conversa

Se o Chatvolt exigir JSON Schema literal, este é o fragmento a colar como
definição do parâmetro:

```json
{
  "categoryQualificationSignals": {
    "type": "object",
    "description": "Sinais específicos por tipo de produto (caixa/troféu/placa), extraídos da mensagem do cliente. Todos os campos são opcionais.",
    "properties": {
      "finalidadeUso": { "type": "string" },
      "temTampa": { "type": "boolean" },
      "tampaModelo": { "type": "string" },
      "modeloReferencia": { "type": "string" },
      "arquivoRecebido": { "type": "boolean" },
      "arquivoEhProdutivo": { "type": "boolean" },
      "conteudoDesejado": { "type": "string" },
      "temArte": { "type": "boolean" },
      "catalogoReferenciaOferecido": { "type": "boolean" }
    }
  }
}
```

## 3. (Opcional, quando houver link real) Catálogos de referência

Nova coleção Firestore `valeria_catalogos_comerciais` (1 doc por
categoria, id = categoria — ex. `trofeus`, `tampas_caixa`, `placas`),
mesmo formato de `valeria_catalogos` mas sem SKU/preço:

```json
{
  "categoria": "trofeus",
  "titulo": "Catálogo de Troféus",
  "urlCatalogo": null,
  "ativo": true,
  "version": 1,
  "validUntil": null,
  "mensagemPadrao": null
}
```

Enquanto `urlCatalogo` for `null` (estado inicial, seguro — nunca
inventado), a Valéria nunca promete enviar o catálogo, só continua a
conversa normalmente (ver seção "Catálogos" do prompt). Quando houver um
link real, preencha `urlCatalogo` direto no Firestore — não precisa de
deploy nem de mudança de código.

## Nenhum passo adicional necessário para `functions`/`functions-valeria`

O backend (já deployado nesta rodada) já sabe interpretar
`categoryQualificationSignals` quando ele chegar — antes dos passos 1-2
acima, ele simplesmente nunca recebe esse campo (continua funcionando
exatamente como antes, sem a qualificação progressiva nova).
