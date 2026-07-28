# 🧠 PROMPT MESTRE — ERP VR Marcas
> Cole este documento no início de qualquer nova conversa para o Claude retomar no mesmo nível.

---

## REGRA CRÍTICA (NUNCA IGNORAR)

**SEJA cirúrgico como senior.**
- NÃO altere nenhuma funcionalidade além da solicitada
- NÃO refatore partes não relacionadas ao pedido
- NÃO modificar estilos, cores, tamanhos ou espaçamentos sem autorização explícita
- NÃO remover códigos existentes sem informar exatamente o motivo
- NÃO mudar comportamento de componentes já funcionando
- NÃO simplificar lógica existente "por conta própria"
- NÃO mecher nem tocar em nada além do que pedi
- Se houver risco de quebrar algo, avise antes de executar alterações
- Priorize estabilidade do projeto acima de "melhorias automáticas"
- Nunca assumir requisitos não informados
- Respeite exatamente a estrutura atual do projeto
- **Faça apenas o mínimo necessário para resolver exatamente o pedido**

---

## VISÃO GERAL DO PROJETO

**ERP completo single-file** para VR Marcas (empresa de acrílicos/sinalização) e sua marca Vitre.

- **Arquivo principal:** `C:\Projetos\ERP VR\index.html` (~19.100 linhas, ~1.1 MB)
- **GitHub Pages (produção):** https://vrmarcas.github.io/erp-vr/
- **Repositório:** https://github.com/vrmarcas/erp-vr
- **Firebase projeto:** `erp-vrmarcas` (Firestore como banco de dados em nuvem)
- **Push para GitHub:** `node "C:\Projetos\ERP VR\git_commit_push.js" "mensagem"` (isomorphic-git, sem git.exe) — ou Claude-in-Chrome MCP via https://github.com/vrmarcas/erp-vr/upload/main

---

## ARQUITETURA TÉCNICA

### Firebase / Persistência
```javascript
_cloudSave(key, data)   // salva no Firestore
_cloudLoad(key, cb)     // carrega do Firestore
_cloudWatch(key, cb)    // listener em tempo real
```

### Dados Globais Principais
| Variável | Conteúdo |
|---|---|
| `KB_OS` | Objeto com todas as OS do Kanban (chave = id da OS) |
| `FIN_CR` | Array de Contas a Receber |
| `FIN_TX` | Array de transações financeiras |
| `CLIENTES_DATA` | Array de clientes |
| `STOCK` | Objeto de estoque de materiais |
| `_ORC_ENVIADOS_DATA` | Array de orçamentos enviados/salvos |

### Funções Chave
```javascript
// Orçamentos
orcGetEnviados()             // retorna array de orçamentos
orcSetEnviados(arr)          // salva array de orçamentos
orcAtualizarBadgeEnviados()  // atualiza badge da sidebar
window.orcGerarOS()          // gera OS a partir do orçamento novo (Step 5)
orcEnvGerarOS()              // gera OS a partir de orçamento já salvo
orcSalvarOrcamento()         // salva orçamento sem gerar OS

// Kanban
kbOpen(id)                   // abre modal de uma OS
kbSaveKbos()                 // salva KB_OS no Firebase
kbRender()                   // re-renderiza o board
kbMarcarPronto()             // marca OS como Pronta
kbReceberSaldo()             // confirma recebimento do saldo 50/50
kbIniciarProd()              // inicia produção com baixa no estoque

// Financeiro
_finSaveCR()                 // salva FIN_CR no Firebase
finRender()                  // re-renderiza aba financeiro
syncSidebarBadges()          // atualiza todos os badges da sidebar

// Geral
showToast(msg, tipo)         // notificação (tipo: 'ok' | 'warn' | 'error')
nav(pagina, sub)             // navega entre páginas do ERP
renderOsTable()              // re-renderiza tabela de OS
```

---

## STATUS DOS CAMPOS KB_OS (Kanban)

| status | CSS class | Exibição |
|---|---|---|
| `iniciada` | `.si` amarelo | Iniciada |
| `producao` | `.sp` roxo | Em Produção |
| `aguardando_saldo` | `.sas` amarelo pontilhado | 💰 Aguard. Saldo |
| `pronta` | `.sr` verde | Pronta ✅ |
| `entregue` | `.se` azul | Entregue 🎉 |
| `master` | `.sm` rosa | 🔐 Aguard. Master |

---

## FLUXO PRINCIPAL

```
Novo Orçamento (5 steps)
  → Step 5: simMetodo (pix / cartao / 50_50 / link / dinheiro)
  → window.orcGerarOS()
    → cria KB_OS com status 'aguardando_saldo' (se 50_50) ou 'iniciada'
    → lança em FIN_TX
    → cria FIN_CR (50% pendente se 50/50, total recebido se outros)
    → auto-salva em _ORC_ENVIADOS_DATA
    → adiciona card no Kanban

Orçamento Salvo → Confirmar Pagamento → orcEnvGerarOS()
  → mesma lógica acima (status aguardando_saldo se tipo==='50-50')

Kanban Modal (kbOpen)
  → Botão "Iniciar Produção" → só aparece quando status==='iniciada'
  → Botão "Receber Saldo" → só aparece quando status==='aguardando_saldo'
  → Botão "Marcar como Pronta" → bloqueado se status==='aguardando_saldo'
```

---

## LOCALIZAÇÕES IMPORTANTES NO index.html

