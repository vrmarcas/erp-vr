# ERP VR Marcas

Sistema ERP interno da VR Marcas — gestão de orçamentos, estoque, CRM, marketing e usuários.

## Acesso

| Ambiente | URL |
|---|---|
| Produção | https://erp-vrmarcas.web.app |
| Firebase Console | https://console.firebase.google.com/project/erp-vrmarcas |

## Estrutura do projeto

```
ERP VR/
├── index.html              # Frontend completo (SPA single-file, ~22 mil linhas)
├── firestore.rules         # Regras de segurança do Firestore
├── firebase.json           # Config Firebase Hosting + Functions + Firestore
├── .firebaserc             # Projeto ativo: erp-vrmarcas
├── .gitignore              # Exclui node_modules/, lib/, .firebase/
│
├── functions/              # Cloud Functions — ERP (marketing, admin users)
│   └── src/
│       ├── index.ts        # Registra todas as funções
│       ├── adminUsers.ts   # FASE 5: gestão de usuários (admin)
│       ├── googleAds.ts    # Integração Google Ads
│       ├── metaAds.ts      # Integração Meta Ads
│       └── syncMetrics.ts  # Sync automático de métricas
│
├── functions-valeria/      # Cloud Functions — Agente Valéria (Chatvolt)
│   └── src/
│       └── valeria.ts      # Endpoints do agente IA
│
└── scripts/
    ├── git_commit_push.js  # Helper de commit automatizado
    ├── commit_push.bat     # Atalho Windows para git_commit_push.js
    ├── firebase_login.bat  # Login Firebase CLI (novos colaboradores)
    └── deploy_*.bat        # Scripts de deploy (ver DEVELOPMENT.md)
```

## Desenvolvimento colaborativo

Ver `DEVELOPMENT.md` para instruções de setup, workflow de branches e regras de colaboração.

## Status atual

Ver `STATUS.md` para estado de cada módulo e bugs conhecidos.
