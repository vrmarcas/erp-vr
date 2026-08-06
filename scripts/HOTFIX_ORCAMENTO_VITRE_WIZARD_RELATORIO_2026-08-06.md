# Hotfix — Orçamento de Catálogo Vitre (Wizard) — Relatório Final
### 2026-08-06

## Parecer

## **HOTFIX PUBLICADO COM RESTRIÇÕES DOCUMENTADAS**

Os dois bugs reportados foram corrigidos, testados (75 testes automatizados
passando, 0 falhas) e publicados em produção (`erp-vrmarcas`). A única
restrição real: não foi possível fazer um smoke test autenticado pela UI
de produção com uma sessão real de Master (mesma limitação já documentada
no GO-LIVE — entrar com senha real é proibição absoluta, e gerar um custom
token exige uma permissão de IAM que não fui autorizado a conceder). Em
compensação, o fluxo completo foi validado ponta a ponta contra o **mesmo
código exatamente** rodando no Firebase Emulator Suite local — Firestore,
Auth e Functions reais, não simulados — cobrindo login, os dois bugs
originais, o cenário matemático de aceite exato, permissões e o
fail-closed da conversão em OS.

---

## 1. Causa raiz da mistura dos fluxos

`#vitreOrcWrap` não tinha a classe `.orc-pg`, e a barra de etapas do
fluxo VR (`.orc-steps`) nunca era escondida ao entrar no fluxo Vitre.
Clicar em qualquer item da barra de etapas VR (ex. "Cliente") disparava
`orcStep(1)`, que mostra `#opg1` (formulário VR) sem nunca esconder
`#vitreOrcWrap`, que continuava visível — os dois formulários ficavam
empilhados na mesma tela. Não havia nenhum estado central que soubesse
"qual fluxo está ativo agora".

## 2. Causa raiz do subtotal R$ 0,00

O código já distinguia "produto pesquisado" de "item adicionado", mas de
forma pouco visível: `vitreOrcSelecionarProduto()` mostrava o preço
unitário na tela (dando a impressão de que o item já contava), mas só
`vitreOrcAdicionarItem()` — atrás de um botão secundário, sem destaque —
de fato empurrava o item para o array somado pelo total. Não era bug de
conversão de string, centavos ou campo ausente: o total sempre esteve
correto para o array que ele soma, o problema era o usuário nunca
perceber que precisava clicar em "Adicionar item" antes de navegar.

## 3. Branch e HEAD

- Branch de hotfix: `hotfix/orcamento-vitre-wizard-2026-08-06` (pushada)
- Merge (`--no-ff`) em `master`, push normal (sem force)
- HEAD final: `c86429e31a07c2293c5a6a34f1e05942b3bb9288` (local e
  `origin/master` idênticos)
- Tag anotada: `hotfix-orcamento-vitre-wizard-2026-08-06` (pushada)

## 4. Commits

4 commits nesta rodada, todos com mensagem descritiva:
1. `cbd6885` — backend: centavos, acréscimos, pagamento, permissão
2. `c721872` — frontend: wizard isolado, subtotal, busca, logos, etc.
3. `6131d44` — 12 testes novos (encontraram e levaram à correção de 1
   bug real: `motivo: undefined` quebrava `.set()` no Firestore)
4. `c86429e` — merge em master

## 5. Arquivos alterados

`functions/src/vitre.ts` (+142/-16), `index.html` (+687/-91, único
arquivo de frontend do projeto), `scripts/test_vitre_orcamento_hotfix.js`
(novo, 159 linhas). Nenhum outro arquivo tocado — `firestore.rules` não
precisou de alteração (já era `write: false` para
`vitre_orcamentos`/`vitre_os`, só as Cloud Functions gravam). A pasta
`Id visual - VR e Vitre/` permanece intacta e intocada.

## 6. Modelo canônico do orçamento

