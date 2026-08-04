# Harness de validação funcional — Bloco 2/3 (fechamento técnico)

Este documento registra o harness de teste executado ao vivo no navegador
contra o **código real** de `index.html` (não mirror-tests), sem tocar o
Firestore real, na sessão de fechamento técnico de 2026-08-04.

## Por que este harness existe

Uma rodada anterior desta sessão classificou os 11 itens do Bloco 2/3 como
"concluídos" apoiada em mirror-tests (Node, lógica reescrita à mão) e smoke
tests estruturais (`typeof fn === 'function'`). Isso foi corretamente
apontado como evidência insuficiente: prova que o código *existe* e que uma
cópia da lógica funciona, não que o *código real*, rodando no DOM real,
produz o comportamento certo.

Este harness roda as **funções reais** de `index.html` — carregadas via
servidor estático local, no motor JS real do navegador — contra uma
**fixture local descartável**, nunca contra o Firestore de produção.

## Por que não usei o Firebase Emulator Suite

Tentado: `firebase emulators:start --only firestore`. Falhou — o ambiente
não tem Java instalado (`Unable to locate a Java Runtime`), pré-requisito
do emulador de Firestore. Instalar um JDK está fora do escopo autorizado
desta sessão (mudança de ambiente do sistema). Alternativa adotada: mock
fiel da semântica transacional do Firestore (ver seção "Mock de Firestore"
abaixo), que reproduz o contrato real de `runTransaction` (leitura
otimista + reexecução automática em conflito), não apenas um stub burro.

## Como nenhum dado real foi tocado

1. `window._db` é totalmente substituído por um mock em memória
   (`makeFakeFirestore()`) antes de qualquer teste — nenhuma chamada
   `.collection()/.doc()/.get()/.set()/.runTransaction()` atinge a rede.
2. `window._cloudSave`, `_cloudLoad`, `_cloudWatch` viram stubs locais —
   `_cloudSave` grava um log em memória (`__HARNESS_LOG.cloudSaveCalls`)
   em vez de escrever no Firestore.
3. Confirmado por `read_network_requests` (filtro `firestore`) ao final da
   bateria de testes: **zero requisições de rede para o Firestore**
   registradas durante toda a sessão de testes.
4. `window.confirm`/`window.prompt` viram funções scriptáveis (filas
   `__confirmQueue`/`__promptQueue`) — nenhum diálogo real, nenhuma
   interação humana necessária.
5. `window.open` é interceptado (`__HARNESS_LOG.opens`) — nenhuma aba do
   WhatsApp (`wa.me`) é aberta de verdade.
6. `KB_OS`, `STOCK`, `COMPRAS`, `FIN_CP`, `_ORC_ENVIADOS_DATA` foram
   substituídos por objetos fixture locais com IDs claramente fictícios
   (`osA`, `osB`, `pcCancelTeste`, `ORC-1`, etc.) — nunca IDs reais.

## Reprodução

```bash
# 1. Servir o app estaticamente (sem tocar produção)
firebase hosting:channel ... # ou qualquer servidor estático apontando para index.html

# 2. Abrir no navegador e, no console, colar o script de setup do harness
#    (bloco "Setup" abaixo), depois os blocos de cada fluxo em sequência.
```

## Setup (cole primeiro, sempre)

```js
window.__HARNESS_LOG = { cloudSaveCalls: [], toasts: [], opens: [], auditCalls: [] };
window._cloudSave = function(key, data){ window.__HARNESS_LOG.cloudSaveCalls.push({ key, snapshot: JSON.parse(JSON.stringify(data)) }); };
window._cloudLoad = function(key, cb){ cb(null); };
window._cloudWatch = function(key, cb){};

function makeFakeFirestore(){
  var store = {};
  function docRef(path){
    return {
      __path: path,
      get: function(){ var d = store[path]; return Promise.resolve({ exists: !!d, data: function(){ return d ? d.data : undefined; }, __version: d ? d.version : 0 }); },
      set: function(data){ store[path] = { data, version: (store[path]?store[path].version:0)+1 }; return Promise.resolve(); }
    };
  }
  return {
    __store: store,
    collection: function(col){ return { doc: function(id){ return docRef(col+'/'+id); } }; },
    runTransaction: function(updateFn, _attempt){
      _attempt = _attempt || 1;
      if (_attempt > 20) return Promise.reject(new Error('too many retries'));
      var path = null, versionAtRead = null;
      var txn = {
        get: function(ref){ path = ref.__path; return ref.get().then(function(snap){ versionAtRead = snap.__version; return snap; }); },
        set: function(ref, data){ txn.__pendingRef = ref; txn.__pendingData = data; },
        update: function(ref, data){ txn.__pendingRef = ref; txn.__pendingData = Object.assign({}, store[ref.__path]?store[ref.__path].data:{}, data); }
      };
      return Promise.resolve(updateFn(txn)).then(function(result){
        var currentVersion = store[path] ? store[path].version : 0;
        if (currentVersion !== versionAtRead) return this.runTransaction(updateFn, _attempt+1);
        if (txn.__pendingRef) store[path] = { data: txn.__pendingData, version: currentVersion+1 };
        return result;
      }.bind(this));
    }
  };
}
window._db = makeFakeFirestore();

window.__confirmQueue = []; window.__promptQueue = [];
window.confirm = function(msg){ window.__HARNESS_LOG.lastConfirmMsg = msg; return window.__confirmQueue.length ? window.__confirmQueue.shift() : false; };
window.prompt = function(msg, def){ window.__HARNESS_LOG.lastPromptMsg = msg; return window.__promptQueue.length ? window.__promptQueue.shift() : null; };
window.open = function(url){ window.__HARNESS_LOG.opens.push(url); return { closed:false }; };
window.showToast = function(msg, type){ window.__HARNESS_LOG.toasts.push({msg, type}); };
window._currentSession = { user:'Teste Harness', email:'harness@local.test', funcao:'master' };
```

## Resultados obtidos nesta sessão (2026-08-04)

Todos os itens abaixo foram exercitados chamando **diretamente as funções
reais** do app (não mirror), com asserções via `JSON.stringify(...)` lido
de volta pelo agente.

| # | Fluxo | Função(ões) real(is) exercitada(s) | Resultado |
|---|---|---|---|
| 2.1 | Numeração concorrente | `comprasProximoNumeroAtomico()` | 5 chamadas concorrentes → `[1,2,3,4,5]`, zero colisão, contador remoto = 5 |
| 2.2 | Vínculo por ID + ambiguidade | `comprasResolverMaterialPorNome()` | nome único resolve direto; nome ambíguo lista opções e exige confirmação; cancelar cai para `null` (fallback textual) |
| 2.3 | Recebimento parcial + AP | `comprasReceberModal()`, `comprasResumoValores()` | 3 entregas parciais/total → estoque +1+1+1 (nunca duplicado), 3 Contas a Pagar distintas (uma por entrega, idempotente), `valorPedido` imutável, `valorFaturado` só conta entregas com NF |
| 2.3 | Reentrância | `comprasReceberModal()` chamando a si mesma de dentro do `prompt` | 2ª chamada bloqueada com toast "já em andamento"; só 1 recebimento processado |
| — | Cancelamento preserva histórico | `comprasCancelar()` | `historico` cresce (nunca é apagado); `cancelJustificativa` gravada |
| 1 | Iniciar produção com material disponível | `kbConfirmarProd()` | status→`producao`, `matProd` populado, estoque memória+remoto -2, `inicioProducaoTs` gravado |
| 9 | Duplo/triplo clique em iniciar produção | `kbConfirmarProd()` × 3 chamadas seguidas | só 1 baixa de estoque (delta=1, não 3) — trava `_kbProdSubmitting` confirmada |
| 2 | Falta de material, usuário comum | `kbConfirmarProd()` | oferece registrar solicitação; `comprasSolicitarDeOS` chamada com dados corretos; OS não avança |
| 4 | Iniciar com autorização, master | `kbConfirmarProd()` | avança mesmo com falta; `secAuditLog('producao_autorizada', ...)` chamado com usuário e motivo |
| 5 | Marcar Pronta + persistir após reload | `kbMarcarPronto()` | `kbSaveKbos()` chamado; payload capturado reconstruído simulando reload → status "pronta" sobrevive |
| 6 | OS Pronta com saldo em aberto | `kbMarcarPronto()` | toast de alerta específico do saldo pendente (R$500) |
| 7 | Bloquear entrega com saldo | `osLiberar()` sem justificativa | toast "Entrega cancelada — saldo pendente não autorizado"; status inalterado |
| 8 | Liberar entrega por exceção auditada | `osLiberar()` com justificativa | status→`entregue`, `restante` mantido (500 — dívida aberta), `secAuditLog('os_entrega_excecao', ...)` gravado com a justificativa |
| 16 | Orçamento com NF aparece no Relatório Fiscal | `relFiscalGetFiltrados()`, `relFiscalRender()` | só o orçamento com `nfSolicitada:true` aparece; HTML mostra o cliente |
| 17 | Alterar situação fiscal | `relFiscalSetStatus()` | "emitida" sem número falha; com número funciona e grava `numeroNF` |
| 18 | Orçamento → aguardando_pagamento → pago | `orcEnvGerarOS()`, `kbReceberSaldo()` | 50/50 gera OS com `restante`; orçamento vira `aguardando_pagamento`; ao receber o saldo, orçamento vira `pago` |
| 21 | Consumível Não→Sim→Não antes de Salvar | `orcItemExtraPreview()` | cada mudança recalcula `ORC_ITEM_EXTRAS` e chama `orcRecalc()` imediatamente, sem precisar salvar |
| 22 | Cancelar descarta alterações do consumível | `orcItemExtrasFechar()` | snapshot restaurado corretamente; reabrir mostra o valor persistido (confirmado no elemento real dentro do overlay) |
| 26 | Revisão e adiamento do markup | `cfgSalvar()`, `cfgMarkupAdiar()`, `cfgMarkupRevisaoStatus()` | salvar sem mudar overhead/vrml/impostos NÃO registra revisão; mudar registra com histórico antes/depois; adiar empurra prazo sem tocar valores |
| 27 | Permissões (4 perfis) | `secApplyPerms()` | roda sem erro para master/financeiro/comercial/producao; item "Compras" segue o mesmo grupo/padrão dos módulos operacionais existentes (nenhum controle de visibilidade dedicado foi adicionado nesta sessão) |
| 29 | Ausência de erros no console | — | `read_console_messages(onlyErrors:true)` vazio ao final de toda a bateria |
| 30 | Ausência de gravações no backend real | — | `read_network_requests` (filtro `firestore`) retornou zero requisições |

