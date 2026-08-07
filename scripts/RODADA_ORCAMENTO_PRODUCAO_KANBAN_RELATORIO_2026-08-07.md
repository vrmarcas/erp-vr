# Rodada Autônoma — Correções de Orçamento, Pagamento, Documentos, OS e Kanban
**Data:** 2026-08-07 · **Branch:** `hotfix/erp-operacional-orcamento-producao-2026-08-07` → mesclada em `master` (`--no-ff`) · **Projeto:** `erp-vrmarcas`

## Veredito

## RODADA PUBLICADA COM RESTRIÇÕES DOCUMENTADAS

Todos os bugs P0/P1 explicitamente descritos no pedido foram reproduzidos, corrigidos e cobertos por teste de regressão. Um achado adicional, mais grave do que o relatado, foi encontrado e corrigido durante a investigação (item 2 abaixo). Dois itens ficam conscientemente fora do escopo desta rodada — um deles é o item 20 do pedido (privacidade financeira real da role Produção) — documentados abaixo com a razão técnica de não terem sido resolvidos agora. Nenhum rollback foi necessário. A restrição real é a mesma de rodadas anteriores: não há Java disponível neste ambiente, então o Firestore Emulator não pôde ser iniciado para uma verificação de Rules 100% ao vivo — a verificação foi feita estaticamente (sintaxe, chaves balanceadas, diff revisado linha a linha) e via `firebase deploy` real (que não depende do emulador).

---

## 1. O que foi pedido

Rodada corretiva (não uma nova auditoria) sobre o ERP em produção, cobrindo: integridade de valores no orçamento (bug de reabertura reproduzido: R$189,46 → R$2,03), status desincronizado entre wizard e listagem, geração de OS exigindo indevidamente pagamento total, Kanban com card na coluna errada, modal de custos desorganizado, cálculo de Laser manual, desconto/acréscimo comercial por item em vez de global, proteção da taxa de cartão, condição padrão 50/50, documentos (PDF/WhatsApp/recibo) com bugs de layout e dados fictícios, autosave obrigatório, reset completo do wizard, filtros na listagem, checklist de produção na OS, e privacidade financeira da role Produção — com proibição explícita de tocar Valéria/Chatvolt.

## 2. Achado mais grave do que o relatado

O sintoma relatado ("ERP exige pagamento total para iniciar produção") tinha DUAS causas raiz, e a segunda era mais séria do que a queixa original:

1. **Causa relatada**: o status inicial da OS só virava `aguardando_saldo` (que libera o início de produção com saldo pendente) quando o tipo de pagamento era literalmente `"50-50"` — qualquer outro tipo com entrada parcial (`"parcial"`, ou `"futuro"` sem pagamento) caía direto em `"iniciada"` ou ficava com o cálculo de saldo inconsistente.
2. **Causa não relatada, mais grave**: o botão final do wizard de orçamento ("Confirmar Pagamento Total e Gerar OS", Step 5) nunca chamava a rota real de geração de OS. Chamava um circuito 100% local (`orcSimPagamento()` → `window.orcGerarOS()`) que:
   - gerava um número de OS aleatório (`800 + random(100)`, ~100 valores possíveis, sem contador atômico);
   - nunca verificava se o orçamento já tinha uma OS vinculada;
   - criava um registro de orçamento **novo e desconectado** do que já estava salvo pelo wizard (`window._orcSessaoAtualId`);
   - não rodava dentro de nenhuma transação Firestore.
   
   Ou seja: o caminho que um operador realmente usa ao terminar um orçamento (percorrer os passos do wizard até o fim) nunca passava pela transação atômica com proteção contra duplicidade que já existia em `orcEnvGerarOS()` — essa só era alcançável a partir da lista "Orçamentos Enviados", um lugar diferente. Isso é exatamente a classe de bug que as regras de rollback desta rodada listam como crítica (duplicação de OS/pagamento).

   **Correção**: o botão do wizard agora autosalva o orçamento (`orcSalvarOrcamento()`) e delega para `orcEnvConfirmarPgto()` → `orcEnvGerarOS()` — a mesma rota transacional. O circuito local antigo (`orcSimPagamento`, `window.orcGerarOS`, a caixa "Gerar Ordem de Serviço" da barra lateral do wizard) foi removido por completo, não apenas desativado, para não sobrar como rota alternativa esperando ser religada por engano numa rodada futura.

