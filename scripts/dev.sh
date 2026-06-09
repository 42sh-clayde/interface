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
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null >&2 || true
  fi
  echo "  → PORT=3101 ./scripts/dev.sh" >&2
  exit 1
fi

echo "→ http://localhost:$PORT"

if ! command -v node >/dev/null 2>&1; then
  echo "Erreur: Node.js requis (https://nodejs.org/)" >&2
  exit 1
fi

cd "$ROOT/backend"
npm install
cd "$ROOT/frontend"
npm install
npm run build
mkdir -p "$ROOT/backend/static"
cp -r dist/* "$ROOT/backend/static/"
cd "$ROOT/backend"
npm start