## Rodada de fechamento v3 — modelagem financeira de Compras (2026-08-04, continuação)

A v2 do módulo de Compras (uma Conta a Pagar por evento de recebimento) foi
corretamente apontada como incompatível com "obrigação única por documento/
parcela". Reprojetado para: **recebimento físico** (nunca cria CP) →
**documento** do fornecedor (pode cobrir 1+ recebimentos, idempotente por
número) → **parcelas** (cada uma com CP própria, id determinístico
`cppar_<documentoId>_p<N>`) → enquanto não há documento, **uma única**
obrigação provisória por compra (`cpprov_<pcId>`, sempre sincronizada como
`recebido − documentado`, nunca duplicada).

Todos os 9 cenários pedidos, exercitados com as **funções reais**
(`comprasReceberModal`, `comprasAdicionarDocumento`,
`comprasSincronizarObrigacaoProvisoria`, `comprasResumoValores`) contra o
mesmo mock de Firestore, usando `JSON.parse(JSON.stringify(...))` para
capturar snapshots (evitando o falso-negativo de ler uma referência viva
mutada por uma chamada seguinte — armadilha real encontrada e corrigida
durante os testes, documentada abaixo):

| # | Cenário | Resultado real observado |
|---|---|---|
| 1 | 3 recebimentos físicos (10+10+10) + 1 nota (NF-1001, R$3000) cobrindo tudo em 2 parcelas | Estoque soma corretamente (30); **1 única** CP provisória de R$3000 antes do documento; após o documento, provisória vira `conciliada` (valor 0), 2 parcelas de R$1500 criadas; total de CPs ativas = R$3000 (nunca R$6000 — não duplica) |
| 2 | 2 recebimentos físicos + 2 documentos diferentes (NF-A cobre o 1º, NF-B cobre o 2º) | Após NF-A, provisória concilia; após o 2º recebimento (sem documento ainda), provisória **reabre** sozinha com o novo saldo (R$500); após NF-B, concilia de novo; total de CPs ativas = R$1000, nunca duplicado |
| 3 | Recebimento sem documento | Provisória fica `aguardando_documento` indefinidamente, sem CP fantasma extra |
| 4 | Inclusão posterior do documento | Mesmo cenário 2 — a provisória reabre exatamente pelo valor não coberto quando chega um novo recebimento sem documento correspondente |
| 5 | Clique duplicado (reentrância real, disparada de dentro do `prompt` da 1ª chamada) | 2ª chamada bloqueada (`_comprasRecebendoIds`); só 1 recebimento processado, estoque não duplicou |
| 6 | Recarregamento | `COMPRAS`/`FIN_CP` serializados, destruídos e reconstruídos a partir do payload — `comprasResumoValores` recalcula exatamente os mesmos valores |
| 7 | Cancelamento (com recebimento parcial e documento já registrados) | `recebimentos`, `documentos` e `historico` preservados integralmente; só `status`+`cancelJustificativa` mudam; estoque já recebido fisicamente não é estornado |
| 8 | Pagamento parcial (de uma das 2 parcelas de NF-1001, via `_finCPPagarConfirmar` já existente) | `valorPago=1500` (só a parcela paga), `valorAPagar=1500` (a outra), a parcela não paga continua `agendado` |
| 9 | Conciliação compra↔estoque↔Contas a Pagar | Em todos os cenários acima: `valorRecebido` sempre bate com o estoque físico somado; `valorAPagar` nunca conta provisória+definitiva juntas para o mesmo valor |

**Achado de processo**: o primeiro teste do cenário 2 deu um falso-negativo
(provisória aparecia "conciliada" quando deveria estar "reaberta") — causa
raiz era o *script de teste* capturando uma referência viva ao objeto
`FIN_CP` que foi mutada por uma chamada seguinte antes da leitura, não um
bug no código real. Corrigido usando `JSON.parse(JSON.stringify(...))`
para snapshots e reconfirmado. Registrado aqui por transparência.

Interpretação de "pagamento parcial de uma parcela": tratado como pagar
uma das N parcelas de um documento (não fracionar o valor de uma única
Conta a Pagar em dois pagamentos) — a infraestrutura de Contas a Pagar já
existente (`_finCPPagarConfirmar`) só suporta status binário pago/agendado
por lançamento, não valor parcial dentro de um lançamento; implementar
pagamento fracionado de uma única CP seria uma funcionalidade nova maior,
fora do escopo desta rodada — decisão documentada.

## Sanitização de SVG (seção 15, segurança — achado real, não teórico)

Auditoria encontrou **3 pontos** onde `svgData` (conteúdo bruto de arquivo
`.svg` enviado pelo usuário via `FileReader.readAsText`) era inserido
diretamente em `innerHTML` sem NENHUMA sanitização — incluindo um ponto
(`planSvgParsePecas`, linha ~22177) que insere num `<div>` posicionado fora
da tela (`left:-9999px`), o que **não impede a execução** de `<script>`/
`on*` — só o torna invisível ao olho. XSS armazenado real: qualquer usuário
com acesso ao cadastro de produto conseguiria fazer upload de um `.svg`
com `<script>` e ele executaria para qualquer outro usuário que abrisse a
planificação, o produto, ou reprocessasse peças.

Corrigido com `svgSanitizar()` (DOMParser/XMLSerializer nativos, sem
dependência externa): rejeita arquivos que não são SVG XML válido; remove
`<script>`, `<foreignObject>`, `<iframe>`, `<embed>`, `<object>`, `<link>`,
`<meta>`, `<style>`; remove todo atributo `on*`; remove `href`/`xlink:href`/
`src` com `javascript:` ou apontando para URL externa (`http(s)://`).
Aplicada em 4 pontos: upload (`planProdEspSvgChange`), as duas telas de
exibição direta (defesa em profundidade — cobre SVGs legados salvos antes
desta correção existir), e dentro de `planSvgParsePecas` (que sozinha já
cobre todos os seus call sites, incluindo dados legados).

**Bug real encontrado e corrigido durante o próprio teste**: a primeira
versão da função buscava tags perigosas via
`doc.getElementsByTagName('foreignobject')` (minúsculo) — que é
**case-sensitive em documentos XML/SVG** (diferente de HTML) e não
encontrava `<foreignObject>` (camelCase, grafia real do spec SVG), então
essa tag específica passava incólume. Corrigido comparando `nodeName`
normalizado em minúsculas em vez de confiar no case exato do parâmetro de
`getElementsByTagName`.

Testes reais executados no navegador (não mirror — Node não tem
`DOMParser` sem `jsdom`, que não foi instalado por não ser necessário para
o resto da suíte):
- 10 amostras (SVG válido, `<script>` minúsculo/maiúsculo, `onload`,
  `<image onerror>`, `href="javascript:..."`, `<foreignObject>` minúsculo/
  maiúsculo, `<iframe>`, `<style>@import`) — todas neutralizadas
  corretamente (zero `<script>`, zero `on*`, zero `javascript:`, zero
  `foreignObject`, zero `<iframe>`, zero `<style>` no resultado), SVG
  válido preservado intacto.
- Arquivo não-SVG, vazio e SVG malformado — todos rejeitados (`null`).
- **Teste end-to-end real**: `File`+`DataTransfer`+`FileReader` reais
  (não simulação de string) com um `.svg` contendo `<script>`, `onload` e
  `<image onerror>` simultaneamente, passado por `planProdEspSvgChange()`
  → sanitização → armazenamento → `planSvgParsePecas()` (que insere via
  `innerHTML`) → extração de peças. Resultado: `window.__XSS_EXECUTOU`
  permaneceu `false` durante todo o pipeline; SVG armazenado ficou limpo
  (`<image href="x" width="10" height="10"/><rect width="50" height="50"/>`,
  sem nenhum vetor); sistema continuou funcional (extraiu peças, toast de
  sucesso) — a sanitização não quebrou o uso legítimo.

