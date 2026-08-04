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

## O que este harness NÃO prova

- Login real via Firebase Auth (não testado — precisaria de credenciais).
- Round-trip real de gravação/leitura no Firestore de produção (o mock
  prova a *lógica* de transação, não a infraestrutura real do Firebase).
- Renderização visual do PDF A4 (testado por leitura de código + presença
  das novas seções HTML, não por screenshot de um PDF gerado com dados
  reais — precisaria de um orçamento real calculado via `_orcCalc`).
- Interação humana real com os botões (cliques/toques) — as funções foram
  chamadas diretamente via console, não via `click()` simulado no DOM.
  Os elementos-alvo (`kbEntregarBtn`, etc.) foram confirmados presentes e
  com `onclick` correto num teste anterior desta sessão, mas o disparo
  real de evento de clique não foi reexercitado aqui.