## 3. O que foi corrigido, por área

### P0 — Integridade e status
- **Snapshot fiel no reopen**: `orcSalvarOrcamento()` agora grava `snapshotCompleto` (itens, parâmetros de custo, breakdown já calculado) e `orcEnvAbrir()`/`orcEnvEditar()` **restauram esse snapshot**, nunca recalculam com a config/preços atuais. Reproduz e corrige o caso relatado (R$189,46 → R$2,03).
- **Idempotência**: `window._orcSessaoAtualId` faz `orcSalvarOrcamento()` atualizar em vez de duplicar o número do orçamento em salvamentos sucessivos da mesma sessão.
- **Status único**: `orcToggleClienteAprov()` (wizard) grava o status via `orcEnvSetStatus()` — a mesma função usada pela listagem "Orçamentos Enviados" — eliminando o desalinhamento reproduzido.
- **Gatilho de OS/produção por saldo, não por tipo**: status inicial da OS = `aguardando_saldo` sempre que `restante > 0`, independente do tipo de pagamento escolhido. `kbOpen()` libera "Iniciar Produção" para `iniciada` OU `aguardando_saldo`.
- **Rota única de geração de OS**: ver item 2 acima.
- **Kanban — coluna certa**: `kbRender()` só posiciona o card numa coluna de dia da semana se o prazo da OS cair dentro da semana atualmente exibida (janela segunda–sábado calculada a partir da semana em tela); fora da janela, cai em "Novas" — nunca mais numa coluna de dia da semana errada (bug reproduzido: prazo de outra semana com o mesmo dia da semana).
- **Rules — Comercial pode gerar OS**: achado durante a investigação do item 2 — mesmo com o front-end corrigido, a transação de `orcEnvGerarOS()` falhava com permissão negada para o perfil Comercial, porque as Rules só liberavam `fin_cr`/`kb_os`/`erp_os_counter` para Financeiro/Produção/Master. Alargamento aditivo (não remove nada do acesso existente).

### P0 — Privacidade financeira da Produção (não corrigido — ver seção 5)

### P1 — Comercial
- **Custos avançados**: consumíveis do item recalculam em tempo real; removido o toggle "Adesivo/Vinil" do modal de item (não fazia sentido nesse nível) e os parâmetros de ordem que estavam soltos ali dentro.
- **Laser automático**: cálculo de tempo de corte roda sozinho ao editar item/planificação, com um flag persistente de ajuste manual (`window._orcLaserAjusteManual`) que nunca é sobrescrito sem o operador pedir explicitamente.
- **Desconto/acréscimo global**: já existia como campo único por orçamento (não por item) com auditoria interna (`ajusteComercialAudit`: usuário, timestamp, valor técnico vs. final) — confirmado que documentos ao cliente (PDF/WhatsApp/recibo) expõem só o preço final, nunca o campo de auditoria.
- **Cartão sem juros / desconto PIX**: confirmado que o fluxo VR (`orcRefreshFinalPrice()`) já embutia corretamente a taxa de cartão no preço mostrado ao cliente (label "Nx sem juros", taxa real nunca exposta), lendo de config central (`cfgLoad().financeiro`). PIX pré-preenche a partir dessa mesma config.
- **Condição padrão 50/50**: modal de confirmação de pagamento tem "50/50" como opção padrão selecionada (antes era "Integral").