## Rodada de fechamento v4 — PDF A4 real (curto e longo)

Objetivo: sair do "testado por leitura de código" e gerar o HTML real
que o botão "Imprimir/Salvar PDF" produz, a partir da função real
`orcImprimirOrcamentoPDF()`, sem tocar o Firestore.

Técnica: `window.open` foi interceptado (retorna um objeto fake cujo
`document.write(html)` acumula o HTML em `window.__pdfCapturado` em vez
de abrir uma popup real — popup real não se comporta como esperado neste
ambiente de automação). O HTML capturado foi salvo em arquivo e servido
pelo mesmo servidor HTTP local do preview (`file://` trava navegação
neste ambiente), permitindo screenshot real do resultado renderizado.

- **Orçamento curto** (2 itens, parcelamento 6x com acréscimo ativo,
  desconto Pix 5% ativo, sem condição comercial): HTML capturado
  (6.168 caracteres), renderizado e fotografado. Confirmado visualmente:
  layout A4, marca VR Marcas, dados do cliente, tabela de itens com
  matemática correta, "Total Geral R$ 950,00" (1000 × 0,95), texto
  "Parcelável em até 6x de R$ 167,82 (parcelas com acréscimo)" (não
  afirma "sem juros" pois a taxa real de 6x é > 0 — paridade com a regra
  usada no WhatsApp via `orcCalcCondicoesPagamento()`), "5% de desconto
  pagando via PIX", rodapé com CNPJ/endereço, nenhum dado de custo
  interno visível.
- **Orçamento longo** (25 itens, parcelamento 6x + Pix 5% ativos):
  HTML capturado (19.515 caracteres), 25 linhas presentes, "Total Geral
  R$ 23.750,00" e "6x de R$ 4.195,44 (parcelas com acréscimo)" corretos.
  Auditoria de posição de cada `<tr>` via `getBoundingClientRect()`
  confirmou as 25 linhas com altura uniforme (61px), sem sobreposição e
  sem lacuna — nenhum item foi perdido ou duplicado ao reabrir/rolar.
  **Achado real (não teórico) antes da correção**: o CSS de impressão
  não tinha nenhuma regra `page-break-inside`/`break-inside`. Medindo a
  posição de cada linha contra os limites de página A4 (1123px @96dpi),
  4 das 25 linhas caíam exatamente sobre uma quebra de página — ou seja,
  ao imprimir de verdade, aquelas linhas seriam cortadas ao meio entre
  duas páginas. **Corrigido** em `index.html` (ambos os templates, VR
  Marcas e Vitre, dentro do bloco `@media print` de
  `orcImprimirOrcamentoPDF()`): adicionado
  `tr{page-break-inside:avoid;break-inside:avoid}`,
  `.total-row,.client-grid,.hdr{page-break-inside:avoid;break-inside:avoid}`
  e `thead{display:table-header-group}` (repete o cabeçalho da tabela em
  cada página). Recapturado após a correção: `hasBreakCSS:true`
  confirmado no HTML gerado pela função real.
  **Limitação honesta**: a verificação acima prova (a) que o conteúdo
  transborda uma página A4 única com 25 itens (~2.287px de conteúdo vs
  ~1.123px por página, portanto paginação múltipla é real) e (b) que a
  regra CSS padrão para evitar corte de linha agora está presente no
  HTML gerado. Ela **não** prova pixel-a-pixel como o motor de impressão
  do Chrome vai paginar o conteúdo real, pois as ferramentas de
  automação deste ambiente renderizam em fluxo de tela contínuo, não no
  modo de paginação de impressão real (`window.print()` não pôde ser
  disparado/inspecionado headless aqui). `page-break-inside`/
  `break-inside:avoid` em `<tr>` é comportamento padrão e amplamente
  suportado pelos motores de impressão de todos os browsers evergreen
  (incluindo Chrome), mas o resultado exato não foi confirmado via um
  PDF real gerado por `window.print()`/impressora virtual.

## Rodada de fechamento v5 — múltiplos SVGs/peças com clique real de DOM

Objetivo: sair de "chamada de função via console" para interação real —
`.click()` em botões reais, `dispatchEvent(new Event('input'))` em campos
reais, upload real via `File`+`DataTransfer` — na tela "📐 Produtos &
Receitas de Planificação" (`pg-config-plan`), usando o mesmo harness
(sessão fake `funcao:'master'`, `_cloudSave`/`_cloudLoad`/`_cloudWatch`
stubados, zero gravação real).

Fluxo exercitado com cliques/eventos reais, nesta ordem: `nav('config-
plan')` → clique real em "+ Novo Produto" → digitação real do nome →
2× clique real em "+ Adicionar Espessura" → preenchimento real dos
campos espessura/descrição → **upload real** (`File`+`DataTransfer`) de
um SVG com 2 peças na 1ª espessura e outro SVG com 1 peça na 2ª
espessura → clique real no "✕" para remover um SVG → reupload real →
clique real em "+ Adicionar Peça" → edição real dos campos da peça
manual (fórmulas `L - 2*e` / `A - e`) → clique real em "✕" para remover
uma peça → conferência da pré-visualização de área ao editar `L` real →
clique real em "💾 Salvar Produto" → clique real em "✏️ Editar" para
reabrir → produto legado (1 SVG único, sem `planificacoes[]`) inserido
diretamente no array e reaberto via clique real em "Editar" → clique
real em "🔍 Extrair Peças" para re-extrair.

**Achado real #1 (crítico, não teórico)**: `planSvgParsePecas()` fazia
`_planProdPecas = deduped` — substituição total da lista de peças a
cada parse. Efeito real observado: subir o SVG da 2ª espessura apagava
silenciosamente as peças já extraídas da 1ª (toast de sucesso "✅ 1
peças extraídas" escondia que as 2 peças anteriores tinham sumido da
tabela). Isso quebra diretamente o cenário pedido pelo usuário — "produto
com 2+ SVGs, diferentes materiais/espessuras". **Corrigido**: cada peça
extraída agora carrega uma `__src` (`idx` da espessura + índice do SVG);
o merge deixou de ser substituição total e passou a ser "substitui
apenas as peças da MESMA origem, preserva as demais" — replicado com
`data-src` no `<tr>` para sobreviver a edições manuais no DOM, e
`planProdEspSvgClear()` agora remove só as peças daquela origem ao
excluir um SVG. Reverificado com clique real: upload SVG A (2 peças) →
upload SVG B (1 peça) → tabela com as 3 peças coexistindo.

**Achado real #2 (found durante a verificação do achado #1)**: com o
merge por origem implementado, reabrir um produto salvo e clicar
"🔍 Extrair Peças" de novo duplicava a peça, porque a peça carregada do
`pecas[]` salvo não tinha `__src` (o `planProdSalvar()` não persistia
esse campo) — então nunca batia com a origem da nova extração e ambas
ficavam na tabela. **Corrigido**: `__src` agora é persistido em
`pecas[]`. Reverificado com clique real (produto salvo → reaberto →
"Extrair Peças" de novo): 1 peça antes, 1 peça depois — sem duplicação.
**Limitação residual documentada, não escondida**: produtos legados que
já existiam no Firestore *antes* desta correção (peças sem `__src`
registrado) ainda podem duplicar se o usuário reabrir e clicar
"Extrair Peças" de novo sem antes remover a peça antiga manualmente —
o sistema não tem como inferir retroativamente qual peça veio de qual
SVG num produto salvo antes desta mudança. Não é perda de dado (a peça
duplicada pode ser removida com um clique), mas fica registrado aqui em
vez de reportado como "resolvido" sem ressalva.

**Demais pontos confirmados com clique/evento real**: produto legado
(campo `svg` único, sem `svgs[]`) migra automaticamente ao reabrir via
clique em "Editar" — preview do SVG e peça antiga aparecem corretos;
peça manual via "+ Adicionar Peça" convive com peças extraídas de SVG
sem se misturar; remoção de peça via "✕" real não deixa buraco nem
duplica linha; pré-visualização de área (`planPrevResult`) recalcula ao
vivo tanto ao editar peças quanto ao editar L/A globais; salvar → reabrir
via clique real preserva nome, espessuras, SVGs (miniaturas renderizam) e
peças (incluindo fórmulas de largura/altura). Nenhum handler de
`keydown`/Enter ou `dblclick` existe nesta tela (grep confirmou) — não
há, portanto, interação de teclado/duplo-clique a testar aqui além do
clique simples já coberto.

Todos os 197 testes mirror (`scripts/test_*.js`) foram reexecutados após
as duas correções acima e continuam passando (nenhum mirror cobre esta
lógica específica de merge de peças — ela só existe na função real,
por isso só foi pega pelo teste de clique real, não pelos mirrors).

## Rodada de fechamento v6 — permissões por perfil (Master/Financeiro/Comercial/Produção)

Objetivo: verificar, para os 4 perfis, tanto a **visibilidade** (itens
de menu escondidos) quanto o **bloqueio dentro dos próprios handlers**
(o que acontece se a página for aberta por um caminho que não passa pelo
clique no menu — nomeadamente, chamando `nav(pagina, null)` diretamente,
que é exatamente o que qualquer botão, atalho ou futuro código faria).