| O quê | Linha aprox. |
|---|---|
| CSS classes de status (.si .sp .sr .se .sm .sas) | ~197 |
| CSS mobile `@media (max-width: 768px)` | ~1107 |
| Kanban HTML (cards mockup) | ~1880 |
| Modal Kanban (kbIniciarProdBox, kbReceberSaldoBox) | ~2129 |
| `_kbStatusMap` | ~8079 |
| `kbOpen(id)` | ~8091 |
| `kbRenderChecklist` | ~8715 |
| `kbReceberSaldo()` | ~8960 |
| `kbMarcarPronto()` | ~8990 |
| `window.orcGerarOS` (IIFE) | ~11665 |
| Criação do KB_OS dentro de orcGerarOS | ~11791 |
| Auto-save em Orçamentos Enviados | ~11845 |
| `osImprimirPDF(id)` | ~11860 |
| `orcEnvGerarOS()` | ~13832 |
| Criação do KB_OS dentro de orcEnvGerarOS | ~13857 |

---

## MÓDULOS DO ERP

1. **Dashboard** — KPIs financeiros, gráficos, variação de despesas
2. **Orçamento** — 5 steps: cliente → itens → máquinas → prazo → pagamento
3. **Kanban** — gestão de OS por colunas (Novas, Seg–Sex, Prontas, Entregues)
4. **Orçamentos Enviados** — histórico de orçamentos convertidos em OS
5. **Financeiro** — Contas a Receber + Transações + Despesas
6. **Clientes** — cadastro completo com CPF/CNPJ, histórico de compras
7. **Estoque** — materiais, retalhos, baixa automática, histórico
8. **CRM** — pipeline Kanban de leads + CRM Base (Reativação + Prospects)
9. **Produtos** — catálogo com upload SVG
10. **Fornecedores** — cadastro
11. **Configurações** — markup, overhead, dados bancários, usuários/permissões
12. **Tarefas** — agenda de follow-ups por dia

---

## EMPRESAS

- **VR Marcas** (`mk: 'vr'`) — detectado por padrão
- **Vitre** (`mk: 'vit'`) — detectado via `document.body.classList.contains('vitre')`

---

## FUNCIONALIDADES JÁ IMPLEMENTADAS (172 tasks concluídas)

Não reimplemente nem altere. Já está no index.html:

- Layout mobile responsivo (todos os módulos e steps do orçamento)
- Orçamento 5-steps com cálculo automático e PDF A4
- Kanban drag-and-drop, progresso, checklist, filtros semanais/mensais
- Pagamento 50/50: status aguardando_saldo, botão Receber Saldo, bloqueio de Marcar Pronta
- Orçamentos Enviados: auto-save ao converter em OS pelo fluxo principal
- Contas a Receber vinculadas às OS (entrada + restante)
- CRM Base: importação Excel 10k leads, Reativação + Prospects, status inatividade
- CRM Pipeline: Kanban de leads com KPIs, push para Kanban OS
- Clientes: CPF/CNPJ, tipo PF/PJ, histórico compra a compra, editar/excluir/lixeira
- Estoque: baixa automática ao iniciar produção, retalhos com código automático
- Financeiro: FIN_TX + FIN_CR no Firebase, editar/excluir transações, períodos avançados
- Planificação: desenho visual das peças, exportar PNG/SVG, receitas cadastradas
- Comissão de vendedores + relatório mensal com metas
- Usuários com permissões por função (producao / comercial / master)
- Firebase Firestore: todos os dados sincronizados em nuvem
- GitHub Pages: ERP acessível via navegador

---

## DICAS DE USO

1. **Cole todo este arquivo** no início da conversa
2. Diga qual arquivo usar: `C:\Projetos\ERP VR\index.html`
3. Descreva o bug ou feature com comportamento atual vs. esperado
4. O Claude vai ler o código antes de qualquer mudança
5. Após cada alteração, peça: "sobe no GitHub"
6. Se algo quebrar, o Claude avisa antes de executar — confie no processo

---

## INTEGRAÇÃO VALÉRIA (Cloud Functions)

- **Projeto Firebase:** `erp-vrmarcas`
- **Codebase:** `valeria` — pasta `functions-valeria/` — config `firebase-valeria.json`
- **SDK:** `firebase-functions` v5.1.1, Node.js 22, Gen 1
- **Deploy:** `firebase deploy --only functions:valeria --config firebase-valeria.json`
- **15 endpoints** declarados em `functions-valeria/functions.yaml` (JSON)
- **CRM:** Valéria escreve em `erp_vr/crm_leads` (mesmo dict que o Kanban lê)
  - Campos de primeiro nível: compatíveis com Kanban (etapa, nome, tel, marca, etc.)
  - Sub-objeto `valeria: {}` contém dados exclusivos da IA (não afeta o Kanban)
- **Simulação de preço:** `valeria_simulations/{simulationId}` com TTL 1h + flag `usado`
- **AUTHORIZED_AGENTS:** Lido do Firestore `erp_vr/valeria_authorized_agents` (async, cache 5min)
  - Fail-closed: lista vazia = 403 FORBIDDEN (nunca aceita sem configuração)
- **Idempotência:** `ref.create()` transacional em `valeria_idempotency/{key}`
- **Rate limiting:** global 300/min + por conversa 30/min
- **Validador:** `node functions-valeria/validate_functions.js` — verifica 15/15 endpoints

### Segurança não autorizada (nunca tocar):
- Configuração do Chatvolt
- Conexão com WhatsApp direta (Tasks #88 e #89)

---

## COMO FAZER PUSH PARA O GITHUB

```bash
node "C:\Projetos\ERP VR\git_commit_push.js" "mensagem do commit"
# Auto-detecta todos os arquivos modificados via git statusMatrix
# Pede token via dialog Windows (não logar token no terminal)
```

Ou via Claude-in-Chrome MCP:
1. Navegar: `https://github.com/vrmarcas/erp-vr/upload/main`
2. Upload: arquivo via `file_upload` com path absoluto
3. Definir commit e confirmar

---

*Última atualização: 28/07/2026 | Tasks concluídas: #1–#172*
