# Parte 6 — Importação via Interface Real

## Fluxo implementado

Tela Catálogo Vitre → "📥 Importar planilha" → modal real (não mais só
informativo):
1. `<input type="file">` (.xlsx) — leitura 100% no navegador via
   `XLSX.read` (mesma lib CDN já carregada na página), nada é enviado a
   servidor externo.
2. Normalização client-side (`vitreCatImportNormalizarLinha`) — mesmo
   mapeamento de colunas do script de terminal já auditado.
3. Dry-run automático assim que o arquivo é lido — chama a MESMA Cloud
   Function real (`vitreImportarProdutos`, `dryRun:true`) usada pelo
   script de terminal. Nenhuma lógica de validação duplicada no
   frontend — o frontend só lê o arquivo e monta o payload.
4. Preview: cards com válidos/novos/conflitos/avisos, lista de conflitos
   de SKU com o detalhe exato, avisos agrupados por tipo com os SKUs
   afetados.
5. Botão "Importar apenas os válidos" — chama a mesma Function com
   `dryRun:false`, com confirmação (`_e2eDlgConfirm`, testável em E2E).
6. Resultado final + histórico de importações (`vitre_importacoes`,
   últimas 5, em tempo real).

## Verificação ao vivo (real, não simulada)

Testado servindo a planilha real via Hosting Emulator temporariamente
(arquivo nunca commitado — removido imediatamente após o teste,
confirmado ausente do `git status`), pipeline completo `fetch → XLSX.read
→ dry-run real → apply real`:

- Leitura no navegador: 116 linhas brutas, 110 não-vazias — **idêntico**
  ao que o script de terminal já havia reportado.
- Dry-run real: 102 válidos, 4 conflitos (mesmos SKUs da Parte 4), 82
  avisos não-bloqueantes (mesmos tipos/contagens da Parte 5).
- Apply real (catálogo já populado por rodadas anteriores): **0
  criado(s), 0 atualizado(s), 102 sem alteração** — confirma
  idempotência real através da própria UI, não só do script.
- Histórico de importações atualizado em tempo real com o registro desta
  execução.
- Os 4 conflitos continuam bloqueados após o apply — confirmado na tela
  de resultado ("4 conflito(s) de SKU continuam bloqueados — decisão
  humana pendente").

## Decisão de escopo

Upload de arquivo não pode ser simulado pelas ferramentas de automação
de navegador desta rodada (native file picker não é controlável por
essas ferramentas) — a verificação usou `fetch()` de um arquivo servido
temporariamente pelo próprio Hosting Emulator para exercitar exatamente
o mesmo código (`XLSX.read` → `vitreCatImportNormalizarLinha` →
`vitreImportarProdutos`) que o `<input type="file">` chamaria depois de
`FileReader.readAsArrayBuffer`. O elemento de UI real (`<input
type="file" onchange="vitreCatImportArquivoSelecionado(this)">`) está no
DOM e foi inspecionado, mas a interação humana de clique+seleção de
arquivo do sistema operacional não foi automatizada nesta rodada —
registrado como limitação de ferramenta, não como funcionalidade não
implementada.