Método: sessão fake (`window._currentSession = {funcao: <role>}`) sem
tocar Firebase Auth real, `secApplyPerms(funcao)` chamado (função real,
não mirror) para aplicar a visibilidade da sidebar, depois `nav(pagina,
null)` chamado (função real) para cada página sensível, lendo
`getComputedStyle(...).display` e `pg-<pagina>.style.display` — nenhuma
gravação no Firestore em nenhum passo.

**Achado real (antes da correção)**: o app tinha **três listas de
bloqueio por perfil hardcoded, independentes e divergentes** —
`nav()` (`_navDeny`), `authApplySession()` (`_authDeny`) e
`secApplyPerms()` (`HARD_DENY`). Rodando o teste acima antes de tocar no
código:
- **Perfil Financeiro**: a sidebar escondia corretamente os botões de
  "Criação de Usuários" e "Segurança", mas `nav('config-usr', null)` e
  `nav('seguranca', null)` **retornavam sucesso** (a página abria) —
  porque `nav()` não tinha NENHUMA entrada para o perfil `financeiro`
  em sua lista. Ou seja: a interface escondia o botão, mas o handler por
  trás dele não bloqueava nada se acionado por qualquer outro caminho
  (console, um link direto, um botão futuro mal configurado).
- **Perfis Comercial e Produção**: `nav('dashboard', null)` também
  abria a página, mesmo com o item de menu escondido — as outras duas
  listas já bloqueavam `dashboard` para esses perfis, só `nav()` não.

**Corrigido**: as três listas foram unificadas numa única constante
(`PERFIL_HARD_DENY`), usada por `nav()`, `authApplySession()` e
`secApplyPerms()`. Reverificado com o mesmo teste real após a correção:
Financeiro agora tem `config-orc`/`config-plan`/`config-usr`/`seguranca`
bloqueados em `nav()` (antes: liberado); Comercial e Produção têm
`dashboard` bloqueado em `nav()` (antes: liberado). Master continua
irrestrito em todas as páginas testadas. Os 197 testes mirror
(`scripts/test_*.js`) foram reexecutados após a correção e continuam
passando.

**Limitação honesta, registrada e não escondida (autorização efetiva
depende de Rules)**: a correção acima fecha uma inconsistência real
entre "o que a UI esconde" e "o que o handler de navegação bloqueia" —
mas isso ainda é 100% lógica client-side. Duas ressalvas concretas,
verificadas nesta sessão, não presumidas:
1. Funções que gravam dados sensíveis (ex.: `usrSalvarPerms()`, que
   reescreve a matriz de permissões inteira) **não têm nenhuma
   verificação de perfil dentro de si mesmas** — hoje elas só ficam
   inacessíveis por estarem numa página que `nav()` agora bloqueia
   corretamente. Uma chamada direta a `usrSalvarPerms()` via console,
   por um usuário autenticado com qualquer perfil, ainda executaria a
   função no cliente.
2. A matriz de permissões configurável (checkboxes da tela 🔐
   Segurança, `_PERM_DATA`) hoje só é lida por `secApplyPerms()` para
   decidir visibilidade da sidebar — `nav()` só consulta a lista rígida
   `PERFIL_HARD_DENY`, não a matriz configurável. Ou seja: se o Master
   desmarcar, por exemplo, "Fornecedores" para o perfil Comercial na
   tela de Permissões, o item some do menu, mas `nav('fornecedores',
   null)` continua funcionando se chamado diretamente (verificado).
   Isso não é uma regressão desta sessão — é como o sistema já se
   comportava — mas fica registrado por não ter sido corrigido aqui
   (mudar isso significaria decidir, para cada um dos ~25 módulos, se
   ele deveria virar bloqueio rígido, o que é uma decisão de produto
   fora do escopo desta rodada de testes).

Em ambos os casos, a única barreira que realmente impede um usuário
autenticado de ler/gravar dados fora do seu perfil, contornando toda a
lógica de tela e de `nav()` descrita acima, são as **Firestore Security
Rules** — que não foram e não podem ser alteradas nesta tarefa.
**Registro objetivo, na forma pedida**: a interface está protegida (e
mais consistente agora do que antes desta rodada); a autorização
efetiva do backend depende de Rules e permanece fora do alcance desta
branch.

## O que este harness NÃO prova

- Login real via Firebase Auth (não testado — precisaria de credenciais).
- Round-trip real de gravação/leitura no Firestore de produção (o mock
  prova a *lógica* de transação, não a infraestrutura real do Firebase).
- Paginação pixel-a-pixel do PDF A4 real gerado por `window.print()` —
  ver "Rodada de fechamento v4" acima para o que foi e não foi provado
  sobre quebras de página.
- Duplicação de peça ao re-extrair SVG em produtos **legados salvos
  antes desta correção** (sem `__src` persistido) — ver "Achado real #2"
  acima. Produtos criados/salvos a partir de agora não sofrem disso.
- Autorização de backend real por perfil (Firestore Rules) — ver
  "Rodada de fechamento v6" acima. O que foi testado e corrigido é
  exclusivamente a camada de UI/handler client-side.
- Interação humana real com os botões (cliques/toques) fora da tela de
  Produtos & Planificação e do PDF A4 — as funções de outras telas
  (Compras, financeiro, etc.) continuam validadas via chamada direta de
  função, não via `click()` simulado no DOM. Os elementos-alvo
  (`kbEntregarBtn`, etc.) foram confirmados presentes e com `onclick`
  correto num teste anterior desta sessão, mas o disparo real de evento
  de clique não foi reexercitado para eles nesta rodada.

## Rodada de homologação isolada v7 — Firebase Emulator Suite real (bloqueador de produção encontrado)

Resposta a uma segunda rodada de crítica do usuário: as rodadas anteriores
provaram lógica de negócio (mock fiel) e handlers client-side, mas nunca
integração real de transações contra o Firestore, nem autorização efetiva
via Firestore Rules reais. Esta rodada resolve isso.

**Setup**: OpenJDK 21 via Homebrew (autorizado explicitamente pelo
usuário), Firebase Emulator Suite real (`firebase emulators:start
--project demo-erp-homolog --only auth,firestore,hosting`), `firestore.rules`
exatas do repositório carregadas automaticamente pelo emulador (nunca
alteradas), 4 usuários reais no Auth Emulator com custom claim `role`
(master/financeiro/comercial/producao) e fixtures `erp_vr/*` mínimas via
Admin SDK. `index.html` ganhou um hook opt-in (`_HOMOLOG_MODE`) que só
ativa com `(localhost|127.0.0.1)` + `?emulator=1` explícito na URL —
sem isso o app se comporta exatamente como hoje, apontando pro projeto
real. Confirmado por config (`firebase.app().options.projectId`) e por
log (`[HOMOLOG] ... NÃO é o backend de produção`).

