# Bug reproduzido — corrupção de persistência ao salvar documento de Knowledge Base (ChatVolt)

**Status: KB PAUSADA. Documento preservado no estado corrompido para auditoria. Nenhuma nova tentativa de save/rollback/reconstrução será feita sem autorização explícita.**

## Onde

- Agente: Valéria (WhatsApp pré-vendas, VR Marcas)
- Base de conhecimento: "Valéria — Conhecimento Validado"
- Documento: "Manual comercial validado — 2026"
- URL: `https://app.chatvolt.ai/pt-BR/datastores/cms2g1u512m4vw0qpfz7cgfj7_v3/cms2g3m3800033b728r3wg0p7`

## O que aconteceu

Durante a Fase E.2.3 (ajuste cirúrgico de 2 trechos do documento — uma regra de
cabeçalho e a correção da entrada "Vocês fazem?"), o fluxo padrão de edição do
ChatVolt (`Editar` → editar textarea → `Concluir` → `Atualizar`) **duplicou
trechos do documento no servidor**, de forma reproduzível, em duas tentativas
consecutivas com conteúdos de entrada diferentes.

O status exibido na UI após o save foi **"Sincronizado" em ambos os casos**,
sem qualquer aviso de erro — a corrupção só foi detectável reabrindo o
documento em modo de edição e comparando tamanho/estrutura com o que havia
sido efetivamente submetido.

## Reprodução 1 — edição pontual (2 trechos)

- Conteúdo submetido (`Atualizar`): 7.331 caracteres (documento original de
  6.941 caracteres + as 2 edições aprovadas).
- Conteúdo persistido após reload completo da página: **8.772 caracteres**
  (+1.441 caracteres não submetidos).
- Seções duplicadas detectadas: bloco de ~448 caracteres contendo a linha da
  tabela `"Com logo/adesivo/gravação"`, a linha `"Display"` e o cabeçalho
  `## Ordem adaptativa de descoberta` — apareciam 2× no documento persistido,
  quando no conteúdo submetido apareciam apenas 1×.
- (Havia também uma duplicação menor pré-existente no documento original de
  6.941 caracteres, na seção "Famílias e perguntas úteis" — não relacionada a
  esta sessão, mas confirmada como já presente antes de qualquer edição desta
  fase.)

## Reprodução 2 — reconstrução completa limpa

Após detectar a Reprodução 1, o documento foi integralmente reconstruído do
zero (a partir do conteúdo canônico, sem nenhuma duplicação, nem a nova nem a
pré-existente), preservando títulos, tabelas, listas e as 2 edições
aprovadas.

- Conteúdo submetido (`Atualizar`): 6.364 caracteres, verificado
  estruturalmente antes do save — cada seção/título aparecendo exatamente 1×.
- Conteúdo persistido após reload completo da página: **7.643 caracteres**
  (+1.279 caracteres não submetidos).
- Seções duplicadas detectadas desta vez (diferentes da Reprodução 1):
  `## Ordem adaptativa de descoberta` (2×), `## Critério de qualidade` (2×),
  a frase final `"próximo passo."` (3×).

## Conclusão

- O bug é **reproduzível** e **independente do conteúdo submetido** — duas
  submissões com conteúdos e tamanhos diferentes resultaram em duplicações em
  regiões diferentes do documento.
- O status "Sincronizado" da UI **não é confiável** como sinal de integridade
  — a duplicação passou despercebida pela própria interface do ChatVolt.
- As 2 edições de conteúdo aprovadas nesta fase (regra de cabeçalho sobre
  intenção concreta; correção da entrada "Vocês fazem?") foram aplicadas
  corretamente em ambas as tentativas, sem duplicação nelas mesmas — a
  corrupção afeta outras partes do documento, não o texto que foi
  efetivamente editado.
- Hipótese mais provável: o pipeline de salvamento reconstrói o markdown a
  partir de chunks/embeddings de RAG sobrepostos, e a lógica de
  concatenação duplica a região de overlap entre chunks adjacentes.

## Estado atual (preservado para auditoria, não alterado)

- O documento está salvo no servidor na versão corrompida da Reprodução 2
  (7.643 caracteres), com as 2 edições de conteúdo corretas presentes, mas
  com duplicação estrutural em 3 seções.
- Nenhuma nova tentativa de save, rollback ou reconstrução foi feita após
  esta segunda reprodução.
- Ação tomada: desconexão **temporária** da KB do agente Valéria (a KB em si
  não foi apagada, e o documento não foi mais tocado) — ver
  `CHATVOLT_KB_TEMP_DISCONNECT_2026-09-20.md` para o estado anterior e o
  procedimento de rollback.

## Para o suporte do ChatVolt

Ver `CHATVOLT_SUPPORT_REPORT_2026-09-20.md` (relatório curto, sem nenhum
dado sensível/credencial) para envio à equipe de suporte.