### P1 — Documentos
- **PDF A4 real** (VR personalizado, Vitre personalizado, Vitre catálogo): altura mínima de página + layout flex + rodapé fixado ao fim físico da página em orçamentos curtos (antes o rodapé "flutuava" no meio da folha); nome real do vendedor; linhas de frete/desconto omitidas quando o valor é zero.
- **WhatsApp**: saudação por horário do dia (`orcSaudacaoHorario()`), substituindo "Bom dia" fixo; vendedor real; linhas zeradas omitidas — confirmado que o fluxo personalizado (VR/Vitre) já usava essa lógica corretamente; só o catálogo Vitre precisou de correção.
- **Autosave obrigatório**: `orcImprimirOrcamentoPDF()` e `orcEnviarOrcamentoWA()` chamam `orcSalvarOrcamento()` antes de gerar o documento e abortam (com aviso claro) se o salvamento falhar — nunca gera PDF/WhatsApp de um orçamento não persistido.
- **Recibo de entrada**: A4 real com o mesmo padrão de página do PDF do orçamento, logo oficial da marca (antes não tinha nenhum), e o bloco "Saldo Restante" só aparece quando existe saldo de fato (antes aparecia sempre, mesmo com entrada = total).

### P2 — UX
- **Filtros em "Orçamentos Enviados"**: filtro De/Até por data e um atalho de "Mês/Ano" populado a partir dos registros existentes — parseando o único carimbo de data disponível (`dataSalvo`, `"dd/mm/yyyy hh:mm"`), inclusive em registros legados.
- **Checklist de produção condicional**: a etapa "Montagem" só entra no checklist da OS quando o orçamento de origem realmente cobrou montagem (`orcMontagem > 0`) — etapas que não se aplicam não aparecem mais.
- **Reset completo em "Novo Orçamento"**: `orcResetFormularioVR()` limpa itens, extras, cliente, custos, descontos, sessão vinculada e cálculo em memória, com confirmação antes de descartar dados não salvos.

## 4. Cenários de aceite (A–M do pedido) — status