**Achado crítico #1 (bloqueador de produção)**: `firestore.rules` nunca
foi atualizada para o perfil `financeiro`, que existe e é validado em
todo o resto do sistema (Cloud Function `adminUsers.ts` aceita
`financeiro` em `VALID_ROLES`; client-side `PERM_DEFAULT`/
`PERFIL_HARD_DENY` tratam `financeiro` como perfil de primeira classe).
`isAnyStaff()` só inclui `['master','admin','comercial','producao']`.
Resultado medido via REST puro (Bearer token real, sem SDK, sem cache —
tabela completa abaixo): **um usuário financeiro autenticado não
consegue nem logar** (a leitura de `erp_vr/erp_usuarios`, "fonte da
verdade" do perfil no login, retorna 403 para financeiro) — comprovado
com um login real na UI mostrando "⛔ Conta sem perfil atribuído".

**Achado crítico #2 (bloqueador de produção)**: o catch-all de
`erp_vr/{docId}` (`allow write: if isAdmin();`) significa que **apenas
Master pode gravar a maioria das coleções do sistema**. Medido via REST
com token real de cada perfil:

| Documento (erp_vr/) | master | financeiro | comercial | producao |
|---|---|---|---|---|
| erp_usuarios (READ) | 200 | **403** | 200 | 200 |
| erp_config (WRITE) | 200 | 403 | 403 | 403 |
| fin_tx (WRITE) | 200 | 403 | 403 | 403 |
| crm_leads (WRITE) | 200 | 403 | 200 | 403 |
| kb_os (WRITE) | 200 | 403 | 403 | 200 |
| **orcamentos (WRITE)** | 200 | 403 | **403** | 403 |
| **compras (WRITE)** | 200 | 403 | 403 | **403** |
| fin_cp (WRITE) | 200 | 403 | 403 | 403 |
| erp_plan_produtos (WRITE) | 200 | 403 | 403 | 403 |
| erp_fornecedores (WRITE) | 200 | 403 | 403 | 403 |

Ou seja: **Comercial não consegue salvar um orçamento enviado** (sua
função central) e **Produção não consegue gravar uma solicitação de
compra** (fluxo "solicitar compra a partir da OS", construído e testado
nesta mesma branch) — contra o backend real. Hoje, na prática, só
Master/admin fazem qualquer coisa além de Kanban/Estoque (produção) e
CRM (comercial).

**Proposta de correção (NÃO aplicada — Rules de produção fora do
escopo desta tarefa)**: adicionar `isFinanceiro()` e trocar o catch-all
por regras por-documento equivalentes ao que já existe no client-side
(`PERM_DEFAULT`/`PERFIL_HARD_DENY`), por exemplo:
```
function isFinanceiro() { return isAuthenticated() && (userRole()=='financeiro' || userRole()=='master' || userRole()=='admin'); }
function isAnyStaff() { return isAuthenticated() && userRole() in ['master','admin','comercial','producao','financeiro']; }
...
allow write: if isComercial() && docId in ['crm_leads','crm_prospects','crm_reativacao','orcamentos'];
allow write: if isProducao() && docId in ['kb_os','erp_stock','compras'];
allow write: if isFinanceiro() && docId in ['fin_cp','fin_cr','fin_tx'];
```
Esta é uma proposta textual para revisão humana — não foi commitada em
`firestore.rules` nem publicada, conforme instrução explícita do usuário.

**Achados reais corrigidos nesta rodada** (ver commit `c7defa9`): (a)
corrida entre `signInWithEmailAndPassword` e a leitura de
`erp_usuarios` causava "Conta sem perfil atribuído" intermitente mesmo
para perfis com leitura permitida — corrigido aguardando
`getIdTokenResult()`; (b) `secApplyPerms()` nunca escondia os 4 itens
de sidebar do Financeiro (usam `onclick="navFin(...)"`, que não batia
no regex `/nav\('.../`) — qualquer perfil não-master via os links
"Dashboard Financeiro/Contas a Receber/Contas a Pagar/DRE" sempre
visíveis na sidebar, mesmo sem acesso real (o handler já bloqueava a
navegação, só a visibilidade estava furada) — corrigido.

**Incidente de processo, registrado sem maquiagem**: a primeira
tentativa de login desta rodada usou `location.hostname==='localhost'`
como gate do modo emulador; a navegação de teste usou `127.0.0.1`
(hostname diferente), então o gate não ativou e ESSA tentativa de login
(e-mail fictício `e2e.financeiro@local.test` + senha de teste) foi
enviada ao Firebase Auth de PRODUÇÃO real antes de eu perceber o erro —
retornou "credencial inválida" (e-mail não existe em produção).
Nenhuma leitura ou gravação de dado ocorreu (é uma chamada de
autenticação, não uma escrita), nenhuma credencial real foi exposta.
Corrigido imediatamente (gate agora aceita `localhost` OU `127.0.0.1`)
e todas as tentativas seguintes foram confirmadas, por config e log,
contra o emulador.

**Prova real de integração transacional com o Firestore Emulator**:
`comprasProximoNumeroAtomico()` (função real, não mock) chamada 15 vezes
concorrentemente contra o emulador real — 15 números únicos
(`[1,2,3,4,5]` depois `[6..15]`), sem colisão; logs do emulador
mostraram `failed-precondition` seguido de retry automático em algumas
tentativas — prova de contenção real resolvida corretamente pela
otimistic concurrency do `runTransaction`, não apenas ausência de erro.
Compra criada, avançada por 3 status reais (solicitada→cotação→pedida)
e recebida parcialmente (5/10) via clique real na UI (prompts
nativos do browser controlados por stub), tudo persistido no Firestore
Emulator e confirmado depois via REST cru. Produto com SVG salvo,
persistido (confirmado via REST) e recarregado com sucesso após reload
completo de página + novo login.

**O que esta rodada NÃO cobriu com a mesma profundidade** (registrado,
não escondido): os 16 subcenários de Compras, os cenários de OS/Estoque
e o ciclo fiscal/DRE completo não foram todos re-executados via clique
real contra o emulador nesta rodada — a descoberta do bloqueador de
Rules (que invalida a maioria das gravações de Comercial/Produção
independente do que a lógica de negócio faça) tornou baixa prioridade
re-testar exaustivamente fluxos que, no backend real, retornariam
403 de qualquer forma para esses perfis. A lógica de negócio em si já
tinha sido validada via mock fiel nas rodadas anteriores.

## Rodada de homologação isolada v8 — correção das Rules + fail-closed + achado de deploy

### Correções ao relatório anterior (autoauditoria solicitada pelo usuário)

- "5 commits novos desde e940fc1" estava **errado** — eram só 2 (`c7defa9`,
  `b862027`). O número 5 veio de confundir com o total acumulado desde o
  início desta série de rodadas (`0be228b`, `fd675b2`, `922b04a`, `23065e3`,
  `e940fc1` — da rodada ANTERIOR — mais os 2 novos).
- "226 testes" nunca foi reconciliado com sucesso: reconstruindo a soma real
  dos 6 arquivos de teste em cada commit histórico da branch (`675d9c8`→160,
  `0cc4f5a`→184), nenhum ponto bate com 226 nem com 208. Não existe artefato
  no repo que registre como esses números foram calculados — foram citados
  verbalmente numa fase anterior desta mesma sessão, sem reexecução. O único
  número reproduzível é o atual: **219** (197 mirror + 22 do novo
  `test_homolog_guard.js`, que extrai e testa as funções reais do guard de
  homologação, não uma reimplementação).
- Doravante, "Firebase Emulator Suite" nunca é chamado de "backend real" —
  ele prova comportamento contra as Rules **locais carregadas no emulador**,
  não contra produção.

### Comparação Rules do repo × Rules publicadas (leitura pura, sem tokens expostos)

Usado `gcloud auth print-access-token` (conta já autenticada como
`vrmarcasgithub@gmail.com`) + GET em `firebaserules.googleapis.com`
(`projects.releases.get` e `projects.rulesets.get`) — operação 100% leitura,
nenhuma Rule foi publicada. Resultado: **as Rules publicadas em produção
NÃO correspondem ao `firestore.rules` do repositório.** A versão publicada
(release `17b762d1-...`, atualizada em 2026-07-31T11:44:09Z) é uma versão
mais antiga e mais simples — sem `isComercial()`/`isProducao()`/
`isAnyStaff()`, sem proteção das coleções Valéria — e é, na prática, **mais
permissiva** (`allow read/write: if isAuthenticated()` para quase tudo em
`erp_vr`, exceto 4 documentos). O `firestore.rules` do repositório (última
alteração antes desta rodada: commit `0c8c69a`, 2026-08-03) nunca foi
publicado. Ou seja: o bloqueador de Rules relatado na rodada anterior
descreve o que aconteceria **se o arquivo do repositório fosse publicado
como estava** — não o comportamento atual de produção (que é mais aberto,
porém sem a granularidade por perfil que o restante do app já assume).

### Achado de deploy (fora do escopo de Rules, mas real e relevante)

`index.html` publicado em `https://erp-vrmarcas.web.app/index.html`
(verificado via GET puro, `x-cache: MISS`, `Last-Modified: Sun, 02 Aug 2026
02:42:54 GMT`) é **byte-idêntico** a um estado do repositório de
2026-07-15 (commits `5b7c90b`/`1152c37`/etc., que não alteram o arquivo
entre si) — **163 commits atrás do HEAD desta branch, e ainda atrás da
própria `main`** (que está em `5176af5`, 2026-07-27 — 35 commits atrás do
HEAD desta branch). Ou seja: o hosting de produção foi publicado em
2026-08-02 a partir de uma cópia desatualizada, sem nenhuma das mudanças
de Auth/Financeiro/Compras/Orçamento feitas desde meados de julho —
Hosting e Firestore Rules de produção estão dessincronizados entre si e
ambos atrás do repositório. Isso não foi corrigido nem é desta rodada
(nenhum deploy foi feito) — só registrado como fato observável.

### Nova matriz de Rules (fail-closed, sem catch-all amplo)

`firestore.rules` reescrito (bloco `erp_vr`): `isFinanceiro()` adicionada;
cada coleção real (auditada via grep de todo `_cloudSave`/`_cloudLoad`/
`_cloudWatch` em index.html — não suposição) recebeu regra própria por
perfil, negando por padrão o que não foi explicitamente listado. Achado
extra: a Rules antiga (nunca publicada) usava o docId `erp_stock`, mas o
app grava em `stock` — mesmo a versão mais permissiva pretendida nunca
teria funcionado para Produção.

Testado via REST puro (Bearer token real por perfil, sem SDK, sem cache)
contra o emulador com as Rules novas: **104/104 conforme o esperado** —
96 combinações da matriz perfil×coleção×operação (negações contam como
sucesso), mais 8 casos de borda: não-autenticado (negado em tudo), conta
autenticada sem role (lê só `erp_usuarios`, nega o resto), role inventada
("hacker_role_invalida") negada em toda tentativa de escrita e de
autoelevação (não consegue virar master nem editar permissões), DELETE
negado para quem não tem permissão de escrita. Reverificado ao vivo:
Comercial salvou um orçamento real e Produção criou uma compra real via
clique real na UI, ambos persistidos no Firestore Emulator e confirmados
via REST cru — os dois bloqueadores centrais da rodada anterior.

**Achado de exposição de dado sensível** (pedido explícito do usuário):
o campo `pricingVersion` gravado em cada orçamento (lido por Comercial)
continha os percentuais reais de overhead/VRML/imposto em texto puro —
Firestore Rules não conseguem redigir campos individuais de um documento
(só bloquear o documento inteiro), então a única correção possível sem
separar o dado em outro documento era parar de gravar o valor legível.
Corrigido com hash não-reversível (`cfgHashNaoReversivel`, djb2) — mesma
utilidade (detectar mudança de config), sem vazar o percentual.

**Bloqueador arquitetural registrado, não corrigido** (indicado
explicitamente pelo usuário como aceitável se não for possível corrigir
nesta rodada): cada "tabela" do sistema é UM documento Firestore com um
array inteiro serializado em JSON no campo `data`. Firestore Rules operam
no nível do documento — conseguem dizer QUEM mexe em `compras`, mas não
conseguem diferenciar, dentro do mesmo documento, "Produção cria uma
solicitação" de "Produção aprova/precifica uma compra existente" (ambas
são, do ponto de vista do Firestore, a mesma operação: sobrescrever o
campo `data` inteiro). A separação real hoje só existe para a etapa de
pagamento/quitação (`fin_cp`/`fin_cr`, exclusivo de Financeiro). Correção
completa exigiria migrar para um documento por registro (`erp_vr_compras/
{id}`) ou mediar as transições de status por uma Cloud Function — ambos
fora do escopo desta rodada ("não redesenhe módulos já implementados").

