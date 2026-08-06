# Parte 11 — Duas Execuções Limpas

## Achado real corrigido nesta parte (não só verificação)

Ao rodar a suíte consolidada (`scripts/e2e_run_all_tests.js`,
atualizada nesta rodada para incluir as 6 suítes de Fase G/Valéria)
pela primeira vez a partir de um reset genuinamente limpo,
`test_vitre_rules.js` falhou 4/28 — os testes 1-4 assumiam
implicitamente que o SKU `AA001` já existia no catálogo (dependência
nunca antes exercitada, porque durante toda a sessão o ambiente já
estava "sujo" com os 102 produtos reais importados). Corrigido gravando
um doc mínimo via Admin SDK no início da suíte, tornando-a autocontida.
Commit `2e954b9`. Depois do fix: 28/28.

## Reimportação real da planilha (quarta conferência independente)

A planilha real não estava dentro do repositório (nunca foi
versionada, por política explícita) — localizada em
`~/Downloads/Produtos Orçamento Vitre.xlsx` (fora do diretório de
trabalho, no disco do usuário). Confirmada pelas colunas exatas
esperadas pelo importador (`SKU | Nome dos Produtos | Espessura (mm) |
... | Descrição`). Reimportada do zero, a partir de um reset limpo:

- **Dry-run:** 116 linhas de dado, 110 não-vazias, **102 criados**,
  **86 erros** (avisos + conflitos) — os mesmos 4 conflitos de sempre
  (`CPC001`, `MLP001`, `MLR001`, `PPCI001`). **Idêntico às Partes 4, 5
  e 6** — quarta conferência independente, mesmo resultado.
- **Apply real:** 102 criados, 0 atualizados, 0 sem alteração, 86 erros
  (os 4 conflitos continuam bloqueados, como esperado).
- **Segunda aplicação (idempotência):** 0 criados, 0 atualizados,
  **102 sem alteração**, mesmos 86 erros — confirma que reimportar não
  duplica nem altera nada.

## Execução 1 (reset → seed → suíte completa)

```
node scripts/e2e_run_all_tests.js
```
SHA-256 do seed: `2381d74ae7b45045f3c0f7fa739c100452dd8259c947ca7f60bb6b6439e50eab`

| Categoria | passed | failed |
|---|---|---|
| Functions — Produção | 29 | 0 |
| Functions — Estoque (12 comandos) | 33 | 0 |
| Functions — Compras v2 | 21 | 0 |
| Ferramenta — QA fixture guard | 14 | 0 |
| Rules — REST via Auth Emulator (estoque) | 17 | 0 |
| Functions — Catálogo Vitre | 23 | 0 |
| Rules — bloco vitre_* | 28 | 0 |
| Unitário — parser da planilha Vitre | 7 | 0 |
| Fixture — prova de resolução dos 4 conflitos de SKU | 8 | 0 |
| Functions — conversão de orçamento Vitre em OS | 12 | 0 |
| Functions — Valéria × Catálogo Vitre | 25 | 0 |
| **Total (referência, categorias não somáveis entre si)** | **217** | **0** |

## Execução 2 (reset → seed → suíte completa, repetida)

Mesmo comando, do zero. Resultado **byte-a-byte idêntico**:

- SHA-256 do seed: `2381d74ae7b45045f3c0f7fa739c100452dd8259c947ca7f60bb6b6439e50eab`
  (idêntico à Execução 1)
- Todas as 11 categorias com a MESMA contagem passed/failed da Execução 1
  (217/0 no total de referência)

## Limpeza final e verificação de resíduo zero

```
node scripts/e2e_clean_env.js reset
```
Leitura direta das 7 coleções Vitre/Valéria depois do reset final:

| Coleção | Docs restantes |
|---|---|
| `vitre_produtos` | 0 |
| `vitre_orcamentos` | 0 |
| `vitre_os` | 0 |
| `vitre_importacoes` | 0 |
| `vitre_produto_historico` | 0 |
| `vitre_produto_auditoria` | 0 |
| `valeria_handoffs` | 0 |

**Zero resíduo confirmado.** Hash do seed pós-limpeza:
`2381d74ae7b45045f3c0f7fa739c100452dd8259c947ca7f60bb6b6439e50eab` —
idêntico às duas execuções acima e a todo hash já registrado ao longo
desta sessão inteira (Parte 1, rodadas NOTURNA e anteriores) —
determinístico confirmado de ponta a ponta.

## Conclusão

Duas execuções completas da suíte de testes, do zero, produziram
**hash idêntico**, **contagens idênticas por categoria**, **zero
divergência**. A reimportação real da planilha (localizada em
`~/Downloads`, fora do repositório) confirmou, pela quarta vez nesta
sessão e com evidência fresca desta Parte 11, os mesmos números
(116/110/102/86/4 conflitos) e comportamento idempotente na segunda
aplicação. Limpeza final deixou as 7 coleções específicas de
Vitre/Valéria genuinamente vazias, com o hash de seed voltando ao
valor determinístico canônico. Nada nesta parte ficou sem verificação
real.