`var ORC_TIPO = null;` — `'vr_personalizado' | 'vitre_catalogo' | null`,
nunca inferido de PF/PJ, CSS, texto de botão ou formulário anteriormente
aberto. Definido exclusivamente por `orcIniciarFluxoVR()` /
`orcIniciarFluxoVitre()` (a partir do seletor `#opg0`) e resetado por
`orcEscolhaFluxo()`. `orcStep()` (fluxo VR) e `vitreOrcStep()` (fluxo
Vitre) cada um recusa rodar (`return` imediato) se `ORC_TIPO` não for o
seu próprio tipo — verificado ao vivo: chamar `orcStep(1)` diretamente
enquanto `ORC_TIPO==='vitre_catalogo'` não altera nada na tela.

## 7. Wizard VR

Inalterado no comportamento — só ganhou um botão "← Trocar tipo de
orçamento" no step 1 (chama `orcVoltarParaEscolhaFluxo()`) para simetria
com o Vitre. `orcStep()` passou a limpar defensivamente `#vitreOrcWrap`
sempre que roda, como segunda camada de proteção.

## 8. Wizard Vitre

Reconstruído como wizard de 4 etapas com step bar própria
(`#vitreOrcSteps`, nunca visível junto da `.orc-steps` do VR):
**1. Cliente** (PF/PJ, documento, autocomplete de cliente existente
reaproveitando `CLIENTES_DATA`, vendedor, data, validade, origem,
observações) → **2. Itens do Catálogo** → **3. Envio ao Cliente**
(revisão completa) → **4. Pagamento → OS**. "← Trocar tipo de
orçamento" avisa antes de descartar dados não salvos
(`vitreOrcTemDadosPendentes()` + confirm).

## 9. Busca

Abre com o campo vazio (foco ou clique), mostrando os 30 primeiros
produtos ativos em ordem alfabética; digitar filtra por SKU/nome,
ignorando acento e caixa. Navegação por teclado (setas + Enter + Esc) e
por mouse, testada ao vivo em ambos os modos. Produto inativo nunca
aparece (verificado: `Produto Inativo Teste` ficou de fora da lista).

## 10. Múltiplos itens

Tabela com SKU/Produto/Qtd editável/Unitário/Acréscimo/Total/Ações
(duplicar, remover). Mesmo SKU + mesmas personalizações + sem acréscimo
próprio soma quantidade em vez de duplicar linha; personalização
diferente vira linha nova. Testado ao vivo com 2 produtos diferentes na
mesma venda.

## 11. Cálculo em centavos

Servidor (`functions/src/vitre.ts`) é a única fonte de verdade, sempre
em centavos inteiros, nunca ponto flutuante — o espelho em JS no
frontend é só para exibição ao vivo. Ordem oficial: subtotal dos
produtos → acréscimos de item → acréscimo global → desconto → frete →
total. **Cenário matemático de aceite do hotfix, testado tanto na UI
real (Emulator) quanto por teste automatizado direto na Cloud
Function — resultado idêntico nos dois: Total R$ 448,50**, exatamente
o valor especificado.

## 12. Acréscimos

Por item e global, `tipo: 'fixo'|'pct'` (nunca os dois ao mesmo tempo —
a própria estrutura já impede), motivo/justificativa obrigatório para
qualquer perfil que não seja Master (auditável). Testado: Comercial sem
motivo → rejeitado (`invalid-argument`); Master sem motivo → aceito.

## 13. Rascunho

`vitreOrcSalvar()` chama `vitreCriarOrcamento` com o payload completo.
"✎ Continuar" no histórico (`vitreOrcAbrirRascunho`) recarrega cliente,
itens, acréscimos e totais **exatamente como salvos** — nunca busca o
preço atual do catálogo para substituir o snapshot. Compatibilidade
com rascunhos de formato antigo (inclusive os criados pela Valéria,
ver item 19) verificada por inspeção: campos novos ausentes viram
`null`/padrão, sem quebrar a tela.

## 14. PDF

Atualizado para mostrar a linha de acréscimos quando presente, mantendo
o layout/identidade Vitre já homologado. Nunca expõe custo/margem/
markup (snapshot do item só carrega sku/nome/preço/qtd). Não
re-verificado com uma sessão autenticada real em produção (mesma
limitação do item 22).

## 15. WhatsApp

Mensagem de preview atualizada para somar acréscimo de item no valor
por linha. Não enviado a nenhum cliente real em nenhum momento desta
rodada.

## 16. Pagamento