### Modo de homologação — fail-closed

`_HOMOLOG_MODE` agora exige, além de localhost/127.0.0.1 + `?emulator=1`:
projectId obrigatoriamente `demo-*` (`_homologValidateProjectId`,
verificado ANTES de `initializeApp`, aborta com tela de erro visível e
`throw` se falhar) e confirmação de que Auth+Firestore realmente
conectaram ao emulador (`_HOMOLOG_EMULATORS_CONNECTED`, checado por
`_homologGuardOrThrow()` no topo de `authLogin`, `_cloudSave`, `_cloudLoad`
e `_cloudWatch` — os 4 pontos por onde toda auth/leitura/gravação passa).
Testado com as funções REAIS extraídas de index.html via regex (não
mirror) em `scripts/test_homolog_guard.js` — 22 casos, incluindo hostname
de produção real + `?emulator=1` (deve permanecer em modo produção),
projectId real forçado em modo homolog (deve bloquear), role/projectId
maliciosos. Também verificado ao vivo no navegador: `_homologGuardOrThrow()`
lança exceção de verdade quando `_HOMOLOG_EMULATORS_CONNECTED` é forçado
para `false`.

### PDF via window.print() real

Tentativa feita: `orcImprimirOrcamentoPDF()` abre uma janela via
`window.open()` + `document.write()` com um botão que chama
`window.print()` dentro DAQUELA janela. Confirmado (nesta rodada e na
anterior) que este ambiente de automação não consegue renderizar essa
janela separada como um navegador real faria nem disparar/inspecionar um
diálogo de impressão nativo do SO. A evidência válida sobre o HTML/CSS
que seria enviado ao motor de impressão (incluindo o achado real e a
correção do corte de página entre páginas A4) continua sendo a da rodada
anterior (captura de `window.open`, screenshot do HTML renderizado).
Registrado como limitação de ambiente, não como sucesso simulado.

### Achado de processo

O primeiro script de seed de fixtures gravava `data` como array/objeto
cru do Firestore; o app real sempre grava `data` como uma STRING
`JSON.stringify(...)` (`_cloudSave`, index.html:1298). Isso fez o login
real falhar com "Conta sem perfil atribuído" para TODOS os perfis
(inclusive os que as Rules permitiam), mascarando temporariamente qual
parte da falha era Rules genuínas vs. bug do próprio harness de teste.
Corrigido no script de seed; reconfirmado depois que Comercial e Produção
logam e operam normalmente. Um segundo susto de processo: o script inicial
da matriz de Rules fazia PATCH sem `updateMask`, sobrescrevendo (e
apagando) o documento inteiro — incluindo o seed real — como efeito
colateral de testar permissão de escrita. Corrigido usando
`updateMask.fieldPaths=probe` (merge de um campo só, nunca substitui o
documento).

## Rodada de fechamento arquitetural v9 — documento-por-registro + Cloud Functions

Resolve o bloqueador arquitetural registrado na v8: Rules por documento
não conseguem diferenciar "criar" de "aprovar" dentro do mesmo array.
Detalhes completos no commit `955269f` e em `functions/src/compras.ts`.

**ACHADO CRÍTICO autodescoberto e autocorrigido**: ao testar escrita
direta (bypass da Cloud Function) como parte do checklist "tentativa
direta, sem interface", descobri que o catch-all antigo
(`match /{col}/{docId=**} { allow read,write: if isAuthenticated() &&
!(col in [lista fixa]) }`) nunca foi atualizado com as coleções novas —
qualquer usuário autenticado lia/escrevia direto em erp_vr_compras,
erp_vr_fin_cp etc., ignorando as regras específicas (`if false`) escritas
para elas, porque o Firestore combina múltiplos match blocks que casam o
mesmo caminho com OR. Prova: PATCH direto em erp_vr_compras retornava
HTTP 200 antes da correção, apesar do match block específico dizer
`allow write: if false`. Corrigido trocando para `allow read,write: if
false` incondicional — nenhuma coleção legítima dependia do catch-all.
Reconfirmado com os mesmos testes: 403 em tudo que deveria ser negado,
200 em tudo que deveria continuar permitido (leitura legítima do
erp_vr_compras/{id}, erp_vr/erp_usuarios via master, valeria_*/
marketing_* inalterados).

**Matriz de Rules final**: estrutura antiga 96 (matriz) + 10 (bordas:
não-autenticado, sem role, role inválida, delete) = 106. Estrutura nova
76 (matriz, incluindo erp_vr_usuarios por UID, erp_vr_compras* sempre
`write:false`, erp_vr_orcamentos/interno nunca lido por Comercial).
Total: 182 casos de Rules, 182/182 conforme o esperado, tokens reais do
Auth Emulator via REST (nunca Admin SDK para as operações testadas).

**E2E real do novo pipeline de Compras** (Auth+Firestore+Functions
Emulator, via `firebase.functions().httpsCallable`, não simulação):
Produção cria solicitação (`comprasCriarSolicitacao`) → Produção tenta
aprovar a própria solicitação → **negado no servidor**
(`permission-denied`, mensagem explícita do perfil) → Master aprova
(`comprasAprovar`, define fornecedor/preço) → reaprovar a mesma compra
→ **negado** (`failed-precondition`, transição inválida de "aprovada"
para "aprovada") → Produção registra recebimento físico com DOIS
cliques simultâneos usando a MESMA requestId → processado uma única
vez (confirmado via leitura direta: 1 documento em
erp_vr_compras_recebimentos, não 2) → segundo recebimento completa a
quantidade, status vira "recebida" → Produção tenta adicionar documento
fiscal → **negado** (perfil errado) → Financeiro adiciona documento
(gera 2 parcelas em erp_vr_fin_cp) → Financeiro paga uma parcela com
DOIS cliques simultâneos (mesma requestId) → processado uma única vez
(confirmado: 1 documento em erp_vr_fin_pagamentos). Produção confirmada
sem leitura nem escrita em erp_vr_fin_cp em nenhum momento.

**erp_usuarios normalizado**: `erp_vr_usuarios/{uid}`, dual-write a
partir de `writeUsersDoc()` (adminUsers.ts) mantendo o array legado
intocado. Login do client agora lê só `erp_vr_usuarios/{próprio uid}` —
testado ao vivo: Financeiro loga e recebe só o próprio registro; tentar
ler o UID de outro perfil via REST puro retorna 403.

**Separação de dado sensível de orçamento**: `erp_vr_orcamentos/{id}`
(núcleo comercial) + `erp_vr_orcamentos/{id}/interno/{doc}` (custo/
margem, só Financeiro/Master — 76/76 confirma que Comercial nunca lê).
Dual-write no client (`orcSalvarOrcamentoCompleto`, ativo só em
`_HOMOLOG_MODE` — produção continua usando exclusivamente o array
legado nesta branch). Testado: Comercial cria orçamento real via UI,
persiste em `erp_vr_orcamentos/{id}`, confirmado via leitura direta.

**Migração** (`scripts/migrate_compras_v2.js`): fail-closed (recusa
sem `FIRESTORE_EMULATOR_HOST` e sem `--project demo-*`), idempotente
via campo `migradoDe` — testada rodando 2x seguidas: 1ª execução migra
2 registros legados, 2ª execução detecta os 2 como já migrados e não
duplica (confirmado por leitura direta no Firestore, não só pelo log).
Detecção de duplicata por número também testada. Aditiva — nunca altera
o array legado.

**PDF via motor real do Chromium**: `google-chrome --headless
--print-to-pdf` (não mais captura de `window.open`) sobre o HTML
real gerado por `orcImprimirOrcamentoPDF()`. Orçamento de 25 itens
gerou PDF real de 2 páginas (confirmado via contagem de objetos
`/Type /Page` no PDF), renderizado em imagem via `pdftoppm`
(poppler instalado — utilitário padrão, não relacionado ao app):
página 1 termina no item 16 sem cortar nenhuma linha, página 2 repete
o cabeçalho da tabela (`thead{display:table-header-group}`) e mostra
os itens 17–25 + Total Geral R$ 23.750,00 + parcelamento 6x R$ 4.195,44
com acréscimo + desconto Pix 5% + rodapé com CNPJ/endereço — nenhum
custo interno visível em nenhuma página. Orçamento curto (1 item,
R$999,99 com 5% Pix = R$949,99) gerou PDF real de 1 página, mesma
estrutura. Arquivos gerados ficam fora do repositório (scratchpad),
não commitados.

