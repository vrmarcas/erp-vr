#!/usr/bin/env bash
# rebind_chatvolt_api_key.sh — ValerIA 2.0, Fase E.2.19 (2026-09-21).
#
# Roda como postdeploy de valeriaWebhookChatvolt (firebase-valeria.json).
#
# Causa raiz confirmada por evidência direta (Fase E.2.17): o SDK
# firebase-functions produz corretamente os 3 secrets no
# __endpoint/__trigger local (provado via require() direto no
# lib/index.js compilado) — o gap está no próprio Firebase CLI, que não
# propaga CHATVOLT_API_KEY para secretEnvironmentVariables em deploy
# seletivo (--only functions:codebase:nome) de função Gen1.
#
# Fase E.2.18 tentou colocar o comando gcloud diretamente na string do
# postdeploy do firebase-valeria.json — o próprio Firebase CLI avisou
# "Your command contains '=', it may result in the command not running"
# e, de fato, o binding não foi restaurado mesmo sem erro reportado (falso
# positivo). Este script existe para: (a) isolar o comando com '=' longe
# do parser de postdeploy do Firebase CLI, (b) nunca aceitar um falso
# positivo — verifica o estado FINAL via gcloud describe e falha
# (exit 1) se CHATVOLT_API_KEY não aparecer, mesmo que o `gcloud deploy`
# em si não tenha reportado erro.
#
# Nunca imprime/materializa o VALOR do secret — só referencia pelo nome
# (CHATVOLT_API_KEY:latest) e verifica a CHAVE (key) do binding, nunca o
# conteúdo.
set -euo pipefail

FUNCTION_NAME="valeriaWebhookChatvolt"
REGION="us-central1"
PROJECT="erp-vrmarcas"
SOURCE_DIR="functions-valeria"
ENTRY_POINT="valeriaWebhookChatvolt"
RUNTIME="nodejs22"
# --update-secrets ADICIONA/ATUALIZA só a chave listada — nunca remove os
# outros bindings já existentes (VALERIA_BEARER_SECRET/_PREV), ao
# contrário de --set-secrets, que substituiria a lista inteira.
SECRET_KEY="CHATVOLT_API_KEY"
SECRET_REF="CHATVOLT_API_KEY:latest"

echo "[rebind_chatvolt_api_key] vinculando ${SECRET_KEY} (só nome/versão, nunca valor) em ${FUNCTION_NAME}..."

gcloud functions deploy "$FUNCTION_NAME" \
  --project="$PROJECT" \
  --region="$REGION" \
  --source="$SOURCE_DIR" \
  --entry-point="$ENTRY_POINT" \
  --runtime="$RUNTIME" \
  --trigger-http \
  --update-secrets="${SECRET_KEY}=${SECRET_REF}" \
  --quiet

echo "[rebind_chatvolt_api_key] verificando binding final (só nomes das chaves, nunca valores)..."

SECRETS_JSON=$(gcloud functions describe "$FUNCTION_NAME" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format="json(secretEnvironmentVariables)")

check_secret_bound() {
  local key="$1"
  # Match exato da chave entre aspas — "VALERIA_BEARER_SECRET" nunca
  # confunde com "VALERIA_BEARER_SECRET_PREV" porque a aspa de
  # fechamento vem logo depois no primeiro caso e não no segundo.
  if ! printf '%s' "$SECRETS_JSON" | grep -q "\"key\": \"${key}\""; then
    echo "[rebind_chatvolt_api_key] ERRO: ${key} não está vinculado após o gcloud deploy. Postdeploy FALHOU." >&2
    exit 1
  fi
  echo "[rebind_chatvolt_api_key] confirmado: ${key} vinculado."
}

check_secret_bound "CHATVOLT_API_KEY"
check_secret_bound "VALERIA_BEARER_SECRET"
check_secret_bound "VALERIA_BEARER_SECRET_PREV"

echo "[rebind_chatvolt_api_key] OK — os 3 secrets estão vinculados."