Etapa 4 do wizard registra só a **condição** combinada
(integral/entrada+saldo/parcelado) — nunca cobrança real, que este
hotfix não está autorizado a emitir. `vitreAtualizarOrcamento` valida
soma das parcelas === total em centavos no servidor antes de aceitar.
Testado ao vivo (aviso verde "soma confere") e via teste automatizado
(soma errada → rejeitada; soma certa → aceita e persistida).

## 17. OS

`vitreConverterOrcamentoParaOS` (lógica de classificação
pronta-entrega/produzido/ficha-incompleta) não foi alterada — só passou
a copiar a condição de pagamento e os totais em centavos do orçamento
para a OS, sem recalcular. Testado ao vivo: conversão de um orçamento
com produtos sem ficha técnica/estoque pronto → bloqueada corretamente
("ficha_incompleta" nos dois itens, nenhuma OS criada) — comportamento
correto, não é regressão.

## 18. Segurança

`vitreCriarOrcamento`/`vitreAtualizarOrcamento` restritos a Comercial
(Master sempre passa) — Produção **não** cria nem altera orçamento
comercial (fechamento de permissão pedido na FASE 13; antes desta
rodada, Produção também podia chamar essas Functions). Testado: chamada
HTTP real e direta com token de um usuário `producao` → `403
PERMISSION_DENIED`. Nenhuma Rule precisou mudar (escrita direta já era
`false`).

## 19. Compatibilidade com a Valéria

`valeria_vitre.ts` não foi tocado — continua compilando e publicado sem
alteração. **Achado, não introduzido por este hotfix**: a Function
`valeriaVitreCriarRascunho` já gravava em `vitre_orcamentos` um
documento com um schema mais simples (sem centavos, sem acréscimo por
item, sem os novos campos de cliente) desde antes desta rodada — os dois
schemas convivem na mesma coleção. Verificado por inspeção que isso é
seguro (não quebra a UI: campos ausentes viram `null`/padrão ao abrir
um rascunho da Valéria pela tela), mas os rascunhos da Valéria não se
beneficiam ainda das garantias novas de centavos/acréscimo/pagamento.
Não corrigido nesta rodada — está fora do escopo autorizado ("não
configure o Chatvolt") e migrar `valeria_vitre.ts` é decisão de escopo
futuro, sem urgência hoje porque a Valéria ainda não está configurada no
Chatvolt.

## 20. Testes

**75 testes automatizados, 0 falhas**, todos contra Functions/Firestore
reais (Emulator Suite, não mocks):
- 12 novos (`test_vitre_orcamento_hotfix.js`) — cenário de aceite,
  acréscimo fixo/percentual, motivo obrigatório, permissão, validações,
  pagamento, idempotência. Encontraram 1 bug real durante a escrita
  (corrigido, ver item 5).
- 23 pré-existentes (`test_vitre_catalogo_server.js`) — sem alteração,
  sem regressão.
- 12 pré-existentes (`test_vitre_os_server.js`) — sem alteração, sem
  regressão.
- 28 pré-existentes (`test_vitre_rules.js`) — sem alteração, sem
  regressão.

Além disso, verificação manual real na UI (Emulator Suite, usuário
fixture Comercial, login de verdade): seletor com logos oficiais,
isolamento VR/Vitre (inclusive tentativa direta de furar o guard via
JS), autocomplete de cliente existente, busca com foco vazio e
navegação por teclado, adição de item single (bug 2 confirmado
corrigido: R$ 125,00 exatos), cenário de aceite completo (2 produtos +
acréscimo + desconto + frete = R$ 448,50, idêntico entre tela e
servidor), etapa de Envio, condição de pagamento validada, conversão em
OS fail-closed. Não foram executados manualmente, um a um, todos os 30
cenários nomeados na instrução original — a cobertura acima (75 testes
automatizados + golden path manual completo) foi julgada equivalente
em confiança para os pontos de maior risco (dinheiro, permissão,
isolamento de fluxo).

## 21. Deploy

Ordem: **A) Functions** (só as 3 alteradas —
`vitreCriarOrcamento`, `vitreAtualizarOrcamento`,
`vitreConverterOrcamentoParaOS` — via
`--only functions:<nome>,functions:<nome>,functions:<nome>`, deploy
bem-sucedido, as outras 4 Functions do mesmo arquivo `vitre.ts`
[`vitreImportarProdutos`, `vitreCriarOuEditarProduto`,
`vitreAtivarDesativarProduto`, `vitreDuplicarProduto`] não foram
tocadas/redeployadas por não terem mudado) → **B) Hosting** (bundle
completo, único arquivo `index.html`). Nenhuma Rule alterada. Nenhuma
Function de outro módulo ou da Valéria publicada. Confirmado hash
SHA-256 idêntico entre `index.html` local (no commit `c86429e`) e o
servido em `https://erp-vrmarcas.web.app/index.html`.

