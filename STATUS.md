# Status do Projeto — ERP VR Marcas

**Última atualização:** 2026-07-31
**Branch ativa:** `fix/bugs-2026-07-31`

---

## Estado dos módulos (produção)

| Módulo | Status | Observações |
|---|---|---|
| Login (Firebase Auth) | ✅ Funcionando | Email/senha; custom claims para role |
| Estoque | ✅ Funcionando | 30 itens reais; fix cache timing aplicado |
| Config Orçamento | ✅ Funcionando | Fix cache timing aplicado |
| Orçamentos | ✅ Funcionando | — |
| CRM / Leads | ⚠️ Verificar | Bug #1 em análise (lead não aparece) |
| Fornecedores | ⚠️ Verificar | Bug #3: não aparece para Isabella |
| Marketing / Google Ads | ✅ Funcionando | Fix companyId deployado |
| Marketing / Meta Ads | ✅ Funcionando | Fix companyId deployado |
| Agente Valéria | ✅ Funcionando | Fix anti double-spend; aguarda deploy |
| Admin de Usuários | 🚧 Pronto, não deployado | FASE 5: adminUsers.ts implementado |
| Bloqueio por inatividade | ✅ Funcionando | Fix F5 bypass aplicado |

---

## Alterações na branch `fix/bugs-2026-07-31` (a deployar)

### Deployadas em produção ✅
- Fix bloqueio inatividade (F5 bypass)
- Fix 27 materiais sumindo de Config Orçamento
- Fix gabrieelborges@hotmail.com sem perfil
- Fix companyId Google Ads e Meta Ads
- Migração estoque: 30 itens recuperados de `erp_stock` → `stock`

### Commitadas, aguardando PR/merge
- `chore: adicionar .gitignore e desrastrear compilados TypeScript` (208a12d)
- `fix: corrigir cache timing bug no Estoque e Config Orçamento` (17d9a8d)
- `feat(functions): fix companyId Marketing Ads + FASE 5 admin user management` (864ec76)
- `fix(valeria): anti double-spend — transação atômica` (2584a19)
- `fix(firestore): atualizar regras coleções Valéria` (61ef783)
- `chore: versionar scripts de workflow e deploy` (bb26712)

---

## Pendências / Bugs conhecidos

| # | Bug | Prioridade | Status |
|---|---|---|---|
| 1 | Lead criado não aparece no CRM | Alta | Em análise |
| 2 | Campo de desconto (preço/%) sumiu | Alta | Pendente |
| 3 | Aba Fornecedores não aparece para Isabella | Média | Pendente |
| 4 | Criação de usuário não persiste na lista | Média | Pendente (FASE 5 resolve) |
| 5 | Modal de usuário fecha ao clicar fora | Baixa | Pendente |
| 6 | Marketing cortando a página (dimensões) | Baixa | Pendente |
| 7 | Config Orçamento não salva materiais / edita preços | Alta | Pendente |

---

## FASE 5 — Admin de Usuários

**Estado:** Implementado, não deployado.

Funções prontas em `functions/src/adminUsers.ts`:
- `adminCreateUser` — criar conta + role + link de convite
- `adminUpdateUserRole` — alterar role (revoga sessão automaticamente)
- `adminToggleStatus` — ativar/desativar conta
- `adminResendInvite` — reenviar link de convite
- `adminRevokeSessions` — revogar tokens
- `adminListUsers` — listar usuários (dados mascarados)

**Para deployar:** executar `deploy_user_mgmt.bat` (somente Anna).
Testar primeiro no Emulator: `firebase emulators:start --only functions,firestore`

---

## Coleções Firestore — nomes atuais (pós-renomeação Valéria)

| Nome atual | Nome anterior | Observação |
|---|---|---|
| `valeria_idem_keys` | `valeria_idempotency` | Renomeado |
| `valeria_rate_limits` | `valeria_ratelimit` | Renomeado |
| `valeria_conversations` | (nova) | Histórico de conversas |
| `valeria_msgs` | (nova) | Mensagens individuais |

---

## Acesso / Roles

| Role | Permissões |
|---|---|
| `master` | Acesso total, pode criar/alterar qualquer usuário |
| `admin` | Gestão de usuários (exceto master), todas as telas |
| `comercial` | Orçamentos, CRM, Valéria |
| `producao` | Estoque, orçamentos em produção |
| `financeiro` | Área financeira (FASE 5, em implementação) |
