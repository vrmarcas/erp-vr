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
- Interação humana real com os botões (cliques/toques) fora da tela de
  Produtos & Planificação e do PDF A4 — as funções de outras telas
  (Compras, financeiro, etc.) continuam validadas via chamada direta de
  função, não via `click()` simulado no DOM. Os elementos-alvo
  (`kbEntregarBtn`, etc.) foram confirmados presentes e com `onclick`
  correto num teste anterior desta sessão, mas o disparo real de evento
  de clique não foi reexercitado para eles nesta rodada.