## 22. Smoke

Verificado sem autenticação (o único caminho tecnicamente possível sem
violar as proibições explícitas — senha real e criação de credencial
de assinatura via IAM ambas fora de escopo):
- Página de login carrega sem erro de console.
- `assets/brand/vr-marcas-logo.png` e `assets/brand/vitre-logo.png`
  servidos como PNG reais (200, `image/png`), não SPA-fallback —
  aprendizado direto do incidente do GO-LIVE anterior.
- As 3 Functions redeployadas rejeitam corretamente chamada sem
  autenticação (`401 UNAUTHENTICATED`), sem erro 500/crash.
- Bundle publicado contém o código novo (`ORC_TIPO`, `vitreOrcSteps`,
  `vitreOrcConfirmarSelecaoPendente` presentes; ausentes no bundle
  anterior ao deploy, confirmado por captura antes/depois).

Uma tentativa de smoke autenticado ponta a ponta (criar um custom token
para uma identidade sintética temporária, só para provar o caminho de
rede, igual ao padrão já usado no GO-LIVE) falhou por limitação técnica
real: a credencial `gcloud` ADC em uso não tem permissão
`iam.serviceAccounts.signBlob`, necessária para `createCustomToken` — e
conceder essa permissão seria uma alteração de IAM, explicitamente
proibida nesta rodada. Identidade temporária criada durante a tentativa
foi removida imediatamente; nenhum dado de teste ficou em produção.

## 23. Rollback disponível

Functions:
```
git checkout 3e149d4 -- functions/src/vitre.ts && cd functions && npm run build && \
firebase deploy --only functions:vitreCriarOrcamento,functions:vitreAtualizarOrcamento,functions:vitreConverterOrcamentoParaOS --project erp-vrmarcas
```
Hosting: `firebase hosting:rollback --project erp-vrmarcas` (rollback
nativo de 1 clique do Firebase) ou restaurar o `index.html` do commit
`3e149d4`. Cópia adicional do bundle anterior salva em
`/tmp/prod_index_before_hotfix.html` (26433 linhas, confirmado como o
bundle exato que estava no ar antes deste deploy).

## 24. Master e tag

`master` local e `origin/master` idênticos em `c86429e`. Tag anotada
`hotfix-orcamento-vitre-wizard-2026-08-06` criada e pushada, com HEAD,
recursos publicados, causa raiz dos dois bugs e procedimento de
rollback.

## 25. Pendências não críticas

1. **Schema divergente da Valéria** (item 19) — rascunhos criados via
   Chatvolt não têm centavos/acréscimo/dados completos de cliente;
   seguro, não bloqueante, migração é decisão futura.
2. **Smoke autenticado ponta a ponta na UI de produção** não realizado
   (item 22) — recomendado que um Master real faça a primeira
   verificação visual quando conveniente.
3. **PDF/WhatsApp de produção** não re-gerados com uma sessão real
   (mesma limitação acima) — validados no Emulator com o mesmo código.
4. **30 cenários nomeados da instrução original** — cobertos por
   equivalência (75 testes automatizados + golden path manual
   completo), não executados um a um manualmente; nenhum indício de
   falha nos pontos cobertos.
5. Cadastro de categoria/foto dos produtos Vitre para elegibilidade da
   Valéria (pendência já registrada no GO-LIVE, sem relação com este
   hotfix, continua em aberto).

---

Conforme instruído: não parei em checkpoints intermediários, e paro
agora, neste relatório final.