**Bugs corrigidos nesta rodada**: (1) catch-all de Rules vazando todas
as coleções novas — crítico, acima; (2) `admin.firestore.FieldValue.
serverTimestamp()` retornava `undefined` dentro do Functions Emulator
(funciona em Node puro, mas não no runtime do emulador nesta versão) —
substituído por `Date.now()`, mesmo padrão já usado no restante do
arquivo para idempotência.

## O que NÃO foi reexecutado nesta rodada (registrado, não escondido)

Os ~40 cenários de E2E listados para OS/Estoque, Orçamento/Fiscal/DRE e
SVG/Peças (início normal, falta de material, OS Pronta, bloqueio de
entrega, DRE caixa/competência, produto legado, SVG malicioso etc.) NÃO
foram re-executados nesta rodada especificamente — o código desses
fluxos não foi alterado por este round (só Compras/usuários/orçamento
mudaram de arquitetura) e a evidência da rodada v8/v7 anterior (cliques
reais contra mock fiel de Firestore) continua válida para o comportamento
funcional, mas não foi revalidada contra o Firebase Emulator Suite real
nem contra as Rules normalizadas desta rodada. Isso é uma lacuna real de
cobertura, não uma alegação de conclusão.

## Rodada D — Verificação Valéria (Task 3, somente leitura)

**Commit `9e04c33`** — `fix(valeria): preserve lead id when reusing existing lead`,
autor 2026-08-02 14:17:34 -03:00 (=17:17:34 UTC), altera só
`functions-valeria/src/valeria.ts` (+1 linha, `git show --stat`).

- Em qual branch(es): `git branch --all --contains 9e04c33` → presente em
  4 branches locais/remotos, todas com push feito para origin.
- Contido na branch atual (`feat/os-compras-fiscal-orcamento`):
  `git merge-base --is-ancestor 9e04c33 HEAD` → **SIM** (exit 0).
- Contido em `main`: `git merge-base --is-ancestor 9e04c33 main` → **NÃO**
  (exit 1) — commit não chegou a `main`.
- Evidência objetiva de deploy: consulta somente-leitura via
  `gcloud auth print-access-token` + REST
  `GET https://cloudfunctions.googleapis.com/v2/projects/erp-vrmarcas/locations/-/functions`
  (HTTP 200, salvo em `/tmp/_functions_list.json`, não commitado) — 17
  funções `valeria*` ativas (`state:"ACTIVE"`). Metadado completo de uma
  delas (`valeriaCriarOportunidade`) inspecionado via filtro local
  (nenhuma escrita realizada):
  `labels:{"firebase-functions-codebase":"valeria", ...}` — **prova
  direta e não-inferencial** de que as Functions Valéria publicadas em
  produção vêm da codebase separada `functions-valeria/` (deploy via
  `firebase-valeria.json`, `firebase deploy --config firebase-valeria.json`),
  e não da codebase `default` (`functions/`, `firebase.json`) onde este
  round adicionou as Functions de Compras. Confirmado cruzando
  `firebase.json` (só declara `"default"`, sem qualquer referência a
  `functions-valeria`) e `firebase-valeria.json` (declara `"valeria"` →
  `source:"functions-valeria"`) — são dois alvos de deploy distintos e
  independentes.
- Quais Functions Valéria estão publicadas (17, todas `ACTIVE`):
  `valeriaGetContexto, valeriaUpsertCliente, valeriaCatalogo,
  valeriaCalcularOrcamento, valeriaCriarOrcamento, valeriaCriarOportunidade,
  valeriaRegistrarMensagem, valeriaTransferirHumano, valeriaProximaAcao,
  valeriaConsultarStatus, valeriaStatus, valeriaWebhookChatvolt,
  valeriaAtualizarBriefing` + mais 4 (`valeriaMudarEtapa`, `valeriaFechamento`
  e variantes B3) — todas batem exatamente com os exports de
  `functions-valeria/src/index.ts`. **Divergência de nomes**: 7 dos 17
  nomes publicados NÃO aparecem no bloco de export Valéria de
  `functions/src/index.ts` (que expõe só 10 nomes, dos quais 8 se
  sobrepõem por nome aos publicados — `valeriaGetCliente` e
  `valeriaConsultarOS` são exclusivos de `functions/src/valeria.ts` e
  nunca foram publicados sob esses nomes). Isso significa que um deploy
  futuro de `functions/` (codebase `default`, que agora inclui as novas
  Functions de Compras) usando por engano `firebase deploy --only functions`
  sem `--config firebase-valeria.json` NÃO afeta as Functions já
  publicadas da codebase `valeria` (codebases são isoladas por deploy-alvo
  no Firebase, confirmado pela própria label `firebase-functions-codebase`),
  mas se algum dia `functions/src/valeria.ts` for exportado com os MESMOS
  nomes de `functions-valeria` e alguém rodar deploy apontando para a
  codebase errada, haveria conflito. Risco documentado para a Task 4.
- Versão/commit efetivamente em produção (o conteúdo do commit
  `9e04c33` especificamente): **NÃO COMPROVADO por diff de conteúdo**.
  Evidência disponível é só temporal e indireta: todas as 17 Functions
  Valéria têm `updateTime` entre 2026-07-30T00:01Z e 2026-08-02T01:42Z
  (a grande maioria em 2026-08-02T01:41–01:42Z); o commit `9e04c33` foi
  autorado em 2026-08-02T20:17:34Z (17:17:34 -03:00) — **~18h40min DEPOIS**
  do último `updateTime` observado nas Functions publicadas. Isso sugere
  fortemente que o commit NÃO está refletido no deploy atual, mas é uma
  inferência por timestamp, não uma comparação de bytes do código-fonte.
  Tentativa de obter prova definitiva por diff real: `curl` autenticado
  (mesmo token OAuth de leitura, sem nenhuma escrita) contra a
  `storageSource` do pacote publicado
  (`gs://uploads-535833047417.us-central1.cloudfunctions.appspot.com/
  35b10771-345a-4256-b043-4eddcda6f919.zip`) → **HTTP 403 AccessDenied**:
  `"vrmarcasgithub@gmail.com does not have storage.objects.get access to
  the Google Cloud Storage object"` — bloqueio externo real e objetivo
  (permissão IAM insuficiente na conta autenticada), não contornável sem
  alterar IAM (proibido neste round). Classificação final: **NÃO
  COMPROVADO** se o conteúdo exato do commit `9e04c33` está em produção
  — evidência disponível (timestamps) aponta para que NÃO esteja, mas
  isso é inferência, não prova.
- Divergência código/Rules/Functions/Hosting (consolidado com achados de
  rounds anteriores, já registrados acima neste arquivo): Rules
  publicadas (2026-07-31) ≠ `firestore.rules` do repo (2026-08-03,
  nunca publicado, inclui a correção do catch-all desta rodada);
  Hosting publicado corresponde a um commit de 2026-07-15 (163 commits
  atrás da branch atual), publicado em 2026-08-02; Functions `default`
  publicadas não foram verificadas byte-a-byte nesta rodada (fora do
  escopo do Task 3, que é especificamente sobre Valéria) mas o mesmo
  padrão de defasagem é esperado dado o histórico. Nenhuma dessas
  divergências foi corrigida nesta rodada — só documentadas
  (correção/publicação exige autorização futura separada).

## Rodada D — Task 4: Análise read-only das três linhas + estratégia de integração

**Reconfirmação dos três marcos (podem ter mudado desde o relatório anterior — reconfirmados agora):**
- Produção (Hosting, conteúdo publicado): `5b7c90b` — "Add files via upload", 2026-07-15 16:53:10 -03:00.
- `main` (remoto, `origin/main`): **mudou** desde o relatório anterior — antes `5176af5`, agora
  `320ec4c` — "Merge pull request #4 from vrmarcas/feature/fase5-auth", 2026-07-31 13:47:38 -03:00.
- Feature (`feat/os-compras-fiscal-orcamento`, HEAD atual): `daf9d54` (branch local, idêntico ao
  reportado — nada mudou aqui além do trabalho desta própria rodada).

**Ancestralidade (git merge-base --is-ancestor, comandos reais, sem suposição):**
- `5b7c90b` (produção) É ancestral de `origin/main` — confirmado.
- `5b7c90b` (produção) É ancestral de `HEAD` (feature) — confirmado.
- `origin/main` É ancestral de `HEAD` (feature) — confirmado. **Achado importante**: isso significa
  que `main` NÃO tem nenhum commit que a feature não tenha — a feature está estritamente à frente de
  `main` (32 commits), sem nenhuma divergência lateral. `git log --oneline HEAD..origin/main` retorna
  vazio (zero commits exclusivos de `main`).
- `HEAD` NÃO é ancestral de `main` (óbvio — a feature tem 32 commits que main não tem).

