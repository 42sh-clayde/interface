#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$ROOT/fixtures/sample-repo"

if [[ ! -d "$FIXTURE/.git" ]]; then
  echo "Initialisation du repo fixture..."
  mkdir -p "$FIXTURE/config/apache/redirects"
  cat > "$FIXTURE/config/apache/redirects/.htaccess" <<'EOF'
# Redirections Apache
Redirect 301 /old-path /new-path
Redirect 301 /foo /bar
EOF
  git -C "$FIXTURE" init -b main
  git -C "$FIXTURE" add .
  git -C "$FIXTURE" commit -m "init fixture"
fi

export AZDO_ORG=dev-org
export AZDO_PROJECT=dev-project
export AZDO_REPO=dev-repo
export DEFAULT_BRANCH=main
export TARGET_FOLDER=config/apache/redirects
export REPO_MOUNT_PATH="$FIXTURE"
export SKIP_REMOTE_CHECK=true
export PORT="${PORT:-3100}"

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  nc -z localhost "$PORT" >/dev/null 2>&1
}

if port_in_use; then
  echo "Erreur: le port $PORT est déjà utilisé." >&2
  if command -v lsof >/dev/null 2>&1; then
    echo "Processus en écoute :" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null >&2 || true
  fi
  echo "" >&2
  echo "Options :" >&2
  echo "  1. Arrêter l'instance existante (ex. Ctrl+C dans son terminal, ou kill PID ci-dessus)" >&2
  echo "  2. Utiliser un autre port : PORT=3101 ./scripts/dev.sh" >&2
  exit 1
fi

echo "→ http://localhost:$PORT"

resolve_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    if [[ -x "$PYTHON" ]] || command -v "$PYTHON" >/dev/null 2>&1; then
      command -v "$PYTHON" 2>/dev/null || echo "$PYTHON"
      return
    fi
    echo "Attention: PYTHON='$PYTHON' introuvable — détection automatique." >&2
  fi
  command -v python3 || command -v python || true
}

resolve_pip() {
  local py="$1"
  if [[ -n "${PIP:-}" ]]; then
    if [[ -x "$PIP" ]] || command -v "$PIP" >/dev/null 2>&1; then
      command -v "$PIP" 2>/dev/null || echo "$PIP"
      return
    fi
    echo "Attention: PIP='$PIP' introuvable — utilisation de pip associé à Python." >&2
  fi
  command -v pip3 || command -v pip || "$py" -m pip 2>/dev/null || true
}

PYTHON="$(resolve_python)"
PIP="$(resolve_pip "$PYTHON")"

if [[ -z "$PYTHON" ]]; then
  echo "Erreur: python3 introuvable." >&2
  echo "  - Installez Python 3 depuis https://www.python.org/downloads/" >&2
  echo "  - Ou lancez sans variable d'environnement : unset PYTHON PIP && ./scripts/dev.sh" >&2
  exit 1
fi

if [[ -z "$PIP" ]]; then
  PIP="$PYTHON -m pip"
fi

cd "$ROOT/backend"
if [[ "$PIP" == *"-m pip"* ]]; then
  $PIP install -q -r requirements.txt
else
  "$PIP" install -q -r requirements.txt
fi
cd "$ROOT/frontend"
npm install
npm run build
mkdir -p "$ROOT/backend/static"
cp -r dist/* "$ROOT/backend/static/"
cd "$ROOT/backend"
"$PYTHON" run.py
