#!/usr/bin/env bash
#
# release_hosting.sh — gate de release do Firebase Hosting do ERP VR Marcas.
#
# Achado que motivou este script: em rodadas anteriores, commits foram
# testados, commitados e enviados para origin/master, mas o Firebase Hosting
# continuou servindo uma versão antiga (produção em 98a43cd enquanto f8c5ac8
# e 96e719c já estavam no remoto). "push concluído" != "produção atualizada".
#
# Este script NÃO substitui commit/push — eles continuam manuais. Ele é o
# portão que vem DEPOIS: garante que o que está commitado/pushado realmente
# chegou ao ar, e falha explicitamente (exit != 0) se não chegou.
#
# Fluxo (cada etapa aborta o script se falhar — nenhuma é decorativa):
#   1. working tree limpa (nada de não commitado, .claude/launch.json incluso)
#   2. branch = master, sincronizada com origin/master (nada pra push/pull)
#   3. suíte de testes leves (auto-detectada, sem emulador) passa 100%
#   4. firebase deploy --only hosting
#   5. busca a URL real de produção (com cache-busting, sem cache de CDN)
#   6. compara hash SHA-256 do index.html local vs o servido — só então a
#      rodada pode ser considerada concluída
#
# Uso:
#   scripts/release_hosting.sh
#       roda a suíte leve padrão (todo scripts/test_*.js que não depende de
#       emulador/admin SDK, detectado automaticamente a cada execução — não
#       é uma lista hardcoded, então cobre testes novos sem precisar editar
#       este script) e então faz o deploy + verificação.
#
#   scripts/release_hosting.sh scripts/test_foo.js scripts/test_bar.js
#       roda só os testes indicados (útil para reverificar rápido os testes
#       específicos da rodada atual) e então faz o deploy + verificação.
#
#   RELEASE_SKIP_TESTS=1 scripts/release_hosting.sh
#       pula a etapa de testes. Uso excepcional — imprime um aviso bem
#       visível, nunca pula silenciosamente.
#
#   RELEASE_PROD_URL, RELEASE_TENTATIVAS, RELEASE_INTERVALO_S
#       ajustam URL de produção / nº de tentativas / intervalo (segundos)
#       da verificação pós-deploy. Padrões: https://erp-vrmarcas.web.app, 6, 5.
#
# Não toca .claude/launch.json. Não altera lógica funcional do ERP
# (index.html) — apenas lê o arquivo para calcular hash e faz deploy do que
# já está commitado.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROD_URL="${RELEASE_PROD_URL:-https://erp-vrmarcas.web.app}"
TENTATIVAS="${RELEASE_TENTATIVAS:-6}"
INTERVALO_S="${RELEASE_INTERVALO_S:-5}"

verde() { printf '\033[32m%s\033[0m\n' "$1"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
etapa() { printf '\n\033[1m[ETAPA %s]\033[0m %s\n' "$1" "$2"; }
abortar() { vermelho "❌ $1"; vermelho "   Rodada NÃO concluída."; exit 1; }

echo "=========================================================="
echo " release_hosting.sh — gate de release Firebase Hosting"
echo " repo: $REPO_ROOT"
echo "=========================================================="

# ── 1/6 — working tree limpa ────────────────────────────────────────────
etapa "1/6" "Validando working tree..."
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  vermelho "Working tree não está limpa:"
  echo "$DIRTY"
  abortar "Commite, faça stash ou reverta as alterações pendentes antes de liberar o release."
fi
if ! git diff --quiet HEAD -- .claude/launch.json 2>/dev/null; then
  abortar ".claude/launch.json foi alterado — isso nunca deve ir para um commit/release."
fi
verde "OK — working tree limpa."

# ── 2/6 — branch master sincronizada com origin ─────────────────────────
etapa "2/6" "Validando branch e sincronismo com origin/master..."
BRANCH_ATUAL="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH_ATUAL" != "master" ]; then
  abortar "Branch atual é '$BRANCH_ATUAL', não 'master'. Deploy de Hosting só a partir de master."
fi
git fetch origin master --quiet
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/master)"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  vermelho "HEAD local:  $LOCAL_SHA"
  vermelho "origin/master: $REMOTE_SHA"
  abortar "master local não está sincronizada com origin/master (falta push ou falta pull)."
fi
verde "OK — master local == origin/master ($LOCAL_SHA)."

# ── 3/6 — testes ─────────────────────────────────────────────────────────
etapa "3/6" "Rodando testes..."
if [ "${RELEASE_SKIP_TESTS:-0}" = "1" ]; then
  vermelho "⚠️  RELEASE_SKIP_TESTS=1 — ETAPA DE TESTES PULADA. Isso é excepcional e deve ser justificado."
else
  if [ "$#" -gt 0 ]; then
    TESTES=("$@")
    echo "Usando lista de testes explícita (${#TESTES[@]} arquivo(s))."
  else
    # Auto-detecção: todo scripts/test_*.js que NÃO depende de emulador ou
    # de credencial admin de produção (mesmo critério usado para montar a
    # suíte leve nesta rodada: 125/149 arquivos, ~27s no total).
    mapfile -t TESTES < <(grep -LE "FIRESTORE_EMULATOR_HOST|firebase-admin|_prod_admin_credential|getProdApp" scripts/test_*.js)
    echo "Suíte leve auto-detectada (sem emulador/admin SDK): ${#TESTES[@]} arquivo(s)."
  fi

  FALHAS=0
  for t in "${TESTES[@]}"; do
    if ! node "$t" > /tmp/release_hosting_test_out.log 2>&1; then
      vermelho "  ❌ FALHOU: $t"
      tail -n 20 /tmp/release_hosting_test_out.log | sed 's/^/       /'
      FALHAS=$((FALHAS+1))
    fi
  done
  rm -f /tmp/release_hosting_test_out.log
  if [ "$FALHAS" -gt 0 ]; then
    abortar "$FALHAS teste(s) falharam. Corrija antes de fazer deploy."
  fi
  verde "OK — ${#TESTES[@]} teste(s) passaram."
fi

# ── 4/6 — deploy Hosting ────────────────────────────────────────────────
etapa "4/6" "Deploy do Firebase Hosting (npx firebase-tools deploy --only hosting)..."
if ! npx firebase-tools deploy --only hosting --project erp-vrmarcas; then
  abortar "firebase deploy retornou erro."
fi
verde "OK — comando de deploy concluiu sem erro (isso ainda NÃO prova que produção foi atualizada — próxima etapa confirma)."

# ── 5/6 e 6/6 — smoke test contra produção real + verificação de hash ──
etapa "5/6 e 6/6" "Verificando conteúdo real servido em $PROD_URL contra o commit local..."
if ! node "$SCRIPT_DIR/release_verify_prod.js" --url="$PROD_URL" --tentativas="$TENTATIVAS" --intervalo="$INTERVALO_S"; then
  abortar "Produção NÃO corresponde ao commit local após $TENTATIVAS tentativa(s). Deploy ausente, incompleto ou stale."
fi

echo
verde "=========================================================="
verde " ✅ RELEASE CONCLUÍDO — produção confirmada em $PROD_URL"
verde "    commit: $LOCAL_SHA"
verde "=========================================================="