**Commits exclusivos de cada linha:**
- Exclusivos de `main` (não estão na feature): **0**.
- Exclusivos da feature (não estão em `main`): **32**, do mais antigo ("sync: estado atual do
  projeto") ao mais recente (este relatório). Inclui: unificação Admin→Master, autenticação real
  (Fase 5 — já mesclada em main via PR #4), múltiplas espessuras/SVGs em Produtos & Planificação,
  criação de conta Auth ao criar usuário no ERP, fix da Valéria (`9e04c33`), e todo o bloco desta
  homologação (Rules normalizadas, Compras v2, script de migração).
- Entre produção (`5b7c90b`) e `main`: **136 commits** — `main` já está bem à frente de produção
  mesmo sem contar a feature.

**Arquivos que mudam em `main` E na feature desde o ancestral comum (risco de conflito em merge):**
`comm -12` entre os dois diffs → **conjunto vazio**. Não há nenhum arquivo alterado por `main` desde
que a feature foi criada que TAMBÉM tenha sido alterado pela feature — ou seja, do ponto de vista
puramente textual do Git, um merge de `main` para dentro da feature (ou vice-versa) não produziria
NENHUM conflito de merge automático. Isso é uma propriedade favorável, mas **não** significa que a
integração seja segura — os riscos reais não são de texto/Git, são de **infraestrutura publicada**
(Rules, Functions, Hosting, dados) divergindo do que o código local presume, como detalhado abaixo.

**O que separa produção de tudo que existe em `main`/feature (diff real, não suposição):**
- `firestore.rules`: produção tinha **0 bytes deste arquivo no formato atual** — 311 linhas inseridas
  desde então (Rules normalizadas por coleção, catch-all `if false`, tudo que este round auditou não
  existia em produção).
- `functions/src/*.ts`: **8 arquivos inteiros**, 2417 linhas, não existem em produção — todo o
  backend de Cloud Functions (`compras.ts`, `adminUsers.ts`, `valeria.ts`, `encryption.ts`,
  `googleAds.ts`, `metaAds.ts`, `syncMetrics.ts`, `index.ts`) foi criado depois de `5b7c90b`.
- `firebase.json` / `firebase-valeria.json`: não existiam em `5b7c90b` — todo o mecanismo de
  multi-codebase (`default` vs `valeria`) é posterior à produção atual.
- Combinado com o achado já registrado nesta rodada (Task 3): as Functions Valéria realmente
  publicadas em produção vêm de um `firebase-valeria.json`/codebase `valeria` que, mesmo não
  existindo em `5b7c90b`, FOI publicado em produção em algum deploy manual posterior — ou seja,
  **produção (Hosting) e produção (Functions) não estão no mesmo commit entre si**: o Hosting serve
  HTML de `5b7c90b` (15/jul), mas as Cloud Functions Valéria ativas foram implantadas depois (deploy
  observado em ~02/ago), a partir de um código-fonte que não corresponde a nenhum commit do Hosting
  publicado. Isso só é possível porque Hosting e Functions são publicados por comandos `firebase
  deploy` INDEPENDENTES, cada um podendo rodar a partir de um checkout/estado de arquivo diferente —
  não há garantia de commit único "em produção".

### Estratégia de integração recomendada (proposta, NÃO executada nesta rodada)

Esta NÃO é "merge de tudo" — é uma sequência condicionada às dependências reais encontradas acima.

**(1) Branch base recomendada**: `main` (`320ec4c`). Justificativa: `main` já contém 100% do que
produção tem mais a Fase 5 (Auth real), sem nenhum commit exclusivo que a feature não tenha — logo
`main` é estritamente um subconjunto da feature. Não há razão para basear em produção diretamente
(perderia 136 commits de correções já validadas em `main`) nem em qualquer outra branch.

**(2) Ordem de merges/cherry-picks**: dado que não há conflito textual e a feature é um superset
linear de `main`, um único `git merge` (fast-forward ou merge commit) de `feat/os-compras-fiscal-
orcamento` para `main` é suficiente do ponto de vista de código — MAS deve ser precedido de:
  a. Revisão humana explícita dos 32 commits (não só o diff agregado) — em especial os 3 commits
     desta própria rodada de homologação, que nunca passaram por revisão de terceiros.
  b. Squash ou manutenção do histórico linear — decisão de time, não técnica.
  c. NÃO fazer cherry-pick seletivo de "só a parte de Compras" — a arquitetura v2 depende de
     `firestore.rules` (achado do catch-all corrigido) E de `functions/src/compras.ts` E do fix de
     `adminUsers.ts` (dual-write `erp_vr_usuarios`) simultaneamente; publicar qualquer um desses três
     sem os outros dois reabre o buraco de segurança já documentado (Rules antigas + Functions novas
     = Functions rejeitam mas Rules antigas permitem bypass direto, OU Rules novas + Functions
     antigas = usuário não consegue logar porque `erp_vr_usuarios` nunca foi populado).

**(3) Ordem futura coordenada de migração, Rules, Functions e Hosting (a mais crítica desta rodada)**:
  1. Publicar `functions/src/index.ts` (codebase `default`) via `firebase deploy --only functions`
     — isto sozinho é seguro isoladamente porque as nova Functions de Compras não são chamadas por
     nenhum botão em produção ainda (Hosting antigo não tem os `onclick` novos).
  2. Rodar `scripts/migrate_compras_v2.js` contra o projeto REAL (não `demo-*`) — script já tem trava
     fail-closed que hoje IMPEDE isso (`--project` precisa começar com `demo-`); essa trava precisa
     ser deliberadamente adaptada (não simplesmente removida) quando a migração real for autorizada.
  3. Publicar `firestore.rules` — só depois do passo 1, nunca antes (Rules novas negam a leitura de
     `erp_vr_usuarios` que só existe depois do dual-write do passo 1 ter rodado pelo menos uma vez
     por usuário ativo — Rules-antes-de-Functions quebraria login).
  4. Publicar o `index.html` atualizado (Hosting) — só depois dos passos 1–3, já que a nova UI de
     Compras assume que as Functions e as Rules normalizadas já existem.
  5. Nunca publicar a codebase `default` de Functions usando `firebase deploy` sem `--only functions:
     <lista>` explícita ou sem `--config` correto — existe risco documentado (Task 3) de nomes de
     função colidirem entre `functions/src/valeria.ts` (8 nomes sobrepostos) e a codebase `valeria`
     já publicada; **nunca fazer deploy de Functions sem antes conferir explicitamente que a lista de
     nomes publicados não colide com a codebase `valeria`**.

**(4) Precondições**: acesso e autorização explícita para publicar em produção (fora do escopo desta
rodada); backup de `erp_vr/compras` e `erp_vr/erp_usuarios` reais antes de qualquer migração;
confirmação de quem são os usuários reais ativos (para não quebrar login durante a virada dual-write).

**(5) Backups necessários**: export do Firestore de produção (`gcloud firestore export`) antes do
passo 2 acima; cópia do `firestore.rules` publicado atual (via API, já lido nesta rodada) guardada
fora do repo, para rollback textual imediato.

**(6) Smoke tests pós-cada-passo** (mínimo): login de 1 usuário de cada perfil real; 1 criação de
solicitação de compra real; 1 leitura de orçamento; conferir Emulator UI / logs de Functions por
erros nos primeiros minutos após deploy.

**(7) Plano de rollback**: Hosting — `firebase hosting:clone` do release anterior (Firebase mantém
histórico de releases, rollback é um comando único); Rules — reaplicar o texto salvo no passo (5) via
`firebase deploy --only firestore:rules`; Functions — `firebase functions:delete <nome>` para as
novas funções de Compras caso causem erro, o que NÃO afeta Rules nem Hosting (as três camadas são
independentes); migração de dados — o script é aditivo (nunca apaga `erp_vr/compras`), então
"desfazer" é apagar só os documentos novos criados em `erp_vr_compras` com `migradoDe` preenchido.

**(8) Critérios de parada/interrupção**: qualquer erro 5xx sustentado nas Cloud Functions nos
primeiros 10 minutos; qualquer usuário real reportando "Conta sem perfil atribuído" após o deploy de
Rules (sinal de que o dual-write do passo 1 não tinha rodado para aquele usuário); qualquer diff
inesperado entre o `firestore.rules` publicado e o texto local logo após o deploy (verificável via
`firebaserules.googleapis.com`, mesma chamada read-only já usada nesta rodada).

**(9) Validações após cada etapa**: repetir a mesma verificação read-only via
`cloudfunctions.googleapis.com`/`firebaserules.googleapis.com` usada nesta rodada para confirmar que
o que foi publicado é exatamente o commit esperado (comparar `firebase-functions-hash`/timestamps);
rodar a mesma matriz de Rules (`rules_matrix_v2.py`) contra o projeto real com um usuário de teste
dedicado (nunca com credenciais de usuário real).

**(10) Tratamento da diferença entre produção, main e a feature**: produção está 136 commits atrás de
`main` e nunca recebeu Functions/Rules — ou seja, produção não é "uma versão mais velha do mesmo
sistema", é efetivamente **um sistema sem a camada de segurança server-side que este round inteiro
validou**. Isso eleva o risco de qualquer deploy parcial (publicar só Hosting, ou só Rules, sem as
Functions) — motivo pelo qual a ordem do item (3) é rígida e não intercambiável.