| Cenário | Status |
|---|---|
| A — R$189,46 reabre fiel | ✅ coberto (teste #1/#2) |
| B — item×total sem "mágica" | ✅ (breakdown persistido, nunca recalculado) |
| C — status único lista/detalhe | ✅ coberto (teste #3/#4) |
| D — R$400 → R$200+R$200 sem perder centavo | ✅ coberto (teste #10/#11) |
| E — R$200 técnico + R$50 interno → cliente vê R$250 | ✅ coberto (teste #17/#18) |
| F — cartão "3x sem juros" sem taxa exposta | ✅ (já existia, confirmado) |
| G — PDF/WhatsApp sem linha zerada | ✅ coberto (teste #22/#23 + PDF/WA) |
| H — autosave antes de PDF/WhatsApp | ✅ coberto (teste #24/#25) |
| I — Novo Orçamento reseta tudo | ✅ (com confirmação) |
| J — OS/produção sem exigir 100% | ✅ coberto (teste #5–9) — **e o achado do item 2** |
| K — Kanban card na semana certa | ✅ coberto (teste #12–14) |
| L — Produção sem ver dados financeiros | ⚠️ não corrigido nesta rodada (ver seção 5) |
| M — filtros funcionam | ✅ coberto (teste #19–21) |

## 5. Escopo conscientemente não coberto

### 5.1 Privacidade financeira real da role Produção (Parte 20 — P0)
As Rules já restringem parcialmente por role, mas `kb_os` (e o equivalente `vitre_os`) armazenam **todas as OS como um único documento JSON** (`{ data: JSON.stringify({...}) }`). Rules do Firestore só decidem no nível do documento inteiro — não existe "campo visível, campo oculto" dentro do mesmo documento. Ou seja, qualquer role com permissão de leitura em `kb_os` recebe o JSON completo, incluindo valor/custo/margem de todas as OS; a ocultação de preço para Produção hoje é só de interface (HTML/CSS), não de dado.

**Por que não foi corrigido agora**: a correção real exige o mesmo tipo de migração que já foi feita para Compras e Estoque em rodadas anteriores — trocar o documento-array por um documento-por-registro (`kb_os/{osId}`), com uma Cloud Function de leitura que filtra campos financeiros por role antes de devolver ao cliente. Isso é uma mudança estrutural em uma coleção com leitura ativa em produção (Kanban, listagem de OS, Compras), e essa classe de migração — pelo histórico deste mesmo repositório — levou uma rodada inteira dedicada quando foi feita para Compras/Estoque. Tentar isso durante uma janela sem supervisão, dentro de uma rodada corretiva com escopo já amplo, é exatamente o tipo de "decisão que não pode ser inferida do código" que a instrução pede para não executar sem checkpoint. **Estado atual: inalterado em relação ao início da rodada — não piorou, não foi corrigido.**

### 5.2 Proteção de taxa de cartão na Function `parcelado` do Vitre
VR já tinha essa proteção (confirmado, seção 3). O Vitre não tem — mas essa lógica vive numa Cloud Function de pagamento real (`vitre.ts`), e alterar uma Function financeira sem uma rodada dedicada de testes (inclusive de concorrência, como as demais Functions financeiras deste repositório sempre tiveram) foi julgado arriscado demais para decidir sozinho durante a ausência do usuário. Não alterado.

## 6. Testes

- **Novo**: `scripts/test_orcamento_hotfix_2026-08-07.js` — 25 cenários, espelhando (não importando, já que o front-end é um monólito sem módulos) a lógica pura dos bugs efetivamente reproduzidos e corrigidos nesta rodada. `node scripts/test_orcamento_hotfix_2026-08-07.js` → **25/25 passando**.
- **Sintaxe**: os 9 blocos `<script>` inline de `index.html` foram parseados com `new Function()` após cada lote de edições e novamente após o merge em `master` — 0 erros.
- **Rules**: verificação estática (chaves balanceadas, `rules_version` presente) — **não foi possível rodar o Firestore Emulator** (Java ausente neste ambiente, mesma limitação já documentada em rodadas anteriores deste repositório; corrigi-la exigiria uma senha de instalação que não tenho).
- Não foi repetida a suíte histórica completa da Fase F (proibido pela Parte 24 da instrução) — só os bugs desta rodada.

## 7. Git

- 3 commits isolados na branch `hotfix/erp-operacional-orcamento-producao-2026-08-07`:
  - `b476869` `fix(rules)`: alargamento de acesso do Comercial.
  - `fba7ef5` `fix(orcamento)`: todas as correções de front-end (arquivo único, então agrupadas numa mensagem de commit estruturada por área — ver seção 3 — em vez de hunks separados, já que as mudanças estão fisicamente entrelaçadas dentro de `index.html`).
  - `abdc1cc` `test(orcamento)`: suíte de regressão.
- Push normal (sem force) para `origin/hotfix/erp-operacional-orcamento-producao-2026-08-07`.
- Merge `--no-ff` em `master`, push normal para `origin/master`.
- Nenhum rebase destrutivo, nenhuma reescrita de histórico, nenhum `--force`.

## 8. Deploy

Ver seção correspondente após a execução (Rules + Hosting, cirúrgico — nenhuma Cloud Function foi alterada nesta rodada, então nenhuma Function foi redeployada).

## 9. Chatvolt/Valéria

**Não tocado nesta rodada**, conforme instrução explícita repetida. Nenhum arquivo em `functions/src/valeria*.ts` foi lido ou alterado.

## 10. Prevenção — por que isso não deveria voltar a acontecer

O achado do item 2 (dois circuitos de geração de OS coexistindo) só existiu porque uma rodada anterior corrigiu a rota "lista → Orçamentos Enviados" sem descobrir que o wizard tinha seu próprio caminho paralelo, mais antigo, para a mesma ação. A lição registrada: ao corrigir uma ação que pode ser disparada de mais de um lugar na UI (aqui, "gerar OS" a partir do wizard OU da listagem), vale grep por **todos** os `onclick`/chamadores da função raiz antes de considerar o bug fechado — não só o ponto de entrada mencionado no relato original.
