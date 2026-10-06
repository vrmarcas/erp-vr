# Relatório para suporte ChatVolt — duplicação de conteúdo ao salvar documento de Knowledge Base

**Data:** 20/09/2026
**Conta:** gabrieelborges8@gmail.com
**Base de conhecimento:** "Valéria — Conhecimento Validado"
**Documento afetado:** "Manual comercial validado — 2026"
**URL:** https://app.chatvolt.ai/pt-BR/datastores/cms2g1u512m4vw0qpfz7cgfj7_v3/cms2g3m3800033b728r3wg0p7

## Resumo

Ao editar o texto de um documento de Knowledge Base (fluxo: `Editar` → alterar
o texto → `Concluir` → `Atualizar`), o conteúdo persistido no servidor fica
**maior e duplicado** em relação ao que foi efetivamente submetido no editor,
mesmo a interface mostrando "Sincronizado" sem nenhum erro.

## Passos para reproduzir

1. Abrir um documento de Knowledge Base existente e grande (no nosso caso,
   ~6.900 caracteres, dividido em 4 "trechos" na visualização).
2. Clicar em "Editar".
3. Fazer uma pequena alteração de texto (ex.: inserir um parágrafo curto,
   ~300 caracteres).
4. Clicar em "Concluir" (a UI mostra "Alterações salvas localmente. Clique em
   'Atualizar' para salvar no servidor.").
5. Clicar em "Atualizar".
6. Recarregar a página inteira (F5 / reload completo, não apenas navegação
   interna do SPA).
7. Clicar em "Editar" novamente e comparar o tamanho do texto no campo de
   edição com o tamanho do texto que foi submetido no passo 3-5.

## Resultado observado

O texto persistido é **maior** que o texto submetido, com trechos do meio do
documento **duplicados** (o mesmo bloco de texto aparece 2 vezes seguidas).
A UI continua mostrando "Sincronizado" normalmente, sem qualquer aviso.

Reproduzimos isso **2 vezes consecutivas**, com conteúdos de entrada
diferentes (uma edição pontual pequena, e depois uma reescrita completa do
documento do zero). Em ambos os casos, o conteúdo persistido ficou maior que
o submetido, com seções distintas duplicadas em cada tentativa — sugerindo
que o problema está na reconstrução do documento a partir de chunks
internos (possivelmente relacionado à indexação/embeddings do RAG), e não em
algo específico do texto enviado.

## Impacto

Documentos de Knowledge Base editados por este fluxo podem ficar
silenciosamente corrompidos (conteúdo duplicado), afetando a qualidade das
respostas dos agentes que consultam essa base, sem nenhum sinal de erro na
interface.

## O que já fizemos

Por segurança, pausamos a edição desse documento e desconectamos
temporariamente essa Knowledge Base do agente afetado, até que o problema
seja investigado. Podemos fornecer mais detalhes técnicos (tamanhos exatos
em caracteres, offsets dos trechos duplicados) se for útil para a
investigação.
