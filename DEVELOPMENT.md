# Guia de Desenvolvimento — ERP VR Marcas

## Pré-requisitos

- Node.js 18+ e npm
- Git
- Firebase CLI: `npm install -g firebase-tools`
- Acesso ao projeto `erp-vrmarcas` no Firebase Console

## Setup inicial (primeira vez)

```bash
# 1. Clonar o repositório
git clone https://github.com/vrmarcas/erp-vr.git "ERP VR"
cd "ERP VR"

# 2. Instalar dependências
npm install
cd functions && npm install && cd ..
cd functions-valeria && npm install && cd ..

# 3. Autenticar Firebase CLI
firebase_login.bat         # Windows: abre browser para autorização
# ou: npx firebase-tools login

# 4. Verificar projeto ativo
firebase use
# deve mostrar: erp-vrmarcas
```

## Workflow de branches

```
master                    ← produção (somente via PR aprovado pela Anna)
  └── fix/bugs-YYYY-MM-DD ← branch de trabalho ativa
  └── feature/nome        ← novas funcionalidades maiores
```

**Regras:**
- Nunca commitar diretamente na `master`
- Nunca fazer merge sem revisão da Anna
- Nunca fazer deploy a partir de branch pessoal sem autorização
- Abrir PR no GitHub e aguardar aprovação antes de qualquer merge

## Como trabalhar (Anna e Gabriel)

```bash
# Sempre começar atualizando da master
git fetch origin
git checkout master
git pull origin master

# Criar branch para a tarefa
git checkout -b fix/descricao-curta
# ou continuar na branch ativa:
git checkout fix/bugs-2026-07-31

# Fazer commits separados por propósito
git add arquivo1.ts arquivo2.ts   # NÃO usar "git add ."
git commit -m "fix(modulo): descrição clara do que foi corrigido"

# Push e abrir PR
git push origin fix/descricao-curta
# → abrir PR no GitHub: https://github.com/vrmarcas/erp-vr/pulls
```

## Builds TypeScript

Os compilados (`functions/lib/`, `functions-valeria/lib/`) estão no `.gitignore`.
Sempre reconstruir antes de deploy:

```bash
# functions/
cd functions && npm run build && cd ..

# functions-valeria/
cd functions-valeria && npm run build && cd ..
```

Validar funções Valéria após build:
```bash
cd functions-valeria
node validate_functions.js
```

## Scripts de deploy (somente Anna/master)

> ⚠️ Estes scripts apontam para produção. Não executar sem autorização.

| Script | O que faz |
|---|---|
| `deploy_hosting.bat` | Publica `index.html` no Firebase Hosting |
| `deploy_rules_only.bat` | Publica apenas as Firestore Rules |
| `deploy_functions.bat` | Deploy de todas as Cloud Functions (ERP) |
| `deploy_user_mgmt.bat` | Deploy das funções admin (FASE 5) |
| `deploy_valeria.bat` | Deploy das functions-valeria |
| `deploy_valeria_fix.bat` | Deploy Valéria com fix específico |

> Os caminhos nos `.bat` estão fixos para `C:\Projetos\ERP VR`.
> Gabriel deve ajustar o caminho se usar um diretório diferente.

## Firestore — coleções importantes

| Coleção | Documento | Conteúdo |
|---|---|---|
| `erp_vr` | `stock` | Estoque de materiais (30+ itens) |
| `erp_vr` | `erp_config` | Configurações de orçamento |
| `erp_vr` | `erp_usuarios` | Perfis de usuários |
| `erp_vr` | `stock_deleted` | Tombstone de itens deletados |
| `admin_audit_log` | — | Log de ações administrativas |
| `admin_invite_links` | — | Links de convite gerados |
| `valeria_*` | — | Coleções do agente Valéria |

## Conflitos em index.html

`index.html` tem ~22 mil linhas e é editado por ambos. Para evitar conflitos:

1. Antes de editar: `git pull origin master` para garantir base atualizada
2. Comunicar no grupo/chat qual seção está editando
3. Edições cirúrgicas — não reformatar o arquivo inteiro
4. Em caso de conflito: resolver manualmente, validar funcionamento no browser, depois commitar

## Segredos e credenciais

- **Nunca** colocar tokens, chaves ou senhas no código ou nos commits
- Secrets ficam no **Firebase Secret Manager** (acessível via Console)
- `.env` e `serviceAccountKey*.json` estão no `.gitignore` por segurança
- Se encontrar credencial exposta num commit: avisar Anna imediatamente

## Permissões de acesso ao repositório

| Pessoa | Papel no GitHub | Pode fazer deploy? |
|---|---|---|
| Anna | Owner / Admin | ✅ Sim (produção) |
| Gabriel | Collaborator | ❌ Não (só PR/review) |
